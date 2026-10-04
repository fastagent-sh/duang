/**
 * Subscriptions: one window's to one conversation, which outlives the runtime it listens on (`follow`), and
 * the table of all of them (`subscriptions`). A model change replaces the agent's runtime, and `rebind`
 * makes a subscription listen on the new one without the window seeing a gap. Kept apart from Electron so
 * the failure paths and the orderings can be tested.
 */

/** What FastAgent's `bound.events()` gives: an async iterator that says when it is subscribed. */
interface EventStream<E> extends AsyncIterable<E> {
  ready: Promise<unknown>;
}

export function follow<E, B extends { events(): EventStream<E> }>(
  /** The conversation on the runtime that is current now. Called again by every `rebind`. */
  open: () => Promise<B>,
  forward: (event: E) => void,
  /** Said once, when the subscription stops without having been asked to: the renderer is told why. */
  end: (reason: string, why: "let_go" | "failed") => void,
) {
  // The latest listen is the subscription's. An earlier one that was replaced stops without saying it ended.
  let generation = 0;
  let stopCurrent = () => {};
  let closed = false;
  let chain: Promise<B>;

  const listen = async (): Promise<B> => {
    const mine = ++generation;
    const bound = await open();
    const stream = bound.events();
    const iterator = stream[Symbol.asyncIterator]();
    const stop = () => {
      void iterator.return?.().catch((error) => console.error("session close:", error));
    };
    // Closed while the runtime was still opening: nothing is attached, and nothing may stay attached.
    if (closed) {
      stop();
      return bound;
    }
    stopCurrent = stop;
    void (async () => {
      // Both endings leave the renderer deaf: FastAgent closing its subscriber looks like a normal
      // `done`, and a silent one would keep the conversation running on screen forever. Only the
      // throw is a failure; a clean `done` is the runtime letting this subscriber go.
      let ending: { reason: string; why: "let_go" | "failed" } = { reason: "This conversation stopped receiving updates", why: "let_go" };
      try {
        for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
          if (mine === generation) forward(next.value);
        }
      } catch (error) {
        ending = { reason: String(error), why: "failed" };
      }
      if (mine === generation) end(ending.reason, ending.why);
    })();
    await stream.ready;
    return bound;
  };

  /** The newest runtime's conversation: a rebind that happened while an earlier listen was pending wins. */
  const settled = async (): Promise<B> => {
    for (;;) {
      const tail = chain;
      const bound = await tail;
      if (tail === chain) return bound;
    }
  };

  return {
    /** Rejects when the conversation cannot be opened; the caller owns that failure. */
    start(): Promise<B> {
      chain = listen();
      return settled();
    },
    /**
     * Listens again on the runtime that replaced the old one. It waits for a listen still opening, so
     * that one is closed rather than left attached to the old runtime. A subscription that cannot move
     * ends with the reason instead of going quiet.
     */
    async rebind(): Promise<void> {
      const previous = chain;
      chain = (async () => {
        await previous;
        stopCurrent();
        return listen();
      })();
      try {
        await chain;
      } catch (error) {
        close();
        end(String(error), "failed");
      }
    },
    /** Stops listening. No ending is reported: the one who closes it knows. */
    close,
  };

  function close(): void {
    closed = true;
    stopCurrent();
  }
}

/**
 * What a window hears about one of its subscriptions: what the runtime said, or that main ended it. The
 * second is duang's own lifecycle, not a session event, so it travels as itself rather than as a failure.
 */
export type Frame<E> = { agentId: string; session: string; subscription: string } & (
  | { event: E; ended?: never }
  | { event?: never; ended: { reason: string; why: Ending } }
);
/**
 * Why a subscription stopped: the runtime let this subscriber go (a backlog that overflowed, a runtime
 * replaced), which FastAgent's contract answers by listening again; duang ended it (the agent was removed);
 * or listening failed.
 */
export type Ending = "let_go" | "ended" | "failed";
/** A window, as its subscriptions see it. `post` drops a frame for a window that has gone. */
export interface Listener<E> {
  id: number;
  post(frame: Frame<E>): void;
}

/**
 * Every window's subscriptions, keyed by window and subscription id. The renderer keeps a background one
 * only while its turn runs, and closes the rest; main ends them when their window goes or their agent is
 * removed, and moves them when the agent's runtime is replaced.
 */
export function subscriptions<E, B extends { events(): EventStream<E> }>(
  /** The conversation on its agent's current runtime. */
  conversation: (agentId: string, session: string) => Promise<B>,
) {
  type Slot = { window: number; agentId: string; following: ReturnType<typeof follow<E, B>>; end(reason: string): void };
  const slots = new Map<string, Slot>();
  const stop = (key: string) => {
    const slot = slots.get(key);
    slots.delete(key);
    slot?.following.close();
  };
  return {
    /**
     * Listens to a conversation for a window, then answers with it, so its history is read after the
     * subscription exists and nothing falls between. The same subscription id opened again replaces the
     * first, which stops being heard, and whose open, if still under way, rejects. A conversation that
     * cannot be opened rejects and leaves nothing attached.
     */
    async open(window: Listener<E>, agentId: string, session: string, subscription: string): Promise<B> {
      const key = `${window.id}/${subscription}`;
      stop(key);
      // Only the subscription in the table is heard: one replaced or closed says nothing more.
      const post = (frame: Omit<Frame<E>, "agentId" | "session" | "subscription">) => {
        if (slots.get(key) === slot) window.post({ agentId, session, subscription, ...frame } as Frame<E>);
      };
      const following = follow<E, B>(
        async () => {
          const bound = await conversation(agentId, session);
          if (slots.get(key) !== slot) throw new Error("Conversation open was superseded");
          return bound;
        },
        (event) => post({ event }),
        (reason, why) => {
          post({ ended: { reason, why } });
          if (slots.get(key) === slot) slots.delete(key);
        },
      );
      // In the table before the runtime opens, which is what the check above compares against.
      const slot: Slot = { window: window.id, agentId, following, end: (reason) => post({ ended: { reason, why: "ended" } }) };
      slots.set(key, slot);
      try {
        return await following.start();
      } catch (error) {
        if (slots.get(key) === slot) stop(key);
        throw error;
      }
    },
    /** The renderer let it go: nothing is reported, the one who closed it knows. */
    close: (window: number, subscription: string) => stop(`${window}/${subscription}`),
    /** A window closed or reloaded: its subscriptions go with it, its runs do not. */
    closeWindow(window: number) {
      for (const [key, slot] of slots) if (slot.window === window) stop(key);
    },
    /**
     * The agent's runtime was replaced: each of its subscriptions listens again on the new one under the same
     * id, and the window sees nothing. One that cannot ends with the reason, like any other that stops.
     */
    async rebindAgent(agentId: string): Promise<void> {
      await Promise.all([...slots.values()].filter((slot) => slot.agentId === agentId).map((slot) => slot.following.rebind()));
    },
    /** Cutting an agent's subscriptions is invisible to the window unless each one says why it ended. */
    endAgent(agentId: string, reason: string) {
      for (const [key, slot] of slots)
        if (slot.agentId === agentId) {
          slot.end(reason);
          stop(key);
        }
    },
  };
}

// A subscription outlives the runtime it listens on: `rebind` moves it to the agent's new runtime without a
// gap. No Electron import, so the orderings are testable.

interface EventStream<E> extends AsyncIterable<E> {
  ready: Promise<unknown>;
}

export function follow<E, B extends { events(): EventStream<E> }>(
  open: () => Promise<B>,
  forward: (event: E) => void,
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
      // FastAgent closing its subscriber looks like a clean `done`, and silence would leave the conversation
      // running on screen, so both endings are reported; only a throw is a failure.
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
    start(): Promise<B> {
      chain = listen();
      return settled();
    },
    // Waits for a listen still opening, so it is closed rather than left on the old runtime.
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
    close,
  };

  function close(): void {
    closed = true;
    stopCurrent();
  }
}

export type Frame<E> = { agentId: string; session: string; subscription: string } & (
  | { event: E; ended?: never }
  | { event?: never; ended: { reason: string; why: Ending } }
);
// let_go: the runtime dropped this subscriber (FastAgent's contract: listen again). ended: duang ended it.
export type Ending = "let_go" | "ended" | "failed";
export interface Listener<E> {
  id: number;
  post(frame: Frame<E>): void;
}

export function subscriptions<E, B extends { events(): EventStream<E> }>(
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
    // History is read after the subscription exists, so nothing falls between.
    async open(window: Listener<E>, agentId: string, session: string, subscription: string): Promise<B> {
      const key = `${window.id}/${subscription}`;
      stop(key);
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
    close: (window: number, subscription: string) => stop(`${window}/${subscription}`),
    // The window's runs outlive it.
    closeWindow(window: number) {
      for (const [key, slot] of slots) if (slot.window === window) stop(key);
    },
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

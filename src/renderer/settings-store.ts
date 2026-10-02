/**
 * The Settings page's state and actions: the network choice and the route it gives, the connection check,
 * the avatar style, the model providers and the one sign-in that may be running. Its fields are part of the
 * store's one `View` (`store.ts`), which publishes them; they are kept here because none of them touches an
 * agent's conversations.
 */
import type {
  AvatarStyle,
  DuangApi,
  LoginOutcome,
  LoginStep,
  Network,
  ProviderRow,
  ProviderUsage,
  Route,
} from "../preload/index.ts";
import { message } from "./message.ts";

export type Connection = { checking: true } | { status: number; ms: number } | { error: string; code?: string };
type Shown<T extends LoginStep["type"]> = Omit<Extract<LoginStep, { type: T }>, "type">;
/**
 * One sign-in as its provider's row shows it: the provider and way chosen, what the flow asks now, the latest
 * of each kind of thing it reported, and its outcome once it ends. A cancelled flow is simply gone.
 */
export interface SignIn {
  provider: ProviderRow;
  way: ProviderRow["ways"][number];
  prompt?: Shown<"prompt">;
  /** The sign-in page. Its `instructions` and the flow's `progress` are words for a terminal, not kept. */
  url?: { url: string };
  device?: Shown<"device_code">;
  info?: Shown<"info">;
  /** Answers sent to a key prompt so far: a key prompt asked again after one means it was refused. */
  keyAnswers: number;
  /** What the last answer was to, so a key being checked is told from any other wait. */
  answered?: NonNullable<SignIn["prompt"]>["prompt"]["type"];
  outcome?: Exclude<LoginOutcome, { cancelled: true }>;
}

/**
 * Where a key sign-in is, which the flow says only in words meant for a terminal: asking for the
 * key, asking again because it was refused, or checking the one just sent. Decided by the question
 * on screen and the last one answered, never by the count alone: a flow may ask other things after
 * the key (Cloudflare's account ID) or start over at a choice (Vertex, Bedrock), and those are
 * questions of their own, not a refused key.
 */
export function keyStep(signIn: SignIn): "ask" | "refused" | "checking" | undefined {
  if (signIn.way.method !== "api_key" || signIn.outcome) return undefined;
  if (signIn.prompt) return signIn.prompt.prompt.type !== "secret" ? undefined : signIn.keyAnswers > 0 ? "refused" : "ask";
  return signIn.answered === "secret" ? "checking" : undefined;
}

export interface SettingsView {
  /** The Settings page: the saved network choice and the route it gives, read each time it opens. */
  settings?: { network: Network; route: Route };
  /** Why the settings file could not be read. The page says so rather than show the defaults. */
  settingsError?: string;
  /** How avatars are drawn, from the settings file; the default until it has been read. */
  avatar: AvatarStyle;
  /** The last check of the model route, or the one still running. */
  connection?: Connection;
  /** Model providers in duang's credential file: undefined while reading. */
  providers?: ProviderRow[];
  /** Why they could not be read, or why a disconnect failed. The page says so, never "none". */
  providersError?: string;
  /** The sign-in in progress or just finished, shown in its provider's row in Settings. */
  signIn?: SignIn;
}
/** What Settings reads and writes of the whole view: its own fields, and the plan numbers a disconnect drops. */
type Shared = SettingsView & { usage: Record<string, { data?: ProviderUsage; error?: string }> };

export function createSettings(api: DuangApi, view: () => Shared, publish: (patch: Partial<Shared>) => void) {
  let pickerRequested = false;
  // A slow check for a route that has since changed must not land on the new one, nor an earlier
  // network choice's answer after a later one's.
  let connectionRequest = 0;
  let networkRequest = 0;

  /** A step belongs to the sign-in on screen; one arriving after it closed is dropped. */
  const onStep = (step: LoginStep) => {
    const s = view().signIn;
    if (!s || s.outcome) return;
    const next: SignIn = { ...s };
    if (step.type === "prompt") next.prompt = { id: step.id, prompt: step.prompt };
    else if (step.type === "dismiss") {
      if (s.prompt?.id === step.id) delete next.prompt;
    } else if (step.type === "auth_url") next.url = { url: step.url };
    else if (step.type === "device_code") {
      const { type: _type, ...device } = step;
      next.device = device;
    } else if (step.type === "info") next.info = { message: step.message, ...(step.links ? { links: step.links } : {}) };
    // `progress` narrates for a terminal what the row already says in its own words.
    else if (step.type === "progress") return;
    publish({ signIn: next });
  };
  /** The sign-in main is running for this window, until main says it has ended. */
  let login: Promise<LoginOutcome> | undefined;
  async function loadProviders() {
    try {
      publish({ providers: await api.listProviders(), providersError: undefined });
    } catch (error) {
      publish({ providers: undefined, providersError: message(error) });
    }
  }

  /**
   * One request over the model route. Asked after every read or change of the network, and from the
   * Settings page's refresh control; only the newest answer lands.
   */
  async function checkConnection() {
    const request = ++connectionRequest;
    publish({ connection: { checking: true } });
    try {
      const result = await api.testNetwork();
      if (request === connectionRequest) publish({ connection: result });
    } catch (error) {
      if (request === connectionRequest) publish({ connection: { error: message(error) } });
    }
  }

  return {
    /** Each step main reports of the running sign-in; the store registers it with its other listeners. */
    onStep,
    checkConnection,
    loadProviders,
    /**
     * Runs one sign-in to its end. Cancelling closes it with nothing written; success re-reads the
     * providers, whose models the picker then lists; any other end stays on screen with its reason.
     * Starting another replaces the one running: main runs one at a time and ends a cancelled flow
     * only once its callback server has closed, so this waits for that before starting.
     */
    async connect(provider: ProviderRow, way: ProviderRow["ways"][number]) {
      while (login) {
        void api.cancelLogin();
        await Promise.allSettled([login]);
      }
      publish({ signIn: { provider, way, keyAnswers: 0 } });
      const mine = (login = api.login(provider.id, way.method));
      let outcome: LoginOutcome;
      try {
        outcome = await mine;
      } catch (error) {
        outcome = { ok: false, error: message(error) };
      } finally {
        if (login === mine) login = undefined;
      }
      const shown = view().signIn;
      if (shown?.provider !== provider || shown.way !== way) return;
      if (!outcome.ok && outcome.cancelled) return publish({ signIn: undefined });
      const { prompt: _prompt, ...rest } = shown;
      publish({ signIn: { ...rest, outcome } });
      if (outcome.ok) await loadProviders();
    },
    /**
     * The answer leaves the renderer here, once; the prompt, and a typed secret with it, is cleared.
     * A blank answer is an answer: GitHub Copilot's "blank for github.com", Bedrock's "press Enter to
     * continue". Only a key cannot be blank.
     */
    async answerSignIn(value: string) {
      const s = view().signIn;
      const prompt = s?.prompt;
      if (!s || !prompt || (prompt.prompt.type === "secret" && !value)) return;
      const secret = prompt.prompt.type === "secret";
      publish({ signIn: { ...s, prompt: undefined, answered: prompt.prompt.type, keyAnswers: s.keyAnswers + (secret ? 1 : 0) } });
      await api.answerLogin(prompt.id, value);
    },
    /** Ends a running sign-in (it resolves as cancelled and leaves the row), or closes a finished one. */
    async closeSignIn() {
      const s = view().signIn;
      if (!s) return;
      if (s.outcome) return publish({ signIn: undefined });
      await api.cancelLogin();
    },
    /**
     * Opens a URL the sign-in reported. A browser that will not open is said in the sign-in's row, the
     * one place the person is looking, where Copy link is the way on for a sign-in page.
     */
    async openLoginUrl(url: string) {
      try {
        await api.openLoginUrl(url);
      } catch (error) {
        // Only a running sign-in's row offers these links; anywhere else a failure stays an error.
        const s = view().signIn;
        if (!s || s.outcome) throw error;
        publish({ signIn: { ...s, info: { message: `The browser did not open: ${message(error)}` } } });
      }
    },
    /** A reveal that fails is said where the providers' problems are. */
    async revealProviders() {
      try {
        await api.revealProviders();
      } catch (error) {
        publish({ providersError: message(error) });
      }
    },
    /**
     * Connecting from the model picker returns to it. The picker belongs to the composer, which is
     * not on screen while Settings is, so the request waits here until the composer takes it.
     */
    requestPicker() {
      pickerRequested = true;
    },
    takePickerRequest() {
      const requested = pickerRequested;
      pickerRequested = false;
      return requested;
    },
    async disconnect(provider: string) {
      try {
        await api.disconnect(provider);
      } catch (error) {
        return publish({ providersError: message(error) });
      }
      // The plan it paid for is gone: its numbers must not stay in the conversation header, which
      // asks again only when its provider, run or conversation changes.
      const { [provider]: _gone, ...usage } = view().usage;
      publish({ usage });
      await loadProviders();
    },
    /**
     * Read once per opening of the page, from nothing: a file fixed by hand shows up the next time it
     * opens, and nothing from the last visit is shown as current. Returns what was read, for the
     * page's form to start from.
     */
    async loadSettings(): Promise<{ network: Network; route: Route } | undefined> {
      publish({ settings: undefined, settingsError: undefined, connection: undefined });
      try {
        const [{ network, avatar }, route] = await Promise.all([api.getSettings(), api.getRoute()]);
        const settings = { network, route };
        publish({ settings, avatar });
        void checkConnection();
        return settings;
      } catch (error) {
        publish({ settingsError: message(error) });
      }
    },
    /** Saves how avatars are drawn. Returns why it failed, for the page that asked. */
    async setAvatar(avatar: AvatarStyle): Promise<string | undefined> {
      try {
        await api.setAvatar(avatar);
        publish({ avatar });
      } catch (error) {
        return message(error);
      }
    },
    /** Saves and applies a network choice. Returns why it failed, for the form that asked. */
    async setNetwork(network: Network): Promise<string | undefined> {
      const request = ++networkRequest;
      try {
        const route = await api.setNetwork(network);
        if (request !== networkRequest) return;
        publish({ settings: { network, route } });
        void checkConnection();
      } catch (error) {
        if (request === networkRequest) return message(error);
      }
    },
    /** The file to open when it cannot be read. A failure to reveal it is said where the read failure is. */
    async revealSettings() {
      try {
        await api.revealSettings();
      } catch (error) {
        publish({ settingsError: message(error) });
      }
    },
  };
}

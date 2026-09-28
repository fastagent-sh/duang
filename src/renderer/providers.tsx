/**
 * Settings → Model providers: what serves each provider now, and connecting one in place — a row
 * opens where it is, shows the ways in, then the sign-in itself (docs/ui.md §12b, docs/interaction.md
 * "Connecting model providers"). No dialog: the page stays the context, and what is connected stays
 * in view while something new is added.
 *
 * The sign-in is drawn by what it asks for — a browser, a device code, a key, a choice — never by
 * per-provider screens, and every name in it is pi's or FastAgent's own.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CaretDown, CaretRight, Check, Copy, DotsThree, Globe, Key, MagnifyingGlass, X } from "@phosphor-icons/react";
import type { DuangApi, ProviderRow } from "../preload/index.ts";
import type { SignIn, Store, View } from "./store.ts";
import { PlanUsage } from "./header.tsx";
import { Group, row } from "./settings.tsx";
import { Badge, Button } from "./ui.tsx";

type Way = ProviderRow["ways"][number];

/** Offered first, in this order: the providers most people connect. The rest wait under "More". */
const COMMON = ["anthropic", "openai-codex", "openai", "github-copilot", "google", "xai", "deepseek", "openrouter"];

/**
 * A provider is marked by its own logo on a neutral tile: names alone blur together (OpenAI, OpenAI
 * Codex, OpenRouter). The logos are LobeHub's static SVGs, vendored with their license
 * (provider-logos/LICENSE) for the providers pi offers.
 */
const svgs = import.meta.glob<string>("./provider-logos/*.svg", { eager: true, query: "?raw", import: "default" });
const LOGOS: Record<string, string> = {
  "amazon-bedrock": "bedrock-color", "ant-ling": "antgroup-color", anthropic: "anthropic",
  "azure-openai-responses": "azure-color", baseten: "baseten", cerebras: "cerebras-color",
  "cloudflare-ai-gateway": "cloudflare-color", "cloudflare-workers-ai": "cloudflare-color",
  deepseek: "deepseek-color", fireworks: "fireworks-color", "github-copilot": "githubcopilot",
  google: "gemini-color", "google-vertex": "vertexai-color", groq: "groq", huggingface: "huggingface-color",
  "kimi-coding": "kimi-color", meta: "meta-color", minimax: "minimax-color", "minimax-cn": "minimax-color",
  mistral: "mistral-color", moonshotai: "moonshot", "moonshotai-cn": "moonshot", nvidia: "nvidia-color",
  openai: "openai", "openai-codex": "codex", opencode: "opencode", "opencode-go": "opencode",
  openrouter: "openrouter", "qwen-token-plan": "qwen-color", "qwen-token-plan-cn": "qwen-color",
  "qwen-token-plan-individual": "qwen-color", together: "together-color", "vercel-ai-gateway": "vercel",
  xai: "xai", xiaomi: "xiaomimimo", "xiaomi-token-plan-ams": "xiaomimimo", "xiaomi-token-plan-cn": "xiaomimimo",
  "xiaomi-token-plan-sgp": "xiaomimimo", zai: "zai", "zai-coding-cn": "zai",
};

function ProviderMark({ provider, size = 32 }: { provider: ProviderRow; size?: number }) {
  const svg = svgs[`./provider-logos/${LOGOS[provider.id]}.svg`];
  const tile = "grid shrink-0 place-items-center rounded-[9px] bg-bg text-text ring-1 ring-stroke";
  // Without a logo, the same tile holds the name's initials, so every row keeps one shape.
  if (!svg)
    return (
      <span aria-hidden className={`${tile} font-semibold text-muted`} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>
        {provider.name.slice(0, 2)}
      </span>
    );
  return (
    <span
      aria-hidden
      // A vendored, static file from this repository: nothing in it comes from a provider or a person.
      dangerouslySetInnerHTML={{ __html: svg }}
      className={tile}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.56) }}
    />
  );
}

const methodName = (method: Way["method"]) => (method === "oauth" ? "subscription login" : "API key");

/** What serves it now, in the person's words: "Claude Pro/Max", "API key", "from GEMINI_API_KEY". */
function sources(provider: ProviderRow): string {
  const held =
    provider.stored === "oauth"
      ? [plan(provider.ways.find((way) => way.method === "oauth")) ?? "Subscription"]
      : provider.stored === "api_key"
        ? ["API key"]
        : [];
  return [...held, ...(provider.ambient ? [`from ${provider.ambient}`] : [])].join(" · ");
}

/** "Anthropic (Claude Pro/Max)" → "Claude Pro/Max": the plan, once the provider is already named. */
function plan(way: Way | undefined): string | undefined {
  return way ? /\(([^)]+)\)\s*$/.exec(way.label)?.[1] ?? undefined : undefined;
}

/** A way's own name, never the provider's again: the plan, "Subscription", "Sign in" or "API key". */
function wayTitle(way: Way): string {
  if (way.method === "api_key") return "API key";
  return plan(way) ?? (way.subscription ? "Subscription" : "Sign in");
}

/** A way's promise, short enough for one line beside its name. */
function wayBlurb(way: Way): string {
  if (way.method === "api_key") return "Pay as you go";
  return way.subscription ? "Sign in with your plan" : "Sign in in your browser";
}

export function ProvidersSection({
  view,
  store,
  onMenu,
  focusAdd,
  onConnected,
}: {
  view: View;
  store: Store;
  onMenu: DuangApi["menu"];
  /** Reached from the picker's "Connect a provider": the list of what can be added comes into view. */
  focusAdd?: boolean;
  onConnected: () => void;
}) {
  /** The one row that is open, in either card. */
  const [open, setOpen] = useState<string>();
  const [confirming, setConfirming] = useState<string>();
  const [landed, setLanded] = useState<{ id: string; unchecked: boolean }>();
  const [more, setMore] = useState(false);
  const [filter, setFilter] = useState("");
  const addCard = useRef<HTMLDivElement>(null);
  const signIn = view.signIn;

  useEffect(() => {
    void store.loadProviders();
    // Leaving Settings (⌘N reaches the window) must not leave a sign-in running where nobody sees it.
    return () => {
      if (store.getSnapshot().signIn) void store.closeSignIn();
    };
  }, [store]);
  // A subscription's plan windows, on its row: the place you would look to decide which plan to use.
  // Main keeps one answer per login for a few minutes, so opening Settings does not poll.
  const subscriptions = (view.providers ?? []).filter((p) => p.stored === "oauth").map((p) => p.id).join();
  useEffect(() => {
    for (const id of subscriptions ? subscriptions.split(",") : []) void store.loadUsage(id);
  }, [subscriptions, store]);
  useEffect(() => {
    if (focusAdd && view.providers) addCard.current?.scrollIntoView({ block: "start" });
  }, [focusAdd, view.providers !== undefined]);
  // A connection lands in the list above, briefly marked, and the row it came from closes.
  useEffect(() => {
    if (!signIn?.outcome?.ok) return;
    setLanded({ id: signIn.provider.id, unchecked: signIn.outcome.verified === "unknown" });
    // It moves to the list above, which may be scrolled away: follow it there.
    const id = signIn.provider.id;
    requestAnimationFrame(() =>
      document.querySelector(`#providers-heading ~ div [data-provider="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
    setOpen(undefined);
    void store.closeSignIn();
    // A new login is a new plan: main forgot the old one's usage, and so must the row.
    void store.loadUsage(id);
    onConnected();
  }, [signIn?.outcome]);
  useEffect(() => {
    if (!landed) return;
    const timer = setTimeout(() => setLanded(undefined), landed.unchecked ? 8000 : 4000);
    return () => clearTimeout(timer);
  }, [landed]);

  /**
   * One row open at a time, and closing a row ends what it was doing: a running sign-in is cancelled,
   * a finished one cleared. Opening another row closes this one, so nothing is ever locked.
   */
  const show = (id?: string) => {
    if (store.getSnapshot().signIn) void store.closeSignIn();
    setConfirming(undefined);
    setOpen(id);
  };
  const toggle = (id: string) => show(open === id ? undefined : id);
  const menu = async (provider: ProviderRow) => {
    const chosen = await onMenu(
      provider.stored
        ? [
            { id: "reconnect", label: "Reconnect…" },
            { id: "disconnect", label: "Disconnect" },
          ]
        : [{ id: "reconnect", label: "Connect…" }],
    );
    if (chosen === "reconnect") toggle(provider.id);
    if (chosen === "disconnect") {
      show(undefined);
      setConfirming(provider.id);
    }
  };

  const providers = view.providers ?? [];
  const connected = providers.filter((p) => p.stored || p.ambient);
  const addable = providers.filter((p) => !p.stored && !p.ambient);
  const common = COMMON.flatMap((id) => addable.filter((p) => p.id === id));
  const rest = addable.filter((p) => !COMMON.includes(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  const needle = filter.trim().toLowerCase();
  const found = needle ? addable.filter((p) => `${p.name} ${p.id}`.toLowerCase().includes(needle)) : undefined;

  const rowProps = (provider: ProviderRow) => ({
    provider,
    store,
    signIn: signIn?.provider.id === provider.id ? signIn : undefined,
    open: open === provider.id,
    onToggle: () => toggle(provider.id),
  });

  if (view.providersError)
    return (
      <Group id="providers-heading" title="Model providers">
        <div role="alert" className="space-y-2 px-4 py-3">
          <p className="text-danger whitespace-pre-wrap break-words">{view.providersError}</p>
          <div className="flex gap-2">
            <Button size={28} onClick={() => void store.revealProviders()}>
              Reveal in Finder
            </Button>
            <Button kind="ghost" size={28} onClick={() => void store.loadProviders()}>
              Retry
            </Button>
          </div>
        </div>
      </Group>
    );
  if (!view.providers)
    return (
      <Group id="providers-heading" title="Model providers">
        <p role="status" className="px-4 py-3 text-muted">
          Loading…
        </p>
      </Group>
    );

  return (
    <div className="space-y-6">
      <Group id="providers-heading" title="Model providers">
        {connected.length === 0 ? (
          <div className="px-4 py-3.5">
            <p>Connect a model to start working.</p>
            <p className="text-[12px] text-muted">Sign in with a plan you already pay for, or use an API key.</p>
          </div>
        ) : (
          connected.map((provider) =>
            confirming === provider.id ? (
              <ConfirmDisconnect
                key={provider.id}
                provider={provider}
                onCancel={() => setConfirming(undefined)}
                onConfirm={() => {
                  setConfirming(undefined);
                  void store.disconnect(provider.id);
                }}
              />
            ) : (
              <ProviderItem
                key={provider.id}
                {...rowProps(provider)}
                detail={sources(provider)}
                // Opened only by its menu: a connected row's own click would be one misclick from a reconnect.
                header={{
                  trailing: (
                    <>
                      {provider.stored === "oauth" && <PlanUsage plan={view.usage[provider.id]} brief />}
                      {landed?.id === provider.id && (
                        <Badge tone={landed.unchecked ? "warning" : "success"} className="enter">
                          {landed.unchecked ? "saved · key not checked" : "connected"}
                        </Badge>
                      )}
                      <Button
                        kind="ghost"
                        size={28}
                        aria-label={`Actions for ${provider.name}`}
                        title="Actions"
                        onClick={() => void menu(provider)}
                        icon={<DotsThree size={16} weight="bold" />}
                      />
                    </>
                  ),
                  togglable: false,
                }}
              />
            ),
          )
        )}
      </Group>

      <div ref={addCard}>
        <Group id="providers-add-heading" title="Add a provider">
          {/* Search heads the list: it covers every provider, not only the ones under "More". */}
          <label className={`${row} flex items-center gap-3 px-4 py-2`}>
            <span className="grid w-8 place-items-center text-muted">
              <MagnifyingGlass size={14} />
            </span>
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => {
                // A query is cleared first; only an empty field lets Escape leave Settings.
                if (event.key === "Escape" && filter) {
                  event.preventDefault();
                  setFilter("");
                }
              }}
              aria-label="Filter providers"
              placeholder="Search providers"
              className="h-7 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
            />
            {filter && (
              <Button kind="ghost" size={28} aria-label="Clear search" title="Clear" onClick={() => setFilter("")} icon={<X size={13} />} />
            )}
          </label>
          {(found ?? common).map((provider) => (
            <ProviderItem key={provider.id} {...rowProps(provider)} detail={offers(provider)} />
          ))}
          {found && found.length === 0 && <p className={`${row} px-4 py-3 text-muted`}>Nothing matches “{filter}”.</p>}
          {more && !found && rest.map((provider) => <ProviderItem key={provider.id} {...rowProps(provider)} detail={offers(provider)} />)}
          {/* Always the last row: what it adds appears above it, so it never sits inside the list. */}
          {!found && rest.length > 0 && (
            <button
              type="button"
              aria-expanded={more}
              onClick={() => setMore(!more)}
              className={`${row} flex w-full items-center gap-3 px-4 py-2.5 text-left text-muted hover:bg-hover`}
            >
              <span className="grid w-8 place-items-center">
                <CaretDown size={13} className={`transition-transform ${more ? "rotate-180" : ""}`} />
              </span>
              <span className="flex-1">{more ? "Show fewer" : "More providers"}</span>
              {!more && <span className="text-[12px] tabular-nums">{rest.length}</span>}
            </button>
          )}
        </Group>
      </div>
    </div>
  );
}

/** What a provider offers, before it is connected: its plan's name, and whether a key works. */
function offers(provider: ProviderRow): string {
  return provider.ways.map(wayTitle).join(" · ");
}

/**
 * One provider: a row that opens in place. Open, it shows the ways in and then the sign-in, inside the
 * same card, so the list around it stays where it was.
 */
function ProviderItem({
  provider,
  store,
  signIn,
  open,
  detail,
  header,
  onToggle,
}: {
  provider: ProviderRow;
  store: Store;
  signIn?: SignIn;
  open: boolean;
  detail: string;
  header?: { trailing: ReactNode; togglable: false };
  onToggle: () => void;
}) {
  // While it runs, the row says what it is doing rather than what it offers.
  const signingIn = signIn && !signIn.outcome ? plan(signIn.way) : undefined;
  const doing =
    signIn && !signIn.outcome
      ? signIn.way.method === "api_key"
        ? "Adding an API key"
        : signingIn
          ? `Signing in with ${signingIn}`
          : "Signing in"
      : undefined;
  const title = (
    <>
      <ProviderMark provider={provider} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{provider.name}</span>
        <span className="block truncate text-[12px] text-muted">{doing ?? detail}</span>
      </span>
    </>
  );
  return (
    <div data-provider={provider.id} className={`${row} ${open ? "bg-hover" : ""}`}>
      {/* Open, every row closes by its header, which is also how a sign-in is cancelled: no second Cancel. */}
      {header && !open ? (
        <div className="flex items-center gap-3 px-4 py-2.5">
          {title}
          {header.trailing}
        </div>
      ) : (
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${open ? "" : "hover:bg-hover"}`}
        >
          {title}
          <CaretRight size={13} className={`shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
      )}
      {open && (
        <div className="enter px-4 pt-1 pb-3.5 pl-[60px]">
          {signIn ? (
            <Flow signIn={signIn} store={store} />
          ) : (
            <Ways provider={provider} onChoose={(way) => void store.connect(provider, way)} />
          )}
        </div>
      )}
    </div>
  );
}

/** The ways in, side by side: a plan you already pay for, or a key. */
function Ways({ provider, onChoose }: { provider: ProviderRow; onChoose: (way: Way) => void }) {
  return (
    <div className="space-y-2">
      <div className={`grid gap-2 ${provider.ways.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
        {provider.ways.map((way) => (
          <button
            key={way.method}
            type="button"
            onClick={() => onChoose(way)}
            className="flex min-w-0 items-center gap-2.5 rounded-card bg-surface px-3 py-2 text-left ring-1 ring-stroke outline-none transition-shadow hover:ring-accent/60 focus-visible:ring-2 focus-visible:ring-accent/70"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-badge bg-accent-weak text-accent" aria-hidden>
              {way.method === "api_key" ? <Key size={15} /> : <Globe size={15} />}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium">{wayTitle(way)}</span>
              <span className="block truncate text-[12px] text-muted">{wayBlurb(way)}</span>
            </span>
          </button>
        ))}
      </div>
      {provider.stored && (
        // One credential per provider in the file: say so before it happens.
        <p className="text-[12px] text-muted">Connecting replaces the {methodName(provider.stored)} saved now.</p>
      )}
    </div>
  );
}

/** A disconnect, confirmed in the row it removes, with how far it reaches. */
function ConfirmDisconnect({ provider, onCancel, onConfirm }: { provider: ProviderRow; onCancel: () => void; onConfirm: () => void }) {
  const reach = provider.ambient
    ? `Requests will continue with ${provider.ambient}.`
    : "Conversations using it stop working until it is connected again.";
  return (
    <div data-provider={provider.id} role="alertdialog" aria-label={`Disconnect ${provider.name}`} className={`${row} flex items-center gap-3 px-4 py-2.5`}>
      <ProviderMark provider={provider} />
      <span className="min-w-0 flex-1">
        <span className="block">Disconnect {provider.name}?</span>
        <span className="block text-[12px] text-muted">{reach}</span>
      </span>
      <Button kind="ghost" size={28} onClick={onCancel} autoFocus>
        Cancel
      </Button>
      <Button kind="danger" loud size={28} onClick={onConfirm}>
        Disconnect
      </Button>
    </div>
  );
}

/** Shown for a moment after a copy: the control confirms, nothing else moves. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      kind="ghost"
      size={28}
      onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
      icon={copied ? <Check size={13} /> : <Copy size={13} />}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}

/**
 * A running or failed sign-in. Success leaves the row (see above).
 *
 * The flow's own words (`progress`, `info`) are written for a terminal — "verifying the key with
 * deepseek/deepseek-v4-pro…" — so the states the dialog can tell apart are said in its own words, and
 * the flow's text is kept only where it is the reason for something (docs/ui.md §9).
 */
function Flow({ signIn, store }: { signIn: SignIn; store: Store }) {
  const { url, device, info, prompt, outcome, provider } = signIn;
  if (outcome && !outcome.ok)
    return (
      <div role="alert" className="space-y-2.5">
        <Status tone="danger" title="Couldn't connect" detail={outcome.error} />
        <div className="flex gap-2 pl-6">
          <Button size={28} onClick={() => void store.connect(signIn.provider, signIn.way)}>
            Try again
          </Button>
          <Button kind="ghost" size={28} onClick={() => void store.closeSignIn()}>
            Back
          </Button>
        </div>
      </div>
    );

  if (url)
    return (
      <div className="space-y-3">
        <Status tone="waiting" title="Waiting for you to finish in your browser…" detail={`${new URL(url.url).host} opened in your browser.`} />
        <div className="flex flex-wrap items-center gap-2 pl-6">
          <Button size={28} onClick={() => void store.openLoginUrl(url.url)}>
            Open again
          </Button>
          <CopyButton text={url.url} label="Copy link" />
        </div>
        {info && <p className="pl-6 text-[12px] text-muted">{info.message}</p>}
        {prompt?.prompt.type === "manual_code" && (
          <details className="group pl-6 text-[12px]">
            <summary className="flex cursor-pointer select-none items-center gap-1 text-muted marker:content-none hover:text-text">
              <CaretRight size={11} className="transition-transform group-open:rotate-90" />
              Browser on another device?
            </summary>
            <div className="mt-2 space-y-2">
              {/* The flow says this twice, in two phrasings, both for a terminal. Once, in ours. */}
              <p className="text-muted">Finish signing in there, then paste the address the browser ends on, or the code it shows.</p>
              <Answer key={prompt.id} prompt={prompt.prompt} store={store} action="Continue" label="Address or code" labelHidden placeholder="Address or code" />
            </div>
          </details>
        )}
      </div>
    );

  if (device) return <DeviceCode device={device} store={store} />;

  if (signIn.way.method === "api_key" && (prompt?.prompt.type === "secret" || signIn.keyAnswers > 0)) {
    const refused = !!prompt && signIn.keyAnswers > 0;
    return (
      <div className="space-y-2">
        {refused && (
          <div role="alert" className="space-y-1">
            <Status tone="danger" title={`${provider.name} didn't accept this key`} detail="Check it and paste it again." />
            {info && (
              // The provider's own words, kept whole but folded: they are the reason, not the message.
              <details className="group pl-6 text-[12px]">
                <summary className="flex cursor-pointer select-none items-center gap-1 text-muted marker:content-none hover:text-text">
                  <CaretRight size={11} className="transition-transform group-open:rotate-90" />
                  What {provider.name} said
                </summary>
                <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[11.5px] text-muted">{info.message}</p>
              </details>
            )}
          </div>
        )}
        <KeyField promptId={prompt?.id} store={store} label={`${provider.name} API key`} />
      </div>
    );
  }

  if (prompt)
    return (
      <div className="space-y-2">
        <Answer key={prompt.id} prompt={prompt.prompt} store={store} action="Continue" />
        {info && <p className="text-[12px] text-muted">{info.message}</p>}
      </div>
    );

  // Between steps: before the first, or after an answer while the flow asks the provider for the next
  // (a device code, a sign-in link). Usually gone before it could be read, hence the delay.
  return (
    <div className="after-a-moment">
      <Status tone="waiting" title={`Connecting to ${provider.name}…`} />
    </div>
  );
}

/**
 * One line of state, with its detail under it: the mark sits in a column of its own so the detail lines
 * up with the words, not with the mark.
 */
function Status({ tone, title, detail }: { tone: "waiting" | "danger"; title: string; detail?: string }) {
  return (
    <div role={tone === "danger" ? undefined : "status"} className="grid grid-cols-[16px_1fr] items-baseline gap-x-2">
      <span className="flex h-full items-center justify-center" aria-hidden>
        <span className={`size-1.5 rounded-full ${tone === "danger" ? "bg-danger" : "animate-pulse bg-accent"}`} />
      </span>
      <span className={tone === "danger" ? "text-danger" : "shimmer"}>
        {title}
      </span>
      {detail && <span className="col-start-2 text-[12px] text-muted whitespace-pre-wrap break-words">{detail}</span>}
    </div>
  );
}

function DeviceCode({ device, store }: { device: NonNullable<SignIn["device"]>; store: Store }) {
  const [left, setLeft] = useState(device.expiresInSeconds);
  useEffect(() => {
    if (device.expiresInSeconds === undefined) return;
    const started = Date.now();
    const timer = setInterval(
      () => setLeft(Math.max(0, device.expiresInSeconds! - Math.floor((Date.now() - started) / 1000))),
      1000,
    );
    return () => clearInterval(timer);
  }, [device]);
  const host = new URL(device.verificationUri).host;
  return (
    <div className="space-y-3">
      <Status
        tone="waiting"
        title={`Enter this code at ${host}`}
        detail={left === undefined ? undefined : left > 0 ? `The code expires in ${Math.ceil(left / 60)} min.` : "The code expired. Close this and start again."}
      />
      <div className="flex flex-wrap items-center gap-2 pl-6">
        <span className="rounded-card bg-surface px-3 py-1 font-mono text-[20px] tracking-[0.18em] ring-1 ring-stroke select-all">
          {device.userCode}
        </span>
        <CopyButton text={device.userCode} label="Copy code" />
      </div>
      <div className="pl-6">
        <Button size={28} onClick={() => void store.openLoginUrl(device.verificationUri)}>
          Open {host}
        </Button>
      </div>
    </div>
  );
}

const fieldClass =
  "h-7 min-w-0 flex-1 rounded-card bg-surface px-2.5 text-[12.5px] outline-none ring-1 ring-stroke placeholder:font-sans placeholder:text-muted focus:ring-accent/60 disabled:opacity-60";

/**
 * The key, shown as typed so a paste can be checked by eye. One field for the whole exchange: it
 * keeps the key while it is checked and, when the provider refuses it, selects it for fixing or
 * replacing. It lives only as long as the row's sign-in; drafts never see it.
 */
function KeyField({ promptId, store, label }: { promptId?: string; store: Store; label: string }) {
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const checking = promptId === undefined;
  useEffect(() => {
    if (!checking) input.current?.select();
  }, [promptId, checking]);
  const submit = () => void store.answerSignIn(value.trim());
  return (
    <form
      className="space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="block text-[12px] text-muted" htmlFor="provider-key">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id="provider-key"
          ref={input}
          autoFocus
          disabled={checking}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Paste your key"
          className={`${fieldClass} font-mono`}
        />
        <Button kind="primary" size={28} onClick={submit} disabled={checking ? "Checking the key" : undefined}>
          {checking ? "Checking…" : "Connect"}
        </Button>
      </div>
    </form>
  );
}

/**
 * A question the flow asks: a key, a code, a line of text, or a choice. The store refuses a blank key;
 * a blank answer to anything else is sent as the flow asked (GitHub Copilot's "blank for github.com").
 */
function Answer({
  prompt,
  store,
  action,
  label,
  labelHidden,
  placeholder,
}: {
  prompt: NonNullable<SignIn["prompt"]>["prompt"];
  store: Store;
  action: string;
  /** Ours, when the flow's own words are written for a terminal. */
  label?: string;
  /** When the words around the field already say what it is for: kept for screen readers only. */
  labelHidden?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  if (prompt.type === "select")
    return (
      <div className="space-y-1.5">
        <p className="text-[12px] text-muted">{prompt.message}</p>
        <div className="overflow-hidden rounded-card bg-surface ring-1 ring-stroke">
          {prompt.options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => void store.answerSignIn(option.id)}
              className={`${row} flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-hover`}
            >
              <span className="min-w-0 flex-1">
                <span className="block">{option.label}</span>
                {option.description && <span className="block text-[12px] text-muted">{option.description}</span>}
              </span>
              <CaretRight size={12} className="shrink-0 text-muted" />
            </button>
          ))}
        </div>
      </div>
    );
  const submit = () => {
    void store.answerSignIn(value.trim());
    setValue("");
  };
  const text = label ?? prompt.message;
  const id = `answer-${text}`;
  return (
    <form
      className="space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className={labelHidden ? "sr-only" : "block text-[12px] text-muted"} htmlFor={id}>
        {text}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label={text}
          placeholder={placeholder ?? prompt.placeholder}
          // Typed values are keys, codes and addresses, read character by character; hints are prose.
          className={`${fieldClass} font-mono`}
        />
        <Button kind="primary" size={28} onClick={submit}>
          {action}
        </Button>
      </div>
    </form>
  );
}

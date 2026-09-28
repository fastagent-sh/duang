/**
 * Settings → Model providers: what serves each provider now, and a dialog that connects one into
 * duang's own credential file (docs/interaction.md, "Connecting model providers").
 *
 * The dialog is drawn by what the sign-in asks for — a browser, a device code, a key, a choice — never
 * by per-provider screens, and every name in it is pi's or FastAgent's own.
 */
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Copy, X } from "@phosphor-icons/react";
import type { ProviderRow } from "../preload/index.ts";
import type { SignIn, Store, View } from "./store.ts";
import { Group, row } from "./settings.tsx";
import { Button } from "./ui.tsx";

type Way = ProviderRow["ways"][number];

/** Listed first: the providers most people connect. Everything else follows alphabetically. */
const COMMON = ["anthropic", "openai-codex", "openai", "github-copilot", "google", "xai", "deepseek", "openrouter"];

const methodName = (method: Way["method"]) => (method === "oauth" ? "subscription login" : "API key");

/** "Subscription (OAuth)" or "API key", and where else a credential comes from. */
function sources(provider: ProviderRow): string {
  const held = provider.stored ? [provider.stored === "oauth" ? "Subscription" : "API key"] : [];
  return [...held, ...(provider.ambient ? [provider.ambient] : [])].join(" · ");
}

export function ProvidersGroup({
  view,
  store,
  connectOnOpen,
  onConnected,
}: {
  view: View;
  store: Store;
  /** Opened from the picker's "Connect a provider": the dialog comes up straight away. */
  connectOnOpen?: boolean;
  onConnected: () => void;
}) {
  const [dialog, setDialog] = useState<{ provider?: ProviderRow } | undefined>(connectOnOpen ? {} : undefined);
  useEffect(() => {
    void store.loadProviders();
  }, [store]);
  const connected = (view.providers ?? []).filter((p) => p.stored || p.ambient);

  const disconnect = (provider: ProviderRow) => {
    const reach = provider.ambient
      ? `Requests will continue with ${provider.ambient}.`
      : `Conversations using ${provider.name} fail on their next request.`;
    // The file is duang's alone, so this never reaches the fastagent CLI's or pi's logins.
    if (confirm(`Disconnect ${provider.name}? This removes its ${methodName(provider.stored!)} from duang only. ${reach}`))
      void store.disconnect(provider.id);
  };

  return (
    <>
      <Group id="providers-heading" title="Model providers">
        {view.providersError ? (
          <div role="alert" className={`${row} space-y-2 px-4 py-2.5`}>
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
        ) : !view.providers ? (
          <p role="status" className={`${row} px-4 py-2.5 text-muted`}>
            Loading…
          </p>
        ) : (
          connected.map((provider) => (
            <div key={provider.id} className={`${row} flex items-center gap-3 px-4 py-2.5`}>
              <span className="min-w-0 flex-1">
                <span className="block">{provider.name}</span>
                <span className="block text-[12px] text-muted">{sources(provider)}</span>
              </span>
              {/* Served only by a variable, it is not connected in duang yet. */}
              <Button kind="ghost" size={28} onClick={() => setDialog({ provider })}>
                {provider.stored ? "Reconnect" : "Connect"}
              </Button>
              {/* A variable is not duang's to remove; only what duang's file holds can be disconnected. */}
              {provider.stored && (
                <Button kind="danger" size={28} onClick={() => disconnect(provider)}>
                  Disconnect
                </Button>
              )}
            </div>
          ))
        )}
        {view.providers && (
          <button
            type="button"
            onClick={() => setDialog({})}
            className={`${row} flex w-full items-center px-4 py-2.5 text-left text-accent hover:bg-hover`}
          >
            Connect a provider…
          </button>
        )}
      </Group>
      <p className="-mt-4 px-4 text-[12px] text-muted">
        Kept in duang's own credential file, not shared with the fastagent CLI.{" "}
        <button type="button" className="underline" onClick={() => void store.revealProviders()}>
          Show file
        </button>
      </p>
      {dialog && view.providers && (
        <ConnectDialog
          view={view}
          store={store}
          providers={view.providers}
          start={dialog.provider}
          onClose={(connected) => {
            setDialog(undefined);
            if (connected) onConnected();
          }}
        />
      )}
    </>
  );
}

/** Choose a provider, then a way, then follow the sign-in until it ends. */
function ConnectDialog({
  view,
  store,
  providers,
  start,
  onClose,
}: {
  view: View;
  store: Store;
  providers: ProviderRow[];
  start?: ProviderRow;
  onClose: (connected: boolean) => void;
}) {
  const [chosen, setChosen] = useState<ProviderRow | undefined>(start);
  const [filter, setFilter] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const signIn = view.signIn;

  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    el.querySelector<HTMLElement>("input, button[data-first]")?.focus();
    return () => el.close();
  }, []);

  const connect = (provider: ProviderRow, way: Way) => void store.connect(provider, way);
  const choose = (provider: ProviderRow) => {
    // One way in: no question to ask.
    if (provider.ways.length === 1) connect(provider, provider.ways[0]!);
    else setChosen(provider);
  };
  /** Escape, Cancel and the close button all close the dialog; a running flow ends with nothing written. */
  const dismiss = () => {
    const connected = signIn?.outcome?.ok === true;
    void store.closeSignIn().then(() => onClose(connected));
  };

  const order = (p: ProviderRow) => (COMMON.includes(p.id) ? COMMON.indexOf(p.id) : COMMON.length);
  const listed = providers
    .filter((p) => `${p.name} ${p.id}`.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));

  return (
    <dialog
      ref={dialog}
      aria-label="Connect a provider"
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }}
      // The modal owns Escape while it is open: behind it, Escape leaves Settings.
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
      className="popover m-auto w-[420px] max-h-[70vh] overflow-y-auto p-3 text-text backdrop:bg-black/20"
    >
      <div className="mb-2 flex items-center gap-2">
        {chosen && !signIn && !start && (
          <Button kind="ghost" size={28} onClick={() => setChosen(undefined)} aria-label="Back" icon={<ArrowLeft size={14} />} />
        )}
        <span className="flex-1 text-[13px] font-semibold">
          {signIn ? signIn.way.label : chosen ? chosen.name : "Connect a provider"}
        </span>
        <Button kind="ghost" size={28} onClick={dismiss} aria-label="Close" icon={<X size={14} />} />
      </div>

      {signIn ? (
        <Flow
          signIn={signIn}
          store={store}
          onRetry={() => connect(signIn.provider, signIn.way)}
          onBack={() => {
            void store.closeSignIn();
            setChosen(signIn.provider.ways.length > 1 ? signIn.provider : undefined);
          }}
          onDone={dismiss}
          onCancel={dismiss}
        />
      ) : chosen ? (
        <div className="space-y-1">
          {chosen.ways.map((way, index) => (
            <button
              key={way.method}
              type="button"
              data-first={index === 0 ? "" : undefined}
              onClick={() => connect(chosen, way)}
              className="block w-full rounded-card px-2.5 py-2 text-left hover:bg-hover"
            >
              <span className="block">{way.label}</span>
              <span className="block text-[12px] text-muted">
                {way.method === "oauth" ? "Sign in in your browser" : "Paste a key; it is checked once"}
                {/* One credential per provider in the file: say so before it happens. */}
                {chosen.stored && ` · replaces the ${methodName(chosen.stored)} saved for ${chosen.name}`}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            aria-label="Filter providers"
            placeholder="filter providers"
            className="mb-1.5 h-8 w-full rounded-card bg-bg px-2.5 text-[12px] outline-none ring-1 ring-stroke placeholder:text-muted focus:ring-accent/60"
          />
          <div className="space-y-0.5">
            {listed.map((provider) => (
              <button
                key={provider.id}
                type="button"
                onClick={() => choose(provider)}
                className="flex w-full items-baseline gap-2 rounded-card px-2.5 py-1.5 text-left hover:bg-hover"
              >
                <span className="min-w-0 flex-1 truncate">{provider.name}</span>
                <span className="shrink-0 text-[11px] text-muted">
                  {provider.ways.map((way) => (way.method === "oauth" ? "subscription" : "API key")).join(" · ")}
                  {provider.stored && " · connected"}
                </span>
              </button>
            ))}
            {listed.length === 0 && <p className="px-2.5 py-1.5 text-[11px] text-muted">Nothing matches.</p>}
          </div>
        </>
      )}
    </dialog>
  );
}

/** A running or finished sign-in, by what it reports and asks. */
function Flow({
  signIn,
  store,
  onRetry,
  onBack,
  onDone,
  onCancel,
}: {
  signIn: SignIn;
  store: Store;
  onRetry: () => void;
  onBack: () => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { url, device, info, progress, prompt, outcome } = signIn;
  if (outcome?.ok)
    return (
      <div className="space-y-3">
        <p role="status">Connected {signIn.way.label}.</p>
        {outcome.verified === "unknown" && (
          <p className="text-[12px] text-warning">The key could not be checked just now. It was saved anyway.</p>
        )}
        <div className="flex justify-end">
          <Button kind="primary" onClick={onDone} data-first="">
            Done
          </Button>
        </div>
      </div>
    );
  if (outcome)
    return (
      <div role="alert" className="space-y-3">
        <p className="text-danger whitespace-pre-wrap break-words">{outcome.error}</p>
        <div className="flex justify-end gap-2">
          <Button kind="ghost" onClick={onBack}>
            Back
          </Button>
          <Button onClick={onRetry}>Try again</Button>
        </div>
      </div>
    );
  return (
    <div className="space-y-3">
      {url && (
        <div className="space-y-2">
          <p>Continue in your browser.{url.instructions ? ` ${url.instructions}` : ""}</p>
          <div className="flex gap-2">
            <Button size={28} onClick={() => void store.openLoginUrl(url.url)}>
              Open again
            </Button>
            <Button kind="ghost" size={28} onClick={() => void navigator.clipboard.writeText(url.url)} icon={<Copy size={13} />}>
              Copy link
            </Button>
          </div>
        </div>
      )}
      {device && <DeviceCode device={device} store={store} />}
      {info && (
        <p className="text-[12px] text-muted">
          {info.message}{" "}
          {info.links?.map((link) => (
            <button key={link.url} type="button" className="underline" onClick={() => void store.openLoginUrl(link.url)}>
              {link.label ?? link.url}
            </button>
          ))}
        </p>
      )}
      {prompt && <Question key={prompt.id} prompt={prompt.prompt} folded={Boolean(url)} store={store} />}
      {progress && (
        <p role="status" className="text-[12px] text-muted">
          {progress}
        </p>
      )}
      {!prompt && !url && !device && !progress && (
        <p role="status" className="text-muted">
          Starting…
        </p>
      )}
      <div className="flex justify-end">
        <Button kind="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
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
  return (
    <div className="space-y-2">
      <p>Enter this code on the verification page:</p>
      <p className="font-mono text-[22px] tracking-widest select-text">{device.userCode}</p>
      <div className="flex items-center gap-2">
        <Button size={28} onClick={() => void store.openLoginUrl(device.verificationUri)}>
          Open verification page
        </Button>
        <Button kind="ghost" size={28} onClick={() => void navigator.clipboard.writeText(device.userCode)} icon={<Copy size={13} />}>
          Copy code
        </Button>
        {left !== undefined && (
          <span className="text-[12px] text-muted tabular-nums">{left > 0 ? `expires in ${left}s` : "expired"}</span>
        )}
      </div>
    </div>
  );
}

/**
 * What the flow asks. A pasted code beside a browser sign-in is folded: it is for a browser on another
 * device, and it disappears on its own if the browser's callback wins.
 */
function Question({
  prompt,
  folded,
  store,
}: {
  prompt: NonNullable<SignIn["prompt"]>["prompt"];
  folded: boolean;
  store: Store;
}) {
  const [value, setValue] = useState("");
  // The store refuses a blank key; a blank answer to anything else is sent as the flow asked.
  const submit = () => {
    void store.answerSignIn(value.trim());
    setValue("");
  };
  if (prompt.type === "select")
    return (
      <div className="space-y-1">
        <p>{prompt.message}</p>
        {prompt.options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => void store.answerSignIn(option.id)}
            className="block w-full rounded-card px-2.5 py-1.5 text-left hover:bg-hover"
          >
            <span className="block">{option.label}</span>
            {option.description && <span className="block text-[12px] text-muted">{option.description}</span>}
          </button>
        ))}
      </div>
    );
  const field = (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input
        autoFocus={!folded}
        // A key never lands in a draft or on screen.
        type={prompt.type === "secret" ? "password" : "text"}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-label={prompt.message}
        placeholder={prompt.placeholder}
        className="h-8 min-w-0 flex-1 rounded-card bg-bg px-2.5 font-mono text-[12px] outline-none ring-1 ring-stroke placeholder:text-muted focus:ring-accent/60"
      />
      <Button kind="primary" size={28} onClick={submit}>
        {prompt.type === "secret" ? "Save" : "Continue"}
      </Button>
    </form>
  );
  if (folded && prompt.type === "manual_code")
    return (
      <details className="text-[12px]">
        <summary className="cursor-pointer text-muted">Browser on another device? Paste the code or redirect URL</summary>
        <div className="mt-2 space-y-1">
          <p className="text-muted">{prompt.message}</p>
          {field}
        </div>
      </details>
    );
  return (
    <div className="space-y-1.5">
      <p>{prompt.message}</p>
      {field}
    </div>
  );
}

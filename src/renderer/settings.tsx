/**
 * duang's own preferences, in the content area so the sidebar — and whatever is running in it — stays
 * in view. One group today: the network route. Model providers join when in-app sign-in exists
 * (fastagent#602); an empty group would promise something that is not there.
 *
 * Drawn the way Telegram draws its settings (docs/ui.md §12b): a small-caps heading over an inset
 * card, rows divided by hairlines that start where the text does, the choice marked by a trailing
 * check, and the connection's state written on the chosen row instead of behind a button.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowClockwise, Check, X } from "@phosphor-icons/react";
import type { DuangApi, Network, Route } from "../preload/index.ts";
import { message } from "./store.ts";
import { Button } from "./ui.tsx";
import { KINDS, manualUrl, type Scheme } from "./network.ts";

const MAC = typeof navigator !== "undefined" && navigator.platform.startsWith("Mac");

/** "via http://127.0.0.1:7897 · macOS settings", "Direct · off". */
export function routeLabel(route: Route): string {
  const where = route.proxy ? `via ${route.proxy}` : "Direct";
  const why = {
    system: MAC ? "macOS settings" : "system settings",
    environment: route.variable ?? "launch environment",
    manual: "manual",
    off: "off",
  }[route.source];
  return `${where} · ${why}`;
}

type Check = { checking: true } | { status: number; ms: number } | { error: string };

export function Settings({ api, onClose }: { api: DuangApi; onClose: () => void }) {
  const [saved, setSaved] = useState<{ network: Network; route: Route }>();
  const [readError, setReadError] = useState<string>();
  const [mode, setMode] = useState<Network["mode"]>("automatic");
  const [scheme, setScheme] = useState<Scheme>("http");
  const [server, setServer] = useState("");
  const [port, setPort] = useState("");
  const [problem, setProblem] = useState<string>();
  const [check, setCheck] = useState<Check>();
  // A slow answer for a route that has since changed must not land on the new one.
  const checks = useRef(0);

  const runCheck = async () => {
    const id = ++checks.current;
    setCheck({ checking: true });
    try {
      const result = await api.testNetwork();
      if (id === checks.current) setCheck(result);
    } catch (error) {
      if (id === checks.current) setCheck({ error: message(error) });
    }
  };
  const load = () =>
    api.getSettings().then(
      (settings) => {
        setSaved(settings);
        setReadError(undefined);
        setMode(settings.network.mode);
        if (settings.network.mode === "manual") {
          const url = new URL(settings.network.url);
          setScheme(url.protocol.slice(0, -1) as Scheme);
          setServer(url.hostname);
          setPort(url.port);
        }
        void runCheck();
      },
      (error) => setReadError(message(error)),
    );
  useEffect(() => {
    // Once per opening: a file fixed by hand shows up the next time the page opens, or on Retry.
    void load();
  }, []);

  const apply = async (network: Network) => {
    setProblem(undefined);
    try {
      const route = await api.setNetwork(network);
      setSaved({ network, route });
      void runCheck();
    } catch (error) {
      setProblem(message(error));
    }
  };
  const choose = (next: Network["mode"]) => {
    setMode(next);
    setProblem(undefined);
    // Manual is complete only once it has a proxy; a saved one is reused as it was.
    if (next !== "manual") void apply({ mode: next });
    else if (saved?.network.mode === "manual") void apply(saved.network);
  };
  const saveManual = () => {
    const result = manualUrl(scheme, server, port);
    if ("error" in result) setProblem(result.error);
    else void apply({ mode: "manual", url: result.url });
  };

  const current = saved?.network.mode;
  const savedManual = saved?.network.mode === "manual" ? saved.network.url : undefined;
  const state = (option: Network["mode"]) =>
    option === current && saved ? (
      <Status route={saved.route} check={check} onRefresh={() => void runCheck()} />
    ) : undefined;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-[600px] px-6 pt-6 pb-10">
        <div className="flex items-center gap-2 mb-6">
          <h1 className="flex-1 text-[20px] font-medium drag">Settings</h1>
          <Button kind="ghost" size={28} onClick={onClose} aria-label="Close settings" title="Close (Esc)" icon={<X size={14} />} />
        </div>

        {readError ? (
          <div role="alert" className="space-y-3">
            <p className="text-danger whitespace-pre-wrap break-words">{readError}</p>
            <p className="text-muted text-[12px]">
              Fix or remove the file, then retry. Until then the network follows the system proxy.
            </p>
            <div className="flex gap-2">
              <Button onClick={() => void api.revealSettings()}>Reveal in Finder</Button>
              <Button kind="ghost" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          </div>
        ) : !saved ? (
          <p role="status" className="text-muted">
            Loading…
          </p>
        ) : (
          <div className="space-y-6">
            <Group
              id="network-heading"
              title="Network"
              footer={
                <>
                  How model, sign-in and usage requests reach the internet. Changes apply to new requests; a
                  running turn keeps its connection. Agent commands such as git, npm and curl get the same proxy
                  through <code>HTTPS_PROXY</code> and its siblings, loopback direct.
                  {saved.route.source === "environment" && (
                    <>
                      {" "}
                      duang was launched with {saved.route.variable} set, so Automatic uses it and follows no system
                      change until duang is relaunched from the Dock or Finder.
                    </>
                  )}
                </>
              }
            >
              <div role="radiogroup" aria-label="Proxy">
                <Option label="Automatic" checked={mode === "automatic"} onSelect={() => choose("automatic")}>
                  {state("automatic") ?? `Follow ${MAC ? "macOS" : "system"} proxy settings, including a VPN switched on later`}
                </Option>
                <Option label="Manual" checked={mode === "manual"} onSelect={() => choose("manual")}>
                  {state("manual") ?? savedManual ?? "Not set"}
                </Option>
                <Option label="Off" checked={mode === "off"} onSelect={() => choose("off")}>
                  {state("off") ?? "Connect directly"}
                </Option>
              </div>
            </Group>

            {mode === "manual" && (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveManual();
                }}
              >
                <Group title="Manual proxy">
                  <div role="radiogroup" aria-label="Proxy type">
                    {KINDS.map((kind) => (
                      <Option key={kind.scheme} label={kind.label} checked={scheme === kind.scheme} onSelect={() => setScheme(kind.scheme)} />
                    ))}
                  </div>
                </Group>
                <Group>
                  <Field label="Server" value={server} onChange={setServer} placeholder="127.0.0.1" />
                  <Field label="Port" value={port} onChange={setPort} placeholder="7890" inputMode="numeric" />
                </Group>
                <div className="flex items-start gap-3 px-4">
                  <p role={problem ? "alert" : undefined} className={`flex-1 text-[12px] ${problem ? "text-danger" : "text-muted"}`}>
                    {problem ?? "Proxy authentication is not supported yet."}
                  </p>
                  {/* A hidden submit keeps Enter working in either field; Button forces type="button". */}
                  <button type="submit" hidden />
                  <Button kind="primary" onClick={saveManual}>
                    Use this proxy
                  </Button>
                </div>
              </form>
            )}
            {mode !== "manual" && problem && (
              <p role="alert" className="px-4 text-danger text-[12px]">
                {problem}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** A small-caps heading, an inset card, a muted footnote. */
function Group({ id, title, footer, children }: { id?: string; title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-1.5">
      {title && (
        <h2 id={id} className="px-4 text-[11px] font-medium uppercase tracking-[0.05em] text-muted">
          {title}
        </h2>
      )}
      <div className="overflow-hidden rounded-float bg-surface ring-1 ring-stroke">{children}</div>
      {footer && <p className="px-4 text-[12px] leading-relaxed text-muted">{footer}</p>}
    </section>
  );
}

/** Rows are divided by a hairline that starts where the text does, as in Telegram's lists. */
const row =
  "relative before:absolute before:left-4 before:right-0 before:top-0 before:h-px before:bg-stroke first:before:hidden";

function Option({
  label,
  checked,
  onSelect,
  children,
}: {
  label: string;
  checked: boolean;
  onSelect: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      role="radio"
      aria-checked={checked}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`${row} flex cursor-pointer items-center gap-3 px-4 py-2.5 outline-none hover:bg-hover focus-visible:bg-hover`}
    >
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        {children && <span className="block text-[12px] text-muted">{children}</span>}
      </span>
      {checked && <Check size={16} weight="bold" className="shrink-0 text-accent" aria-hidden />}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputMode?: "numeric";
}) {
  return (
    <label className={`${row} flex items-center gap-3 px-4 py-2.5`}>
      <span className="w-16 shrink-0">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        placeholder={placeholder}
        inputMode={inputMode}
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] outline-none placeholder:text-muted"
      />
    </label>
  );
}

/** "ECONNREFUSED" from main's "host via proxy: ECONNREFUSED: connect …", when there is one. */
const errorCode = (error: string) => /: ([A-Z][A-Z_]+):/.exec(error)?.[1];

/** The chosen row's second line: where requests go, and whether they get there. */
function Status({ route, check, onRefresh }: { route: Route; check?: Check; onRefresh: () => void }) {
  const result = !check
    ? null
    : "checking" in check
      ? <span>checking…</span>
      : "error" in check
        ? (
            // The row already says which route; the cause's code is what fits beside it, and the
            // whole sentence is one hover away.
            <span className="text-danger" title={check.error}>
              unreachable{errorCode(check.error) ? ` (${errorCode(check.error)})` : ""}
            </span>
          )
        : <span className="text-accent" title={`api.anthropic.com answered HTTP ${check.status}`}>connected · {check.ms} ms</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-1.5">
      <span className="font-mono">{routeLabel(route)}</span>
      {result && <span aria-hidden>·</span>}
      <span role="status">{result}</span>
      <button
        type="button"
        onClick={(event) => {
          // The row itself is the choice; refreshing must not re-apply it.
          event.stopPropagation();
          onRefresh();
        }}
        aria-label="Check the connection again"
        title="Check again"
        className="rounded-badge p-0.5 text-muted hover:text-text hover:bg-hover"
      >
        <ArrowClockwise size={12} aria-hidden />
      </button>
    </span>
  );
}

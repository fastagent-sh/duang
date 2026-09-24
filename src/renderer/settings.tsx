/**
 * duang's own preferences, in the content area so the sidebar — and whatever is running in it — stays
 * in view. One group today: the network route. Model providers join when in-app sign-in exists
 * (fastagent#602); an empty group would promise something that is not there.
 */
import { useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";
import type { DuangApi, Network, Route } from "../preload/index.ts";
import { message } from "./store.ts";
import { Button } from "./ui.tsx";

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

type Test = { running: true } | { status: number; route: Route } | { error: string };

export function Settings({ api, onClose }: { api: DuangApi; onClose: () => void }) {
  const [saved, setSaved] = useState<{ network: Network; route: Route }>();
  const [readError, setReadError] = useState<string>();
  const [mode, setMode] = useState<Network["mode"]>("automatic");
  const [url, setUrl] = useState("");
  const [saveError, setSaveError] = useState<string>();
  const [test, setTest] = useState<Test>();

  const load = () =>
    api.getSettings().then(
      (settings) => {
        setSaved(settings);
        setReadError(undefined);
        setMode(settings.network.mode);
        if (settings.network.mode === "manual") setUrl(settings.network.url);
      },
      (error) => setReadError(message(error)),
    );
  useEffect(() => {
    // Once per opening: a file fixed by hand shows up the next time the page opens, or on Retry.
    void load();
  }, []);

  const apply = async (network: Network) => {
    setSaveError(undefined);
    setTest(undefined);
    try {
      const route = await api.setNetwork(network);
      setSaved({ network, route });
    } catch (error) {
      setSaveError(message(error));
    }
  };
  const choose = (next: Network["mode"]) => {
    setMode(next);
    // Manual needs a URL first; the other two are complete choices.
    if (next !== "manual") void apply({ mode: next });
  };
  const applyManual = () => {
    setMode("manual");
    void apply({ mode: "manual", url });
  };
  const runTest = async () => {
    setTest({ running: true });
    try {
      setTest(await api.testNetwork());
    } catch (error) {
      setTest({ error: message(error) });
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-[640px] px-6 pt-6 pb-10">
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
          <section aria-labelledby="network-heading" className="space-y-4">
            <div>
              <h2 id="network-heading" className="text-[14px] font-semibold">
                Network
              </h2>
              <p className="text-muted text-[12px] mt-1">
                How model, sign-in and usage requests reach the internet. Changes apply to new requests; a
                running turn keeps its connection.
              </p>
            </div>

            <div role="radiogroup" aria-label="Proxy" className="space-y-1">
              <Choice checked={mode === "automatic"} onSelect={() => choose("automatic")} label="Automatic">
                Follow {MAC ? "macOS" : "system"} proxy settings, including a VPN switched on later.
              </Choice>
              <Choice checked={mode === "manual"} onSelect={() => choose("manual")} label="Manual">
                <form
                  className="flex gap-2 mt-1.5"
                  // One field, so Enter submits; the Apply button says the same with the pointer.
                  onSubmit={(event) => {
                    event.preventDefault();
                    applyManual();
                  }}
                >
                  <input
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    onFocus={() => setMode("manual")}
                    aria-label="Proxy URL"
                    placeholder="http://127.0.0.1:7890 or socks5://…"
                    spellCheck={false}
                    className="flex-1 h-8 bg-bg rounded-card px-2.5 font-mono text-[12px] outline-none ring-1 ring-stroke focus:ring-accent/60 placeholder:text-muted"
                  />
                  <Button kind="secondary" onClick={applyManual} disabled={!url.trim() && "Type a proxy URL first"}>
                    Apply
                  </Button>
                </form>
              </Choice>
              <Choice checked={mode === "off"} onSelect={() => choose("off")} label="Off">
                Connect directly.
              </Choice>
            </div>

            {saveError && (
              <p role="alert" className="text-danger text-[12px]">
                {saveError}
              </p>
            )}
            {saved.route.source === "environment" && (
              <p className="text-muted text-[12px]">
                duang was launched with {saved.route.variable} set, so Automatic uses it and does not follow system
                changes until duang is relaunched from the Dock or Finder.
              </p>
            )}

            <div className="flex items-center gap-3 rounded-card bg-surface ring-1 ring-stroke px-3 py-2">
              <span className="flex-1 min-w-0 truncate text-[12px]">
                <span className="text-muted">Now </span>
                <span className="font-mono">{routeLabel(saved.route)}</span>
              </span>
              <Button kind="secondary" size={28} onClick={() => void runTest()} disabled={"running" in (test ?? {}) && "Testing…"}>
                Test connection
              </Button>
            </div>
            {test && !("running" in test) && (
              <p role="status" className={`text-[12px] break-words ${"error" in test ? "text-danger" : "text-muted"}`}>
                {"error" in test
                  ? test.error
                  : `api.anthropic.com answered HTTP ${test.status} ${test.route.proxy ? `via ${test.route.proxy}` : "directly"}.`}
              </p>
            )}
            <p className="text-muted text-[12px]">
              Agent commands such as git, npm and curl get the same proxy through <code>HTTPS_PROXY</code> and its
              siblings, with loopback direct. Per-host PAC rules and the system bypass list do not reach them.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

function Choice({
  checked,
  onSelect,
  label,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-card px-3 py-2 ${checked ? "bg-accent-weak" : ""}`}>
      <label className="flex items-center gap-2.5 cursor-pointer">
        <input type="radio" name="proxy" checked={checked} onChange={onSelect} className="accent-[var(--color-accent)]" />
        <span className={checked ? "text-accent font-medium" : ""}>{label}</span>
      </label>
      <div className="pl-6 text-muted text-[12px]">{children}</div>
    </div>
  );
}

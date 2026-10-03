import { IconContext } from "@phosphor-icons/react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import Gallery from "./gallery.tsx";
import { Boundary, Button } from "./ui.tsx";
import "./index.css";

// `#gallery` is the component sheet (docs/ui.md §6b), read once at load. It must not be a live
// switch: a `[look](#gallery)` link in a model's answer would otherwise unmount the app mid-run,
// dropping its session subscriptions with no way back.
const page = window.location.hash === "#gallery" ? <Gallery /> : <App />;

/*
 * One icon weight for the whole app. Phosphor's `regular` is a hairline at the 12–16px this
 * interface uses — beside 13px text at 600 it reads as a thinner, greyer thing than the words next
 * to it, which is most of what made the UI look drawn by a compiler. `bold` sits at roughly SF
 * Symbols' semibold, which is the weight macOS itself puts next to text of this size.
 */
createRoot(document.getElementById("root")!).render(
  <IconContext.Provider value={{ weight: "bold" }}>
    {/* The last net: a conversation's own boundary (App) catches what a transcript throws, so this one
        is for the rest of the window. Reloading reopens it; runs in main keep going either way. */}
    <Boundary
      fallback={(error) => (
        <div role="alert" className="m-auto max-w-lg space-y-3 p-8 text-[13px]">
          <p className="font-semibold">duang could not draw this window.</p>
          <pre className="whitespace-pre-wrap break-words font-mono text-[12px] text-danger">{error.message}</pre>
          <p className="text-muted">Runs keep going in the background. Reloading draws the window again.</p>
          <Button kind="primary" size={32} onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      )}
    >
      {page}
    </Boundary>
  </IconContext.Provider>,
);

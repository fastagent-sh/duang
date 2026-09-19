import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import Gallery from "./gallery.tsx";
import "./index.css";

// `#gallery` is the component sheet (docs/ui.md §6b), read once at load. It must not be a live
// switch: a `[look](#gallery)` link in a model's answer would otherwise unmount the app mid-run,
// dropping its session subscriptions with no way back.
const page = window.location.hash === "#gallery" ? <Gallery /> : <App />;

createRoot(document.getElementById("root")!).render(page);

import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import Gallery from "./gallery.tsx";
import "./index.css";

// `#gallery` is the component sheet (docs/ui.md §6b): open it in dev by adding the hash, and
// `npm run shots` captures it. It talks to nothing, so it cannot affect the app it documents.
const root = createRoot(document.getElementById("root")!);
const render = () => root.render(window.location.hash === "#gallery" ? <Gallery /> : <App />);
window.addEventListener("hashchange", render);
render();

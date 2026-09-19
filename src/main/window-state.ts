/**
 * Where the window was and how big it was. Navigation memory, like the selected agent — losing it
 * costs one drag, so it is written best effort and an unreadable file is simply a first run.
 *
 * The default is sized for the design's reading column: a 320 sidebar plus a 920 column with its
 * padding, so a fresh install opens at the width the transcript was drawn for.
 */
import { app, screen, type BrowserWindow, type Rectangle } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FILE = () => join(app.getPath("userData"), "window.json");
const DEFAULT = { width: 1280, height: 840 };

export function savedBounds(): Partial<Rectangle> {
  try {
    const saved = JSON.parse(readFileSync(FILE(), "utf8")) as Partial<Rectangle>;
    if (typeof saved.width !== "number" || typeof saved.height !== "number") return DEFAULT;
    // A display that is no longer attached would put the window somewhere nobody can reach.
    const visible =
      typeof saved.x === "number" &&
      typeof saved.y === "number" &&
      screen.getAllDisplays().some(({ workArea }) => {
        return (
          saved.x! + saved.width! > workArea.x &&
          saved.x! < workArea.x + workArea.width &&
          saved.y! + saved.height! > workArea.y &&
          saved.y! < workArea.y + workArea.height
        );
      });
    return visible ? saved : { width: saved.width, height: saved.height };
  } catch {
    return DEFAULT;
  }
}

/** Saves on the moves and resizes that settle, not on every frame of a drag. */
export function rememberBounds(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | undefined;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
      try {
        writeFileSync(FILE(), JSON.stringify(win.getNormalBounds()));
      } catch {
        // A full or read-only user-data directory costs one drag after the next start.
      }
    }, 400);
  };
  win.on("resize", save);
  win.on("move", save);
  win.on("close", () => clearTimeout(timer));
}

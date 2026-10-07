import { join } from "node:path";
import { app } from "electron";

// duang's own credential file, with no fallback to the CLI's or pi's store: one OAuth grant in two files breaks
// when either refreshes, since providers rotate the refresh token.
export const authPath = join(app.getPath("userData"), "auth.json");

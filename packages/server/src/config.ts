// Dev-only path config. Uses import.meta (ESM), so this module must NOT be
// imported by anything that gets bundled for the packaged app — only the dev
// entry (index.ts) uses it. The packaged app injects paths from Electron.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PORT } from "./constants.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// packages/server/src -> up three levels to the project root
export const PROJECT_ROOT = path.resolve(here, "..", "..", "..");
export const OVERLAYS_DIR = path.join(PROJECT_ROOT, "overlays");
export const DATA_DIR = path.join(PROJECT_ROOT, "data");
export const STATE_FILE = path.join(DATA_DIR, "state.json");
export const MEDIA_DIR = path.join(PROJECT_ROOT, "media");

// Static assets shipped with the server (e.g. the overlay runtime script).
export const PUBLIC_DIR = path.join(here, "..", "public");
// Built output of the overlay React app, served at /overlay.
export const OVERLAY_DIST = path.join(PROJECT_ROOT, "apps", "overlay", "dist");
// Built output of the control-panel React app, served at /control.
export const CONTROL_DIST = path.join(PROJECT_ROOT, "apps", "control", "dist");

export const PORT = Number(process.env.PORT ?? DEFAULT_PORT);

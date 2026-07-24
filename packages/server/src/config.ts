import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// packages/server/src -> up three levels to the project root
export const PROJECT_ROOT = path.resolve(here, "..", "..", "..");
export const OVERLAYS_DIR = path.join(PROJECT_ROOT, "overlays");
export const DATA_DIR = path.join(PROJECT_ROOT, "data");
export const STATE_FILE = path.join(DATA_DIR, "state.json");

// Static assets shipped with the server (e.g. the overlay runtime script).
export const PUBLIC_DIR = path.join(here, "..", "public");
// Built output of the overlay React app, served at /overlay.
export const OVERLAY_DIST = path.join(PROJECT_ROOT, "apps", "overlay", "dist");
// Built output of the control-panel React app, served at /control.
export const CONTROL_DIST = path.join(PROJECT_ROOT, "apps", "control", "dist");

export const PORT = Number(process.env.PORT ?? 4747);

/** Default OBS canvas the control panel lays overlays out against. */
export const CANVAS = { width: 1920, height: 1080 } as const;

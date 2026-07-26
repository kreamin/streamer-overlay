// Dev entry point: run with `tsx watch src/index.ts`. Supplies dev paths
// (project-relative) to the shared startServer(). The packaged app calls
// startServer() itself with paths from Electron instead.
import {
  CONTROL_DIST,
  MEDIA_DIR,
  OVERLAY_DIST,
  OVERLAYS_DIR,
  PORT,
  PUBLIC_DIR,
  STATE_FILE,
} from "./config.js";
import { startServer } from "./server.js";

await startServer({
  port: PORT,
  overlaysDir: OVERLAYS_DIR,
  dataFile: STATE_FILE,
  publicDir: PUBLIC_DIR,
  overlayDist: OVERLAY_DIST,
  controlDist: CONTROL_DIST,
  mediaDir: MEDIA_DIR,
});

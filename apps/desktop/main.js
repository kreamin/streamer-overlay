// Electron main process.
//   dev:      requires the freshly-bundled server and runs it in-process with
//             project-relative paths.
//   packaged: same, but paths point at the app's resources (read-only) and the
//             user's writable data dir; default overlays are seeded on first run.
// Running the server in-process means it dies with the app — no orphan process.
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");

const PORT = 4747;
let server = null; // RunningServer handle (only set when WE started it)

function resolvePaths() {
  if (app.isPackaged) {
    const res = process.resourcesPath;
    const userData = app.getPath("userData");
    return {
      overlaysDir: path.join(userData, "overlays"),
      dataFile: path.join(userData, "data", "state.json"),
      publicDir: path.join(res, "public"),
      overlayDist: path.join(res, "overlay"),
      controlDist: path.join(res, "control"),
      defaultOverlays: path.join(res, "overlays-default"),
    };
  }
  const root = path.resolve(__dirname, "..", "..");
  return {
    overlaysDir: path.join(root, "overlays"),
    dataFile: path.join(root, "data", "state.json"),
    publicDir: path.join(root, "packages", "server", "public"),
    overlayDist: path.join(root, "apps", "overlay", "dist"),
    controlDist: path.join(root, "apps", "control", "dist"),
    defaultOverlays: path.join(root, "overlays"),
  };
}

// On first packaged run, copy the bundled default overlays into the user's
// writable folder so they can edit them and drop in new ones.
function seedOverlays(paths) {
  if (!app.isPackaged) return;
  try {
    if (!fs.existsSync(paths.overlaysDir)) {
      fs.mkdirSync(paths.overlaysDir, { recursive: true });
      if (fs.existsSync(paths.defaultOverlays)) {
        fs.cpSync(paths.defaultOverlays, paths.overlaysDir, { recursive: true });
      }
    }
  } catch (err) {
    console.error("[desktop] seeding overlays failed:", err);
  }
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: "Stream Overlay Control",
    backgroundColor: "#0b0e14",
    autoHideMenuBar: true,
  });
  win.loadURL(`http://localhost:${PORT}/control/`);
}

async function boot() {
  const paths = resolvePaths();
  seedOverlays(paths);

  if (await isPortInUse(PORT)) {
    // Something (e.g. a `npm run dev` session) already owns the port — reuse it.
    console.log(`[desktop] server already on :${PORT} — reusing it`);
  } else {
    const { startServer } = require(path.join(__dirname, "build", "server.cjs"));
    server = await startServer({
      port: PORT,
      overlaysDir: paths.overlaysDir,
      dataFile: paths.dataFile,
      publicDir: paths.publicDir,
      overlayDist: paths.overlayDist,
      controlDist: paths.controlDist,
    });
  }

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

app.whenReady().then(boot);

app.on("window-all-closed", () => app.quit());
app.on("will-quit", async () => {
  if (server) await server.close();
});

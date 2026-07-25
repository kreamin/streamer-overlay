// Electron main process (bundled to build/main.cjs by esbuild before launch).
//   - Runs the server in-process (build/server.cjs, beside this file).
//   - Env-aware paths via app.isPackaged.
//   - Checks GitHub Releases for updates on launch (packaged only).
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");

const PORT = 4747;
let server = null; // RunningServer handle (only set when WE started it)

// At runtime this file lives in <app>/build, next to server.cjs.
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
  // build -> desktop -> apps -> project root
  const root = path.resolve(__dirname, "..", "..", "..");
  return {
    overlaysDir: path.join(root, "overlays"),
    dataFile: path.join(root, "data", "state.json"),
    publicDir: path.join(root, "packages", "server", "public"),
    overlayDist: path.join(root, "apps", "overlay", "dist"),
    controlDist: path.join(root, "apps", "control", "dist"),
    defaultOverlays: path.join(root, "overlays"),
  };
}

// Seed default overlays into the user's writable folder. Adds any bundled
// overlay that isn't already there (so new defaults arrive with app updates),
// but never overwrites overlays the user already has.
function seedOverlays(paths) {
  if (!app.isPackaged) return;
  try {
    fs.mkdirSync(paths.overlaysDir, { recursive: true });
    if (!fs.existsSync(paths.defaultOverlays)) return;
    for (const entry of fs.readdirSync(paths.defaultOverlays, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dest = path.join(paths.overlaysDir, entry.name);
      if (!fs.existsSync(dest)) {
        fs.cpSync(path.join(paths.defaultOverlays, entry.name), dest, { recursive: true });
        console.log(`[desktop] seeded overlay: ${entry.name}`);
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

// Check GitHub Releases for a newer version, download it, install on quit.
function initAutoUpdater() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (err) {
    console.error("[updater] failed to load:", err);
    return;
  }
  autoUpdater.on("error", (err) => console.error("[updater] error:", err?.message ?? err));
  autoUpdater.on("update-available", (info) =>
    console.log("[updater] update available:", info?.version),
  );
  autoUpdater.on("update-not-available", () => console.log("[updater] up to date"));
  autoUpdater.on("update-downloaded", (info) =>
    console.log(`[updater] ${info?.version} downloaded — installs on quit`),
  );
  autoUpdater.checkForUpdatesAndNotify().catch((err) =>
    console.error("[updater] check failed:", err?.message ?? err),
  );
}

async function boot() {
  const paths = resolvePaths();
  seedOverlays(paths);

  if (await isPortInUse(PORT)) {
    console.log(`[desktop] server already on :${PORT} — reusing it`);
  } else {
    const { startServer } = require(path.join(__dirname, "server.cjs"));
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
  initAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

app.whenReady().then(boot);
app.on("window-all-closed", () => app.quit());
app.on("will-quit", async () => {
  if (server) await server.close();
});

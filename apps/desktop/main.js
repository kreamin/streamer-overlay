// Electron main process (bundled to build/main.cjs by esbuild before launch).
//   - Runs the server in-process (build/server.cjs, beside this file).
//   - Env-aware paths via app.isPackaged.
//   - Checks GitHub Releases for updates on launch (packaged only).
const { app, BrowserWindow, globalShortcut } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");

const PORT = 4747;
let server = null; // RunningServer handle (only set when WE started it)

// (Re)register OS-global keyboard shortcuts for the app's hotkeys. Each press
// fires the same action the /api/action URL does. Reports back which ones
// registered (a combo already taken by another app fails) so the panel can flag
// it. Called on launch and whenever the hotkey list changes.
function registerHotkeys(hotkeys) {
  if (!server) return; // only when WE own the server (not when reusing one)
  globalShortcut.unregisterAll();
  const results = {};
  for (const h of hotkeys || []) {
    if (!h.shortcut) continue;
    let ok = false;
    try {
      ok = globalShortcut.register(h.shortcut, () => {
        try {
          server.fireHotkey(h.id);
        } catch {
          /* ignore */
        }
      });
    } catch {
      ok = false;
    }
    results[h.id] = ok;
  }
  try {
    server.reportHotkeyStatus(results);
  } catch {
    /* ignore */
  }
}

// At runtime this file lives in <app>/build, next to server.cjs.
function resolvePaths() {
  if (app.isPackaged) {
    const res = process.resourcesPath;
    const userData = app.getPath("userData");
    return {
      overlaysDir: path.join(userData, "overlays"),
      dataFile: path.join(userData, "data", "state.json"),
      mediaDir: path.join(userData, "media"),
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
    mediaDir: path.join(root, "media"),
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
    title: "kreamin's Streamin Overlay",
    icon: app.isPackaged
      ? path.join(process.resourcesPath, "icon.ico")
      : path.join(__dirname, "..", "icon.ico"),
    backgroundColor: "#0b0e14",
    autoHideMenuBar: true,
  });
  win.loadURL(`http://localhost:${PORT}/control/`);
}

// Check GitHub Releases for a newer version, download it, install on quit.
// Logs everything to <userData>/update.log so we can diagnose failures.
function initAutoUpdater() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (err) {
    return;
  }

  const logPath = path.join(app.getPath("userData"), "update.log");
  const write = (level, ...parts) => {
    try {
      fs.appendFileSync(
        logPath,
        `[${new Date().toISOString()}] ${level} ${parts.map(String).join(" ")}\n`,
      );
    } catch {
      /* ignore */
    }
  };
  autoUpdater.logger = {
    info: (...a) => write("INFO", ...a),
    warn: (...a) => write("WARN", ...a),
    error: (...a) => write("ERROR", ...a),
    debug: (...a) => write("DEBUG", ...a),
  };

  // Differential (blockmap-patch) downloads are a common source of silent
  // failures — force a clean full download instead.
  autoUpdater.autoDownload = true;
  autoUpdater.disableDifferentialDownload = true;

  autoUpdater.on("checking-for-update", () => write("EVT", "checking-for-update"));
  autoUpdater.on("update-available", (i) => write("EVT", "update-available", i?.version));
  autoUpdater.on("update-not-available", (i) => write("EVT", "update-not-available", i?.version));
  autoUpdater.on("download-progress", (p) => write("EVT", "download", Math.round(p?.percent ?? 0) + "%"));
  autoUpdater.on("update-downloaded", (i) => write("EVT", "update-downloaded", i?.version));
  autoUpdater.on("error", (e) => write("EVT", "error", e?.message ?? e, "|", e?.stack ?? ""));

  write("BOOT", "app", app.getVersion(), "checking for updates");
  autoUpdater.checkForUpdatesAndNotify().catch((e) => write("EVT", "check-rejected", e?.message ?? e));
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
      mediaDir: paths.mediaDir,
      onHotkeysChanged: registerHotkeys, // re-register when the user edits hotkeys
    });
    registerHotkeys(server.getHotkeys()); // register the saved hotkeys on launch
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
  globalShortcut.unregisterAll();
  if (server) await server.close();
});

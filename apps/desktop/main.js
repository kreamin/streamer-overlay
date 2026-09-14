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

// A small frameless splash shown while we check/download an update on startup.
function createSplash() {
  const win = new BrowserWindow({
    width: 460,
    height: 250,
    frame: false,
    resizable: false,
    center: true,
    show: true,
    alwaysOnTop: true,
    backgroundColor: "#0b0e14",
    icon: app.isPackaged
      ? path.join(process.resourcesPath, "icon.ico")
      : path.join(__dirname, "..", "icon.ico"),
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#0b0e14;color:#e5e7eb;
      font-family:'Segoe UI',system-ui,sans-serif;-webkit-user-select:none;cursor:default}
    .wrap{height:100%;box-sizing:border-box;padding:22px;display:flex;flex-direction:column;
      justify-content:center;align-items:center;gap:12px;text-align:center}
    h1{font-size:15px;font-weight:600;margin:0}
    #msg{font-size:13px;color:#9ca3af;margin:0}
    .bar{width:72%;height:4px;background:#1f2937;border-radius:2px;overflow:hidden}
    .bar>div{height:100%;width:0;background:#6366f1;transition:width .2s}
    #notes{font-size:12px;color:#6b7280;white-space:pre-wrap;max-height:84px;
      overflow:auto;margin:0;width:100%}
  </style></head><body><div class="wrap">
    <h1>kreamin's Streamin Overlay</h1>
    <p id="msg">Checking for updates…</p>
    <div class="bar"><div id="prog"></div></div>
    <p id="notes"></p>
  </div></body></html>`;
  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  return win;
}

// Update-on-startup: check GitHub Releases, and if there's a newer version show
// a splash, download it, then install + relaunch into it BEFORE the app opens.
// Returns true if we're installing (caller should stop booting — the app quits).
// Any problem (offline, no update, error, timeout) resolves false → boot normally.
// Logs everything to <userData>/update.log so we can diagnose failures.
async function updateBeforeLaunch() {
  if (!app.isPackaged) return false;
  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch {
    return false;
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
  autoUpdater.autoDownload = true;
  autoUpdater.disableDifferentialDownload = true; // blockmap patches fail silently
  autoUpdater.autoInstallOnAppQuit = true; // safety net if the user quits mid-download

  const splash = createSplash();
  const run = (js) => {
    if (!splash.isDestroyed()) splash.webContents.executeJavaScript(js).catch(() => {});
  };
  const say = (m) => run(`var e=document.getElementById('msg');if(e)e.textContent=${JSON.stringify(m)};`);
  const prog = (p) => run(`var e=document.getElementById('prog');if(e)e.style.width=${JSON.stringify(p + "%")};`);
  const notes = (n) => run(`var e=document.getElementById('notes');if(e)e.textContent=${JSON.stringify(n)};`);

  return await new Promise((resolve) => {
    let done = false;
    const finish = (updating) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!updating && !splash.isDestroyed()) splash.close();
      resolve(updating);
    };

    // Don't let a slow/failed CHECK block launch. Once an update is found we
    // extend the deadline to allow the download.
    let timer = setTimeout(() => {
      write("EVT", "check-timeout");
      finish(false);
    }, 12000);

    autoUpdater.on("update-available", (info) => {
      write("EVT", "update-available", info?.version);
      clearTimeout(timer);
      timer = setTimeout(() => {
        write("EVT", "download-timeout");
        finish(false);
      }, 180000);
      say("Downloading update v" + (info?.version ?? "") + "…");
      if (typeof info?.releaseNotes === "string" && info.releaseNotes.trim()) {
        notes(info.releaseNotes.trim());
      }
    });
    autoUpdater.on("download-progress", (p) => prog(Math.round(p?.percent ?? 0)));
    autoUpdater.on("update-not-available", (i) => {
      write("EVT", "update-not-available", i?.version);
      finish(false);
    });
    autoUpdater.on("error", (e) => {
      write("EVT", "error", e?.message ?? e, "|", e?.stack ?? "");
      finish(false);
    });
    autoUpdater.on("update-downloaded", (info) => {
      write("EVT", "update-downloaded", info?.version);
      clearTimeout(timer);
      say("Installing v" + (info?.version ?? "") + "… restarting.");
      prog(100);
      // Let the splash paint, then quit + install silently + relaunch.
      setTimeout(() => {
        finish(true);
        try {
          autoUpdater.quitAndInstall(true, true);
        } catch (e) {
          write("EVT", "install-failed", e?.message ?? e);
        }
      }, 900);
    });

    write("BOOT", "app", app.getVersion(), "checking for updates (gated)");
    autoUpdater.checkForUpdates().catch((e) => {
      write("EVT", "check-rejected", e?.message ?? e);
      finish(false);
    });
  });
}

async function boot() {
  // Update-on-startup: if a newer version is downloaded, this quits + relaunches
  // into it, so we never reach the server/window below.
  if (await updateBeforeLaunch()) return;

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

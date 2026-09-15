// Electron main process (bundled to build/main.cjs by esbuild before launch).
//   - Runs the server in-process (build/server.cjs, beside this file).
//   - Env-aware paths via app.isPackaged.
//   - Checks GitHub Releases for updates on launch (packaged only).
const { app, BrowserWindow, globalShortcut, Tray, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");

const PORT = 4747;
let server = null; // RunningServer handle (only set when WE started it)
let mainWindow = null; // the control-panel window (kept alive in the tray)
let tray = null;
let isQuitting = false; // true once the user really quits (tray → Quit)
let toldAboutTray = false; // show the "still running" hint only the first time
let booting = true; // during startup, don't let a transient "no windows" quit the app

function iconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.ico")
    : path.join(__dirname, "..", "icon.ico");
}

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
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    title: "kreamin's Streamin Overlay",
    icon: iconPath(),
    backgroundColor: "#0b0e14",
    autoHideMenuBar: true,
  });
  mainWindow.loadURL(`http://localhost:${PORT}/control/`);

  // Closing the window hides it to the tray so the server keeps feeding OBS
  // ("set and forget"). A real quit goes through the tray menu / before-quit.
  // If the tray couldn't be created, fall through to a normal close instead.
  mainWindow.on("close", (e) => {
    if (isQuitting || !tray) return;
    e.preventDefault();
    mainWindow.hide();
    if (!toldAboutTray) {
      toldAboutTray = true;
      try {
        tray.displayBalloon({
          title: "Still running",
          content: "Overlay is still in the tray and feeding OBS. Right-click the tray icon to quit.",
        });
      } catch {
        /* balloons unsupported — ignore */
      }
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  try {
    tray = new Tray(iconPath());
  } catch {
    return; // no tray (rare) — app still works; the window just closes normally
  }
  tray.setToolTip("kreamin's Streamin Overlay");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open", click: showWindow },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("double-click", showWindow);
  tray.on("click", showWindow);
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

// electron-updater returns GitHub release notes as HTML (GitHub renders the
// release body — even a plain commit message becomes <p>…</p>/<ul><li>). The
// splash shows plain text, so convert tags to text, decode a few entities, and
// drop commit trailers so the "What's new" reads cleanly.
function notesToText(raw) {
  if (!raw) return "";
  let s = Array.isArray(raw) ? raw.map((n) => (n && n.note) || "").join("\n\n") : String(raw);
  s = s
    .replace(/<\s*li[^>]*>/gi, "• ")
    .replace(/<\s*\/(p|div|li|ul|ol|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#3?9;/gi, "'");
  s = s
    .split("\n")
    .filter((l) => !/^\s*(co-authored-by:|🤖)/i.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  return s;
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
  // Create the tray FIRST so the app has an anchor: when the update splash
  // closes (no-update path) there's briefly no window, and without this the
  // OS "window-all-closed" event would quit the app before the main window
  // opens. The `booting` guard below is the belt-and-suspenders for this.
  createTray();

  // Update-on-startup: if a newer version is downloaded, this quits + relaunches
  // into it, so we never reach the server/window below.
  try {
    if (await updateBeforeLaunch()) return;
  } catch {
    /* update path failed — fall through and launch the app normally */
  }

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
      appVersion: app.getVersion(),
      onHotkeysChanged: registerHotkeys, // re-register when the user edits hotkeys
    });
    registerHotkeys(server.getHotkeys()); // register the saved hotkeys on launch
  }

  createWindow();
  booting = false; // startup done — window-all-closed may now act normally

  app.on("activate", () => showWindow());
}

app.whenReady().then(boot);
app.on("before-quit", () => {
  isQuitting = true;
});
// During startup, ignore transient "no windows" (the update splash closing
// before the main window opens) so we never quit mid-boot. After startup: with a
// tray we stay running (set and forget); without one, closing the last window quits.
app.on("window-all-closed", () => {
  if (booting) return;
  if (!tray) app.quit();
});
app.on("will-quit", async () => {
  globalShortcut.unregisterAll();
  if (tray) tray.destroy();
  if (server) await server.close();
});

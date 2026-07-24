// Electron main process.
// Responsibilities:
//   1. Start our existing server (if it isn't already running).
//   2. Open a window showing the control panel.
//   3. Kill the server we started when the app quits — so nothing lingers.
const { app, BrowserWindow } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const net = require("node:net");

const PORT = 4747;
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const SERVER_ENTRY = path.join(PROJECT_ROOT, "packages", "server", "src", "index.ts");

let serverProcess = null;
let startedByUs = false;

/** Resolve true if something is already listening on the port. */
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

async function waitForServer(port, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortInUse(port)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function startServer() {
  // Reuse an already-running server (e.g. a terminal `npm run dev`) rather than
  // spawning a duplicate.
  if (await isPortInUse(PORT)) {
    console.log(`[desktop] server already on :${PORT} — reusing it`);
    return;
  }

  // Run the TypeScript server with tsx, using Electron's bundled Node.
  const tsxCli = path.join(
    path.dirname(require.resolve("tsx/package.json")),
    "dist",
    "cli.mjs",
  );
  serverProcess = spawn(process.execPath, [tsxCli, SERVER_ENTRY], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: "inherit",
  });
  startedByUs = true;
  serverProcess.on("exit", (code) => {
    console.log(`[desktop] server process exited (${code})`);
    serverProcess = null;
  });
}

/** Kill the server (and any children) — only if we were the ones who started it. */
function stopServer() {
  if (!serverProcess || !startedByUs) return;
  const pid = serverProcess.pid;
  serverProcess = null;
  startedByUs = false;
  if (process.platform === "win32") {
    // /T kills the whole process tree so no node is left holding the port.
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"]);
  } else {
    try {
      process.kill(pid);
    } catch {
      /* already gone */
    }
  }
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

app.whenReady().then(async () => {
  await startServer();
  const ready = await waitForServer(PORT);
  if (!ready) {
    console.error("[desktop] server did not become ready in time");
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Single-purpose tool: closing the window quits the app (and stops the server).
app.on("window-all-closed", () => app.quit());
app.on("before-quit", stopServer);
app.on("will-quit", stopServer);
process.on("exit", stopServer);

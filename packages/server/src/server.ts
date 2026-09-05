import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { StateStore } from "./state.js";
import { OverlayRegistry } from "./registry.js";
import { VariableStore } from "./variables.js";
import { StreamerbotConnector } from "./streamerbot.js";
import { ObsConnector } from "./obs.js";
import { hotkeySlug } from "@stream-overlay/shared";
import type {
  ClientMessage,
  FieldValue,
  HotkeyAction,
  InstalledOverlay,
  IntegrationStatus,
  OverlayInstance,
  ServerMessage,
} from "@stream-overlay/shared";

/** All paths are injected so the same code runs in dev and inside the packaged app. */
export interface ServerConfig {
  port: number;
  overlaysDir: string;
  dataFile: string;
  publicDir: string;
  overlayDist: string;
  controlDist: string;
  /** Writable dir for user-uploaded media (gifs/images), served at /media. */
  mediaDir: string;
  /** Called (on changes) with the current hotkeys so the desktop app can (re)register global shortcuts. */
  onHotkeysChanged?: (hotkeys: HotkeyAction[]) => void;
}

export interface RunningServer {
  close(): Promise<void>;
  /** Current hotkey list (for the desktop app to register global shortcuts). */
  getHotkeys(): HotkeyAction[];
  /** Run a hotkey's action by id (called from a global keyboard shortcut). */
  fireHotkey(hotkeyId: string): void;
  /** Push per-hotkey keyboard-registration results to the control panel. */
  reportHotkeyStatus(results: Record<string, boolean>): void;
}

// Integrations (Streamer.bot etc.) push variables here.
const INGEST_PATH = "/ingest";

export async function startServer(config: ServerConfig): Promise<RunningServer> {
  const store = await StateStore.load(config.dataFile);
  const registry = new OverlayRegistry(config.overlaysDir);
  await registry.start();
  const variables = new VariableStore();

  const app = express();
  app.use(express.json({ limit: "30mb" })); // gifs can be a few MB (base64)
  app.use("/overlays", express.static(config.overlaysDir));
  app.use("/media", express.static(config.mediaDir));
  app.get("/overlay-runtime.js", (_req, res) => {
    res.sendFile(path.join(config.publicDir, "overlay-runtime.js"));
  });
  app.post("/api/open-overlays-folder", (_req, res) => {
    openFolder(config.overlaysDir);
    res.json({ ok: true });
  });
  // Upload an image/gif (data URL) → saved to mediaDir → returns its /media URL.
  app.post("/api/upload", async (req, res) => {
    try {
      const { filename, dataUrl } = (req.body ?? {}) as {
        filename?: string;
        dataUrl?: string;
      };
      const match = typeof dataUrl === "string" && /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
      if (!match) {
        res.status(400).json({ error: "invalid dataUrl" });
        return;
      }
      const buffer = Buffer.from(match[2], "base64");
      const name = `${crypto.randomUUID()}${extFor(match[1], filename)}`;
      await fs.mkdir(config.mediaDir, { recursive: true });
      await fs.writeFile(path.join(config.mediaDir, name), buffer);
      res.json({ url: `/media/${name}` });
    } catch {
      res.status(500).json({ error: "upload failed" });
    }
  });
  // Fire a hotkey's action by slug (or id). GET and POST both work, so any
  // Stream Deck HTTP button / Bitfocus Companion can hit it.
  app.all("/api/action/:key", (req, res) => {
    const key = req.params.key;
    const hk = store.get().hotkeys.find((h) => hotkeySlug(h) === key || h.id === key);
    if (!hk) {
      res.status(404).json({ error: "no such action" });
      return;
    }
    res.json({ ok: runAction(hk.target) });
  });
  app.get("/api/state", (_req, res) => res.json(store.get()));
  app.get("/api/installed", (_req, res) => res.json(registry.list()));
  app.get("/api/variables", (_req, res) => res.json(variables.all()));
  app.use("/overlay", express.static(config.overlayDist));
  app.use("/control", express.static(config.controlDist));

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer });

  // Push clients (Streamer.bot Custom WebSocket Client → /ingest, advanced).
  const ingestSockets = new Set<WebSocket>();

  function broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const client of wss.clients) {
      // Don't echo app messages back to integration clients.
      if (ingestSockets.has(client)) continue;
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  }

  const integration = (): IntegrationStatus => ({
    streamerbot: streamerbot.getStatus(),
    obs: obs.getStatus(),
    ingestClients: ingestSockets.size,
  });

  // A variable changed: refresh bound fields and tell the control panel.
  function onVariablesChanged(): void {
    broadcast({ type: "variables", variables: variables.all() });
    if (store.applyBoundValues(variables.all())) {
      broadcast({ type: "state", state: store.get() });
    }
  }

  // Pull connector: mirrors the user's Streamer.bot globals into the variable
  // store whenever it's enabled in settings.
  const streamerbot = new StreamerbotConnector(
    (vars) => {
      variables.setMany(vars);
      onVariablesChanged();
    },
    () => broadcast({ type: "integration", integration: integration() }),
  );
  streamerbot.configure(store.get().streamerbot);

  // Re-apply every OBS-source lock: pull each locked instance's source box from
  // OBS and rescale it into canvas pixels. Broadcasts once if anything moved.
  function applyObsLocks(): void {
    const state = store.get();
    const { width: cw, height: ch } = state.canvas;
    let changed = false;
    for (const scene of state.scenes) {
      for (const inst of scene.instances) {
        if (!inst.obsSource) continue;
        const box = obs.getBox(scene.obsSceneName, inst.obsSource);
        if (!box) continue;
        const offX = Number(inst.obsOffsetX) || 0;
        const offY = Number(inst.obsOffsetY) || 0;
        let position: { x: number; y: number };
        let size: { width: number; height: number };
        if (inst.obsMatchSize === false) {
          // Follow the source's position only; keep the element's own size
          // (e.g. a small sub-goal parked in the webcam's corner via offset).
          position = { x: box.x * cw + offX, y: box.y * ch + offY };
          size = { width: inst.size.width, height: inst.size.height };
        } else {
          // Match the source's size. If the element has a border thickness, grow
          // the box outward by it so a frame wraps AROUND the source (transparent
          // center matches the source) instead of sitting on its edge/corners.
          const t = Number(inst.values.thickness);
          const outset = Number.isFinite(t) && t > 0 ? t : 0;
          position = { x: box.x * cw - outset + offX, y: box.y * ch - outset + offY };
          size = { width: box.w * cw + outset * 2, height: box.h * ch + outset * 2 };
        }
        const moved = store.applyObsLayout(inst.instanceId, position, size);
        changed = changed || moved;
      }
    }
    if (changed) broadcast({ type: "state", state: store.get() });
  }

  // Run a hotkey's action (from a keyboard shortcut, the /api/action URL, or a
  // future Stream Deck plugin). All three funnel through here.
  function runAction(target: HotkeyAction["target"]): boolean {
    switch (target.kind) {
      case "pulse":
        if (!target.instanceId) return false;
        broadcast({ type: "pulse", instanceId: target.instanceId });
        return true;
      case "toggleActive":
        if (!target.instanceId) return false;
        store.toggleActive(target.instanceId);
        broadcast({ type: "state", state: store.get() });
        return true;
      case "switchScene":
        if (!target.sceneId) return false;
        store.setCurrentScene(target.sceneId);
        broadcast({ type: "state", state: store.get() });
        applyObsLocks(); // snap locked elements in the newly-shown scene
        return true;
      default:
        return false;
    }
  }

  function fireHotkeyById(hotkeyId: string): boolean {
    const hk = store.get().hotkeys.find((h) => h.id === hotkeyId);
    return hk ? runAction(hk.target) : false;
  }

  // OBS connector: watches the program scene (drives the app's current scene)
  // and source transforms (drives per-element OBS-source locks).
  const obs = new ObsConnector(
    (obsSceneName) => {
      if (store.setCurrentSceneByObsName(obsSceneName)) {
        broadcast({ type: "state", state: store.get() });
      }
      applyObsLocks(); // snap locked elements in the newly-shown scene
    },
    () => broadcast({ type: "integration", integration: integration() }),
    () => applyObsLocks(),
  );
  obs.configure(store.get().obs);

  registry.onChange((installed) => broadcast({ type: "installed", installed }));

  wss.on("connection", (socket, req) => {
    if ((req.url ?? "").startsWith(INGEST_PATH)) {
      handleIngest(socket);
      return;
    }
    handleAppClient(socket);
  });

  // --- Integration clients (Streamer.bot Custom WebSocket Client) ----------
  function handleIngest(socket: WebSocket): void {
    ingestSockets.add(socket);
    broadcast({ type: "integration", integration: integration() });
    console.log(`[ingest] client connected (${ingestSockets.size} total)`);

    socket.on("message", (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // ignore non-JSON
      }
      if (ingestVariables(msg, variables)) onVariablesChanged();
    });

    socket.on("close", () => {
      ingestSockets.delete(socket);
      broadcast({ type: "integration", integration: integration() });
      console.log(`[ingest] client disconnected (${ingestSockets.size} total)`);
    });
  }

  // --- App clients (overlay page + control panel) --------------------------
  function handleAppClient(socket: WebSocket): void {
    socket.send(
      JSON.stringify({
        type: "hello",
        state: store.get(),
        installed: registry.list(),
        variables: variables.all(),
        integration: integration(),
      } satisfies ServerMessage),
    );

    socket.on("message", (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        return;
      }
      // Streamer.bot config lives on the connector (in this closure), so handle
      // it here rather than in the shared handle().
      if (message.type === "setStreamerbot") {
        const cfg = store.setStreamerbot(message);
        streamerbot.configure(cfg);
        broadcast({ type: "state", state: store.get() });
        broadcast({ type: "integration", integration: integration() });
        return;
      }
      if (message.type === "setObs") {
        const cfg = store.setObs(message);
        obs.configure(cfg);
        broadcast({ type: "state", state: store.get() });
        broadcast({ type: "integration", integration: integration() });
        return;
      }
      if (message.type === "setInstanceObsSource") {
        store.setInstanceObsSource(message.instanceId, message.obsSource);
        broadcast({ type: "state", state: store.get() });
        applyObsLocks(); // snap to the source's current transform right away
        return;
      }
      if (message.type === "setInstanceObsLock") {
        store.setInstanceObsLock(message.instanceId, {
          matchSize: message.matchSize,
          offsetX: message.offsetX,
          offsetY: message.offsetY,
        });
        broadcast({ type: "state", state: store.get() });
        applyObsLocks(); // re-apply with the new size mode / offset
        return;
      }
      if (message.type === "play") {
        broadcast({ type: "pulse", instanceId: message.instanceId });
        return;
      }
      handle(message, store, registry, variables);
      broadcast({ type: "state", state: store.get() });
      // A field change (e.g. border thickness) can change a locked element's
      // outset — re-apply locks so the wrap updates without waiting for OBS.
      applyObsLocks();
      // Hotkey edits: tell the desktop app to (re)register global shortcuts.
      if (
        message.type === "addHotkey" ||
        message.type === "removeHotkey" ||
        message.type === "updateHotkey"
      ) {
        config.onHotkeysChanged?.(store.get().hotkeys);
      }
    });
  }

  await new Promise<void>((resolve) => httpServer.listen(config.port, resolve));
  console.log(`\n  Stream Overlay server → http://localhost:${config.port}\n`);

  return {
    close: () =>
      new Promise<void>((resolve) => {
        streamerbot.stop();
        obs.stop();
        wss.close();
        httpServer.close(() => resolve());
      }),
    getHotkeys: () => store.get().hotkeys,
    fireHotkey: (hotkeyId: string) => {
      fireHotkeyById(hotkeyId);
    },
    reportHotkeyStatus: (results: Record<string, boolean>) => {
      broadcast({ type: "hotkeyStatus", results });
    },
  };
}

/**
 * Accepts variable pushes in either shape:
 *   { "key": "subCount", "value": 42 }
 *   { "variables": { "subCount": 42, "goal": 100 } }
 * Returns true if anything was stored.
 */
function ingestVariables(msg: unknown, variables: VariableStore): boolean {
  if (!msg || typeof msg !== "object") return false;
  const obj = msg as Record<string, unknown>;
  let stored = false;

  if (typeof obj.key === "string" && isFieldValue(obj.value)) {
    variables.set(obj.key, obj.value);
    stored = true;
  }
  if (obj.variables && typeof obj.variables === "object") {
    for (const [k, v] of Object.entries(obj.variables as Record<string, unknown>)) {
      if (isFieldValue(v)) {
        variables.set(k, v);
        stored = true;
      }
    }
  }
  return stored;
}

function isFieldValue(v: unknown): v is FieldValue {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function handle(
  message: ClientMessage,
  store: StateStore,
  registry: OverlayRegistry,
  variables: VariableStore,
): void {
  switch (message.type) {
    case "addScene":
      store.addScene(message.name);
      break;
    case "removeScene":
      store.removeScene(message.sceneId);
      break;
    case "renameScene":
      store.renameScene(message.sceneId, message.name);
      break;
    case "setCurrentScene":
      store.setCurrentScene(message.sceneId);
      break;
    case "setSceneLiveDrag":
      store.setSceneLiveDrag(message.sceneId, message.liveDrag);
      break;
    case "setSceneObsLink":
      store.setSceneObsLink(message.sceneId, message.obsSceneName);
      break;
    case "addInstance": {
      const overlay = registry.find(message.overlayId);
      if (overlay) store.addInstance(makeInstance(overlay, store));
      break;
    }
    case "removeInstance":
      store.removeInstance(message.instanceId);
      break;
    case "setActive":
      store.setActive(message.instanceId, message.active);
      break;
    case "setLayout":
      store.setLayout(message.instanceId, message);
      break;
    case "setValue":
      store.setValue(message.instanceId, message.fieldId, message.value);
      break;
    case "adjustValue":
      store.adjustValue(message.instanceId, message.fieldId, message.delta);
      break;
    case "setBinding":
      store.setBinding(message.instanceId, message.fieldId, message.variableKey);
      // Apply the current value immediately so binding takes effect at once.
      store.applyBoundValues(variables.all());
      break;
    case "setCanvas":
      store.setCanvas(message.width, message.height);
      break;
    case "addHotkey":
      store.addHotkey();
      break;
    case "removeHotkey":
      store.removeHotkey(message.hotkeyId);
      break;
    case "updateHotkey":
      store.updateHotkey(message.hotkeyId, {
        label: message.label,
        shortcut: message.shortcut,
        target: message.target,
      });
      break;
  }
}

function makeInstance(overlay: InstalledOverlay, store: StateStore): OverlayInstance {
  const values: OverlayInstance["values"] = {};
  for (const field of overlay.manifest.fields) values[field.id] = field.default;
  return {
    instanceId: crypto.randomUUID(),
    overlayId: overlay.manifest.id,
    active: true,
    position: { x: 80, y: 80 },
    size: { ...overlay.manifest.defaultSize },
    values,
    z: store.nextZ(),
  };
}

/** Choose a file extension from the mime type (falling back to the filename). */
function extFor(mime: string, filename?: string): string {
  const byMime: Record<string, string> = {
    "image/gif": ".gif",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/apng": ".apng",
    "image/svg+xml": ".svg",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/wave": ".wav",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/ogg": ".ogg",
    "audio/webm": ".weba",
  };
  if (byMime[mime]) return byMime[mime];
  const ext = filename ? path.extname(filename) : "";
  return ext || ".bin";
}

function openFolder(dir: string): void {
  const cmd =
    process.platform === "win32"
      ? "explorer"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  spawn(cmd, [dir], { detached: true, stdio: "ignore" }).on("error", () => {
    /* best-effort */
  });
}

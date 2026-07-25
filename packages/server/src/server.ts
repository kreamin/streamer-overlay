import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { StateStore } from "./state.js";
import { OverlayRegistry } from "./registry.js";
import { VariableStore } from "./variables.js";
import type {
  ClientMessage,
  FieldValue,
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
}

export interface RunningServer {
  close(): Promise<void>;
}

// Integrations (Streamer.bot etc.) push variables here.
const INGEST_PATH = "/ingest";

export async function startServer(config: ServerConfig): Promise<RunningServer> {
  const store = await StateStore.load(config.dataFile);
  const registry = new OverlayRegistry(config.overlaysDir);
  await registry.start();
  const variables = new VariableStore();

  const app = express();
  app.use(express.json());
  app.use("/overlays", express.static(config.overlaysDir));
  app.get("/overlay-runtime.js", (_req, res) => {
    res.sendFile(path.join(config.publicDir, "overlay-runtime.js"));
  });
  app.post("/api/open-overlays-folder", (_req, res) => {
    openFolder(config.overlaysDir);
    res.json({ ok: true });
  });
  app.get("/api/state", (_req, res) => res.json(store.get()));
  app.get("/api/installed", (_req, res) => res.json(registry.list()));
  app.get("/api/variables", (_req, res) => res.json(variables.all()));
  app.use("/overlay", express.static(config.overlayDist));
  app.use("/control", express.static(config.controlDist));

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer });

  // Track how many integration clients are connected (Streamer.bot etc.).
  const ingestSockets = new Set<WebSocket>();
  const integration = (): IntegrationStatus => ({
    streamerbotConnected: ingestSockets.size > 0,
  });

  function broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const client of wss.clients) {
      // Don't echo app messages back to integration clients.
      if (ingestSockets.has(client)) continue;
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  }

  registry.onChange((installed) => broadcast({ type: "installed", installed }));

  // A variable changed: refresh bound fields and tell the control panel.
  function onVariablesChanged(): void {
    broadcast({ type: "variables", variables: variables.all() });
    if (store.applyBoundValues(variables.all())) {
      broadcast({ type: "state", state: store.get() });
    }
  }

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
      handle(message, store, registry, variables);
      broadcast({ type: "state", state: store.get() });
    });
  }

  await new Promise<void>((resolve) => httpServer.listen(config.port, resolve));
  console.log(`\n  Stream Overlay server → http://localhost:${config.port}\n`);

  return {
    close: () =>
      new Promise<void>((resolve) => {
        wss.close();
        httpServer.close(() => resolve());
      }),
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

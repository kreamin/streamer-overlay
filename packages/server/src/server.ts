import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { StateStore } from "./state.js";
import { OverlayRegistry } from "./registry.js";
import type {
  ClientMessage,
  InstalledOverlay,
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

export async function startServer(config: ServerConfig): Promise<RunningServer> {
  const store = await StateStore.load(config.dataFile);
  const registry = new OverlayRegistry(config.overlaysDir);
  await registry.start();

  const app = express();
  app.use(express.json());

  // Overlay package assets — the iframes on the overlay page load these.
  app.use("/overlays", express.static(config.overlaysDir));

  // Shared runtime script overlay packages include.
  app.get("/overlay-runtime.js", (_req, res) => {
    res.sendFile(path.join(config.publicDir, "overlay-runtime.js"));
  });

  // Open the overlays folder in the OS file browser (works in a plain browser
  // and inside Electron — it's just an HTTP call).
  app.post("/api/open-overlays-folder", (_req, res) => {
    openFolder(config.overlaysDir);
    res.json({ ok: true });
  });

  // Debug/JSON endpoints.
  app.get("/api/state", (_req, res) => res.json(store.get()));
  app.get("/api/installed", (_req, res) => res.json(registry.list()));

  // The two React apps.
  app.use("/overlay", express.static(config.overlayDist));
  app.use("/control", express.static(config.controlDist));

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer });

  function broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  }

  registry.onChange((installed) => broadcast({ type: "installed", installed }));

  wss.on("connection", (socket) => {
    socket.send(
      JSON.stringify({
        type: "hello",
        state: store.get(),
        installed: registry.list(),
      } satisfies ServerMessage),
    );

    socket.on("message", (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        return;
      }
      handle(message, store, registry);
      broadcast({ type: "state", state: store.get() });
    });
  });

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

function handle(
  message: ClientMessage,
  store: StateStore,
  registry: OverlayRegistry,
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

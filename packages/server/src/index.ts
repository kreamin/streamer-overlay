import path from "node:path";
import { createServer } from "node:http";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { CONTROL_DIST, OVERLAY_DIST, OVERLAYS_DIR, PORT, PUBLIC_DIR } from "./config.js";
import { StateStore } from "./state.js";
import { OverlayRegistry } from "./registry.js";
import type {
  ClientMessage,
  InstalledOverlay,
  OverlayInstance,
  ServerMessage,
} from "@stream-overlay/shared";

const store = await StateStore.load();
const registry = new OverlayRegistry();
await registry.start();

const app = express();
app.use(express.json());

// Overlay package assets — the iframes on the overlay page load these.
app.use("/overlays", express.static(OVERLAYS_DIR));

// Shared runtime script overlay packages include.
app.get("/overlay-runtime.js", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "overlay-runtime.js"));
});

// The overlay React app (the page OBS loads).
app.use("/overlay", express.static(OVERLAY_DIST));

// The control-panel React app (opened in a normal browser).
app.use("/control", express.static(CONTROL_DIST));

// Debug/JSON endpoints, handy before the frontends exist.
app.get("/api/state", (_req, res) => {
  res.json(store.get());
});
app.get("/api/installed", (_req, res) => {
  res.json(registry.list());
});

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<meta charset="utf-8"><title>Stream Overlay Server</title>
<body style="font-family:system-ui;max-width:640px;margin:48px auto;line-height:1.6;color:#222">
  <h1>Stream Overlay Server</h1>
  <p>Running on port <b>${PORT}</b>. Websocket hub and folder watcher are live.</p>
  <ul>
    <li><a href="/api/installed">/api/installed</a> — overlays found in the <code>overlays/</code> folder</li>
    <li><a href="/api/state">/api/state</a> — current layout &amp; values</li>
  </ul>
  <p style="color:#888">The overlay page (/overlay) and control panel (/control) arrive in the next phases.</p>
</body>`);
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

function broadcast(message: ServerMessage): void {
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

// When the folder changes, tell everyone the new installed list.
registry.onChange((installed) => {
  broadcast({ type: "installed", installed });
});

wss.on("connection", (socket) => {
  // Greet each new client with the full picture.
  const hello: ServerMessage = {
    type: "hello",
    state: store.get(),
    installed: registry.list(),
  };
  socket.send(JSON.stringify(hello));

  socket.on("message", (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return; // ignore malformed frames
    }
    handle(message);
    broadcast({ type: "state", state: store.get() });
  });
});

function handle(message: ClientMessage): void {
  switch (message.type) {
    case "addInstance": {
      const overlay = registry.find(message.overlayId);
      if (overlay) store.addInstance(makeInstance(overlay));
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

function makeInstance(overlay: InstalledOverlay): OverlayInstance {
  const values: OverlayInstance["values"] = {};
  for (const field of overlay.manifest.fields) {
    values[field.id] = field.default;
  }
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

httpServer.listen(PORT, () => {
  console.log(`\n  Stream Overlay server → http://localhost:${PORT}\n`);
});

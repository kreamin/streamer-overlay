import WebSocket from "ws";
import crypto from "node:crypto";
import type { ObsConfig } from "@stream-overlay/shared";

export interface ObsStatus {
  enabled: boolean;
  connected: boolean;
  error?: string;
  currentScene?: string;
  scenes: string[];
  /** Deduped scene-item source names across all scenes (for unlinked scenes). */
  sources: string[];
  /** Scene-item source names per OBS scene (for scenes linked to an OBS scene). */
  sourcesByScene: Record<string, string[]>;
}

/** A source's on-screen box, normalized 0..1 against the OBS base canvas. */
export interface ObsBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// OBS scene-item alignment bit flags (OBS_ALIGN_*). Default item alignment is
// 5 (top-left = LEFT|TOP). We use these to resolve positionX/Y → top-left.
const ALIGN_LEFT = 1;
const ALIGN_RIGHT = 2;
const ALIGN_TOP = 4;
const ALIGN_BOTTOM = 8;

const RECONNECT_MS = 3000;
const REQUEST_TIMEOUT_MS = 5000;

// obs-websocket v5 opcodes.
const OP_HELLO = 0;
const OP_IDENTIFY = 1;
const OP_IDENTIFIED = 2;
const OP_EVENT = 5;
const OP_REQUEST = 6;
const OP_REQUEST_RESPONSE = 7;

// obs-websocket EventSubscription bitmask: all standard (non-high-volume)
// categories. Includes Scenes (CurrentProgramSceneChanged etc.). Being explicit
// avoids depending on the server's default subscription behavior.
const EVENT_SUB_ALL = 2047;
// SceneItemTransformChanged is a HIGH-VOLUME event (bit 19) and is NOT part of
// `All` — it must be opted into explicitly, or a source's live move/resize never
// reaches us (you'd only see it after a reconnect, when we re-read transforms).
const EVENT_SUB_SCENE_ITEM_TRANSFORM = 1 << 19; // 524288

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Connects to OBS's built-in WebSocket (obs-websocket v5) and tracks the scene
 * list + current program scene, calling `onSceneChange` whenever OBS switches
 * scenes. Uses the raw v5 JSON protocol directly (same approach as the
 * Streamer.bot connector).
 *
 * Handshake: OBS sends Hello (op 0, maybe with an auth challenge) → we reply
 * Identify (op 1, with the SHA256 auth answer if a password is set) → OBS sends
 * Identified (op 2), after which requests/events flow.
 */
export class ObsConnector {
  private config: ObsConfig = { enabled: false, host: "127.0.0.1", port: 4455, password: "" };
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reqId = 0;
  private pending = new Map<string, (data: any) => void>();
  private status: ObsStatus = {
    enabled: false,
    connected: false,
    scenes: [],
    sources: [],
    sourcesByScene: {},
  };

  // OBS base (canvas) resolution — transforms are in these pixels.
  private base = { width: 1920, height: 1080 };
  // sceneName -> scene-item id -> source name (for reverse lookup on events).
  private itemsByScene = new Map<string, Map<number, string>>();
  // `${sceneName}|${sourceName}` -> normalized on-screen box.
  private transforms = new Map<string, ObsBox>();

  constructor(
    private readonly onSceneChange: (obsSceneName: string) => void,
    private readonly onStatus: (status: ObsStatus) => void,
    /** Fired when any tracked source transform (or the base canvas) changes. */
    private readonly onTransforms: () => void = () => {},
  ) {}

  getStatus(): ObsStatus {
    return this.status;
  }

  /**
   * The normalized (0..1) on-screen box for a source. If `preferScene` is given
   * (the app scene is linked to an OBS scene), resolution is STRICT to that OBS
   * scene — a same-named source in another scene can't leak in. Without a link,
   * falls back to the current program scene, then any scene containing it.
   * Returns null if the source isn't found there or has no valid transform.
   */
  getBox(preferScene: string | undefined, sourceName: string): ObsBox | null {
    const at = (scene?: string) =>
      scene ? (this.transforms.get(`${scene}|${sourceName}`) ?? null) : null;
    if (preferScene) return at(preferScene); // linked scene: that scene only
    const current = at(this.status.currentScene);
    if (current) return current;
    for (const key of this.transforms.keys()) {
      if (key.endsWith(`|${sourceName}`)) return this.transforms.get(key)!;
    }
    return null;
  }

  /** Apply a new config; (re)connects or disconnects as needed. */
  configure(config: ObsConfig): void {
    const changed =
      config.enabled !== this.config.enabled ||
      config.host !== this.config.host ||
      config.port !== this.config.port ||
      config.password !== this.config.password;
    this.config = { ...config };
    this.status.enabled = config.enabled;
    if (!changed) return;

    this.teardown();
    if (config.enabled) this.connect();
    else {
      this.status = { ...this.status, connected: false, error: undefined };
      this.emitStatus();
    }
  }

  stop(): void {
    this.config = { ...this.config, enabled: false };
    this.teardown();
  }

  private connect(): void {
    this.clearTimers();
    const url = `ws://${this.config.host}:${this.config.port}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this.scheduleReconnect(errMsg(err));
      return;
    }
    this.ws = ws;

    ws.on("message", (raw) => this.onMessage(raw));
    ws.on("error", (err) => {
      this.status = { ...this.status, error: errMsg(err) };
    });
    ws.on("close", () => {
      if (this.config.enabled) this.scheduleReconnect(this.status.error ?? "disconnected");
    });
  }

  private onMessage(raw: WebSocket.RawData): void {
    let msg: { op?: number; d?: any };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (msg.op) {
      case OP_HELLO:
        this.identify(msg.d);
        break;
      case OP_IDENTIFIED:
        void this.onIdentified();
        break;
      case OP_EVENT:
        this.onEvent(msg.d);
        break;
      case OP_REQUEST_RESPONSE:
        this.onResponse(msg.d);
        break;
    }
  }

  private identify(hello: any): void {
    const d: any = {
      rpcVersion: 1,
      eventSubscriptions: EVENT_SUB_ALL | EVENT_SUB_SCENE_ITEM_TRANSFORM,
    };
    const auth = hello?.authentication;
    if (auth?.challenge && auth?.salt) {
      // base64( sha256( base64( sha256(password + salt) ) + challenge ) )
      const secret = sha256b64(this.config.password + auth.salt);
      d.authentication = sha256b64(secret + auth.challenge);
    }
    this.send({ op: OP_IDENTIFY, d });
  }

  private async onIdentified(): Promise<void> {
    this.status = { ...this.status, connected: true, error: undefined };
    await this.refreshScenes();
    await this.refreshVideoSettings();
    await this.refreshAllSceneItems();
    this.emitStatus();
    // Align immediately with whatever scene OBS is already on.
    if (this.status.currentScene) this.onSceneChange(this.status.currentScene);
    // Push initial transforms so locked elements snap into place on connect.
    this.onTransforms();
  }

  private onEvent(d: any): void {
    const type = d?.eventType;
    if (type === "CurrentProgramSceneChanged") {
      const sceneName = d?.eventData?.sceneName;
      if (typeof sceneName === "string") {
        this.status = { ...this.status, currentScene: sceneName };
        this.onSceneChange(sceneName);
        this.emitStatus();
      }
    } else if (
      type === "SceneListChanged" ||
      type === "SceneCreated" ||
      type === "SceneRemoved" ||
      type === "SceneNameChanged"
    ) {
      void this.refreshScenes()
        .then(() => this.refreshAllSceneItems())
        .then(() => {
          this.emitStatus();
          this.onTransforms();
        });
    } else if (type === "SceneItemTransformChanged") {
      // Live move/resize of a source in OBS — update just that one box.
      const sceneName = d?.eventData?.sceneName;
      const itemId = Number(d?.eventData?.sceneItemId);
      const t = d?.eventData?.sceneItemTransform;
      const sourceName =
        typeof sceneName === "string"
          ? this.itemsByScene.get(sceneName)?.get(itemId)
          : undefined;
      if (typeof sceneName === "string" && sourceName && t) {
        const box = this.boxFromTransform(t);
        if (box) {
          this.transforms.set(`${sceneName}|${sourceName}`, box);
          this.onTransforms();
        }
      }
    } else if (
      type === "SceneItemCreated" ||
      type === "SceneItemRemoved" ||
      type === "SceneItemListReindexed"
    ) {
      const sceneName = d?.eventData?.sceneName;
      if (typeof sceneName === "string") {
        void this.refreshSceneItems(sceneName).then(() => {
          this.emitStatus();
          this.onTransforms();
        });
      }
    }
  }

  private onResponse(d: any): void {
    const id = d?.requestId;
    if (id && this.pending.has(id)) {
      this.pending.get(id)!(d);
      this.pending.delete(id);
    }
  }

  private async refreshScenes(): Promise<void> {
    const resp = await this.request("GetSceneList");
    const data = resp?.responseData;
    if (!data) return;
    const scenes = Array.isArray(data.scenes)
      ? data.scenes
          .map((s: any) => s?.sceneName)
          .filter((n: any): n is string => typeof n === "string")
      : [];
    this.status = {
      ...this.status,
      scenes,
      currentScene: data.currentProgramSceneName ?? this.status.currentScene,
    };
  }

  /** Read the OBS base (canvas) resolution — transforms are in these pixels. */
  private async refreshVideoSettings(): Promise<void> {
    const resp = await this.request("GetVideoSettings");
    const data = resp?.responseData;
    const w = Number(data?.baseWidth);
    const h = Number(data?.baseHeight);
    if (isFinite(w) && w > 0 && isFinite(h) && h > 0) this.base = { width: w, height: h };
  }

  /** Refresh scene-item lists + transforms for every known scene. */
  private async refreshAllSceneItems(): Promise<void> {
    this.itemsByScene.clear();
    this.transforms.clear();
    for (const scene of this.status.scenes) await this.refreshSceneItems(scene);
    this.recomputeSources();
  }

  /** Refresh one scene's item list + each item's transform. */
  private async refreshSceneItems(sceneName: string): Promise<void> {
    const resp = await this.request("GetSceneItemList", { sceneName });
    const items = resp?.responseData?.sceneItems;
    if (!Array.isArray(items)) return;

    const byId = new Map<number, string>();
    // Drop this scene's stale transforms before re-adding current ones.
    for (const key of [...this.transforms.keys()]) {
      if (key.startsWith(`${sceneName}|`)) this.transforms.delete(key);
    }
    for (const item of items) {
      const sourceName = item?.sourceName;
      const itemId = Number(item?.sceneItemId);
      if (typeof sourceName !== "string" || !isFinite(itemId)) continue;
      byId.set(itemId, sourceName);
      const box = this.boxFromTransform(item?.sceneItemTransform);
      if (box) this.transforms.set(`${sceneName}|${sourceName}`, box);
    }
    this.itemsByScene.set(sceneName, byId);
    this.recomputeSources();
  }

  /** Rebuild the source-name lists shown in the picker (flat + per-scene). */
  private recomputeSources(): void {
    const set = new Set<string>();
    const byScene: Record<string, string[]> = {};
    for (const [sceneName, byId] of this.itemsByScene.entries()) {
      const names = new Set<string>();
      for (const name of byId.values()) {
        set.add(name);
        names.add(name);
      }
      byScene[sceneName] = [...names].sort();
    }
    this.status = { ...this.status, sources: [...set].sort(), sourcesByScene: byScene };
  }

  /**
   * Convert an OBS scene-item transform into a normalized (0..1) on-screen box.
   * OBS gives the final rendered width/height (scale + crop + bounds already
   * applied); positionX/Y is the anchor point named by `alignment`, which we
   * resolve back to the top-left corner. Rotation is ignored (v1).
   */
  private boxFromTransform(t: any): ObsBox | null {
    if (!t) return null;
    const w = Number(t.width);
    const h = Number(t.height);
    if (!isFinite(w) || w <= 0 || !isFinite(h) || h <= 0) return null;
    const px = Number(t.positionX) || 0;
    const py = Number(t.positionY) || 0;
    const a = Number(t.alignment) || 0;

    let x = px;
    if (a & ALIGN_RIGHT) x = px - w;
    else if (!(a & ALIGN_LEFT)) x = px - w / 2; // horizontally centered

    let y = py;
    if (a & ALIGN_BOTTOM) y = py - h;
    else if (!(a & ALIGN_TOP)) y = py - h / 2; // vertically centered

    return {
      x: x / this.base.width,
      y: y / this.base.height,
      w: w / this.base.width,
      h: h / this.base.height,
    };
  }

  private request(requestType: string, requestData?: unknown): Promise<any> {
    return new Promise((resolve) => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        resolve(null);
        return;
      }
      const requestId = `r${++this.reqId}`;
      this.pending.set(requestId, resolve);
      this.send({ op: OP_REQUEST, d: { requestType, requestId, requestData } });
      setTimeout(() => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId);
          resolve(null);
        }
      }, REQUEST_TIMEOUT_MS);
    });
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private scheduleReconnect(error?: string): void {
    this.teardown(false);
    this.status = { ...this.status, connected: false, error };
    this.emitStatus();
    if (this.config.enabled) {
      this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_MS);
    }
  }

  private teardown(resetStatus = true): void {
    this.clearTimers();
    if (this.ws) {
      this.ws.removeAllListeners();
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.pending.clear();
    this.itemsByScene.clear();
    this.transforms.clear();
    if (resetStatus) {
      this.status = { ...this.status, connected: false, sources: [], sourcesByScene: {} };
    }
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private emitStatus(): void {
    this.onStatus(this.status);
  }
}

function sha256b64(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("base64");
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

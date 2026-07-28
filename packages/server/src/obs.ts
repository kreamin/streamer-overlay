import WebSocket from "ws";
import crypto from "node:crypto";
import type { ObsConfig } from "@stream-overlay/shared";

export interface ObsStatus {
  enabled: boolean;
  connected: boolean;
  error?: string;
  currentScene?: string;
  scenes: string[];
}

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
  private status: ObsStatus = { enabled: false, connected: false, scenes: [] };

  constructor(
    private readonly onSceneChange: (obsSceneName: string) => void,
    private readonly onStatus: (status: ObsStatus) => void,
  ) {}

  getStatus(): ObsStatus {
    return this.status;
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
    const d: any = { rpcVersion: 1, eventSubscriptions: EVENT_SUB_ALL };
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
    this.emitStatus();
    // Align immediately with whatever scene OBS is already on.
    if (this.status.currentScene) this.onSceneChange(this.status.currentScene);
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
      void this.refreshScenes().then(() => this.emitStatus());
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
    if (resetStatus) this.status = { ...this.status, connected: false };
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

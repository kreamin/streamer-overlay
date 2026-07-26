import WebSocket from "ws";
import type { StreamerbotConfig, Variables } from "@stream-overlay/shared";

export interface StreamerbotStatus {
  enabled: boolean;
  connected: boolean;
  error?: string;
  globalCount: number;
}

const POLL_MS = 3000;
const RECONNECT_MS = 3000;
const REQUEST_TIMEOUT_MS = 5000;

/**
 * Connects to a Streamer.bot WebSocket Server (pull model) and mirrors all of
 * its global variables into the variable store. Uses the raw JSON protocol
 * directly (the official client library was unreliable against SB here).
 *
 * Streamer.bot pushes a "Hello" on connect (ignored), then answers requests
 * like {request:"GetGlobals", id, persisted} with {id, variables:{...}}.
 */
export class StreamerbotConnector {
  private config: StreamerbotConfig = { enabled: false, host: "127.0.0.1", port: 8080 };
  private ws: WebSocket | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reqId = 0;
  private pending = new Map<string, (data: unknown) => void>();
  private status: StreamerbotStatus = {
    enabled: false,
    connected: false,
    globalCount: 0,
  };

  constructor(
    private readonly onVariables: (vars: Variables) => void,
    private readonly onStatus: (status: StreamerbotStatus) => void,
  ) {}

  getStatus(): StreamerbotStatus {
    return this.status;
  }

  /** Apply a new config; (re)connects or disconnects as needed. */
  configure(config: StreamerbotConfig): void {
    const changed =
      config.enabled !== this.config.enabled ||
      config.host !== this.config.host ||
      config.port !== this.config.port;
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
    const url = `ws://${this.config.host}:${this.config.port}/`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this.scheduleReconnect(errMsg(err));
      return;
    }
    this.ws = ws;

    ws.on("open", () => {
      this.status = { ...this.status, connected: true, error: undefined };
      this.emitStatus();
      void this.fetchGlobals();
      this.pollTimer = setInterval(() => void this.fetchGlobals(), POLL_MS);
    });

    ws.on("message", (raw) => {
      let msg: { id?: string } | undefined;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg?.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)!(msg);
        this.pending.delete(msg.id);
      }
    });

    ws.on("error", (err) => {
      this.status = { ...this.status, error: errMsg(err) };
    });
    ws.on("close", () => {
      if (this.config.enabled) this.scheduleReconnect(this.status.error ?? "disconnected");
    });
  }

  private async fetchGlobals(): Promise<void> {
    const [persisted, runtime] = await Promise.all([
      this.request("GetGlobals", { persisted: true }),
      this.request("GetGlobals", { persisted: false }),
    ]);
    const vars: Variables = {};
    collectGlobals(persisted, vars);
    collectGlobals(runtime, vars);

    this.status = { ...this.status, globalCount: Object.keys(vars).length };
    this.onVariables(vars);
    this.emitStatus();
  }

  private request(request: string, extra: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve) => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        resolve(null);
        return;
      }
      const id = `r${++this.reqId}`;
      this.pending.set(id, resolve);
      ws.send(JSON.stringify({ request, id, ...extra }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resolve(null);
        }
      }, REQUEST_TIMEOUT_MS);
    });
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
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private emitStatus(): void {
    this.onStatus(this.status);
  }
}

/** Pull { name: value } out of a GetGlobals response into `out`. */
function collectGlobals(resp: unknown, out: Variables): void {
  const variables = (resp as { variables?: Record<string, { value?: unknown }> })?.variables;
  if (!variables || typeof variables !== "object") return;
  for (const [name, def] of Object.entries(variables)) {
    const value = def?.value;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[name] = value;
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

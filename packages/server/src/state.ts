import fs from "node:fs/promises";
import path from "node:path";
import { CANVAS } from "./constants.js";
import type {
  AppState,
  FieldValue,
  OverlayInstance,
  OverlayPosition,
  OverlaySize,
  StreamerbotConfig,
  Variables,
} from "@stream-overlay/shared";

const DEFAULT_STREAMERBOT: StreamerbotConfig = {
  enabled: false,
  host: "127.0.0.1",
  port: 8080,
};

/**
 * Owns the single source-of-truth AppState and persists it to a JSON file.
 * Saves are debounced so rapid drags don't hammer the disk.
 */
export class StateStore {
  private state: AppState;
  private saveTimer?: NodeJS.Timeout;

  private constructor(
    state: AppState,
    private readonly dataFile: string,
  ) {
    this.state = state;
  }

  static async load(dataFile: string): Promise<StateStore> {
    await fs.mkdir(path.dirname(dataFile), { recursive: true });
    try {
      const raw = await fs.readFile(dataFile, "utf8");
      const parsed = JSON.parse(raw) as AppState;
      if (!parsed.canvas) parsed.canvas = { ...CANVAS };
      if (!Array.isArray(parsed.instances)) parsed.instances = [];
      if (!parsed.streamerbot) parsed.streamerbot = { ...DEFAULT_STREAMERBOT };
      return new StateStore(parsed, dataFile);
    } catch {
      return new StateStore(
        { canvas: { ...CANVAS }, instances: [], streamerbot: { ...DEFAULT_STREAMERBOT } },
        dataFile,
      );
    }
  }

  get(): AppState {
    return this.state;
  }

  nextZ(): number {
    return this.state.instances.reduce((max, i) => Math.max(max, i.z), 0) + 1;
  }

  addInstance(instance: OverlayInstance): void {
    this.state.instances.push(instance);
    this.touched();
  }

  removeInstance(instanceId: string): void {
    this.state.instances = this.state.instances.filter(
      (i) => i.instanceId !== instanceId,
    );
    this.touched();
  }

  setActive(instanceId: string, active: boolean): void {
    const inst = this.find(instanceId);
    if (!inst) return;
    inst.active = active;
    this.touched();
  }

  setLayout(
    instanceId: string,
    layout: { position?: OverlayPosition; size?: OverlaySize; z?: number },
  ): void {
    const inst = this.find(instanceId);
    if (!inst) return;
    if (layout.position) inst.position = layout.position;
    if (layout.size) inst.size = layout.size;
    if (typeof layout.z === "number") inst.z = layout.z;
    this.touched();
  }

  setValue(instanceId: string, fieldId: string, value: FieldValue): void {
    const inst = this.find(instanceId);
    if (!inst) return;
    inst.values[fieldId] = value;
    this.touched();
  }

  adjustValue(instanceId: string, fieldId: string, delta: number): void {
    const inst = this.find(instanceId);
    if (!inst) return;
    const current = inst.values[fieldId];
    const base = typeof current === "number" ? current : Number(current) || 0;
    inst.values[fieldId] = base + delta;
    this.touched();
  }

  /** Bind a field to a live variable, or pass null to return it to manual. */
  setBinding(instanceId: string, fieldId: string, variableKey: string | null): void {
    const inst = this.find(instanceId);
    if (!inst) return;
    if (!inst.bindings) inst.bindings = {};
    if (variableKey) inst.bindings[fieldId] = variableKey;
    else delete inst.bindings[fieldId];
    this.touched();
  }

  /**
   * Push current variable values into any fields bound to them.
   * Returns true if any value actually changed (so callers can skip broadcasts).
   */
  applyBoundValues(variables: Variables): boolean {
    let changed = false;
    for (const inst of this.state.instances) {
      if (!inst.bindings) continue;
      for (const [fieldId, key] of Object.entries(inst.bindings)) {
        if (key in variables && inst.values[fieldId] !== variables[key]) {
          inst.values[fieldId] = variables[key];
          changed = true;
        }
      }
    }
    if (changed) this.touched();
    return changed;
  }

  /**
   * Change the canvas (output) resolution. Existing overlays are rescaled
   * proportionally so the layout stays visually the same at the new size.
   */
  setCanvas(width: number, height: number): void {
    const clamp = (n: number) => Math.min(7680, Math.max(320, Math.round(n)));
    const w = clamp(width);
    const h = clamp(height);
    const old = this.state.canvas;
    if (old.width === w && old.height === h) return;
    const rx = w / old.width;
    const ry = h / old.height;
    this.state.canvas = { width: w, height: h };
    for (const inst of this.state.instances) {
      inst.position = {
        x: Math.round(inst.position.x * rx),
        y: Math.round(inst.position.y * ry),
      };
      inst.size = {
        width: Math.round(inst.size.width * rx),
        height: Math.round(inst.size.height * ry),
      };
    }
    this.touched();
  }

  /** Update the Streamer.bot connection config; returns the resolved config. */
  setStreamerbot(patch: {
    enabled?: boolean;
    host?: string;
    port?: number;
  }): StreamerbotConfig {
    const cur = this.state.streamerbot;
    const port = patch.port ?? cur.port;
    const next: StreamerbotConfig = {
      enabled: patch.enabled ?? cur.enabled,
      host: (patch.host ?? cur.host).trim() || "127.0.0.1",
      port: Math.min(65535, Math.max(1, Math.round(port))),
    };
    this.state.streamerbot = next;
    this.touched();
    return next;
  }

  private find(instanceId: string): OverlayInstance | undefined {
    return this.state.instances.find((i) => i.instanceId === instanceId);
  }

  private touched(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void fs
        .writeFile(this.dataFile, JSON.stringify(this.state, null, 2))
        .catch((err) => console.error("[state] save failed:", err));
    }, 300);
  }
}

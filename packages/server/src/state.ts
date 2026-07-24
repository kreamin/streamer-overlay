import fs from "node:fs/promises";
import { CANVAS, DATA_DIR, STATE_FILE } from "./config.js";
import type {
  AppState,
  FieldValue,
  OverlayInstance,
  OverlayPosition,
  OverlaySize,
} from "@stream-overlay/shared";

/**
 * Owns the single source-of-truth AppState and persists it to data/state.json.
 * Saves are debounced so rapid drags don't hammer the disk.
 */
export class StateStore {
  private state: AppState;
  private saveTimer?: NodeJS.Timeout;

  private constructor(state: AppState) {
    this.state = state;
  }

  static async load(): Promise<StateStore> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
      const raw = await fs.readFile(STATE_FILE, "utf8");
      const parsed = JSON.parse(raw) as AppState;
      if (!parsed.canvas) parsed.canvas = { ...CANVAS };
      if (!Array.isArray(parsed.instances)) parsed.instances = [];
      return new StateStore(parsed);
    } catch {
      return new StateStore({ canvas: { ...CANVAS }, instances: [] });
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

  private find(instanceId: string): OverlayInstance | undefined {
    return this.state.instances.find((i) => i.instanceId === instanceId);
  }

  private touched(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void fs
        .writeFile(STATE_FILE, JSON.stringify(this.state, null, 2))
        .catch((err) => console.error("[state] save failed:", err));
    }, 300);
  }
}

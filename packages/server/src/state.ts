import fs from "node:fs/promises";
import path from "node:path";
import { CANVAS } from "./constants.js";
import type {
  AppState,
  FieldValue,
  ObsConfig,
  OverlayInstance,
  OverlayPosition,
  OverlaySize,
  Scene,
  StreamerbotConfig,
  Variables,
} from "@stream-overlay/shared";

const DEFAULT_STREAMERBOT: StreamerbotConfig = {
  enabled: false,
  host: "127.0.0.1",
  port: 8080,
};

const DEFAULT_OBS: ObsConfig = {
  enabled: false,
  host: "127.0.0.1",
  port: 4455,
  password: "",
};

function makeScene(name: string, instances: OverlayInstance[] = []): Scene {
  return { id: crypto.randomUUID(), name, instances };
}

/**
 * Bring any older/partial persisted state up to the current shape. Notably
 * migrates a pre-v0.3.0 flat `instances[]` into a single default scene.
 */
function normalize(parsed: Partial<AppState> & { instances?: OverlayInstance[] }): AppState {
  const canvas = parsed.canvas ?? { ...CANVAS };
  const streamerbot = parsed.streamerbot ?? { ...DEFAULT_STREAMERBOT };
  const obs = parsed.obs ? { ...DEFAULT_OBS, ...parsed.obs } : { ...DEFAULT_OBS };

  let scenes: Scene[] = Array.isArray(parsed.scenes) ? parsed.scenes : [];
  if (scenes.length === 0) {
    const legacy = Array.isArray(parsed.instances) ? parsed.instances : [];
    scenes = [makeScene("Scene 1", legacy)];
  }
  for (const s of scenes) if (!Array.isArray(s.instances)) s.instances = [];

  let currentSceneId = parsed.currentSceneId ?? "";
  if (!scenes.some((s) => s.id === currentSceneId)) currentSceneId = scenes[0].id;

  return { canvas, scenes, currentSceneId, streamerbot, obs };
}

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
      return new StateStore(normalize(JSON.parse(raw)), dataFile);
    } catch {
      return new StateStore(normalize({}), dataFile);
    }
  }

  get(): AppState {
    return this.state;
  }

  // --- scenes -------------------------------------------------------------

  /** The scene currently being rendered/edited (guaranteed to exist). */
  private current(): Scene {
    return (
      this.state.scenes.find((s) => s.id === this.state.currentSceneId) ??
      this.state.scenes[0]
    );
  }

  addScene(name?: string): void {
    const scene = makeScene((name ?? "").trim() || `Scene ${this.state.scenes.length + 1}`);
    this.state.scenes.push(scene);
    this.state.currentSceneId = scene.id; // jump to the new scene
    this.touched();
  }

  removeScene(sceneId: string): void {
    if (this.state.scenes.length <= 1) return; // always keep at least one
    this.state.scenes = this.state.scenes.filter((s) => s.id !== sceneId);
    if (!this.state.scenes.some((s) => s.id === this.state.currentSceneId)) {
      this.state.currentSceneId = this.state.scenes[0].id;
    }
    this.touched();
  }

  renameScene(sceneId: string, name: string): void {
    const scene = this.state.scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    scene.name = name.trim() || scene.name;
    this.touched();
  }

  setCurrentScene(sceneId: string): void {
    if (!this.state.scenes.some((s) => s.id === sceneId)) return;
    this.state.currentSceneId = sceneId;
    this.touched();
  }

  setSceneLiveDrag(sceneId: string, liveDrag: boolean): void {
    const scene = this.state.scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    scene.liveDrag = liveDrag;
    this.touched();
  }

  // --- instances (added to / z-ordered within the current scene) ----------

  nextZ(): number {
    return this.current().instances.reduce((max, i) => Math.max(max, i.z), 0) + 1;
  }

  addInstance(instance: OverlayInstance): void {
    this.current().instances.push(instance);
    this.touched();
  }

  removeInstance(instanceId: string): void {
    for (const scene of this.state.scenes) {
      scene.instances = scene.instances.filter((i) => i.instanceId !== instanceId);
    }
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

  /** Lock an instance's layout to an OBS source (null clears the lock). */
  setInstanceObsSource(instanceId: string, obsSource: string | null): void {
    const inst = this.find(instanceId);
    if (!inst) return;
    const name = (obsSource ?? "").trim();
    if (name) inst.obsSource = name;
    else delete inst.obsSource;
    this.touched();
  }

  /** Tune an existing OBS-source lock: size behavior + position offset. */
  setInstanceObsLock(
    instanceId: string,
    patch: { matchSize?: boolean; offsetX?: number; offsetY?: number },
  ): void {
    const inst = this.find(instanceId);
    if (!inst) return;
    if (patch.matchSize !== undefined) inst.obsMatchSize = patch.matchSize;
    if (patch.offsetX !== undefined) inst.obsOffsetX = Math.round(patch.offsetX);
    if (patch.offsetY !== undefined) inst.obsOffsetY = Math.round(patch.offsetY);
    this.touched();
  }

  /**
   * Apply an OBS-driven layout to a locked instance. Rounds to whole pixels and
   * only writes/persists when something actually moved (so live transform
   * events don't spam saves). Returns true if the layout changed.
   */
  applyObsLayout(instanceId: string, position: OverlayPosition, size: OverlaySize): boolean {
    const inst = this.find(instanceId);
    if (!inst) return false;
    const x = Math.round(position.x);
    const y = Math.round(position.y);
    const w = Math.round(size.width);
    const h = Math.round(size.height);
    if (
      inst.position.x === x &&
      inst.position.y === y &&
      inst.size.width === w &&
      inst.size.height === h
    ) {
      return false;
    }
    inst.position = { x, y };
    inst.size = { width: w, height: h };
    this.touched();
    return true;
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
   * Push current variable values into any fields bound to them (across ALL
   * scenes, so bindings stay live for scenes that aren't currently showing).
   * Returns true if any value actually changed (so callers can skip broadcasts).
   */
  applyBoundValues(variables: Variables): boolean {
    let changed = false;
    for (const scene of this.state.scenes) {
      for (const inst of scene.instances) {
        if (!inst.bindings) continue;
        for (const [fieldId, key] of Object.entries(inst.bindings)) {
          if (key in variables && inst.values[fieldId] !== variables[key]) {
            inst.values[fieldId] = variables[key];
            changed = true;
          }
        }
      }
    }
    if (changed) this.touched();
    return changed;
  }

  /**
   * Change the canvas (output) resolution. Existing overlays in every scene are
   * rescaled proportionally so layouts stay visually the same at the new size.
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
    for (const scene of this.state.scenes) {
      for (const inst of scene.instances) {
        inst.position = {
          x: Math.round(inst.position.x * rx),
          y: Math.round(inst.position.y * ry),
        };
        inst.size = {
          width: Math.round(inst.size.width * rx),
          height: Math.round(inst.size.height * ry),
        };
      }
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

  /** Update the OBS connection config; returns the resolved config. */
  setObs(patch: {
    enabled?: boolean;
    host?: string;
    port?: number;
    password?: string;
  }): ObsConfig {
    const cur = this.state.obs;
    const port = patch.port ?? cur.port;
    const next: ObsConfig = {
      enabled: patch.enabled ?? cur.enabled,
      host: (patch.host ?? cur.host).trim() || "127.0.0.1",
      port: Math.min(65535, Math.max(1, Math.round(port))),
      password: patch.password ?? cur.password,
    };
    this.state.obs = next;
    this.touched();
    return next;
  }

  /** Link an app scene to an OBS scene name (null/"" clears the link). */
  setSceneObsLink(sceneId: string, obsSceneName: string | null): void {
    const scene = this.state.scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    const name = (obsSceneName ?? "").trim();
    if (name) scene.obsSceneName = name;
    else delete scene.obsSceneName;
    this.touched();
  }

  /**
   * Switch to the app scene linked to the given OBS scene name (driven by OBS).
   * Returns true if a linked scene was found and became current.
   */
  setCurrentSceneByObsName(obsSceneName: string): boolean {
    const scene = this.state.scenes.find((s) => s.obsSceneName === obsSceneName);
    if (!scene || scene.id === this.state.currentSceneId) return false;
    this.state.currentSceneId = scene.id;
    this.touched();
    return true;
  }

  /** Find an instance by id across all scenes (ids are globally unique). */
  private find(instanceId: string): OverlayInstance | undefined {
    for (const scene of this.state.scenes) {
      const inst = scene.instances.find((i) => i.instanceId === instanceId);
      if (inst) return inst;
    }
    return undefined;
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

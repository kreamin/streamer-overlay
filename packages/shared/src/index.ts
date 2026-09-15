// ============================================================================
// Shared types — the "contract" spoken by the server, overlay page, and
// control panel. If you change a message shape, change it here once.
// ============================================================================

// ---- Overlay package format (manifest.json) -------------------------------

export type FieldType = "number" | "text" | "boolean" | "color" | "image" | "audio" | "trigger";

/** A single configurable field an overlay declares in its manifest. */
export interface OverlayFieldDef {
  id: string;
  label: string;
  type: FieldType;
  default: FieldValue;
  /** If true, the control panel shows prominent quick-adjust (+/-) controls. */
  live?: boolean;
  /** Step size for number quick-adjust buttons. */
  step?: number;
  min?: number;
  max?: number;
}

export type FieldValue = number | string | boolean;

export interface OverlaySize {
  width: number;
  height: number;
}

export interface OverlayPosition {
  x: number;
  y: number;
}

/** Parsed contents of an overlay package's manifest.json. */
export interface OverlayManifest {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  defaultSize: OverlaySize;
  fields: OverlayFieldDef[];
}

/** An overlay package discovered on disk. */
export interface InstalledOverlay {
  manifest: OverlayManifest;
  /** URL the overlay page loads in a sandboxed iframe, e.g. /overlays/foo/index.html */
  entryUrl: string;
}

// ---- Runtime state (what's actually on screen) ----------------------------

/**
 * A placed, live copy of an overlay. Separating "instance" from "installed
 * overlay" means you can drop two subscriber-goal bars on screen later, each
 * with its own position and values.
 */
export interface OverlayInstance {
  instanceId: string;
  overlayId: string;
  active: boolean;
  position: OverlayPosition;
  size: OverlaySize;
  values: Record<string, FieldValue>;
  /**
   * Per-field live bindings: fieldId -> variable key. When set, the server keeps
   * that field's value in sync with the named variable (e.g. from Streamer.bot).
   * A field with no entry here is "manual" (edited by hand in the control panel).
   */
  bindings?: Record<string, string>;
  /**
   * When set, this instance's position (and, unless obsMatchSize is false, its
   * size) are locked to an OBS source of this name — its scene-item transform,
   * one-way OBS → app. The app rescales the OBS transform into canvas space and
   * keeps it in sync live.
   */
  obsSource?: string;
  /**
   * If false, the lock follows the source's POSITION only and the element keeps
   * its own size (e.g. a small sub-goal parked in the webcam's corner). Undefined
   * or true = match the source's size too (e.g. a border/frame). Only meaningful
   * with obsSource set.
   */
  obsMatchSize?: boolean;
  /** Canvas-pixel nudge applied to the locked position (QOL / fine alignment). */
  obsOffsetX?: number;
  obsOffsetY?: number;
  /** Stacking order; higher renders on top. */
  z: number;
}

/** Live variables pushed in by integrations (key -> value). */
export type Variables = Record<string, FieldValue>;

/** What a hotkey does when fired (by a keyboard shortcut or the /api/action URL). */
export type HotkeyTarget =
  // Fire an overlay instance's trigger (e.g. roll the dice, play a gif alert).
  | { kind: "pulse"; instanceId: string }
  // Toggle an overlay instance's visibility (show/hide in OBS).
  | { kind: "toggleActive"; instanceId: string }
  // Switch the app to a scene.
  | { kind: "switchScene"; sceneId: string };

/**
 * A user-defined action, fireable two ways: a global keyboard shortcut (captured
 * by the desktop app) and an HTTP URL `/api/action/<slug>` (for Stream Deck via
 * Companion / an HTTP-request button). Both run the same `target`.
 */
export interface HotkeyAction {
  id: string;
  label: string;
  /** Electron accelerator, e.g. "CommandOrControl+Alt+L". Empty = no keyboard shortcut. */
  shortcut?: string;
  target: HotkeyTarget;
}

/** URL-safe slug for a hotkey's /api/action/<slug> endpoint (falls back to its id). */
export function hotkeySlug(action: HotkeyAction): string {
  const s = action.label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || action.id;
}

/**
 * A named collection of placed overlays. Each scene owns its own instances, so
 * switching scenes swaps which overlays render (mirrors OBS scenes). The output
 * resolution (canvas) is shared across all scenes.
 */
export interface Scene {
  id: string;
  name: string;
  instances: OverlayInstance[];
  /** OBS scene name this app-scene follows (set in v0.3.0 Slice 2). */
  obsSceneName?: string;
  /** Stream layout to OBS continuously while dragging/resizing (vs only on release). */
  liveDrag?: boolean;
}

/** Configuration for the Streamer.bot pull connection (persisted in AppState). */
export interface StreamerbotConfig {
  enabled: boolean;
  host: string;
  port: number;
}

/** Configuration for the OBS (obs-websocket v5) connection (persisted in AppState). */
export interface ObsConfig {
  enabled: boolean;
  host: string;
  port: number;
  /** obs-websocket server password (blank if auth is disabled in OBS). */
  password: string;
}

/** Runtime status of external integrations. */
export interface IntegrationStatus {
  streamerbot: {
    enabled: boolean;
    connected: boolean;
    error?: string;
    /** How many Streamer.bot globals are currently available as variables. */
    globalCount: number;
  };
  obs: {
    enabled: boolean;
    connected: boolean;
    error?: string;
    /** The OBS program scene currently live (for the UI). */
    currentScene?: string;
    /** All OBS scene names, for the per-scene link picker. */
    scenes: string[];
    /** All OBS source (scene-item) names, deduped — for lock pickers on unlinked scenes. */
    sources: string[];
    /** Source (scene-item) names per OBS scene — used when an app scene is OBS-linked. */
    sourcesByScene: Record<string, string[]>;
  };
  /** Number of push clients connected to the /ingest endpoint (advanced). */
  ingestClients: number;
}

export interface CanvasConfig {
  width: number;
  height: number;
}

/** The full shared state the server owns and persists. */
export interface AppState {
  canvas: CanvasConfig;
  /** All scenes; each owns its overlays. Always at least one. */
  scenes: Scene[];
  /** The scene currently rendered (and edited in the control panel). */
  currentSceneId: string;
  streamerbot: StreamerbotConfig;
  obs: ObsConfig;
  /** User-defined hotkeys/actions (keyboard shortcut + Stream Deck URL). */
  hotkeys: HotkeyAction[];
}

/** The scene that's currently live (rendered + edited). Falls back to the first. */
export function activeScene(state: AppState): Scene {
  return state.scenes.find((s) => s.id === state.currentSceneId) ?? state.scenes[0];
}

// ---- Websocket protocol ----------------------------------------------------

/** Messages the server sends to connected clients. */
export type ServerMessage =
  | {
      type: "hello";
      state: AppState;
      installed: InstalledOverlay[];
      variables: Variables;
      integration: IntegrationStatus;
      /** App version (from the desktop build), for display/debugging. "dev" in dev. */
      version: string;
    }
  | { type: "state"; state: AppState }
  | { type: "installed"; installed: InstalledOverlay[] }
  | { type: "variables"; variables: Variables }
  | { type: "integration"; integration: IntegrationStatus }
  // One-shot "play now" pulse for a specific overlay instance (e.g. gif alerts).
  | { type: "pulse"; instanceId: string }
  // Per-hotkey keyboard-registration results (hotkeyId -> registered ok?).
  | { type: "hotkeyStatus"; results: Record<string, boolean> };

/** Messages clients (control panel) send to the server. */
export type ClientMessage =
  // Scene management (instance ops below act on the current scene).
  | { type: "addScene"; name?: string }
  | { type: "removeScene"; sceneId: string }
  | { type: "renameScene"; sceneId: string; name: string }
  | { type: "setCurrentScene"; sceneId: string }
  | { type: "setSceneLiveDrag"; sceneId: string; liveDrag: boolean }
  | { type: "addInstance"; overlayId: string }
  | { type: "removeInstance"; instanceId: string }
  | { type: "setActive"; instanceId: string; active: boolean }
  | {
      type: "setLayout";
      instanceId: string;
      position?: OverlayPosition;
      size?: OverlaySize;
      z?: number;
    }
  | { type: "setValue"; instanceId: string; fieldId: string; value: FieldValue }
  | { type: "adjustValue"; instanceId: string; fieldId: string; delta: number }
  // Bind a field to a live variable (null = back to manual).
  | { type: "setBinding"; instanceId: string; fieldId: string; variableKey: string | null }
  // Change the output/canvas resolution (overlays rescale proportionally).
  | { type: "setCanvas"; width: number; height: number }
  // Enable/disable or reconfigure the Streamer.bot pull connection.
  | { type: "setStreamerbot"; enabled?: boolean; host?: string; port?: number }
  // Enable/disable or reconfigure the OBS (obs-websocket) connection.
  | { type: "setObs"; enabled?: boolean; host?: string; port?: number; password?: string }
  // Link an app scene to an OBS scene name (null = unlink).
  | { type: "setSceneObsLink"; sceneId: string; obsSceneName: string | null }
  // Lock an instance's position/size to an OBS source's transform (null = unlock).
  | { type: "setInstanceObsSource"; instanceId: string; obsSource: string | null }
  // Tune an existing OBS-source lock: size behavior + position offset.
  | {
      type: "setInstanceObsLock";
      instanceId: string;
      matchSize?: boolean;
      offsetX?: number;
      offsetY?: number;
    }
  // Manually trigger an overlay instance to play (e.g. the gif alert Play button).
  | { type: "play"; instanceId: string }
  // Hotkeys / actions (fireable by keyboard shortcut or the /api/action URL).
  | { type: "addHotkey" }
  | { type: "removeHotkey"; hotkeyId: string }
  | {
      type: "updateHotkey";
      hotkeyId: string;
      label?: string;
      shortcut?: string | null;
      target?: HotkeyTarget;
    };

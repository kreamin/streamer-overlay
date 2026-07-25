// ============================================================================
// Shared types — the "contract" spoken by the server, overlay page, and
// control panel. If you change a message shape, change it here once.
// ============================================================================

// ---- Overlay package format (manifest.json) -------------------------------

export type FieldType = "number" | "text" | "boolean" | "color";

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
  /** Stacking order; higher renders on top. */
  z: number;
}

/** Live variables pushed in by integrations (key -> value). */
export type Variables = Record<string, FieldValue>;

/** Status of external integrations that push variables to the server. */
export interface IntegrationStatus {
  /** Whether a Streamer.bot (or other) client is connected to the ingest endpoint. */
  streamerbotConnected: boolean;
}

export interface CanvasConfig {
  width: number;
  height: number;
}

/** The full shared state the server owns and persists. */
export interface AppState {
  canvas: CanvasConfig;
  instances: OverlayInstance[];
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
    }
  | { type: "state"; state: AppState }
  | { type: "installed"; installed: InstalledOverlay[] }
  | { type: "variables"; variables: Variables }
  | { type: "integration"; integration: IntegrationStatus };

/** Messages clients (control panel) send to the server. */
export type ClientMessage =
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
  | { type: "setBinding"; instanceId: string; fieldId: string; variableKey: string | null };

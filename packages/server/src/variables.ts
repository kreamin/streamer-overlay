import type { FieldValue, Variables } from "@stream-overlay/shared";

/**
 * Holds the latest live values pushed in by integrations (e.g. Streamer.bot),
 * keyed by variable name. Runtime-only — not persisted.
 */
export class VariableStore {
  private vars = new Map<string, FieldValue>();

  set(key: string, value: FieldValue): void {
    this.vars.set(key, value);
  }

  get(key: string): FieldValue | undefined {
    return this.vars.get(key);
  }

  all(): Variables {
    return Object.fromEntries(this.vars);
  }
}

import chokidar from "chokidar";
import fs from "node:fs/promises";
import path from "node:path";
import type { InstalledOverlay, OverlayManifest } from "@stream-overlay/shared";

type Listener = (list: InstalledOverlay[]) => void;

/**
 * Watches the overlays/ folder. Each subfolder with a valid manifest.json is an
 * installed overlay. Rescans (debounced) whenever anything in the folder changes,
 * so dropping in a new overlay makes it appear without a restart.
 */
export class OverlayRegistry {
  private installed = new Map<string, InstalledOverlay>();
  private listeners = new Set<Listener>();
  private scanQueued = false;

  constructor(private readonly overlaysDir: string) {}

  async start(): Promise<void> {
    await fs.mkdir(this.overlaysDir, { recursive: true });
    const watcher = chokidar.watch(this.overlaysDir, {
      ignoreInitial: true,
      depth: 2,
    });
    watcher.on("all", () => this.queueScan());
    await this.scan();
  }

  list(): InstalledOverlay[] {
    return [...this.installed.values()];
  }

  find(overlayId: string): InstalledOverlay | undefined {
    return this.installed.get(overlayId);
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private queueScan(): void {
    if (this.scanQueued) return;
    this.scanQueued = true;
    setTimeout(() => {
      this.scanQueued = false;
      void this.scan();
    }, 200);
  }

  private async scan(): Promise<void> {
    const next = new Map<string, InstalledOverlay>();
    let dirs: string[] = [];
    try {
      const entries = await fs.readdir(this.overlaysDir, { withFileTypes: true });
      dirs = entries.filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      // folder missing — treated as no overlays installed
    }

    for (const dir of dirs) {
      const manifestPath = path.join(this.overlaysDir, dir, "manifest.json");
      let manifest: OverlayManifest;
      try {
        manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as OverlayManifest;
      } catch {
        continue; // no manifest / invalid JSON — not an overlay package
      }
      const problem = validate(manifest);
      if (problem) {
        console.warn(`[registry] ignoring "${dir}": ${problem}`);
        continue;
      }
      next.set(manifest.id, {
        manifest,
        entryUrl: `/overlays/${encodeURIComponent(dir)}/index.html`,
      });
    }

    this.installed = next;
    console.log(
      `[registry] ${next.size} overlay(s): ${[...next.keys()].join(", ") || "(none)"}`,
    );
    for (const fn of this.listeners) fn(this.list());
  }
}

function validate(m: OverlayManifest): string | null {
  if (!m || typeof m !== "object") return "manifest is not an object";
  if (!m.id) return "missing id";
  if (!m.name) return "missing name";
  if (!m.defaultSize || typeof m.defaultSize.width !== "number") {
    return "missing defaultSize.width/height";
  }
  if (!Array.isArray(m.fields)) return "fields must be an array";
  return null;
}

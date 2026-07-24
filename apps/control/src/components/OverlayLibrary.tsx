import type { ClientMessage, InstalledOverlay } from "@stream-overlay/shared";

/** The list of installed overlay packages (from the watched folder). */
export function OverlayLibrary({
  installed,
  send,
}: {
  installed: InstalledOverlay[];
  send: (msg: ClientMessage) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-white/40">
          Installed overlays
        </h2>
        <button
          onClick={() => void fetch("/api/open-overlays-folder", { method: "POST" })}
          className="rounded px-1.5 py-0.5 text-xs text-white/50 hover:bg-white/10 hover:text-white/80"
          title="Open the overlays folder to add or share overlays"
        >
          Open folder
        </button>
      </div>
      {installed.length === 0 ? (
        <p className="text-sm text-white/40">
          Drop a folder into <code>overlays/</code> to add one.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {installed.map((o) => (
            <li
              key={o.manifest.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{o.manifest.name}</div>
                {o.manifest.description && (
                  <div className="truncate text-xs text-white/40">
                    {o.manifest.description}
                  </div>
                )}
              </div>
              <button
                onClick={() => send({ type: "addInstance", overlayId: o.manifest.id })}
                className="shrink-0 rounded-md bg-indigo-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-400"
              >
                Add
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-white/40">
        Installed overlays
      </h2>
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

import type {
  AppState,
  ClientMessage,
  InstalledOverlay,
} from "@stream-overlay/shared";

/** The overlays currently placed on the canvas — toggle, select, remove. */
export function InstanceList({
  state,
  installed,
  selectedId,
  onSelect,
  send,
}: {
  state: AppState;
  installed: InstalledOverlay[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  send: (msg: ClientMessage) => void;
}) {
  const nameOf = (overlayId: string) =>
    installed.find((o) => o.manifest.id === overlayId)?.manifest.name ?? overlayId;

  return (
    <div>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-white/40">
        On canvas
      </h2>
      {state.instances.length === 0 ? (
        <p className="text-sm text-white/40">Nothing added yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {state.instances.map((inst) => {
            const selected = inst.instanceId === selectedId;
            return (
              <li
                key={inst.instanceId}
                onClick={() => onSelect(inst.instanceId)}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 ${
                  selected ? "bg-indigo-500/20 ring-1 ring-indigo-400/50" : "bg-white/5"
                }`}
              >
                <input
                  type="checkbox"
                  checked={inst.active}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    send({
                      type: "setActive",
                      instanceId: inst.instanceId,
                      active: e.target.checked,
                    })
                  }
                  className="size-4 accent-indigo-500"
                  title="Show in OBS"
                />
                <span
                  className={`flex-1 truncate text-sm ${
                    inst.active ? "" : "text-white/40 line-through"
                  }`}
                >
                  {nameOf(inst.overlayId)}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    send({ type: "removeInstance", instanceId: inst.instanceId });
                  }}
                  className="shrink-0 rounded px-1.5 text-white/40 hover:bg-red-500/20 hover:text-red-300"
                  title="Remove"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

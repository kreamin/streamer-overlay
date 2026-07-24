import type {
  ClientMessage,
  InstalledOverlay,
  OverlayFieldDef,
  OverlayInstance,
} from "@stream-overlay/shared";

/**
 * Auto-generates controls for the selected instance from its manifest fields.
 * `live` number fields get prominent +/- quick-adjust buttons (e.g. bump subs
 * mid-stream); everything else gets a plain input.
 */
export function FieldControls({
  instance,
  overlay,
  send,
  onBringToFront,
  onSendToBack,
}: {
  instance: OverlayInstance;
  overlay: InstalledOverlay;
  send: (msg: ClientMessage) => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
}) {
  return (
    <div>
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-white/40">
        {overlay.manifest.name}
      </h2>
      <p className="mb-3 text-xs text-white/30">Settings apply live to OBS.</p>

      <div className="mb-4 flex gap-2">
        <button
          onClick={onBringToFront}
          className="flex-1 rounded-md bg-white/10 px-2 py-1.5 text-xs font-medium hover:bg-white/20"
          title="Render on top of other overlays in OBS"
        >
          Bring to front
        </button>
        <button
          onClick={onSendToBack}
          className="flex-1 rounded-md bg-white/10 px-2 py-1.5 text-xs font-medium hover:bg-white/20"
          title="Render behind other overlays in OBS"
        >
          Send to back
        </button>
      </div>

      <div className="space-y-4">
        {overlay.manifest.fields.map((field) => (
          <Field
            key={field.id}
            field={field}
            value={instance.values[field.id]}
            onSet={(value) =>
              send({ type: "setValue", instanceId: instance.instanceId, fieldId: field.id, value })
            }
            onAdjust={(delta) =>
              send({
                type: "adjustValue",
                instanceId: instance.instanceId,
                fieldId: field.id,
                delta,
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

function Field({
  field,
  value,
  onSet,
  onAdjust,
}: {
  field: OverlayFieldDef;
  value: number | string | boolean | undefined;
  onSet: (value: number | string | boolean) => void;
  onAdjust: (delta: number) => void;
}) {
  const step = field.step ?? 1;

  return (
    <label className="block">
      <span className="mb-1 block text-sm text-white/70">{field.label}</span>

      {field.type === "number" && field.live ? (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onAdjust(-step)}
            className="size-9 rounded-md bg-white/10 text-lg font-bold hover:bg-white/20"
          >
            −
          </button>
          <input
            type="number"
            value={Number(value ?? 0)}
            min={field.min}
            max={field.max}
            onChange={(e) => onSet(Number(e.target.value))}
            className="w-full rounded-md bg-black/40 px-3 py-2 text-center tabular-nums outline-none ring-1 ring-white/10 focus:ring-indigo-400"
          />
          <button
            onClick={() => onAdjust(step)}
            className="size-9 rounded-md bg-white/10 text-lg font-bold hover:bg-white/20"
          >
            +
          </button>
        </div>
      ) : field.type === "number" ? (
        <input
          type="number"
          value={Number(value ?? 0)}
          min={field.min}
          max={field.max}
          onChange={(e) => onSet(Number(e.target.value))}
          className="w-full rounded-md bg-black/40 px-3 py-2 outline-none ring-1 ring-white/10 focus:ring-indigo-400"
        />
      ) : field.type === "boolean" ? (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onSet(e.target.checked)}
          className="size-5 accent-indigo-500"
        />
      ) : field.type === "color" ? (
        <input
          type="color"
          value={String(value ?? "#ffffff")}
          onChange={(e) => onSet(e.target.value)}
          className="h-9 w-full rounded-md bg-black/40 ring-1 ring-white/10"
        />
      ) : (
        <input
          type="text"
          value={String(value ?? "")}
          onChange={(e) => onSet(e.target.value)}
          className="w-full rounded-md bg-black/40 px-3 py-2 outline-none ring-1 ring-white/10 focus:ring-indigo-400"
        />
      )}
    </label>
  );
}

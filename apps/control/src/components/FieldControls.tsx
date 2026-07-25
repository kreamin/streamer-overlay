import type {
  ClientMessage,
  FieldValue,
  InstalledOverlay,
  OverlayFieldDef,
  OverlayInstance,
  Variables,
} from "@stream-overlay/shared";

/**
 * Auto-generates controls for the selected instance from its manifest fields.
 * Each field can be **Manual** (edited here) or **Live** (bound to a variable
 * pushed in by Streamer.bot). Live number fields still get quick −/+ buttons.
 */
export function FieldControls({
  instance,
  overlay,
  variables,
  send,
  onBringToFront,
  onSendToBack,
}: {
  instance: OverlayInstance;
  overlay: InstalledOverlay;
  variables: Variables;
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
            boundKey={instance.bindings?.[field.id]}
            variables={variables}
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
            onBind={(variableKey) =>
              send({
                type: "setBinding",
                instanceId: instance.instanceId,
                fieldId: field.id,
                variableKey,
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
  boundKey,
  variables,
  onSet,
  onAdjust,
  onBind,
}: {
  field: OverlayFieldDef;
  value: FieldValue | undefined;
  boundKey: string | undefined;
  variables: Variables;
  onSet: (value: FieldValue) => void;
  onAdjust: (delta: number) => void;
  onBind: (variableKey: string | null) => void;
}) {
  const step = field.step ?? 1;
  const variableKeys = Object.keys(variables);
  // Only show the source picker if there's something to bind to (or already bound).
  const showSource = variableKeys.length > 0 || boundKey;

  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-sm text-white/70">{field.label}</span>
        {showSource && (
          <select
            value={boundKey ?? ""}
            onChange={(e) => onBind(e.target.value || null)}
            className="max-w-[55%] truncate rounded bg-black/40 px-1.5 py-0.5 text-xs text-white/70 ring-1 ring-white/10"
            title="Where this value comes from"
          >
            <option value="">Manual</option>
            {variableKeys.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
            {boundKey && !variableKeys.includes(boundKey) && (
              <option value={boundKey}>{boundKey} (waiting…)</option>
            )}
          </select>
        )}
      </div>

      {boundKey ? (
        <div className="flex items-center gap-2 rounded-md bg-indigo-500/10 px-3 py-2 text-sm ring-1 ring-indigo-400/30">
          <span className="text-indigo-300">🔗 Live</span>
          <span className="ml-auto tabular-nums text-white/80">
            {String(variables[boundKey] ?? value ?? "—")}
          </span>
        </div>
      ) : field.type === "number" && field.live ? (
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

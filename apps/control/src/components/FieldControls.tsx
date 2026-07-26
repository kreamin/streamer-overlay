import { useState } from "react";
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
            onPlay={() => send({ type: "play", instanceId: instance.instanceId })}
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
  onPlay,
}: {
  field: OverlayFieldDef;
  value: FieldValue | undefined;
  boundKey: string | undefined;
  variables: Variables;
  onSet: (value: FieldValue) => void;
  onAdjust: (delta: number) => void;
  onBind: (variableKey: string | null) => void;
  onPlay: () => void;
}) {
  const step = field.step ?? 1;
  const variableKeys = Object.keys(variables);
  // Images aren't bindable; everything else can pick a live source.
  const showSource = field.type !== "image" && (variableKeys.length > 0 || Boolean(boundKey));

  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-sm text-white/70">{field.label}</span>
        {showSource && (
          <select
            value={boundKey ?? ""}
            onChange={(e) => onBind(e.target.value || null)}
            className="max-w-[55%] truncate rounded bg-black/40 px-1.5 py-0.5 text-xs text-white/70 ring-1 ring-white/10"
            title={field.type === "trigger" ? "Fire when this variable changes" : "Where this value comes from"}
          >
            <option value="">{field.type === "trigger" ? "Manual only" : "Manual"}</option>
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

      {field.type === "image" ? (
        <ImageField value={value} onSet={onSet} />
      ) : field.type === "trigger" ? (
        <div className="flex items-center gap-2">
          <button
            onClick={onPlay}
            className="flex-1 rounded-md bg-indigo-500 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-400"
          >
            ▶ Play now
          </button>
          {boundKey && (
            <span className="text-xs text-indigo-300" title={`Also fires when ${boundKey} changes`}>
              🔗 {boundKey}
            </span>
          )}
        </div>
      ) : boundKey ? (
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

/** Upload an image/gif; stores the returned /media URL as the field value. */
function ImageField({
  value,
  onSet,
}: {
  value: FieldValue | undefined;
  onSet: (value: FieldValue) => void;
}) {
  const [busy, setBusy] = useState(false);
  const url = typeof value === "string" ? value : "";

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const resp = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, dataUrl }),
      });
      const json = (await resp.json()) as { url?: string };
      if (json.url) onSet(json.url);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {url && (
        <img
          src={url}
          alt=""
          className="max-h-24 rounded-md bg-black/40 object-contain ring-1 ring-white/10"
        />
      )}
      <input
        type="file"
        accept="image/*"
        onChange={(e) => onFile(e.target.files?.[0])}
        className="block w-full text-xs text-white/60 file:mr-2 file:rounded file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-white/80 hover:file:bg-white/20"
      />
      {busy && <p className="text-xs text-white/40">Uploading…</p>}
    </div>
  );
}

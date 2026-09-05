import { useState } from "react";
import { hotkeySlug } from "@stream-overlay/shared";
import type {
  AppState,
  ClientMessage,
  HotkeyAction,
  HotkeyTarget,
  InstalledOverlay,
} from "@stream-overlay/shared";

/**
 * Hotkeys / actions page. Each row is an action you can fire two ways: a global
 * keyboard shortcut (captured by the desktop app, works even when unfocused) and
 * the /api/action/<slug> URL (paste into a Stream Deck HTTP button / Companion).
 * Both do the same thing.
 */
export function HotkeysPage({
  state,
  installed,
  hotkeyStatus,
  send,
}: {
  state: AppState;
  installed: InstalledOverlay[];
  hotkeyStatus: Record<string, boolean>;
  send: (msg: ClientMessage) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl overflow-y-auto p-6">
      <div className="mb-4 flex items-center gap-3">
        <div>
          <h1 className="text-sm font-semibold">Hotkeys</h1>
          <p className="text-xs text-white/40">
            Fire an action from a keyboard shortcut or a Stream Deck button.
          </p>
        </div>
        <button
          onClick={() => send({ type: "addHotkey" })}
          className="ml-auto rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-400"
        >
          ＋ Add hotkey
        </button>
      </div>

      {state.hotkeys.length === 0 ? (
        <p className="rounded-lg bg-white/5 p-6 text-center text-sm text-white/40">
          No hotkeys yet. Add one, choose what it does, then set a keyboard
          shortcut and/or copy its Stream Deck URL.
        </p>
      ) : (
        <ul className="space-y-3">
          {state.hotkeys.map((hk) => (
            <HotkeyRow
              key={hk.id}
              hk={hk}
              state={state}
              installed={installed}
              status={hotkeyStatus[hk.id]}
              send={send}
            />
          ))}
        </ul>
      )}

      <p className="mt-6 text-[11px] leading-relaxed text-white/30">
        Stream Deck: in the Elgato software, set a button to a <b>Hotkey</b>{" "}
        action matching the shortcut here — no extra software needed. Or use the
        URL with Bitfocus Companion / an HTTP-request button. Keyboard shortcuts
        are system-wide, so pick combos that won't clash with your game.
      </p>
    </div>
  );
}

function HotkeyRow({
  hk,
  state,
  installed,
  status,
  send,
}: {
  hk: HotkeyAction;
  state: AppState;
  installed: InstalledOverlay[];
  status: boolean | undefined;
  send: (msg: ClientMessage) => void;
}) {
  const update = (patch: { label?: string; shortcut?: string | null; target?: HotkeyTarget }) =>
    send({ type: "updateHotkey", hotkeyId: hk.id, ...patch });

  const nameOf = (overlayId: string) =>
    installed.find((o) => o.manifest.id === overlayId)?.manifest.name ?? overlayId;
  const hasTrigger = (overlayId: string) =>
    installed
      .find((o) => o.manifest.id === overlayId)
      ?.manifest.fields.some((f) => f.type === "trigger") ?? false;

  // The scene that currently owns the targeted instance (for the scene dropdown).
  const targetInstanceId =
    hk.target.kind === "pulse" || hk.target.kind === "toggleActive"
      ? hk.target.instanceId
      : "";
  const sceneOfInstance =
    state.scenes.find((s) => s.instances.some((i) => i.instanceId === targetInstanceId))?.id ??
    state.currentSceneId;
  const [sceneId, setSceneId] = useState(sceneOfInstance);
  const scene = state.scenes.find((s) => s.id === sceneId) ?? state.scenes[0];

  // Label instances in a scene; number duplicates of the same overlay.
  const instanceLabel = (instanceId: string) => {
    if (!scene) return instanceId;
    const same = scene.instances.filter(
      (i) => i.overlayId === scene.instances.find((x) => x.instanceId === instanceId)?.overlayId,
    );
    const inst = scene.instances.find((i) => i.instanceId === instanceId);
    if (!inst) return instanceId;
    const name = nameOf(inst.overlayId);
    if (same.length <= 1) return name;
    return `${name} #${same.findIndex((i) => i.instanceId === instanceId) + 1}`;
  };

  const url = `${location.origin}/api/action/${hotkeySlug(hk)}`;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  const kind = hk.target.kind;
  const onKind = (next: HotkeyTarget["kind"]) => {
    if (next === "switchScene") {
      update({ target: { kind: "switchScene", sceneId } });
    } else {
      update({ target: { kind: next, instanceId: targetInstanceId } });
    }
  };

  const instancesForKind =
    kind === "pulse"
      ? (scene?.instances.filter((i) => hasTrigger(i.overlayId)) ?? [])
      : (scene?.instances ?? []);

  return (
    <li className="space-y-3 rounded-xl bg-white/5 p-4 ring-1 ring-white/10">
      <div className="flex items-center gap-2">
        <input
          value={hk.label}
          onChange={(e) => update({ label: e.target.value })}
          placeholder="Hotkey name"
          className="flex-1 rounded-md bg-black/40 px-3 py-2 text-sm font-medium outline-none ring-1 ring-white/10 focus:ring-indigo-400"
        />
        <button
          onClick={() => send({ type: "removeHotkey", hotkeyId: hk.id })}
          className="shrink-0 rounded px-2 py-1 text-white/40 hover:bg-red-500/20 hover:text-red-300"
          title="Delete hotkey"
        >
          ✕
        </button>
      </div>

      {/* What it does */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          value={kind}
          onChange={(e) => onKind(e.target.value as HotkeyTarget["kind"])}
          className="rounded-md bg-black/40 px-2 py-1.5 text-sm ring-1 ring-white/10"
        >
          <option value="pulse">Trigger (play)</option>
          <option value="toggleActive">Show / hide</option>
          <option value="switchScene">Switch to scene</option>
        </select>

        {kind === "switchScene" ? (
          <select
            value={hk.target.kind === "switchScene" ? hk.target.sceneId : ""}
            onChange={(e) => update({ target: { kind: "switchScene", sceneId: e.target.value } })}
            className="min-w-[10rem] flex-1 rounded-md bg-black/40 px-2 py-1.5 text-sm ring-1 ring-white/10"
          >
            {state.scenes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        ) : (
          <>
            <select
              value={sceneId}
              onChange={(e) => setSceneId(e.target.value)}
              className="rounded-md bg-black/40 px-2 py-1.5 text-sm ring-1 ring-white/10"
              title="Which scene's overlays"
            >
              {state.scenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              value={targetInstanceId}
              onChange={(e) =>
                update({ target: { kind, instanceId: e.target.value } })
              }
              className="min-w-[10rem] flex-1 rounded-md bg-black/40 px-2 py-1.5 text-sm ring-1 ring-white/10"
            >
              <option value="">
                {instancesForKind.length ? "Pick an overlay…" : "No overlays here"}
              </option>
              {instancesForKind.map((i) => (
                <option key={i.instanceId} value={i.instanceId}>
                  {instanceLabel(i.instanceId)}
                </option>
              ))}
              {/* Keep a selected instance visible even if it lives in another scene. */}
              {targetInstanceId &&
                !instancesForKind.some((i) => i.instanceId === targetInstanceId) && (
                  <option value={targetInstanceId}>{instanceLabel(targetInstanceId)}</option>
                )}
            </select>
          </>
        )}
      </div>

      {/* How it fires */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/50">⌨</span>
          <ShortcutCapture value={hk.shortcut ?? ""} onSet={(sc) => update({ shortcut: sc })} />
          {hk.shortcut && status === false && (
            <span className="text-xs text-red-400" title="Another app already uses this combo">
              ✗ in use
            </span>
          )}
          {hk.shortcut && status === true && <span className="text-xs text-emerald-400">✓</span>}
        </div>

        <button
          onClick={copy}
          className="ml-auto rounded-md bg-white/10 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/20"
          title={url}
        >
          {copied ? "Copied!" : "🎛 Copy Stream Deck URL"}
        </button>
      </div>
    </li>
  );
}

/** A field that records the next key combo pressed into an Electron accelerator. */
function ShortcutCapture({
  value,
  onSet,
}: {
  value: string;
  onSet: (accelerator: string | null) => void;
}) {
  const [armed, setArmed] = useState(false);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.key === "Escape") {
      setArmed(false);
      e.currentTarget.blur();
      return;
    }
    const acc = toAccelerator(e);
    if (acc) {
      onSet(acc);
      setArmed(false);
      e.currentTarget.blur();
    }
  };

  return (
    <span className="flex items-center gap-1">
      <input
        readOnly
        value={armed ? "Press keys…" : value || ""}
        placeholder="Set shortcut"
        onFocus={() => setArmed(true)}
        onBlur={() => setArmed(false)}
        onKeyDown={onKeyDown}
        className={`w-40 cursor-pointer rounded-md bg-black/40 px-2 py-1.5 text-center text-xs tabular-nums outline-none ring-1 ${
          armed ? "ring-indigo-400" : "ring-white/10"
        } placeholder:text-white/25`}
      />
      {value && (
        <button
          onClick={() => onSet(null)}
          className="rounded px-1 text-white/40 hover:text-red-300"
          title="Clear shortcut"
        >
          ✕
        </button>
      )}
    </span>
  );
}

/** Build an Electron accelerator from a keydown, or null if it's not usable. */
function toAccelerator(e: React.KeyboardEvent<HTMLInputElement>): string | null {
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push("CommandOrControl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  const key = keyName(e.key);
  if (!key) return null; // modifier-only press
  const isFn = /^F\d{1,2}$/.test(key);
  if (mods.length === 0 && !isFn) return null; // require a modifier (except F-keys)
  return [...mods, key].join("+");
}

function keyName(k: string): string | null {
  if (k === "Control" || k === "Alt" || k === "Shift" || k === "Meta") return null;
  const map: Record<string, string> = {
    " ": "Space",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Enter: "Enter",
    Escape: "Escape",
    Tab: "Tab",
    Backspace: "Backspace",
    Delete: "Delete",
  };
  if (map[k]) return map[k];
  if (/^F\d{1,2}$/.test(k)) return k; // F1..F12
  if (k.length === 1) return k.toUpperCase(); // letters / digits / symbols
  return null;
}

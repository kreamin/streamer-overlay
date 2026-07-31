import { useState } from "react";
import type { AppState, ClientMessage, Scene } from "@stream-overlay/shared";

/**
 * Scene switcher. Click a scene to switch to it. The ✎ opens an edit popover
 * (rename · link to an OBS scene · delete) — delete is tucked in there so a
 * carefully-built scene can't be lost to a stray click.
 */
export function SceneBar({
  state,
  obsScenes,
  send,
}: {
  state: AppState;
  obsScenes: string[];
  send: (msg: ClientMessage) => void;
}) {
  const [menuId, setMenuId] = useState<string | null>(null);
  const editing = state.scenes.find((s) => s.id === menuId) ?? null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-white/10 px-4 py-2">
      <span className="mr-1 shrink-0 text-xs font-semibold uppercase tracking-widest text-white/40">
        Scenes
      </span>

      {state.scenes.map((scene) => {
        const current = scene.id === state.currentSceneId;
        return (
          <div
            key={scene.id}
            className={`flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm ${
              current
                ? "bg-indigo-500/20 ring-1 ring-indigo-400/50"
                : "bg-white/5 hover:bg-white/10"
            }`}
          >
            <button
              onClick={() => send({ type: "setCurrentScene", sceneId: scene.id })}
              className={current ? "text-white" : "text-white/70"}
              title="Switch to this scene"
            >
              {scene.name}
              {scene.obsSceneName && (
                <span
                  className="ml-1 text-[10px] text-white/40"
                  title={`Follows OBS scene "${scene.obsSceneName}"`}
                >
                  🔗
                </span>
              )}
            </button>
            <button
              onClick={() => setMenuId(scene.id)}
              className="text-white/40 hover:text-white"
              title="Edit scene"
            >
              ✎
            </button>
          </div>
        );
      })}

      <button
        onClick={() => send({ type: "addScene" })}
        className="ml-1 shrink-0 rounded-md px-2 py-1 text-white/50 hover:bg-white/10 hover:text-white"
        title="Add a new scene"
      >
        + Scene
      </button>

      {editing && (
        <SceneEditModal
          scene={editing}
          obsScenes={obsScenes}
          canDelete={state.scenes.length > 1}
          send={send}
          onClose={() => setMenuId(null)}
        />
      )}
    </div>
  );
}

function SceneEditModal({
  scene,
  obsScenes,
  canDelete,
  send,
  onClose,
}: {
  scene: Scene;
  obsScenes: string[];
  canDelete: boolean;
  send: (msg: ClientMessage) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(scene.name);
  // Include the current link even if OBS isn't connected right now.
  const linkOptions = Array.from(
    new Set([...(scene.obsSceneName ? [scene.obsSceneName] : []), ...obsScenes]),
  );

  const commitName = () => send({ type: "renameScene", sceneId: scene.id, name });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-[420px] max-w-full rounded-xl bg-[#11151c] p-6 ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold">Edit scene</h2>
          <button
            onClick={onClose}
            className="rounded px-2 py-0.5 text-white/50 hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        <section className="mb-6">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-widest text-white/40">
            Name
          </h3>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") onClose();
            }}
            className="w-full rounded-md bg-black/40 px-2 py-1.5 text-sm outline-none ring-1 ring-white/10 focus:ring-indigo-400"
          />
        </section>

        <section className="mb-6">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-widest text-white/40">
            Follow OBS scene
          </h3>
          <p className="mb-2 text-xs text-white/40">
            When OBS switches to this scene, the app switches here automatically.
          </p>
          <select
            value={scene.obsSceneName ?? ""}
            onChange={(e) =>
              send({
                type: "setSceneObsLink",
                sceneId: scene.id,
                obsSceneName: e.target.value || null,
              })
            }
            className="w-full rounded-md bg-black/40 px-2 py-1.5 text-sm outline-none ring-1 ring-white/10 focus:ring-indigo-400"
          >
            <option value="">— none —</option>
            {linkOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {obsScenes.length === 0 && (
            <p className="mt-1.5 text-[11px] text-white/30">
              Connect OBS in Settings to list its scenes.
            </p>
          )}
        </section>

        <section className="mb-6">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-widest text-white/40">
            Editing
          </h3>
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={!!scene.liveDrag}
              onChange={(e) =>
                send({ type: "setSceneLiveDrag", sceneId: scene.id, liveDrag: e.target.checked })
              }
              className="size-4 accent-indigo-500"
            />
            <span className="text-sm">Live-track drags in OBS</span>
          </label>
          <p className="mt-1 text-[11px] text-white/30">
            Update OBS continuously while you drag/resize, instead of only on release.
          </p>
        </section>

        {canDelete && (
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-widest text-white/40">
              Danger zone
            </h3>
            <button
              onClick={() => {
                if (window.confirm(`Delete "${scene.name}" and its overlays?`)) {
                  send({ type: "removeScene", sceneId: scene.id });
                  onClose();
                }
              }}
              className="w-full rounded-md bg-red-500/15 px-3 py-2 text-sm font-medium text-red-300 hover:bg-red-500/25"
            >
              Delete scene
            </button>
          </section>
        )}
      </div>
    </div>
  );
}

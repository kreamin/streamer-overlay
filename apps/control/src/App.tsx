import { useState } from "react";
import { useControlStore } from "./useControlStore";
import { OverlayLibrary } from "./components/OverlayLibrary";
import { InstanceList } from "./components/InstanceList";
import { FieldControls } from "./components/FieldControls";
import { Canvas } from "./components/Canvas";
import { Settings } from "./components/Settings";

export function App() {
  const { state, installed, variables, integration, connected, send } = useControlStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center text-white/50">
        Connecting to server…
      </div>
    );
  }

  const selected = state.instances.find((i) => i.instanceId === selectedId) ?? null;
  const selectedOverlay = selected
    ? (installed.find((o) => o.manifest.id === selected.overlayId) ?? null)
    : null;

  const maxZ = state.instances.reduce((m, i) => Math.max(m, i.z), 0);
  const minZ = state.instances.reduce((m, i) => Math.min(m, i.z), 0);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-white/10 px-5 py-3">
        <h1 className="text-sm font-semibold">Stream Overlay · Control Panel</h1>
        <span
          className={`ml-auto flex items-center gap-1.5 text-xs ${
            integration.streamerbot.connected
              ? "text-emerald-400"
              : integration.streamerbot.enabled
                ? "text-amber-400"
                : "text-white/40"
          }`}
          title={
            integration.streamerbot.connected
              ? `Streamer.bot connected — ${integration.streamerbot.globalCount} globals`
              : integration.streamerbot.enabled
                ? "Streamer.bot enabled — connecting…"
                : "Streamer.bot integration off (enable it in Settings)"
          }
        >
          <span
            className={`size-2 rounded-full ${
              integration.streamerbot.connected
                ? "bg-emerald-400"
                : integration.streamerbot.enabled
                  ? "bg-amber-400"
                  : "bg-white/20"
            }`}
          />
          Streamer.bot
        </span>
        <span
          className={`flex items-center gap-1.5 text-xs ${
            connected ? "text-emerald-400" : "text-amber-400"
          }`}
        >
          <span
            className={`size-2 rounded-full ${connected ? "bg-emerald-400" : "bg-amber-400"}`}
          />
          {connected ? "Connected" : "Reconnecting…"}
        </span>
        <button
          onClick={() => setShowSettings(true)}
          className="rounded-md px-2 py-1 text-white/50 hover:bg-white/10 hover:text-white"
          title="Settings"
          aria-label="Settings"
        >
          ⚙
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left: library + active instances */}
        <aside className="w-72 shrink-0 space-y-6 overflow-y-auto border-r border-white/10 p-4">
          <OverlayLibrary installed={installed} send={send} />
          <InstanceList
            state={state}
            installed={installed}
            selectedId={selectedId}
            onSelect={setSelectedId}
            send={send}
          />
        </aside>

        {/* Center: canvas (fills the panel; Canvas scales itself to fit) */}
        <main className="flex min-w-0 flex-1 overflow-hidden">
          <Canvas
            state={state}
            installed={installed}
            selectedId={selectedId}
            onSelect={setSelectedId}
            send={send}
          />
        </main>

        {/* Right: controls for the selected overlay */}
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-white/10 p-4">
          {selected && selectedOverlay ? (
            <FieldControls
              instance={selected}
              overlay={selectedOverlay}
              variables={variables}
              send={send}
              onBringToFront={() =>
                send({ type: "setLayout", instanceId: selected.instanceId, z: maxZ + 1 })
              }
              onSendToBack={() =>
                send({ type: "setLayout", instanceId: selected.instanceId, z: minZ - 1 })
              }
            />
          ) : (
            <p className="text-sm text-white/40">
              Select an overlay to edit its settings.
            </p>
          )}
        </aside>
      </div>

      {showSettings && (
        <Settings
          state={state}
          integration={integration}
          send={send}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

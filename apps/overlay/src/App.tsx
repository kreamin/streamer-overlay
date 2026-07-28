import { activeScene } from "@stream-overlay/shared";
import { useOverlayStore } from "./useOverlayStore";
import { OverlayFrame } from "./OverlayFrame";

export function App() {
  const { state, installed, pulses } = useOverlayStore();
  if (!state) return null;

  const byId = new Map(installed.map((o) => [o.manifest.id, o]));

  return (
    <>
      {activeScene(state).instances
        .filter((instance) => instance.active)
        .map((instance) => {
          const overlay = byId.get(instance.overlayId);
          if (!overlay) return null; // package not installed (or removed)
          return (
            <OverlayFrame
              key={instance.instanceId}
              instance={instance}
              entryUrl={overlay.entryUrl}
              pulse={pulses[instance.instanceId] ?? 0}
            />
          );
        })}
    </>
  );
}

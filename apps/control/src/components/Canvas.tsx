import { useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import { activeScene } from "@stream-overlay/shared";
import type {
  AppState,
  ClientMessage,
  InstalledOverlay,
} from "@stream-overlay/shared";

/**
 * Fit a canvasWidth x canvasHeight area inside the referenced container,
 * preserving aspect ratio. Recomputes on window/container resize.
 */
function useFitScale(
  ref: React.RefObject<HTMLElement | null>,
  canvasWidth: number,
  canvasHeight: number,
  padding = 32,
) {
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      const availW = el.clientWidth - padding;
      const availH = el.clientHeight - padding;
      if (availW <= 0 || availH <= 0) return;
      setScale(Math.min(availW / canvasWidth, availH / canvasHeight));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, canvasWidth, canvasHeight, padding]);
  return scale;
}

/**
 * A scaled mirror of the OBS canvas. Each instance is a draggable/resizable
 * box; drag/resize commits the new layout to the server (and thus OBS).
 * The scale is dynamic (fits the panel), and react-rnd's `scale` prop keeps
 * pointer movement accurate under the CSS transform.
 */
export function Canvas({
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
  const { width, height } = state.canvas;
  const containerRef = useRef<HTMLDivElement>(null);
  const scale = useFitScale(containerRef, width, height);

  // Live-follow while dragging/resizing (per-scene opt-in), throttled so we
  // don't flood the socket. Drag-stop/resize-stop still send the final layout.
  const liveDrag = Boolean(activeScene(state).liveDrag);
  const lastLive = useRef(0);
  const sendLive = (msg: ClientMessage) => {
    const now = Date.now();
    if (now - lastLive.current < 50) return; // ~20 updates/sec max
    lastLive.current = now;
    send(msg);
  };

  const nameOf = (overlayId: string) =>
    installed.find((o) => o.manifest.id === overlayId)?.manifest.name ?? overlayId;

  return (
    <div
      ref={containerRef}
      className="flex h-full w-full items-center justify-center overflow-hidden p-4"
    >
      <div
        className="relative overflow-hidden rounded-lg bg-black/60 bg-[radial-gradient(circle,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-[size:24px_24px] ring-1 ring-white/10"
        style={{ width: width * scale, height: height * scale }}
      >
        <div
          className="absolute left-0 top-0"
          style={{ width, height, transform: `scale(${scale})`, transformOrigin: "top left" }}
        >
          {activeScene(state).instances.map((inst) => {
            const selected = inst.instanceId === selectedId;
            return (
              <Rnd
                key={inst.instanceId}
                scale={scale}
                bounds="parent"
                size={{ width: inst.size.width, height: inst.size.height }}
                position={{ x: inst.position.x, y: inst.position.y }}
                onDragStart={() => onSelect(inst.instanceId)}
                onDrag={
                  liveDrag
                    ? (_e, d) =>
                        sendLive({
                          type: "setLayout",
                          instanceId: inst.instanceId,
                          position: { x: Math.round(d.x), y: Math.round(d.y) },
                        })
                    : undefined
                }
                onDragStop={(_e, d) =>
                  send({
                    type: "setLayout",
                    instanceId: inst.instanceId,
                    position: { x: Math.round(d.x), y: Math.round(d.y) },
                  })
                }
                onResize={
                  liveDrag
                    ? (_e, _dir, ref, _delta, pos) =>
                        sendLive({
                          type: "setLayout",
                          instanceId: inst.instanceId,
                          size: {
                            width: Math.round(parseFloat(ref.style.width)),
                            height: Math.round(parseFloat(ref.style.height)),
                          },
                          position: { x: Math.round(pos.x), y: Math.round(pos.y) },
                        })
                    : undefined
                }
                onResizeStop={(_e, _dir, ref, _delta, pos) =>
                  send({
                    type: "setLayout",
                    instanceId: inst.instanceId,
                    size: {
                      width: Math.round(parseFloat(ref.style.width)),
                      height: Math.round(parseFloat(ref.style.height)),
                    },
                    position: { x: Math.round(pos.x), y: Math.round(pos.y) },
                  })
                }
                onClick={() => onSelect(inst.instanceId)}
                // Selected overlay pops to the top in the editor only (9999) so
                // it's always grabbable; everyone else uses their real output z.
                style={{ zIndex: selected ? 9999 : inst.z }}
                className={`flex items-center justify-center border-2 text-center ${
                  selected
                    ? "border-indigo-400 bg-indigo-500/20"
                    : "border-dashed border-white/30 bg-white/5"
                } ${inst.active ? "" : "opacity-40"}`}
              >
                <span className="pointer-events-none select-none px-2 text-2xl text-white/80">
                  {nameOf(inst.overlayId)}
                </span>
              </Rnd>
            );
          })}
        </div>
      </div>
    </div>
  );
}

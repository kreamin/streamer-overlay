import { useCallback, useEffect, useRef } from "react";
import type { OverlayInstance } from "@stream-overlay/shared";

/**
 * Renders one overlay instance as a sandboxed iframe positioned on the canvas.
 * The iframe loads the overlay package's own HTML; we push field values into it
 * with postMessage (received by /overlay-runtime.js inside the frame).
 *
 * `sandbox="allow-scripts"` (without allow-same-origin) keeps each overlay
 * isolated — important once overlays come from other people.
 */
export function OverlayFrame({
  instance,
  entryUrl,
}: {
  instance: OverlayInstance;
  entryUrl: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);

  const post = useCallback(() => {
    ref.current?.contentWindow?.postMessage(
      { type: "overlay:data", values: instance.values },
      "*",
    );
  }, [instance.values]);

  // Re-send values whenever they change.
  useEffect(() => {
    post();
  }, [post]);

  // The runtime tells us when it's ready / has applied values, for the initial
  // load race and as a dev sanity check.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== ref.current?.contentWindow) return;
      const data = event.data;
      if (data?.type === "overlay:ready") {
        post();
      } else if (data?.type === "overlay:applied") {
        console.debug(`[overlay] ${instance.instanceId} applied`, data.values);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [post, instance.instanceId]);

  return (
    <iframe
      ref={ref}
      src={entryUrl}
      title={instance.instanceId}
      onLoad={post}
      sandbox="allow-scripts"
      scrolling="no"
      style={{
        position: "absolute",
        left: instance.position.x,
        top: instance.position.y,
        width: instance.size.width,
        height: instance.size.height,
        border: "none",
        background: "transparent",
        zIndex: instance.z,
        pointerEvents: "none",
      }}
    />
  );
}

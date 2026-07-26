import { useEffect, useState } from "react";
import type {
  AppState,
  InstalledOverlay,
  ServerMessage,
} from "@stream-overlay/shared";

/**
 * Opens a websocket to the server and keeps the latest state + installed list.
 * Auto-reconnects if the server restarts (handy during dev, and if OBS loads
 * the page before the server is up).
 */
export function useOverlayStore() {
  const [state, setState] = useState<AppState | null>(null);
  const [installed, setInstalled] = useState<InstalledOverlay[]>([]);
  // A per-instance counter that increments each time a "play now" pulse arrives.
  const [pulses, setPulses] = useState<Record<string, number>>({});

  useEffect(() => {
    let socket: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;

    function connect() {
      socket = new WebSocket(`ws://${location.host}`);
      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data) as ServerMessage;
        if (msg.type === "hello") {
          setState(msg.state);
          setInstalled(msg.installed);
        } else if (msg.type === "state") {
          setState(msg.state);
        } else if (msg.type === "installed") {
          setInstalled(msg.installed);
        } else if (msg.type === "pulse") {
          setPulses((p) => ({ ...p, [msg.instanceId]: (p[msg.instanceId] ?? 0) + 1 }));
        }
      };
      socket.onclose = () => {
        if (!closed) retry = setTimeout(connect, 1000);
      };
    }

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, []);

  return { state, installed, pulses };
}

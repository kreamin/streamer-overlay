import { useEffect, useState } from "react";
import type {
  AppState,
  InstalledOverlay,
  ServerMessage,
} from "@stream-overlay/shared";

// Cache the last state/installed so the overlay keeps rendering its last frame
// even across a page reload while the server is down (e.g. during an app update).
// It's replaced by live data the moment the socket reconnects. Bump the version
// suffix if the state shape changes incompatibly.
const CACHE_STATE = "overlay:state:v1";
const CACHE_INSTALLED = "overlay:installed:v1";

function loadCache<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveCache(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full/blocked — ignore, live data still flows over the socket */
  }
}

/**
 * Opens a websocket to the server and keeps the latest state + installed list.
 * Auto-reconnects if the server restarts (handy during dev, during an app
 * update, and if OBS loads the page before the server is up). The last state is
 * cached to localStorage so a reload while the server is down still renders the
 * last frame instead of going blank.
 */
export function useOverlayStore() {
  const [state, setState] = useState<AppState | null>(() =>
    loadCache<AppState | null>(CACHE_STATE, null),
  );
  const [installed, setInstalled] = useState<InstalledOverlay[]>(() =>
    loadCache<InstalledOverlay[]>(CACHE_INSTALLED, []),
  );
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
          saveCache(CACHE_STATE, msg.state);
          saveCache(CACHE_INSTALLED, msg.installed);
        } else if (msg.type === "state") {
          setState(msg.state);
          saveCache(CACHE_STATE, msg.state);
        } else if (msg.type === "installed") {
          setInstalled(msg.installed);
          saveCache(CACHE_INSTALLED, msg.installed);
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

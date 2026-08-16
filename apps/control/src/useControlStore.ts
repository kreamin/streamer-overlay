import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AppState,
  ClientMessage,
  InstalledOverlay,
  IntegrationStatus,
  ServerMessage,
  Variables,
} from "@stream-overlay/shared";

/**
 * Websocket connection for the control panel. Keeps the latest state, installed
 * list, live variables, and integration status, and exposes `send`.
 */
export function useControlStore() {
  const [state, setState] = useState<AppState | null>(null);
  const [installed, setInstalled] = useState<InstalledOverlay[]>([]);
  const [variables, setVariables] = useState<Variables>({});
  const [integration, setIntegration] = useState<IntegrationStatus>({
    streamerbot: { enabled: false, connected: false, globalCount: 0 },
    obs: { enabled: false, connected: false, scenes: [], sources: [], sourcesByScene: {} },
    ingestClients: 0,
  });
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;

    function connect() {
      const socket = new WebSocket(`ws://${location.host}`);
      socketRef.current = socket;

      socket.onopen = () => setConnected(true);
      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data) as ServerMessage;
        if (msg.type === "hello") {
          setState(msg.state);
          setInstalled(msg.installed);
          setVariables(msg.variables);
          setIntegration(msg.integration);
        } else if (msg.type === "state") {
          setState(msg.state);
        } else if (msg.type === "installed") {
          setInstalled(msg.installed);
        } else if (msg.type === "variables") {
          setVariables(msg.variables);
        } else if (msg.type === "integration") {
          setIntegration(msg.integration);
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1000);
      };
    }

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      socketRef.current?.close();
    };
  }, []);

  const send = useCallback((msg: ClientMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  }, []);

  return { state, installed, variables, integration, connected, send };
}

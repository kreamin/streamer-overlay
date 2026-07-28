import { useEffect, useState } from "react";
import type { AppState, ClientMessage, IntegrationStatus } from "@stream-overlay/shared";

const PRESETS = [
  { label: "720p", width: 1280, height: 720 },
  { label: "1080p", width: 1920, height: 1080 },
  { label: "1440p", width: 2560, height: 1440 },
  { label: "4K", width: 3840, height: 2160 },
];

export function Settings({
  state,
  integration,
  send,
  onClose,
}: {
  state: AppState;
  integration: IntegrationStatus;
  send: (msg: ClientMessage) => void;
  onClose: () => void;
}) {
  const { width, height } = state.canvas;
  const [w, setW] = useState(String(width));
  const [h, setH] = useState(String(height));

  const sb = state.streamerbot;
  const sbStatus = integration.streamerbot;
  const [host, setHost] = useState(sb.host);
  const [port, setPort] = useState(String(sb.port));

  const obs = state.obs;
  const obsStatus = integration.obs;
  const [obsHost, setObsHost] = useState(obs.host);
  const [obsPort, setObsPort] = useState(String(obs.port));
  const [obsPassword, setObsPassword] = useState(obs.password);

  // Keep the custom inputs in sync if these change elsewhere.
  useEffect(() => {
    setW(String(width));
    setH(String(height));
  }, [width, height]);
  useEffect(() => {
    setHost(sb.host);
    setPort(String(sb.port));
  }, [sb.host, sb.port]);
  useEffect(() => {
    setObsHost(obs.host);
    setObsPort(String(obs.port));
    setObsPassword(obs.password);
  }, [obs.host, obs.port, obs.password]);

  const apply = (nw: number, nh: number) => {
    if (Number.isFinite(nw) && Number.isFinite(nh) && nw > 0 && nh > 0) {
      send({ type: "setCanvas", width: nw, height: nh });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-[460px] max-w-full rounded-xl bg-[#11151c] p-6 ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="rounded px-2 py-0.5 text-white/50 hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Output resolution */}
        <section className="mb-6">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-widest text-white/40">
            Output resolution
          </h3>
          <p className="mb-3 text-xs text-white/40">
            Match this to your stream. Set your OBS Browser Source to the same size.
          </p>

          <div className="mb-3 grid grid-cols-4 gap-2">
            {PRESETS.map((p) => {
              const active = p.width === width && p.height === height;
              return (
                <button
                  key={p.label}
                  onClick={() => apply(p.width, p.height)}
                  className={`rounded-md px-2 py-2 text-sm font-medium ${
                    active
                      ? "bg-indigo-500 text-white"
                      : "bg-white/10 text-white/80 hover:bg-white/20"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-end gap-2">
            <label className="flex-1 text-xs text-white/60">
              Width
              <input
                type="number"
                value={w}
                onChange={(e) => setW(e.target.value)}
                className="mt-1 w-full rounded-md bg-black/40 px-2 py-1.5 text-sm outline-none ring-1 ring-white/10 focus:ring-indigo-400"
              />
            </label>
            <span className="pb-2 text-white/30">×</span>
            <label className="flex-1 text-xs text-white/60">
              Height
              <input
                type="number"
                value={h}
                onChange={(e) => setH(e.target.value)}
                className="mt-1 w-full rounded-md bg-black/40 px-2 py-1.5 text-sm outline-none ring-1 ring-white/10 focus:ring-indigo-400"
              />
            </label>
            <button
              onClick={() => apply(Number(w), Number(h))}
              className="rounded-md bg-white/10 px-3 py-2 text-sm font-medium hover:bg-white/20"
            >
              Apply
            </button>
          </div>
          <p className="mt-2 text-xs text-white/30">
            Changing resolution rescales your overlays so the layout stays consistent.
          </p>
        </section>

        {/* Streamer.bot pull integration */}
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-widest text-white/40">
            Streamer.bot
          </h3>
          <p className="mb-3 text-xs text-white/40">
            Pulls in all your Streamer.bot global variables as live sources you can
            bind to any field. Streamer.bot's WebSocket Server must be running (it's on
            by default).
          </p>

          <label className="mb-3 flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={sb.enabled}
              onChange={(e) => send({ type: "setStreamerbot", enabled: e.target.checked })}
              className="size-4 accent-indigo-500"
            />
            <span className="text-sm">Enable integration</span>
          </label>

          {/* Status line */}
          <div className="mb-3 flex items-center gap-2 text-xs">
            <span
              className={`size-2 rounded-full ${
                sbStatus.connected
                  ? "bg-emerald-400"
                  : sbStatus.enabled
                    ? "bg-amber-400"
                    : "bg-white/20"
              }`}
            />
            <span className="text-white/60">
              {sbStatus.connected
                ? `Connected — ${sbStatus.globalCount} global${sbStatus.globalCount === 1 ? "" : "s"} available`
                : sbStatus.enabled
                  ? `Connecting to ${sb.host}:${sb.port}…${sbStatus.error ? ` (${sbStatus.error})` : ""}`
                  : "Off"}
            </span>
          </div>

          {/* Host / port (advanced; defaults are almost always correct) */}
          <div className="flex items-end gap-2">
            <label className="flex-1 text-xs text-white/60">
              Host
              <input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                className="mt-1 w-full rounded-md bg-black/40 px-2 py-1.5 text-sm outline-none ring-1 ring-white/10 focus:ring-indigo-400"
              />
            </label>
            <label className="w-24 text-xs text-white/60">
              Port
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="mt-1 w-full rounded-md bg-black/40 px-2 py-1.5 text-sm outline-none ring-1 ring-white/10 focus:ring-indigo-400"
              />
            </label>
            <button
              onClick={() => send({ type: "setStreamerbot", host, port: Number(port) })}
              className="rounded-md bg-white/10 px-3 py-2 text-sm font-medium hover:bg-white/20"
            >
              Apply
            </button>
          </div>
        </section>

        {/* OBS (obs-websocket) integration */}
        <section className="mt-6">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-widest text-white/40">
            OBS
          </h3>
          <p className="mb-3 text-xs text-white/40">
            Follows your OBS scene switches so linked app scenes activate automatically.
            Enable OBS's WebSocket server (Tools → WebSocket Server Settings) and paste the
            password here.
          </p>

          <label className="mb-3 flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={obs.enabled}
              onChange={(e) => send({ type: "setObs", enabled: e.target.checked })}
              className="size-4 accent-indigo-500"
            />
            <span className="text-sm">Enable integration</span>
          </label>

          <div className="mb-3 flex items-center gap-2 text-xs">
            <span
              className={`size-2 rounded-full ${
                obsStatus.connected
                  ? "bg-emerald-400"
                  : obsStatus.enabled
                    ? "bg-amber-400"
                    : "bg-white/20"
              }`}
            />
            <span className="text-white/60">
              {obsStatus.connected
                ? `Connected — ${obsStatus.scenes.length} scene${obsStatus.scenes.length === 1 ? "" : "s"}${obsStatus.currentScene ? `, live: ${obsStatus.currentScene}` : ""}`
                : obsStatus.enabled
                  ? `Connecting to ${obs.host}:${obs.port}…${obsStatus.error ? ` (${obsStatus.error})` : ""}`
                  : "Off"}
            </span>
          </div>

          <div className="flex items-end gap-2">
            <label className="flex-1 text-xs text-white/60">
              Host
              <input
                value={obsHost}
                onChange={(e) => setObsHost(e.target.value)}
                className="mt-1 w-full rounded-md bg-black/40 px-2 py-1.5 text-sm outline-none ring-1 ring-white/10 focus:ring-indigo-400"
              />
            </label>
            <label className="w-20 text-xs text-white/60">
              Port
              <input
                type="number"
                value={obsPort}
                onChange={(e) => setObsPort(e.target.value)}
                className="mt-1 w-full rounded-md bg-black/40 px-2 py-1.5 text-sm outline-none ring-1 ring-white/10 focus:ring-indigo-400"
              />
            </label>
          </div>
          <div className="mt-2 flex items-end gap-2">
            <label className="flex-1 text-xs text-white/60">
              Password
              <input
                type="password"
                value={obsPassword}
                onChange={(e) => setObsPassword(e.target.value)}
                placeholder="(from OBS WebSocket settings)"
                className="mt-1 w-full rounded-md bg-black/40 px-2 py-1.5 text-sm outline-none ring-1 ring-white/10 focus:ring-indigo-400"
              />
            </label>
            <button
              onClick={() =>
                send({
                  type: "setObs",
                  host: obsHost,
                  port: Number(obsPort),
                  password: obsPassword,
                })
              }
              className="rounded-md bg-white/10 px-3 py-2 text-sm font-medium hover:bg-white/20"
            >
              Apply
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

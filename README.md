# Stream Overlay

A local stream-overlay system with two browser pages served by one Node server:

- **Overlay page** (`/overlay`) — the single Browser Source you add to OBS. Renders every
  active overlay at its configured position and size.
- **Control panel** (`/control`) — where you toggle overlays on/off, set values (goals,
  live counts), and drag/resize things around a 1920×1080 canvas.

Overlays are self-contained folders dropped into `overlays/`. The server watches that
folder and both pages update live over a websocket.

## Project layout

```
packages/shared/   Shared TypeScript types (websocket protocol + state shapes)
packages/server/   The local server: static hosting, folder watcher, websocket hub
overlays/          Installed overlay packages (drop folders here)
data/              Runtime state (state.json) — created automatically, gitignored
```

## Running (dev)

```
npm install
npm run dev        # starts the server on http://localhost:4747
```

Then open http://localhost:4747 for a status page. The overlay page and control panel
are added in later phases.

## Overlay package format

Each overlay is a folder in `overlays/` containing at least:

```
overlays/<your-overlay>/
  manifest.json    Declares id, name, size, and fields
  index.html       The markup shown in OBS
  style.css        (optional)
  script.js        (optional, for animation/custom logic)
```

See `overlays/subscriber-goal/manifest.json` for a working example.

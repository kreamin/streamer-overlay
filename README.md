# Stream Overlay

A local overlay system for OBS with a drag-and-drop control panel. Add one Browser
Source to OBS, then position, style, and update overlays live from a separate app —
no page reloads, no restarts.

Overlays are self-contained folders you can drop in, rearrange, and share.

---

## For streamers — install & set up

### 1. Install

1. Download the latest **`Stream Overlay Setup.exe`** from the
   [Releases page](https://github.com/kreamin/streamer-overlay/releases/latest).
2. Run it. Windows SmartScreen may say *"Windows protected your PC"* because the app
   isn't code-signed — click **More info → Run anyway**. (Safe; it's just unsigned.)
3. Finish the installer and launch **Stream Overlay** from the Start menu.

The control panel opens in its own window. **Keep it open while you stream** — it runs
the overlay server that OBS connects to.

### 2. Set up OBS (one time)

First, match your canvas size:

- **Settings → Video → Base (Canvas) Resolution → `1920×1080`**
  (The control panel lays overlays out on a 1920×1080 grid, so OBS must match.)

Then add the overlay as a single Browser Source:

1. In your scene, under **Sources**, click **＋ → Browser → Create new** → name it
   `Stream Overlay` → **OK**.
2. Set:
   - **URL:** `http://localhost:4747/overlay`
   - **Width:** `1920`  **Height:** `1080`
   - Leave the pre-filled **Custom CSS** as-is (it keeps the background transparent).
3. **OK**, then select the source and press **Ctrl + F** (Fit to screen).

You only ever need this **one** Browser Source — it shows *all* your overlays. You never
move overlays inside OBS; you position them in the control panel.

> If the overlay is ever blank, right-click the source → **Refresh** (usually means the
> app wasn't running yet).

### 3. Use the control panel

- **Add overlays:** click **Add** next to an overlay under *Installed overlays*.
- **Position:** drag and resize the boxes on the canvas — OBS updates instantly.
- **Edit:** select an overlay to change its settings (goal, colors, etc.) on the right.
  Live values (like a sub count) have quick **−/＋** buttons.
- **Stacking:** select an overlay from the left list to pop it to the front so you can
  grab it; use **Bring to front / Send to back** to set the real order shown in OBS.
- **Show/hide:** the checkbox next to each overlay toggles whether it appears in OBS.

**Webcam Border tip:** in OBS, drag the `Stream Overlay` Browser Source **above** your
webcam source, then size the border overlay to sit over the cam — its middle is
transparent, so the cam shows through the frame.

### 4. Add or share overlays

Each overlay is just a folder, so sharing is easy:

- Click **Open folder** (top-right of *Installed overlays*) to open your overlays folder.
- **Install:** drop an overlay folder into it — it appears in the panel automatically.
- **Share:** zip an overlay's folder and send it; the other person unzips it into theirs.

Included overlays: **Subscriber Goal** (e.g. `42/100`) and **Webcam Border**.

---

## For developers

### Requirements

- [Node.js](https://nodejs.org) 20+ (built on 24)

### Run in dev

```bash
npm install
npm run dev        # server + both apps with live rebuild
```

Then open `http://localhost:4747/control` in a browser, and point OBS at
`http://localhost:4747/overlay`.

Other scripts: `npm run dev:server` (server only), `npm run desktop` (run the Electron
app against your working tree).

### Project layout

```
packages/shared/   Shared TypeScript types (the websocket protocol + state)
packages/server/   Local server: static hosting, folder watcher, websocket hub
apps/overlay/      React page OBS loads (renders overlays as sandboxed iframes)
apps/control/      React + Tailwind control panel
apps/desktop/      Electron shell + packaging config
overlays/          Default overlay packages
```

### Build the Windows installer

```bash
npm run dist:win   # → apps/desktop/release/Stream Overlay Setup <version>.exe
```

> **Windows Developer Mode must be ON** (Settings → System → For developers). The
> packager extracts tooling that contains symlinks, which Windows blocks otherwise.
> Alternatively, run the command from an Administrator terminal.

### Overlay package format

An overlay is a folder in `overlays/` containing:

```
overlays/<your-overlay>/
  manifest.json    id, name, defaultSize, and the fields shown in the control panel
  index.html       the markup rendered in OBS
  style.css        (optional)
  script.js        (optional, for anything beyond simple text)
```

`manifest.json` declares the fields the control panel renders:

```jsonc
{
  "id": "subscriber-goal",
  "name": "Subscriber Goal",
  "version": "1.0.0",
  "defaultSize": { "width": 340, "height": 96 },
  "fields": [
    { "id": "subs", "label": "Current Subs", "type": "number", "default": 0, "live": true },
    { "id": "goalSubs", "label": "Goal", "type": "number", "default": 100 },
    { "id": "color", "label": "Text Color", "type": "color", "default": "#ffffff" }
  ]
}
```

Field types: `number`, `text`, `boolean`, `color`. Mark a number `"live": true` to get
quick −/＋ buttons.

Your `index.html` includes the host bridge and reads values two ways:

```html
<!-- Simple text: this span is filled with the live value automatically -->
<span data-bind="subs">0</span>/<span data-bind="goalSubs">100</span>

<script src="/overlay-runtime.js"></script>
<script src="script.js"></script>   <!-- optional -->
```

For anything beyond text (colors, sizes, animation), listen for the `overlaydata` event
in `script.js` — it fires with all current values whenever they change:

```js
window.addEventListener("overlaydata", (e) => {
  const v = e.detail;
  document.querySelector(".goal").style.color = v.color;
});
```

See `overlays/subscriber-goal` and `overlays/webcam-border` for working examples.

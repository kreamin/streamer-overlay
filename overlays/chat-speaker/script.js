// Chat Speaker — a ChatGod-style "voice of chat" panel. Shows a selected
// chatter's name + their latest message, with the message auto-sizing to fill
// the box. Values arrive via "overlaydata" (bind name/message to your Streamer.bot
// player globals). Display only — no TTS, no selection logic. Pure drop-in.
(function () {
  var panel = document.getElementById("panel");
  var elName = document.getElementById("name");
  var msgArea = document.getElementById("msgArea");
  var elMsg = document.getElementById("msg");

  var cfg = {
    name: "",
    message: "",
    accent: "#ffd35c",
    textColor: "#ffffff",
    bgColor: "#0f1116",
    bgOpacity: 82,
    showBorder: true,
    hideWhenEmpty: true,
  };

  // ChatGod TTS style cues — strip a leading one so it isn't shown on screen.
  var STYLE_TAG = /^\s*\((angry|cheerful|excited|sad|whispering|shouting|terrified|hopeful|friendly|unfriendly|random)\)\s*/i;

  function isBlank(s) {
    var t = String(s == null ? "" : s).trim();
    return t === "" || t === "-";
  }
  function hexToRgba(hex, opacityPct) {
    var h = String(hex || "#000000").replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.substr(0, 2), 16) || 0;
    var g = parseInt(h.substr(2, 2), 16) || 0;
    var b = parseInt(h.substr(4, 2), 16) || 0;
    var a = Math.max(0, Math.min(100, Number(opacityPct))) / 100;
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }
  function applyStyle() {
    panel.style.background = hexToRgba(cfg.bgColor, cfg.bgOpacity);
    if (cfg.showBorder) {
      panel.style.border = "1px solid rgba(255,255,255,0.08)";
      panel.style.backdropFilter = "blur(3px)";
      panel.style.webkitBackdropFilter = "blur(3px)";
    } else {
      panel.style.border = "none";
      panel.style.backdropFilter = "none";
      panel.style.webkitBackdropFilter = "none";
    }
  }

  // Grow/shrink the message so it fills ~94% of the message area.
  function fit() {
    if (!elMsg.textContent) return;
    var cw = msgArea.clientWidth * 0.98;
    var ch = msgArea.clientHeight * 0.94;
    if (cw <= 0 || ch <= 0) return;
    var lo = 6, hi = 400, best = 6;
    for (var i = 0; i < 15; i++) {
      var mid = (lo + hi) / 2;
      elMsg.style.fontSize = mid + "px";
      if (elMsg.scrollWidth <= cw && elMsg.scrollHeight <= ch) { best = mid; lo = mid; }
      else { hi = mid; }
    }
    elMsg.style.fontSize = Math.floor(best) + "px";
  }

  function render() {
    applyStyle();

    var name = isBlank(cfg.name) ? "" : String(cfg.name).trim();
    var message = isBlank(cfg.message) ? "" : String(cfg.message).replace(STYLE_TAG, "").trim();

    if (!name && !message && cfg.hideWhenEmpty) {
      panel.classList.add("hidden");
      return;
    }
    panel.classList.remove("hidden");

    elName.textContent = name;
    elName.style.color = cfg.accent;
    elName.style.display = name ? "block" : "none";

    elMsg.textContent = message;
    elMsg.style.color = cfg.textColor;
    fit();
  }

  window.addEventListener("overlaydata", function (e) {
    var v = e.detail || {};
    if (v.name !== undefined) cfg.name = String(v.name == null ? "" : v.name);
    if (v.message !== undefined) cfg.message = String(v.message == null ? "" : v.message);
    if (v.accent !== undefined) cfg.accent = String(v.accent || "#ffd35c");
    if (v.textColor !== undefined) cfg.textColor = String(v.textColor || "#ffffff");
    if (v.bgColor !== undefined) cfg.bgColor = String(v.bgColor || "#0f1116");
    if (v.bgOpacity !== undefined) cfg.bgOpacity = Number(v.bgOpacity);
    if (v.showBorder !== undefined) cfg.showBorder = !!v.showBorder;
    if (v.hideWhenEmpty !== undefined) cfg.hideWhenEmpty = !!v.hideWhenEmpty;
    render();
  });

  if (window.ResizeObserver) {
    new ResizeObserver(fit).observe(msgArea);
  } else {
    window.addEventListener("resize", fit);
  }

  render();
})();

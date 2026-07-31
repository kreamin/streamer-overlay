// Text — a simple text overlay. Type text + pick a color; the font size
// auto-scales (binary search) to fill the element, re-fitting whenever the
// element is resized or the text changes. Pure drop-in package.
(function () {
  var wrap = document.getElementById("wrap");
  var el = document.getElementById("text");

  var cfg = { text: "Text", color: "#ffffff" };

  // Grow/shrink the font so the text fills ~96% of the box (both dimensions).
  function fit() {
    if (!el.textContent) return;
    var cw = wrap.clientWidth * 0.96;
    var ch = wrap.clientHeight * 0.96;
    if (cw <= 0 || ch <= 0) return;

    var lo = 2, hi = 1000, best = 2;
    for (var i = 0; i < 16; i++) {
      var mid = (lo + hi) / 2;
      el.style.fontSize = mid + "px";
      if (el.scrollWidth <= cw && el.scrollHeight <= ch) {
        best = mid;
        lo = mid;
      } else {
        hi = mid;
      }
    }
    el.style.fontSize = Math.floor(best) + "px";
  }

  function render() {
    el.textContent = cfg.text || "";
    el.style.color = cfg.color;
    fit();
  }

  window.addEventListener("overlaydata", function (e) {
    var v = e.detail || {};
    if (v.text !== undefined) cfg.text = String(v.text == null ? "" : v.text);
    if (v.color !== undefined) cfg.color = String(v.color || "#ffffff");
    render();
  });

  // Re-fit whenever the element (iframe) is resized on the canvas.
  if (window.ResizeObserver) {
    new ResizeObserver(fit).observe(wrap);
  } else {
    window.addEventListener("resize", fit);
  }

  render();
})();

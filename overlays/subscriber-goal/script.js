// Applies the editable style fields. subs/goalSubs are filled by data-bind in
// the runtime; everything else (color, sizes, weights, the bottom label text)
// comes through the "overlaydata" event, which carries the full value set.
//
// "Thickness" = font-weight PLUS a matching text-stroke above the line's default
// weight. System fonts (Segoe UI) only have a few real weights, so font-weight
// alone barely changes; the stroke makes thickness scale smoothly on any font.
(function () {
  var goal = document.querySelector(".goal");
  var count = document.querySelector(".count");
  var label = document.querySelector(".label");

  function thickness(el, weight, size, baseWeight) {
    if (!el) return;
    var w = Number(weight) || baseWeight;
    el.style.fontWeight = String(w);
    // extra outline (same color as the text) for weights above the default
    var extra = Math.max(0, (w - baseWeight) / 100) * (Number(size) || 15) * 0.035;
    el.style.webkitTextStroke = extra > 0 ? extra.toFixed(2) + "px currentColor" : "";
  }

  window.addEventListener("overlaydata", function (e) {
    var v = e.detail || {};

    if (goal && v.color != null) goal.style.color = String(v.color);

    if (count) {
      if (v.countSize != null) count.style.fontSize = (Number(v.countSize) || 44) + "px";
      if (v.countWeight != null) thickness(count, v.countWeight, v.countSize, 800);
    }

    if (label) {
      if (v.labelText != null) label.textContent = String(v.labelText);
      if (v.labelSize != null) label.style.fontSize = (Number(v.labelSize) || 15) + "px";
      if (v.labelWeight != null) thickness(label, v.labelWeight, v.labelSize, 400);
    }
  });
})();

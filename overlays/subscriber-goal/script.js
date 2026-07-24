// Applies the Text Color field to the goal text. subs/goalSubs are handled by
// data-bind in the runtime; color isn't text, so we set it here via the
// "overlaydata" event (which carries the full set of values).
(function () {
  var goal = document.querySelector(".goal");
  window.addEventListener("overlaydata", function (e) {
    var v = e.detail || {};
    if (goal && v.color != null) goal.style.color = String(v.color);
  });
})();

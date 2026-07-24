// Advanced overlay: border styling isn't plain text, so instead of data-bind we
// listen for the "overlaydata" event the runtime fires and apply CSS ourselves.
// The host always sends the full set of values, so we can read them all here.
(function () {
  var frame = document.getElementById("frame");

  function render(v) {
    var color = v.color != null ? String(v.color) : "#7c3aed";
    var glow = Number(v.glow) || 0;

    frame.style.borderColor = color;
    frame.style.borderWidth = (Number(v.thickness) || 0) + "px";
    frame.style.borderRadius = (Number(v.radius) || 0) + "px";
    frame.style.boxShadow =
      glow > 0
        ? "0 0 " + glow + "px " + color + ", inset 0 0 " + glow + "px " + color
        : "none";
  }

  window.addEventListener("overlaydata", function (e) {
    render(e.detail || {});
  });
})();

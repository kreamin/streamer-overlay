// overlay-runtime.js
// Include this in an overlay package: <script src="/overlay-runtime.js"></script>
//
// It bridges the host overlay page and your overlay:
//  - Fills any element with data-bind="fieldId" with the live value.
//  - Fires a window "overlaydata" event (detail = values) so advanced overlays
//    can animate, compute, etc.
(function () {
  function apply(values) {
    if (!values || typeof values !== "object") return;

    document.querySelectorAll("[data-bind]").forEach(function (el) {
      var key = el.getAttribute("data-bind");
      if (key && Object.prototype.hasOwnProperty.call(values, key)) {
        el.textContent = String(values[key]);
      }
    });

    window.dispatchEvent(new CustomEvent("overlaydata", { detail: values }));

    // Report back to the host (used for the initial-load race + debugging).
    if (window.parent !== window) {
      window.parent.postMessage({ type: "overlay:applied", values: values }, "*");
    }
  }

  window.addEventListener("message", function (event) {
    var msg = event.data;
    if (!msg) return;
    if (msg.type === "overlay:data") apply(msg.values);
    // A one-shot "play now" pulse (e.g. a gif alert firing). Advanced overlays
    // listen for the "overlaypulse" window event.
    if (msg.type === "overlay:pulse") {
      window.dispatchEvent(new CustomEvent("overlaypulse"));
    }
  });

  // Announce readiness so the host sends current values immediately.
  if (window.parent !== window) {
    window.parent.postMessage({ type: "overlay:ready" }, "*");
  }
})();

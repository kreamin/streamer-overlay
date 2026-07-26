// GIF Alert: shows the uploaded image/gif when triggered.
//  - Trigger field bound to a Streamer.bot global → plays when that value changes.
//  - "Play now" button in the control panel → plays immediately (overlaypulse).
//  - Loop → stays visible and loops, ignoring the trigger.
(function () {
  var img = document.getElementById("gif");
  var src = "";
  var duration = 3;
  var loop = false;
  var lastTrigger;
  var seeded = false;
  var hideTimer = null;

  function load() {
    if (!src) {
      img.removeAttribute("src");
      return;
    }
    // Cache-bust so the gif animation restarts from frame 1 each play.
    var sep = src.indexOf("?") === -1 ? "?" : "&";
    img.src = src + sep + "t=" + Date.now();
  }

  function play() {
    if (!src) return;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    load();
    img.style.display = "block";
    if (!loop) {
      hideTimer = setTimeout(function () {
        img.style.display = "none";
      }, Math.max(200, duration * 1000));
    }
  }

  window.addEventListener("overlaydata", function (e) {
    var v = e.detail || {};
    if (v.duration !== undefined) duration = Number(v.duration) || 0;

    var newSrc = v.image !== undefined ? String(v.image || "") : src;
    var newLoop = v.loop !== undefined ? !!v.loop : loop;
    var srcChanged = newSrc !== src;
    src = newSrc;

    if (newLoop !== loop || (newLoop && srcChanged)) {
      loop = newLoop;
      if (loop) {
        play(); // start / refresh the permanent loop
      } else {
        img.style.display = "none";
        if (hideTimer) {
          clearTimeout(hideTimer);
          hideTimer = null;
        }
      }
    }

    // Play when the bound trigger value changes (not while looping).
    if (v.trigger !== undefined) {
      if (seeded && v.trigger !== lastTrigger && !loop) play();
      lastTrigger = v.trigger;
      seeded = true;
    }
  });

  // Manual "Play now" from the control panel.
  window.addEventListener("overlaypulse", function () {
    play();
  });
})();

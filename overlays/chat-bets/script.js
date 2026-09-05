// Chat Bets — a visual aid for a chat-run betting system.
//
// All data arrives as normal overlay field values (the "overlaydata" event),
// because the streamer BINDS these fields to their Streamer.bot globals:
//   title  → betTitle   (the question; set on !openbet)
//   log    → betLog      APPEND-ONLY string, one entry per !bet:
//                        "|user:option:amount|user:option:amount|…"
//   locked → betLocked  ("true"/"false"; set on !closebet)
//   winner → betWinner  (winning option; empty during the round)
//
// The overlay does the display math only: latest bet per user wins, sum points
// per option, draw the proportional bar. No server/app changes — this is a
// pure drop-in package.
(function () {
  var board = document.getElementById("board");
  var elTitle = document.getElementById("title");
  var elStatus = document.getElementById("status");
  var elBar = document.getElementById("bar");
  var elTotals = document.getElementById("totals");
  var elFeedWrap = document.getElementById("feedWrap");
  var elFeed = document.getElementById("feed");

  var cfg = {
    title: "",
    log: "",
    locked: false,
    winner: "",
    accent: "#ffffff",
    bgColor: "#0f1116",
    bgOpacity: 82,
    showBorder: true,
    barHeight: 40,
    currency: "points",
    showFeed: true,
    hideWhenEmpty: true,
    winDuration: 15,
  };

  // Auto-hide-after-win state.
  var hideTimer = null;
  var autoHidden = false;
  var resolveKey = null; // identifies the current resolved round

  var NAMED_COLORS = { yes: "#2ea043", no: "#da3633" };
  var PALETTE = [
    "#1f6feb", "#a371f7", "#db6d28", "#e3b341",
    "#3fb950", "#f778ba", "#56d4dd", "#ff7b72",
  ];

  function fmt(n) {
    return Number(n || 0).toLocaleString("en-US");
  }
  // Combine a #rrggbb color + a 0-100 opacity into an rgba() string.
  function hexToRgba(hex, opacityPct) {
    var h = String(hex || "#000000").replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.substr(0, 2), 16) || 0;
    var g = parseInt(h.substr(2, 2), 16) || 0;
    var b = parseInt(h.substr(4, 2), 16) || 0;
    var a = Math.max(0, Math.min(100, Number(opacityPct))) / 100;
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }
  // Apply the editable panel styling (background / border / blur).
  function applyStyle() {
    board.style.background = hexToRgba(cfg.bgColor, cfg.bgOpacity);
    if (cfg.showBorder) {
      board.style.border = "1px solid rgba(255,255,255,0.08)";
      board.style.backdropFilter = "blur(3px)";
      board.style.webkitBackdropFilter = "blur(3px)";
    } else {
      board.style.border = "none";
      board.style.backdropFilter = "none";
      board.style.webkitBackdropFilter = "none";
    }
  }
  function truthy(v) {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    return /^(true|1|yes|locked)$/i.test(String(v == null ? "" : v).trim());
  }
  function normKey(s) {
    return String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");
  }
  // A global can't be "unset" through the poll, so a round is reset by writing
  // "-" (or empty). Treat both as blank.
  function isBlank(s) {
    var t = String(s == null ? "" : s).trim();
    return t === "" || t === "-";
  }
  function prettyLabel(s) {
    var t = String(s == null ? "" : s).trim();
    var low = t.toLowerCase();
    if (low === "yes") return "YES";
    if (low === "no") return "NO";
    return t;
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // Parse the append-only log into deduped standings + a chronological feed.
  function parseLog(logStr) {
    var raw = String(logStr || "");
    var entries = raw.split("|");
    var latestByUser = {}; // userLower -> {user, option, amount}
    var feed = []; // chronological, for the "recent bets" list

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i].trim();
      if (!e) continue;
      var parts = e.split(":");
      if (parts.length < 3) continue;
      var user = parts[0].trim();
      var option = parts[1].trim();
      var amount = parseFloat(parts[2]);
      if (!user || !option || !(amount > 0)) continue;
      latestByUser[user.toLowerCase()] = { user: user, option: option, amount: amount };
      feed.push({ user: user, option: option, amount: amount });
    }

    // Aggregate the deduped wagers into per-option totals, first-seen order.
    var totals = {}, labels = {}, order = [], counts = {};
    Object.keys(latestByUser).forEach(function (k) {
      var w = latestByUser[k];
      var key = normKey(w.option);
      if (!(key in totals)) {
        totals[key] = 0;
        counts[key] = 0;
        labels[key] = prettyLabel(w.option);
        order.push(key);
      }
      totals[key] += w.amount;
      counts[key] += 1;
    });

    return { totals: totals, labels: labels, order: order, counts: counts, feed: feed };
  }

  function colorFor(key, index) {
    if (NAMED_COLORS[key]) return NAMED_COLORS[key];
    return PALETTE[index % PALETTE.length];
  }

  function render() {
    applyStyle();

    // "-" is the reset sentinel for the log too (parses to no valid entries).
    var parsed = parseLog(isBlank(cfg.log) ? "" : cfg.log);
    var order = parsed.order;
    var pool = order.reduce(function (s, k) { return s + parsed.totals[k]; }, 0);
    var titleText = isBlank(cfg.title) ? "" : String(cfg.title).trim();
    var winnerKey = isBlank(cfg.winner) ? "" : normKey(cfg.winner);
    var resolved = !!winnerKey; // a winner was declared
    var hasRound = !!titleText || order.length > 0;

    // Auto-hide after a win: start a one-shot timer when a NEW result lands.
    var resId = resolved ? titleText + "§" + winnerKey : null;
    if (resId !== resolveKey) {
      resolveKey = resId;
      autoHidden = false;
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      if (resId && cfg.winDuration > 0) {
        hideTimer = setTimeout(function () {
          autoHidden = true;
          board.classList.add("hidden");
        }, cfg.winDuration * 1000);
      }
    }

    var hide = autoHidden || (!hasRound && cfg.hideWhenEmpty);
    if (hide) {
      board.classList.add("hidden");
      return;
    }
    board.classList.remove("hidden");

    // color map by first-seen order
    var colors = {};
    order.forEach(function (k, i) { colors[k] = colorFor(k, i); });

    // ---- title + status -----------------------------------------------
    elTitle.textContent = titleText || "Waiting for a bet…";
    elTitle.style.color = cfg.accent;

    elStatus.className = "status";
    if (resolved) {
      elStatus.textContent = "Winner: " + (parsed.labels[winnerKey] || cfg.winner);
      elStatus.classList.add("resolved");
    } else if (cfg.locked) {
      elStatus.textContent = "Locked";
      elStatus.classList.add("locked");
    } else {
      elStatus.textContent = "Open";
      elStatus.classList.add("open");
    }

    // ---- proportional bar ---------------------------------------------
    elBar.style.height = cfg.barHeight + "px";
    elBar.innerHTML = "";
    if (pool === 0) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No bets yet";
      elBar.appendChild(empty);
    } else {
      order.forEach(function (k) {
        var total = parsed.totals[k];
        if (!total) return;
        var frac = total / pool;
        var isWin = resolved && k === winnerKey;
        var seg = document.createElement("div");
        seg.className = "seg" + (resolved && !isWin ? " dim" : "") + (isWin ? " win" : "");
        seg.style.background = colors[k];
        seg.style.flexGrow = String(total);
        seg.style.flexBasis = "0";
        seg.textContent = frac >= 0.12 ? parsed.labels[k] + " " + Math.round(frac * 100) + "%" : "";
        elBar.appendChild(seg);
      });
    }

    // ---- per-option totals + pool -------------------------------------
    elTotals.innerHTML = "";
    order.forEach(function (k) {
      var pct = pool ? Math.round((parsed.totals[k] / pool) * 100) : 0;
      var t = document.createElement("div");
      t.className = "t";
      var dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = colors[k];
      t.appendChild(dot);
      var txt = document.createElement("span");
      txt.textContent = parsed.labels[k] + ": " + fmt(parsed.totals[k]) + " (" + pct + "%)";
      t.appendChild(txt);
      elTotals.appendChild(t);
    });
    if (order.length) {
      var poolEl = document.createElement("div");
      poolEl.className = "pool";
      poolEl.textContent = "Pool: " + fmt(pool) + " " + cfg.currency;
      elTotals.appendChild(poolEl);
    }

    // ---- recent feed (newest first) -----------------------------------
    elFeedWrap.className = "feed-wrap" + (cfg.showFeed ? "" : " hide");
    if (cfg.showFeed) {
      elFeed.innerHTML = "";
      var recent = parsed.feed.slice(-12).reverse();
      recent.forEach(function (w) {
        var row = document.createElement("div");
        row.className = "row";
        row.innerHTML =
          "<b>" + escapeHtml(w.user) + "</b>: " + fmt(w.amount) + " on " +
          escapeHtml(prettyLabel(w.option));
        elFeed.appendChild(row);
      });
    }
  }

  // Bound field values (and manual styling fields) arrive here.
  window.addEventListener("overlaydata", function (e) {
    var v = e.detail || {};
    if (v.title !== undefined) cfg.title = String(v.title == null ? "" : v.title);
    if (v.log !== undefined) cfg.log = String(v.log == null ? "" : v.log);
    if (v.locked !== undefined) cfg.locked = truthy(v.locked);
    if (v.winner !== undefined) cfg.winner = String(v.winner == null ? "" : v.winner);
    if (v.accent !== undefined) cfg.accent = String(v.accent || "#ffffff");
    if (v.bgColor !== undefined) cfg.bgColor = String(v.bgColor || "#0f1116");
    if (v.bgOpacity !== undefined) cfg.bgOpacity = Number(v.bgOpacity);
    if (v.showBorder !== undefined) cfg.showBorder = !!v.showBorder;
    if (v.barHeight !== undefined) cfg.barHeight = Number(v.barHeight) || 40;
    if (v.currency !== undefined) cfg.currency = String(v.currency || "points");
    if (v.showFeed !== undefined) cfg.showFeed = !!v.showFeed;
    if (v.hideWhenEmpty !== undefined) cfg.hideWhenEmpty = !!v.hideWhenEmpty;
    if (v.winDuration !== undefined) cfg.winDuration = Number(v.winDuration) || 0;
    render();
  });

  render();
})();

/* =============================================================================
 *  MATRIX TERMINAL  ·  APPLICATION
 *  Rendering, live price simulation, sparklines, verdict engine, command line,
 *  keyboard navigation. No external dependencies.
 * ===========================================================================*/
(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // Live simulated state per ticker (price, prevClose, history).
  const live = {};
  let current = STOCK_ORDER[0];

  STOCK_ORDER.forEach((sym) => {
    const s = STOCKS[sym];
    const prevClose = s.price * (1 - (Math.random() - 0.5) * 0.02);
    live[sym] = {
      price: s.price,
      prevClose: prevClose,
      open: prevClose * (1 + (Math.random() - 0.5) * 0.006),
      day: { hi: s.price, lo: s.price },
      hist: Array.from({ length: 60 }, () => s.price),
    };
  });

  /* ---------- Formatting helpers ---------- */
  const fmt = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signed = (n, d = 2) => (n >= 0 ? "+" : "") + n.toFixed(d);

  /* ---------- Verdict engine ---------- */
  // Weighted bull/bear score from a stock's signals -> -100..+100 + label.
  function verdict(sym) {
    const sigs = STOCKS[sym].signals;
    let score = 0, total = 0;
    sigs.forEach((g) => {
      const w = g.weight || 1;
      total += w;
      if (g.stance === "bull") score += w;
      else if (g.stance === "bear") score -= w;
    });
    const pct = total ? Math.round((score / total) * 100) : 0;
    let label, cls;
    if (pct >= 45) { label = "STRONG BULL"; cls = "bull"; }
    else if (pct >= 15) { label = "BULLISH"; cls = "bull"; }
    else if (pct > -15) { label = "CONTESTED"; cls = "neutral"; }
    else if (pct > -45) { label = "BEARISH"; cls = "bear"; }
    else { label = "STRONG BEAR"; cls = "bear"; }
    return { pct, label, cls };
  }

  /* ---------- Sparkline renderer ---------- */
  function drawSpark(canvas, data, color) {
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 120;
    const h = canvas.clientHeight || 30;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr; canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const min = Math.min(...data), max = Math.max(...data);
    const range = max - min || 1;
    const pad = 2;
    const px = (i) => pad + (i / (data.length - 1)) * (w - pad * 2);
    const py = (v) => h - pad - ((v - min) / range) * (h - pad * 2);

    // area fill
    ctx.beginPath();
    ctx.moveTo(px(0), py(data[0]));
    for (let i = 1; i < data.length; i++) ctx.lineTo(px(i), py(data[i]));
    ctx.lineTo(px(data.length - 1), h);
    ctx.lineTo(px(0), h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + "55");
    grad.addColorStop(1, color + "00");
    ctx.fillStyle = grad;
    ctx.fill();

    // line
    ctx.beginPath();
    ctx.moveTo(px(0), py(data[0]));
    for (let i = 1; i < data.length; i++) ctx.lineTo(px(i), py(data[i]));
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // head dot
    ctx.beginPath();
    ctx.arc(px(data.length - 1), py(data[data.length - 1]), 1.8, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  const stanceColor = (s) =>
    s === "bull" ? "#00ff66" : s === "bear" ? "#ff3b5c" : "#ffcc33";

  /* ---------- Watchlist (left rail) ---------- */
  function buildWatchlist() {
    const rail = $("#watchlist");
    rail.innerHTML = "";
    STOCK_ORDER.forEach((sym, i) => {
      const s = STOCKS[sym];
      const v = verdict(sym);
      const row = document.createElement("button");
      row.className = "wl-row";
      row.dataset.sym = sym;
      row.setAttribute("role", "tab");
      row.innerHTML = `
        <div class="wl-main">
          <span class="wl-idx">${i + 1}</span>
          <span class="wl-sym">${sym}</span>
          <span class="wl-verdict ${v.cls}">${v.label}</span>
        </div>
        <div class="wl-sub">
          <span class="wl-name">${s.sector}</span>
        </div>
        <div class="wl-quote">
          <span class="wl-price" data-price="${sym}">--</span>
          <span class="wl-chg" data-chg="${sym}">--</span>
        </div>
        <canvas class="wl-spark" data-wlspark="${sym}"></canvas>
      `;
      row.addEventListener("click", () => selectStock(sym));
      rail.appendChild(row);
    });
  }

  /* ---------- Detail panel ---------- */
  function buildDetail(sym) {
    const s = STOCKS[sym];
    const v = verdict(sym);
    const root = $("#detail");

    const groups = {};
    s.signals.forEach((g) => { (groups[g.group] ||= []).push(g); });
    const groupOrder = Object.keys(groups);

    const cardHTML = (g) => {
      const c = stanceColor(g.stance);
      const arrow = g.trend === "up" ? "▲" : g.trend === "down" ? "▼" : "■";
      const dots = "●".repeat(g.weight) + "○".repeat(3 - g.weight);
      return `
        <article class="card ${g.stance}" tabindex="0">
          <header class="card-h">
            <span class="card-label">${g.label}</span>
            <span class="card-weight" title="thesis weight">${dots}</span>
          </header>
          <div class="card-val">
            <span class="card-value">${g.value}</span>
            <span class="card-delta ${g.trend}">${arrow} ${g.delta}</span>
          </div>
          <canvas class="card-spark" data-cardspark="${g.key}"></canvas>
          <div class="card-gauge"><i style="width:${clamp(g.raw,2,100)}%;background:${c};box-shadow:0 0 8px ${c}"></i></div>
          <p class="card-note">${g.note}</p>
        </article>`;
    };

    root.innerHTML = `
      <div class="dt-head">
        <div class="dt-id">
          <h2 class="dt-sym glitch" data-text="${sym}">${sym}</h2>
          <div class="dt-meta">
            <span class="dt-name">${s.name}</span>
            <span class="dt-sector">// ${s.sector}</span>
          </div>
        </div>
        <div class="dt-quote">
          <span class="dt-price" data-price="${sym}">--</span>
          <span class="dt-chg" data-chg="${sym}">--</span>
          <div class="dt-stats">
            <span>O <b data-open="${sym}">--</b></span>
            <span>H <b data-hi="${sym}">--</b></span>
            <span>L <b data-lo="${sym}">--</b></span>
            <span>PC <b>${fmt(live[sym].prevClose)}</b></span>
          </div>
        </div>
      </div>

      <div class="dt-thesis">
        <div class="thesis-tag">${s.tag}</div>
        <p>${s.thesis}</p>
        <div class="verdict">
          <span class="verdict-label">THESIS VERDICT</span>
          <div class="verdict-meter">
            <div class="verdict-track">
              <span class="verdict-zero"></span>
              <i class="verdict-fill ${v.cls}" style="--pct:${v.pct}"></i>
            </div>
            <span class="verdict-val ${v.cls}">${v.label} · ${signed(v.pct,0)}</span>
          </div>
        </div>
      </div>

      ${groupOrder.map((gname) => `
        <section class="group">
          <h3 class="group-h"><span>${gname}</span><i></i></h3>
          <div class="cards">
            ${groups[gname].map(cardHTML).join("")}
          </div>
        </section>`).join("")}

      <footer class="dt-foot">
        <span class="sim-badge" title="Prices are simulated; structural signals are curated reference values.">◉ SIM FEED</span>
        <span>Signals weighted by thesis impact · ●●● = high</span>
      </footer>
    `;

    // Render sparklines for cards now that they're in the DOM.
    s.signals.forEach((g) => {
      const cv = $(`[data-cardspark="${g.key}"]`, root);
      if (cv) drawSpark(cv, g.spark, stanceColor(g.stance));
    });

    // Animate verdict fill width via CSS var transition.
    requestAnimationFrame(() => {
      const fill = $(".verdict-fill", root);
      if (fill) fill.style.width = Math.abs(v.pct) / 2 + "%";
    });

    updateQuotes();
  }

  /* ---------- Selection ---------- */
  function selectStock(sym) {
    if (!STOCKS[sym]) return;
    current = sym;
    $$(".wl-row").forEach((r) =>
      r.classList.toggle("active", r.dataset.sym === sym));
    buildDetail(sym);
    log(`> loaded ${sym} :: ${STOCKS[sym].name}`);
  }

  /* ---------- Live quote simulation ---------- */
  function tick() {
    STOCK_ORDER.forEach((sym) => {
      const s = STOCKS[sym];
      const st = live[sym];
      const drift = (Math.random() - 0.5) * 2 * s.vol * st.price * 0.06;
      st.price = Math.max(0.5, st.price + drift);
      st.day.hi = Math.max(st.day.hi, st.price);
      st.day.lo = Math.min(st.day.lo, st.price);
      st.hist.push(st.price);
      if (st.hist.length > 60) st.hist.shift();
    });
    updateQuotes();
  }

  function paintQuote(priceEl, chgEl, sym) {
    const st = live[sym];
    const chg = st.price - st.prevClose;
    const pct = (chg / st.prevClose) * 100;
    const dir = chg >= 0 ? "up" : "down";
    if (priceEl) {
      const prev = parseFloat(priceEl.dataset.last || "0");
      priceEl.textContent = fmt(st.price);
      priceEl.classList.remove("flash-up", "flash-down");
      if (st.price > prev) void priceEl.offsetWidth, priceEl.classList.add("flash-up");
      else if (st.price < prev) void priceEl.offsetWidth, priceEl.classList.add("flash-down");
      priceEl.dataset.last = st.price;
    }
    if (chgEl) {
      chgEl.textContent = `${signed(chg)} (${signed(pct)}%)`;
      chgEl.classList.remove("up", "down");
      chgEl.classList.add(dir);
    }
  }

  function updateQuotes() {
    STOCK_ORDER.forEach((sym) => {
      $$(`[data-price="${sym}"]`).forEach((el) =>
        paintQuote(el, null, sym));
      $$(`[data-chg="${sym}"]`).forEach((el) =>
        paintQuote(null, el, sym));
      const st = live[sym];
      const setTxt = (q, val) => $$(`[${q}="${sym}"]`).forEach((e) => (e.textContent = val));
      setTxt("data-open", fmt(st.open));
      setTxt("data-hi", fmt(st.day.hi));
      setTxt("data-lo", fmt(st.day.lo));
      const wl = $(`[data-wlspark="${sym}"]`);
      if (wl) {
        const up = st.price >= st.prevClose;
        drawSpark(wl, st.hist, up ? "#00ff66" : "#ff3b5c");
      }
    });
  }

  /* ---------- Header clock + market status ---------- */
  function updateClock() {
    const now = new Date();
    const utc = now.toISOString().substr(11, 8);
    $("#clock").textContent = utc + " UTC";
    // US market hours 13:30-20:00 UTC, Mon-Fri (approx, no holidays).
    const h = now.getUTCHours(), m = now.getUTCMinutes(), day = now.getUTCDay();
    const mins = h * 60 + m;
    const open = day >= 1 && day <= 5 && mins >= 810 && mins < 1200;
    const badge = $("#mkt-status");
    badge.textContent = open ? "● MARKET OPEN" : "● MARKET CLOSED";
    badge.className = open ? "mkt open" : "mkt closed";
  }

  /* ---------- Command line ---------- */
  function log(msg) {
    const out = $("#cmd-log");
    const line = document.createElement("div");
    line.className = "cmd-line";
    line.textContent = msg;
    out.appendChild(line);
    while (out.children.length > 40) out.removeChild(out.firstChild);
    out.scrollTop = out.scrollHeight;
  }

  function runCommand(raw) {
    const cmd = raw.trim().toLowerCase();
    if (!cmd) return;
    log(`$ ${raw}`);
    const up = raw.trim().toUpperCase();
    if (STOCKS[up]) { selectStock(up); return; }
    switch (cmd) {
      case "help":
      case "?":
        log("commands: <TICKER> | list | thesis | next | prev | top | help | clear");
        log("tickers: " + STOCK_ORDER.join(" · "));
        break;
      case "list":
        STOCK_ORDER.forEach((s) => {
          const v = verdict(s);
          log(`  ${s.padEnd(5)} ${fmt(live[s].price).padStart(9)}  ${v.label}`);
        });
        break;
      case "thesis":
        log(`◆ ${current}: ${STOCKS[current].tag}`);
        log(STOCKS[current].thesis);
        break;
      case "top": {
        const ranked = [...STOCK_ORDER].sort((a, b) => verdict(b).pct - verdict(a).pct);
        log("thesis ranking (bull→bear):");
        ranked.forEach((s, i) => log(`  ${i + 1}. ${s} ${signed(verdict(s).pct, 0)}`));
        break;
      }
      case "next": cycle(1); break;
      case "prev": cycle(-1); break;
      case "clear": $("#cmd-log").innerHTML = ""; break;
      default:
        log(`?? unknown command: ${cmd} (try 'help')`);
    }
  }

  function cycle(dir) {
    const i = STOCK_ORDER.indexOf(current);
    const n = (i + dir + STOCK_ORDER.length) % STOCK_ORDER.length;
    selectStock(STOCK_ORDER[n]);
  }

  /* ---------- Keyboard ---------- */
  function onKey(e) {
    const input = $("#cmd-input");
    if (document.activeElement === input) {
      if (e.key === "Enter") { runCommand(input.value); input.value = ""; }
      return;
    }
    if (e.key >= "1" && e.key <= "5") {
      const idx = parseInt(e.key, 10) - 1;
      if (STOCK_ORDER[idx]) selectStock(STOCK_ORDER[idx]);
    } else if (e.key === "ArrowDown" || e.key === "j") { cycle(1); }
    else if (e.key === "ArrowUp" || e.key === "k") { cycle(-1); }
    else if (e.key === "/") { e.preventDefault(); input.focus(); }
  }

  /* ---------- Boot sequence ---------- */
  function boot() {
    const screen = $("#boot");
    const lines = [
      "INITIALIZING MATRIX TERMINAL v2.6 ...",
      "establishing secure uplink ............ [ OK ]",
      "loading signal kernels ................ [ OK ]",
      "calibrating thesis engine ............. [ OK ]",
      "syncing watchlist: ORCL MSFT HOOD NKE GEV",
      "decrypting market tape ................ [ OK ]",
      "WAKE UP. THE MARKET HAS YOU.",
    ];
    const body = $("#boot-body");
    let i = 0;
    function nextLine() {
      if (i >= lines.length) {
        setTimeout(() => {
          screen.classList.add("done");
          setTimeout(() => screen.remove(), 700);
        }, 450);
        return;
      }
      const el = document.createElement("div");
      el.className = "boot-line";
      body.appendChild(el);
      typeLine(el, lines[i], () => { i++; nextLine(); });
    }
    function typeLine(el, text, done) {
      let c = 0;
      const iv = setInterval(() => {
        el.textContent = text.slice(0, c++) + (c % 2 ? "_" : "");
        if (c > text.length) {
          clearInterval(iv);
          el.textContent = text;
          setTimeout(done, 90);
        }
      }, 14);
    }
    nextLine();
  }

  /* ---------- Init ---------- */
  function init() {
    buildWatchlist();
    selectStock(current);
    updateClock();
    log("matrix terminal ready. type 'help' or click a ticker.");

    setInterval(tick, 1200);
    setInterval(updateClock, 1000);
    document.addEventListener("keydown", onKey);
    $("#cmd-input").addEventListener("blur", () => {});
    window.addEventListener("resize", () => {
      // Re-render sparklines crisply on resize.
      buildDetail(current);
    });

    boot();
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();
})();

/* =============================================================================
 *  MATRIX TERMINAL  ·  APPLICATION
 *  Renders ONLY real, AI-researched data (js/live-data.js). No simulated price
 *  tape, no curated fallback values. data.js supplies structure only (names,
 *  sectors, thesis text, signal labels/groups); every number shown comes from
 *  the live research feed. Signals refresh only on a manual FULL UPDATE; the
 *  daily automated run is a news+price Telegram brief and does not touch the site.
 * ===========================================================================*/
(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // Live research feed (written by scripts/update-signals.mjs). May be null.
  let LIVE = null;
  const liveStock = (sym) => (LIVE && LIVE.stocks[sym]) || null;

  // Overlay researched values onto the structural model and flag what's real.
  // Only flagged (_live) signals are ever rendered.
  function ingest(data) {
    LIVE = (data && data.stocks) ? data : null;
    // Reset any prior overlay first.
    for (const sym of NAV_ORDER) {
      const s = STOCKS[sym];
      s.price = null; s.changePct = null; s.earnings = null;
      for (const g of s.signals) delete g._live;
    }
    if (!LIVE) return;
    for (const sym of NAV_ORDER) {
      const ls = LIVE.stocks[sym];
      if (!ls) continue;
      const s = STOCKS[sym];
      s.price = Number.isFinite(ls.price) ? ls.price : null;
      s.changePct = Number.isFinite(ls.changePct) ? ls.changePct : null;
      s.earnings = typeof ls.earnings === "string" ? ls.earnings : null;
      for (const g of s.signals) {
        const lv = ls.signals && ls.signals[g.key];
        if (!lv || !lv.value) continue;
        g.value = lv.value;
        g.trend = lv.trend || "flat";
        g.stance = lv.stance || "neutral";
        g.raw = Number.isFinite(lv.raw) ? lv.raw : 50;
        g.note = lv.note || "";
        g._live = true;
      }
    }
  }
  ingest(window.LIVE_SIGNALS);

  let current = STOCK_ORDER[0];

  /* ---------- Formatting helpers ---------- */
  const fmt = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signed = (n, d = 2) => (n >= 0 ? "+" : "") + n.toFixed(d);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function timeAgo(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (mins < 60) return mins + "m ago";
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    return Math.round(hrs / 24) + "d ago";
  }

  // Only signals confirmed present in the live feed.
  const liveSignals = (sym) => STOCKS[sym].signals.filter((g) => g._live);

  // Feed status chip: LIVE (researched), DEMO (local dry-run mock), or none.
  function feedBadge() {
    if (LIVE && LIVE.mode === "live")
      return `<span class="sim-badge live" title="AI-researched signals, refreshed on full update.">◉ LIVE · ${timeAgo(LIVE.generatedAt)}</span>`;
    if (LIVE && LIVE.mode === "mock")
      return `<span class="sim-badge demo" title="Local dry-run mock (not researched).">◉ DEMO · ${timeAgo(LIVE.generatedAt)}</span>`;
    return `<span class="sim-badge demo" title="No researched data yet. Run a full update.">◉ NO LIVE DATA</span>`;
  }

  const stanceColor = (s) =>
    s === "bull" ? "#00ff66" : s === "bear" ? "#ff3b5c" : "#ffcc33";

  // Days until a YYYY-MM-DD date (negative = past). null if unparseable.
  function daysUntil(dateStr) {
    const t = Date.parse(dateStr + "T00:00:00Z");
    if (!Number.isFinite(t)) return null;
    return Math.round((t - Date.now()) / 864e5);
  }

  /* ---------- Verdict engine (over live signals only) ---------- */
  function verdict(sym) {
    const sigs = liveSignals(sym);
    if (!sigs.length) return { pct: 0, label: "NO DATA", cls: "neutral", n: 0 };
    let score = 0, total = 0;
    sigs.forEach((g) => {
      if (!g.weight) return; // weight 0 = display-only (e.g. sentiment); never scored
      total += g.weight;
      if (g.stance === "bull") score += g.weight;
      else if (g.stance === "bear") score -= g.weight;
    });
    const pct = total ? Math.round((score / total) * 100) : 0;
    let label, cls;
    if (pct >= 45) { label = "STRONG BULL"; cls = "bull"; }
    else if (pct >= 15) { label = "BULLISH"; cls = "bull"; }
    else if (pct > -15) { label = "CONTESTED"; cls = "neutral"; }
    else if (pct > -45) { label = "BEARISH"; cls = "bear"; }
    else { label = "STRONG BEAR"; cls = "bear"; }
    return { pct, label, cls, n: sigs.length };
  }

  /* ---------- Quote (real price + real daily change) ---------- */
  function quoteHTML(sym, big) {
    const s = STOCKS[sym];
    const priceCls = big ? "dt-price" : "wl-price";
    const chgCls = big ? "dt-chg" : "wl-chg";
    if (!Number.isFinite(s.price)) {
      return `<span class="${priceCls}">—</span><span class="${chgCls}"></span>`;
    }
    let chg = "";
    let dir = "";
    if (Number.isFinite(s.changePct)) {
      const abs = (s.price * s.changePct) / 100;
      dir = s.changePct >= 0 ? "up" : "down";
      chg = `${signed(abs)} (${signed(s.changePct)}%)`;
    }
    return `<span class="${priceCls}">${fmt(s.price)}</span>` +
           `<span class="${chgCls} ${dir}">${chg}</span>`;
  }

  /* ---------- Watchlist (left rail) ---------- */
  function buildWatchlist() {
    const rail = $("#watchlist");
    rail.innerHTML = "";
    NAV_ORDER.forEach((sym, i) => {
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
          <span class="wl-name">${esc(s.sector)}</span>
        </div>
        <div class="wl-quote">${quoteHTML(sym, false)}</div>
      `;
      row.addEventListener("click", () => selectStock(sym));
      rail.appendChild(row);
    });
  }

  // Top breaking-news panel (3 most important headlines, under the signal cards).
  function newsHTML(ls) {
    const news = (ls && Array.isArray(ls.news)) ? ls.news.slice(0, 3) : [];
    if (!news.length) return "";
    return `
      <section class="group news">
        <h3 class="group-h"><span>BREAKING NEWS</span><i></i></h3>
        <ul class="newslist">
          ${news.map((n) => `
            <li>
              <a href="${esc(n.url)}" target="_blank" rel="noopener">
                <span class="news-dot"></span><span class="news-title">${esc(n.title)}</span>
              </a>
              ${n.source ? `<span class="news-src">${esc(n.source)}</span>` : ""}
            </li>`).join("")}
        </ul>
      </section>`;
  }

  /* ---------- Detail panel ---------- */
  function buildDetail(sym) {
    const s = STOCKS[sym];
    const v = verdict(sym);
    const root = $("#detail");
    const ls = liveStock(sym);
    const sigs = liveSignals(sym);

    const aiReadHTML = (ls && ls.summary) ? `
      <div class="ai-read">
        <span class="ai-tag">AI READ</span>
        <span class="ai-text">${esc(ls.summary)}</span>
        ${ls.asOf ? `<span class="ai-asof">as of ${esc(ls.asOf)}</span>` : ""}
        ${(ls.sources && ls.sources.length) ? `<span class="ai-src">${
          ls.sources.map((u, i) =>
            `<a href="${esc(u)}" target="_blank" rel="noopener">[${i + 1}]</a>`).join(" ")
        }</span>` : ""}
      </div>` : "";

    const groups = {};
    sigs.forEach((g) => { (groups[g.group] ||= []).push(g); });
    const groupOrder = Object.keys(groups);

    const cardHTML = (g) => {
      const c = stanceColor(g.stance);
      const dots = "●".repeat(g.weight) + "○".repeat(3 - g.weight);
      const stanceLabel = g.stance === "bull" ? "BULLISH"
        : g.stance === "bear" ? "BEARISH" : "NEUTRAL";
      const wtHTML = g.weight
        ? `<span class="card-weight" title="thesis weight">${dots}</span>`
        : `<span class="card-weight unweighted" title="display only — not scored">unweighted</span>`;
      return `
        <article class="card ${g.stance}" tabindex="0">
          <header class="card-h">
            <span class="card-label">${esc(g.label)}</span>
            <span class="card-tags">
              <span class="card-stance ${g.stance}" title="impact on the bull thesis">${stanceLabel}</span>
              ${wtHTML}
            </span>
          </header>
          <div class="card-val">
            <span class="card-value">${esc(g.value)}</span>
          </div>
          <div class="card-gauge"><i style="width:${clamp(g.raw,2,100)}%;background:${c};box-shadow:0 0 8px ${c}"></i></div>
          <p class="card-note">${esc(g.note)}</p>
        </article>`;
    };

    const bodyHTML = sigs.length
      ? groupOrder.map((gname) => `
          <section class="group">
            <h3 class="group-h"><span>${esc(gname)}</span><i></i></h3>
            <div class="cards">${groups[gname].map(cardHTML).join("")}</div>
          </section>`).join("")
      : `<div class="no-data">NO LIVE DATA FOR ${sym} YET — the research feed hasn't returned values for this name. Run a full update (or wait for it to be triggered).</div>`;

    // Earnings countdown.
    const ed = s.earnings ? daysUntil(s.earnings) : null;
    const earnHTML = (ed != null) ? `<span class="dt-earn ${ed <= 7 && ed >= 0 ? "soon" : ""}">⏱ ${
      ed < 0 ? "reported " + (-ed) + "d ago" : ed === 0 ? "EARNINGS TODAY" : "earnings in " + ed + "d"
    } <b>${esc(s.earnings)}</b></span>` : "";

    const verdictHTML = v.n ? `
      <div class="verdict">
        <span class="verdict-label">THESIS VERDICT</span>
        <div class="verdict-meter">
          <div class="verdict-track">
            <span class="verdict-zero"></span>
            <i class="verdict-fill ${v.cls}"></i>
          </div>
          <span class="verdict-val ${v.cls}">${v.label} · ${signed(v.pct,0)}</span>
        </div>
      </div>` : "";

    root.innerHTML = `
      <div class="dt-head">
        <div class="dt-id">
          <h2 class="dt-sym glitch" data-text="${sym}">${sym}</h2>
          <div class="dt-meta">
            <span class="dt-name">${esc(s.name)}</span>
            <span class="dt-sector">// ${esc(s.sector)}</span>
            ${earnHTML}
          </div>
        </div>
        <div class="dt-quote">${quoteHTML(sym, true)}</div>
      </div>

      <div class="dt-thesis">
        <div class="thesis-tag">${esc(s.tag)}</div>
        <p>${esc(s.thesis)}</p>
        ${verdictHTML}
        ${aiReadHTML}
      </div>

      ${bodyHTML}

      ${newsHTML(ls)}

      <footer class="dt-foot">
        ${feedBadge()}
        <span>${v.n} live signal${v.n === 1 ? "" : "s"} · sentiment shown but unweighted</span>
      </footer>
    `;

    // Animate verdict fill width.
    requestAnimationFrame(() => {
      const fill = $(".verdict-fill", root);
      if (fill) fill.style.width = Math.abs(v.pct) / 2 + "%";
    });
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
        log("commands: <TICKER> | list | thesis | feed | update | next | prev | top | help | clear");
        log("nav: keys [1-4] · " + NAV_ORDER.join(" · "));
        break;
      case "update":
        if (window.MatrixUpdate) window.MatrixUpdate.trigger(log);
        else log("update button unavailable");
        break;
      case "feed":
        if (LIVE && LIVE.mode === "live") {
          log("◉ LIVE — AI-researched signals (real data only)");
          log(`  model: ${LIVE.model}`);
          log(`  refreshed: ${timeAgo(LIVE.generatedAt)} (${LIVE.generatedAt})`);
          log(`  ${Object.keys(LIVE.stocks).length}/${STOCK_ORDER.length} tickers updated`);
        } else if (LIVE && LIVE.mode === "mock") {
          log("◉ DEMO — local dry-run mock (not researched)");
        } else {
          log("◉ NO LIVE DATA — trigger a full update to populate real signals");
        }
        break;
      case "list":
        STOCK_ORDER.forEach((s) => {
          const v = verdict(s);
          const p = Number.isFinite(STOCKS[s].price) ? fmt(STOCKS[s].price) : "—";
          log(`  ${s.padEnd(5)} ${String(p).padStart(9)}  ${v.label}`);
        });
        break;
      case "thesis":
        log(`◆ ${current}: ${STOCKS[current].tag}`);
        log(STOCKS[current].thesis);
        break;
      case "top": {
        const ranked = [...STOCK_ORDER].sort((a, b) => verdict(b).pct - verdict(a).pct);
        log("thesis ranking (bull→bear):");
        ranked.forEach((s, i) => log(`  ${i + 1}. ${s} ${signed(verdict(s).pct, 0)} (${verdict(s).label})`));
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
    const i = NAV_ORDER.indexOf(current);
    const n = (i + dir + NAV_ORDER.length) % NAV_ORDER.length;
    selectStock(NAV_ORDER[n]);
  }

  /* ---------- Keyboard ---------- */
  function onKey(e) {
    const input = $("#cmd-input");
    if (document.activeElement === input) {
      if (e.key === "Enter") { runCommand(input.value); input.value = ""; }
      return;
    }
    if (e.key >= "1" && e.key <= "9") {
      const idx = parseInt(e.key, 10) - 1;
      if (NAV_ORDER[idx]) selectStock(NAV_ORDER[idx]);
    }
    else if (e.key === "ArrowDown" || e.key === "j") { cycle(1); }
    else if (e.key === "ArrowUp" || e.key === "k") { cycle(-1); }
    else if (e.key === "/") { e.preventDefault(); input.focus(); }
  }

  /* ---------- Boot sequence ---------- */
  function boot() {
    const screen = $("#boot");
    const lines = [
      "INITIALIZING MATRIX TERMINAL v3.0 ...",
      "establishing secure uplink ............ [ OK ]",
      "loading signal kernels ................ [ OK ]",
      "calibrating thesis engine ............. [ OK ]",
      "syncing watchlist: ORCL MSFT NKE GEV",
      "pulling live AI research feed ......... [ OK ]",
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
    const rf = $(".rail-foot");
    if (rf) rf.innerHTML = feedBadge();
    if (window.MatrixUpdate) window.MatrixUpdate.mount(log);
    selectStock(current);
    updateClock();
    log("matrix terminal ready. type 'help' or click a ticker.");
    if (LIVE && LIVE.mode === "live")
      log(`◉ live AI feed · refreshed ${timeAgo(LIVE.generatedAt)} via ${LIVE.model}`);
    else if (LIVE && LIVE.mode === "mock")
      log("◉ demo feed (local dry-run mock)");
    else
      log("◉ no live data yet · trigger a full update to populate real signals");

    setInterval(updateClock, 1000);
    document.addEventListener("keydown", onKey);

    boot();
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();
})();

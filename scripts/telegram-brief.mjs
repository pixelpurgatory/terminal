/* =============================================================================
 *  MATRIX TERMINAL  ·  TELEGRAM MORNING/CLOSE BRIEF
 *  -----------------------------------------------------------------------------
 *  Reads the freshly-written data/live.json and sends a detailed brief to
 *  Telegram. Runs after the research step in CI.
 *
 *  Needs repo secrets (exposed as env):
 *    TELEGRAM_BOT_TOKEN   - from @BotFather
 *    TELEGRAM_CHAT_ID     - your numeric chat id (message the bot first!)
 *  Optional env:
 *    BRIEF_SESSION = "morning" | "close"   (header label; default morning)
 *    TERMINAL_URL  = link shown in the footer
 *
 *  If the secrets are absent it prints a preview and exits 0 (no failure), so
 *  it's safe before setup and usable as a local preview:
 *    node scripts/telegram-brief.mjs            # preview to stdout
 *    BRIEF_SESSION=close node scripts/telegram-brief.mjs
 * ===========================================================================*/

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
const SESSION = (process.env.BRIEF_SESSION || "morning").toLowerCase();
const URL = process.env.TERMINAL_URL || "https://pixelpurgatory.github.io/terminal/";

/* ---------- Load structure + live data ---------- */
function loadCurated() {
  const code = readFileSync(resolve(ROOT, "js/data.js"), "utf8");
  const shim = { exports: {} };
  new Function("module", "exports", code)(shim, shim.exports);
  return shim.exports;
}
function loadLive() {
  try { return JSON.parse(readFileSync(resolve(ROOT, "data/live.json"), "utf8")); }
  catch { return null; }
}

const { STOCKS, STOCK_ORDER, NAV_ORDER } = loadCurated();
const LIVE = loadLive();

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const STANCE = { bull: "🟢", bear: "🔴", neutral: "🟡" };
const isMacro = (sym) => !!(STOCKS[sym] && STOCKS[sym].macro);

// live signal object for a key (with curated label/weight), or null
function sig(sym, key) {
  const g = STOCKS[sym].signals.find((s) => s.key === key);
  const lv = LIVE.stocks[sym] && LIVE.stocks[sym].signals[key];
  return (g && lv && lv.value) ? { ...g, ...lv } : null;
}
function liveSignals(sym) {
  const ls = LIVE.stocks[sym];
  if (!ls) return [];
  return STOCKS[sym].signals
    .filter((g) => ls.signals[g.key] && ls.signals[g.key].value)
    .map((g) => ({ ...g, ...ls.signals[g.key] }));
}
function verdict(sym) {
  const sigs = liveSignals(sym);
  let score = 0, total = 0;
  for (const g of sigs) { if (!g.weight) continue; total += g.weight; if (g.stance === "bull") score += g.weight; else if (g.stance === "bear") score -= g.weight; }
  const pct = total ? Math.round((score / total) * 100) : 0;
  if (!sigs.length) return { pct: 0, label: "NO DATA" };
  if (isMacro(sym)) {
    if (pct >= 15) return { pct, label: pct >= 45 ? "STRONG RISK-ON" : "RISK-ON" };
    if (pct <= -15) return { pct, label: pct <= -45 ? "STRONG RISK-OFF" : "RISK-OFF" };
    return { pct, label: "MIXED" };
  }
  if (pct >= 45) return { pct, label: "STRONG BULL" };
  if (pct >= 15) return { pct, label: "BULLISH" };
  if (pct > -15) return { pct, label: "CONTESTED" };
  if (pct > -45) return { pct, label: "BEARISH" };
  return { pct, label: "STRONG BEAR" };
}
function daysUntil(d) { const t = Date.parse(d + "T00:00:00Z"); return Number.isFinite(t) ? Math.round((t - Date.now()) / 864e5) : null; }
const fmtMoney = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const UP = (s) => (s || "").toUpperCase();

// What changed for a signal since the previous run: a stance flip or a >=10% move.
function change(g) {
  if (g.stanceFrom && g.stanceFrom !== g.stance) return { kind: "flip", text: `${UP(g.stanceFrom)}→${UP(g.stance)}` };
  if (Array.isArray(g.hist) && g.hist.length >= 2) {
    const a = g.hist[g.hist.length - 2], b = g.hist[g.hist.length - 1];
    if (Number.isFinite(a) && Number.isFinite(b) && a !== 0) {
      const p = ((b - a) / Math.abs(a)) * 100;
      if (Math.abs(p) >= 10) return { kind: "move", text: `${p >= 0 ? "+" : ""}${p.toFixed(0)}% vs prev`, dir: p >= 0 ? "up" : "down" };
    }
  }
  return null;
}
const changesFor = (sym) => liveSignals(sym).map((g) => ({ g, c: change(g) })).filter((x) => x.c);
// New headlines: those flagged isNew; if the flag is absent (older data) show the latest one.
function freshNews(st, max = 2) {
  const news = Array.isArray(st.news) ? st.news : [];
  const hasFlag = news.some((n) => "isNew" in n);
  return (hasFlag ? news.filter((n) => n.isNew) : news.slice(0, 1)).slice(0, max);
}

/* ---------- Compose (change-only) ---------- */
function build() {
  const title = SESSION === "close" ? "CLOSING WRAP" : "MORNING BRIEF";
  const date = new Date().toISOString().slice(0, 10);
  const time = (LIVE.generatedAt || "").slice(11, 16);
  const L = [];
  L.push(`🟩 <b>MATRIX — ${title}</b>`);
  L.push(`<i>${date} · feed ${esc(time)} UTC · only what changed</i>`);

  // ---- What's new (flips across everything) ----
  const macroCh = LIVE.stocks.MACRO ? changesFor("MACRO") : [];
  const stockCh = {}; for (const s of STOCK_ORDER) stockCh[s] = LIVE.stocks[s] ? changesFor(s) : [];
  const flips = [
    ...STOCK_ORDER.flatMap((s) => stockCh[s].filter((x) => x.c.kind === "flip").map((x) => `${s} · ${x.g.label} ${x.c.text}`)),
    ...macroCh.filter((x) => x.c.kind === "flip").map((x) => `MACRO · ${x.g.label} ${x.c.text}`),
  ];
  L.push("");
  L.push("<b>━━━━ ⚡ WHAT'S NEW ━━━━</b>");
  if (flips.length) flips.forEach((f) => L.push(`⚡ ${esc(f)}`));
  else L.push("<i>No stance/regime changes since last brief.</i>");

  // ---- Macro ----
  if (LIVE.stocks.MACRO) {
    const mv = verdict("MACRO");
    const dot = mv.label.includes("OFF") ? "🔴" : mv.label.includes("ON") ? "🟢" : "🟡";
    L.push("");
    L.push(`<b>━━━━ 🌍 MACRO ━━━━</b>`);
    L.push(`${dot} <b>Regime: ${esc(mv.label)}</b>`);
    macroCh.forEach(({ g, c }) =>
      L.push(`${c.kind === "flip" ? "⚡" : (c.dir === "up" ? "🔼" : "🔽")} ${esc(g.label)}: <b>${esc(g.value)}</b> (${esc(c.text)})`));
    freshNews(LIVE.stocks.MACRO).forEach((n) => L.push(`📰 <a href="${esc(n.url)}">${esc(n.title)}</a>`));
    if (!macroCh.length && !freshNews(LIVE.stocks.MACRO).length) L.push("<i>No macro changes.</i>");
  }

  // ---- Stocks: compact status + only changes + new headlines + earnings ----
  L.push("");
  L.push("<b>━━━━ 📈 STOCKS ━━━━</b>");
  for (const sym of STOCK_ORDER) {
    const st = LIVE.stocks[sym];
    if (!st) continue;
    const v = verdict(sym);
    const dot = v.label.includes("BULL") ? "🟢" : v.label.includes("BEAR") ? "🔴" : "🟡";
    const px = Number.isFinite(st.price) ? fmtMoney(st.price) : "";
    const cp = Number.isFinite(st.changePct) ? `${st.changePct >= 0 ? "▲" : "▼"}${Math.abs(st.changePct).toFixed(2)}%` : "";
    L.push("");
    L.push(`${dot} <b>${sym}</b> ${px} ${cp} · ${esc(v.label)}`);
    if (st.earnings) {
      const d = daysUntil(st.earnings);
      L.push(`📅 Earnings: <b>${esc(st.earnings)}</b>${d != null ? ` (${d < 0 ? "reported" : "in " + d + "d"})` : ""}`);
    }
    stockCh[sym].forEach(({ g, c }) =>
      L.push(`${c.kind === "flip" ? "⚡" : (c.dir === "up" ? "🔼" : "🔽")} ${esc(g.label)}: <b>${esc(g.value)}</b> (${esc(c.text)})`));
    freshNews(st).forEach((n) => L.push(`📰 <a href="${esc(n.url)}">${esc(n.title)}</a>`));
  }

  L.push("");
  L.push(`<a href="${esc(URL)}">Open terminal ▸</a> · ${esc(LIVE.model || "")}`);
  return L.join("\n");
}

/* ---------- Send (split to satisfy the 4096-char limit) ---------- */
function chunk(text, max = 3800) {
  const out = []; let cur = "";
  for (const line of text.split("\n")) {
    if ((cur + "\n" + line).length > max) { if (cur) out.push(cur); cur = line; }
    else cur = cur ? cur + "\n" + line : line;
  }
  if (cur) out.push(cur);
  return out;
}
async function send(text) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
}

/* ---------- Main ---------- */
(async () => {
  if (!LIVE || !LIVE.stocks) { console.log("No live data — skipping brief."); return; }
  const msg = build();
  if (!TOKEN || !CHAT) {
    console.log("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — preview only:\n");
    console.log(msg.replace(/<[^>]+>/g, "")); // strip tags for readable preview
    return;
  }
  try {
    for (const part of chunk(msg)) await send(part);
    console.log(`Sent ${SESSION} brief to Telegram.`);
  } catch (e) {
    console.error("Telegram send failed:", e.message);
    process.exit(1);
  }
})();

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
const flips = (sym) => liveSignals(sym).filter((g) => g.stanceFrom && g.stanceFrom !== g.stance);
function daysUntil(d) { const t = Date.parse(d + "T00:00:00Z"); return Number.isFinite(t) ? Math.round((t - Date.now()) / 864e5) : null; }

/* ---------- Compose ---------- */
function build() {
  const title = SESSION === "close" ? "CLOSING WRAP" : "MORNING BRIEF";
  const date = new Date().toISOString().slice(0, 10);
  const L = [];
  L.push(`🟩 <b>MATRIX // ${title}</b> · ${date}`);

  // Macro block
  if (LIVE.stocks.MACRO) {
    const mv = verdict("MACRO");
    const dot = mv.label.includes("OFF") ? "🔴" : mv.label.includes("ON") ? "🟢" : "🟡";
    L.push(`\n${dot} <b>MACRO: ${esc(mv.label)}</b>`);
    const levels = ["spx", "vix", "us10y", "wti", "brent", "dxy", "hy", "gold"]
      .map((k) => sig("MACRO", k)).filter(Boolean)
      .map((g) => `${esc(g.label)} <b>${esc(g.value)}</b>`);
    if (levels.length) L.push(levels.join(" · "));
    const geo = ["iran", "ukraine", "cuba", "taiwan"].map((k) => sig("MACRO", k)).filter(Boolean)
      .map((g) => `${STANCE[g.stance] || ""} ${esc(g.label)}: ${esc(g.value)}`);
    if (geo.length) L.push("🌍 " + geo.join(" · "));
  }

  // Per-stock detail
  for (const sym of STOCK_ORDER) {
    const st = LIVE.stocks[sym];
    if (!st) continue;
    const v = verdict(sym);
    const dot = v.label.includes("BULL") ? "🟢" : v.label.includes("BEAR") ? "🔴" : "🟡";
    const px = Number.isFinite(st.price) ? `$${st.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "";
    const chg = Number.isFinite(st.changePct) ? `${st.changePct >= 0 ? "▲" : "▼"}${Math.abs(st.changePct).toFixed(2)}%` : "";
    L.push(`\n${dot} <b>${sym}</b> ${px} ${chg} — <b>${esc(v.label)}</b>`);

    const ed = st.earnings ? daysUntil(st.earnings) : null;
    if (ed != null && ed >= 0 && ed <= 10) L.push(`⏱ earnings in ${ed}d (${esc(st.earnings)})`);

    // top 3 weighted signals
    const top = liveSignals(sym).filter((g) => g.weight).sort((a, b) => b.weight - a.weight).slice(0, 3);
    for (const g of top) L.push(`  ${STANCE[g.stance] || ""} ${esc(g.label)}: <b>${esc(g.value)}</b>${g.delta ? " (" + esc(g.delta) + ")" : ""}`);

    const fl = flips(sym);
    for (const g of fl) L.push(`  ⚡ <b>${esc(g.label)}</b> flipped ${esc(g.stanceFrom)}→${esc(g.stance)}`);

    if (Array.isArray(st.news) && st.news[0]) L.push(`  📰 <a href="${esc(st.news[0].url)}">${esc(st.news[0].title)}</a>`);
  }

  // Aggregate flips
  const allFlips = STOCK_ORDER.flatMap((s) => flips(s).map((g) => `${s} ${g.label} ${g.stanceFrom}→${g.stance}`));
  if (allFlips.length) L.push(`\n⚠ <b>Flips today:</b> ${esc(allFlips.join(" · "))}`);

  L.push(`\n<a href="${esc(URL)}">Open terminal</a> · feed ${esc((LIVE.generatedAt || "").slice(0, 16).replace("T", " "))} UTC · ${esc(LIVE.model || "")}`);
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

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

const { STOCKS, STOCK_ORDER } = loadCurated();
const LIVE = loadLive();

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const STANCE = { bull: "🟢", bear: "🔴", neutral: "🟡" };
// Per-headline bull/bear rating (strong bear → strong bull).
const NEWS_TAG = {
  strong_bull: "🟢🟢 STRONG BULL",
  bull: "🟢 BULL",
  neutral: "⚪ NEUTRAL",
  bear: "🔴 BEAR",
  strong_bear: "🔴🔴 STRONG BEAR",
};
// One formatted headline line, prefixed with its bull/bear rating when present.
function newsLine(n) {
  const tag = NEWS_TAG[n.stance];
  return `📰 ${tag ? `<b>[${tag}]</b> ` : ""}<a href="${esc(n.url)}">${esc(n.title)}</a>`;
}
function liveSignals(sym) {
  const ls = LIVE.stocks[sym];
  if (!ls || !ls.signals) return [];
  return STOCKS[sym].signals
    .filter((g) => ls.signals[g.key] && ls.signals[g.key].value)
    .map((g) => ({ ...g, ...ls.signals[g.key] }));
}
function verdict(sym) {
  const sigs = liveSignals(sym);
  if (!sigs.length) return { pct: 0, label: "" };  // news-only run carries no signals
  let score = 0, total = 0;
  for (const g of sigs) { if (!g.weight) continue; total += g.weight; if (g.stance === "bull") score += g.weight; else if (g.stance === "bear") score -= g.weight; }
  const pct = total ? Math.round((score / total) * 100) : 0;
  if (pct >= 45) return { pct, label: "STRONG BULL" };
  if (pct >= 15) return { pct, label: "BULLISH" };
  if (pct > -15) return { pct, label: "CONTESTED" };
  if (pct > -45) return { pct, label: "BEARISH" };
  return { pct, label: "STRONG BEAR" };
}
function daysUntil(d) { const t = Date.parse(d + "T00:00:00Z"); return Number.isFinite(t) ? Math.round((t - Date.now()) / 864e5) : null; }
const fmtMoney = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const topNews = (st, max = 1) => (Array.isArray(st.news) ? st.news : []).slice(0, max);

/* ---------- Compose (price + latest news, per stock) ---------- */
function build() {
  const title = SESSION === "close" ? "CLOSING WRAP" : "MORNING BRIEF";
  const date = new Date().toISOString().slice(0, 10);
  const time = (LIVE.generatedAt || "").slice(11, 16);
  const L = [];
  L.push(`🟩 <b>MATRIX — ${title}</b>`);
  L.push(`<i>${date} · feed ${esc(time)} UTC</i>`);

  L.push("");
  L.push("<b>━━━━ 📈 STOCKS ━━━━</b>");
  for (const sym of STOCK_ORDER) {
    const st = LIVE.stocks[sym];
    if (!st) continue;
    const v = verdict(sym);
    const dot = v.label.includes("BULL") ? "🟢" : v.label.includes("BEAR") ? "🔴" : "🟡";
    const px = Number.isFinite(st.price) ? fmtMoney(st.price) : "";
    const cp = Number.isFinite(st.changePct) ? `${st.changePct >= 0 ? "▲" : "▼"}${Math.abs(st.changePct).toFixed(2)}%` : "";
    const verd = v.label ? ` · ${esc(v.label)}` : "";
    L.push("");
    L.push(`${dot} <b>${sym}</b> ${px} ${cp}${verd}`.replace(/\s+/g, " ").trim());
    if (st.earnings) {
      const d = daysUntil(st.earnings);
      L.push(`📅 Earnings: <b>${esc(st.earnings)}</b>${d != null ? ` (${d < 0 ? "reported" : "in " + d + "d"})` : ""}`);
    }
    topNews(st).forEach((n) => L.push(newsLine(n)));
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

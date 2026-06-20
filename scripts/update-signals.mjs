/* =============================================================================
 *  MATRIX TERMINAL  ·  SELF-UPDATING SIGNAL RESEARCHER
 *  -----------------------------------------------------------------------------
 *  Runs on a schedule (GitHub Actions, once a day ~1h before the US open). Uses OpenAI (Responses API
 *  with the web_search tool) to research current values for each thesis signal
 *  defined in js/data.js, then writes js/live-data.js (loaded by the terminal)
 *  and data/live.json (a human-readable record).
 *
 *  The curated model in js/data.js is the single source of truth for WHICH
 *  signals exist; this script researches their VALUES one ticker per call.
 *  Anything the model can't verify is omitted (never faked); the UI shows only
 *  the signals that came back with a real value.
 *
 *  Two modes (SIGNAL_MODE env):
 *    full  (default) — research all signals + price + news; updates the site.
 *    news            — research only latest price + headlines (cheap daily brief).
 *
 *  Usage:
 *    node scripts/update-signals.mjs            # live full: needs OPENAI_API_KEY
 *    SIGNAL_MODE=news node scripts/update-signals.mjs
 *    node scripts/update-signals.mjs --dry-run  # offline: synthesizes mock data
 * ===========================================================================*/

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// js/data.js is a browser global script (also CJS-export guarded). Under
// "type": "module" Node would treat it as ESM and skip that guard, so load it
// by evaluating the source with a module shim — works in any module mode.
function loadCuratedModel() {
  const code = readFileSync(resolve(ROOT, "js/data.js"), "utf8");
  const shim = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function("module", "exports", code)(shim, shim.exports);
  return shim.exports;
}
const curated = loadCuratedModel();
const { STOCKS } = curated;
const STOCK_ORDER = curated.STOCK_ORDER || [];

const DRY_RUN = process.argv.includes("--dry-run");
// full = all signals + price + news (updates the site); news = price + news only.
const MODE = (process.env.SIGNAL_MODE || "full").toLowerCase() === "news" ? "news" : "full";
// Web-search-capable models, tried in order, each with its correct tool type
// (newer models use "web_search"; gpt-4o uses the legacy "web_search_preview").
// Pin one with SIGNAL_MODEL (tool defaults to web_search; override SIGNAL_SEARCH_TOOL).
const MODEL_CANDIDATES = [
  { model: "gpt-5.5", tool: "web_search" },
  { model: "gpt-5.4-mini", tool: "web_search" },
  { model: "gpt-4.1", tool: "web_search" },
  { model: "gpt-4.1-mini", tool: "web_search" },
  { model: "gpt-4o", tool: "web_search_preview" },
];
let usedModel = process.env.SIGNAL_MODEL || MODEL_CANDIDATES[0].model;

const TRENDS = new Set(["up", "down", "flat"]);
const STANCES = new Set(["bull", "bear", "neutral"]);
// Per-headline bull/bear rating on a 5-point scale (shown in the Telegram brief).
const NEWS_STANCES = new Set(["strong_bull", "bull", "neutral", "bear", "strong_bear"]);

/* ---------- Build the research spec from the curated model ---------- */
// Compact spec: keys/labels/what-each-measures only. We deliberately omit the
// placeholder currentValue from js/data.js — sending it wastes tokens and would
// anchor the model to a stale number we want it to re-source from scratch.
function buildSpec(sym) {
  const s = STOCKS[sym];
  return {
    name: s.name,
    sector: s.sector,
    benchmark: s.benchmark,
    signals: s.signals.map((g) => ({ key: g.key, label: g.label, measures: g.note })),
  };
}

/* ---------- Prompt ---------- */
// One ticker per call (kept small to stay under the per-minute token limit).
// mode "full" researches every signal + price + news; mode "news" researches
// only the latest price + headlines (the cheap daily brief). JSON kept compact.
function buildPrompt(sym, mode) {
  const s = STOCKS[sym];
  const L = [];

  if (mode === "news") {
    L.push(`You are a markets news analyst updating a live terminal. Use the web_search tool to find, for ${s.name} (${sym}), the latest share price, today's % change, the NEXT scheduled earnings date, and THE SINGLE most important recent headline. Verify from recent, credible finance sources — never guess, never reuse a stale number.`);
    L.push(`\nReturn: price (number, no symbol), changePct (signed daily % e.g. -1.8; omit if unknown), earnings (NEXT report date ISO "YYYY-MM-DD"; omit if unknown), asOf (date your figures reflect, ISO), summary (one sentence read on the name today), sources (1-2 URLs), news (ONLY the single most important recent headline, as a one-item array {title,url,source,stance}). stance = how bullish/bearish that news is for the name — one of "strong_bull"|"bull"|"neutral"|"bear"|"strong_bear".`);
    const shape = `{"stocks":{"${sym}":{"price":0,"changePct":0,"earnings":"YYYY-MM-DD","asOf":"YYYY-MM-DD","summary":"...","sources":["https://..."],"news":[{"title":"...","url":"https://...","source":"outlet","stance":"bull"}]}}}`;
    L.push(`\nRespond with ONLY one JSON object, no prose, shape:\n${shape}`);
    return L.join("\n");
  }

  // full mode
  const spec = { [sym]: buildSpec(sym) };
  L.push(`You are a meticulous equity-research analyst updating a live signal terminal. Use the web_search tool to find the most recent real value for EACH signal below. Verify every figure from a recent, credible source (earnings release, 10-Q/10-K/8-K, IR deck, reputable finance/credit news) — never approximate from memory, never reuse a stale number. Assign each signal's stance from its own verified reading, not the overall vibe. OMIT any signal you can't credibly source (never guess).`);
  L.push(`\nTicker and signals to refresh: ${JSON.stringify(spec)}`);
  L.push(`\nPer signal return: value (short string WITH units, <=16 chars, e.g. "$462B","118 bps"), trend ("up"|"down"|"flat" = how the metric moved), stance ("bull"|"bear"|"neutral" = what the reading implies for the BULL thesis on that name), raw (0-100 strength for a gauge), note (one sentence <=130 chars).`);
  L.push(`\nAlso return PER TICKER: price (number, no symbol), changePct (signed daily % e.g. -1.8; omit if unknown), earnings (NEXT report date ISO "YYYY-MM-DD"; omit if unknown), asOf (date your figures reflect, ISO), summary (one sentence read on the name), sources (1-4 URLs), news (ONLY the single most important recent headline, as a one-item array {title,url,source,stance}). stance = how bullish/bearish that news is for the name — one of "strong_bull"|"bull"|"neutral"|"bear"|"strong_bear".`);
  L.push(`\nCoverage: try to source EVERY listed signal. Fundamentals (growth, margins, backlog/RPO, FCF, capex, gross margin, segment/China sales, subs, deposits, volumes, EPS-revision trend, relative strength vs the benchmark ETF) come from filings/IR/finance sites. Market signals not in filings (options IV-rank/skew, insider selling, relative strength) come from recent finance news/commentary — report the latest cited figure with its source.`);
  L.push(`\nSentiment signals (x_sent, reddit_sent, pro_sent) are display-only reads, not fundamentals: value = short read (e.g. "Bullish 70%","Mixed"), stance matching it, note citing what you saw (recent X/Twitter, Reddit, or sell-side ratings/PT changes).`);
  const shape = `{"stocks":{"${sym}":{"price":0,"changePct":0,"earnings":"YYYY-MM-DD","asOf":"YYYY-MM-DD","summary":"...","sources":["https://..."],"news":[{"title":"...","url":"https://...","source":"outlet","stance":"bull"}],"signals":{"signalKey":{"value":"...","trend":"up","stance":"bull","raw":0,"note":"..."}}}}}`;
  L.push(`\nRespond with ONLY one JSON object, no prose, shape:\n${shape}`);
  return L.join("\n");
}

/* ---------- Robust JSON extraction ---------- */
function extractJson(text) {
  // Prefer a fenced ```json block, else the first balanced { ... }.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let candidate = fence ? fence[1] : null;
  if (!candidate) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) candidate = text.slice(start, end + 1);
  }
  if (!candidate) throw new Error("No JSON object found in model output");
  return JSON.parse(candidate);
}

/* ---------- Validate + coerce against the curated schema ---------- */
// Values that mean "not found" — treated as absent so nothing fake/blank shows.
const NA_VALUES = new Set(["n/a", "na", "n.a.", "-", "–", "—", "tbd", "unknown", "none", "null", "?"]);
const isNA = (s) => NA_VALUES.has(String(s).trim().toLowerCase());

// Validate one ticker's payload. In full mode it requires at least one usable
// signal; in news mode it keeps price/news (no signals). Returns null if empty.
function validateStock(sym, incoming, mode = "full") {
  if (!incoming || typeof incoming !== "object") return null;
  const stock = { signals: {} };
  if (mode === "full") {
    const known = new Set(STOCKS[sym].signals.map((g) => g.key));
    for (const [key, v] of Object.entries(incoming.signals || {})) {
      if (!known.has(key) || !v || typeof v !== "object") continue;
      const entry = {};
      if (typeof v.value === "string" && v.value.trim() && !isNA(v.value)) entry.value = v.value.trim().slice(0, 24);
      if (TRENDS.has(v.trend)) entry.trend = v.trend;
      if (STANCES.has(v.stance)) entry.stance = v.stance;
      if (Number.isFinite(v.raw)) entry.raw = Math.max(0, Math.min(100, Math.round(v.raw)));
      if (typeof v.note === "string" && v.note.trim()) entry.note = v.note.trim().slice(0, 160);
      if (entry.value) stock.signals[key] = entry; // a signal is only useful with a real value
    }
  }
  if (Number.isFinite(incoming.price)) stock.price = incoming.price;
  if (Number.isFinite(incoming.changePct)) stock.changePct = incoming.changePct;
  if (typeof incoming.earnings === "string" && /^\d{4}-\d{2}-\d{2}$/.test(incoming.earnings.trim())) {
    stock.earnings = incoming.earnings.trim();  // next earnings date (both modes)
  }
  if (typeof incoming.asOf === "string") stock.asOf = incoming.asOf.slice(0, 10);
  if (typeof incoming.summary === "string") stock.summary = incoming.summary.trim().slice(0, 240);
  if (Array.isArray(incoming.sources)) {
    stock.sources = incoming.sources
      .filter((u) => typeof u === "string" && /^https?:\/\//.test(u))
      .slice(0, 4);
  }
  if (Array.isArray(incoming.news)) {
    stock.news = incoming.news
      .filter((n) => n && typeof n.title === "string" && n.title.trim() &&
                     typeof n.url === "string" && /^https?:\/\//.test(n.url))
      .slice(0, 1)   // only the single most important latest headline
      .map((n) => {
        const item = {
          title: n.title.trim().slice(0, 160),
          url: n.url,
          source: typeof n.source === "string" ? n.source.trim().slice(0, 40) : "",
        };
        if (NEWS_STANCES.has(n.stance)) item.stance = n.stance;
        return item;
      });
  }
  if (mode === "full") return Object.keys(stock.signals).length ? stock : null;
  return (Number.isFinite(stock.price) || (stock.news && stock.news.length)) ? stock : null;
}

// Pull this ticker's object out of whatever shape the model returned.
function pickStock(parsed, sym) {
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.stocks && parsed.stocks[sym]) return parsed.stocks[sym];
  if (parsed[sym]) return parsed[sym];
  // Single-ticker reply without the wrapper.
  if (parsed.signals) return parsed;
  return null;
}

/* ---------- Live research via OpenAI Responses API + web_search ---------- */
const isAccessError = (msg) =>
  /does not have access|model.*not found|unknown model|no such model|\b40[34]\b/i.test(msg);

// Research ONE ticker in a single call. Tries the model candidates (cheap on
// access errors). Returns the validated stock object (or null). Search depth is
// kept low to save cost; news mode uses a smaller output cap.
async function researchOne(client, candidates, sym, mode) {
  const input = buildPrompt(sym, mode);
  // max_output_tokens is a CAP, not a charge — billing is per token actually
  // produced — so leave generous headroom to avoid truncated JSON.
  const maxTokens = mode === "news" ? 4000 : 12000;
  for (const { model, tool } of candidates) {
    try {
      // Reasoning models (gpt-5.x) spend part of the output budget on hidden
      // reasoning; cap effort to "medium" (cheaper/faster, still room for JSON).
      // search_context_size "low" trims how much web content is ingested per
      // search — the biggest cost lever. (Older models reject reasoning param.)
      const req = {
        model,
        tools: [{ type: tool, search_context_size: "low" }],
        max_output_tokens: maxTokens,
        input,
      };
      if (/^gpt-5/.test(model)) req.reasoning = { effort: "medium" };
      const response = await client.responses.create(req);
      const text = (response.output_text || "").trim();
      if (!text) throw new Error("empty output");
      usedModel = model;
      const stock = validateStock(sym, pickStock(extractJson(text), sym), mode);
      console.log(`  ${sym}: ${stock ? (Object.keys(stock.signals).length + " signals") : "no data"} (${model})`);
      return { stock, model, accessError: false };
    } catch (err) {
      const msg = err?.message || String(err);
      if (isAccessError(msg)) { continue; } // try next candidate
      console.warn(`  ${sym} failed on ${model} — ${msg}`);
      return { stock: null, model, accessError: false };
    }
  }
  return { stock: null, model: null, accessError: true };
}

// Run fn over items with bounded concurrency (fast, but gentle on rate limits).
async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

async function research(mode) {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ timeout: 540000, maxRetries: 1 }); // 9 min/call, 1 retry
  const candidates = process.env.SIGNAL_MODEL
    ? [{ model: process.env.SIGNAL_MODEL, tool: process.env.SIGNAL_SEARCH_TOOL || "web_search" }]
    : MODEL_CANDIDATES;

  // ONE web-search call per ticker. Each call is small, so it stays well under
  // the per-minute token limit — combining names into one call blew past TPM.
  // The first ticker resolves the working model; the rest run through a small
  // concurrency pool pinned to it.
  const first = await researchOne(client, candidates, STOCK_ORDER[0], mode);
  if (first.accessError) {
    let available = "(could not list models)";
    try {
      const list = await client.models.list();
      available = list.data.map((m) => m.id).sort().join(", ");
    } catch { /* ignore */ }
    throw new Error(
      `No accessible web-search model (tried: ${candidates.map((c) => c.model).join(", ")}). ` +
      `Grant this key's project access to one, or set SIGNAL_MODEL to a model from: ${available}`
    );
  }
  const pinned = candidates.find((c) => c.model === first.model) || candidates[0];
  console.log(`Researching ${STOCK_ORDER.length} tickers (${mode} mode) with ${pinned.model}, concurrency 3`);

  const out = {};
  if (first.stock) out[STOCK_ORDER[0]] = first.stock;
  const restSyms = STOCK_ORDER.slice(1);
  const rest = await mapPool(restSyms, 3, (sym) => researchOne(client, [pinned], sym, mode));
  rest.forEach((r, i) => { if (r.stock) out[restSyms[i]] = r.stock; });

  if (!Object.keys(out).length) throw new Error("No valid data produced for any entry");
  return out;
}

/* ---------- Offline mock (exercises the whole pipeline) ---------- */
function mock() {
  const out = {};
  for (const sym of STOCK_ORDER) {
    const s = STOCKS[sym];
    const signals = {};
    s.signals.forEach((g) => {
      signals[g.key] = {
        value: g.value,
        trend: g.trend,
        stance: g.stance,
        raw: Math.max(0, Math.min(100, g.raw + (Math.random() < 0.5 ? -3 : 3))),
        note: g.note,
      };
    });
    out[sym] = {
      price: s.price,
      changePct: Math.round((Math.random() - 0.5) * 60) / 10,
      earnings: new Date(Date.now() + (3 + Math.floor(Math.random() * 40)) * 864e5).toISOString().slice(0, 10),
      asOf: new Date().toISOString().slice(0, 10),
      summary: `[MOCK] ${s.tag} — dry-run synthesized snapshot.`,
      sources: ["https://example.com/mock-source"],
      news: [1, 2, 3].map((i) => ({
        title: `[MOCK] ${sym} breaking headline ${i}`,
        url: "https://example.com/" + sym.toLowerCase() + "/" + i,
        source: "Mock Wire",
        stance: ["strong_bull", "bull", "neutral", "bear", "strong_bear"][(i - 1) % 5],
      })),
      signals,
    };
  }
  return out;
}

/* ---------- Write outputs ---------- */
function writeOutputs(stocks) {
  const payload = {
    generatedAt: new Date().toISOString(),
    model: DRY_RUN ? "dry-run-mock" : usedModel,
    mode: DRY_RUN ? "mock" : "live",
    stocks,
  };
  const json = JSON.stringify(payload, null, 2);

  mkdirSync(resolve(ROOT, "data"), { recursive: true });
  writeFileSync(resolve(ROOT, "data/live.json"), json + "\n");

  const js =
    "/* AUTO-GENERATED by scripts/update-signals.mjs — do not edit by hand. */\n" +
    "window.LIVE_SIGNALS = " + json + ";\n";
  writeFileSync(resolve(ROOT, "js/live-data.js"), js);

  const n = Object.keys(stocks).length;
  const sig = Object.values(stocks).reduce((a, s) => a + Object.keys(s.signals || {}).length, 0);
  console.log(`Wrote live data: ${n}/${STOCK_ORDER.length} tickers, ${sig} signals (${payload.mode}).`);
}

/* ---------- Main ---------- */
(async () => {
  try {
    if (DRY_RUN) {
      writeOutputs(mock());
      return;
    }
    if (!process.env.OPENAI_API_KEY) {
      console.error("OPENAI_API_KEY is not set. Use --dry-run to test offline.");
      process.exit(1);
    }
    console.log(`SIGNAL_MODE=${MODE}`);
    const stocks = await research(MODE);
    if (!Object.keys(stocks).length) throw new Error("No valid stock data produced");
    writeOutputs(stocks);
  } catch (err) {
    console.error("Update failed:", err?.message || err);
    process.exit(1);
  }
})();

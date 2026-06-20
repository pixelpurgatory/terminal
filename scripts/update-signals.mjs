/* =============================================================================
 *  MATRIX TERMINAL  ·  SELF-UPDATING SIGNAL RESEARCHER
 *  -----------------------------------------------------------------------------
 *  Runs on a schedule (GitHub Actions, once a day ~1h before the US open). Uses OpenAI (Responses API
 *  with the web_search tool) to research current values for each thesis signal
 *  defined in js/data.js, then writes js/live-data.js (loaded by the terminal)
 *  and data/live.json (a human-readable record).
 *
 *  The curated model in js/data.js is the single source of truth for WHICH
 *  signals exist; this script researches their VALUES one entry per call (each
 *  ticker, then the MACRO regime). Anything the model can't verify is omitted (never faked); the UI shows only
 *  the signals that came back with a real value.
 *
 *  Usage:
 *    node scripts/update-signals.mjs            # live: needs OPENAI_API_KEY
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
// STOCK_ORDER = equities only; NAV_ORDER also includes the MACRO regime entry.
const STOCK_ORDER = curated.STOCK_ORDER || [];
const NAV_ORDER = curated.NAV_ORDER || curated.STOCK_ORDER;

const DRY_RUN = process.argv.includes("--dry-run");
// Web-search-capable models, tried in order, each with its correct tool type
// (newer models use "web_search"; gpt-4o uses the legacy "web_search_preview").
// Pin one with SIGNAL_MODEL (tool defaults to web_search; override SIGNAL_SEARCH_TOOL).
const MODEL_CANDIDATES = [
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
// One entry per call (kept small to stay under the per-minute token limit).
// Stocks and MACRO get different guidance. JSON is sent compact to save tokens.
function buildPrompt(syms) {
  const macro = syms.length === 1 && !!(STOCKS[syms[0]] && STOCKS[syms[0]].macro);
  const specs = {};
  for (const sym of syms) specs[sym] = buildSpec(sym);
  const L = [];
  L.push(`You are a meticulous equity-research analyst updating a live signal terminal. Use the web_search tool to find the most recent real value for EACH signal below. Verify every figure from a recent, credible source (earnings release, 10-Q/10-K/8-K, IR deck, reputable finance/credit news) — never approximate from memory, never reuse a stale number. Assign each signal's stance from its own verified reading, not the overall vibe. OMIT any signal you can't credibly source (never guess).`);
  L.push(`\n${macro ? "Entry" : (syms.length > 1 ? syms.length + " tickers" : "Ticker")} and signals to refresh: ${JSON.stringify(specs)}`);
  L.push(`\nPer signal return: value (short string WITH units, <=16 chars, e.g. "$462B","+34% YoY","118 bps"), delta (period-over-period change, "" if unknown), trend ("up"|"down"|"flat" = how the metric moved), stance ("bull"|"bear"|"neutral" = what the reading implies for the ${macro ? "RISK-ASSET regime ('bull'=risk-on/supportive, 'bear'=risk-off)" : "BULL thesis on that name"}), raw (0-100 strength for a gauge), note (one sentence <=130 chars).`);

  if (macro) {
    L.push(`\nMACRO is a cross-asset & geopolitical regime, not a company — omit price/changePct/earnings. For rates/vol/commodities/credit/FX signals give the latest level. Keep geopolitical signals (iran, ukraine, taiwan) CHEAP: do ONE quick search each for only the single latest BREAKING headline, report a short status as value (e.g. "Escalating","Tense","Ceasefire talks") with that headline's source URL — no deep multi-source research.`);
  } else {
    L.push(`\nAlso return PER TICKER: price (number, no symbol), changePct (signed daily % e.g. -1.8; omit if unknown), earnings (NEXT report date ISO "YYYY-MM-DD"; omit if unknown), asOf (date your figures reflect, ISO), summary (one sentence read on the name), sources (1-4 URLs), news (up to 3 LATEST headlines, most recent first, each {title,url,source,stance}). For each headline, stance = how bullish/bearish that news is for the name — one of "strong_bull"|"bull"|"neutral"|"bear"|"strong_bear".`);
    L.push(`\nCoverage: try to source EVERY listed signal. Fundamentals (growth, margins, backlog/RPO, FCF, capex, gross margin, segment/China sales, subs, deposits, volumes, EPS-revision trend, relative strength vs the benchmark ETF) come from filings/IR/finance sites. Market signals not in filings (options IV-rank/skew, insider selling, relative strength) come from recent finance news/commentary — report the latest cited figure with its source.`);
    L.push(`\nSentiment signals (x_sent, reddit_sent, pro_sent) are display-only reads, not fundamentals: value = short read (e.g. "Bullish 70%","Mixed"), stance matching it, note citing what you saw (recent X/Twitter, Reddit, or sell-side ratings/PT changes).`);
  }

  const shape = macro
    ? `{"stocks":{"${syms[0]}":{"asOf":"YYYY-MM-DD","signals":{"signalKey":{"value":"...","delta":"...","trend":"up","stance":"bull","raw":0,"note":"..."}}}}}`
    : `{"stocks":{"TICKER":{"price":0,"changePct":0,"earnings":"YYYY-MM-DD","asOf":"YYYY-MM-DD","summary":"...","sources":["https://..."],"news":[{"title":"...","url":"https://...","source":"outlet","stance":"bull"}],"signals":{"signalKey":{"value":"...","delta":"...","trend":"up","stance":"bull","raw":0,"note":"..."}}}}}`;
  L.push(`\nRespond with ONLY one JSON object, no prose, with a "stocks" map keyed by ticker symbol${macro ? "" : " (one entry per ticker above)"}, shape:\n${shape}`);
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

// Validate one ticker's payload against its known signal keys. Returns the
// cleaned stock object, or null if it has no usable signals.
function validateStock(sym, incoming) {
  if (!incoming || typeof incoming !== "object") return null;
  const known = new Set(STOCKS[sym].signals.map((g) => g.key));
  const signals = {};
  for (const [key, v] of Object.entries(incoming.signals || {})) {
    if (!known.has(key) || !v || typeof v !== "object") continue;
    const entry = {};
    if (typeof v.value === "string" && v.value.trim() && !isNA(v.value)) entry.value = v.value.trim().slice(0, 24);
    if (typeof v.delta === "string" && !isNA(v.delta)) entry.delta = v.delta.trim().slice(0, 24);
    if (TRENDS.has(v.trend)) entry.trend = v.trend;
    if (STANCES.has(v.stance)) entry.stance = v.stance;
    if (Number.isFinite(v.raw)) entry.raw = Math.max(0, Math.min(100, Math.round(v.raw)));
    if (typeof v.note === "string" && v.note.trim()) entry.note = v.note.trim().slice(0, 160);
    if (entry.value) signals[key] = entry; // a signal is only useful with a real value
  }
  const stock = { signals };
  if (Number.isFinite(incoming.price)) stock.price = incoming.price;
  if (Number.isFinite(incoming.changePct)) stock.changePct = incoming.changePct;
  if (typeof incoming.asOf === "string") stock.asOf = incoming.asOf.slice(0, 10);
  if (typeof incoming.earnings === "string" && /^\d{4}-\d{2}-\d{2}$/.test(incoming.earnings.trim())) {
    stock.earnings = incoming.earnings.trim();
  }
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
      .slice(0, 3)
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
  return Object.keys(signals).length ? stock : null;
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

// Research a GROUP of entries in a SINGLE call (all equities together, or MACRO
// alone). Tries the model candidates (cheap on access errors). Returns the
// validated stock objects keyed by symbol. Search depth is kept low to save cost.
async function researchGroup(client, candidates, syms) {
  const input = buildPrompt(syms);
  // max_output_tokens is a CAP, not a charge — billing is per token actually
  // produced — so scale generous headroom by group size to avoid truncated JSON.
  const maxTokens = Math.min(30000, 8000 + syms.length * 4000);
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
      const parsed = extractJson(text);
      const stocks = {};
      for (const sym of syms) {
        const stock = validateStock(sym, pickStock(parsed, sym));
        if (stock) stocks[sym] = stock;
        console.log(`  ${sym}: ${stock ? Object.keys(stock.signals).length + " signals" : "no data"} (${model})`);
      }
      return { stocks, model, accessError: false };
    } catch (err) {
      const msg = err?.message || String(err);
      if (isAccessError(msg)) { continue; } // try next candidate
      console.warn(`  group [${syms.join(",")}] failed on ${model} — ${msg}`);
      return { stocks: {}, model, accessError: false };
    }
  }
  return { stocks: {}, model: null, accessError: true };
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

async function research() {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ timeout: 540000, maxRetries: 1 }); // 9 min/call, 1 retry
  const candidates = process.env.SIGNAL_MODEL
    ? [{ model: process.env.SIGNAL_MODEL, tool: process.env.SIGNAL_SEARCH_TOOL || "web_search" }]
    : MODEL_CANDIDATES;

  // ONE web-search call per entry (4 equities + MACRO = 5 calls). Each call is
  // small, so it stays well under the per-minute token limit — combining names
  // into one call blew past TPM. The first entry resolves the working model;
  // the rest run through a small concurrency pool pinned to it.
  const first = await researchGroup(client, candidates, [NAV_ORDER[0]]);
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
  console.log(`Researching ${NAV_ORDER.length} entries (one call each) with ${pinned.model}, concurrency 3`);

  const out = { ...first.stocks };
  const rest = await mapPool(NAV_ORDER.slice(1), 3, (sym) => researchGroup(client, [pinned], [sym]));
  for (const r of rest) Object.assign(out, r.stocks);

  if (!Object.keys(out).length) throw new Error("No valid data produced for any entry");
  return out;
}

/* ---------- Offline mock (exercises the whole pipeline) ---------- */
function mock() {
  const out = {};
  for (const sym of NAV_ORDER) {
    const s = STOCKS[sym];
    const signals = {};
    s.signals.forEach((g, gi) => {
      const base = parseNum(g.value) ?? 50;
      const hist = Array.from({ length: 12 }, (_, k) =>
        Math.round((base * (1 + Math.sin((k + gi) * 0.6) * 0.06)) * 100) / 100);
      signals[g.key] = {
        value: g.value,
        delta: g.delta,
        trend: g.trend,
        stance: g.stance,
        raw: Math.max(0, Math.min(100, g.raw + (Math.random() < 0.5 ? -3 : 3))),
        note: g.note,
        hist,
        // Flag the first signal of each name as "changed" to exercise the alerts UI.
        ...(gi === 0 ? { stanceFrom: g.stance === "bull" ? "bear" : "bull", valueFrom: "prev" } : {}),
      };
    });
    const base = s.price || 100;
    out[sym] = {
      price: s.price,
      changePct: Math.round((Math.random() - 0.5) * 60) / 10,
      earnings: new Date(Date.now() + (3 + Math.floor(Math.random() * 40)) * 864e5).toISOString().slice(0, 10),
      priceHist: s.price ? Array.from({ length: 20 }, (_, k) =>
        Math.round(base * (1 + Math.sin(k * 0.5) * 0.04) * 100) / 100) : undefined,
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

/* ---------- History + change detection (run-over-run) ---------- */
const HIST_LEN = 30;

// Pull the first numeric token out of a value string for sparkline history
// ("$638B" -> 638, "+93% YoY" -> 93, "175 bps" -> 175, "SPY $747.31" -> 747.31).
function parseNum(v) {
  if (typeof v !== "string") return null;
  const m = v.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function loadPrevious() {
  try {
    const code = readFileSync(resolve(ROOT, "js/live-data.js"), "utf8");
    const scope = {};
    new Function("window", code)(scope);
    return (scope.LIVE_SIGNALS && scope.LIVE_SIGNALS.stocks) ? scope.LIVE_SIGNALS : null;
  } catch { return null; }
}

// Append this run's values to per-signal history and flag what changed vs the
// previous run (stance flips + value changes), so the UI can chart trends and
// surface a "what changed" strip.
function mergeHistory(stocks) {
  const prev = loadPrevious();
  for (const sym of Object.keys(stocks)) {
    const s = stocks[sym];
    const ps = prev && prev.stocks && prev.stocks[sym];
    if (Number.isFinite(s.price)) {
      const ph = (ps && Array.isArray(ps.priceHist)) ? ps.priceHist.slice() : [];
      ph.push(s.price);
      s.priceHist = ph.slice(-HIST_LEN);
    } else if (ps && Array.isArray(ps.priceHist)) {
      s.priceHist = ps.priceHist.slice(-HIST_LEN);
    }
    for (const key of Object.keys(s.signals)) {
      const sig = s.signals[key];
      const psig = ps && ps.signals && ps.signals[key];
      const num = parseNum(sig.value);
      const hist = (psig && Array.isArray(psig.hist)) ? psig.hist.slice() : [];
      if (num != null) hist.push(num);
      sig.hist = hist.slice(-HIST_LEN);
      if (psig) {
        if (psig.value !== undefined && psig.value !== sig.value) sig.valueFrom = psig.value;
        if (psig.stance && psig.stance !== sig.stance) sig.stanceFrom = psig.stance;
      }
    }
    // Flag headlines not seen in the previous run (for change-only briefs).
    if (Array.isArray(s.news)) {
      const prevUrls = new Set((ps && Array.isArray(ps.news) ? ps.news : []).map((n) => n.url));
      const hadPrev = prevUrls.size > 0;
      for (const n of s.news) n.isNew = hadPrev ? !prevUrls.has(n.url) : true;
    }
  }
}

/* ---------- Write outputs ---------- */
function writeOutputs(stocks) {
  if (!DRY_RUN) mergeHistory(stocks); // accumulate trends + change flags on live runs
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
  const sig = Object.values(stocks).reduce((a, s) => a + Object.keys(s.signals).length, 0);
  console.log(`Wrote live data: ${n}/${NAV_ORDER.length} tickers, ${sig} signals (${payload.mode}).`);
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
    const stocks = await research();
    if (!Object.keys(stocks).length) throw new Error("No valid stock data produced");
    writeOutputs(stocks);
  } catch (err) {
    console.error("Update failed:", err?.message || err);
    process.exit(1);
  }
})();

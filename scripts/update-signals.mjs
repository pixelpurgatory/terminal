/* =============================================================================
 *  MATRIX TERMINAL  ·  SELF-UPDATING SIGNAL RESEARCHER
 *  -----------------------------------------------------------------------------
 *  Runs on a schedule (GitHub Actions, twice a day). Uses OpenAI (Responses API
 *  with the web_search tool) to research current values for each thesis signal
 *  defined in js/data.js, then writes js/live-data.js (loaded by the terminal)
 *  and data/live.json (a human-readable record).
 *
 *  The curated model in js/data.js is the single source of truth for WHICH
 *  signals exist; this script researches their VALUES one ticker at a time.
 *  Anything the model can't verify is omitted (never faked); the UI shows only
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
// NAV_ORDER includes the MACRO regime entry; fall back for older data.js.
const NAV_ORDER = curated.NAV_ORDER || curated.STOCK_ORDER;

const DRY_RUN = process.argv.includes("--dry-run");
// Web-search-capable models, tried in order, each with its correct tool type
// (newer models use "web_search"; gpt-4o uses the legacy "web_search_preview").
// Pin one with SIGNAL_MODEL (tool defaults to web_search; override SIGNAL_SEARCH_TOOL).
const MODEL_CANDIDATES = [
  { model: "gpt-5.5", tool: "web_search" },
  { model: "gpt-4.1", tool: "web_search" },
  { model: "gpt-4.1-mini", tool: "web_search" },
  { model: "gpt-4o", tool: "web_search_preview" },
];
let usedModel = process.env.SIGNAL_MODEL || MODEL_CANDIDATES[0].model;

const TRENDS = new Set(["up", "down", "flat"]);
const STANCES = new Set(["bull", "bear", "neutral"]);

/* ---------- Build the research spec from the curated model ---------- */
function buildSpec(syms = NAV_ORDER) {
  const spec = {};
  for (const sym of syms) {
    const s = STOCKS[sym];
    spec[sym] = {
      name: s.name,
      sector: s.sector,
      benchmark: s.benchmark,
      signals: s.signals.map((g) => ({
        key: g.key,
        label: g.label,
        measures: g.note,
        currentValue: g.value,
      })),
    };
  }
  return spec;
}

/* ---------- Prompt ---------- */
function buildPrompt(spec) {
  return `You are a meticulous equity-research analyst updating a live signal terminal.

For EACH ticker below, use the web_search tool to find the most recent real-world
value for each listed signal (latest earnings, filings, market data, credit
markets, reputable financial news). Prefer the most recent reported figure.

Tickers and the signals to refresh:
${JSON.stringify(spec, null, 2)}

For every signal, return:
  value   - the current reading as a short display string WITH units (e.g. "$462B", "+34% YoY", "42.1%", "118 bps")
  delta   - period-over-period change as a short string (e.g. "+9pp QoQ", "-280bps YoY"); "" if unknown
  trend   - one of: "up" | "down" | "flat"  (the direction the metric itself moved)
  stance  - one of: "bull" | "bear" | "neutral"  (REQUIRED — what the CURRENT verified reading
            implies for the BULL thesis on that name: "bull" supports it, "bear" undercuts it,
            "neutral" if mixed or roughly in line. Judge each signal independently.)
  raw     - integer 0-100 expressing how strong/elevated the reading is (for a gauge fill)
  note    - one concise sentence on what this reading means for the thesis right now

Also return per ticker:
  price     - latest share price as a number (no currency symbol)
  changePct - latest daily price change as a signed number in percent (e.g. -1.8 means -1.8%); omit if unknown
  earnings  - the NEXT scheduled earnings/report date if known, ISO "YYYY-MM-DD"; omit if unknown (omit for MACRO)
  asOf      - the date your figures reflect, ISO "YYYY-MM-DD"
  summary  - one sentence: your current read on the name
  sources  - array of 1-4 source URLs you relied on
  news     - array of up to 3 of the LATEST breaking-news headlines about this name, most
             recent first, each { "title": "...", "url": "https://...", "source": "outlet" }.
             Use reputable, genuinely recent items.

Precision (important):
- Check EACH signal individually. Verify its current figure from a real, recent source
  (earnings release, filing, IR deck, reputable finance site) before reporting it — do not
  approximate from memory or reuse an old number.
- Assign "stance" per signal from its verified reading, not from the overall vibe on the name.

Coverage (important):
- Make a genuine effort to find EVERY signal listed for each ticker via search.
- Most are publicly available: growth rates, margins, backlog/RPO, FCF, capex, gross
  margin, China/segment sales, subscribers, deposits, volumes, share price + daily
  change, earnings-estimate revisions, and relative strength vs a sector ETF can all be
  computed or sourced from earnings releases, 10-Q/10-K/8-K, IR decks, and reputable
  finance sites. Pull these whenever you can.
- For market signals that aren't in filings — single-name CDS spread, options IV-rank/skew,
  notable insider selling, relative strength vs sector — search RECENT NEWS HEADLINES and
  analyst/credit-market commentary (past few weeks) and report the most recently reported
  figure, including the source URL and reflecting its date in asOf. For example, Oracle's
  ~5yr CDS spread is frequently quoted in credit-market news after debt issuance — find the
  latest cited level.
- OMIT a signal ONLY when no credible recent source gives a value. Never guess and never
  carry forward a stale figure — better to omit than to show an outdated or fabricated number.

Sentiment signals (x_sent, reddit_sent, pro_sent):
- These are SENTIMENT reads, not fundamentals. Set value to a short read (e.g. "Bullish 70%",
  "Mixed", "Bearish"), stance to bull/bear/neutral matching that sentiment, and note one line
  citing what you observed (recent X/Twitter posts, Reddit threads, or sell-side ratings/PT
  changes). They are display-only and do not affect the verdict.

The MACRO entry (cross-asset & geopolitical regime, not a company):
- Omit price/changePct. For each signal set value to the latest level or a short status,
  trend to its direction, and stance to the RISK-ASSET implication: "bull" = risk-on /
  supportive (e.g. easing inflation, falling VIX, lower yields, de-escalation), "bear" =
  risk-off (e.g. oil spike, rising yields, widening spreads, escalation).
- For the geopolitical signals (iran, ukraine, cuba, taiwan) summarize the CURRENT situation
  from the LATEST news headlines, give a short status as value (e.g. "Escalating", "Tense",
  "Ceasefire talks"), and include the headline source URL.

Formatting:
- Keep value <= 16 chars and note <= 130 chars. Use the most recent reported figure and
  reflect its date in the ticker-level asOf.
- Respond with ONLY a single JSON object, no prose before or after, in this exact shape:

{
  "stocks": {
    "TICKER": {
      "price": 0,
      "changePct": 0,
      "earnings": "YYYY-MM-DD",
      "asOf": "YYYY-MM-DD",
      "summary": "...",
      "sources": ["https://..."],
      "news": [{ "title": "...", "url": "https://...", "source": "outlet" }],
      "signals": {
        "signalKey": { "value": "...", "delta": "...", "trend": "up", "stance": "bull", "raw": 0, "note": "..." }
      }
    }
  }
}`;
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
      .map((n) => ({
        title: n.title.trim().slice(0, 160),
        url: n.url,
        source: typeof n.source === "string" ? n.source.trim().slice(0, 40) : "",
      }));
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

// Research ONE ticker. Tries the model candidates (cheap on access errors) and
// returns the validated stock object or null. Much smaller/faster than one
// mega-call, so it stays well under the request timeout and is more precise.
async function researchOne(client, candidates, sym) {
  const input = buildPrompt(buildSpec([sym]));
  for (const { model, tool } of candidates) {
    try {
      const response = await client.responses.create({
        model, tools: [{ type: tool }], max_output_tokens: 8000, input,
      });
      const text = (response.output_text || "").trim();
      if (!text) throw new Error("empty output");
      usedModel = model;
      const stock = validateStock(sym, pickStock(extractJson(text), sym));
      console.log(`  ${sym}: ${stock ? Object.keys(stock.signals).length + " signals" : "no data"} (${model})`);
      return { sym, stock, model };
    } catch (err) {
      const msg = err?.message || String(err);
      if (isAccessError(msg)) { continue; } // try next candidate
      console.warn(`  ${sym}: failed on ${model} — ${msg}`);
      return { sym, stock: null, accessError: false };
    }
  }
  return { sym, stock: null, accessError: true };
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

  // Resolve a working model on the first ticker (cheap on access errors), then
  // fetch every entry through a small concurrency pool pinned to that model.
  const first = await researchOne(client, candidates, NAV_ORDER[0]);
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
  console.log(`Researching ${NAV_ORDER.length} entries with ${pinned.model} (${pinned.tool}), concurrency 3`);

  const out = {};
  if (first.stock) out[first.sym] = first.stock;
  const rest = await mapPool(NAV_ORDER.slice(1), 3, (sym) => researchOne(client, [pinned], sym));
  for (const r of rest) if (r && r.stock) out[r.sym] = r.stock;

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

/* =============================================================================
 *  MATRIX TERMINAL  ·  SELF-UPDATING SIGNAL RESEARCHER
 *  -----------------------------------------------------------------------------
 *  Runs on a schedule (GitHub Actions, twice a day). Uses OpenAI (Responses API
 *  with the web_search tool) to research current values for each thesis signal
 *  defined in js/data.js, then writes js/live-data.js (loaded by the terminal)
 *  and data/live.json (a human-readable record).
 *
 *  The curated model in js/data.js is the single source of truth for WHICH
 *  signals exist; this script refreshes their VALUES. Anything the model can't
 *  confidently find is left out and the UI falls back to the curated value.
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
const { STOCKS, STOCK_ORDER } = loadCuratedModel();

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
function buildSpec() {
  const spec = {};
  for (const sym of STOCK_ORDER) {
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
  trend   - one of: "up" | "down" | "flat"  (direction the metric moved)
  stance  - one of: "bull" | "bear" | "neutral"  (what the CURRENT reading implies for the bull thesis on that name)
  raw     - integer 0-100 expressing how strong/elevated the reading is (for a gauge fill)
  note    - one concise sentence on what this reading means for the thesis right now

Also return per ticker:
  price     - latest share price as a number (no currency symbol)
  changePct - latest daily price change as a signed number in percent (e.g. -1.8 means -1.8%); omit if unknown
  asOf      - the date your figures reflect, ISO "YYYY-MM-DD"
  summary  - one sentence: your current read on the name
  sources  - array of 1-4 source URLs you relied on

Coverage (important):
- Make a genuine effort to find EVERY signal listed for each ticker via search.
- Most are publicly available: growth rates, margins, backlog/RPO, FCF, capex, gross
  margin, China/segment sales, subscribers, deposits, volumes, share price + daily
  change, earnings-estimate revisions, and relative strength vs a sector ETF can all be
  computed or sourced from earnings releases, 10-Q/10-K/8-K, IR decks, and reputable
  finance sites. Pull these whenever you can.
- OMIT a signal ONLY when it is genuinely not publicly available or you cannot verify a
  current value. Never guess and never carry forward a stale figure — it is strictly
  better to omit a signal than to show an outdated or fabricated number.
- Signals that are often NOT freely available (omit unless you find a verifiable current
  source): single-name CDS spreads, proprietary options IV-rank/skew, exact insider $ sums.

Formatting:
- Keep value <= 16 chars and note <= 130 chars. Use the most recent reported figure and
  reflect its date in the ticker-level asOf.
- Respond with ONLY a single JSON object, no prose before or after, in this exact shape:

{
  "stocks": {
    "TICKER": {
      "price": 0,
      "changePct": 0,
      "asOf": "YYYY-MM-DD",
      "summary": "...",
      "sources": ["https://..."],
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
function validate(raw) {
  const out = {};
  const stocks = (raw && raw.stocks) || {};
  for (const sym of STOCK_ORDER) {
    const incoming = stocks[sym];
    if (!incoming) continue;
    const known = new Set(STOCKS[sym].signals.map((g) => g.key));
    const signals = {};
    for (const [key, v] of Object.entries(incoming.signals || {})) {
      if (!known.has(key) || !v || typeof v !== "object") continue;
      const entry = {};
      if (typeof v.value === "string" && v.value.trim()) entry.value = v.value.trim().slice(0, 24);
      if (typeof v.delta === "string") entry.delta = v.delta.trim().slice(0, 24);
      if (TRENDS.has(v.trend)) entry.trend = v.trend;
      if (STANCES.has(v.stance)) entry.stance = v.stance;
      if (Number.isFinite(v.raw)) entry.raw = Math.max(0, Math.min(100, Math.round(v.raw)));
      if (typeof v.note === "string" && v.note.trim()) entry.note = v.note.trim().slice(0, 160);
      if (entry.value) signals[key] = entry; // a signal is only useful with a value
    }
    const stock = { signals };
    if (Number.isFinite(incoming.price)) stock.price = incoming.price;
    if (Number.isFinite(incoming.changePct)) stock.changePct = incoming.changePct;
    if (typeof incoming.asOf === "string") stock.asOf = incoming.asOf.slice(0, 10);
    if (typeof incoming.summary === "string") stock.summary = incoming.summary.trim().slice(0, 240);
    if (Array.isArray(incoming.sources)) {
      stock.sources = incoming.sources
        .filter((u) => typeof u === "string" && /^https?:\/\//.test(u))
        .slice(0, 4);
    }
    if (Object.keys(signals).length) out[sym] = stock;
  }
  return out;
}

/* ---------- Live research via OpenAI Responses API + web_search ---------- */
const isAccessError = (msg) =>
  /does not have access|model.*not found|unknown model|no such model|\b40[34]\b/i.test(msg);

async function research() {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ timeout: 600000 }); // 10 min — web search loops are slow
  const input = buildPrompt(buildSpec());
  const candidates = process.env.SIGNAL_MODEL
    ? [{ model: process.env.SIGNAL_MODEL, tool: process.env.SIGNAL_SEARCH_TOOL || "web_search" }]
    : MODEL_CANDIDATES;

  for (const { model, tool } of candidates) {
    try {
      const response = await client.responses.create({
        model,
        tools: [{ type: tool }],
        max_output_tokens: 16000,
        input,
      });
      const text = (response.output_text || "").trim();
      if (!text) throw new Error("model returned empty output");
      usedModel = model;
      console.log(`Researched with model: ${model} (${tool})`);
      return validate(extractJson(text));
    } catch (err) {
      const msg = err?.message || String(err);
      if (isAccessError(msg)) {
        console.warn(`Model "${model}" not accessible — ${msg}`);
        continue; // try the next candidate
      }
      throw err; // real failure (network, parse, etc.)
    }
  }

  // Nothing worked: surface which models this key CAN use so SIGNAL_MODEL can be set.
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

/* ---------- Offline mock (exercises the whole pipeline) ---------- */
function mock() {
  const out = {};
  for (const sym of STOCK_ORDER) {
    const s = STOCKS[sym];
    const signals = {};
    for (const g of s.signals) {
      // Reuse curated readings with a tiny nudge to raw so output visibly differs.
      signals[g.key] = {
        value: g.value,
        delta: g.delta,
        trend: g.trend,
        stance: g.stance,
        raw: Math.max(0, Math.min(100, g.raw + (Math.random() < 0.5 ? -3 : 3))),
        note: g.note,
      };
    }
    out[sym] = {
      price: s.price,
      changePct: Math.round((Math.random() - 0.5) * 60) / 10,
      asOf: new Date().toISOString().slice(0, 10),
      summary: `[MOCK] ${s.tag} — dry-run synthesized snapshot.`,
      sources: ["https://example.com/mock-source"],
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
  const sig = Object.values(stocks).reduce((a, s) => a + Object.keys(s.signals).length, 0);
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
    const stocks = await research();
    if (!Object.keys(stocks).length) throw new Error("No valid stock data produced");
    writeOutputs(stocks);
  } catch (err) {
    console.error("Update failed:", err?.message || err);
    process.exit(1);
  }
})();

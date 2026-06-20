/* =============================================================================
 *  MATRIX TERMINAL  ·  CURATED SIGNAL MODEL
 *  -----------------------------------------------------------------------------
 *  These are hand-curated, thesis-relevant signals calibrated to each name's
 *  2025-2026 narrative. Prices and intraday ticks are SIMULATED (no live feed);
 *  the structural signals below are representative reference values, not a quote.
 *
 *  Each signal:
 *    key      machine id
 *    label    display name
 *    group    section grouping in the UI
 *    value    current reading (string, already formatted with unit)
 *    raw      numeric value used for the gauge fill (0..100 normalized meaning)
 *    delta    period-over-period change (string, signed)
 *    trend    'up' | 'down' | 'flat'  (direction of the metric)
 *    stance   'bull' | 'bear' | 'neutral'  (what it means for the THESIS)
 *    weight   1..3  importance to the thesis (drives verdict + sort)
 *    note     one-line "why this can change the thesis"
 *    spark    short history array for the mini-chart
 * ===========================================================================*/

const SPARK = (a, b, n = 24, noise = 0.18) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const base = a + (b - a) * t;
    const wob = (Math.sin(i * 1.7) + Math.sin(i * 0.6)) * (Math.abs(b - a) || 1) * noise * 0.5;
    out.push(base + wob);
  }
  return out;
};

const STOCKS = {
  ORCL: {
    name: "Oracle Corp.",
    sector: "Cloud Infrastructure",
    benchmark: "XLK",
    price: 178.40,
    vol: 0.028,            // simulated intraday volatility
    tag: "THE BACKLOG TRADE",
    thesis:
      "Oracle's entire re-rating rests on converting a historic AI/cloud backlog " +
      "into actual OCI revenue and cash — while financing the buildout with a wall " +
      "of debt. Watch conversion and capex, not headline bookings.",
    signals: [
      { key: "rpo", label: "RPO / Backlog", group: "Demand", value: "$462B", raw: 95,
        delta: "+359% YoY", trend: "up", stance: "bull", weight: 3,
        note: "Megadeals (OpenAI et al.) ballooned RPO; the bull case is real only if it converts.",
        spark: SPARK(99, 462, 24, 0.05) },
      { key: "rpoconv", label: "RPO → Revenue Conversion", group: "Demand", value: "8.4%/qtr", raw: 34,
        delta: "-1.6pp QoQ", trend: "down", stance: "bear", weight: 3,
        note: "Conversion rate slipping as backlog outruns delivery — the core bear pushback.",
        spark: SPARK(12.5, 8.4, 24, 0.12) },
      { key: "oci", label: "OCI Growth", group: "Demand", value: "+64% YoY", raw: 82,
        delta: "+9pp QoQ", trend: "up", stance: "bull", weight: 3,
        note: "Infrastructure cloud accelerating; this is the engine the thesis needs.",
        spark: SPARK(45, 64, 24, 0.1) },
      { key: "airunrate", label: "AI Revenue Run-Rate", group: "Demand", value: "$5.2B", raw: 70,
        delta: "+118% YoY", trend: "up", stance: "bull", weight: 2,
        note: "GPU/training revenue scaling fast but off a small base vs. the backlog promised.",
        spark: SPARK(1.4, 5.2, 24, 0.1) },
      { key: "capex", label: "Capex / Revenue", group: "Cash & Credit", value: "47%", raw: 88,
        delta: "+19pp YoY", trend: "up", stance: "bear", weight: 3,
        note: "Capex intensity at extreme levels — front-loads risk before revenue lands.",
        spark: SPARK(21, 47, 24, 0.08) },
      { key: "fcf", label: "FCF Margin", group: "Cash & Credit", value: "-6%", raw: 22,
        delta: "-28pp YoY", trend: "down", stance: "bear", weight: 3,
        note: "Free cash flow flipped negative under capex — the single biggest thesis crack.",
        spark: SPARK(22, -6, 24, 0.12) },
      { key: "debt", label: "Debt Issuance (TTM)", group: "Cash & Credit", value: "$38B", raw: 90,
        delta: "+$18B bond deal", trend: "up", stance: "bear", weight: 2,
        note: "Record issuance to fund datacenters; leverage now a ratings-agency watch item.",
        spark: SPARK(15, 38, 24, 0.07) },
      { key: "bond35", label: "ORCL 6.50% 2035 Bond", group: "Cash & Credit", value: "94.1 / 7.28%", raw: 38,
        delta: "+34bps spread", trend: "down", stance: "bear", weight: 2,
        note: "Long bond cheapening + spread widening = credit market pricing buildout risk.",
        spark: SPARK(101, 94.1, 24, 0.05) },
      { key: "power", label: "Contracted DC Power", group: "Capacity", value: "4.6 GW", raw: 76,
        delta: "+1.9 GW QoQ", trend: "up", stance: "bull", weight: 2,
        note: "Power is the real constraint on cloud; secured GW de-risks the backlog.",
        spark: SPARK(1.8, 4.6, 24, 0.08) },
      { key: "rs", label: "Rel. Strength vs XLK", group: "Market", value: "+11.4%", raw: 71,
        delta: "30d", trend: "up", stance: "bull", weight: 1,
        note: "Outperforming the tech sector — momentum still with the bulls.",
        spark: SPARK(-3, 11.4, 24, 0.2) },
      { key: "iv", label: "IV Rank / Skew", group: "Market", value: "IVR 78 · skew +",
        raw: 78, delta: "puts bid", trend: "up", stance: "bear", weight: 1,
        note: "Elevated IV with put skew — options market hedging downside into prints.",
        spark: SPARK(40, 78, 24, 0.15) },
      { key: "insider", label: "Insider Selling (90d)", group: "Market", value: "$1.1B", raw: 64,
        delta: "Ellison trusts", trend: "up", stance: "bear", weight: 1,
        note: "Heavy insider distribution into strength worth flagging, not panic.",
        spark: SPARK(0.2, 1.1, 24, 0.18) },
      { key: "rev", label: "EPS Revision Trend", group: "Market", value: "+4.2%", raw: 68,
        delta: "60d", trend: "up", stance: "bull", weight: 2,
        note: "Sell-side nudging estimates up — analysts still buying the conversion story.",
        spark: SPARK(-1, 4.2, 24, 0.18) },
    ],
  },

  MSFT: {
    name: "Microsoft Corp.",
    sector: "Software / Hyperscale",
    benchmark: "XLK",
    price: 478.90,
    vol: 0.018,
    tag: "AI AT SCALE, AT A COST",
    thesis:
      "Microsoft is the highest-quality AI franchise, but the debate has shifted " +
      "from 'will AI sell' to 'what does the capex do to margins and cash?' " +
      "Azure acceleration must outrun depreciation.",
    signals: [
      { key: "azure", label: "Azure Growth", group: "Demand", value: "+34% YoY", raw: 80,
        delta: "+2pp QoQ", trend: "up", stance: "bull", weight: 3,
        note: "Re-accelerating with ~16pp from AI services — the number the tape trades on.",
        spark: SPARK(29, 34, 24, 0.08) },
      { key: "airunrate", label: "AI Revenue Run-Rate", group: "Demand", value: "$15B", raw: 86,
        delta: "+135% YoY", trend: "up", stance: "bull", weight: 3,
        note: "Copilot + Azure AI annualized run-rate; fastest scaling product in MSFT history.",
        spark: SPARK(5, 15, 24, 0.1) },
      { key: "copilot", label: "Copilot Seat Attach", group: "Demand", value: "41% of E5", raw: 66,
        delta: "+7pp QoQ", trend: "up", stance: "bull", weight: 2,
        note: "Enterprise seat penetration is the proof that AI monetizes, not just runs.",
        spark: SPARK(22, 41, 24, 0.1) },
      { key: "capex", label: "Capex / Revenue", group: "Cash & Credit", value: "33%", raw: 84,
        delta: "+11pp YoY", trend: "up", stance: "bear", weight: 3,
        note: "$80B+ annual capex — the bear case is ROIC, not demand.",
        spark: SPARK(18, 33, 24, 0.08) },
      { key: "fcf", label: "FCF Margin", group: "Cash & Credit", value: "21%", raw: 55,
        delta: "-7pp YoY", trend: "down", stance: "bear", weight: 2,
        note: "Still strong but compressing as capex outpaces operating cash growth.",
        spark: SPARK(30, 21, 24, 0.08) },
      { key: "gm", label: "Cloud Gross Margin", group: "Cash & Credit", value: "68%", raw: 62,
        delta: "-2pp YoY", trend: "down", stance: "neutral", weight: 2,
        note: "AI infrastructure depreciation diluting cloud GM — watch the slope.",
        spark: SPARK(72, 68, 24, 0.05) },
      { key: "power", label: "Contracted DC Power", group: "Capacity", value: "10.5 GW", raw: 90,
        delta: "+2.4 GW QoQ", trend: "up", stance: "bull", weight: 2,
        note: "Power + land secured years out; capacity is the moat against rivals.",
        spark: SPARK(5.5, 10.5, 24, 0.07) },
      { key: "rs", label: "Rel. Strength vs XLK", group: "Market", value: "+2.1%", raw: 56,
        delta: "30d", trend: "up", stance: "neutral", weight: 1,
        note: "Roughly in line with the sector — a market-weight tape, not a leader.",
        spark: SPARK(-2, 2.1, 24, 0.2) },
      { key: "iv", label: "IV Rank / Skew", group: "Market", value: "IVR 44 · flat",
        raw: 44, delta: "calm", trend: "flat", stance: "neutral", weight: 1,
        note: "Low-ish IV — options aren't pricing a big surprise either way.",
        spark: SPARK(50, 44, 24, 0.12) },
      { key: "insider", label: "Insider Selling (90d)", group: "Market", value: "$0.3B", raw: 30,
        delta: "10b5-1 routine", trend: "flat", stance: "neutral", weight: 1,
        note: "Scheduled selling only — no signal in the noise.",
        spark: SPARK(0.4, 0.3, 24, 0.15) },
      { key: "rev", label: "EPS Revision Trend", group: "Market", value: "+2.8%", raw: 64,
        delta: "60d", trend: "up", stance: "bull", weight: 2,
        note: "Estimates drifting higher on Azure + Copilot — quietly constructive.",
        spark: SPARK(0, 2.8, 24, 0.18) },
    ],
  },

  NKE: {
    name: "NIKE, Inc.",
    sector: "Consumer Discretionary",
    benchmark: "XLY",
    price: 64.30,
    vol: 0.026,
    tag: "THE TURNAROUND TEST",
    thesis:
      "Nike is a margin-recovery story: clean up channel inventory, cut markdowns, " +
      "and reignite gross margin — while China stabilizes. Until inventory and China " +
      "inflect, the brand premium is on probation.",
    signals: [
      { key: "gm", label: "Gross Margin", group: "Profitability", value: "42.1%", raw: 44,
        delta: "-280bps YoY", trend: "down", stance: "bear", weight: 3,
        note: "The whole thesis is here — promotions still crushing margin recovery.",
        spark: SPARK(46, 42.1, 24, 0.05) },
      { key: "inv", label: "Inventory (YoY)", group: "Profitability", value: "+6%", raw: 40,
        delta: "still elevated", trend: "up", stance: "bear", weight: 3,
        note: "Inventory must come down before margins can heal — not there yet.",
        spark: SPARK(-2, 6, 24, 0.15) },
      { key: "markdown", label: "Markdown Intensity", group: "Profitability", value: "High", raw: 32,
        delta: "elevated promo", trend: "up", stance: "bear", weight: 2,
        note: "Heavy markdowns to clear product are the direct cause of GM erosion.",
        spark: SPARK(20, 32, 24, 0.18) },
      { key: "china", label: "Greater China Sales", group: "Demand", value: "-9% YoY", raw: 28,
        delta: "-3pp QoQ", trend: "down", stance: "bear", weight: 3,
        note: "China was the growth engine — its decline caps any re-rating.",
        spark: SPARK(2, -9, 24, 0.14) },
      { key: "dtc", label: "DTC / Digital Trend", group: "Demand", value: "-12% YoY", raw: 30,
        delta: "wholesale reset", trend: "down", stance: "bear", weight: 2,
        note: "Pulling back DTC to refill wholesale — a deliberate but painful reset.",
        spark: SPARK(-3, -12, 24, 0.16) },
      { key: "rs", label: "Rel. Strength vs XLY", group: "Market", value: "-14.2%", raw: 22,
        delta: "30d", trend: "down", stance: "bear", weight: 1,
        note: "Lagging the consumer sector badly — no buyers stepping in yet.",
        spark: SPARK(-2, -14.2, 24, 0.2) },
      { key: "iv", label: "IV Rank / Skew", group: "Market", value: "IVR 61 · put skew",
        raw: 61, delta: "puts bid", trend: "up", stance: "bear", weight: 1,
        note: "Downside skew — market positioned for more disappointment.",
        spark: SPARK(40, 61, 24, 0.14) },
      { key: "insider", label: "Insider Activity (90d)", group: "Market", value: "Net buys", raw: 60,
        delta: "small buys", trend: "up", stance: "bull", weight: 1,
        note: "Rare insider buying — a small contrarian tell that value is near.",
        spark: SPARK(20, 60, 24, 0.18) },
      { key: "rev", label: "EPS Revision Trend", group: "Market", value: "-8.9%", raw: 24,
        delta: "60d", trend: "down", stance: "bear", weight: 2,
        note: "Estimates still being cut — no analyst capitulation-to-upside yet.",
        spark: SPARK(0, -8.9, 24, 0.18) },
    ],
  },

  GEV: {
    name: "GE Vernova",
    sector: "Power / Electrification",
    benchmark: "XLI",
    price: 542.70,
    vol: 0.034,
    tag: "POWERING THE AI GRID",
    thesis:
      "GE Vernova is the pure-play on electricity demand from AI datacenters and " +
      "grid buildout. Gas turbine slots and grid backlog are sold years out; the " +
      "thesis is execution and margin ramp, not demand.",
    signals: [
      { key: "backlog", label: "Total Backlog", group: "Demand", value: "$128B", raw: 92,
        delta: "+24% YoY", trend: "up", stance: "bull", weight: 3,
        note: "Record backlog across power + grid gives multi-year revenue visibility.",
        spark: SPARK(85, 128, 24, 0.06) },
      { key: "turbine", label: "Gas Turbine Slots", group: "Demand", value: "Sold to 2028", raw: 95,
        delta: "+ reservations", trend: "up", stance: "bull", weight: 3,
        note: "Capacity sold out years ahead — pricing power and a hard supply moat.",
        spark: SPARK(70, 95, 24, 0.05) },
      { key: "gw", label: "Contracted GW (Power)", group: "Demand", value: "55 GW", raw: 88,
        delta: "+18% YoY", trend: "up", stance: "bull", weight: 2,
        note: "Gigawatts under contract = the order book the AI-power story is built on.",
        spark: SPARK(38, 55, 24, 0.07) },
      { key: "dcpower", label: "Datacenter Power Orders", group: "Demand", value: "$14B", raw: 84,
        delta: "+61% YoY", trend: "up", stance: "bull", weight: 3,
        note: "Direct AI-datacenter demand — the cleanest link to the secular trade.",
        spark: SPARK(5, 14, 24, 0.1) },
      { key: "fcf", label: "FCF Margin", group: "Profitability", value: "9.2%", raw: 70,
        delta: "+5pp YoY", trend: "up", stance: "bull", weight: 2,
        note: "Cash generation inflecting as the backlog converts — the margin proof.",
        spark: SPARK(2, 9.2, 24, 0.1) },
      { key: "grid", label: "Grid Orders Backlog", group: "Demand", value: "$23B", raw: 80,
        delta: "+29% YoY", trend: "up", stance: "bull", weight: 2,
        note: "Transmission equipment shortage = pricing power in the grid segment.",
        spark: SPARK(13, 23, 24, 0.08) },
      { key: "rs", label: "Rel. Strength vs XLI", group: "Market", value: "+19.8%", raw: 85,
        delta: "30d", trend: "up", stance: "bull", weight: 1,
        note: "Leading the industrials sector — institutional accumulation underway.",
        spark: SPARK(3, 19.8, 24, 0.2) },
      { key: "iv", label: "IV Rank / Skew", group: "Market", value: "IVR 69 · call skew",
        raw: 69, delta: "calls bid", trend: "up", stance: "neutral", weight: 1,
        note: "Upside skew — crowded long, sharp on any execution wobble.",
        spark: SPARK(45, 69, 24, 0.15) },
      { key: "insider", label: "Insider Selling (90d)", group: "Market", value: "$180M", raw: 54,
        delta: "post-spin sales", trend: "up", stance: "bear", weight: 1,
        note: "Routine post-spinoff selling — modest signal at these levels.",
        spark: SPARK(40, 180, 24, 0.2) },
      { key: "rev", label: "EPS Revision Trend", group: "Market", value: "+16.3%", raw: 88,
        delta: "60d", trend: "up", stance: "bull", weight: 2,
        note: "Estimates surging as margins beat — the strongest revision trend in the book.",
        spark: SPARK(2, 16.3, 24, 0.18) },
    ],
  },

  MACRO: {
    name: "Macro Regime",
    sector: "Cross-Asset · Geopolitical",
    benchmark: "—",
    macro: true,
    tag: "THE BACKDROP",
    thesis:
      "The cross-asset and geopolitical regime every single-name thesis trades inside. " +
      "Rates, the dollar, oil, credit and volatility set risk appetite; live geopolitical " +
      "flashpoints (Iran, Ukraine, Taiwan) drive the tail risks. Stance is read as " +
      "risk-on (bull) vs risk-off (bear).",
    signals: [
      // --- Rates & Policy ---
      { key: "us10y", label: "US 10Y Yield", group: "Rates & Policy", weight: 3,
        value: "—", delta: "", trend: "flat", stance: "neutral", raw: 50,
        note: "Latest 10-year Treasury yield; a sharp rise tightens conditions (risk-off)." },
      { key: "fed", label: "Fed Policy Stance", group: "Rates & Policy", weight: 2,
        value: "—", delta: "", trend: "flat", stance: "neutral", raw: 50,
        note: "Current Fed stance from the latest FOMC / headlines: cutting (bull) vs hiking (bear)." },
      // --- Equity & Vol ---
      { key: "spx", label: "S&P 500", group: "Equity & Vol", weight: 3,
        value: "—", delta: "", trend: "flat", stance: "neutral", raw: 50,
        note: "Latest S&P 500 level and trend; uptrend = risk-on." },
      { key: "vix", label: "VIX (Volatility)", group: "Equity & Vol", weight: 2,
        value: "—", delta: "", trend: "flat", stance: "neutral", raw: 50,
        note: "Latest VIX; below ~16 is calm (bull), above ~25 is stressed (bear)." },
      // --- Commodities ---
      { key: "wti", label: "WTI Crude Oil", group: "Commodities", weight: 3,
        value: "—", delta: "", trend: "flat", stance: "neutral", raw: 50,
        note: "Latest WTI crude ($/bbl); a spike feeds inflation and geopolitical risk (bearish for risk assets)." },
      // --- Credit & FX ---
      { key: "dxy", label: "US Dollar (DXY)", group: "Credit & FX", weight: 2,
        value: "—", delta: "", trend: "flat", stance: "neutral", raw: 50,
        note: "Latest dollar index; rapid USD strength tightens global conditions (risk-off)." },
      { key: "hy", label: "US HY Credit Spread", group: "Credit & FX", weight: 2,
        value: "—", delta: "", trend: "flat", stance: "neutral", raw: 50,
        note: "Latest US high-yield OAS in bps; widening = risk-off, tightening = risk-on." },
      // --- Geopolitical Risk (latest BREAKING headline only) ---
      { key: "iran", label: "Iran", group: "Geopolitical Risk", weight: 2,
        value: "—", delta: "", trend: "flat", stance: "neutral", raw: 50,
        note: "Current US/Israel–Iran tension from the latest headlines; escalation = risk-off (bear)." },
      { key: "ukraine", label: "Ukraine / Russia", group: "Geopolitical Risk", weight: 2,
        value: "—", delta: "", trend: "flat", stance: "neutral", raw: 50,
        note: "Current Russia–Ukraine war status from the latest headlines; escalation = risk-off (bear)." },
      { key: "taiwan", label: "Taiwan", group: "Geopolitical Risk", weight: 2,
        value: "—", delta: "", trend: "flat", stance: "neutral", raw: 50,
        note: "Current China–Taiwan tension level from the latest headlines; escalation = risk-off (bear)." },
    ],
  },
};

const STOCK_ORDER = ["ORCL", "MSFT", "NKE", "GEV"];
const NAV_ORDER = [...STOCK_ORDER, "MACRO"];

// Social + professional sentiment — shown on each stock but weight 0, so they
// are DISPLAY-ONLY and never move the thesis verdict.
const SENTIMENT_SIGNALS = [
  { key: "x_sent", label: "X / Twitter Sentiment",
    note: "Aggregate retail sentiment on X/Twitter from recent posts (display only — does not affect the verdict)." },
  { key: "reddit_sent", label: "Reddit Sentiment",
    note: "Retail sentiment across Reddit (r/wallstreetbets, r/stocks) from recent posts (display only)." },
  { key: "pro_sent", label: "Analyst / Pro Sentiment",
    note: "Sell-side / professional tilt — ratings and price-target changes from recent notes (display only)." },
];
for (const sym of STOCK_ORDER) {
  for (const t of SENTIMENT_SIGNALS) {
    STOCKS[sym].signals.push({
      key: t.key, label: t.label, group: "Sentiment", weight: 0,
      value: "—", delta: "", trend: "flat", stance: "neutral", raw: 50, note: t.note,
    });
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { STOCKS, STOCK_ORDER, NAV_ORDER };
}

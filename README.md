# MATRIX // STOCKS TERMINAL

A Matrix-styled equity **signal** terminal for a focused 5-name watchlist:
**ORCL · MSFT · HOOD · NKE · GEV**.

Built around what can actually *change the thesis* on each name — not generic
RSI/MACD noise. Every signal is tagged with its **thesis stance** (bull / bear /
contested) and an importance weight, then rolled up into a per-name
**THESIS VERDICT** meter.

![green phosphor CRT terminal]

## What's inside

- **Digital-rain backdrop** (canvas), CRT scanlines + vignette + flicker, glow,
  glitch on the ticker, and a typewriter **boot sequence**.
- **Watchlist rail** — live simulated tape, verdict chips, per-name sparklines.
- **Detail panel** — large quote, thesis summary, verdict meter, and signal
  cards grouped by theme, each with value · delta · sparkline · gauge · a
  one-line "why this moves the thesis."
- **Command console** — type a ticker, or `help`, `list`, `thesis`, `top`,
  `next`, `prev`, `clear`.
- **Keyboard** — `1`–`5` jump to a name, `↑/↓` (or `j/k`) cycle, `/` focuses the
  command line.
- Responsive (desktop → mobile) and honors `prefers-reduced-motion`.

### Signals tracked (by name)

| Name | Thesis-critical signals |
|------|--------------------------|
| **ORCL** | RPO/backlog + conversion, OCI growth, AI run-rate, capex/rev, FCF margin, debt issuance, **2035 bond price/yield**, CDS spread, contracted DC power |
| **MSFT** | Azure growth, AI run-rate, Copilot attach, capex/rev, FCF margin, cloud gross margin, DC power |
| **HOOD** | net deposits, options volume, crypto volume, Gold subs, ARPU |
| **NKE**  | gross margin, inventory, markdown intensity, Greater China sales, DTC trend |
| **GEV**  | total backlog, gas-turbine slots, contracted GW, datacenter power orders, FCF margin, grid backlog |
| *all*    | relative strength vs sector, IV rank/skew, insider selling, EPS revision trend |

## Access it

**Live now (zero setup):**
https://htmlpreview.github.io/?https://raw.githubusercontent.com/pixelpurgatory/terminal/claude/matrix-stocks-terminal-v8u4pp/index.html

**Nicer permanent URL — `https://pixelpurgatory.github.io/terminal/`** — needs one
one-time toggle (the repo's CI token can't enable Pages on its own):

> Repo **Settings → Pages → Build and deployment → Source: _Deploy from a branch_**,
> branch **`claude/matrix-stocks-terminal-v8u4pp`**, folder **`/ (root)`** → Save.

In branch mode GitHub serves the site directly and **rebuilds on every commit** —
so the twice-daily AI data refresh shows up automatically, no extra workflow.

## Run it locally

No build step, no dependencies. Just open it:

```bash
# either open the file directly…
open index.html        # macOS  (xdg-open on Linux)

# …or serve it
python3 -m http.server 8080   # then visit http://localhost:8080
```

## Self-updating AI feed

The terminal can refresh its own signals. A research agent lives in the repo and
runs **twice a day** (GitHub Actions cron): it calls **OpenAI (`gpt-4.1`,
Responses API) with web search** (override via the `SIGNAL_MODEL` env var), looks up the latest real-world value for every
signal defined in `js/data.js`, and commits the result to `js/live-data.js`. The terminal loads
that file and overlays it — the feed chip flips to **`◉ LIVE`** with a timestamp,
and each name gets an **AI READ** summary line with source links. When no live
data is present, it falls back to the curated values (`◉ SIM FEED`).

```
GitHub Actions (cron, 2×/day)
   └─ node scripts/update-signals.mjs        # OpenAI + web_search
        └─ writes js/live-data.js + data/live.json, commits them
             └─ the terminal loads js/live-data.js and overlays the values
```

`js/data.js` stays the single source of truth for *which* signals exist; the
agent only refreshes their *values*, and anything it can't confidently find is
left out (the UI keeps the curated fallback).

### Enabling it

1. Add a repo secret named **`matrix`** holding an **OpenAI API key** (Settings →
   Secrets and variables → Actions). The workflow exposes it to the script as `OPENAI_API_KEY`.
2. For the *scheduled* runs to fire, the workflow must live on the repo's
   **default branch** (GitHub only schedules from there). You can also trigger it
   anytime via **Actions → "Update signals" → Run workflow**.

### Running the researcher locally

```bash
npm install
OPENAI_API_KEY=sk-... npm run update     # real research via OpenAI + web search
npm run update:dry                       # offline: synthesizes a mock feed (◉ DEMO)
```

Type `feed` in the terminal's command line to see the current source, model, and
refresh time.

## Data honesty

Intraday **prices are always a simulated tape** — there is no real-time quote
feed wired in. The **structural signals** are either AI-researched (`◉ LIVE`,
when the agent has run) or hand-curated reference values (`◉ SIM FEED`)
calibrated to each name's 2025–2026 narrative. The `◉ DEMO` chip means the
offline dry-run mock is loaded (a pipeline test, not real research). Everything
renders from `js/data.js` + `js/live-data.js`.

## Beta test

A headless Playwright smoke test drives the real page (boot, switching,
commands, sparkline sizing) and fails on any console/page error:

```bash
npm install && node betatest.cjs   # or: npm test
```

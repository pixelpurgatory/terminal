# MATRIX // STOCKS TERMINAL

A Matrix-styled equity **signal** terminal for a focused 4-name watchlist:
**ORCL · MSFT · NKE · GEV**.

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
- **Keyboard** — `1`–`4` jump to a name, `↑/↓` (or `j/k`) cycle, `/` focuses the
  command line.
- Responsive (desktop → mobile) and honors `prefers-reduced-motion`.

### Signals tracked (by name)

| Name | Thesis-critical signals |
|------|--------------------------|
| **ORCL** | RPO/backlog + conversion, OCI growth, AI run-rate, capex/rev, FCF margin, debt issuance, **2035 bond price/yield**, contracted DC power |
| **MSFT** | Azure growth, AI run-rate, Copilot attach, capex/rev, FCF margin, cloud gross margin, DC power |
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
so a **full update** (which commits `js/live-data.js`) shows up automatically, no
extra workflow. (A news run is Telegram-only and does not commit.)

## Run it locally

No build step, no dependencies. Just open it:

```bash
# either open the file directly…
open index.html        # macOS  (xdg-open on Linux)

# …or serve it
python3 -m http.server 8080   # then visit http://localhost:8080
```

## Self-updating AI feed

The research agent (in `scripts/update-signals.mjs`) calls **OpenAI (Responses API)
with web search** — trying `gpt-5.5` → `gpt-5.4-mini` → `gpt-4.1` → `gpt-4.1-mini`
and using the first your project can access (or pin one with `SIGNAL_MODEL`). It
runs in one of two **modes**:

- **`full`** — researches every signal in `js/data.js` plus price + news, writes
  `js/live-data.js` + `data/live.json`, and **commits them** (updates the site).
  Triggered by the in-terminal **⟳ FULL UPDATE** button (max once / 24h) or
  manually via *Actions → Run workflow*.
- **`news`** — researches only the latest **price + headlines** and sends the
  **Telegram brief**. It does **not** touch the website. Manual only (run via
  *Actions → Run workflow* with mode `news`).

The terminal renders **only real data** — the feed chip shows **`◉ LIVE`** with a
timestamp, each name gets an **AI READ** summary with source links, and missing
data shows a **`◉ NO LIVE DATA`** notice rather than fake values.

> **No automatic schedule.** Updates run only when you trigger them (the button
> or *Run workflow*); nothing runs on its own.

```
⟳ FULL UPDATE button / manual run  → SIGNAL_MODE=full → commit js/live-data.js + data/live.json
                                                          └─ terminal overlays the values
```

### The ⟳ FULL UPDATE button

The site is static, so the button triggers research by calling GitHub's
`workflow_dispatch` API from the browser. On first use it asks for a **GitHub
fine-grained token** (scope: *Actions Read+Write* on this repo), stored **only in
your browser's localStorage** — never in the page or repo. A client-side **24h
cooldown** limits it to one full update per day. Point it at the right repo/branch
by setting `matrix_gh_owner` / `matrix_gh_repo` / `matrix_gh_ref` in localStorage
if the defaults don't match your deployment.

`js/data.js` stays the single source of truth for *which* signals exist; the
agent only refreshes their *values*, and anything it can't confidently find is
left out (the UI keeps the curated fallback).

### Enabling it

1. Add a repo secret named **`matrix`** holding an **OpenAI API key** (Settings →
   Secrets and variables → Actions). The workflow exposes it to the script as `OPENAI_API_KEY`.
2. Trigger it via the in-terminal **⟳ FULL UPDATE** button, or **Actions →
   "Update signals" → Run workflow** (pick mode `full` or `news`). There is no
   automatic schedule.

### Telegram brief (optional)

A **news brief** is DM'd whenever you run the workflow in `news` mode:
per-stock price, daily change, and the latest rated headlines (a verdict line too
when a full update has populated signals). To enable, add two repo secrets:

- `TELEGRAM_BOT_TOKEN` — from **@BotFather** (`/newbot`)
- `TELEGRAM_CHAT_ID` — your numeric id (message **@userinfobot**); **message your
  bot once first** so it's allowed to DM you.

Preview the message locally without sending (no secrets needed):

```bash
node scripts/telegram-brief.mjs            # morning preview
BRIEF_SESSION=close node scripts/telegram-brief.mjs
```

The send step no-ops if the secrets aren't set, so it never breaks the run.

### Running the researcher locally

```bash
npm install
OPENAI_API_KEY=sk-... npm run update     # real research via OpenAI + web search
npm run update:dry                       # offline: synthesizes a mock feed (◉ DEMO)
```

Type `feed` in the terminal's command line to see the current source, model, and
refresh time.

## Data honesty

The terminal displays **only real, AI-researched data** from `js/live-data.js`
(prices, daily change, signal values, summaries, and source links — all from the
research run). There is no simulated price tape, no random ticks, and no
synthetic sparklines. `js/data.js` provides **structure only** (names, sectors,
thesis text, signal labels/groups) — none of its placeholder numbers are shown.
If no live feed is present, the UI shows a `◉ NO LIVE DATA` notice instead of
inventing values. (`◉ DEMO` only appears for a local `--dry-run` mock and is
never committed.)

## Beta test

A headless Playwright smoke test drives the real page (boot, switching,
commands, sparkline sizing) and fails on any console/page error:

```bash
npm install && node betatest.cjs   # or: npm test
```

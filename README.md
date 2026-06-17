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

## Run it

No build step, no dependencies. Just open it:

```bash
# either open the file directly…
open index.html        # macOS  (xdg-open on Linux)

# …or serve it
python3 -m http.server 8080   # then visit http://localhost:8080
```

## Data honesty

There is **no live market feed** here. Intraday prices are a *simulated tape*
(clearly marked `◉ SIM FEED`), and the structural signals are **hand-curated
reference values** calibrated to each name's 2025–2026 narrative — a realistic
demo of the terminal, not investment data. Edit `js/data.js` to wire in real
numbers; the UI renders entirely from that file.

## Beta test

A headless Playwright smoke test drives the real page (boot, switching,
commands, sparkline sizing) and fails on any console/page error:

```bash
node betatest.js
```

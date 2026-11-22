# Strikebook review brief

This is a separate local snapshot prepared on 21 November 2026 for review in Claude Code. It contains the current application source, including the recent changes and new files that are still uncommitted in the development checkout.

The user requested a code review. Return findings and proposed fixes before editing. Prioritize reproducible bugs, data accuracy, security, and Windows startup reliability. Give each finding a severity, file and line reference, evidence, and a concrete suggested fix. State which checks you ran and which results remain unverified.

## Project and entry points

Strikebook is a local stock, ETF, and listed-options research dashboard. Python serves the static JavaScript application and a loopback API. OpenBB supplies provider data, with a fallback through the installed Yahoo Finance library for quotes, daily history, and option chains.

- `server.py` contains the HTTP server, request validation, OpenBB worker, data cache, provider fallbacks, and pattern API.
- `dist/app.mjs` contains application state, requests, fullscreen chart behavior, and pattern picker events.
- `dist/options.mjs` renders options research, charts, and the selectable and collapsible pattern results.
- `dist/ui.mjs` supplies shared components, charts, and chart inspection.
- `dist/analytics.mjs` contains financial calculations and contract normalization.
- `dist/research.mjs` contains company, ETF, and event views.
- `dist/data.mjs` contains API transport, browser preferences, and explicitly labeled sample data.
- `patterns.py` contains the 61-detector catalog, native TA-Lib execution, three built-in detectors, and completed-session filtering.
- `cboe_chain_compat.py` handles an installed Cboe provider contract-parser compatibility issue.
- `yfinance_compat.py` reads the already-installed Yahoo Finance library in a separate provider process.
- `README.md` and `COVERAGE.md` describe usage, methodology, and source coverage.

## Run this review copy on this Windows PC

Open PowerShell in this folder and run the copied launcher.

```powershell
Set-Location -LiteralPath 'C:\Users\yeste\Documents\Codex\Claude-Review\Strikebook'
& '.\Start Strikebook.cmd'
```

The copied launcher requests a free port and opens the address it prints. This differs from the active installation, whose preferred port is 8765. Use the review launcher's printed address for its own test instance.

The launcher points at the relocated `.openbb-runtime` in this folder and retains `--no-cboe-disk-cache`. These are the two review-specific launcher adaptations.

Python and OpenBB remain installed on this PC. The copy includes the generated OpenBB namespace and local TA-Lib dependencies required by the working configuration.

- The server uses `C:\Users\yeste\AppData\Local\Programs\Python\Python313\python.exe`.
- OpenBB CLI and provider helpers use the installed Python 3.12 environment. The CLI is at `C:\Users\yeste\AppData\Local\Programs\Python\Python312\Scripts\openbb.exe`.
- `.strikebook-deps` contains TA-Lib 0.8.3 and NumPy 2.5.4 for Windows CPython 3.13.
- The Python 3.12 environment contains OpenBB core 2.0.1 and yfinance 0.2.65.
- OpenBB uses the existing Windows account's provider configuration.

The native dependencies in this snapshot are specific to Windows and Python 3.13. A different computer or interpreter needs a matching dependency installation.

## Verification commands

Run the existing tests from this directory.

```powershell
python -B -m unittest -v test_patterns
node --test analytics.test.mjs
node --check dist/app.mjs
node --check dist/options.mjs
node --check dist/ui.mjs
```

The working installation passed 12 Python pattern tests and 10 JavaScript analytics tests before this snapshot was created. Native TA-Lib was available for both native parity tests.

For browser verification, search NVDA and a liquid ETF such as SPY or QQQ. Check quote and chain source labels, the history date ranges, selectable detectors, all-match expansion, hiding and showing results, chart fullscreen, and Escape/restore behavior. Verify the visible results after changing the ticker or period while another request is pending.

## Recent changes and review priorities

1. All 61 TA-Lib candlestick detectors can be selected individually. Doji, Hammer, and Engulfing are the default detectors. Bullish and bearish Engulfing share one detector.
2. Pattern detection uses completed daily OHLC bars and additional warm-up history. Inspect native lookback handling, invalid bars, conflicting dates, and the current New York session cutoff.
3. Pattern direction comes from TA-Lib output semantics. Inspect the distinction between directional patterns and candle-color outputs.
4. Selections are saved per browser origin. Requests and caches include the selected detectors. Inspect stale-response handling during rapid changes.
5. Price history, IV term structure, volatility skew, and expiration payoff charts can enter fullscreen. Inspect native fullscreen, modal fallback, chart restoration, focus, rerendering, and pointer coordinates.
6. Pattern matches initially show the six newest results. The user can show all results, return to the preview, or hide the list while keeping chart markers.
7. The server handles browser disconnects through BrokenPipeError, ConnectionResetError, and ConnectionAbortedError around the standard request handler. Other errors remain visible.
8. Cboe and Nasdaq returned HTTP 403 during the last investigation. The local bridge can fall back to the existing yfinance library after the default providers fail. Explicit provider overrides and remote OpenBB configuration take precedence.
9. After a successful fallback, Yahoo is tried first for five minutes before the primary providers are retried. Inspect this behavior alongside caching and refreshes.
10. Yahoo responses identify their source. Historical OHLC uses `auto_adjust=False`. Option IV stays in decimal units. Contract multipliers and possible adjusted contracts need careful review. Available expirations are fetched, and partial chain coverage produces warnings.
11. Quote timestamps, underlying last-trade timestamps, option last-trade timestamps, fetch times, and option quote timestamps have different meanings. Inspect their use in display, expiry metrics, and calculations.
12. A cold launch can take about a minute while a primary OpenBB request times out before Yahoo fallback. Inspect startup, error messages, and provider health separately from the presence of the OpenBB executable.

On 21 November 2026, a browser check of the repaired instance displayed an NVDA quote, 127 daily candles, 4,162 option contracts across 24 expirations, and 20 detections for the default pattern selection. These are historical verification counts and will vary with the requested dates and provider responses.

## Snapshot contents

`COPY_MANIFEST.json` records the copied application and runtime files with SHA-256 hashes. The application source matches the latest local release. The copied launcher and cache ignore rules were adapted for this review directory.

Review the application source listed above. The `.strikebook-deps` and `.openbb-runtime` folders support local execution. The original development and active application directories are separate from this review workspace.

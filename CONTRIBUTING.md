# Contributing to Strikebook

Thanks for helping improve Strikebook. This guide covers how to run it, test a change, and open a pull request.

## Ways to help

- **Report a bug.** Open an issue with the steps to reproduce it, the symbol and tab you used, and what you expected. Include the source line shown under the data (for example "Yahoo Finance · delayed · Nov 20, 4:00 PM EST") and your browser. Never paste API keys, provider credentials or OpenBB configuration files.
- **Fix a bug or add a feature.** For anything larger than a small fix, open an issue first so we can agree on the approach.
- **Improve the docs.** README.md, COVERAGE.md and this guide are all fair game.

## Set up

Strikebook has no build step and no package manager. The browser loads the ES modules in `dist/` directly, and Python serves them.

You need:

- **Node.js 24** for the JavaScript tests.
- **Python 3.10 or newer** (CI uses 3.13) for the server and Python tests.
- **TA-Lib 0.8.3** (optional) for the native pattern tests and the 58 extra detectors: `python -m pip install --only-binary=:all: -r requirements-patterns.txt`
- **OpenBB CLI** (optional) for live data. See the README's setup section.

Start the app:

```powershell
python -B server.py --port 0 --open-browser
```

Without OpenBB, choose **Data connection → Use sample mode**. Sample mode uses six simulated symbols (SPY, QQQ, AAPL, NVDA, MSFT, IWM), which is enough to work on most of the interface.

**Hosting your own copy.** A hosted page can reach the launcher only from the origin the launcher allows. Those origins are set by `$HostedOrigins` in `launcher/start.ps1` and passed to `server.py --cors-origin`. If you publish a fork, for example to your own GitHub Pages, change it to your site's origin (scheme and host only, such as `https://your-name.github.io`). List several origins separated by commas. On Vercel, `vercel.json` publishes `dist/` with no build step. Also update `repoUrl` in `dist/app.mjs`, which the Data connection dialog uses for its download and setup links.

After editing files in `dist/`, hard-refresh the page (Ctrl+Shift+R). The server sends no cache headers, so the browser can keep old modules.

## Project layout

| Path | Contents |
|---|---|
| `server.py` | HTTP server, request validation, OpenBB worker, caching and provider fallbacks |
| `patterns.py` | Candlestick detector catalog, TA-Lib and built-in detectors |
| `yfinance_compat.py`, `cboe_chain_compat.py` | Provider helpers that run in the OpenBB Python environment |
| `dist/analytics.mjs` | Financial calculations: chain normalization, Black–Scholes, payoffs, probability of profit, GEX, max pain, IV surface |
| `dist/options.mjs` | Options views: overview, chain, volatility, activity, Strategy Lab |
| `dist/ui.mjs` | Shared components and SVG charts |
| `dist/candles.mjs` | Lightweight Charts candlestick chart |
| `dist/app.mjs` | App state, data loading and events |
| `dist/research.mjs`, `dist/data.mjs` | Company and fund views; API transport, preferences and sample data |
| `dist/vendor/` | Third-party code, bundled unchanged |
| `Start Strikebook.cmd`, `launcher/start.ps1`, `requirements-live.txt` | Windows launcher: first-run setup into `.venv\`, then starts the server |

## Make a change

- **Keep calculations in `dist/analytics.mjs`** as pure functions with no DOM access, so they can be tested in Node. Views in `options.mjs` format and render the results.
- **Escape everything from providers.** Views build HTML strings, so pass provider text through `esc()` from `ui.mjs`. Links from providers must go through the existing URL checks in `research.mjs`.
- **Treat missing data as missing.** A blank or "—" is better than a guessed zero. Never show synthetic values outside sample mode, and keep each dataset's source and timestamp visible.
- **Use the existing units.** IV is a decimal (0.25 = 25%), time to expiration is calendar days ÷ 365, and theta is per day.
- **Say what a model assumes.** Features such as probability of profit and GEX state their assumptions in the interface. New models should too.
- **No new dependencies without discussion.** If a library is agreed, bundle a pinned release in `dist/vendor/` with its license file, keep a fallback where possible, and add it to the README's Credits.
- **Update the docs** when behavior changes: README.md for users and COVERAGE.md for data coverage. After editing COVERAGE.md, run `python build-coverage.py` to regenerate `dist/coverage.html`.

## Test

Run the same checks as CI before opening a pull request:

```powershell
node --test analytics.test.mjs strategy.test.mjs positioning.test.mjs
python -B -m unittest -v test_patterns
```

- Add tests for new or changed calculations. Check results against an independent method, such as a hand-worked example or a closed-form formula, rather than against the function's own output.
- The native TA-Lib tests skip when TA-Lib is not installed. CI installs it, so they run there.
- For interface changes, also check the affected tab in the browser, with sample mode and, if you can, live data.

The **Tests** workflow in `.github/workflows/tests.yml` runs these checks on every pull request and on pushes to `main`.

## Open a pull request

1. Create a branch from `main`.
2. Keep each pull request focused on one change.
3. Write commit messages with a short summary line and, where useful, a body that explains why.
4. Describe what changed, how you tested it, and any screenshots for interface changes.
5. Make sure the Tests workflow passes.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE). Only submit code you wrote or have the right to share. If a change is based on another project's code, say so in the pull request and include its license.

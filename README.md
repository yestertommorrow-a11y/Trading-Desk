# Strikebook

Strikebook is a stock, ETF and listed-options research terminal inspired by Market Chameleon's public workflows. It has an original interface and uses OpenBB and its configured providers for market data.

## Start with OpenBB on Windows

1. Extract the ZIP to a normal local folder.
2. Double-click **Start Strikebook.cmd**. Leave the console window open while you use the browser. It normally uses `http://127.0.0.1:8765/` and selects a free port if needed.
3. Search by ticker or company/fund name. Start with **AAPL** for a stock or **QQQ** for an ETF with verified chains. Open **Data & methodology** for provider and date details.

To use the hosted Strikebook in Chrome or Edge, keep the updated launcher running and select **Data connection → Connect this PC** on the site. It checks `http://127.0.0.1:8765`. If the launcher prints a different port, enter that address and select **Connect bridge**. Allow loopback access if your browser asks. If your browser blocks the connection, use the local dashboard opened by the launcher.

Python 3.10+ and the `openbb` CLI must be on PATH for provider mode. It was tested with Python 3.12, OpenBB v5.0.0, OpenBB CLI 2.0.1 and the Cboe, Nasdaq and SEC extensions. If you normally start OpenBB in a particular Python environment, activate that environment before running the launcher. To use another executable, set `OPTIONS_TERMINAL_CLI` or start the server with `--cli`:

```powershell
python -B server.py --port 0 --open-browser
```

The bridge listens only on this computer. It uses the existing OpenBB CLI configuration, including supported server or spec settings, without writing provider credentials into the web UI. To use other routes or licensed providers, set an `OPTIONS_TERMINAL_<ENDPOINT>` environment variable to a comma-separated list of verified `command:provider` entries supported by your OpenBB installation. Use `OPTIONS_TERMINAL_CHAIN` for the chain, `OPTIONS_TERMINAL_QUOTE` for quotes, or `OPTIONS_TERMINAL_HISTORY` for daily bars. The route implementation and default provider order are in `server.py`. A first run can take longer while OpenBB initializes its extensions.

## Research tools

- **Overview:** quote, source timestamp, daily price history, candlestick patterns, realized volatility, key chain metrics and quick chain inspection.
- **Options Chain:** expiration and strike window, liquidity/quote/Greek columns, volume and open-interest filters, contract details, and CSV export of the selected contracts.
- **Volatility:** term structure, strike skew, 25-delta IV spread, ATM straddle midpoint and model expected move. A 30-day IV range rank appears if the quote supplies the current IV and the provider's annual high and low. Historical IV percentile is a separate metric.
- **Activity Screener:** volume/open-interest turnover by selected instrument, with filters and expiry totals. It is a snapshot and does not classify trades or infer the aggressor.
- **Strategy Lab:** leg builder and presets, common-expiry payoff, bounded or unbounded risk, breakevens, and Black–Scholes sensitivities with editable spot, IV, DTE, rate and yield. Premiums and multipliers are editable.
- **Fundamentals and Events:** company profile and filings, income, balance and cash-flow statements, ratios, fund information and holdings, distributions, earnings and news where the providers return them.
- **Watchlist:** saved in your browser for the current origin. Use `/` to focus ticker lookup.

## Daily candlestick patterns

In **Overview → Price history → Candlesticks**, open **Choose patterns**. Search by name or TA-Lib function code, check the detectors you want, then select **Apply**. Strikebook saves your selection in this browser for the current dashboard address. **Defaults** selects Doji, Hammer, and Engulfing (both directions). **Clear** removes all selections, so you can view the chart without detections.

The candlestick chart uses [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) v5.2.1 (Apache-2.0), bundled in `dist/vendor` with its license. Drag to pan, scroll to zoom, and use the left and right arrow keys to step through bars; the line under the chart shows the bar's prices, volume and any detected patterns. If the library cannot load, Strikebook shows its built-in SVG candlestick chart instead.

Use the fullscreen button in a chart’s header to enlarge the chart. Select **Exit fullscreen** or press **Esc** to return. Under **Patterns**, use **Show all matches** to expand the six-match preview, or **Hide matches** to collapse the list. Chart markers stay visible when the list is hidden.

The three default detectors are built in. To enable the other 58 [TA-Lib candlestick detectors](https://ta-lib.github.io/ta-lib-python/func_groups/pattern_recognition.html), open PowerShell in the extracted Strikebook folder and run the following command with the Python used by the Windows launcher. It installs the dependency in that copy of Strikebook. Restart **Start Strikebook.cmd** once the install finishes, then open the address it prints.

```powershell
python -m pip install --only-binary=:all: --target .\.strikebook-deps -r .\requirements-patterns.txt
```

All detectors use the same completed daily open, high, low and close prices for the selected stock or ETF. Strikebook retrieves warm-up bars before the visible chart range and reports when a selected detector needs more history.

## Data coverage

When the default local OpenBB quote, history or chain providers fail, Strikebook can use the Yahoo Finance library already installed beside OpenBB. These responses are labeled **Yahoo Finance**. Explicit provider overrides and remote OpenBB configurations take precedence. The fallback includes available daily candles and option expirations, reports partially loaded chains, and preserves available source timestamps. Yahoo’s chain supplies no provider Greeks or consolidated quote timestamp.

The private hosted interface starts in **Sample mode** with six simulated symbols. The local dashboard connects to OpenBB automatically when the bridge is available. In a supported browser, the hosted dashboard can fetch directly from the local launcher with browser permission. The launcher binds to `127.0.0.1` and permits browser access from its own origin and the exact Strikebook hosted origin. A compatible organizational HTTPS bridge must implement Strikebook’s `/api` response contract and allow requests from the hosted origin.

Live requests were verified for delayed Cboe AAPL and QQQ chains, AAPL and SPY quotes and price history, SEC ticker search and filings, and SPY fund metrics and portfolio holdings from SEC N-PORT. A compatibility path addresses a known OpenBB Cboe 2.x whole-chain validation error by recovering contract identifiers through the same installed provider; it retains the original identifiers, reports skipped rows and flags possible adjusted series. Exchange, provider and plan coverage varies; each section shows missing or delayed data rather than substituting synthetic prices in provider mode. N-PORT is periodic disclosure, not current position data. Some endpoints, especially earnings, ratios, distributions and news, depend on Nasdaq responses which were not consistently usable during verification.

See [COVERAGE.md](COVERAGE.md) for the reference comparison and the additional feeds needed for consolidated real-time options, historical option studies, classified order flow, trade prints and marketwide screens.

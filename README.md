# Strikebook

[![Tests](https://github.com/yestertommorrow-a11y/Trading-Desk/actions/workflows/tests.yml/badge.svg?branch=main)](https://github.com/yestertommorrow-a11y/Trading-Desk/actions/workflows/tests.yml)

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
- **Volatility:** term structure, strike skew, IV surface heatmap, 25-delta IV spread, ATM straddle midpoint and model expected move. A 30-day IV range rank appears if the quote supplies the current IV and the provider's annual high and low. Historical IV percentile is a separate metric.
- **Activity Screener:** volume/open-interest turnover by selected instrument, with filters and expiry totals, plus gamma exposure and max pain. It is a snapshot and does not classify trades or infer the aggressor.
- **Strategy Lab:** leg builder and presets, common-expiry payoff with model P/L curves before expiration, bounded or unbounded risk, breakevens, probability of profit, and Black–Scholes sensitivities with editable spot, IV, DTE, rate and yield. Premiums and multipliers are editable.
- **Fundamentals and Events:** company profile and filings, income, balance and cash-flow statements, ratios, fund information and holdings, distributions, earnings and news where the providers return them.
- **Watchlist:** saved in your browser for the current origin. Use `/` to focus ticker lookup.

## Strategy, positioning and volatility analytics

These views are calculated in the browser from the loaded option chain. They are models, not forecasts, and they inherit the provider's coverage and delays.

### Strategy Lab: P/L before expiration

The **Expiration payoff** chart shows three lines: the exact P/L **at expiration**, the Black–Scholes P/L **today (T+0)**, and the P/L **halfway** to the nearest expiration (for example, T+14 days for a 28-day position). Each leg is priced with its own chain IV and days to expiration, or with the **IV override** and **DTE override** when you set them. Rate and yield come from the scenario fields. If a leg has no IV or expiration, only the expiration line is drawn and a note explains why. Hover the chart to compare all three values at one price.

### Strategy Lab: probability of profit

**Risk summary → Probability of profit** is the chance that the strategy's expiration P/L is positive, assuming the underlying price at expiration is lognormal (the Black–Scholes assumption, with risk-neutral drift). It uses the scenario spot, one volatility (the IV override, otherwise the expiration's ATM IV), the days to expiration, rate and yield. The value is exact for that model: Strikebook sums the probability of every price range where the payoff is positive, rather than sampling. The note under the value shows which IV and DTE were used. Price ranges with exactly zero P/L, such as a box spread, do not count as profit. **Breakeven** also lists those zero-P/L ranges.

### Activity Screener: gamma exposure and max pain

- **Net gamma exposure (GEX)** is gamma × open interest × contract multiplier × spot² × 1%, in dollars per 1% move. Calls count as positive and puts as negative, following the common convention that dealers are long calls and short puts; actual dealer positions are not observed. Provider gamma is used when supplied; otherwise gamma comes from Black–Scholes with each contract's IV. The **Scope** filter in the unusual activity screener switches between all expirations and the selected one.
- **Gamma flip** is where modeled total GEX changes sign as the underlying moves within ±20% of spot. **Call wall** and **Put wall** are the strikes with the largest call and put gamma.
- **Gamma exposure by strike** shows net GEX bars for strikes within ±15% of spot, with lines at spot and the flip. Hover a bar for its call and put components.
- **Max pain** is the settlement price, among listed strikes, at which option holders would collect the least intrinsic value for the selected expiration. The chart shows that total payout by strike.

Open interest is usually from the prior session. Both measures exclude possibly adjusted contracts and contracts without reported open interest; GEX also excludes contracts expiring on the valuation date.

### Volatility: IV surface

The **IV surface** heatmap shows implied volatility for each expiration (rows) at strikes from −20% to +20% of spot (columns). Each cell is interpolated between the two nearest listed strikes and is never extrapolated, so a cell outside the listed strikes shows "—". Out-of-the-money contracts are used (puts below spot, calls above, with the other side as a fallback); the ATM column averages both. Colors run from dim to bright teal across the 5th–95th percentile of values, so a few extreme wings don't wash out the rest; every cell also shows its value, and hovering gives the strike and source. Contracts without a usable IV, including Yahoo Finance placeholder values for unquoted or unpriceable contracts, are left out.

The IV term structure, volatility skew and payoff charts space points by their actual values (days to expiration, strike or price), so uneven gaps between expirations and strikes are visible.

## Daily candlestick patterns

In **Overview → Price history → Candlesticks**, open **Choose patterns**. Search by name or TA-Lib function code, check the detectors you want, then select **Apply**. Strikebook saves your selection in this browser for the current dashboard address. **Defaults** selects Doji, Hammer, and Engulfing (both directions). **Clear** removes all selections, so you can view the chart without detections.

The candlestick chart uses [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) v5.2.1 (Apache-2.0), bundled in `dist/vendor` with its license. Drag to pan, scroll to zoom, and use the left and right arrow keys to step through bars; the line under the chart shows the bar's prices, volume and any detected patterns. A volume pane sits under the candles. Pattern markers are teal arrows below bullish bars (labeled **H** for Hammer), red arrows above bearish bars, and gold dots for Doji and other non-directional patterns. Zoom and scroll are kept while the view refreshes and reset when the symbol, period or bars change. If the library cannot load, Strikebook shows its built-in SVG candlestick chart instead.

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

## Credits

**Included in this repository**

- [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) v5.2.1 draws the candlestick chart. It is bundled unchanged in `dist/vendor` under the Apache License 2.0; see [`dist/vendor/lightweight-charts.LICENSE.txt`](dist/vendor/lightweight-charts.LICENSE.txt).

**Used at run time, installed separately**

- [OpenBB](https://github.com/OpenBB-finance/OpenBB) provides market data through its configured providers.
- [yfinance](https://github.com/ranaroussi/yfinance) supplies the Yahoo Finance fallback.
- [TA-Lib](https://github.com/TA-Lib/ta-lib-python) runs the optional candlestick pattern detectors.

**Inspiration**

These projects shaped which features Strikebook offers. Strikebook's code is its own implementation and contains none of theirs.

- [Market Chameleon](https://marketchameleon.com/Learn/SiteFeatures)'s public research workflows inspired the ticker, chain and research layout.
- [optionlab](https://github.com/rgaveiga/optionlab) by Roberto Gomes inspired the probability-of-profit estimate.
- Open-source gamma exposure dashboards, such as those under the [gamma-exposure topic](https://github.com/topics/gamma-exposure) on GitHub, inspired the gamma exposure, gamma flip, call and put wall, and max pain views.

## Contributing

Bug reports and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, tests and the pull request process.

## License

Strikebook is released under the [MIT License](LICENSE). The bundled Lightweight Charts library keeps its own Apache License 2.0.

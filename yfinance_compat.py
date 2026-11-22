"""Read public Yahoo Finance quotes, daily prices and option chains via yfinance."""

from __future__ import annotations

import argparse
import contextlib
import json
import math
import re
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from numbers import Real


def json_safe(value):
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [json_safe(item) for item in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat() if value == value else None
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    if isinstance(value, Real):
        return float(value) if math.isfinite(value) else None
    raise TypeError(f"Unsupported Yahoo Finance value: {type(value).__name__}")


def finite(value):
    return float(value) if isinstance(value, Real) and not isinstance(value, bool) and math.isfinite(value) else None


def utc_time(value):
    seconds = finite(value)
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat() if seconds is not None else None


def close_cache():
    # yfinance 0.2.x SQLite connections are local to each worker thread.
    from yfinance import cache
    for name in ("_TzDBManager", "_CookieDBManager", "_ISINDBManager"):
        manager = getattr(cache, name, None)
        if manager is not None:
            manager.close_db()


def read_history(ticker, start=None, end=None):
    arguments = {"auto_adjust": False, "actions": True, "timeout": 10, "raise_errors": True}
    if start is not None:
        arguments["start"] = start.isoformat()
    if end is not None:
        arguments["end"] = (end + timedelta(days=1)).isoformat()
    if start is None:
        arguments["period"] = "1mo"
    frame = ticker.history(**arguments)
    rows = []
    for index, item in frame.iterrows():
        day = index.date()
        if start is not None and day < start or end is not None and day > end:
            continue
        row = {"date": day.isoformat(), **{key.lower(): item.get(key) for key in ("Open", "High", "Low", "Close", "Volume")}}
        if "Stock Splits" in frame:
            row["stock_splits"] = item.get("Stock Splits")
        rows.append(row)
    if not rows:
        raise ValueError("Yahoo Finance returned no daily prices for this request.")
    return frame, rows


def quote(ticker, symbol):
    frame, rows = read_history(ticker)
    meta = ticker.get_history_metadata()
    price = finite(meta.get("regularMarketPrice"))
    stamp = utc_time(meta.get("regularMarketTime")) if price is not None else None
    day = datetime.fromisoformat(stamp).astimezone(frame.index.tz).date().isoformat() if stamp and frame.index.tz else rows[-1]["date"]
    price = price if price is not None else finite(rows[-1]["close"])
    if price is None or price <= 0:
        raise ValueError("Yahoo Finance returned no valid underlying price.")
    previous = finite(meta.get("regularMarketPreviousClose"))
    earlier = [row for row in rows if row["date"] < day]
    if previous is None and earlier:
        previous = finite(earlier[-1]["close"])
    latest = next((row for row in reversed(rows) if row["date"] == day), {})
    row = {"symbol": symbol, "price": price, "prev_close": previous, "currency": meta.get("currency"),
           "name": meta.get("longName") or meta.get("shortName"), "last_timestamp": stamp,
           "day_high": latest.get("high"), "day_low": latest.get("low"), "volume": latest.get("volume")}
    return [row], {"current_price": price}, []


def chain(ticker, symbol, expiration=None):
    expirations = sorted(set(ticker.options))
    if expiration is not None:
        if expiration not in expirations:
            raise ValueError("Yahoo Finance does not list the requested option expiration.")
        expirations = [expiration]
    if not expirations:
        raise ValueError("Yahoo Finance returned no option expirations for this symbol.")

    def read_expiration(expiration):
        try:
            options = ticker.option_chain(expiration)
            rows = []
            for side, frame in (("call", options.calls), ("put", options.puts)):
                if frame is None:
                    continue
                for item in frame.to_dict("records"):
                    contract = item.get("contractSymbol")
                    parsed = re.fullmatch(r"(.+?)[0-9]{6}[CP][0-9]{8}", str(contract))
                    root = parsed[1] if parsed else None
                    size = item.get("contractSize")
                    adjusted = size != "REGULAR" or bool(root and root != symbol and any(char.isdigit() for char in root))
                    # Yahoo reports placeholder IVs (1e-5, 0.25, 0.5, 1.0) for contracts without a quote,
                    # and 1e-5 when its solver fails, e.g. for deep in-the-money contracts.
                    quoted = (finite(item.get("bid")) or 0) > 0 or (finite(item.get("ask")) or 0) > 0
                    quoted = quoted and (finite(item.get("impliedVolatility")) or 0) > 1e-4
                    rows.append({"contract_symbol": contract, "contract_root": root,
                                 "underlying_symbol": symbol, "expiration": expiration, "option_type": side,
                                 "strike": item.get("strike"), "bid": item.get("bid"), "ask": item.get("ask"),
                                 "last_trade_price": item.get("lastPrice"), "volume": item.get("volume"),
                                 "open_interest": item.get("openInterest"), "implied_volatility": item.get("impliedVolatility") if quoted else None,
                                 "in_the_money": item.get("inTheMoney"), "last_trade_time": item.get("lastTradeDate"),
                                 "contract_size": 100 if size == "REGULAR" else None, "adjusted": adjusted,
                                 "currency": item.get("currency")})
            if not rows:
                raise ValueError("The expiration returned no option contracts.")
            return rows, options.underlying or {}, None
        except Exception as error:
            return [], {}, f"Yahoo Finance could not load expiry {expiration} ({type(error).__name__})."
        finally:
            close_cache()

    with ThreadPoolExecutor(max_workers=4) as pool:
        outcomes = list(pool.map(read_expiration, expirations))
    rows = [row for contracts, _, _ in outcomes for row in contracts]
    warnings = [{"category": "UserWarning", "message": error} for _, _, error in outcomes if error]
    if not rows:
        raise ValueError("Yahoo Finance could not load any option expiration.")
    prices = [underlying for _, underlying, _ in outcomes if finite(underlying.get("regularMarketPrice")) is not None]
    underlying = max(prices, key=lambda item: finite(item.get("regularMarketTime")) or 0, default={})
    meta = {"current_price": finite(underlying.get("regularMarketPrice")),
            "underlying_last_trade_timestamp": utc_time(underlying.get("regularMarketTime")),
            "expirations_requested": len(expirations), "expirations_loaded": len(expirations) - len(warnings),
            "partial": bool(warnings)}
    return rows, meta, warnings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--route", choices=("quote", "history", "chain"), required=True)
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--start-date")
    parser.add_argument("--end-date")
    parser.add_argument("--expiration")
    args = parser.parse_args()
    try:
        symbol = args.symbol.upper().strip()
        if not re.fullmatch(r"[A-Z0-9^][A-Z0-9.^/_=+\-]{0,23}", symbol) or ".." in symbol or "//" in symbol:
            raise ValueError("Use a valid stock or ETF symbol.")
        if args.route != "history" and (args.start_date or args.end_date):
            raise ValueError("Date arguments apply to history only.")
        if args.expiration and args.route != "chain":
            raise ValueError("Expiration applies to option chains only.")
        expiration = date.fromisoformat(args.expiration).isoformat() if args.expiration else None
        start = date.fromisoformat(args.start_date) if args.start_date else None
        end = date.fromisoformat(args.end_date) if args.end_date else None
        if start is not None and end is not None and start > end:
            raise ValueError("The start date must precede the end date.")
        with tempfile.TemporaryDirectory(prefix="strikebook-yfinance-") as cache_dir, contextlib.redirect_stdout(sys.stderr):
            import yfinance as yf
            yf.set_tz_cache_location(cache_dir)
            try:
                ticker = yf.Ticker(symbol)
                if args.route == "history":
                    _, rows = read_history(ticker, start, end)
                    meta, warnings = {"auto_adjust": False}, []
                else:
                    rows, meta, warnings = quote(ticker, symbol) if args.route == "quote" else chain(ticker, symbol, expiration)
            finally:
                close_cache()
        result = {"results": rows, "provider": "Yahoo Finance", "extra": {"results_metadata": meta}, "warnings": warnings}
        response = {"ok": True, "result": result}
    except Exception as error:
        response = {"ok": False, "error": {"type": type(error).__name__, "message": str(error)}}
    print(json.dumps(json_safe(response), allow_nan=False))
    return 0 if response["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

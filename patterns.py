"""Measure candlestick formations on completed daily equity bars."""

import sys
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from math import isfinite
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


_DEFAULT_LOOKBACK = {"doji": 10, "hammer": 11, "engulfing": 2}
DEFAULT_DETECTORS = tuple(_DEFAULT_LOOKBACK)
_CORE_FUNCTIONS = {"doji": "CDLDOJI", "hammer": "CDLHAMMER", "engulfing": "CDLENGULFING"}
# https://ta-lib.org/functions/#pattern-recognition
_LABELS = {
    "doji": "Doji",
    "hammer": "Hammer",
    "engulfing": "Engulfing",
    "CDL2CROWS": "Two Crows",
    "CDL3BLACKCROWS": "Three Black Crows",
    "CDL3INSIDE": "Three Inside Up/Down",
    "CDL3LINESTRIKE": "Three-Line Strike",
    "CDL3OUTSIDE": "Three Outside Up/Down",
    "CDL3STARSINSOUTH": "Three Stars in the South",
    "CDL3WHITESOLDIERS": "Three Advancing White Soldiers",
    "CDLABANDONEDBABY": "Abandoned Baby",
    "CDLADVANCEBLOCK": "Advance Block",
    "CDLBELTHOLD": "Belt Hold",
    "CDLBREAKAWAY": "Breakaway",
    "CDLCLOSINGMARUBOZU": "Closing Marubozu",
    "CDLCONCEALBABYSWALL": "Concealing Baby Swallow",
    "CDLCOUNTERATTACK": "Counterattack",
    "CDLDARKCLOUDCOVER": "Dark Cloud Cover",
    "CDLDOJISTAR": "Doji Star",
    "CDLDRAGONFLYDOJI": "Dragonfly Doji",
    "CDLEVENINGDOJISTAR": "Evening Doji Star",
    "CDLEVENINGSTAR": "Evening Star",
    "CDLGAPSIDESIDEWHITE": "Gap Side-by-Side White Lines",
    "CDLGRAVESTONEDOJI": "Gravestone Doji",
    "CDLHANGINGMAN": "Hanging Man",
    "CDLHARAMI": "Harami",
    "CDLHARAMICROSS": "Harami Cross",
    "CDLHIGHWAVE": "High-Wave Candle",
    "CDLHIKKAKE": "Hikkake",
    "CDLHIKKAKEMOD": "Modified Hikkake",
    "CDLHOMINGPIGEON": "Homing Pigeon",
    "CDLIDENTICAL3CROWS": "Identical Three Crows",
    "CDLINNECK": "In-Neck",
    "CDLINVERTEDHAMMER": "Inverted Hammer",
    "CDLKICKING": "Kicking",
    "CDLKICKINGBYLENGTH": "Kicking by Length",
    "CDLLADDERBOTTOM": "Ladder Bottom",
    "CDLLONGLEGGEDDOJI": "Long-Legged Doji",
    "CDLLONGLINE": "Long Line Candle",
    "CDLMARUBOZU": "Marubozu",
    "CDLMATCHINGLOW": "Matching Low",
    "CDLMATHOLD": "Mat Hold",
    "CDLMORNINGDOJISTAR": "Morning Doji Star",
    "CDLMORNINGSTAR": "Morning Star",
    "CDLONNECK": "On-Neck",
    "CDLPIERCING": "Piercing Pattern",
    "CDLRICKSHAWMAN": "Rickshaw Man",
    "CDLRISEFALL3METHODS": "Rising/Falling Three Methods",
    "CDLSEPARATINGLINES": "Separating Lines",
    "CDLSHOOTINGSTAR": "Shooting Star",
    "CDLSHORTLINE": "Short Line Candle",
    "CDLSPINNINGTOP": "Spinning Top",
    "CDLSTALLEDPATTERN": "Stalled Pattern",
    "CDLSTICKSANDWICH": "Stick Sandwich",
    "CDLTAKURI": "Takuri",
    "CDLTASUKIGAP": "Tasuki Gap",
    "CDLTHRUSTING": "Thrusting Pattern",
    "CDLTRISTAR": "Tristar",
    "CDLUNIQUE3RIVER": "Unique Three River",
    "CDLUPSIDEGAP2CROWS": "Upside Gap Two Crows",
    "CDLXSIDEGAP3METHODS": "Upside/Downside Gap Three Methods",
}
_FUNCTIONS = {key: _CORE_FUNCTIONS.get(key, key) for key in _LABELS}
_CORE_DIRECTIONAL = {"hammer", "engulfing"}
_OHLC = ("open", "high", "low", "close")
_NATIVE_FAILURES = (ImportError, AttributeError, OSError, RuntimeError, ValueError, TypeError)
# Keep optional dashboard packages out of the OpenBB worker's environment.
_LOCAL_DEPENDENCIES = Path(__file__).resolve().with_name(".strikebook-deps")
if _LOCAL_DEPENDENCIES.is_dir() and str(_LOCAL_DEPENDENCIES) not in sys.path:
    sys.path.insert(0, str(_LOCAL_DEPENDENCIES))


def parse_detectors(value):
    if value is None:
        return DEFAULT_DETECTORS
    if value == "none":
        return ()
    keys = tuple(dict.fromkeys(item.strip() for item in value.split(",")))
    for key in keys:
        if key not in _LABELS:
            label = key[:80] or "(empty)"
            raise ValueError(f"Unknown candlestick detector: {label}.")
    return keys


def _load_native():
    import numpy as np
    import talib
    from talib import abstract

    return np, talib, abstract


def pattern_catalog():
    try:
        _, talib, _ = _load_native()
    except _NATIVE_FAILURES:
        talib = None
    engine = "TA-Lib" if talib is not None else "Strikebook built-in"
    return [{"id": key, "label": label,
             "available": key in _DEFAULT_LOOKBACK or callable(getattr(talib, _FUNCTIONS[key], None))}
            for key, label in _LABELS.items()], engine


@dataclass(frozen=True)
class _Bar:
    day: date
    open: float
    high: float
    low: float
    close: float

    @property
    def body(self):
        return abs(self.close - self.open)

    @property
    def spread(self):
        return self.high - self.low

    def as_row(self):
        return {"date": self.day.isoformat(), **{field: getattr(self, field) for field in _OHLC}}


def completed_through(now):
    """Exclude today's NY session until 16:15 ET to allow a 15-minute delay."""
    try:
        local = now.astimezone(ZoneInfo("America/New_York"))
        cutoff = time(16, 15)
    except ZoneInfoNotFoundError:
        # Windows can lack IANA timezone data. 22:15 UTC is later than the
        # regular close plus 15 minutes in both daylight and standard time.
        local = now.astimezone(timezone.utc)
        cutoff = time(22, 15)
    return local.date() if local.time() >= cutoff else local.date() - timedelta(days=1)


def _row_date(value):
    if isinstance(value, date):
        return value.date() if isinstance(value, datetime) else value
    if not isinstance(value, str) or (len(value) != 10 and value[10:11] not in {"T", " "}):
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _parse_bar(day, row):
    try:
        fields = [row.get(key) for key in _OHLC]
        if any(isinstance(field, bool) for field in fields):
            return None
        opened, high, low, closed = map(float, fields)
    except (TypeError, ValueError, OverflowError):
        return None
    if not all(isfinite(value) and value > 0 for value in (opened, high, low, closed)):
        return None
    if not low <= min(opened, closed) <= max(opened, closed) <= high:
        return None
    return _Bar(day, opened, high, low, closed)


def _segments(rows, end):
    by_date = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        day = _row_date(row.get("date"))
        if day is None or day > end:
            continue
        bar = _parse_bar(day, row)
        by_date[day] = None if day in by_date and by_date[day] != bar else bar

    segment = []
    for _, bar in sorted(by_date.items()):
        if bar is None:
            if segment:
                yield segment
                segment = []
        else:
            segment.append(bar)
    if segment:
        yield segment


def _engulfing_value(previous, current):
    prior_bullish = previous.close >= previous.open
    current_bullish = current.close >= current.open
    if current_bullish == prior_bullish:
        return 0
    prior_low, prior_high = sorted((previous.open, previous.close))
    current_low, current_high = sorted((current.open, current.close))
    fully_engulfs = current_low < prior_low and current_high > prior_high
    shares_an_edge = (current_low == prior_low and current_high > prior_high
                      or current_low < prior_low and current_high == prior_high)
    value = 100 if fully_engulfs else 80 if shares_an_edge else 0
    return value if current_bullish else -value


def _builtin_values(bars, detectors=DEFAULT_DETECTORS):
    """Implement TA-Lib's documented default candle settings for three patterns.

    https://ta-lib.org/api/candle-settings/
    https://ta-lib.org/functions/cdlhammer
    https://ta-lib.org/functions/cdldoji.html
    https://ta-lib.org/functions/cdlengulfing.html
    """
    values = {key: [0] * len(bars) for key in detectors}
    for index, bar in enumerate(bars):
        if "engulfing" in values and index >= _DEFAULT_LOOKBACK["engulfing"]:
            values["engulfing"][index] = _engulfing_value(bars[index - 1], bar)
        check_doji = "doji" in values and index >= _DEFAULT_LOOKBACK["doji"]
        check_hammer = "hammer" in values and index >= _DEFAULT_LOOKBACK["hammer"]
        if not (check_doji or check_hammer):
            continue
        preceding = bars[index - 10:index]
        typical_range = sum(item.spread for item in preceding) / len(preceding)
        if check_doji and bar.body <= 0.1 * typical_range:
            values["doji"][index] = 100
        if not check_hammer:
            continue
        body_bottom, body_top = sorted((bar.open, bar.close))
        typical_body = sum(item.body for item in preceding) / len(preceding)
        earlier = bars[index - 6:index - 1]
        near_previous_low = 0.2 * (sum(item.spread for item in earlier) / len(earlier))
        if (bar.body < typical_body and body_bottom - bar.low > bar.body
                and bar.high - body_top < 0.1 * typical_range
                and body_bottom <= bars[index - 1].low + near_previous_low):
            values["hammer"][index] = 100
    return values


def _native_engine(detectors=DEFAULT_DETECTORS):
    np, talib, abstract = _load_native()
    lookback = {}
    functions = {}
    directional = _CORE_DIRECTIONAL.copy()
    for key in detectors:
        name = _FUNCTIONS[key]
        function = getattr(talib, name, None)
        if not callable(function):
            continue
        try:
            definition = abstract.Function(name)
            minimum = int(definition.lookback)
        except _NATIVE_FAILURES:
            continue
        if minimum < 0:
            continue
        lookback[key] = minimum
        functions[key] = function
        # TA-Lib distinguishes relative candle color from bullish/bearish patterns.
        # https://ta-lib.org/spec/inputs-outputs/
        if key not in _CORE_FUNCTIONS:
            flags = getattr(definition, "output_flags", {}).values()
            if any(flag.startswith("Bull/Bear Pattern") for output in flags for flag in output or ()):
                directional.add(key)

    def calculate(bars):
        ready = [key for key, minimum in lookback.items() if len(bars) > minimum]
        if not ready:
            return {}
        inputs = [np.array([getattr(bar, field) for bar in bars], dtype=np.float64) for field in _OHLC]
        values = {}
        for key in ready:
            try:
                values[key] = functions[key](*inputs)
            except _NATIVE_FAILURES:
                continue
        return values

    return lookback, calculate, talib.__version__, directional


def _status(evaluated, found):
    return "matched" if found else "no_match" if evaluated else "insufficient_history"


def _evaluate(segments, start, lookback, calculate, directional):
    matches = []
    counts = dict.fromkeys(lookback, 0)
    found = set()
    failed = set()
    for segment in segments:
        values = calculate(segment)
        failed.update(key for key, minimum in lookback.items() if len(segment) > minimum and key not in values)
        for index, bar in enumerate(segment):
            if bar.day < start:
                continue
            for key, minimum in lookback.items():
                if index < minimum or key in failed:
                    continue
                counts[key] += 1
                value = int(values[key][index])
                if value:
                    found.add(key)
                    direction = "neutral" if key not in directional else "bullish" if value > 0 else "bearish"
                    matches.append({"date": bar.day.isoformat(), "pattern": key, "direction": direction, "value": value})
    if failed:
        matches = [match for match in matches if match["pattern"] not in failed]
        for key in failed:
            del counts[key]
        found.difference_update(failed)
    return matches, counts, found


def analyse_patterns(rows, *, start, end, now, fetched_at=None, detectors=DEFAULT_DETECTORS):
    """Return matches and the same visible, closed OHLC bars used to detect them."""
    if fetched_at:
        try:
            fetched = datetime.fromisoformat(fetched_at)
            if fetched.tzinfo is not None:
                now = min(now, fetched)
        except (TypeError, ValueError):
            pass
    end = min(end, completed_through(now))
    segments = list(_segments(rows, end))
    visible = [bar.as_row() for segment in segments for bar in segment if bar.day >= start]
    engine, version = "Strikebook built-in", None
    lookback = {}
    matches, counts, found = [], {}, set()
    if detectors:
        try:
            lookback, calculate, version, directional = _native_engine(detectors)
            matches, counts, found = _evaluate(segments, start, lookback, calculate, directional)
            lookback = {key: lookback[key] for key in counts}
            engine = "TA-Lib"
        except _NATIVE_FAILURES:
            version = None
            lookback = {}

        builtin = {key: _DEFAULT_LOOKBACK[key] for key in detectors if key in _DEFAULT_LOOKBACK and key not in counts}
        if builtin:
            def calculate_builtin(bars):
                return _builtin_values(bars, builtin)

            fallback_matches, fallback_counts, fallback_found = _evaluate(
                segments, start, builtin, calculate_builtin, _CORE_DIRECTIONAL,
            )
            if not counts:
                engine, version = "Strikebook built-in", None
            matches.extend(fallback_matches)
            order = {key: index for index, key in enumerate(detectors)}
            matches.sort(key=lambda item: (item["date"], order[item["pattern"]]))
            counts.update(fallback_counts)
            found.update(fallback_found)
            lookback.update(builtin)

    evaluated = max(counts.values(), default=0)
    status = _status(evaluated, bool(found))
    if not detectors:
        status = "disabled"
    elif not lookback:
        status = "unavailable"
    return matches, {
        "engine": engine,
        "engine_version": version,
        "status": status,
        "evaluated_bars": evaluated,
        "latest_bar": visible[-1]["date"] if visible else None,
        "lookback": lookback,
        "patterns": {
            key: {"status": _status(counts[key], key in found) if key in counts else "unavailable",
                  "evaluated_bars": counts.get(key, 0)}
            for key in detectors
        },
        "bars": visible,
    }

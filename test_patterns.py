"""Regression fixtures for closed-bar pattern assessment and OpenBB wiring."""

import unittest
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from patterns import _builtin_values, _native_engine, _segments, analyse_patterns, parse_detectors, pattern_catalog
from server import ResearchAPI


FIRST = date(2025, 11, 3)
DAYS = [FIRST + timedelta(days=offset) for offset in range(25)
        if (FIRST + timedelta(days=offset)).weekday() < 5]
NOW = datetime(2025, 12, 1, 23, tzinfo=timezone.utc)


def row(index, opened=102, high=105, low=101, closed=104):
    return dict(date=DAYS[index].isoformat(), open=opened, high=high, low=low, close=closed)


class CandleTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        patch("patterns._load_native", side_effect=ImportError("optional wheel absent")).start()

    def analyse(self, rows, start=FIRST, now=NOW, fetched_at=None, **options):
        return analyse_patterns(rows, start=start, end=DAYS[-1], now=now, fetched_at=fetched_at, **options)

    def test_doji_and_warmup(self):
        rows = [row(i) for i in range(10)] + [row(10, 102, 104, 101, 102.1)]
        matches, meta = self.analyse(reversed(rows), start=DAYS[10])
        self.assertEqual(matches, [dict(date=rows[-1]["date"], pattern="doji", direction="neutral", value=100)])
        self.assertEqual(meta["bars"], [rows[-1]])
        self.assertEqual(meta["patterns"]["hammer"]["status"], "insufficient_history")
        self.assertEqual(meta["patterns"]["engulfing"]["status"], "no_match")
        self.assertEqual(meta["engine"], "Strikebook built-in")

    def test_hammer_and_near_miss(self):
        baseline = [row(i) for i in range(11)]
        hammer = row(11, 101.2, 102.1, 99, 102)
        matches, _ = self.analyse([*baseline, hammer], start=DAYS[11])
        self.assertEqual([(item["pattern"], item["direction"]) for item in matches], [("hammer", "bullish")])
        misses, meta = self.analyse([*baseline, {**hammer, "high": 102.8}], start=DAYS[11])
        self.assertEqual(misses, [])
        self.assertEqual(meta["patterns"]["hammer"], dict(status="no_match", evaluated_bars=1))

    def test_doji_body_and_hammer_placement_at_threshold(self):
        baseline = [row(i, 102, 106, 101, 104) for i in range(11)]
        doji, _ = self.analyse([*baseline, row(11, 102, 105, 101, 102.5)], start=DAYS[11])
        self.assertEqual([item["pattern"] for item in doji], ["doji"])
        hammer = row(11, 102, 103.25, 100, 103)
        matched, _ = self.analyse([*baseline, hammer], start=DAYS[11])
        self.assertEqual([item["pattern"] for item in matched], ["hammer"])
        missed, _ = self.analyse([*baseline, {**hammer, "high": 103.5}], start=DAYS[11])
        self.assertEqual(missed, [])

    def test_engulfing_directions_and_shared_edge(self):
        rows = [row(0), row(1, 101, 102, 98, 99), row(2, 98, 103, 97, 102),
                row(3, 103, 104, 96, 97), row(4, 97, 105, 96, 104)]
        matches, meta = self.analyse(rows)
        self.assertEqual([(item["date"], item["direction"], item["value"]) for item in matches], [
            (rows[2]["date"], "bullish", 100), (rows[3]["date"], "bearish", -100),
            (rows[4]["date"], "bullish", 80),
        ])
        self.assertEqual(meta["patterns"]["engulfing"]["evaluated_bars"], 3)

    def test_unfinished_session_and_preclose_cache_cannot_change_prior_results(self):
        rows = [row(i) for i in range(10)] + [row(10, 102, 104, 101, 102.1)]
        current = DAYS[10]
        before = datetime(current.year, current.month, current.day, 19, tzinfo=timezone.utc)
        after = datetime(current.year, current.month, current.day, 23, tzinfo=timezone.utc)
        expected = self.analyse(rows[:-1], now=before)
        self.assertEqual(self.analyse(rows, now=before), expected)
        self.assertEqual(self.analyse(rows, now=after, fetched_at=before.isoformat()), expected)
        self.assertEqual(len(self.analyse(rows, now=after)[0]), 1)

    def test_invalid_or_conflicting_candles_break_warmup(self):
        rows = [row(i) for i in range(5)]
        rows[2] = {**rows[2], "low": rows[2]["high"] + 1}
        _, meta = self.analyse([*rows, rows[3]])
        self.assertEqual(meta["status"], "insufficient_history")
        self.assertEqual([bar["date"] for bar in meta["bars"]], [rows[i]["date"] for i in (0, 1, 3, 4)])
        _, conflict = self.analyse([row(0), row(1), row(2), row(1, closed=103)])
        self.assertEqual(conflict["status"], "insufficient_history")

    def test_route_fetches_earlier_history_and_shares_its_cache(self):
        calls = []
        rows = [row(i) for i in range(10)] + [row(10, 102, 104, 101, 102.1)]

        class Source:
            def request(self, command, arguments):
                calls.append((command, arguments))
                return {"ok": True, "result": {"provider": "fixture", "results": rows}}

        api = ResearchAPI(Source())
        query = {"symbol": ["AAPL"], "start_date": [DAYS[10].isoformat()], "end_date": [DAYS[10].isoformat()]}
        first = api.get("patterns", query)
        second = api.get("patterns", query)
        self.assertTrue(first["ok"])
        self.assertEqual(first["provider"], "fixture")
        self.assertEqual(first["asOf"], DAYS[10].isoformat())
        self.assertEqual(first["data"], second["data"])
        self.assertEqual(len(first["data"]), 1)
        self.assertEqual(len(first["meta"]["bars"]), 1)
        self.assertEqual(len(calls), 1)
        self.assertLess(date.fromisoformat(calls[0][1]["start_date"]), FIRST)

        disabled = api.get("patterns", {**query, "detectors": ["none"]})
        self.assertTrue(disabled["ok"])
        self.assertEqual(disabled["data"], [])
        self.assertEqual(disabled["meta"]["status"], "disabled")
        self.assertEqual(disabled["meta"]["patterns"], {})
        self.assertEqual(disabled["meta"]["bars"], first["meta"]["bars"])
        unavailable = api.get("patterns", {**query, "detectors": ["CDLMORNINGSTAR"]})
        self.assertEqual(unavailable["meta"]["status"], "unavailable")
        invalid = api.get("patterns", {**query, "detectors": ["none,doji"]})
        self.assertFalse(invalid["ok"])
        self.assertIn("Unknown candlestick detector", invalid["error"]["message"])
        duplicate_fields = api.get("patterns", {**query, "detectors": ["doji", "hammer"]})
        self.assertFalse(duplicate_fields["ok"])
        self.assertEqual(len(calls), 1)

    def test_catalog_and_mixed_selection_with_no_native_engine(self):
        api = ResearchAPI(SimpleNamespace(cli="openbb"))
        status = api.get("status", {})["data"]
        self.assertEqual(status["pattern_engine"], "Strikebook built-in")
        self.assertEqual(len(status["pattern_catalog"]), 61)
        self.assertEqual([item["id"] for item in status["pattern_catalog"] if item["available"]],
                         ["doji", "hammer", "engulfing"])
        detectors = parse_detectors("CDLMORNINGSTAR, hammer ,engulfing,CDLMORNINGSTAR")
        rows = [row(i) for i in range(10)] + [row(10, 102, 104, 101, 102.1)]
        matches, meta = self.analyse(rows, start=DAYS[10], detectors=detectors)
        self.assertEqual(matches, [])
        self.assertEqual(list(meta["patterns"]), ["CDLMORNINGSTAR", "hammer", "engulfing"])
        self.assertEqual(meta["status"], "no_match")
        self.assertEqual(meta["patterns"], {
            "CDLMORNINGSTAR": dict(status="unavailable", evaluated_bars=0),
            "hammer": dict(status="insufficient_history", evaluated_bars=0),
            "engulfing": dict(status="no_match", evaluated_bars=1),
        })
        self.assertEqual(meta["lookback"], {"hammer": 11, "engulfing": 2})

    def test_invalid_detector_spellings_and_empty_query_are_rejected(self):
        for invalid in ("", "doji,", "CDLdOjI", "none,hammer"):
            with self.subTest(invalid=invalid), self.assertRaisesRegex(ValueError, "Unknown candlestick detector"):
                parse_detectors(invalid)


class SelectionTests(unittest.TestCase):
    def test_native_engine_evaluates_only_selected_detectors_with_output_semantics(self):
        definitions = []
        calls = []

        def metadata(name):
            definitions.append(name)
            flag = "Bull/Bear Pattern (Bearish < 0, Neutral = 0, Bullish > 0)"
            flags = [flag] if name == "CDLMORNINGSTAR" else ["Output can be positive", "Output can be negative"]
            return SimpleNamespace(lookback=2, output_flags={"integer": flags})

        def detector(name, value):
            def evaluate(*args):
                calls.append(name)
                if value is None:
                    raise ValueError("fixture detector failure")
                return [0, 0, value]
            return evaluate

        native = SimpleNamespace(__version__="test", CDLMORNINGSTAR=detector("CDLMORNINGSTAR", 100),
                                 CDLSPINNINGTOP=detector("CDLSPINNINGTOP", -100),
                                 CDLHARAMI=detector("CDLHARAMI", None),
                                 CDLHAMMER=detector("CDLHAMMER", 100))
        numpy = SimpleNamespace(array=lambda values, dtype: values, float64=float)
        with patch("patterns._load_native", return_value=(numpy, native, SimpleNamespace(Function=metadata))):
            catalog, engine = pattern_catalog()
            self.assertEqual(engine, "TA-Lib")
            self.assertEqual([item["id"] for item in catalog if item["available"]],
                             ["doji", "hammer", "engulfing", "CDLHARAMI", "CDLMORNINGSTAR", "CDLSPINNINGTOP"])
            rows = [row(i) for i in range(3)]
            matches, meta = analyse_patterns(rows, start=FIRST, end=DAYS[-1], now=NOW,
                                             detectors=("CDLMORNINGSTAR", "CDLSPINNINGTOP", "CDL3INSIDE", "CDLHARAMI"))
        self.assertEqual(definitions, ["CDLMORNINGSTAR", "CDLSPINNINGTOP", "CDLHARAMI"])
        self.assertEqual(calls, definitions)
        self.assertEqual(meta["engine"], "TA-Lib")
        self.assertEqual(meta["patterns"]["CDL3INSIDE"]["status"], "unavailable")
        self.assertEqual(meta["patterns"]["CDLHARAMI"]["status"], "unavailable")
        self.assertEqual(matches, [
            dict(date=rows[2]["date"], pattern="CDLMORNINGSTAR", direction="bullish", value=100),
            dict(date=rows[2]["date"], pattern="CDLSPINNINGTOP", direction="neutral", value=-100),
        ])


class NativeParityTests(unittest.TestCase):
    def setUp(self):
        catalog, engine = pattern_catalog()
        if engine != "TA-Lib":
            self.skipTest("optional TA-Lib engine is not available")
        self.assertEqual(sum(item["available"] for item in catalog), 61)

    def test_builtin_matches_native_on_regression_fixture(self):
        source = [row(i) for i in range(10)] + [row(10, 102, 104, 101, 102.1), row(11),
                  row(12, 101.2, 102.1, 99, 102), row(13, 103, 104, 96, 97),
                  row(14, 97, 105, 96, 104)]
        bars = next(_segments(source, DAYS[-1]))
        _, native, _, _ = _native_engine()
        self.assertEqual({key: list(values) for key, values in native(bars).items()}, _builtin_values(bars))

    def test_native_distinguishes_pattern_direction_from_candle_color(self):
        lookback, _, _, directional = _native_engine(("CDLMORNINGSTAR", "CDLSPINNINGTOP"))
        self.assertEqual(set(lookback), {"CDLMORNINGSTAR", "CDLSPINNINGTOP"})
        self.assertIn("CDLMORNINGSTAR", directional)
        self.assertNotIn("CDLSPINNINGTOP", directional)


if __name__ == "__main__":
    unittest.main()

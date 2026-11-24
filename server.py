"""Serve the options terminal and dispatch allowlisted OpenBB CLI commands."""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from collections import OrderedDict
from concurrent.futures import Future, ThreadPoolExecutor, TimeoutError
from datetime import date, datetime, timedelta, timezone
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from patterns import analyse_patterns, completed_through, parse_detectors, pattern_catalog


SYMBOL = re.compile(r"[A-Z0-9^][A-Z0-9.^/_=+\-]{0,23}\Z", re.ASCII)
COMMAND = re.compile(r"[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+\Z", re.ASCII)
PROVIDERS = {
    "search": ("sec.equity_search:sec", "nasdaq.equity.search:nasdaq", "cboe.equity.search:cboe"),
    "quote": ("cboe.equity.quote:cboe", "nasdaq.equity.quote:nasdaq"),
    "history": ("cboe.equity.historical:cboe", "nasdaq.equity.historical:nasdaq"),
    "chain": ("cboe.options.chains:cboe", "nasdaq.options.chains:nasdaq"),
    "profile": ("nasdaq.equity.profile:nasdaq", "sec.company_overview:sec"),
    "fund": ("nasdaq.etf.info:nasdaq", "sec.nport_fund_metrics:sec"),
    "income": ("nasdaq.equity.fundamental.income:nasdaq", "sec.income_statement:sec"),
    "balance": ("nasdaq.equity.fundamental.balance:nasdaq", "sec.balance_sheet:sec"),
    "cash": ("nasdaq.equity.fundamental.cash:nasdaq", "sec.cash_flow:sec"),
    "ratios": ("nasdaq.equity.fundamental.ratios:nasdaq",),
    "dividends": ("nasdaq.equity.fundamental.dividends:nasdaq",),
    "earnings": ("nasdaq.equity.fundamental.historical_eps:nasdaq",),
    "earnings-calendar": ("nasdaq.equity.calendar.earnings:nasdaq",),
    "news": ("news.company:nasdaq",),
    "holdings": ("nasdaq.etf.holdings:nasdaq", "sec.nport_disclosure:sec"),
    "filings": ("sec.company_filings:sec", "nasdaq.equity.filings:nasdaq"),
}
ALIASES = {"financials": "income", "etf": "fund", "cashflow": "cash"}
PERIODS = {"1M": 31, "3M": 92, "6M": 183, "1Y": 366, "2Y": 731, "5Y": 1827}
EXPIRATION_KEYS = {"contract_symbol", "option_type", "expiration", "strike"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def strict_numbers(value):
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, list):
        return [strict_numbers(item) for item in value]
    if isinstance(value, dict):
        return {key: strict_numbers(item) for key, item in value.items()}
    return value


def result_rows(results):
    """OpenBB chains can be serialized as one column-oriented record."""
    inputs = [results] if isinstance(results, dict) else results
    if not isinstance(inputs, list):
        return []
    rows = []
    for item in inputs:
        if not isinstance(item, dict):
            continue
        if EXPIRATION_KEYS <= item.keys() and isinstance(item["strike"], list):
            for index in range(len(item["strike"])):
                rows.append({
                    key: (value[index] if index < len(value) else None)
                    if isinstance(value, list) else value
                    for key, value in item.items()
                })
        else:
            rows.append(item)
    return rows


def envelope(ok, *, data=None, provider=None, command=None, as_of=None, error=None,
             warnings=None, meta=None, delayed=None):
    return {
        "ok": ok, "data": data, "provider": provider, "command": command,
        "fetchedAt": now_iso(), "asOf": as_of,
        "error": {"message": error} if isinstance(error, str) else error,
        "warnings": warnings or [], "meta": meta or {}, "delayed": delayed,
    }


class OpenBBError(Exception):
    pass


class OpenBBProcess:
    """One multiplexed NDJSON worker, with the user's OpenBB config and providers."""

    def __init__(self, cli: str, env: dict, timeout: float):
        self.cli = cli
        self.env = env
        self.timeout = timeout
        self.process = None
        self.pending: dict[str, Future] = {}
        self.lock = threading.Lock()

    def start(self):
        if self.process is not None and self.process.poll() is None:
            return self.process
        if self.process is not None:
            self.pending_fail("OpenBB CLI exited before returning data. Retry the request.")
        try:
            process = subprocess.Popen(
                [self.cli, "--batch", "--batch-concurrency", "6"],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                env=self.env, text=True, encoding="utf-8", errors="replace", bufsize=1,
            )
        except OSError as exc:
            raise OpenBBError("OpenBB CLI could not start. Check the installed CLI and its configuration.") from exc
        self.process = process
        threading.Thread(target=self.read_results, args=(process,), daemon=True).start()
        return process

    def read_results(self, process):
        try:
            with process.stdout as stream:
                for line in stream:
                    try:
                        response = json.loads(line)
                    except (TypeError, ValueError):
                        continue
                    if not isinstance(response, dict):
                        continue
                    with self.lock:
                        if self.process is not process:
                            return
                        future = self.pending.pop(response.get("id"), None)
                        if future is not None:
                            future.set_result(response)
        finally:
            with self.lock:
                if self.process is process:
                    self.pending_fail("OpenBB CLI closed before returning data. Check the CLI startup and providers.")
                    self.process = None

    def pending_fail(self, message):
        for future in self.pending.values():
            future.set_exception(OpenBBError(message))
        self.pending.clear()

    def request(self, command, params):
        identifier = uuid4().hex
        payload = json.dumps({"id": identifier, "command": command, "params": params})
        future = Future()
        with self.lock:
            process = self.start()
            self.pending[identifier] = future
            try:
                process.stdin.write(payload + "\n")
                process.stdin.flush()
            except OSError as exc:
                self.pending.pop(identifier, None)
                raise OpenBBError("OpenBB CLI disconnected. Retry the request.") from exc
        try:
            return future.result(timeout=self.timeout)
        except TimeoutError as exc:
            with self.lock:
                self.pending.pop(identifier, None)
            raise OpenBBError("OpenBB did not return data before the provider timeout.") from exc

    def close(self):
        with self.lock:
            if self.process is not None:
                process, self.process = self.process, None
                if process.poll() is None:
                    process.terminate()
                self.pending_fail("OpenBB worker stopped.")


def choice(params, key, default=""):
    return params.get(key, [default])[0].strip()


def iso_day(value):
    return date.fromisoformat(value).isoformat()


def route_inputs(route, supplied):
    if route == "search":
        query = choice(supplied, "q")
        if not 1 <= len(query) <= 80 or not query.isprintable():
            raise ValueError("Enter a ticker or company or fund name up to 80 characters.")
        return {"query": query}
    symbol = choice(supplied, "symbol").upper()
    if symbol and (not SYMBOL.fullmatch(symbol) or ".." in symbol or "//" in symbol):
        raise ValueError("Enter one ticker symbol up to 24 characters.")
    if not symbol and route != "earnings-calendar":
        raise ValueError("Enter a ticker symbol.")
    if route == "history":
        period = choice(supplied, "period", "6M").upper()
        if period not in PERIODS:
            raise ValueError("Use a price history period of 1M, 3M, 6M, 1Y, 2Y or 5Y.")
        end = date.fromisoformat(choice(supplied, "end_date", date.today().isoformat()))
        start = date.fromisoformat(choice(supplied, "start_date", (end - timedelta(days=PERIODS[period])).isoformat()))
        if end < start or (end - start).days > 3660:
            raise ValueError("Choose a date range no longer than ten years.")
        return {"symbol": symbol, "start_date": start.isoformat(), "end_date": end.isoformat()}
    if route == "earnings-calendar":
        start = date.fromisoformat(choice(supplied, "start_date", date.today().isoformat()))
        end = date.fromisoformat(choice(supplied, "end_date", (start + timedelta(days=6)).isoformat()))
        if end < start or (end - start).days > 30:
            raise ValueError("Choose an earnings calendar range no longer than 31 days.")
        return {"symbol": symbol, "start_date": start.isoformat(), "end_date": end.isoformat()}
    values = {"symbol": symbol}
    if route == "news":
        values["limit"] = 20
    if route == "chain" and choice(supplied, "expiration"):
        values["expiration"] = iso_day(choice(supplied, "expiration"))
    return values


def data_as_of(route, rows, meta):
    if route == "chain":
        # Yahoo chains supply only the underlying's last trade time.
        return meta.get("timestamp") or meta.get("as_of") or next(
            (row["eod_date"] for row in rows if row.get("eod_date")), None
        ) or meta.get("underlying_last_trade_timestamp")
    if route == "holdings" and meta.get("period_ending"):
        return meta["period_ending"]
    date_keys = {
        "quote": ("last_timestamp", "last_trade_timestamp"),
        "history": ("date",), "news": ("date", "published"),
        "earnings": ("date", "report_date"), "holdings": ("date", "as_of"),
        "dividends": ("ex_dividend_date", "ex_date"),
        "fund": ("period", "reporting_period", "report_date", "date", "updated"),
        "income": ("period_ending", "date"), "balance": ("period_ending", "date"),
        "cash": ("period_ending", "date"), "filings": ("filing_date",),
    }
    values = [str(row[key]) for row in rows for key in date_keys.get(route, ()) if row.get(key)]
    return max(values, default=None)


def cboe_trade_time(value):
    if not isinstance(value, str):
        return value
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=ZoneInfo("America/New_York"))
        return parsed.isoformat()
    except (ValueError, ZoneInfoNotFoundError):
        return value


def provider_error(kind, message):
    """Return a useful state without plumbing credentials or upstream URLs to clients."""
    lower = message.lower()
    if "emptydata" in kind.lower() or "not found" in lower and "directory" in lower:
        return "The provider returned no coverage for this request."
    if "commandnotfound" in kind.lower() or "provider" in lower and "invalid" in lower:
        return "The OpenBB command or provider is unavailable in the configured installation."
    if "validation" in lower and "[data model]" in lower:
        return "OpenBB could not validate one or more rows from this provider."
    if re.search(r"\b403\b", message):
        return "The data provider denied access to this request (HTTP 403)."
    if any(term in lower for term in ("credential", "api key", "unauthorized", "forbidden")) or re.search(r"\bhttp(?: status)?[ :]+40[13]\b", lower):
        return "The provider refused this request or requires credentials."
    if "permissionerror" in lower or "access is denied" in lower:
        return "The OpenBB provider could not access its local data or cache directory."
    if any(term in lower for term in ("timeout", "timed out", "connection", "connect", "resolve", "dns")):
        return "OpenBB could not connect to the upstream data provider."
    return "OpenBB returned a data provider error."


class ResearchAPI:
    def __init__(self, process, *, cboe_disk_cache=True):
        self.process = process
        self.cboe_disk_cache = cboe_disk_cache
        self.cache = OrderedDict()
        self.cache_lock = threading.Lock()
        self.fallback_until = 0.0
        self.providers = {}
        for route, defaults in PROVIDERS.items():
            setting = "OPTIONS_TERMINAL_" + route.upper().replace("-", "_")
            chosen = os.environ.get(setting)
            candidates = chosen.split(",") if chosen else defaults
            commands = []
            for candidate in candidates:
                command, _, provider = candidate.strip().partition(":")
                commands.append((command, provider))
            self.providers[route] = commands
            if not all(COMMAND.fullmatch(command) and (not provider or re.fullmatch(r"[a-z][a-z0-9_]*", provider))
                       for command, provider in self.providers[route]):
                raise ValueError(f"Invalid OpenBB command in {setting}.")

    def run_provider_helper(self, script_name, arguments):
        env = self.process.env
        script = Path(__file__).with_name(script_name)
        cli = shutil.which(self.process.cli)
        if not script.is_file() or not cli:
            return None
        cli_path = Path(cli).resolve()
        # The Python that owns the CLI: Scripts\python.exe in a virtual environment, or the
        # install folder above Scripts\ for a regular Windows install.
        if os.name == "nt":
            neighbors = (cli_path.parent / "python.exe", cli_path.parent.parent / "python.exe")
        else:
            neighbors = (cli_path.parent / "python",)
        neighbor = next((path for path in neighbors if path.is_file()), None)
        interpreter = env.get("OPTIONS_TERMINAL_OPENBB_PYTHON") or (str(neighbor) if neighbor else sys.executable)
        command = [interpreter, "-B", str(script), *arguments]
        try:
            process = subprocess.run(command, env=env, capture_output=True, encoding="utf-8", errors="replace",
                                     timeout=self.process.timeout, check=False, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            for line in reversed(process.stdout.splitlines()):
                if line.startswith("{"):
                    response = json.loads(line)
                    if isinstance(response, dict) and isinstance(response.get("ok"), bool):
                        return response
        except (OSError, subprocess.TimeoutExpired, ValueError):
            pass
        return None

    def recover_cboe_chain(self, symbol):
        """Isolated parser compatibility path for the locally installed Cboe provider."""
        if any(self.process.env.get(key) for key in ("OPENBB_SERVER_URL", "OPENBB_SPEC_PATH", "OPENBB_CLI_CONFIG")):
            return None
        arguments = ["--symbol", symbol]
        if not self.cboe_disk_cache:
            arguments.append("--no-disk-cache")
        response = self.run_provider_helper("cboe_chain_compat.py", arguments)
        if response and response.get("ok") is True and isinstance(response.get("result"), dict):
            return response
        return None

    def fetch_yfinance(self, route, params):
        """Use the existing Yahoo library when local default providers fail."""
        if route not in {"quote", "history", "chain"}:
            return None
        override = "OPTIONS_TERMINAL_" + route.upper()
        if os.environ.get(override) or any(self.process.env.get(key) for key in (
            "OPENBB_SERVER_URL", "OPENBB_SPEC_PATH", "OPENBB_CLI_CONFIG",
        )):
            return None
        arguments = ["--route", route, "--symbol", params["symbol"]]
        if route == "history":
            arguments.extend(["--start-date", params["start_date"], "--end-date", params["end_date"]])
        if route == "chain" and params.get("expiration"):
            arguments.extend(["--expiration", params["expiration"]])
        response = self.run_provider_helper("yfinance_compat.py", arguments)
        if not response or response.get("ok") is not True:
            return None
        declared = response.get("result")
        if not isinstance(declared, dict):
            return None
        rows = result_rows(declared.get("results"))
        if route == "chain" and params.get("expiration"):
            rows = [row for row in rows if row.get("expiration") == params["expiration"]]
        if not rows:
            return None
        meta = (declared.get("extra") or {}).get("results_metadata") or {}
        warnings = [
            {"category": "UserWarning", "message": "Used Yahoo Finance because the default OpenBB providers did not return data."},
            *(declared.get("warnings") or []),
        ]
        method = {"quote": "history", "history": "history", "chain": "option_chain"}[route]
        return envelope(True, data=rows, provider="Yahoo Finance", command=f"yfinance.Ticker.{method}",
                        as_of=data_as_of(route, rows, meta), meta=meta, warnings=warnings,
                        delayed=True if route in {"quote", "chain"} else None)

    def get(self, route, supplied):
        if route == "status":
            catalog, engine = pattern_catalog()
            return envelope(True, data={"backend": "OpenBB CLI", "mode": "live", "routes": [*self.providers, *ALIASES, "patterns"],
                                         "connected": shutil.which(self.process.cli) is not None,
                                         "pattern_catalog": catalog, "pattern_engine": engine})
        if route == "patterns":
            return self.get_patterns(supplied)
        route = ALIASES.get(route, route)
        if route not in self.providers:
            return envelope(False, error="Unknown data endpoint.")
        try:
            params = route_inputs(route, supplied)
        except ValueError as exc:
            return envelope(False, error=str(exc))
        cache_key = (route, tuple(sorted(params.items())))
        timestamp = time.monotonic()
        with self.cache_lock:
            cached = self.cache.get(cache_key)
            if cached and cached[0] > timestamp and choice(supplied, "refresh") != "1":
                self.cache.move_to_end(cache_key)
                return cached[1]
        result = self.fetch(route, params)
        ttl = 45 if route in {"quote", "chain"} else 300
        if not result["ok"]:
            ttl = 10
        with self.cache_lock:
            self.cache[cache_key] = (time.monotonic() + ttl, result)
            self.cache.move_to_end(cache_key)
            while len(self.cache) > 100:
                self.cache.popitem(last=False)
        return result

    def get_patterns(self, supplied):
        try:
            requested = route_inputs("history", supplied)
            if len(supplied.get("detectors", ())) > 1:
                raise ValueError("Supply one comma-separated list of candlestick detectors.")
            detectors = parse_detectors(choice(supplied, "detectors") if "detectors" in supplied else None)
        except ValueError as exc:
            return envelope(False, error=str(exc))
        now = datetime.now(timezone.utc)
        start = date.fromisoformat(requested["start_date"])
        end = min(date.fromisoformat(requested["end_date"]), completed_through(now))
        if end < start:
            matches, meta = analyse_patterns([], start=start, end=end, now=now, detectors=detectors)
            return envelope(True, data=matches, meta=meta)

        # Retrieve warm-up bars without expanding the chart's visible range.
        # Keep the adjusted query inside the history route's ten-year limit.
        warmup = date.fromordinal(max(1, start.toordinal() - 45, end.toordinal() - 3660))
        history = self.get("history", {
            "symbol": [requested["symbol"]],
            "start_date": [warmup.isoformat()],
            "end_date": [end.isoformat()],
            "refresh": [choice(supplied, "refresh")],
        })
        if not history["ok"]:
            return history
        matches, meta = analyse_patterns(history["data"], start=start, end=end, now=now,
                                         fetched_at=history["fetchedAt"], detectors=detectors)
        meta["history_fetched_at"] = history["fetchedAt"]
        return envelope(True, data=matches, provider=history["provider"], command=history["command"],
                        as_of=meta["latest_bar"], meta=meta, warnings=history["warnings"], delayed=history["delayed"])

    def fetch(self, route, params):
        # Each Yahoo attempt is a subprocess that can run until the provider timeout.
        yahoo_tried = False
        if time.monotonic() < self.fallback_until:
            yahoo_tried = True
            fallback = self.fetch_yfinance(route, params)
            if fallback is not None:
                return fallback
        errors = []
        last_provider = None
        for command, provider in self.providers[route]:
            last_provider = provider or None
            arguments = dict(params)
            if provider:
                arguments["provider"] = provider
            if provider == "cboe" and not self.cboe_disk_cache:
                arguments["use_cache"] = False
            if route == "earnings-calendar":
                arguments.pop("symbol", None)
            if route == "chain" and provider == "cboe":
                arguments.pop("expiration", None)
            if route == "search":
                if provider in {"nasdaq", "cboe", "sec"}:
                    arguments["query"] = re.escape(arguments["query"])
                variants = [{**arguments, "is_etf": False}, {**arguments, "is_etf": True}] if provider == "nasdaq" else [arguments]
                if provider == "cboe" and SYMBOL.fullmatch(params["query"].upper()):
                    variants.append({**arguments, "is_symbol": True})
            else:
                variants = [arguments]
            try:
                if len(variants) > 1:
                    with ThreadPoolExecutor(max_workers=len(variants)) as pool:
                        responses = list(pool.map(partial(self.process.request, command), variants))
                else:
                    responses = [self.process.request(command, arguments)]
            except OpenBBError as exc:
                errors.append(str(exc))
                break
            rows = []
            declared = {}
            succeeded = False
            for response in responses:
                if not response.get("ok"):
                    error = response.get("error") or {}
                    message = str(error.get("message", ""))
                    signature = message.lower()
                    recovery = self.recover_cboe_chain(params["symbol"]) if (route == "chain" and provider == "cboe"
                        and command == "cboe.options.chains" and "validation" in signature and "expiration" in signature and "dte" in signature) else None
                    if recovery is None:
                        errors.append(provider_error(str(error.get("type", "")), message))
                        continue
                    response = recovery
                succeeded = True
                raw = response.get("result") or {}
                if isinstance(raw, dict):
                    declared = raw
                    rows.extend(result_rows(raw.get("results", raw)))
                elif isinstance(raw, list):
                    rows.extend(result_rows(raw))
            if not succeeded:
                continue
            if not rows and route != "earnings-calendar":
                errors.append("The provider returned no coverage for this request.")
                continue
            if route == "search":
                query = params["query"].casefold()
                ranked = sorted(rows, key=lambda row: (
                    str(row.get("symbol", "")).casefold() != query,
                    not str(row.get("symbol", "")).casefold().startswith(query),
                    not str(row.get("name", "")).casefold().startswith(query),
                    len(str(row.get("symbol", ""))),
                    str(row.get("symbol", "")),
                ))
                deduplicated = {}
                for row in ranked:
                    if row.get("symbol"):
                        is_etf = str(row.get("etf", "")).upper() == "Y" or " ETF " in f" {str(row.get('name','')).upper()} "
                        row.setdefault("type", "ETF" if is_etf else row.get("security_type"))
                        deduplicated.setdefault(row["symbol"], row)
                rows = list(deduplicated.values())[:25]
            if route == "chain" and params.get("expiration"):
                rows = [row for row in rows if row.get("expiration") == params["expiration"]]
            if route == "earnings-calendar" and params.get("symbol"):
                rows = [row for row in rows if str(row.get("symbol", "")).upper() == params["symbol"]]
            meta = (declared.get("extra") or {}).get("results_metadata") or {}
            actual_provider = declared.get("provider") or provider or "OpenBB"
            if actual_provider == "cboe" and route in {"quote", "chain"}:
                timestamp_key = "last_timestamp" if route == "quote" else "last_trade_time"
                for row in rows:
                    if row.get(timestamp_key):
                        row[timestamp_key] = cboe_trade_time(row[timestamp_key])
                if meta.get("last_trade_timestamp"):
                    meta["last_trade_timestamp"] = cboe_trade_time(meta["last_trade_timestamp"])
            delayed = (route == "quote" and actual_provider == "cboe"
                       or route == "chain" and actual_provider in {"cboe", "nasdaq"})
            return envelope(True, data=rows, provider=actual_provider, command=command,
                            as_of=data_as_of(route, rows, meta), meta=meta,
                            warnings=declared.get("warnings"), delayed=True if delayed else None)
        fallback = None if yahoo_tried else self.fetch_yfinance(route, params)
        if fallback is not None:
            self.fallback_until = time.monotonic() + 300
            return fallback
        message = " ".join(dict.fromkeys(errors)) or "No provider returned data."
        return envelope(False, provider=last_provider, data=[], error=message)


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript", ".svg": "image/svg+xml"}

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # Browsers can cancel pending requests when changing symbols or views.
            self.close_connection = True

    def check_host(self):
        host = self.headers.get("Host", "").lower()
        port = self.server.server_port
        if host not in {f"127.0.0.1:{port}", f"localhost:{port}"}:
            self.send_error(HTTPStatus.FORBIDDEN)
            return None
        return host

    def api_origin_allowed(self, host):
        origin = self.headers.get("Origin")
        if origin is None:
            return self.headers.get("Sec-Fetch-Site") in {None, "none", "same-origin"}
        return origin == f"http://{host}" or origin in self.server.cors_origins

    def cors_headers(self):
        origin = self.headers.get("Origin")
        if origin in self.server.cors_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def do_OPTIONS(self):
        host = self.check_host()
        if host is None:
            return
        if self.headers.get("Origin") not in self.server.cors_origins:
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        if not urlsplit(self.path).path.startswith("/api/"):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        headers = self.headers.get("Access-Control-Request-Headers", "")
        requested_headers = {name.strip().lower() for name in headers.split(",") if name.strip()}
        if self.headers.get("Access-Control-Request-Method") != "GET" or requested_headers - {"accept"}:
            self.send_error(HTTPStatus.BAD_REQUEST)
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self.cors_headers()
        self.send_header("Access-Control-Allow-Methods", "GET")
        if requested_headers:
            self.send_header("Access-Control-Allow-Headers", "Accept")
        if self.headers.get("Access-Control-Request-Private-Network") == "true":
            # Chromium's Private Network Access preflight; only reached for the allowed origin.
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_GET(self):
        host = self.check_host()
        if host is None:
            return
        parsed = urlsplit(self.path)
        if parsed.path.startswith("/api/"):
            if not self.api_origin_allowed(host):
                self.send_error(HTTPStatus.FORBIDDEN)
                return
            route = parsed.path.removeprefix("/api/").strip("/")
            try:
                params = parse_qs(parsed.query, max_num_fields=12, keep_blank_values=route == "patterns")
                response = self.server.api.get(route, params)
            except ValueError:
                response = envelope(False, error="Invalid request parameters.")
            self.json_response(response)
        else:
            super().do_GET()

    def list_directory(self, path):
        self.send_error(HTTPStatus.NOT_FOUND)
        return None

    def json_response(self, response):
        encoded = json.dumps(strict_numbers(response), ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.cors_headers()
        self.end_headers()
        self.wfile.write(encoded)


def parse_origins(value):
    """Comma-separated hosted origins -> exact scheme://host[:port] strings. Paths are not allowed."""
    origins = set()
    for item in (value or "").split(","):
        item = item.strip().rstrip("/")
        if not item:
            continue
        parts = urlsplit(item)
        if parts.scheme not in {"https", "http"} or not parts.netloc or parts.path or parts.query or parts.fragment:
            raise SystemExit(f"--cors-origin: {item!r} must be an origin such as https://name.github.io (no path).")
        origins.add(f"{parts.scheme}://{parts.netloc.lower()}")
    return frozenset(origins)


class TerminalServer(ThreadingHTTPServer):
    allow_reuse_address = os.name != "nt"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765, help="Port to listen on; 0 picks a free port.")
    parser.add_argument("--fallback-port", action="store_true", help="Use a free port if --port is unavailable.")
    parser.add_argument("--static", type=Path, default=Path(__file__).resolve().parent / "dist")
    parser.add_argument("--cli", default=os.environ.get("OPTIONS_TERMINAL_CLI", "openbb"))
    parser.add_argument("--timeout", type=float, default=45)
    parser.add_argument("--cors-origin", default="", help="Hosted origin(s) allowed to call /api, comma-separated, e.g. https://name.github.io.")
    parser.add_argument("--openbb-runtime", type=Path, help="Use a workspace OpenBB namespace created for a read-only installation.")
    parser.add_argument("--no-cboe-disk-cache", action="store_true", help="Keep Cboe's provider cache in memory through this service.")
    parser.add_argument("--open-browser", action="store_true", help="Open Strikebook in the default browser after startup.")
    arguments = parser.parse_args()
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    if arguments.openbb_runtime:
        runtime = str(arguments.openbb_runtime.resolve())
        env["PYTHONPATH"] = runtime + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    process = OpenBBProcess(arguments.cli, env, arguments.timeout)
    handler = partial(Handler, directory=arguments.static)
    try:
        server = TerminalServer(("127.0.0.1", arguments.port), handler)
    except OSError as error:
        # Port in use, or reserved by Windows (WinError 10013). The hosted page's
        # "Connect this PC" only checks 8765, so fall back only when asked to.
        if not arguments.fallback_port or arguments.port == 0:
            raise
        print(f"Port {arguments.port} is unavailable ({error.strerror or error}); using a free port instead.", flush=True)
        server = TerminalServer(("127.0.0.1", 0), handler)
    with server:
        server.api = ResearchAPI(process, cboe_disk_cache=not (arguments.openbb_runtime or arguments.no_cboe_disk_cache))
        server.cors_origins = parse_origins(arguments.cors_origin)
        url = f"http://127.0.0.1:{server.server_port}/"
        print(f"Strikebook · {url}", flush=True)
        if arguments.open_browser:
            threading.Thread(target=webbrowser.open, args=(url,), daemon=True).start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            process.close()


if __name__ == "__main__":
    main()

"""Recover Cboe chains that OpenBB's 2.x contract-symbol parser cannot validate."""

from __future__ import annotations

import argparse
import asyncio
import json
import re
from datetime import date
from importlib.metadata import version


# The suffix has a fixed width even when the root has digits or OSI padding.
OSI_CONTRACT = re.compile(
    r"(?P<root>[A-Z0-9._/\- ]{1,16}?)(?P<day>[0-9]{6})"
    r"(?P<side>[CP])(?P<strike>[0-9]{8})\Z",
    re.ASCII,
)


def parse_contract(symbol):
    if not isinstance(symbol, str):
        return None
    match = OSI_CONTRACT.fullmatch(symbol.strip())
    if not match:
        return None
    root = match["root"].strip()
    day = match["day"]
    strike = int(match["strike"])
    if not re.search(r"[A-Z]", root) or strike <= 0:
        return None
    try:
        expiry = date(2000 + int(day[:2]), int(day[2:4]), int(day[4:]))
    except ValueError:
        return None
    return root, day, expiry.isoformat(), match["side"], strike


def alpha_alias(number):
    """Create a unique alphabetic root for OpenBB's legacy parser."""
    chars = []
    while number:
        number, remainder = divmod(number - 1, 26)
        chars.append(chr(ord("A") + remainder))
    return "ZZ" + "".join(reversed(chars))


def plain_root(root):
    return re.sub(r"[^A-Z0-9]", "", root.upper())


def possible_adjustment(root, underlying):
    base = plain_root(underlying)
    contract = plain_root(root)
    # An alternate numeric root can encode a FLEX series or adjusted terms.
    # The root alone does not establish the exercise style or deliverable.
    return bool(base and contract != base and any(char.isdigit() for char in contract))


def recover_payload(fetcher, query, payload):
    """Let the original OpenBB transform and model validate the complete rows."""
    body = payload.get("data") if isinstance(payload, dict) else None
    options = body.get("options") if isinstance(body, dict) else None
    if not isinstance(options, list) or not options:
        raise ValueError("The Cboe provider returned no option contracts.")

    identities = {}
    compatible = []
    for index, item in enumerate(options, 1):
        original = item.get("option") if isinstance(item, dict) else None
        parsed = parse_contract(original)
        if parsed is None:
            continue
        root, day, expiry, side, strike = parsed
        alias = f"{alpha_alias(index)}{day}{side}{strike:08}"
        identities[alias] = (original, root, expiry, side, strike, item.get("contract_size"))
        compatible.append({**item, "option": alias})

    if not compatible:
        raise ValueError("The Cboe provider returned no valid OSI contract identifiers.")

    transformed = fetcher.transform_data(query, {**payload, "data": {**body, "options": compatible}})
    rows = transformed.result.model_dump(mode="json")
    if len(rows) != len(compatible):
        raise ValueError("OpenBB did not validate every recovered contract.")

    base_symbol = query.symbol.removeprefix("^")
    adjusted_rows = 0
    for row in rows:
        original, root, expiry, side, strike, contract_size = identities.pop(row["contract_symbol"])
        expected_side = "call" if side == "C" else "put"
        if (row["expiration"] != expiry or row["option_type"] != expected_side
                or abs(row["strike"] - strike / 1000) > 1e-9):
            raise ValueError("An OpenBB row disagrees with the source contract identifier.")
        adjusted = possible_adjustment(root, base_symbol)
        adjusted_rows += adjusted
        row.update(contract_symbol=original, contract_root=root,
                   underlying_symbol=base_symbol, adjusted=adjusted)
        if isinstance(contract_size, (int, float)) and not isinstance(contract_size, bool) and contract_size > 0:
            row["contract_size"] = contract_size

    skipped = len(options) - len(rows)
    metadata = dict(transformed.metadata or {})
    metadata.update(chain_parser="OpenBB Cboe with OSI contract recovery",
                    contract_rows_received=len(options), contract_rows_skipped=skipped,
                    possible_adjusted_contract_rows=adjusted_rows)
    warnings = []
    if skipped:
        warnings.append({"category": "UserWarning", "message": (
            f"Skipped {skipped} of {len(options)} Cboe records because their contract identifier could not be parsed."
        )})
    if adjusted_rows:
        warnings.append({"category": "UserWarning", "message": (
            f"{adjusted_rows} records have alternate numeric roots that may indicate nonstandard terms. "
            "Verify the exercise style and deliverable before modeling these contracts."
        )})
    return {"results": rows, "provider": "cboe", "warnings": warnings,
            "extra": {"results_metadata": metadata}}


async def request_chain(symbol, use_cache):
    if version("openbb-cboe").split(".", 1)[0] != "2":
        raise RuntimeError("Cboe recovery requires an installed OpenBB Cboe 2.x provider.")
    from openbb_cboe.models.options_chains import CboeOptionsChainsFetcher
    from openbb_core.app.config import load_layered_config

    load_layered_config()
    fetcher = CboeOptionsChainsFetcher
    query = fetcher.transform_query({"symbol": symbol, "use_cache": use_cache})
    payload = await fetcher.aextract_data(query, credentials={})
    return recover_payload(fetcher, query, payload)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--no-disk-cache", action="store_true")
    args = parser.parse_args()
    try:
        result = asyncio.run(request_chain(args.symbol, not args.no_disk_cache))
        response = json.dumps({"ok": True, "result": result}, allow_nan=False)
    except Exception as error:
        print(json.dumps({"ok": False, "error": {"type": type(error).__name__,
                                                 "message": "OpenBB could not recover the Cboe chain."}}))
        return 1
    print(response)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

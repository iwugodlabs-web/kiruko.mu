"""Foreign-exchange snapshot service for shadow payroll (Phase 2).

Sources FX reference rates at run creation so a finalized run's host-country
shadow figures are deterministic and auditable. The chosen source is the Bank
of Mauritius **Consolidated Indicative Exchange Rates** (the central bank's
published daily reference rates), consumed from its RSS feed:

    https://www.bom.mu/markets/foreign-exchange/consolidated-indicative-exchange-rates/rss

Rate convention used throughout this module:

    rate = how many BASE units equal ONE unit of QUOTE

So a MUR-base rate of "TZS 1 = 0.05 MUR" is stored as ``rate = 0.05``.
Converting an amount::

    host_amount  = base_amount / rate   (base -> host)
    base_amount  = host_amount * rate     (host -> base)

BOM only publishes rates against the Mauritian Rupee, so when the run's base
currency is not MUR a direct central-bank rate is unavailable (callers decide
how to degrade). Fetching is best-effort: any failure returns ``None`` and the
run simply records an ``fx_unavailable`` flag rather than aborting payroll.
"""
from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal
from typing import Dict, Optional

logger = logging.getLogger(__name__)

BOM_RSS_URL = "https://www.bom.mu/markets/foreign-exchange/consolidated-indicative-exchange-rates/rss"

# Columns in the BOM consolidated-indicative table. We conservatively use the
# TT ("Telegraphic Transfer" — electronic) buying rate for amount conversion.
_RATE_COLUMN = "T.T"

# BOM publishes some quotes per 100 units (e.g. JPY) rather than per 1 unit.
# Any code listed here is divided out before storing as rate-per-1-unit.
_PER_100 = frozenset({"JPY"})


def _fetch_bom_table() -> Optional[list[dict]]:
    """Fetch + parse the BOM consolidated-indicative table to [{code, rate, date}]."""
    try:
        import xml.etree.ElementTree as ET

        import requests

        resp = requests.get(BOM_RSS_URL, timeout=15)
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
        rows: list[dict] = []
        for item in root.iter("item"):
            desc = item.find("description")
            if desc is None or not desc.text:
                continue
            # The description block is an HTML <table>. Pull the trailing
            # 'Date :' and any Currency-code rows with a T.T numeric.
            text = desc.text
            as_of = _extract_feed_date(text)
            for row in _parse_rows(text):
                rows.append({**row, "feed_date": as_of})
        return rows
    except Exception as exc:  # noqa: BLE001 — best-effort provider
        logger.warning("fx_service: BOM fetch failed (%s)", exc)
        return None


def _extract_feed_date(text: str) -> Optional[date]:
    import re

    m = re.search(r"Date\s*:\s*([\d.-]+)", text)
    if not m:
        return None
    raw = m.group(1)
    for fmt in ("%d-%m-%Y", "%d.%m.%Y", "%Y-%m-%d"):
        try:
            return date.strptime(raw, fmt)
        except ValueError:
            continue
    return None


def _parse_rows(text: str) -> list[dict]:
    """Very small table parser for the BOM HTML 'item.description'.

    We only need the currency-code column and the T.T (electronic) buying rate,
    so we never depend on the surrounding prose. Format per line:

        CODE 1 | 32.9237 | 32.6137 | 32.6566 | 34.5825 | 34.7481 | date
    """
    import re

    out: list[dict] = []
    for line in text.splitlines():
        cells = [c.strip() for c in line.replace("|", "\t").split("\t") if c.strip()]
        if len(cells) < 4:
            continue
        # A real row starts with an ISO-ish currency code and a per-unit '1'.
        code = cells[0].strip().split()[0]
        if not re.fullmatch(r"[A-Z]{3}", code):
            continue
        # walk for the first parseable decimal after the unit marker column
        rate = None
        numeric = []
        for cell in cells[1:]:
            try:
                numeric.append(Decimal(cell))
            except Exception:  # noqa: BLE001
                continue
        if numeric:
            rate = numeric[0]
            scale = 100 if code in _PER_100 else 1
            if scale == 100:
                rate = rate / Decimal("100")
        if rate is not None and rate > 0:
            out.append({"code": code, "rate": rate})
    return out


def fetch_bom_rate(base_currency: str, quote_currency: str, as_of: Optional[date] = None) -> Optional[Decimal]:
    """Return ``base_currency`` units per 1 ``quote_currency`` unit via BOM's
    consolidated indicative rates, or None if unavailable.

    BOM publishes rates only against MUR, so any other base returns None.
    ``as_of`` is advisory (we return the latest published — BOM keeps the
    current feed, not historical) and is used for audits only.
    """
    if base_currency.upper() != "MUR":
        return None
    table = _fetch_bom_table()
    if not table:
        return None
    quote = quote_currency.upper()
    for row in table:
        if row.get("code") == quote:
            return row["rate"]
    return None


def same_currency(base_currency: str, quote_currency: str) -> bool:
    return base_currency.upper() == quote_currency.upper()


def build_run_fx_snapshot(
    base_currency: str,
    host_currencies: Dict[str, str],  # country_code -> currency (ISO)
    as_of: Optional[date] = None,
    fetch: Optional[callable] = None,
) -> Dict:
    """Build the per-run FX snapshot dict.

    ``host_currencies`` maps a host country code -> its currency. Rates are for
    ``base_currency`` per 1 unit of each *distinct* host currency. Same-currency
    hosts get an exact rate of 1. Hosts with no public rate are omitted from
    ``rates`` (the caller flags them) so a missing rate never fabricates a value.

    ``fetch`` is injectable for tests/references (defaults to ``fetch_bom_rate``).
    """
    fetch = fetch or fetch_bom_rate
    base = base_currency.upper()
    rates: Dict[str, str] = {}
    unavailable: list[str] = []
    for code, cur in host_currencies.items():
        if not cur:
            unavailable.append(code)
            continue
        cur = cur.upper()
        if same_currency(base, cur):
            rates[code] = str(Decimal("1"))
            continue
        rate = fetch(base, cur, as_of)
        if rate is None:
            unavailable.append(code)
        else:
            rates[code] = str(rate)
    snapshot = {
        "source": "BOM",
        "as_of": as_of.isoformat() if as_of else None,
        "base": base,
        "rates": rates,
    }
    if unavailable:
        snapshot["unavailable"] = unavailable
    return snapshot


def rate_for(snapshot: Optional[Dict], host_country_code: str) -> Optional[Decimal]:
    """Return the base-per-host rate for a country from a snapshot (None if
    absent or unbundled). Same as 1.00 when the host == base currency."""
    if not snapshot or "rates" not in snapshot:
        return None
    raw = snapshot["rates"].get(host_country_code)
    if raw is None:
        return None
    try:
        v = Decimal(str(raw))
        return v
    except Exception:  # noqa: BLE001
        return None
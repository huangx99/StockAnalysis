"""Yahoo Finance data source implementation."""

from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any

import httpx
import pandas as pd

from ..base import DataCapability, DataSource, SourceResult

logger = logging.getLogger(__name__)


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value or default)
    except (TypeError, ValueError):
        return default


def _yahoo_symbol(symbol: str) -> str:
    return f"{symbol}.SS" if symbol.startswith("6") else f"{symbol}.SZ"


def _with_moving_averages(rows: list[dict]) -> list[dict]:
    rows = sorted(rows, key=lambda row: row.get("date") or "")
    closes = [_safe_float(row.get("close")) for row in rows]
    for idx, row in enumerate(rows):
        for window in (5, 10, 20, 60):
            key = f"ma{window}"
            if idx < window - 1:
                row[key] = None
            else:
                row[key] = round(sum(closes[idx - window + 1: idx + 1]) / window, 2)
    return rows


def _pct_change(current: float, previous: float) -> float:
    return round((current - previous) / previous * 100, 2) if previous > 0 else 0.0


def fetch_yahoo_daily_kline(symbol: str) -> list[dict]:
    """Fetch daily K-line data from Yahoo Finance."""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{_yahoo_symbol(symbol)}"
    params = {
        "period1": "0",
        "period2": str(int(time.time()) + 86400),
        "interval": "1d",
        "events": "history",
        "includeAdjustedClose": "true",
    }
    with httpx.Client(headers={"User-Agent": "Mozilla/5.0"}, timeout=20.0, follow_redirects=True) as client:
        response = client.get(url, params=params)
        response.raise_for_status()
        payload = response.json()

    results = (payload.get("chart") or {}).get("result") or []
    if not results:
        return []

    result = results[0]
    timestamps = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []

    rows: list[dict] = []
    for idx, timestamp in enumerate(timestamps):
        values = [
            opens[idx] if idx < len(opens) else None,
            highs[idx] if idx < len(highs) else None,
            lows[idx] if idx < len(lows) else None,
            closes[idx] if idx < len(closes) else None,
            volumes[idx] if idx < len(volumes) else None,
        ]
        if any(value is None for value in values):
            continue
        rows.append({
            "date": datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d"),
            "open": round(_safe_float(values[0]), 2),
            "high": round(_safe_float(values[1]), 2),
            "low": round(_safe_float(values[2]), 2),
            "close": round(_safe_float(values[3]), 2),
            "volume": round(_safe_float(values[4]) / 100, 2),
            "ma5": None,
            "ma10": None,
            "ma20": None,
            "ma60": None,
        })
    return _with_moving_averages(rows)


def _aggregate_kline_rows(rows: list[dict], period: str) -> list[dict]:
    """Aggregate daily K-line rows into weekly or monthly."""
    if period == "day":
        return [dict(row) for row in rows]

    grouped: dict[tuple, list[dict]] = {}
    for row in rows:
        try:
            row_date = datetime.strptime(str(row.get("date")), "%Y-%m-%d")
        except ValueError:
            continue
        key = row_date.isocalendar()[:2] if period == "week" else (row_date.year, row_date.month)
        grouped.setdefault(key, []).append(row)

    aggregated: list[dict] = []
    for group_rows in grouped.values():
        group_rows = sorted(group_rows, key=lambda row: row.get("date") or "")
        aggregated.append({
            "date": group_rows[-1]["date"],
            "open": group_rows[0]["open"],
            "high": max(_safe_float(row.get("high")) for row in group_rows),
            "low": min(_safe_float(row.get("low")) for row in group_rows),
            "close": group_rows[-1]["close"],
            "volume": round(sum(_safe_float(row.get("volume")) for row in group_rows), 2),
            "ma5": None,
            "ma10": None,
            "ma20": None,
            "ma60": None,
        })
    return _with_moving_averages(aggregated)


def fetch_yahoo_profile_fields(symbol: str) -> dict | None:
    """Fetch latest profile fields derived from Yahoo Finance kline data."""
    rows = fetch_yahoo_daily_kline(symbol)
    if len(rows) < 2:
        return None

    latest = rows[-1]
    previous = rows[-2]
    latest_date = str(latest.get("date") or "")
    current_price = _safe_float(latest.get("close"))
    previous_close = _safe_float(previous.get("close"))
    if not latest_date or current_price <= 0 or previous_close <= 0:
        return None

    change60d = 0.0
    if len(rows) > 60:
        change60d = _pct_change(current_price, _safe_float(rows[-61].get("close")))

    change_ytd = 0.0
    current_year = latest_date[:4]
    prior_year_rows = [row for row in rows if str(row.get("date") or "")[:4] < current_year]
    if prior_year_rows:
        change_ytd = _pct_change(current_price, _safe_float(prior_year_rows[-1].get("close")))

    turnover_amount = round(
        _safe_float(latest.get("volume")) * 100 * ((_safe_float(latest.get("open")) + current_price) / 2),
        2,
    )

    return {
        "currentPrice": current_price,
        "change": round(current_price - previous_close, 2),
        "changePercent": _pct_change(current_price, previous_close),
        "volume": _safe_float(latest.get("volume")),
        "updateTime": f"{latest_date} 15:00:00",
        "open": _safe_float(latest.get("open")),
        "high": _safe_float(latest.get("high")),
        "low": _safe_float(latest.get("low")),
        "previousClose": previous_close,
        "amplitude": round(
            (_safe_float(latest.get("high")) - _safe_float(latest.get("low"))) / previous_close * 100, 2
        ),
        "turnoverAmount": turnover_amount,
        "change60d": change60d,
        "changeYtd": change_ytd,
    }


class YahooSource(DataSource):
    """Yahoo Finance data source - fallback for K-line and profile data."""

    name = "yahoo"
    priority = 50
    capabilities = {
        DataCapability.HISTORICAL_KLINE,
        DataCapability.SPOT_QUOTE,
    }

    async def do_fetch(self, capability: DataCapability, **kwargs: Any) -> SourceResult:
        match capability:
            case DataCapability.HISTORICAL_KLINE:
                symbol = kwargs["symbol"]
                period = kwargs.get("period", "day")
                daily_rows = await self._run_in_pool(fetch_yahoo_daily_kline, symbol)
                if not daily_rows:
                    return SourceResult(
                        data=None,
                        source_name=self.name,
                        error=f"Yahoo returned empty kline for {symbol}",
                    )
                rows = _aggregate_kline_rows(daily_rows, period)
                df = pd.DataFrame(rows) if rows else None
                return SourceResult(data=df, source_name=self.name)

            case DataCapability.SPOT_QUOTE:
                symbol = kwargs["symbol"]
                fields = await self._run_in_pool(fetch_yahoo_profile_fields, symbol)
                if fields is None:
                    return SourceResult(
                        data=None,
                        source_name=self.name,
                        error=f"Yahoo returned empty profile for {symbol}",
                    )
                return SourceResult(data=fields, source_name=self.name)

            case _:
                return SourceResult(
                    data=None,
                    source_name=self.name,
                    error=f"Unsupported capability: {capability.value}",
                )

    def _timeout_for(self, capability: DataCapability) -> float:
        return 30.0

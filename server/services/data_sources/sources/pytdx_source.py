"""pytdx (Tongdaxin) data source implementation."""

from __future__ import annotations

from typing import Any

from adapters.pytdx_adapter import fetch_bid_ask_batch, fetch_security_bars
from ..base import DataCapability, DataSource, SourceResult


class PytdxSource(DataSource):
    """pytdx data source - real-time bid/ask and minute kline via Tongdaxin TCP protocol."""

    name = "pytdx"
    priority = 5  # Lower priority for minute kline (faster than AKShare HTTP)
    capabilities = {
        DataCapability.BID_ASK,
        DataCapability.MINUTE_KLINE,
    }

    async def do_fetch(self, capability: DataCapability, **kwargs: Any) -> SourceResult:
        match capability:
            case DataCapability.BID_ASK:
                codes = kwargs.get("codes", [])
                if not codes:
                    symbol = kwargs.get("symbol")
                    if symbol:
                        codes = [symbol]
                    else:
                        return SourceResult(
                            data=None,
                            source_name=self.name,
                            error="No codes provided for bid_ask",
                        )
                result = await self._run_in_pool(fetch_bid_ask_batch, codes)
                return SourceResult(data=result, source_name=self.name)

            case DataCapability.MINUTE_KLINE:
                symbol = kwargs.get("symbol")
                if not symbol:
                    return SourceResult(
                        data=None,
                        source_name=self.name,
                        error="No symbol provided for minute_kline",
                    )
                period = kwargs.get("period", "5min")
                count = kwargs.get("count", 800)
                df = await self._run_in_pool(fetch_security_bars, symbol, period, count)
                if df is None or df.empty:
                    return SourceResult(
                        data=None,
                        source_name=self.name,
                        error=f"pytdx returned empty minute kline for {symbol}",
                    )
                return SourceResult(data=df, source_name=self.name)

            case _:
                return SourceResult(
                    data=None,
                    source_name=self.name,
                    error=f"Unsupported capability: {capability.value}",
                )

    def _timeout_for(self, capability: DataCapability) -> float:
        if capability == DataCapability.MINUTE_KLINE:
            return 20.0
        return 15.0

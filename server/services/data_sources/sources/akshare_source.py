"""AKShare data source implementation."""

from __future__ import annotations

from typing import Any

import pandas as pd

from adapters.akshare_adapter import (
    fetch_all_stocks,
    fetch_bid_ask,
    fetch_board_cons,
    fetch_dividend_data,
    fetch_financial_indicators,
    fetch_financial_report,
    fetch_financial_report_em,
    fetch_limit_up_pool,
    fetch_sector_fund_flow_rank,
    fetch_stock_hist,
    fetch_stock_hist_min,
    fetch_stock_info,
    fetch_stock_news,
    fetch_stock_notices,
    fetch_stock_reports,
)
from ..base import DataCapability, DataSource, SourceResult


class AKShareSource(DataSource):
    """AKShare data source - primary source for A-share market data."""

    name = "akshare"
    priority = 1
    capabilities = {
        DataCapability.SPOT_QUOTE,
        DataCapability.HISTORICAL_KLINE,
        DataCapability.MINUTE_KLINE,
        DataCapability.STOCK_INFO,
        DataCapability.NEWS,
        DataCapability.FINANCIAL_REPORT,
        DataCapability.FINANCIAL_INDICATORS,
        DataCapability.DIVIDEND,
        DataCapability.BID_ASK,
        DataCapability.NOTICES,
        DataCapability.RESEARCH_REPORTS,
        DataCapability.SECTOR_FLOW,
        DataCapability.LIMIT_POOL,
        DataCapability.BOARD_CONS,
    }

    async def do_fetch(self, capability: DataCapability, **kwargs: Any) -> SourceResult:
        match capability:
            case DataCapability.SPOT_QUOTE:
                df = await self._run_in_pool(fetch_all_stocks)
                return SourceResult(data=df, source_name=self.name)

            case DataCapability.HISTORICAL_KLINE:
                df = await self._run_in_pool(
                    fetch_stock_hist,
                    kwargs["symbol"],
                    kwargs.get("period", "daily"),
                    kwargs.get("start_date", ""),
                    kwargs.get("end_date", ""),
                    kwargs.get("adjust", "qfq"),
                )
                return SourceResult(data=df, source_name=self.name)

            case DataCapability.MINUTE_KLINE:
                period = kwargs.get("period", "5min")
                # 将 "5min" 转换为 akshare 需要的 "5"
                ak_period = period.replace("min", "")
                df = await self._run_in_pool(fetch_stock_hist_min, kwargs["symbol"], ak_period)
                return SourceResult(data=df, source_name=self.name)

            case DataCapability.STOCK_INFO:
                df = await self._run_in_pool(fetch_stock_info, kwargs["symbol"])
                return SourceResult(data=df, source_name=self.name)

            case DataCapability.NEWS:
                df = await self._run_in_pool(
                    fetch_stock_news,
                    kwargs["symbol"],
                    kwargs.get("since_time"),
                )
                return SourceResult(data=df, source_name=self.name)

            case DataCapability.FINANCIAL_REPORT:
                report_type = kwargs.get("report_type", "income")
                use_em = kwargs.get("use_em", True)
                if use_em:
                    df = await self._run_in_pool(
                        fetch_financial_report_em,
                        kwargs["symbol"],
                        report_type,
                    )
                else:
                    df = await self._run_in_pool(
                        fetch_financial_report,
                        kwargs["symbol"],
                        report_type,
                    )
                return SourceResult(data=df, source_name=self.name)

            case DataCapability.FINANCIAL_INDICATORS:
                df = await self._run_in_pool(
                    fetch_financial_indicators,
                    kwargs["symbol"],
                    kwargs.get("start_year", "2016"),
                )
                return SourceResult(data=df, source_name=self.name)

            case DataCapability.DIVIDEND:
                df = await self._run_in_pool(fetch_dividend_data, kwargs["symbol"])
                return SourceResult(data=df, source_name=self.name)

            case DataCapability.BID_ASK:
                result = await self._run_in_pool(fetch_bid_ask, kwargs["symbol"])
                return SourceResult(data=result, source_name=self.name)

            case DataCapability.NOTICES:
                df = await self._run_in_pool(
                    fetch_stock_notices,
                    kwargs["symbol"],
                    kwargs.get("start_date"),
                    kwargs.get("end_date"),
                )
                return SourceResult(data=df, source_name=self.name)

            case DataCapability.RESEARCH_REPORTS:
                df = await self._run_in_pool(fetch_stock_reports, kwargs["symbol"])
                return SourceResult(data=df, source_name=self.name)

            case DataCapability.SECTOR_FLOW:
                df = await self._run_in_pool(
                    fetch_sector_fund_flow_rank,
                    kwargs.get("indicator", "今日"),
                )
                return SourceResult(data=df, source_name=self.name)

            case DataCapability.LIMIT_POOL:
                df = await self._run_in_pool(fetch_limit_up_pool, kwargs["date"])
                return SourceResult(data=df, source_name=self.name)

            case DataCapability.BOARD_CONS:
                df = await self._run_in_pool(fetch_board_cons, kwargs["board_name"])
                return SourceResult(data=df, source_name=self.name)

            case _:
                return SourceResult(
                    data=None,
                    source_name=self.name,
                    error=f"Unhandled capability: {capability.value}",
                )

    def _timeout_for(self, capability: DataCapability) -> float:
        timeouts = {
            DataCapability.SPOT_QUOTE: 90.0,
            DataCapability.HISTORICAL_KLINE: 60.0,
            DataCapability.NEWS: 120.0,
            DataCapability.FINANCIAL_REPORT: 60.0,
        }
        return timeouts.get(capability, 60.0)

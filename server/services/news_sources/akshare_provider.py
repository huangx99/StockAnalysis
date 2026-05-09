"""AKShare news provider - wraps existing AKShare news functions."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

from .base import NewsProvider, RawNewsItem

logger = logging.getLogger(__name__)


class AkShareNewsProvider(NewsProvider):
    """AKShare-based news: 财新网 market news + 东方财富 per-stock news."""

    name = "akshare"

    async def fetch_news(self, limit: int = 100) -> list[RawNewsItem]:
        items: list[RawNewsItem] = []

        # Source 1: 财新网 market-wide
        cx_items = await self._fetch_cx_news()
        items.extend(cx_items)

        # Source 2: Per-stock from top active symbols
        stock_items = await self._fetch_active_stock_news(limit)
        items.extend(stock_items)

        return items[:limit]

    async def fetch_stock_news(
        self, symbol: str, limit: int = 20
    ) -> list[RawNewsItem]:
        try:
            loop = asyncio.get_event_loop()

            def _fetch():
                import akshare as ak

                df = ak.stock_news_em(symbol=symbol)
                results = []
                for _, row in df.head(limit).iterrows():
                    pub_time = str(row.get("发布时间", ""))
                    dt = None
                    if pub_time:
                        try:
                            dt = datetime.strptime(pub_time, "%Y-%m-%d %H:%M:%S")
                        except ValueError:
                            pass
                    results.append(
                        RawNewsItem(
                            title=str(row.get("新闻标题", "")),
                            content=str(row.get("新闻内容", "")),
                            source=str(row.get("文章来源", "东方财富")),
                            url=str(row.get("新闻链接", "")),
                            publish_time=dt,
                            tags=[str(row.get("关键词", ""))],
                        )
                    )
                return results

            return await asyncio.wait_for(
                loop.run_in_executor(None, _fetch), timeout=20
            )
        except Exception as e:
            logger.warning("AKShare stock_news_em(%s) failed: %s", symbol, e)
            return []

    async def _fetch_cx_news(self) -> list[RawNewsItem]:
        try:
            loop = asyncio.get_event_loop()

            def _fetch():
                import akshare as ak

                df = ak.stock_news_main_cx()
                results = []
                for _, row in df.iterrows():
                    results.append(
                        RawNewsItem(
                            title=str(row.get("summary", "")),
                            content="",
                            source="财新网",
                            url=str(row.get("url", "")),
                            publish_time=datetime.now(),
                            tags=[str(row.get("tag", ""))] if row.get("tag") else [],
                        )
                    )
                return results

            items = await asyncio.wait_for(
                loop.run_in_executor(None, _fetch), timeout=30
            )
            logger.info("AKShare: fetched %d items from 财新网", len(items))
            return items
        except Exception as e:
            logger.warning("AKShare 财新 fetch failed: %s", e)
            return []

    async def _fetch_active_stock_news(self, limit: int) -> list[RawNewsItem]:
        try:
            from pathlib import Path
            import json

            snapshot = Path(__file__).parent.parent.parent / "data" / "data_stocks_snapshot.json"
            symbols = ["000001", "600519", "000858", "601318", "600036"]
            if snapshot.exists():
                try:
                    data = json.loads(snapshot.read_text(encoding="utf-8"))
                    if isinstance(data, list):
                        symbols = [s.get("symbol", "") for s in data[:15] if s.get("symbol")]
                except Exception:
                    pass

            tasks = [self.fetch_stock_news(sym, 5) for sym in symbols[:15]]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            items: list[RawNewsItem] = []
            for result in results:
                if isinstance(result, list):
                    items.extend(result)
            logger.info("AKShare: fetched %d per-stock items", len(items))
            return items[:limit]
        except Exception as e:
            logger.warning("AKShare per-stock fetch failed: %s", e)
            return []

    def _timeout_for(self, capability: Any) -> float:
        return 120.0

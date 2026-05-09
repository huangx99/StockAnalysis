"""Futures & commodity news provider - 期货/大宗商品/稀土/矿产新闻."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

from .base import NewsProvider, RawNewsItem

logger = logging.getLogger(__name__)

# SHMET symbols: 要闻, VIP, 财经, 铜, 铝, 铅, 锌, 镍, 锡, 贵金属, 小金属(稀土/锂/钴等)
_SHMET_SYMBOLS = ["要闻", "铜", "铝", "锌", "镍", "贵金属", "小金属"]


class FuturesProvider(NewsProvider):
    """Futures & commodity news from AKShare (上海金属网 SHMET) + 我的钢铁网."""

    name = "futures"

    async def fetch_news(self, limit: int = 100) -> list[RawNewsItem]:
        """Fetch commodity/futures news from multiple sub-sources."""
        items: list[RawNewsItem] = []

        # SHMET metals news
        shmet_items = await self._fetch_shmet(limit)
        items.extend(shmet_items)

        # 我的钢铁网
        steel_items = await self._fetch_mysteel(limit)
        items.extend(steel_items)

        return items[:limit]

    async def _fetch_shmet(self, limit: int) -> list[RawNewsItem]:
        """Fetch from 上海金属网 via AKShare."""
        try:
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._fetch_shmet_sync, limit),
                timeout=60,
            )
        except Exception as e:
            logger.warning("SHMET fetch failed: %s", e)
            return []

    def _fetch_shmet_sync(self, limit: int) -> list[RawNewsItem]:
        """Fetch SHMET news for all commodity categories."""
        items: list[RawNewsItem] = []
        try:
            import akshare as ak

            per_symbol = max(limit // len(_SHMET_SYMBOLS), 10)
            for symbol in _SHMET_SYMBOLS:
                try:
                    df = ak.futures_news_shmet(symbol=symbol)
                    if df is None or df.empty:
                        continue

                    count = 0
                    for _, row in df.iterrows():
                        if count >= per_symbol:
                            break
                        content = str(row.get("内容", ""))
                        if not content or len(content) < 10:
                            continue

                        # Extract title from 【】 brackets
                        title = ""
                        import re
                        title_match = re.search(r"【([^】]+)】", content)
                        if title_match:
                            title = title_match.group(1)
                        else:
                            title = content[:80]
                            if len(content) > 80:
                                title += "..."

                        # Parse time
                        pub_time = str(row.get("发布时间", ""))
                        dt = None
                        if pub_time:
                            try:
                                dt = datetime.fromisoformat(pub_time.replace("+08:00", ""))
                            except ValueError:
                                try:
                                    dt = datetime.strptime(pub_time[:19], "%Y-%m-%d %H:%M:%S")
                                except ValueError:
                                    pass

                        # Tag with commodity category
                        tags = [symbol]
                        if symbol == "小金属":
                            # Detect specific metals in content
                            for metal in ["稀土", "锂", "钴", "钼", "钨", "锑", "锗", "镓"]:
                                if metal in content:
                                    tags.append(metal)

                        items.append(
                            RawNewsItem(
                                title=title,
                                content=content,
                                source="上海金属网",
                                url="",
                                publish_time=dt,
                                tags=tags,
                                category="commodity",
                            )
                        )
                        count += 1

                except Exception as e:
                    logger.warning("SHMET %s failed: %s", symbol, e)

            logger.info("SHMET: fetched %d items from %d categories", len(items), len(_SHMET_SYMBOLS))
        except Exception as e:
            logger.warning("SHMET sync error: %s", e)
        return items

    async def _fetch_mysteel(self, limit: int) -> list[RawNewsItem]:
        """Fetch from 我的钢铁网."""
        try:
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._fetch_mysteel_sync, limit),
                timeout=30,
            )
        except Exception as e:
            logger.warning("Mysteel fetch failed: %s", e)
            return []

    def _fetch_mysteel_sync(self, limit: int) -> list[RawNewsItem]:
        """Scrape 我的钢铁网 news."""
        import re
        import requests

        items: list[RawNewsItem] = []
        try:
            r = requests.get(
                "https://news.mysteel.com/",
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=15,
            )
            r.raise_for_status()
            # Fix encoding: server returns ISO-8859-1 but actual encoding is UTF-8
            if r.encoding and r.encoding.lower() in ('iso-8859-1', 'latin-1'):
                r.encoding = r.apparent_encoding or 'utf-8'
            html = r.text

            links = re.findall(
                r'<a[^>]+href="(https?://[^"]*mysteel[^"]+)"[^>]*>([^<]{8,})</a>',
                html,
            )
            for url, title in links[:limit]:
                title = title.strip()
                if not title or len(title) < 8:
                    continue
                items.append(
                    RawNewsItem(
                        title=title,
                        content="",
                        source="我的钢铁网",
                        url=url,
                        publish_time=datetime.now(),
                        tags=["钢铁", "矿产"],
                        category="commodity",
                    )
                )

            logger.info("Mysteel: fetched %d items", len(items))
        except Exception as e:
            logger.warning("Mysteel sync error: %s", e)
        return items

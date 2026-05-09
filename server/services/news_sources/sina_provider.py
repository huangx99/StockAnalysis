"""Sina Finance news provider."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

import httpx

from .base import NewsProvider, RawNewsItem

logger = logging.getLogger(__name__)

_SINA_API_URL = "https://feed.mix.sina.com.cn/api/roll/get"
_SINA_PARAMS = {
    "pageid": "153",
    "lid": "2516",
    "num": "50",
    "page": "1",
}


class SinaProvider(NewsProvider):
    """Sina Finance news via their roll API."""

    name = "sina"

    async def fetch_news(self, limit: int = 100) -> list[RawNewsItem]:
        """Fetch Sina Finance rolling news."""
        all_items: list[RawNewsItem] = []
        pages = max(limit // 50, 1)

        for page in range(1, pages + 1):
            items = await self._fetch_page(page, limit - len(all_items))
            all_items.extend(items)
            if len(items) < 50 or len(all_items) >= limit:
                break

        return all_items[:limit]

    async def _fetch_page(self, page: int, remaining: int) -> list[RawNewsItem]:
        try:
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._fetch_page_sync, page, remaining),
                timeout=20,
            )
        except Exception as e:
            logger.warning("Sina page %d failed: %s", page, e)
            return []

    def _fetch_page_sync(self, page: int, remaining: int) -> list[RawNewsItem]:
        items: list[RawNewsItem] = []
        params = {**_SINA_PARAMS, "page": str(page), "num": str(min(remaining, 50))}

        try:
            with httpx.Client(timeout=15.0, headers={"User-Agent": "Mozilla/5.0"}) as client:
                r = client.get(_SINA_API_URL, params=params)
                r.raise_for_status()
                data = r.json()

            result = data.get("result", {})
            news_list = result.get("data", [])

            for item in news_list:
                title = item.get("title", "").strip()
                if not title or len(title) < 4:
                    continue

                ts = int(item.get("ctime", 0))
                dt = datetime.fromtimestamp(ts) if ts else None

                items.append(
                    RawNewsItem(
                        title=title,
                        content=item.get("intro", "") or item.get("summary", ""),
                        source="新浪财经",
                        url=item.get("url", ""),
                        publish_time=dt,
                        category="finance",
                    )
                )
        except Exception as e:
            logger.warning("Sina fetch error: %s", e)

        return items

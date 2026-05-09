"""EastMoney news provider - global + per-stock via search API."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime
from typing import Any

from .base import NewsProvider, RawNewsItem

logger = logging.getLogger(__name__)

_EASTMONEY_SEARCH_URL = "https://search-api-web.eastmoney.com/search/jsonp"
_HEADERS = {
    "accept": "*/*",
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "en,zh-CN;q=0.9,zh;q=0.8",
    "cache-control": "no-cache",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}

# Hot keywords for global finance news
_GLOBAL_KEYWORDS = [
    "A股", "大盘", "股市", "行情", "涨停", "跌停",
    "央行", "国务院", "证监会", "政策",
    "经济", "GDP", "CPI", "PMI",
]


class EastMoneyProvider(NewsProvider):
    """EastMoney search API for global and per-stock news."""

    name = "eastmoney"

    async def fetch_news(self, limit: int = 100) -> list[RawNewsItem]:
        """Fetch global finance news by searching hot keywords."""
        all_items: list[RawNewsItem] = []
        keywords = _GLOBAL_KEYWORDS[:4]
        per_kw_limit = max(limit // len(keywords), 25)

        for keyword in keywords:
            items = await self._search_news(keyword, per_kw_limit)
            all_items.extend(items)
            if len(all_items) >= limit:
                break

        return all_items[:limit]

    async def fetch_stock_news(
        self, symbol: str, limit: int = 20
    ) -> list[RawNewsItem]:
        return await self._search_news(symbol, limit)

    async def search_news(
        self, keyword: str, limit: int = 20
    ) -> list[RawNewsItem]:
        return await self._search_news(keyword, limit)

    async def _search_news(
        self, keyword: str, limit: int
    ) -> list[RawNewsItem]:
        try:
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._search_sync, keyword, limit),
                timeout=30,
            )
        except Exception as e:
            logger.warning("EastMoney search(%s) failed: %s", keyword, e)
            return []

    def _search_sync(self, keyword: str, limit: int) -> list[RawNewsItem]:
        """Synchronous search via EastMoney JSONP API using requests."""
        import requests
        from urllib.parse import quote

        items: list[RawNewsItem] = []
        page = 1
        max_pages = max(limit // 100, 1)

        while page <= max_pages and len(items) < limit:
            inner_param = {
                "uid": "",
                "keyword": keyword,
                "type": ["cmsArticleWebOld"],
                "client": "web",
                "clientType": "web",
                "clientVersion": "curr",
                "param": {
                    "cmsArticleWebOld": {
                        "searchScope": "default",
                        "sort": "default",
                        "pageIndex": page,
                        "pageSize": 100,
                        "preTag": "",
                        "postTag": "",
                    }
                },
            }
            params = {
                "cb": f"jQuery{int(time.time() * 1000)}",
                "param": json.dumps(inner_param, ensure_ascii=False),
                "_": str(int(time.time() * 1000)),
            }
            referer = f"https://so.eastmoney.com/news/s?keyword={quote(keyword)}"
            headers = {**_HEADERS, "referer": referer}

            for attempt in range(3):
                try:
                    r = requests.get(
                        _EASTMONEY_SEARCH_URL,
                        params=params,
                        headers=headers,
                        timeout=20,
                    )
                    r.raise_for_status()
                    text = r.text
                    if "(" in text:
                        text = text[text.index("(") + 1 : text.rindex(")")]
                    data = json.loads(text)
                    articles = data.get("result", {}).get("cmsArticleWebOld", [])
                    if not articles:
                        return items

                    for art in articles:
                        pub_time_str = art.get("date", "")
                        dt = None
                        if pub_time_str:
                            try:
                                dt = datetime.strptime(pub_time_str, "%Y-%m-%d %H:%M:%S")
                            except ValueError:
                                pass
                        items.append(
                            RawNewsItem(
                                title=art.get("title", "").replace("<em>", "").replace("</em>", ""),
                                content=(art.get("content", "") or "").replace("<em>", "").replace("</em>", ""),
                                source=art.get("mediaName", "东方财富"),
                                url=f"http://finance.eastmoney.com/a/{art.get('code', '')}.html",
                                publish_time=dt,
                                tags=[keyword],
                            )
                        )
                    break
                except Exception as e:
                    if attempt < 2:
                        time.sleep(1)
                    else:
                        logger.warning("EastMoney page %d failed: %s", page, e)

            page += 1
            if page <= max_pages:
                time.sleep(0.3)

        return items

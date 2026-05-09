"""RSS news provider - fetches from RSS feeds with direct API fallback."""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime
from typing import Any

import httpx

from .base import NewsProvider, RawNewsItem

logger = logging.getLogger(__name__)

_RSSHUB_URL = os.environ.get("RSSHUB_URL", "https://rsshub.app")

# RSS feed sources (used when RSSHub is available)
_RSS_FEEDS = [
    {
        "name": "财联社电报",
        "url": f"{_RSSHUB_URL}/cls/telegraph",
        "source": "财联社",
        "category": "market",
    },
    {
        "name": "新浪财经滚动",
        "url": f"{_RSSHUB_URL}/sina/finance/roll",
        "source": "新浪财经",
        "category": "finance",
    },
    {
        "name": "证券时报快讯",
        "url": f"{_RSSHUB_URL}/stcn/kuaixun",
        "source": "证券时报",
        "category": "market",
    },
    {
        "name": "华尔街见闻",
        "url": f"{_RSSHUB_URL}/wallstreetcn/news",
        "source": "华尔街见闻",
        "category": "macro",
    },
    {
        "name": "东方财富研报",
        "url": f"{_RSSHUB_URL}/eastmoney/report",
        "source": "东方财富",
        "category": "research",
    },
    {
        "name": "36氪快讯",
        "url": f"{_RSSHUB_URL}/36kr/newsflashes",
        "source": "36氪",
        "category": "tech",
    },
    {
        "name": "彭博社中国",
        "url": f"{_RSSHUB_URL}/bloomberg/china",
        "source": "彭博社",
        "category": "international",
    },
    {
        "name": "路透社中国",
        "url": f"{_RSSHUB_URL}/reuters/china",
        "source": "路透社",
        "category": "international",
    },
    {
        "name": "FT中文网热门",
        "url": f"{_RSSHUB_URL}/ft/chinese/hotstoryby7day",
        "source": "FT中文网",
        "category": "international",
    },
]

# Direct API sources (always used, no RSSHub dependency)
_DIRECT_APIS = [
    {
        "name": "新浪财经API",
        "url": "https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516&num=50",
        "source": "新浪财经",
        "category": "finance",
        "parser": "sina",
    },
    {
        "name": "同花顺快讯",
        "url": "https://news.10jqka.com.cn/tapp/news/push/stock/?page=1&tag=&track=website&pagesize=50",
        "source": "同花顺",
        "category": "market",
        "parser": "ths",
    },
    {
        "name": "澎湃新闻",
        "url": "https://cache.thepaper.cn/contentapi/wwwIndex/rightSidebar",
        "source": "澎湃新闻",
        "category": "news",
        "parser": "thepaper",
    },
    {
        "name": "金十数据",
        "url": "https://www.jin10.com/flash_newest.js",
        "source": "金十数据",
        "category": "market",
        "parser": "jin10",
    },
    {
        "name": "华尔街见闻快讯",
        "url": "https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=global-channel&client=pc&limit=50&first_page=true",
        "source": "华尔街见闻",
        "category": "macro",
        "parser": "wallstreetcn_live",
    },
    {
        "name": "华尔街见闻文章",
        "url": "https://api-one-wscn.awtmt.com/apiv1/content/articles?channel=global-channel&client=pc&limit=30&first_page=true",
        "source": "华尔街见闻",
        "category": "depth",
        "parser": "wallstreetcn_article",
    },
]


class RssProvider(NewsProvider):
    """RSS feed news provider with direct API fallback."""

    name = "rss"

    async def fetch_news(self, limit: int = 100) -> list[RawNewsItem]:
        """Fetch from direct APIs first (always reliable), then RSS if available."""
        all_items: list[RawNewsItem] = []

        # Direct APIs are always reliable - fetch first
        direct_items = await self._fetch_direct_apis(limit)
        all_items.extend(direct_items)

        # If we need more, try RSS feeds (requires RSSHub)
        if len(all_items) < limit:
            rss_items = await self._fetch_rss_feeds(limit - len(all_items))
            all_items.extend(rss_items)

        return all_items[:limit]

    async def _fetch_rss_feeds(self, limit: int) -> list[RawNewsItem]:
        """Fetch all RSS feeds concurrently."""
        try:
            import feedparser
        except ImportError:
            logger.warning("feedparser not installed, skipping RSS feeds")
            return []

        tasks = [self._fetch_single_feed(feed, limit) for feed in _RSS_FEEDS]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        items: list[RawNewsItem] = []
        for result in results:
            if isinstance(result, list):
                items.extend(result)
        logger.info("RSS: fetched %d items from %d feeds", len(items), len(_RSS_FEEDS))
        return items

    async def _fetch_single_feed(
        self, feed_config: dict, limit: int
    ) -> list[RawNewsItem]:
        try:
            import feedparser

            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._parse_feed, feed_config, limit),
                timeout=30,
            )
        except Exception as e:
            logger.warning("RSS feed %s failed: %s", feed_config["name"], e)
            return []

    def _parse_feed(self, feed_config: dict, limit: int) -> list[RawNewsItem]:
        import feedparser

        feed = feedparser.parse(feed_config["url"])
        items: list[RawNewsItem] = []

        for entry in feed.entries[:limit]:
            title = entry.get("title", "").strip()
            if not title or len(title) < 4:
                continue

            dt = None
            if hasattr(entry, "published_parsed") and entry.published_parsed:
                try:
                    dt = datetime(*entry.published_parsed[:6])
                except Exception:
                    pass
            elif hasattr(entry, "updated_parsed") and entry.updated_parsed:
                try:
                    dt = datetime(*entry.updated_parsed[:6])
                except Exception:
                    pass

            content = ""
            if hasattr(entry, "summary"):
                content = entry.summary
            elif hasattr(entry, "description"):
                content = entry.description

            items.append(
                RawNewsItem(
                    title=title,
                    content=content,
                    source=feed_config["source"],
                    url=entry.get("link", ""),
                    publish_time=dt,
                    category=feed_config["category"],
                )
            )
        return items

    async def _fetch_direct_apis(self, limit: int) -> list[RawNewsItem]:
        """Fetch from direct APIs concurrently."""
        per_api_limit = max(limit, 50)
        tasks = [self._fetch_direct_api(api, per_api_limit) for api in _DIRECT_APIS]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        items: list[RawNewsItem] = []
        for result in results:
            if isinstance(result, list):
                items.extend(result)
        logger.info("RSS direct APIs: fetched %d items", len(items))
        return items

    async def _fetch_direct_api(
        self, api_config: dict, limit: int
    ) -> list[RawNewsItem]:
        try:
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._fetch_api_sync, api_config, limit),
                timeout=30,
            )
        except Exception as e:
            logger.warning("Direct API %s failed: %s", api_config["name"], e)
            return []

    def _fetch_api_sync(self, api_config: dict, limit: int) -> list[RawNewsItem]:
        items: list[RawNewsItem] = []
        try:
            with httpx.Client(timeout=20.0, headers={"User-Agent": "Mozilla/5.0"}) as client:
                r = client.get(api_config["url"])
                r.raise_for_status()

                parser = api_config["parser"]
                if parser == "sina":
                    items = self._parse_sina_response(r.json(), api_config, limit)
                elif parser == "ths":
                    items = self._parse_ths_response(r.json(), api_config, limit)
                elif parser == "thepaper":
                    items = self._parse_thepaper_response(r.json(), api_config, limit)
                elif parser == "jin10":
                    items = self._parse_jin10_response(r.text, api_config, limit)
                elif parser == "wallstreetcn_live":
                    items = self._parse_wallstreetcn_live(r.json(), api_config, limit)
                elif parser == "wallstreetcn_article":
                    items = self._parse_wallstreetcn_article(r.json(), api_config, limit)
        except Exception as e:
            logger.warning("Direct API fetch %s error: %s", api_config["name"], e)
        return items

    @staticmethod
    def _parse_sina_response(data: dict, config: dict, limit: int) -> list[RawNewsItem]:
        items: list[RawNewsItem] = []
        result = data.get("result", {})
        news_list = result.get("data", [])
        for item in news_list[:limit]:
            title = item.get("title", "")
            if not title:
                continue
            ts = int(item.get("ctime", 0))
            dt = datetime.fromtimestamp(ts) if ts else None
            items.append(
                RawNewsItem(
                    title=title,
                    content=item.get("intro", "") or item.get("summary", ""),
                    source=config["source"],
                    url=item.get("url", ""),
                    publish_time=dt,
                    category=config["category"],
                )
            )
        return items

    @staticmethod
    def _parse_ths_response(data: dict, config: dict, limit: int) -> list[RawNewsItem]:
        """Parse 同花顺 news API response."""
        items: list[RawNewsItem] = []
        news_list = data.get("data", {}).get("list", [])
        for item in news_list[:limit]:
            title = item.get("title", "")
            if not title:
                continue
            ts = int(item.get("ctime", 0))
            dt = datetime.fromtimestamp(ts) if ts else None
            items.append(
                RawNewsItem(
                    title=title,
                    content=item.get("digest", ""),
                    source=config["source"],
                    url=item.get("url", ""),
                    publish_time=dt,
                    category=config["category"],
                )
            )
        return items

    @staticmethod
    def _parse_thepaper_response(data: dict, config: dict, limit: int) -> list[RawNewsItem]:
        """Parse 澎湃新闻 API response."""
        items: list[RawNewsItem] = []
        news_list = data.get("data", {}).get("hotNews", [])
        for item in news_list[:limit]:
            title = item.get("name", "")
            if not title:
                continue
            ts = item.get("pubTimeLong", 0)
            dt = datetime.fromtimestamp(ts / 1000) if ts else None
            items.append(
                RawNewsItem(
                    title=title,
                    content=item.get("summary", "") or item.get("content", ""),
                    source=config["source"],
                    url=f"https://www.thepaper.cn/newsDetail_forward_{item.get('contId', '')}",
                    publish_time=dt,
                    category=config["category"],
                )
            )
        return items

    @staticmethod
    def _parse_jin10_response(text: str, config: dict, limit: int) -> list[RawNewsItem]:
        """Parse 金十数据 flash JS response."""
        import re
        import json as _json

        items: list[RawNewsItem] = []
        match = re.search(r'var newest = (\[.*?\]);', text, re.DOTALL)
        if not match:
            return []

        try:
            data = _json.loads(match.group(1))
        except Exception:
            return []

        for entry in data[:limit]:
            d = entry.get("data", {})
            content = d.get("content", "")
            # Strip HTML tags and Jin10 data tags
            content = re.sub(r'<[^>]+>', '', content)
            content = re.sub(r'【[^】]*】', '', content).strip()

            # Extract title from content (first sentence or tag)
            title = d.get("title", "")
            if not title and content:
                # Use first 80 chars as title
                title = content[:80]
                if len(content) > 80:
                    title += "..."

            if not title:
                continue

            time_str = entry.get("time", "")
            dt = None
            if time_str:
                try:
                    dt = datetime.strptime(time_str, "%Y-%m-%d %H:%M:%S")
                except ValueError:
                    pass

            source_name = d.get("source", "") or config["source"]

            items.append(
                RawNewsItem(
                    title=title,
                    content=content,
                    source=source_name,
                    url=f"https://www.jin10.com/flash_newest.html#id={entry.get('id', '')}",
                    publish_time=dt,
                    category=config["category"],
                )
            )
        return items

    @staticmethod
    def _parse_wallstreetcn_live(data: dict, config: dict, limit: int) -> list[RawNewsItem]:
        """Parse 华尔街见闻 live (快讯) API response."""
        items: list[RawNewsItem] = []
        for entry in data.get("data", {}).get("items", [])[:limit]:
            title = entry.get("title", "")
            content = entry.get("content_text", "") or entry.get("content", "")
            # Strip HTML
            import re
            content = re.sub(r'<[^>]+>', '', content)

            if not title and content:
                title = content[:80]
                if len(content) > 80:
                    title += "..."
            if not title:
                continue

            ts = entry.get("display_time", 0)
            dt = datetime.fromtimestamp(ts) if ts else None

            items.append(
                RawNewsItem(
                    title=title,
                    content=content,
                    source=config["source"],
                    url=f"https://wallstreetcn.com/live/{entry.get('id', '')}",
                    publish_time=dt,
                    category=config["category"],
                )
            )
        return items

    @staticmethod
    def _parse_wallstreetcn_article(data: dict, config: dict, limit: int) -> list[RawNewsItem]:
        """Parse 华尔街见闻 article API response."""
        items: list[RawNewsItem] = []
        for entry in data.get("data", {}).get("items", [])[:limit]:
            title = entry.get("title", "")
            if not title:
                continue

            content = entry.get("content_text", "") or entry.get("summary", "")
            import re
            content = re.sub(r'<[^>]+>', '', content)

            ts = entry.get("display_time", 0)
            dt = datetime.fromtimestamp(ts) if ts else None

            items.append(
                RawNewsItem(
                    title=title,
                    content=content,
                    source=config["source"],
                    url=f"https://wallstreetcn.com/articles/{entry.get('id', '')}",
                    publish_time=dt,
                    category=config["category"],
                )
            )
        return items

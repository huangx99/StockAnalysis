"""CLS (财联社) news provider via RSSHub."""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime
from typing import Any

from .base import NewsProvider, RawNewsItem

logger = logging.getLogger(__name__)

_RSSHUB_URL = os.environ.get("RSSHUB_URL", "https://rsshub.app")


class ClsProvider(NewsProvider):
    """财联社 news via RSSHub RSS feed."""

    name = "cls"

    async def fetch_news(self, limit: int = 100) -> list[RawNewsItem]:
        """Fetch CLS telegraph via RSSHub."""
        try:
            import feedparser
        except ImportError:
            logger.warning("feedparser not installed, skipping CLS RSS")
            return []

        try:
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._fetch_rss, limit),
                timeout=30,
            )
        except Exception as e:
            logger.warning("CLS RSS failed: %s", e)
            return []

    async def search_news(self, keyword: str, limit: int = 20) -> list[RawNewsItem]:
        """Search CLS telegraph by keyword (filters from recent feed)."""
        try:
            import feedparser
        except ImportError:
            return []

        try:
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._search_rss, keyword, limit),
                timeout=30,
            )
        except Exception as e:
            self._logger.warning("CLS search(%s) failed: %s", keyword, e)
            return []

    def _search_rss(self, keyword: str, limit: int) -> list[RawNewsItem]:
        """Search CLS telegraph feed by keyword matching."""
        import feedparser

        url = f"{_RSSHUB_URL}/cls/telegraph"
        feed = feedparser.parse(url)
        items: list[RawNewsItem] = []
        keyword_lower = keyword.lower()

        for entry in feed.entries:
            title = entry.get("title", "").strip()
            content = entry.get("summary", "") or entry.get("description", "")

            # Match keyword in title or content
            if keyword_lower not in title.lower() and keyword_lower not in content.lower():
                continue

            if not title or len(title) < 4:
                continue

            dt = None
            if hasattr(entry, "published_parsed") and entry.published_parsed:
                try:
                    dt = datetime(*entry.published_parsed[:6])
                except Exception:
                    pass

            items.append(
                RawNewsItem(
                    title=title,
                    content=content,
                    source="财联社",
                    url=entry.get("link", ""),
                    publish_time=dt,
                    category="market",
                )
            )
            if len(items) >= limit:
                break

        self._logger.info("CLS search '%s': %d matches", keyword, len(items))
        return items

    def _fetch_rss(self, limit: int) -> list[RawNewsItem]:
        """Fetch CLS telegraph from RSSHub."""
        import feedparser

        url = f"{_RSSHUB_URL}/cls/telegraph"
        feed = feedparser.parse(url)
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

            content = entry.get("summary", "") or entry.get("description", "")

            items.append(
                RawNewsItem(
                    title=title,
                    content=content,
                    source="财联社",
                    url=entry.get("link", ""),
                    publish_time=dt,
                    category="market",
                )
            )

        logger.info("CLS RSS: fetched %d items", len(items))
        return items

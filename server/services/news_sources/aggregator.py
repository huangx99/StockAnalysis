"""News aggregator - fetches from all providers, deduplicates, merges."""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime
from typing import Any

from .base import NewsProvider, RawNewsItem
from .dedup import semantic_dedup

logger = logging.getLogger(__name__)


class NewsAggregator:
    """Concurrently fetches news from all registered providers and merges results."""

    def __init__(self) -> None:
        self._providers: list[NewsProvider] = []

    def register(self, provider: NewsProvider) -> None:
        self._providers.append(provider)
        logger.info("Registered news provider: %s", provider.name)

    def get_providers(self) -> list[NewsProvider]:
        return list(self._providers)

    def get_provider(self, name: str) -> NewsProvider | None:
        for p in self._providers:
            if p.name == name:
                return p
        return None

    async def fetch_all(self, limit_per_source: int = 100) -> list[RawNewsItem]:
        """Fetch from all enabled providers concurrently, deduplicate, sort by time."""
        active = [p for p in self._providers if p.enabled]
        if not active:
            logger.warning("No enabled news providers")
            return []

        tasks = [
            self._fetch_with_health(p, limit_per_source) for p in active
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        all_items: list[RawNewsItem] = []
        for result in results:
            if isinstance(result, Exception):
                logger.error("Provider fetch raised: %s", result)
                continue
            all_items.extend(result)

        deduped = semantic_dedup(all_items)
        deduped.sort(key=lambda x: x.publish_time or datetime.min, reverse=True)
        logger.info(
            "Aggregated %d items (%d raw) from %d providers",
            len(deduped),
            len(all_items),
            len(active),
        )
        return deduped

    async def fetch_stock_news(
        self, symbol: str, limit: int = 20
    ) -> list[RawNewsItem]:
        """Fetch per-stock news from all providers that support it."""
        active = [p for p in self._providers if p.enabled]
        tasks = [
            self._fetch_stock_with_health(p, symbol, limit) for p in active
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        all_items: list[RawNewsItem] = []
        for result in results:
            if isinstance(result, Exception):
                continue
            all_items.extend(result)

        deduped = semantic_dedup(all_items)
        deduped.sort(key=lambda x: x.publish_time or datetime.min, reverse=True)
        return deduped[:limit]

    async def search_all(
        self, keyword: str, limit: int = 30
    ) -> list[RawNewsItem]:
        """Search news by keyword across all providers that support it."""
        active = [p for p in self._providers if p.enabled]
        tasks = [
            self._search_with_health(p, keyword, limit) for p in active
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        all_items: list[RawNewsItem] = []
        for result in results:
            if isinstance(result, Exception):
                logger.error("Provider search raised: %s", result)
                continue
            all_items.extend(result)

        deduped = semantic_dedup(all_items)
        deduped.sort(key=lambda x: x.publish_time or datetime.min, reverse=True)
        logger.info(
            "Search '%s': %d raw → %d deduped from %d providers",
            keyword, len(all_items), len(deduped), len(active),
        )
        return deduped

    async def _search_with_health(
        self, provider: NewsProvider, keyword: str, limit: int
    ) -> list[RawNewsItem]:
        """Search with health tracking and error handling."""
        t0 = time.monotonic()
        try:
            items = await asyncio.wait_for(
                provider.search_news(keyword, limit), timeout=30.0
            )
            latency = (time.monotonic() - t0) * 1000
            if items:
                provider.health.record_success(len(items), latency)
                provider._logger.info(
                    "Search '%s': %d items in %.0fms", keyword, len(items), latency
                )
            return items
        except Exception as e:
            provider.health.record_failure()
            provider._logger.warning("search_news(%s) failed: %s", keyword, e)
            return []

    async def _fetch_with_health(
        self, provider: NewsProvider, limit: int
    ) -> list[RawNewsItem]:
        """Fetch with health tracking and error handling."""
        t0 = time.monotonic()
        try:
            items = await asyncio.wait_for(
                provider.fetch_news(limit), timeout=60.0
            )
            latency = (time.monotonic() - t0) * 1000
            provider.health.record_success(len(items), latency)
            provider._logger.info("Fetched %d items in %.0fms", len(items), latency)
            return items
        except Exception as e:
            provider.health.record_failure()
            provider._logger.warning("fetch_news failed: %s", e)
            return []

    async def _fetch_stock_with_health(
        self, provider: NewsProvider, symbol: str, limit: int
    ) -> list[RawNewsItem]:
        """Fetch stock news with health tracking."""
        try:
            items = await asyncio.wait_for(
                provider.fetch_stock_news(symbol, limit), timeout=30.0
            )
            return items
        except Exception as e:
            provider._logger.warning("fetch_stock_news(%s) failed: %s", symbol, e)
            return []

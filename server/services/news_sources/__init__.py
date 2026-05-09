"""Pluggable news sources package."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from .aggregator import NewsAggregator
from .base import NewsProvider, ProviderHealth, RawNewsItem

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

_aggregator: NewsAggregator | None = None


def get_aggregator() -> NewsAggregator:
    """Get the singleton aggregator."""
    global _aggregator
    if _aggregator is None:
        _aggregator = NewsAggregator()
    return _aggregator


def init_news_sources() -> NewsAggregator:
    """Initialize and register all news providers. Called at app startup."""
    agg = get_aggregator()

    from .akshare_provider import AkShareNewsProvider
    from .cls_provider import ClsProvider
    from .eastmoney_provider import EastMoneyProvider
    from .futures_provider import FuturesProvider
    from .gov_provider import GovProvider
    from .research_provider import ResearchProvider
    from .rss_provider import RssProvider
    from .search_provider import SearchProvider
    from .sina_provider import SinaProvider
    from .social_provider import SocialProvider
    from .tushare_provider import TushareProvider

    agg.register(AkShareNewsProvider())
    agg.register(EastMoneyProvider())
    agg.register(RssProvider())
    agg.register(SinaProvider())
    agg.register(ClsProvider())
    agg.register(GovProvider())
    agg.register(FuturesProvider())
    agg.register(ResearchProvider())
    agg.register(SocialProvider())
    agg.register(SearchProvider())
    agg.register(TushareProvider())

    logger.info("Initialized %d news providers", len(agg.get_providers()))
    return agg


__all__ = [
    "NewsAggregator",
    "NewsProvider",
    "ProviderHealth",
    "RawNewsItem",
    "get_aggregator",
    "init_news_sources",
]

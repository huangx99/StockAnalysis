"""Data source abstraction layer.

Provides a unified interface for fetching data from multiple sources
with automatic failover, health tracking, and per-source thread pool isolation.

Usage::

    from services.data_sources import get_registry, DataCapability

    result = await get_registry().fetch(
        DataCapability.HISTORICAL_KLINE,
        symbol="600519", period="daily",
    )
    if result.ok:
        df = result.data
"""

from __future__ import annotations

import logging

from .base import DataCapability, DataSource, SourceHealth, SourceResult
from .registry import DataSourceRegistry, SelectionStrategy, get_registry
from .thread_pool import DataSourceThreadPool, PoolConfig, get_pool_manager, init_default_pools

logger = logging.getLogger(__name__)

_initialized = False


async def init_data_sources(
    akshare_threads: int = 8,
    yahoo_threads: int = 3,
    pytdx_threads: int = 2,
    recovery_interval: float = 120.0,
) -> None:
    """Initialize and register all data sources. Call once at app startup."""
    global _initialized
    if _initialized:
        return

    pool = init_default_pools(
        akshare_threads=akshare_threads,
        yahoo_threads=yahoo_threads,
        pytdx_threads=pytdx_threads,
    )

    registry = get_registry()
    registry._strategy = SelectionStrategy(recovery_interval=recovery_interval)

    from .sources.akshare_source import AKShareSource
    from .sources.pytdx_source import PytdxSource
    from .sources.yahoo_source import YahooSource

    registry.register(AKShareSource(thread_pool=pool))
    registry.register(YahooSource(thread_pool=pool))
    registry.register(PytdxSource(thread_pool=pool))

    _initialized = True
    logger.info("Data sources initialized: %d sources registered", len(registry.list_sources()))


__all__ = [
    "DataCapability",
    "DataSource",
    "DataSourceRegistry",
    "DataSourceThreadPool",
    "PoolConfig",
    "SelectionStrategy",
    "SourceHealth",
    "SourceResult",
    "get_pool_manager",
    "get_registry",
    "init_data_sources",
]

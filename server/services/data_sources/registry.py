"""Data source registry with selection strategy and circuit breaker."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from .base import DataCapability, DataSource, SourceResult

logger = logging.getLogger(__name__)


class SelectionStrategy:
    """Decides which data sources to try and in what order.

    Strategy: Priority-first with circuit breaker.
    - Sort sources by priority (lower = preferred)
    - Skip unhealthy sources
    - On failure, fall back to next source
    - Periodically retry unhealthy sources (circuit breaker half-open)
    """

    def __init__(self, recovery_interval: float = 120.0):
        self.recovery_interval = recovery_interval

    def select_sources(
        self,
        sources: list[DataSource],
        capability: DataCapability,
    ) -> list[DataSource]:
        """Return ordered list of sources to try for a capability."""
        candidates = [s for s in sources if capability in s.capabilities]

        healthy = []
        recovering = []

        for s in candidates:
            if s.health.is_healthy:
                healthy.append(s)
            elif self._should_retry(s):
                recovering.append(s)

        healthy.sort(key=lambda s: s.priority)
        recovering.sort(key=lambda s: s.priority)

        return healthy + recovering

    def _should_retry(self, source: DataSource) -> bool:
        """Circuit breaker half-open: retry after recovery interval."""
        if source.health.last_failure == 0:
            return True
        elapsed = time.monotonic() - source.health.last_failure
        return elapsed > self.recovery_interval


class DataSourceRegistry:
    """Central registry for all data sources.

    Usage::

        registry = DataSourceRegistry()
        registry.register(AKShareSource(pool_manager))
        registry.register(YahooSource(pool_manager))

        result = await registry.fetch(DataCapability.HISTORICAL_KLINE, symbol="600519")
    """

    def __init__(self, strategy: SelectionStrategy | None = None):
        self._sources: dict[str, DataSource] = {}
        self._strategy = strategy or SelectionStrategy()

    def register(self, source: DataSource) -> None:
        """Register a data source."""
        if source.name in self._sources:
            logger.warning("Overwriting data source: %s", source.name)
        self._sources[source.name] = source
        logger.info(
            "Registered data source: %s (priority=%d, capabilities=%s)",
            source.name,
            source.priority,
            {c.value for c in source.capabilities},
        )

    def unregister(self, name: str) -> None:
        """Unregister a data source by name."""
        self._sources.pop(name, None)

    def get_source(self, name: str) -> DataSource | None:
        """Get a specific data source by name."""
        return self._sources.get(name)

    def list_sources(self) -> list[dict]:
        """List all registered sources with their health status."""
        return [
            {
                "name": s.name,
                "priority": s.priority,
                "capabilities": [c.value for c in s.capabilities],
                "healthy": s.health.is_healthy,
                "consecutive_failures": s.health.consecutive_failures,
                "avg_latency_ms": round(s.health.avg_latency_ms, 1),
                "failure_rate": round(s.health.failure_rate * 100, 1),
                "total_calls": s.health.total_calls,
            }
            for s in sorted(self._sources.values(), key=lambda s: s.priority)
        ]

    async def fetch(
        self,
        capability: DataCapability,
        *,
        preferred_source: str | None = None,
        **kwargs: Any,
    ) -> SourceResult:
        """Fetch data with automatic failover.

        Args:
            capability: What kind of data to fetch
            preferred_source: Force a specific source (bypasses selection)
            **kwargs: Passed to source.do_fetch()

        Returns:
            SourceResult from the first successful source, or the last error.
        """
        if preferred_source:
            source = self._sources.get(preferred_source)
            if source:
                return await source.fetch(capability, **kwargs)
            logger.warning("Preferred source %s not found, using selection", preferred_source)

        candidates = self._strategy.select_sources(
            list(self._sources.values()), capability
        )

        if not candidates:
            return SourceResult(
                data=None,
                source_name="none",
                error=f"No source available for {capability.value}",
            )

        last_error = None
        for source in candidates:
            result = await source.fetch(capability, **kwargs)
            if result.ok:
                return result
            last_error = result
            logger.info(
                "Source %s failed for %s (%s), trying next...",
                source.name,
                capability.value,
                result.error,
            )

        logger.error("All sources exhausted for %s", capability.value)
        return last_error or SourceResult(
            data=None,
            source_name="none",
            error=f"All sources failed for {capability.value}",
        )

    async def fetch_all(
        self,
        capability: DataCapability,
        **kwargs: Any,
    ) -> list[SourceResult]:
        """Fetch from ALL healthy sources concurrently (for cross-validation)."""
        candidates = self._strategy.select_sources(
            list(self._sources.values()), capability
        )
        tasks = [s.fetch(capability, **kwargs) for s in candidates]
        return await asyncio.gather(*tasks, return_exceptions=False)

    def reset_health(self, source_name: str | None = None) -> None:
        """Reset health tracking for a specific or all sources."""
        if source_name:
            source = self._sources.get(source_name)
            if source:
                source.health.reset()
        else:
            for source in self._sources.values():
                source.health.reset()


# Module-level singleton
_registry: DataSourceRegistry | None = None


def get_registry() -> DataSourceRegistry:
    """Get or create the singleton registry."""
    global _registry
    if _registry is None:
        _registry = DataSourceRegistry()
    return _registry

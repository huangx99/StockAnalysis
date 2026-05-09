"""Data source abstraction layer - base classes and contracts."""

from __future__ import annotations

import asyncio
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING, Any

import pandas as pd

if TYPE_CHECKING:
    from .thread_pool import DataSourceThreadPool


class DataCapability(Enum):
    """What a data source can provide."""

    SPOT_QUOTE = "spot_quote"
    HISTORICAL_KLINE = "hist_kline"
    MINUTE_KLINE = "minute_kline"
    STOCK_INFO = "stock_info"
    NEWS = "news"
    FINANCIAL_REPORT = "financial"
    FINANCIAL_INDICATORS = "financial_indicators"
    DIVIDEND = "dividend"
    BID_ASK = "bid_ask"
    NOTICES = "notices"
    RESEARCH_REPORTS = "reports"
    SECTOR_FLOW = "sector_flow"
    LIMIT_POOL = "limit_pool"
    INDEX_DAILY = "index_daily"
    BOARD_CONS = "board_cons"


@dataclass
class SourceHealth:
    """Tracks a data source's runtime health."""

    consecutive_failures: int = 0
    total_calls: int = 0
    total_failures: int = 0
    last_success: float = 0.0
    last_failure: float = 0.0
    avg_latency_ms: float = 0.0

    @property
    def is_healthy(self) -> bool:
        return self.consecutive_failures < 5

    @property
    def failure_rate(self) -> float:
        if self.total_calls == 0:
            return 0.0
        return self.total_failures / self.total_calls

    def record_success(self, latency_ms: float) -> None:
        self.total_calls += 1
        self.consecutive_failures = 0
        self.last_success = time.monotonic()
        self.avg_latency_ms = 0.7 * self.avg_latency_ms + 0.3 * latency_ms

    def record_failure(self) -> None:
        self.total_calls += 1
        self.total_failures += 1
        self.consecutive_failures += 1
        self.last_failure = time.monotonic()

    def reset(self) -> None:
        self.consecutive_failures = 0


@dataclass
class SourceResult:
    """Unified return type for all data source operations."""

    data: pd.DataFrame | dict | list | None
    source_name: str
    latency_ms: float = 0.0
    from_cache: bool = False
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None and self.data is not None


class DataSource(ABC):
    """
    Base class for all data sources.

    Subclasses MUST:
    - Set ``name`` (unique string identifier)
    - Set ``priority`` (lower = preferred, 1=primary)
    - Set ``capabilities`` (set of DataCapability)
    - Implement ``do_fetch()`` for each capability they support

    Subclasses MAY override ``is_available()`` for custom availability checks.
    """

    name: str = ""
    priority: int = 100
    capabilities: set[DataCapability] = set()

    def __init__(self, thread_pool: DataSourceThreadPool | None = None):
        self._pool = thread_pool
        self.health = SourceHealth()
        self._logger = logging.getLogger(f"datasource.{self.name}")

    @abstractmethod
    async def do_fetch(self, capability: DataCapability, **kwargs: Any) -> SourceResult:
        """Execute the actual data fetch.

        Implementations should call sync functions via
        ``await self._run_in_pool(sync_func, *args)``.
        """
        ...

    def is_available(self) -> bool:
        """Check if this source is currently usable."""
        return self.health.is_healthy

    async def fetch(self, capability: DataCapability, **kwargs: Any) -> SourceResult:
        """Public entry point with health tracking and timing."""
        if capability not in self.capabilities:
            return SourceResult(
                data=None,
                source_name=self.name,
                error=f"{self.name} does not support {capability.value}",
            )
        if not self.is_available():
            return SourceResult(
                data=None,
                source_name=self.name,
                error=f"{self.name} is unavailable (consecutive failures: {self.health.consecutive_failures})",
            )

        t0 = time.monotonic()
        try:
            result = await asyncio.wait_for(
                self.do_fetch(capability, **kwargs),
                timeout=self._timeout_for(capability),
            )
            latency = (time.monotonic() - t0) * 1000
            self.health.record_success(latency)
            result.latency_ms = latency
            return result
        except Exception as e:
            self.health.record_failure()
            self._logger.warning("fetch %s failed: %s", capability.value, e)
            return SourceResult(
                data=None,
                source_name=self.name,
                latency_ms=(time.monotonic() - t0) * 1000,
                error=str(e),
            )

    async def _run_in_pool(self, func: Any, *args: Any, **kwargs: Any) -> Any:
        """Run a synchronous function in this source's thread pool."""
        if self._pool:
            return await self._pool.submit(self.name, func, *args, **kwargs)
        return await asyncio.to_thread(func, *args, **kwargs)

    def _timeout_for(self, capability: DataCapability) -> float:
        """Override to customize per-capability timeouts."""
        return 60.0

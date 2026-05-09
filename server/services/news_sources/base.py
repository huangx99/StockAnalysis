"""News provider abstraction layer."""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class RawNewsItem:
    """Unified news item from any provider."""

    title: str
    content: str = ""
    source: str = ""
    url: str = ""
    publish_time: datetime | None = None
    tags: list[str] = field(default_factory=list)
    category: str = "finance"  # finance, macro, industry, policy, market


@dataclass
class ProviderHealth:
    """Tracks a news provider's runtime health."""

    total_calls: int = 0
    total_failures: int = 0
    consecutive_failures: int = 0
    last_success: float = 0.0
    last_failure: float = 0.0
    last_fetch_count: int = 0
    avg_latency_ms: float = 0.0

    @property
    def is_healthy(self) -> bool:
        return self.consecutive_failures < 5

    def record_success(self, count: int, latency_ms: float) -> None:
        self.total_calls += 1
        self.consecutive_failures = 0
        self.last_fetch_count = count
        self.avg_latency_ms = 0.7 * self.avg_latency_ms + 0.3 * latency_ms
        import time
        self.last_success = time.monotonic()

    def record_failure(self) -> None:
        import time
        self.total_calls += 1
        self.total_failures += 1
        self.consecutive_failures += 1
        self.last_failure = time.monotonic()

    def reset(self) -> None:
        self.consecutive_failures = 0


class NewsProvider(ABC):
    """Base class for all news providers.

    Subclasses MUST set ``name`` and implement ``fetch_news()``.
    Subclasses MAY implement ``fetch_stock_news()`` for per-symbol news.
    """

    name: str = ""
    enabled: bool = True

    def __init__(self) -> None:
        self.health = ProviderHealth()
        self._logger = logging.getLogger(f"news_provider.{self.name}")

    @abstractmethod
    async def fetch_news(self, limit: int = 100) -> list[RawNewsItem]:
        """Fetch latest global news."""
        ...

    async def fetch_stock_news(
        self, symbol: str, limit: int = 20
    ) -> list[RawNewsItem]:
        """Fetch news for a specific stock (optional)."""
        return []

    async def search_news(
        self, keyword: str, limit: int = 20
    ) -> list[RawNewsItem]:
        """Search news by keyword in real-time (optional)."""
        return []

    def to_dict(self) -> dict[str, Any]:
        """Serialize provider status for API response."""
        return {
            "name": self.name,
            "enabled": self.enabled,
            "healthy": self.health.is_healthy,
            "total_calls": self.health.total_calls,
            "consecutive_failures": self.health.consecutive_failures,
            "last_fetch_count": self.health.last_fetch_count,
            "avg_latency_ms": round(self.health.avg_latency_ms, 1),
        }

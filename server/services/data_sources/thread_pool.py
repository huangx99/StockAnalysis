"""Per-source isolated thread pool manager."""

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class PoolConfig:
    """Configuration for a single thread pool."""

    max_workers: int = 5
    thread_name_prefix: str = "ds"


class DataSourceThreadPool:
    """Manages isolated thread pools per data source.

    Default allocation:
      - AKShare: 8 threads (heavy, many concurrent batch downloads)
      - Yahoo: 3 threads (HTTP, lighter)
      - pytdx: 2 threads (TCP, lightweight but must not be blocked)
      - Shared fallback: 4 threads
    """

    def __init__(self) -> None:
        self._pools: dict[str, ThreadPoolExecutor] = {}
        self._configs: dict[str, PoolConfig] = {}
        self._default_pool: ThreadPoolExecutor | None = None

    def register(self, source_name: str, config: PoolConfig) -> None:
        """Register a thread pool for a data source."""
        self._configs[source_name] = config
        self._pools[source_name] = ThreadPoolExecutor(
            max_workers=config.max_workers,
            thread_name_prefix=config.thread_name_prefix,
        )
        logger.info(
            "Thread pool registered: %s (workers=%d, prefix=%s)",
            source_name,
            config.max_workers,
            config.thread_name_prefix,
        )

    def get_pool(self, source_name: str) -> ThreadPoolExecutor:
        """Get the thread pool for a source, falling back to shared pool."""
        if source_name in self._pools:
            return self._pools[source_name]
        if self._default_pool is None:
            self._default_pool = ThreadPoolExecutor(
                max_workers=4, thread_name_prefix="ds-shared"
            )
        return self._default_pool

    async def submit(self, source_name: str, func, *args, **kwargs):
        """Submit a synchronous function to the source's thread pool."""
        pool = self.get_pool(source_name)
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(pool, lambda: func(*args, **kwargs))

    def shutdown(self) -> None:
        """Shutdown all thread pools."""
        for pool in self._pools.values():
            pool.shutdown(wait=False)
        if self._default_pool:
            self._default_pool.shutdown(wait=False)

    def list_pools(self) -> list[dict]:
        """List all registered pools with their configs."""
        result = []
        for name, config in self._configs.items():
            pool = self._pools.get(name)
            result.append({
                "name": name,
                "max_workers": config.max_workers,
                "thread_prefix": config.thread_name_prefix,
                "active_threads": pool._threads if pool else 0,
            })
        return result


# Module-level singleton
_pool_manager: DataSourceThreadPool | None = None


def get_pool_manager() -> DataSourceThreadPool:
    """Get or create the singleton pool manager."""
    global _pool_manager
    if _pool_manager is None:
        _pool_manager = DataSourceThreadPool()
    return _pool_manager


def init_default_pools(
    akshare_threads: int = 8,
    yahoo_threads: int = 3,
    pytdx_threads: int = 2,
) -> DataSourceThreadPool:
    """Initialize pool manager with default configurations."""
    manager = get_pool_manager()
    manager.register("akshare", PoolConfig(max_workers=akshare_threads, thread_name_prefix="ak"))
    manager.register("yahoo", PoolConfig(max_workers=yahoo_threads, thread_name_prefix="yahoo"))
    manager.register("pytdx", PoolConfig(max_workers=pytdx_threads, thread_name_prefix="pytdx"))
    return manager

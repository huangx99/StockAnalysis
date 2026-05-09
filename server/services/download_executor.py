"""
DEPRECATED: This module is kept for backward compatibility.

New code should use the data source abstraction layer:
    from services.data_sources import get_registry, DataCapability

The per-source thread pools are now managed by DataSourceThreadPool.
"""

import asyncio
import os
from concurrent.futures import ThreadPoolExecutor


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


MAX_DOWNLOAD_THREADS = _env_int("DOWNLOAD_MAX_THREADS", 15, 1, 15)
STOCK_DOWNLOAD_CONCURRENCY = _env_int("STOCK_DOWNLOAD_CONCURRENCY", 8, 1, MAX_DOWNLOAD_THREADS)
MARKET_DATE_CONCURRENCY = _env_int("MARKET_DATE_CONCURRENCY", 3, 1, min(5, MAX_DOWNLOAD_THREADS))

_executor = ThreadPoolExecutor(max_workers=MAX_DOWNLOAD_THREADS, thread_name_prefix="stockdl")


def install_default_executor() -> None:
    """Install the global thread pool as the default executor for asyncio.

    Note: This is kept for backward compatibility. New code should use
    the per-source thread pools managed by DataSourceThreadPool.
    """
    try:
        asyncio.get_running_loop().set_default_executor(_executor)
    except RuntimeError:
        pass

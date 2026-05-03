import asyncio
import logging
import random
from collections.abc import Callable
from functools import wraps
from typing import Any

logger = logging.getLogger(__name__)


def async_retry(
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 10.0,
    exceptions: tuple = (Exception,),
) -> Callable:
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            last_exc: Exception | None = None
            for attempt in range(max_retries + 1):
                try:
                    return await func(*args, **kwargs)
                except exceptions as e:
                    last_exc = e
                    if attempt < max_retries:
                        delay = min(base_delay * (2**attempt), max_delay)
                        jitter = delay * random.uniform(0, 0.1)
                        wait = delay + jitter
                        logger.warning(
                            "%s attempt %d failed: %s. Retrying in %.1fs",
                            func.__name__,
                            attempt + 1,
                            e,
                            wait,
                        )
                        await asyncio.sleep(wait)
                    else:
                        logger.error(
                            "%s failed after %d attempts: %s",
                            func.__name__,
                            max_retries + 1,
                            e,
                        )
            raise last_exc  # type: ignore[misc]

        return wrapper

    return decorator

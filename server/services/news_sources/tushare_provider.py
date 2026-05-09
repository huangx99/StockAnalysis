"""Tushare news provider."""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime
from typing import Any

from .base import NewsProvider, RawNewsItem

logger = logging.getLogger(__name__)

_TUSHARE_TOKEN = os.environ.get("TUSHARE_TOKEN", "")


class TushareProvider(NewsProvider):
    """Tushare news API provider."""

    name = "tushare"

    def __init__(self) -> None:
        super().__init__()
        if not _TUSHARE_TOKEN:
            self.enabled = False
            logger.info("TushareProvider disabled: TUSHARE_TOKEN not set")

    async def fetch_news(self, limit: int = 100) -> list[RawNewsItem]:
        """Fetch news from Tushare."""
        if not _TUSHARE_TOKEN:
            return []

        try:
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._fetch_sync, limit),
                timeout=30,
            )
        except Exception as e:
            logger.warning("Tushare news failed: %s", e)
            return []

    def _fetch_sync(self, limit: int) -> list[RawNewsItem]:
        """Synchronous Tushare news fetch."""
        try:
            import tushare as ts

            pro = ts.pro_api(_TUSHARE_TOKEN)

            # Fetch major news
            df = pro.news(
                start_date=datetime.now().strftime("%Y%m%d"),
                end_date=datetime.now().strftime("%Y%m%d"),
                src="sina",
            )

            items: list[RawNewsItem] = []
            if df is not None and not df.empty:
                for _, row in df.head(limit).iterrows():
                    title = str(row.get("title", ""))
                    if not title or len(title) < 4:
                        continue

                    pub_time = str(row.get("pub_date", ""))
                    dt = None
                    if pub_time:
                        try:
                            dt = datetime.strptime(pub_time, "%Y-%m-%d %H:%M:%S")
                        except ValueError:
                            try:
                                dt = datetime.strptime(pub_time, "%Y%m%d")
                            except ValueError:
                                pass

                    items.append(
                        RawNewsItem(
                            title=title,
                            content=str(row.get("content", "")),
                            source=str(row.get("src", "Tushare")),
                            url=str(row.get("url", "")),
                            publish_time=dt,
                            category="finance",
                        )
                    )

            logger.info("Tushare: fetched %d items", len(items))
            return items

        except ImportError:
            logger.warning("tushare not installed")
            return []
        except Exception as e:
            logger.warning("Tushare fetch error: %s", e)
            return []

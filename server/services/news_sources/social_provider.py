"""Social sentiment provider - 雪球热帖 + 东方财富股吧."""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime
from typing import Any

from .base import NewsProvider, RawNewsItem

logger = logging.getLogger(__name__)


class SocialProvider(NewsProvider):
    """Social media sentiment from 雪球 and 东方财富股吧."""

    name = "social"

    async def fetch_news(self, limit: int = 100) -> list[RawNewsItem]:
        items: list[RawNewsItem] = []

        xq_task = self._fetch_xueqiu(limit)
        gb_task = self._fetch_guba(limit)

        xq_items, gb_items = await asyncio.gather(xq_task, gb_task, return_exceptions=True)

        if isinstance(xq_items, list):
            items.extend(xq_items)
        if isinstance(gb_items, list):
            items.extend(gb_items)

        return items[:limit]

    # --- 雪球 ---

    async def _fetch_xueqiu(self, limit: int) -> list[RawNewsItem]:
        try:
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._fetch_xueqiu_sync, limit),
                timeout=30,
            )
        except Exception as e:
            logger.warning("Xueqiu fetch failed: %s", e)
            return []

    def _fetch_xueqiu_sync(self, limit: int) -> list[RawNewsItem]:
        """Fetch hot posts from Xueqiu."""
        import requests

        items: list[RawNewsItem] = []
        try:
            session = requests.Session()
            session.headers.update({
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            })
            # Visit homepage to get session cookie
            session.get("https://xueqiu.com/", timeout=10)

            # Fetch hot posts
            r = session.get(
                "https://xueqiu.com/statuses/hot/listV2.json",
                params={"since_id": -1, "max_id": -1, "size": min(limit, 50)},
                timeout=15,
            )
            r.raise_for_status()
            data = r.json()

            for item in data.get("items", []):
                original = item.get("original_status", {}) or item
                title = original.get("title", "") or original.get("text", "")
                if not title:
                    continue

                # Clean HTML from text
                text = original.get("text", "")
                text = re.sub(r"<[^>]+>", "", text)

                if not original.get("title") and text:
                    title = text[:80]
                    if len(text) > 80:
                        title += "..."

                ts = original.get("created_at", 0)
                dt = None
                if ts:
                    try:
                        dt = datetime.fromtimestamp(ts / 1000) if ts > 1e10 else datetime.fromtimestamp(ts)
                    except Exception:
                        pass

                user = original.get("user", {}) or {}
                author = user.get("screen_name", "")

                tags = ["雪球", "社交舆情"]
                if author:
                    tags.append(author)

                items.append(RawNewsItem(
                    title=title,
                    content=text[:500] if text else "",
                    source="雪球",
                    url=f"https://xueqiu.com{original.get('target', '')}" if original.get("target") else "",
                    publish_time=dt,
                    tags=tags,
                    category="social",
                ))

            logger.info("Xueqiu: fetched %d hot posts", len(items))
        except Exception as e:
            logger.warning("Xueqiu sync error: %s", e)
        return items

    # --- 东方财富股吧 ---

    async def _fetch_guba(self, limit: int) -> list[RawNewsItem]:
        try:
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._fetch_guba_sync, limit),
                timeout=30,
            )
        except Exception as e:
            logger.warning("Guba fetch failed: %s", e)
            return []

    def _fetch_guba_sync(self, limit: int) -> list[RawNewsItem]:
        """Fetch hot posts from 东方财富股吧."""
        import requests

        items: list[RawNewsItem] = []
        try:
            # Try the hot posts API
            r = requests.get(
                "https://guba.eastmoney.com/remenba.aspx",
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
                timeout=15,
            )
            r.raise_for_status()
            html = r.text

            # Parse hot post links from the page
            posts = re.findall(
                r'<a[^>]+href="(//guba\.eastmoney\.com/news[^"]*)"[^>]*title="([^"]+)"',
                html,
            )
            if not posts:
                # Alternative pattern
                posts = re.findall(
                    r'<a[^>]+href="(/news[^"]*)"[^>]*>([^<]{8,})</a>',
                    html,
                )

            for href, title in posts[:limit]:
                title = title.strip()
                if not title or len(title) < 6:
                    continue
                if href.startswith("//"):
                    url = f"https:{href}"
                elif href.startswith("/"):
                    url = f"https://guba.eastmoney.com{href}"
                else:
                    url = href

                items.append(RawNewsItem(
                    title=title,
                    content="",
                    source="东方财富股吧",
                    url=url,
                    publish_time=datetime.now(),
                    tags=["股吧", "社交舆情"],
                    category="social",
                ))

            # Also try the API endpoint
            if len(items) < 10:
                try:
                    api_url = "https://gbapi.eastmoney.com/senti/api/v1/list"
                    r2 = requests.get(
                        api_url,
                        params={"ps": 30, "p": 1, "type": "hot"},
                        headers={"User-Agent": "Mozilla/5.0"},
                        timeout=10,
                    )
                    if r2.ok:
                        data = r2.json()
                        for post in data.get("data", {}).get("list", []):
                            title = post.get("title", "")
                            if not title or len(title) < 6:
                                continue
                            items.append(RawNewsItem(
                                title=title,
                                content=post.get("content", "")[:500],
                                source="东方财富股吧",
                                url=f"https://guba.eastmoney.com/news,{post.get('post_id', '')}.html",
                                publish_time=datetime.now(),
                                tags=["股吧", "社交舆情"],
                                category="social",
                            ))
                except Exception:
                    pass

            logger.info("Guba: fetched %d items", len(items))
        except Exception as e:
            logger.warning("Guba sync error: %s", e)
        return items

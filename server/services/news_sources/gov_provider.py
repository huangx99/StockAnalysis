"""Government policy news provider - 国务院 + 监管机构政策."""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime
from typing import Any

import requests

from .base import NewsProvider, RawNewsItem

logger = logging.getLogger(__name__)

_GOV_POLICY_URL = "https://www.gov.cn/zhengce/zuixin/ZUIXINZHENGCE.json"
_GOV_GONGBAO_URL = "https://www.gov.cn/gongbao/zuixin/gongbao.json"

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json, text/plain, */*",
}

# Regulator announcement pages
_REGULATOR_PAGES = [
    {
        "name": "央行",
        "url": "http://www.pbc.gov.cn/goutongjiaoliu/113456/113469/index.html",
        "tags": ["央行", "货币政策"],
    },
    {
        "name": "证监会",
        "url": "http://www.csrc.gov.cn/csrc/c100028/zfxxgk_zdgk.shtml",
        "tags": ["证监会", "监管"],
    },
    {
        "name": "发改委",
        "url": "https://www.ndrc.gov.cn/xxgk/zcfb/",
        "tags": ["发改委", "政策"],
    },
    {
        "name": "工信部",
        "url": "https://www.miit.gov.cn/zwgk/zcwj/",
        "tags": ["工信部", "产业政策"],
    },
]


class GovProvider(NewsProvider):
    """国务院政策 + 央行/证监会/发改委/工信部公告."""

    name = "gov"

    async def fetch_news(self, limit: int = 100) -> list[RawNewsItem]:
        """Fetch latest government policies, bulletins, and regulator announcements."""
        items: list[RawNewsItem] = []

        # 国务院最新政策
        policy_items = await self._fetch_json(_GOV_POLICY_URL, "国务院政策", limit)
        items.extend(policy_items)

        # 国务院公报
        if len(items) < limit:
            gongbao_items = await self._fetch_json(
                _GOV_GONGBAO_URL, "国务院公报", limit - len(items)
            )
            items.extend(gongbao_items)

        # 监管机构公告
        if len(items) < limit:
            regulator_items = await self._fetch_regulator_news(limit - len(items))
            items.extend(regulator_items)

        return items[:limit]

    async def _fetch_json(
        self, url: str, source: str, limit: int
    ) -> list[RawNewsItem]:
        try:
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._fetch_json_sync, url, source, limit),
                timeout=30,
            )
        except Exception as e:
            logger.warning("Gov fetch(%s) failed: %s", source, e)
            return []

    def _fetch_json_sync(
        self, url: str, source: str, limit: int
    ) -> list[RawNewsItem]:
        items: list[RawNewsItem] = []
        try:
            r = requests.get(url, headers=_HEADERS, timeout=20)
            r.raise_for_status()
            data = r.json()

            if not isinstance(data, list):
                return []

            for entry in data[:limit]:
                title = entry.get("TITLE", "").strip()
                if not title:
                    continue

                pub_date = entry.get("DOCRELPUBTIME", "")
                dt = None
                if pub_date:
                    try:
                        dt = datetime.strptime(pub_date[:10], "%Y-%m-%d")
                    except ValueError:
                        pass

                category = "policy"
                if "公报" in source:
                    category = "bulletin"
                elif any(kw in title for kw in ["办法", "规定", "条例", "法"]):
                    category = "regulation"
                elif any(kw in title for kw in ["意见", "通知", "批复"]):
                    category = "directive"

                items.append(
                    RawNewsItem(
                        title=title,
                        content=entry.get("SUB_TITLE", ""),
                        source=source,
                        url=entry.get("URL", ""),
                        publish_time=dt,
                        tags=["国务院", "政策"],
                        category=category,
                    )
                )

            logger.info("Gov %s: fetched %d items", source, len(items))
        except Exception as e:
            logger.warning("Gov fetch error(%s): %s", source, e)

        return items

    async def _fetch_regulator_news(self, limit: int) -> list[RawNewsItem]:
        """Fetch from 央行/证监会/发改委/工信部 in parallel."""
        per_regulator = max(limit // len(_REGULATOR_PAGES), 10)
        tasks = [
            self._fetch_single_regulator(reg, per_regulator)
            for reg in _REGULATOR_PAGES
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        items: list[RawNewsItem] = []
        for result in results:
            if isinstance(result, list):
                items.extend(result)
        return items[:limit]

    async def _fetch_single_regulator(
        self, reg: dict, limit: int
    ) -> list[RawNewsItem]:
        try:
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._scrape_regulator, reg, limit),
                timeout=20,
            )
        except Exception as e:
            logger.warning("Regulator %s failed: %s", reg["name"], e)
            return []

    def _scrape_regulator(self, reg: dict, limit: int) -> list[RawNewsItem]:
        """Scrape a regulator's announcement listing page."""
        items: list[RawNewsItem] = []
        try:
            r = requests.get(
                reg["url"],
                headers=_HEADERS,
                timeout=15,
            )
            r.raise_for_status()
            html = r.text

            # Generic pattern for Chinese gov site announcement lists
            links = re.findall(
                r'<a[^>]+href="([^"]*)"[^>]*>([^<]{6,})</a>',
                html,
            )

            for href, title in links[:limit * 2]:
                title = title.strip()
                if not title or len(title) < 6:
                    continue
                # Skip navigation/footer links
                if any(skip in title for skip in ["首页", "关于", "联系", "版权", "网站地图", "更多"]):
                    continue

                # Build absolute URL
                if href.startswith("http"):
                    url = href
                elif href.startswith("/"):
                    from urllib.parse import urlparse
                    parsed = urlparse(reg["url"])
                    url = f"{parsed.scheme}://{parsed.netloc}{href}"
                else:
                    continue

                items.append(RawNewsItem(
                    title=title,
                    content="",
                    source=reg["name"],
                    url=url,
                    publish_time=datetime.now(),
                    tags=reg["tags"],
                    category="policy",
                ))
                if len(items) >= limit:
                    break

            logger.info("Regulator %s: fetched %d items", reg["name"], len(items))
        except Exception as e:
            logger.warning("Regulator %s scrape error: %s", reg["name"], e)
        return items

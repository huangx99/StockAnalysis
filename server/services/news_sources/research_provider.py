"""Research report provider - 东方财富研报 + 慧博研报."""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from .base import NewsProvider, RawNewsItem

logger = logging.getLogger(__name__)


def _load_active_symbols() -> list[str]:
    snapshot = Path(__file__).parent.parent.parent / "data" / "data_stocks_snapshot.json"
    symbols = ["000001", "600519", "000858", "601318", "600036",
               "002594", "601012", "600900", "000333", "300750",
               "002475", "601888", "600276", "000568", "300059",
               "002714", "603259", "601899", "000858", "002415"]
    if snapshot.exists():
        try:
            import json
            data = json.loads(snapshot.read_text(encoding="utf-8"))
            if isinstance(data, list):
                symbols = [s.get("symbol", "") for s in data[:20] if s.get("symbol")]
        except Exception:
            pass
    return symbols


class ResearchProvider(NewsProvider):
    """Research reports from 东方财富 + 慧博研报."""

    name = "research"

    async def fetch_news(self, limit: int = 100) -> list[RawNewsItem]:
        items: list[RawNewsItem] = []

        em_task = self._fetch_eastmoney_reports(limit)
        hb_task = self._fetch_hibor(limit)

        em_items, hb_items = await asyncio.gather(em_task, hb_task, return_exceptions=True)

        if isinstance(em_items, list):
            items.extend(em_items)
        if isinstance(hb_items, list):
            items.extend(hb_items)

        return items[:limit]

    async def _fetch_eastmoney_reports(self, limit: int) -> list[RawNewsItem]:
        """Fetch research reports via AKShare stock_research_report_em."""
        try:
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._fetch_em_sync, limit),
                timeout=120,
            )
        except Exception as e:
            logger.warning("EastMoney research reports failed: %s", e)
            return []

    def _fetch_em_sync(self, limit: int) -> list[RawNewsItem]:
        """Sync fetch of research reports for top active stocks."""
        items: list[RawNewsItem] = []
        try:
            import akshare as ak

            symbols = _load_active_symbols()
            per_stock = max(limit // len(symbols), 5)

            for symbol in symbols:
                try:
                    df = ak.stock_research_report_em(symbol=symbol)
                    if df is None or df.empty:
                        continue

                    count = 0
                    for _, row in df.iterrows():
                        if count >= per_stock:
                            break

                        title = str(row.get("报告名称", "") or row.get("标题", ""))
                        if not title or len(title) < 4:
                            continue

                        institution = str(row.get("机构", "") or row.get("研究机构", ""))
                        analyst = str(row.get("研究员", "") or row.get("作者", ""))
                        pub_date = str(row.get("日期", "") or row.get("发布日期", ""))

                        dt = None
                        if pub_date:
                            try:
                                dt = datetime.strptime(pub_date[:10], "%Y-%m-%d")
                            except ValueError:
                                pass

                        content_parts = []
                        if institution:
                            content_parts.append(f"机构：{institution}")
                        if analyst:
                            content_parts.append(f"分析师：{analyst}")
                        rating = str(row.get("评级", "") or row.get("最新评级", ""))
                        if rating:
                            content_parts.append(f"评级：{rating}")

                        tags = ["研报"]
                        if institution:
                            tags.append(institution)
                        if symbol:
                            tags.append(symbol)

                        items.append(RawNewsItem(
                            title=title,
                            content="；".join(content_parts),
                            source="东方财富研报",
                            url="",
                            publish_time=dt,
                            tags=tags,
                            category="research",
                        ))
                        count += 1

                except Exception as e:
                    logger.debug("Research report for %s failed: %s", symbol, e)

            logger.info("EastMoney research: fetched %d reports from %d symbols",
                        len(items), len(symbols))
        except Exception as e:
            logger.warning("EastMoney research sync error: %s", e)
        return items

    async def _fetch_hibor(self, limit: int) -> list[RawNewsItem]:
        """Fetch from 慧博研报 website."""
        try:
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._fetch_hibor_sync, limit),
                timeout=30,
            )
        except Exception as e:
            logger.warning("Hibor fetch failed: %s", e)
            return []

    def _fetch_hibor_sync(self, limit: int) -> list[RawNewsItem]:
        """Scrape 慧博研报 listing page."""
        import requests

        items: list[RawNewsItem] = []
        try:
            r = requests.get(
                "https://www.hibor.com.cn/research.html",
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
                timeout=15,
            )
            r.raise_for_status()
            html = r.text

            # Parse research report links
            links = re.findall(
                r'<a[^>]+href="(/research[^"]*)"[^>]*>([^<]{6,})</a>',
                html,
            )
            for href, title in links[:limit]:
                title = title.strip()
                if not title or len(title) < 6:
                    continue
                url = f"https://www.hibor.com.cn{href}" if href.startswith("/") else href
                items.append(RawNewsItem(
                    title=title,
                    content="",
                    source="慧博研报",
                    url=url,
                    publish_time=datetime.now(),
                    tags=["研报", "慧博"],
                    category="research",
                ))

            logger.info("Hibor: fetched %d items", len(items))
        except Exception as e:
            logger.warning("Hibor sync error: %s", e)
        return items

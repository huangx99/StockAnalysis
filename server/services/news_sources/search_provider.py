"""Real-time web news search provider - aggregates 9 search engines."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime
from typing import Any
from urllib.parse import quote

from .base import NewsProvider, RawNewsItem
from .dedup import semantic_dedup

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}


def _parse_timestamp(ts) -> datetime | None:
    """Parse a timestamp (int/float/str) to datetime."""
    if not ts:
        return None
    try:
        if isinstance(ts, (int, float)):
            return datetime.fromtimestamp(ts)
        return datetime.strptime(str(ts).strip(), "%Y-%m-%d %H:%M:%S")
    except (ValueError, OSError):
        return None


class SearchProvider(NewsProvider):
    """Real-time news search across multiple search engines."""

    name = "search"
    enabled = True

    async def fetch_news(self, limit: int = 100) -> list[RawNewsItem]:
        return []

    async def search_news(
        self, keyword: str, limit: int = 20
    ) -> list[RawNewsItem]:
        tasks = [
            self._search_baidu(keyword, limit),
            self._search_sogou(keyword, limit),
            self._search_sina(keyword, limit),
            self._search_bing(keyword, limit),
            self._search_360(keyword, limit),
            self._search_toutiao(keyword, limit),
            self._search_netease(keyword, limit),
            self._search_tencent(keyword, limit),
            self._search_sohu(keyword, limit),
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        all_items: list[RawNewsItem] = []
        for result in results:
            if isinstance(result, Exception):
                self._logger.warning("Search source failed: %s", result)
                continue
            all_items.extend(result)

        deduped = semantic_dedup(all_items)
        deduped.sort(key=lambda x: x.publish_time or datetime.min, reverse=True)
        self._logger.info(
            "Search '%s': %d raw → %d deduped (9 sources)", keyword, len(all_items), len(deduped)
        )
        return deduped[:limit]

    async def _search_baidu(
        self, keyword: str, limit: int
    ) -> list[RawNewsItem]:
        """Search Baidu News."""
        try:
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._baidu_sync, keyword, limit),
                timeout=15.0,
            )
        except Exception as e:
            self._logger.warning("Baidu search(%s) failed: %s", keyword, e)
            return []

    def _baidu_sync(self, keyword: str, limit: int) -> list[RawNewsItem]:
        import requests

        items: list[RawNewsItem] = []
        url = f"https://www.baidu.com/s?tn=news&word={quote(keyword)}&rn={min(limit, 50)}"
        try:
            r = requests.get(url, headers=_HEADERS, timeout=10)
            r.raise_for_status()
            html = r.text

            # Extract news items from Baidu news results
            # Pattern: result blocks with title, abstract, source, time
            blocks = re.findall(
                r'<div[^>]*class="result"[^>]*>(.*?)</div>\s*</div>',
                html, re.DOTALL
            )
            if not blocks:
                # Fallback: try alternate pattern
                blocks = re.findall(
                    r'<div[^>]*id="([0-9]+)"[^>]*class="result[^"]*"[^>]*>(.*?)</div>\s*(?=<div[^>]*class="result|$)',
                    html, re.DOTALL
                )
                blocks = [b[1] for b in blocks]

            for block in blocks[:limit]:
                title_match = re.search(r'<h3[^>]*>(.*?)</h3>', block, re.DOTALL)
                if not title_match:
                    continue
                title_html = title_match[1]
                title = re.sub(r'<[^>]+>', '', title_html).strip()
                if not title:
                    continue

                # Extract link
                link_match = re.search(r'href="([^"]+)"', title_html)
                url_str = link_match[1] if link_match else ""

                # Extract source and time
                source = ""
                pub_time = None
                source_match = re.search(
                    r'<span[^>]*class="[^"]*source[^"]*"[^>]*>(.*?)</span>',
                    block, re.DOTALL
                )
                if source_match:
                    source_text = re.sub(r'<[^>]+>', '', source_match[1]).strip()
                    source = source_text

                time_match = re.search(r'(\d{4}-\d{2}-\d{2}\s*\d{2}:\d{2})', block)
                if time_match:
                    try:
                        pub_time = datetime.strptime(time_match[1], "%Y-%m-%d %H:%M")
                    except ValueError:
                        pass

                # Extract abstract
                abstract = ""
                abs_match = re.search(
                    r'<p[^>]*class="[^"]*c-color[^"]*"[^>]*>(.*?)</p>',
                    block, re.DOTALL
                )
                if abs_match:
                    abstract = re.sub(r'<[^>]+>', '', abs_match[1]).strip()

                items.append(RawNewsItem(
                    title=title,
                    content=abstract or title,
                    source=source or "百度新闻",
                    url=url_str,
                    publish_time=pub_time,
                    category="finance",
                ))
        except Exception as e:
            logger.debug("Baidu parse error: %s", e)

        return items

    async def _search_sogou(
        self, keyword: str, limit: int
    ) -> list[RawNewsItem]:
        """Search Sogou News."""
        try:
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._sogou_sync, keyword, limit),
                timeout=15.0,
            )
        except Exception as e:
            self._logger.warning("Sogou search(%s) failed: %s", keyword, e)
            return []

    def _sogou_sync(self, keyword: str, limit: int) -> list[RawNewsItem]:
        import requests

        items: list[RawNewsItem] = []
        url = f"https://news.sogou.com/news?query={quote(keyword)}&num={min(limit, 50)}"
        try:
            r = requests.get(url, headers=_HEADERS, timeout=10)
            r.raise_for_status()
            html = r.text

            # Sogou news result blocks
            blocks = re.findall(
                r'<div[^>]*class="[^"]*vrwrap[^"]*"[^>]*>(.*?)</div>\s*</div>',
                html, re.DOTALL
            )
            if not blocks:
                blocks = re.findall(
                    r'<div[^>]*class="[^"]*rb[^"]*"[^>]*>(.*?)</div>\s*</div>',
                    html, re.DOTALL
                )

            for block in blocks[:limit]:
                title_match = re.search(r'<h3[^>]*>(.*?)</h3>', block, re.DOTALL)
                if not title_match:
                    continue
                title_html = title_match[1]
                title = re.sub(r'<[^>]+>', '', title_html).strip()
                if not title:
                    continue

                link_match = re.search(r'href="([^"]+)"', title_html)
                url_str = link_match[1] if link_match else ""

                source = ""
                pub_time = None
                info_match = re.search(
                    r'<p[^>]*class="[^"]*news-from[^"]*"[^>]*>(.*?)</p>',
                    block, re.DOTALL
                )
                if info_match:
                    info_text = re.sub(r'<[^>]+>', '', info_match[1]).strip()
                    parts = info_text.split()
                    if parts:
                        source = parts[0]
                    time_match = re.search(r'(\d{4}-\d{2}-\d{2}\s*\d{2}:\d{2})', info_text)
                    if time_match:
                        try:
                            pub_time = datetime.strptime(time_match[1], "%Y-%m-%d %H:%M")
                        except ValueError:
                            pass

                abstract = ""
                abs_match = re.search(
                    r'<p[^>]*class="[^"]*txt-info[^"]*"[^>]*>(.*?)</p>',
                    block, re.DOTALL
                )
                if abs_match:
                    abstract = re.sub(r'<[^>]+>', '', abs_match[1]).strip()

                items.append(RawNewsItem(
                    title=title,
                    content=abstract or title,
                    source=source or "搜狗新闻",
                    url=url_str,
                    publish_time=pub_time,
                    category="finance",
                ))
        except Exception as e:
            logger.debug("Sogou parse error: %s", e)

        return items

    async def _search_sina(
        self, keyword: str, limit: int
    ) -> list[RawNewsItem]:
        """Search Sina News."""
        try:
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._sina_sync, keyword, limit),
                timeout=15.0,
            )
        except Exception as e:
            self._logger.warning("Sina search(%s) failed: %s", keyword, e)
            return []

    def _sina_sync(self, keyword: str, limit: int) -> list[RawNewsItem]:
        import requests

        items: list[RawNewsItem] = []
        url = f"https://search.sina.com.cn/news?q={quote(keyword)}&range=all&c=news&sort=time&num={min(limit, 50)}"
        try:
            r = requests.get(url, headers=_HEADERS, timeout=10)
            r.raise_for_status()
            html = r.text

            blocks = re.findall(
                r'<div[^>]*class="[^"]*box-result[^"]*"[^>]*>(.*?)</div>\s*</div>',
                html, re.DOTALL
            )

            for block in blocks[:limit]:
                title_match = re.search(r'<h2[^>]*>(.*?)</h2>', block, re.DOTALL)
                if not title_match:
                    continue
                title_html = title_match[1]
                title = re.sub(r'<[^>]+>', '', title_html).strip()
                if not title:
                    continue

                link_match = re.search(r'href="([^"]+)"', title_html)
                url_str = link_match[1] if link_match else ""

                source = ""
                pub_time = None
                info_match = re.search(
                    r'<span[^>]*class="[^"]*fgray_time[^"]*"[^>]*>(.*?)</span>',
                    block, re.DOTALL
                )
                if info_match:
                    info_text = re.sub(r'<[^>]+>', '', info_match[1]).strip()
                    parts = info_text.split()
                    if len(parts) >= 2:
                        source = parts[0]
                    time_match = re.search(r'(\d{4}-\d{2}-\d{2}\s*\d{2}:\d{2})', info_text)
                    if time_match:
                        try:
                            pub_time = datetime.strptime(time_match[1], "%Y-%m-%d %H:%M")
                        except ValueError:
                            pass

                abstract = ""
                abs_match = re.search(
                    r'<p[^>]*>(.*?)</p>',
                    block, re.DOTALL
                )
                if abs_match:
                    abstract = re.sub(r'<[^>]+>', '', abs_match[1]).strip()

                items.append(RawNewsItem(
                    title=title,
                    content=abstract or title,
                    source=source or "新浪新闻",
                    url=url_str,
                    publish_time=pub_time,
                    category="finance",
                ))
        except Exception as e:
            logger.debug("Sina parse error: %s", e)

        return items

    # ── Bing News ──

    async def _search_bing(self, keyword: str, limit: int) -> list[RawNewsItem]:
        """Search Bing News (China)."""
        try:
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._bing_sync, keyword, limit),
                timeout=15.0,
            )
        except Exception as e:
            self._logger.warning("Bing search(%s) failed: %s", keyword, e)
            return []

    def _bing_sync(self, keyword: str, limit: int) -> list[RawNewsItem]:
        import requests

        items: list[RawNewsItem] = []
        url = f"https://cn.bing.com/news/search?q={quote(keyword)}&form=NSBABR"
        headers = {**_HEADERS, "Referer": "https://cn.bing.com/"}
        try:
            r = requests.get(url, headers=headers, timeout=10)
            r.raise_for_status()
            html = r.text

            # Bing news cards
            blocks = re.findall(
                r'<div[^>]*class="[^"]*news-card[^"]*"[^>]*>(.*?)</div>\s*</div>\s*</div>',
                html, re.DOTALL
            )
            if not blocks:
                blocks = re.findall(
                    r'<div[^>]*class="[^"]*t_s[^"]*"[^>]*>(.*?)</div>\s*</a>',
                    html, re.DOTALL
                )

            for block in blocks[:limit]:
                title_match = re.search(r'<a[^>]*>(.*?)</a>', block, re.DOTALL)
                if not title_match:
                    continue
                title = re.sub(r'<[^>]+>', '', title_match[1]).strip()
                if not title or len(title) < 4:
                    continue

                link_match = re.search(r'href="([^"]+)"', block)
                url_str = link_match[1] if link_match else ""

                source = ""
                pub_time = None
                source_match = re.search(
                    r'<span[^>]*class="[^"]*source[^"]*"[^>]*>(.*?)</span>',
                    block, re.DOTALL
                )
                if source_match:
                    source = re.sub(r'<[^>]+>', '', source_match[1]).strip()

                time_match = re.search(r'(\d{4}-\d{2}-\d{2}\s*\d{2}:\d{2})', block)
                if time_match:
                    try:
                        pub_time = datetime.strptime(time_match[1], "%Y-%m-%d %H:%M")
                    except ValueError:
                        pass

                abstract = ""
                abs_match = re.search(
                    r'<div[^>]*class="[^"]*snippet[^"]*"[^>]*>(.*?)</div>',
                    block, re.DOTALL
                )
                if abs_match:
                    abstract = re.sub(r'<[^>]+>', '', abs_match[1]).strip()

                items.append(RawNewsItem(
                    title=title,
                    content=abstract or title,
                    source=source or "必应新闻",
                    url=url_str,
                    publish_time=pub_time,
                    category="finance",
                ))
        except Exception as e:
            logger.debug("Bing parse error: %s", e)

        return items

    # ── 360 Search ──

    async def _search_360(self, keyword: str, limit: int) -> list[RawNewsItem]:
        """Search 360 News."""
        try:
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._360_sync, keyword, limit),
                timeout=15.0,
            )
        except Exception as e:
            self._logger.warning("360 search(%s) failed: %s", keyword, e)
            return []

    def _360_sync(self, keyword: str, limit: int) -> list[RawNewsItem]:
        import requests

        items: list[RawNewsItem] = []
        url = f"https://so.com/s?q={quote(keyword)}&src=tab_www_news"
        try:
            r = requests.get(url, headers=_HEADERS, timeout=10)
            r.raise_for_status()
            html = r.text

            blocks = re.findall(
                r'<div[^>]*class="[^"]*res-list[^"]*"[^>]*>(.*?)</div>\s*</div>',
                html, re.DOTALL
            )
            if not blocks:
                blocks = re.findall(
                    r'<li[^>]*class="[^"]*res-list[^"]*"[^>]*>(.*?)</li>',
                    html, re.DOTALL
                )

            for block in blocks[:limit]:
                title_match = re.search(r'<h3[^>]*>(.*?)</h3>', block, re.DOTALL)
                if not title_match:
                    continue
                title = re.sub(r'<[^>]+>', '', title_match[1]).strip()
                if not title or len(title) < 4:
                    continue

                link_match = re.search(r'href="([^"]+)"', title_match[1])
                if not link_match:
                    link_match = re.search(r'href="([^"]+)"', block)
                url_str = link_match[1] if link_match else ""

                source = ""
                pub_time = None
                info_match = re.search(
                    r'<span[^>]*class="[^"]*newsFrom[^"]*"[^>]*>(.*?)</span>',
                    block, re.DOTALL
                )
                if info_match:
                    info_text = re.sub(r'<[^>]+>', '', info_match[1]).strip()
                    parts = info_text.split()
                    if parts:
                        source = parts[0]
                    time_match = re.search(r'(\d{4}-\d{2}-\d{2}\s*\d{2}:\d{2})', info_text)
                    if time_match:
                        try:
                            pub_time = datetime.strptime(time_match[1], "%Y-%m-%d %H:%M")
                        except ValueError:
                            pass

                abstract = ""
                abs_match = re.search(
                    r'<p[^>]*class="[^"]*res-desc[^"]*"[^>]*>(.*?)</p>',
                    block, re.DOTALL
                )
                if abs_match:
                    abstract = re.sub(r'<[^>]+>', '', abs_match[1]).strip()

                items.append(RawNewsItem(
                    title=title,
                    content=abstract or title,
                    source=source or "360新闻",
                    url=url_str,
                    publish_time=pub_time,
                    category="finance",
                ))
        except Exception as e:
            logger.debug("360 parse error: %s", e)

        return items

    # ── Toutiao Search ──

    async def _search_toutiao(self, keyword: str, limit: int) -> list[RawNewsItem]:
        """Search Toutiao (头条) News."""
        try:
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._toutiao_sync, keyword, limit),
                timeout=15.0,
            )
        except Exception as e:
            self._logger.warning("Toutiao search(%s) failed: %s", keyword, e)
            return []

    def _toutiao_sync(self, keyword: str, limit: int) -> list[RawNewsItem]:
        import requests

        items: list[RawNewsItem] = []
        url = f"https://so.toutiao.com/search?keyword={quote(keyword)}&pd=synthesis"
        headers = {**_HEADERS, "Referer": "https://www.toutiao.com/"}
        try:
            r = requests.get(url, headers=headers, timeout=10)
            r.raise_for_status()
            html = r.text

            # Try JSON data embedded in page
            json_match = re.search(r'rawData\s*=\s*(\{.*?\});\s*</script>', html, re.DOTALL)
            if json_match:
                try:
                    data = json.loads(json_match.group(1))
                    for item_data in data.get("data", []):
                        if item_data.get("card_type") != "news":
                            continue
                        title = item_data.get("title", "").strip()
                        if not title:
                            continue
                        title = re.sub(r'<[^>]+>', '', title)
                        items.append(RawNewsItem(
                            title=title,
                            content=item_data.get("abstract", "") or title,
                            source=item_data.get("source", "头条"),
                            url=item_data.get("url", ""),
                            publish_time=_parse_timestamp(item_data.get("publish_time")),
                            category="finance",
                        ))
                        if len(items) >= limit:
                            break
                except (json.JSONDecodeError, KeyError):
                    pass

            # Fallback: HTML scraping
            if not items:
                blocks = re.findall(
                    r'<div[^>]*class="[^"]*result-content[^"]*"[^>]*>(.*?)</div>\s*</div>',
                    html, re.DOTALL
                )
                for block in blocks[:limit]:
                    title_match = re.search(r'<a[^>]*>(.*?)</a>', block, re.DOTALL)
                    if not title_match:
                        continue
                    title = re.sub(r'<[^>]+>', '', title_match[1]).strip()
                    if not title or len(title) < 4:
                        continue
                    link_match = re.search(r'href="([^"]+)"', block)
                    url_str = link_match[1] if link_match else ""
                    source = ""
                    source_match = re.search(r'<span[^>]*>(.*?)</span>', block)
                    if source_match:
                        source = re.sub(r'<[^>]+>', '', source_match[1]).strip()
                    items.append(RawNewsItem(
                        title=title,
                        content=title,
                        source=source or "头条",
                        url=url_str,
                        category="finance",
                    ))

        except Exception as e:
            logger.debug("Toutiao parse error: %s", e)

        return items

    # ── NetEase News ──

    async def _search_netease(self, keyword: str, limit: int) -> list[RawNewsItem]:
        """Search NetEase (网易) News."""
        try:
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._netease_sync, keyword, limit),
                timeout=15.0,
            )
        except Exception as e:
            self._logger.warning("NetEase search(%s) failed: %s", keyword, e)
            return []

    def _netease_sync(self, keyword: str, limit: int) -> list[RawNewsItem]:
        import requests

        items: list[RawNewsItem] = []
        # NetEase news search via their search API
        url = f"https://www.163.com/search?keyword={quote(keyword)}"
        headers = {**_HEADERS, "Referer": "https://www.163.com/"}
        try:
            r = requests.get(url, headers=headers, timeout=10)
            r.raise_for_status()
            html = r.text

            blocks = re.findall(
                r'<div[^>]*class="[^"]*news_item[^"]*"[^>]*>(.*?)</div>\s*</div>',
                html, re.DOTALL
            )
            if not blocks:
                blocks = re.findall(
                    r'<li[^>]*class="[^"]*news-item[^"]*"[^>]*>(.*?)</li>',
                    html, re.DOTALL
                )

            for block in blocks[:limit]:
                title_match = re.search(r'<a[^>]*>(.*?)</a>', block, re.DOTALL)
                if not title_match:
                    continue
                title = re.sub(r'<[^>]+>', '', title_match[1]).strip()
                if not title or len(title) < 4:
                    continue

                link_match = re.search(r'href="([^"]+)"', block)
                url_str = link_match[1] if link_match else ""

                source = ""
                pub_time = None
                info_match = re.search(
                    r'<span[^>]*class="[^"]*source[^"]*"[^>]*>(.*?)</span>',
                    block, re.DOTALL
                )
                if info_match:
                    source = re.sub(r'<[^>]+>', '', info_match[1]).strip()

                time_match = re.search(r'(\d{4}-\d{2}-\d{2}\s*\d{2}:\d{2})', block)
                if time_match:
                    try:
                        pub_time = datetime.strptime(time_match[1], "%Y-%m-%d %H:%M")
                    except ValueError:
                        pass

                items.append(RawNewsItem(
                    title=title,
                    content=title,
                    source=source or "网易新闻",
                    url=url_str,
                    publish_time=pub_time,
                    category="finance",
                ))
        except Exception as e:
            logger.debug("NetEase parse error: %s", e)

        return items

    # ── Tencent News ──

    async def _search_tencent(self, keyword: str, limit: int) -> list[RawNewsItem]:
        """Search Tencent (腾讯) News."""
        try:
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._tencent_sync, keyword, limit),
                timeout=15.0,
            )
        except Exception as e:
            self._logger.warning("Tencent search(%s) failed: %s", keyword, e)
            return []

    def _tencent_sync(self, keyword: str, limit: int) -> list[RawNewsItem]:
        import requests

        items: list[RawNewsItem] = []
        # Tencent uses a JSON API for search
        url = f"https://i.news.qq.com/trpc.qqnews_web.kv_srv.kv_srv_http_proxy/list?sub_srv_id=24hours&srv_id=pc&offset=0&limit={limit}&strategy=1&ext=%7B%22pool%22%3A%5B%22high%22%2C%22top%22%5D%2C%22LatessRecall%22%3Atrue%2C%22need_filter_3C%22%3A1%7D&keyword={quote(keyword)}"
        headers = {
            **_HEADERS,
            "Referer": "https://news.qq.com/",
        }
        try:
            r = requests.get(url, headers=headers, timeout=10)
            r.raise_for_status()
            data = r.json()

            news_list = data.get("data", {}).get("list", [])
            for item_data in news_list[:limit]:
                title = item_data.get("title", "").strip()
                if not title:
                    continue
                title = re.sub(r'<[^>]+>', '', title)

                pub_time = None
                ts = item_data.get("publish_time") or item_data.get("time")
                if ts:
                    try:
                        if isinstance(ts, (int, float)):
                            pub_time = datetime.fromtimestamp(ts)
                        else:
                            pub_time = datetime.strptime(str(ts), "%Y-%m-%d %H:%M:%S")
                    except (ValueError, OSError):
                        pass

                items.append(RawNewsItem(
                    title=title,
                    content=item_data.get("abstract", "") or title,
                    source=item_data.get("source", "腾讯新闻"),
                    url=item_data.get("url", "") or item_data.get("link", ""),
                    publish_time=pub_time,
                    category="finance",
                ))
        except Exception as e:
            # Fallback: try HTML search
            try:
                url2 = f"https://news.qq.com/search?query={quote(keyword)}"
                r = requests.get(url2, headers=_HEADERS, timeout=10)
                r.raise_for_status()
                html = r.text
                blocks = re.findall(
                    r'<div[^>]*class="[^"]*news-item[^"]*"[^>]*>(.*?)</div>\s*</div>',
                    html, re.DOTALL
                )
                for block in blocks[:limit]:
                    title_match = re.search(r'<a[^>]*>(.*?)</a>', block, re.DOTALL)
                    if not title_match:
                        continue
                    title = re.sub(r'<[^>]+>', '', title_match[1]).strip()
                    if not title or len(title) < 4:
                        continue
                    link_match = re.search(r'href="([^"]+)"', block)
                    items.append(RawNewsItem(
                        title=title,
                        content=title,
                        source="腾讯新闻",
                        url=link_match[1] if link_match else "",
                        category="finance",
                    ))
            except Exception:
                logger.debug("Tencent parse error: %s", e)

        return items

    # ── Sohu News ──

    async def _search_sohu(self, keyword: str, limit: int) -> list[RawNewsItem]:
        """Search Sohu (搜狐) News."""
        try:
            loop = asyncio.get_event_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(None, self._sohu_sync, keyword, limit),
                timeout=15.0,
            )
        except Exception as e:
            self._logger.warning("Sohu search(%s) failed: %s", keyword, e)
            return []

    def _sohu_sync(self, keyword: str, limit: int) -> list[RawNewsItem]:
        import requests

        items: list[RawNewsItem] = []
        url = f"https://search.sohu.com/?keyword={quote(keyword)}&type=news"
        headers = {**_HEADERS, "Referer": "https://www.sohu.com/"}
        try:
            r = requests.get(url, headers=headers, timeout=10)
            r.raise_for_status()
            html = r.text

            blocks = re.findall(
                r'<div[^>]*class="[^"]*news-list[^"]*"[^>]*>(.*?)</div>\s*</div>',
                html, re.DOTALL
            )
            if not blocks:
                blocks = re.findall(
                    r'<div[^>]*class="[^"]*vrwrap[^"]*"[^>]*>(.*?)</div>\s*</div>',
                    html, re.DOTALL
                )

            for block in blocks[:limit]:
                title_match = re.search(r'<a[^>]*title="([^"]*)"', block)
                if not title_match:
                    title_match = re.search(r'<a[^>]*>(.*?)</a>', block, re.DOTALL)
                if not title_match:
                    continue
                title = re.sub(r'<[^>]+>', '', title_match[1 if 'title=' in str(title_match.re) else 1]).strip()
                if not title or len(title) < 4:
                    continue

                link_match = re.search(r'href="([^"]+)"', block)
                url_str = link_match[1] if link_match else ""

                source = ""
                pub_time = None
                source_match = re.search(
                    r'<span[^>]*class="[^"]*author[^"]*"[^>]*>(.*?)</span>',
                    block, re.DOTALL
                )
                if source_match:
                    source = re.sub(r'<[^>]+>', '', source_match[1]).strip()

                time_match = re.search(r'(\d{4}-\d{2}-\d{2}\s*\d{2}:\d{2})', block)
                if time_match:
                    try:
                        pub_time = datetime.strptime(time_match[1], "%Y-%m-%d %H:%M")
                    except ValueError:
                        pass

                abstract = ""
                abs_match = re.search(
                    r'<p[^>]*class="[^"]*desc[^"]*"[^>]*>(.*?)</p>',
                    block, re.DOTALL
                )
                if abs_match:
                    abstract = re.sub(r'<[^>]+>', '', abs_match[1]).strip()

                items.append(RawNewsItem(
                    title=title,
                    content=abstract or title,
                    source=source or "搜狐新闻",
                    url=url_str,
                    publish_time=pub_time,
                    category="finance",
                ))
        except Exception as e:
            logger.debug("Sohu parse error: %s", e)

        return items

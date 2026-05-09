"""Multi-level semantic deduplication for news items.

Level 1: Title similarity (SequenceMatcher)
Level 2: Entity fingerprint (stock codes, amounts, percentages, dates)
Level 3: Keyword overlap (character bigrams / jieba if available)
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from typing import Any

from .base import RawNewsItem

# Try importing jieba for better Chinese word segmentation
try:
    import jieba
    _HAS_JIEBA = True
except ImportError:
    _HAS_JIEBA = False


def _normalize_title(title: str) -> str:
    """Normalize title: strip HTML, punctuation, keep Chinese + alphanumeric."""
    title = re.sub(r'<[^>]+>', '', title)
    return re.sub(r'[^一-鿿\w]', '', title)[:40]


def _extract_entities(text: str) -> set[str]:
    """Extract key entities from text: stock codes, amounts, percentages, dates."""
    entities: set[str] = set()

    # Stock codes: 6-digit numbers (SH: 600xxx, SZ: 000xxx/002xxx/300xxx, BJ: 8xxxxx)
    for m in re.finditer(r'\b(\d{6})\b', text):
        code = m.group(1)
        if code[0] in '013689':
            entities.add(f"code:{code}")

    # Amounts: X万/亿/万亿
    for m in re.finditer(r'(\d+(?:\.\d+)?)\s*(万|亿|万亿|元|美元|港元)', text):
        entities.add(f"amount:{m.group(1)}{m.group(2)}")

    # Percentages: X% or X个百分点
    for m in re.finditer(r'(\d+(?:\.\d+)?)\s*[%％]', text):
        entities.add(f"pct:{m.group(1)}")

    # Dates: YYYY-MM-DD or YYYY年MM月DD日 or MM月DD日
    for m in re.finditer(r'(\d{4})[-年/.](\d{1,2})[-月/.](\d{1,2})', text):
        entities.add(f"date:{m.group(1)}{m.group(2).zfill(2)}{m.group(3).zfill(2)}")
    for m in re.finditer(r'(\d{1,2})月(\d{1,2})[日号]', text):
        entities.add(f"date:{m.group(1).zfill(2)}{m.group(2).zfill(2)}")

    # Key financial terms
    keywords = ['央行', '降息', '降准', '加息', '退市', 'ST', '摘帽', '重组',
                '增持', '减持', '回购', '分红', '送转', '业绩预告', '中报',
                '年报', '季报', 'IPO', '科创板', '北交所', '创业板']
    text_lower = text.lower()
    for kw in keywords:
        if kw.lower() in text_lower:
            entities.add(f"kw:{kw}")

    return entities


def _entity_jaccard(a: set[str], b: set[str]) -> float:
    """Jaccard similarity between two entity sets."""
    if not a and not b:
        return 0.0
    if not a or not b:
        return 0.0
    intersection = len(a & b)
    union = len(a | b)
    return intersection / union if union > 0 else 0.0


def _get_bigrams(text: str) -> set[str]:
    """Extract character bigrams from Chinese text."""
    # Remove non-Chinese characters
    chinese = re.sub(r'[^一-鿿]', '', text)
    if len(chinese) < 2:
        return set()
    return {chinese[i:i+2] for i in range(len(chinese) - 1)}


def _get_keywords(text: str) -> set[str]:
    """Extract keywords using jieba or fallback to bigrams."""
    if _HAS_JIEBA:
        words = jieba.lcut(text)
        # Keep words with length >= 2 that are not stopwords
        stopwords = {'的', '了', '在', '是', '我', '有', '和', '就', '不',
                     '人', '都', '一', '一个', '上', '也', '很', '到', '说',
                     '要', '去', '你', '会', '着', '没有', '看', '好', '自己',
                     '这', '他', '她', '它', '们', '那', '被', '从', '把'}
        return {w for w in words if len(w) >= 2 and w not in stopwords}
    else:
        return _get_bigrams(text)


def _keyword_overlap(a: set[str], b: set[str]) -> float:
    """Keyword overlap ratio (Jaccard-like but using smaller set as base)."""
    if not a and not b:
        return 0.0
    if not a or not b:
        return 0.0
    intersection = len(a & b)
    base = min(len(a), len(b))
    return intersection / base if base > 0 else 0.0


def _time_diff_hours(t1: datetime | None, t2: datetime | None) -> float:
    """Absolute time difference in hours. Returns inf if either is None."""
    if t1 is None or t2 is None:
        return float('inf')
    return abs((t1 - t2).total_seconds()) / 3600


def semantic_dedup(items: list[RawNewsItem], title_threshold: float = 0.70) -> list[RawNewsItem]:
    """Multi-level semantic deduplication.

    Level 1: Title similarity >= title_threshold (default 0.70)
    Level 2: Entity fingerprint Jaccard >= 0.60 (when time diff < 48h)
    Level 3: Keyword overlap >= 0.50 (when time diff < 2h)
    """
    if not items:
        return []
    if len(items) == 1:
        return items

    n = len(items)
    # Track which items to keep (index -> True means keep)
    keep = [True] * n

    # Pre-compute normalized titles, entities, keywords for all items
    norm_titles = [_normalize_title(item.title) for item in items]
    entities = [_extract_entities(item.title + " " + item.content) for item in items]
    keywords_set = [_get_keywords(item.title) for item in items]

    # Level 1: Coarse grouping by first 10 chars of normalized title
    title_groups: dict[str, list[int]] = {}
    for i, norm in enumerate(norm_titles):
        key = norm[:10]
        if key:
            title_groups.setdefault(key, []).append(i)

    for indices in title_groups.values():
        for a_idx in range(len(indices)):
            i = indices[a_idx]
            if not keep[i]:
                continue
            for b_idx in range(a_idx + 1, len(indices)):
                j = indices[b_idx]
                if not keep[j]:
                    continue
                ratio = SequenceMatcher(None, norm_titles[i], norm_titles[j]).ratio()
                if ratio >= title_threshold:
                    # Keep the one with longer content
                    if len(items[i].content) >= len(items[j].content):
                        keep[j] = False
                    else:
                        keep[i] = False
                        break

    # Level 2: Entity fingerprint comparison (for remaining items)
    remaining = [i for i in range(n) if keep[i]]
    for a_idx in range(len(remaining)):
        i = remaining[a_idx]
        if not keep[i]:
            continue
        for b_idx in range(a_idx + 1, len(remaining)):
            j = remaining[b_idx]
            if not keep[j]:
                continue
            # Only compare if time difference < 48 hours
            td = _time_diff_hours(items[i].publish_time, items[j].publish_time)
            if td > 48:
                continue
            jac = _entity_jaccard(entities[i], entities[j])
            if jac >= 0.60:
                if len(items[i].content) >= len(items[j].content):
                    keep[j] = False
                else:
                    keep[i] = False
                    break

    # Level 3: Keyword overlap (for remaining items, tighter time window)
    remaining = [i for i in range(n) if keep[i]]
    for a_idx in range(len(remaining)):
        i = remaining[a_idx]
        if not keep[i]:
            continue
        for b_idx in range(a_idx + 1, len(remaining)):
            j = remaining[b_idx]
            if not keep[j]:
                continue
            # Only compare if time difference < 2 hours
            td = _time_diff_hours(items[i].publish_time, items[j].publish_time)
            if td > 2:
                continue
            overlap = _keyword_overlap(keywords_set[i], keywords_set[j])
            if overlap >= 0.50:
                if len(items[i].content) >= len(items[j].content):
                    keep[j] = False
                else:
                    keep[i] = False
                    break

    return [items[i] for i in range(n) if keep[i]]

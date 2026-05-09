import asyncio
import hashlib
import json
import logging
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import pandas as pd

logger = logging.getLogger(__name__)

NEWS_SENTIMENT_DIR = Path(__file__).parent.parent / "data" / "news_sentiment"
HISTORY_DIR = NEWS_SENTIMENT_DIR / "history"

POSITIVE_KEYWORDS = [
    "利好", "增长", "突破", "新高", "增持", "买入", "上调", "涨停", "大涨",
    "翻倍", "超预期", "业绩预增", "净利润增长", "回购", "分红", "创新",
    "订单", "中标", "签约", "战略合作", "获批", "收购", "扩张", "景气",
    "复苏", "反弹", "放量", "主力资金", "北向资金", "资金流入",
]
NEGATIVE_KEYWORDS = [
    "利空", "下跌", "减持", "卖出", "风险", "下调", "亏损", "跌停", "暴跌",
    "退市", "ST", "立案", "处罚", "违规", "造假", "爆雷", "业绩预减",
    "净利润下降", "商誉减值", "质押", "诉讼", "仲裁", "被查", "罢免",
    "终止", "取消", "暂停", "破产", "清算", "违约", "逾期", "资金链",
    "跑路", "失联", "暴雷",
]

TOPIC_KEYWORDS = {
    "AI算力": ["AI", "人工智能", "算力", "GPU", "芯片", "大模型", "英伟达", "AIGC", "智能"],
    "新能源": ["新能源", "光伏", "风电", "储能", "锂电", "电池", "充电桩", "碳中和"],
    "半导体": ["半导体", "集成电路", "晶圆", "封装", "光刻", "EDA", "国产替代"],
    "消费": ["消费", "白酒", "食品", "医药", "零售", "电商", "直播", "旅游"],
    "金融": ["银行", "券商", "保险", "基金", "降息", "降准", "利率", "信贷"],
    "房地产": ["房地产", "楼市", "房价", "土地", "开发商", "恒大", "碧桂园"],
    "政策": ["政策", "监管", "证监会", "央行", "国务院", "两会", "改革", "法规"],
    "宏观经济": ["GDP", "CPI", "PPI", "PMI", "通胀", "就业", "出口", "进口", "贸易"],
    "汽车": ["汽车", "新能源车", "自动驾驶", "智能驾驶", "造车", "销量"],
    "医药": ["医药", "创新药", "疫苗", "医疗", "器械", "CXO", "生物"],
    "军工": ["军工", "国防", "航空", "航天", "导弹", "卫星", "北斗"],
    "数字经济": ["数字经济", "数据要素", "信创", "云计算", "大数据", "网络安全"],
}

SECTOR_MAPPING = {
    "AI算力": "科技",
    "半导体": "科技",
    "数字经济": "科技",
    "新能源": "新能源",
    "消费": "消费",
    "金融": "金融",
    "房地产": "房地产",
    "汽车": "汽车",
    "医药": "医药",
    "军工": "军工",
    "政策": "政策",
    "宏观经济": "宏观",
}


# --- jieba support ---

_jieba = None


def _load_jieba():
    global _jieba
    if _jieba is not None:
        return
    try:
        import jieba as _j
        import jieba.analyse
        _jieba = _j
        logger.info("jieba loaded successfully")
    except ImportError:
        logger.warning("jieba not installed, using substring matching")


SOURCE_AUTHORITY = {
    "国务院政策": 98,
    "国务院公报": 98,
    "新华社": 95,
    "人民日报": 95,
    "央视": 90,
    "彭博社": 90,
    "路透社": 90,
    "财新网": 90,
    "FT中文网": 85,
    "财联社": 85,
    "上海证券报": 85,
    "中国证券报": 85,
    "证券时报": 85,
    "央行": 85,
    "证监会": 85,
    "发改委": 82,
    "工信部": 82,
    "第一财经": 80,
    "21世纪经济报道": 80,
    "东方财富研报": 80,
    "慧博研报": 75,
    "经济观察报": 75,
    "界面新闻": 75,
    "上海金属网": 75,
    "东方财富": 70,
    "我的钢铁网": 70,
    "新浪财经": 65,
    "同花顺": 65,
    "雪球": 55,
    "东方财富股吧": 50,
}


def _ensure_dirs():
    NEWS_SENTIMENT_DIR.mkdir(parents=True, exist_ok=True)
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)


def _make_id(title: str, source: str) -> str:
    return hashlib.md5(f"{title}:{source}".encode()).hexdigest()[:16]


def _now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _today_str() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def classify_sentiment_keywords(text: str) -> tuple[str, int]:
    """Keyword-based sentiment classification (fallback)."""
    pos_count = sum(1 for kw in POSITIVE_KEYWORDS if kw in text)
    neg_count = sum(1 for kw in NEGATIVE_KEYWORDS if kw in text)
    if pos_count > neg_count:
        score = min(50 + pos_count * 10 + (pos_count - neg_count) * 5, 95)
        return "positive", score
    elif neg_count > pos_count:
        score = max(50 - neg_count * 10 - (neg_count - pos_count) * 5, 5)
        return "negative", score
    return "neutral", 50


# --- FinBERT sentiment classifier ---

_finbert_model = None
_finbert_tokenizer = None
_finbert_available = False


def _load_finbert():
    """Load FinBERT model lazily."""
    global _finbert_model, _finbert_tokenizer, _finbert_available
    if _finbert_model is not None:
        return
    try:
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        model_name = "ProsusAI/finbert"
        _finbert_tokenizer = AutoTokenizer.from_pretrained(model_name)
        _finbert_model = AutoModelForSequenceClassification.from_pretrained(model_name)
        _finbert_model.eval()
        _finbert_available = True
        logger.info("FinBERT model loaded successfully")
    except Exception as e:
        logger.warning("FinBERT load failed, using keyword fallback: %s", e)
        _finbert_available = False


def classify_sentiment_finbert(text: str) -> tuple[str, int]:
    """FinBERT-based sentiment classification."""
    if not _finbert_available:
        return classify_sentiment_keywords(text)

    try:
        import torch

        inputs = _finbert_tokenizer(
            text[:512], return_tensors="pt", truncation=True, max_length=512
        )
        with torch.no_grad():
            outputs = _finbert_model(**inputs)
        probs = torch.nn.functional.softmax(outputs.logits, dim=-1)[0]

        # FinBERT labels: positive(0), negative(1), neutral(2)
        pos_prob = probs[0].item()
        neg_prob = probs[1].item()
        neu_prob = probs[2].item()

        if pos_prob > neg_prob and pos_prob > neu_prob:
            label = "positive"
            score = int(min(50 + pos_prob * 50, 95))
        elif neg_prob > pos_prob and neg_prob > neu_prob:
            label = "negative"
            score = int(max(50 - neg_prob * 50, 5))
        else:
            label = "neutral"
            score = 50

        return label, score
    except Exception as e:
        logger.warning("FinBERT inference failed, falling back to keywords: %s", e)
        return classify_sentiment_keywords(text)


def classify_sentiment(text: str) -> tuple[str, int]:
    """Classify sentiment - FinBERT preferred, keyword fallback."""
    return classify_sentiment_finbert(text)


def extract_topics(text: str) -> list[str]:
    _load_jieba()
    if _jieba:
        words = set(_jieba.cut(text))
    else:
        words = None

    topics = []
    for topic, keywords in TOPIC_KEYWORDS.items():
        if words:
            if any(kw in words for kw in keywords):
                topics.append(topic)
        else:
            if any(kw in text for kw in keywords):
                topics.append(topic)
    return topics


def extract_keywords(text: str) -> list[str]:
    _load_jieba()
    if _jieba:
        import jieba.analyse
        tags = jieba.analyse.extract_tags(text, topK=8)
        return list(dict.fromkeys(tags))[:8]

    all_kw = POSITIVE_KEYWORDS + NEGATIVE_KEYWORDS
    flat_topics = []
    for kws in TOPIC_KEYWORDS.values():
        flat_topics.extend(kws)
    all_kw.extend(flat_topics)
    found = [kw for kw in all_kw if kw in text]
    return list(dict.fromkeys(found))[:8]


def map_to_stocks(text: str, stock_name_map: dict[str, str]) -> list[dict]:
    affected = []
    for symbol, name in stock_name_map.items():
        if name in text and len(name) >= 2:
            affected.append({"symbol": symbol, "name": name, "matchType": "direct"})
        elif symbol in text:
            affected.append({"symbol": symbol, "name": name, "matchType": "direct"})
    return affected[:10]


def compute_importance(title: str, content: str, source: str) -> int:
    base = SOURCE_AUTHORITY.get(source, 50)
    text = title + content
    pos_count = sum(1 for kw in POSITIVE_KEYWORDS if kw in text)
    neg_count = sum(1 for kw in NEGATIVE_KEYWORDS if kw in text)
    keyword_boost = min((pos_count + neg_count) * 5, 30)
    important_kws = ["退市", "ST", "立案", "暴跌", "涨停", "央行", "国务院", "证监会"]
    alert_boost = sum(10 for kw in important_kws if kw in text)
    return min(base + keyword_boost + alert_boost, 100)


def _load_stock_name_map() -> dict[str, str]:
    stock_list_file = Path(__file__).parent.parent / "data" / "stock_list.json"
    if not stock_list_file.exists():
        return {}
    try:
        data = json.loads(stock_list_file.read_text(encoding="utf-8"))
        return {item["symbol"]: item["name"] for item in data}
    except Exception:
        return {}


async def fetch_market_news() -> list[dict]:
    """Fetch news from all registered providers via the aggregator."""
    from services.news_sources import get_aggregator

    agg = get_aggregator()
    raw_items = await agg.fetch_all(limit_per_source=200)

    # Convert RawNewsItem to dict format for process_news_items
    items = []
    for item in raw_items:
        items.append({
            "title": item.title,
            "content": item.content,
            "source": item.source,
            "publishTime": item.publish_time.strftime("%Y-%m-%d %H:%M:%S") if item.publish_time else _now_str(),
            "url": item.url,
            "tag": ", ".join(item.tags) if item.tags else "",
        })
    logger.info("Aggregator returned %d total items", len(items))
    return items


def process_news_items(raw_items: list[dict]) -> list[dict]:
    stock_map = _load_stock_name_map()
    seen = set()
    processed = []

    for item in raw_items:
        title = item.get("title", "").strip()
        if not title or len(title) < 4:
            continue
        dedup_key = title[:30]
        if dedup_key in seen:
            continue
        seen.add(dedup_key)

        text = title + item.get("content", "")
        sentiment, score = classify_sentiment(text)
        topics = extract_topics(text)
        keywords = extract_keywords(text)
        affected = map_to_stocks(text, stock_map)
        importance = compute_importance(title, item.get("content", ""), item.get("source", ""))

        processed.append({
            "id": _make_id(title, item.get("source", "")),
            "title": title,
            "content": item.get("content", ""),
            "source": item.get("source", ""),
            "publishTime": item.get("publishTime", _now_str()),
            "url": item.get("url", ""),
            "sentiment": sentiment,
            "sentimentScore": score,
            "importance": importance,
            "topics": topics,
            "affectedStocks": affected,
            "keywords": keywords,
        })

    processed.sort(key=lambda x: x.get("publishTime", ""), reverse=True)
    return processed


def build_topic_clusters(items: list[dict], previous_topics: list[dict] | None = None) -> list[dict]:
    topic_data: dict[str, list[dict]] = {}
    for item in items:
        for topic in item.get("topics", []):
            topic_data.setdefault(topic, []).append(item)

    # Build lookup for previous topic scores
    prev_scores: dict[str, int] = {}
    if previous_topics:
        for pt in previous_topics:
            prev_scores[pt["topic"]] = pt.get("avgScore", 50)

    clusters = []
    for topic, topic_items in topic_data.items():
        scores = [it["sentimentScore"] for it in topic_items]
        avg_score = sum(scores) // len(scores) if scores else 50
        if avg_score >= 60:
            sentiment = "positive"
        elif avg_score <= 40:
            sentiment = "negative"
        else:
            sentiment = "neutral"

        # Compute trend from previous refresh
        trend = "flat"
        if topic in prev_scores:
            diff = avg_score - prev_scores[topic]
            if diff > 10:
                trend = "up"
            elif diff < -10:
                trend = "down"

        clusters.append({
            "topic": topic,
            "count": len(topic_items),
            "sentiment": sentiment,
            "avgScore": avg_score,
            "trend": trend,
            "recentTitles": [it["title"] for it in topic_items[:3]],
        })

    clusters.sort(key=lambda x: x["count"], reverse=True)
    return clusters


def build_sector_sentiment(items: list[dict]) -> list[dict]:
    """Aggregate sentiment by sector/industry."""
    sector_data: dict[str, list[dict]] = {}
    for item in items:
        for topic in item.get("topics", []):
            sector = SECTOR_MAPPING.get(topic)
            if sector:
                sector_data.setdefault(sector, []).append(item)

    sectors = []
    for sector, sector_items in sector_data.items():
        scores = [it["sentimentScore"] for it in sector_items]
        avg_score = sum(scores) // len(scores) if scores else 50
        if avg_score >= 60:
            sentiment = "positive"
        elif avg_score <= 40:
            sentiment = "negative"
        else:
            sentiment = "neutral"

        # Collect top topics in this sector
        topic_counter: Counter = Counter()
        for it in sector_items:
            for t in it.get("topics", []):
                if SECTOR_MAPPING.get(t) == sector:
                    topic_counter[t] += 1

        sectors.append({
            "sector": sector,
            "count": len(sector_items),
            "avgScore": avg_score,
            "sentiment": sentiment,
            "topTopics": [t for t, _ in topic_counter.most_common(3)],
        })

    sectors.sort(key=lambda x: x["count"], reverse=True)
    return sectors


def detect_sentiment_shifts(current_items: list[dict], previous_items: list[dict]) -> list[dict]:
    """Detect topics with significant sentiment changes between refreshes."""
    if not previous_items:
        return []

    def _group_by_topic(items: list[dict]) -> dict[str, list[int]]:
        groups: dict[str, list[int]] = {}
        for it in items:
            for topic in it.get("topics", []):
                groups.setdefault(topic, []).append(it["sentimentScore"])
        return groups

    current_groups = _group_by_topic(current_items)
    previous_groups = _group_by_topic(previous_items)

    shifts = []
    now_str = _now_str()

    for topic, cur_scores in current_groups.items():
        if topic not in previous_groups:
            continue
        prev_scores = previous_groups[topic]
        if len(cur_scores) < 3 or len(prev_scores) < 3:
            continue

        cur_avg = sum(cur_scores) // len(cur_scores)
        prev_avg = sum(prev_scores) // len(prev_scores)
        delta = cur_avg - prev_avg

        if abs(delta) <= 15:
            continue

        if prev_avg >= 60 and cur_avg <= 40:
            direction = "由正转负"
        elif prev_avg <= 40 and cur_avg >= 60:
            direction = "由负转正"
        elif delta > 0:
            direction = "显著上升"
        else:
            direction = "显著下降"

        shifts.append({
            "id": f"shift_{topic}_{now_str}",
            "title": f"「{topic}」情绪突变：{direction}",
            "reason": f"情绪分从{prev_avg}分{direction}至{cur_avg}分",
            "sentiment": "negative" if "转负" in direction or "下降" in direction else "positive",
            "importance": min(abs(delta) * 2, 100),
            "publishTime": now_str,
            "category": "情绪突变",
        })

    shifts.sort(key=lambda x: x["importance"], reverse=True)
    return shifts[:5]


def build_overview(items: list[dict], trends: list[dict],
                   previous_topics: list[dict] | None = None,
                   shift_alerts: list[dict] | None = None) -> dict:
    total = len(items)
    pos = sum(1 for it in items if it["sentiment"] == "positive")
    neg = sum(1 for it in items if it["sentiment"] == "negative")
    neu = total - pos - neg

    if total > 0:
        overall_score = sum(it["sentimentScore"] for it in items) // total
    else:
        overall_score = 50

    if overall_score >= 70:
        phase = "市场情绪积极"
    elif overall_score >= 55:
        phase = "市场情绪偏暖"
    elif overall_score >= 45:
        phase = "市场情绪中性"
    elif overall_score >= 30:
        phase = "市场情绪偏冷"
    else:
        phase = "市场情绪悲观"

    hot_topics = build_topic_clusters(items, previous_topics)
    sector_sentiment = build_sector_sentiment(items)

    alerts = []
    # Add sentiment shift alerts first
    if shift_alerts:
        alerts.extend(shift_alerts)

    # Add importance-based alerts
    for item in items:
        if item["importance"] >= 75:
            reason_parts = []
            if item["sentiment"] == "negative":
                reason_parts.append("负面情绪")
            if item["importance"] >= 85:
                reason_parts.append("高重要性")
            for kw in ["退市", "ST", "立案", "暴跌"]:
                if kw in item["title"]:
                    reason_parts.append(f"包含关键词「{kw}」")
            if reason_parts:
                alerts.append({
                    "id": item["id"],
                    "title": item["title"],
                    "reason": "，".join(reason_parts),
                    "sentiment": item["sentiment"],
                    "importance": item["importance"],
                    "publishTime": item["publishTime"],
                })

    alerts.sort(key=lambda x: x.get("importance", 0), reverse=True)

    stock_mention: dict[str, dict] = {}
    for item in items:
        for stock in item.get("affectedStocks", []):
            key = stock["symbol"]
            if key not in stock_mention:
                stock_mention[key] = {**stock, "count": 0, "scores": []}
            stock_mention[key]["count"] += 1
            stock_mention[key]["scores"].append(item["sentimentScore"])

    top_stocks = sorted(stock_mention.values(), key=lambda x: x["count"], reverse=True)[:20]
    for s in top_stocks:
        avg = sum(s["scores"]) // len(s["scores"]) if s["scores"] else 50
        s["avgScore"] = avg
        del s["scores"]

    return {
        "updatedAt": _now_str(),
        "totalCount": total,
        "positiveCount": pos,
        "negativeCount": neg,
        "neutralCount": neu,
        "overallScore": overall_score,
        "marketPhase": phase,
        "trends": trends,
        "hotTopics": hot_topics,
        "sectorSentiment": sector_sentiment,
        "alerts": alerts[:15],
        "topAffectedStocks": top_stocks,
    }


def load_latest() -> dict | None:
    latest_file = NEWS_SENTIMENT_DIR / "latest.json"
    if latest_file.exists():
        try:
            return json.loads(latest_file.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


def save_latest(data: dict):
    _ensure_dirs()
    latest_file = NEWS_SENTIMENT_DIR / "latest.json"
    latest_file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def save_history(data: dict):
    _ensure_dirs()
    today = _today_str()
    history_file = HISTORY_DIR / f"{today}.json"
    history_file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_trend_history(days: int = 30) -> list[dict]:
    trends = []
    today = datetime.now()
    for i in range(days):
        date = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        history_file = HISTORY_DIR / f"{date}.json"
        if history_file.exists():
            try:
                data = json.loads(history_file.read_text(encoding="utf-8"))
                overview = data.get("overview", {})
                trends.append({
                    "date": date,
                    "score": overview.get("overallScore", 50),
                    "positiveCount": overview.get("positiveCount", 0),
                    "negativeCount": overview.get("negativeCount", 0),
                    "neutralCount": overview.get("neutralCount", 0),
                    "totalCount": overview.get("totalCount", 0),
                    "topTopic": data.get("hotTopics", [{}])[0].get("topic", "") if data.get("hotTopics") else "",
                })
            except Exception:
                pass
    trends.reverse()
    return trends


async def refresh_news_sentiment() -> dict:
    # Ensure FinBERT is loaded (lazy init on first refresh)
    _load_finbert()
    # Ensure jieba is loaded
    _load_jieba()

    raw_items = await fetch_market_news()
    processed = process_news_items(raw_items)
    trends = load_trend_history(30)

    # Load previous data for trend comparison and shift detection
    previous = load_latest()
    previous_topics = previous.get("hotTopics", []) if previous else []
    previous_items = previous.get("items", []) if previous else []

    # Detect sentiment shifts
    shift_alerts = detect_sentiment_shifts(processed, previous_items)

    overview = build_overview(processed, trends, previous_topics, shift_alerts)

    data = {
        "overview": overview,
        "items": processed,
        "hotTopics": overview.get("hotTopics", []),
    }

    save_latest(data)
    save_history(data)

    return overview


def get_feed(page: int = 1, page_size: int = 30, sentiment: str = "",
             topic: str = "", source: str = "") -> dict:
    latest = load_latest()
    if not latest:
        return {"items": [], "total": 0, "page": page, "pageSize": page_size}

    items = latest.get("items", [])

    if sentiment:
        items = [it for it in items if it["sentiment"] == sentiment]
    if topic:
        items = [it for it in items if topic in it.get("topics", [])]
    if source:
        items = [it for it in items if source in it.get("source", "")]

    total = len(items)
    start = (page - 1) * page_size
    end = start + page_size

    return {
        "items": items[start:end],
        "total": total,
        "page": page,
        "pageSize": page_size,
    }


def get_topics() -> list[dict]:
    latest = load_latest()
    if not latest:
        return []
    return latest.get("hotTopics", [])


def get_stock_news(symbol: str) -> list[dict]:
    latest = load_latest()
    if not latest:
        return []
    return [
        it for it in latest.get("items", [])
        if any(s["symbol"] == symbol for s in it.get("affectedStocks", []))
    ]


async def search_news_with_sentiment(keyword: str, limit: int = 30) -> dict:
    """Real-time search across all providers with sentiment analysis."""
    from services.news_sources import get_aggregator

    agg = get_aggregator()
    raw_items = await agg.search_all(keyword, limit=limit)

    # Convert RawNewsItem to dict format for process_news_items
    items = []
    for item in raw_items:
        items.append({
            "title": item.title,
            "content": item.content,
            "source": item.source,
            "publishTime": item.publish_time.strftime("%Y-%m-%d %H:%M:%S") if item.publish_time else _now_str(),
            "url": item.url,
            "tag": ", ".join(item.tags) if item.tags else "",
        })

    processed = process_news_items(items)
    return {"items": processed, "total": len(processed), "keyword": keyword}

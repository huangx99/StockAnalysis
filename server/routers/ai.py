import json
import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from models.ai import AIAnalysis, AIReport, AIReportSection
from services import stock_service, ai_service
from services import data_store, market_data_store
from services.ai_service import AIConfigError

router = APIRouter(prefix="/api", tags=["ai"])
logger = logging.getLogger(__name__)


class NewsAnalyzeRequest(BaseModel):
    title: str
    content: str
    url: str = ""


class MarketAnalyzeRequest(BaseModel):
    startDate: str
    endDate: str
    dataTypes: list[str] | None = None
    maxDays: int = 30


MARKET_ANALYSIS_SYSTEM = """你是一名专业 A 股交易辅助系统文案分析师。注意：你不是决策引擎，不能重新计算市场阶段、情绪分、风险等级、主线行业或龙头股。

后端规则引擎已经完成核心计算，你只负责把规则结果翻译成专业、简洁、可执行的中文总结。

硬性原则：
1. summary、mainline、leaders、risk.anomalies 等关键结构由规则引擎决定，你不得推翻。
2. 只能基于输入的 ruleAnalysis 和 evidenceContext，不要编造新闻、政策、宏观信息或个股推荐理由。
3. 若数据质量存在 warning/error、日期不一致、价格为 0、核心指标缺失，必须在风险或逻辑里提示，并降低表达确定性。
4. 输出建议只能是交易节奏和观察条件，不给绝对买卖指令，不使用“必涨、必跌、满仓、梭哈”。
5. 输出必须是中文 JSON，不要 Markdown 代码块，不要 JSON 外内容。

请返回完整 MarketAnalysis JSON，字段如下：
{
  "summary": {"stage": "规则给定阶段", "emotion_score": 0-100, "risk_level": "低|中|高", "confidence": 0-100},
  "conclusion": {"one_line": "一句话市场结论", "reasoning": ["结构化支撑逻辑"]},
  "strategy": {"can_do": ["可以做什么"], "cannot_do": ["不可以做什么"], "watch_signals": ["观察信号和触发条件"]},
  "mainline": {"sectors": [{"name": "行业", "strength_score": 0-100, "trend": "up|down|flat", "is_mainline": true, "reason": "为什么是/不是主线"}], "status": "主线强/弱/分歧/候选等"},
  "leaders": [{"code": "代码", "name": "名称", "sector": "行业", "board_height": 0, "role": "总龙头|板块龙头|跟风", "strength": 0-100}],
  "risk": {"warnings": ["交易风险"], "anomalies": ["数据异常"]}
}
"""


def _safe_num(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
        if result != result:
            return default
        return result
    except Exception:
        return default


def _sort_records(records: Any, key: str, reverse: bool = True, limit: int = 10) -> list[dict]:
    if not isinstance(records, list):
        return []
    rows = [row for row in records if isinstance(row, dict)]
    return sorted(rows, key=lambda item: _safe_num(item.get(key)), reverse=reverse)[:limit]


def _pick(record: dict | None, keys: list[str]) -> dict:
    if not isinstance(record, dict):
        return {}
    return {key: record.get(key) for key in keys if key in record}


def _compress_market_payload(trade_date: str, included_types: set[str]) -> dict:
    payload: dict[str, Any] = {"tradeDate": trade_date}

    def load(data_type: str) -> Any:
        return market_data_store.load_market_data(trade_date, data_type)

    if "overview" in included_types:
        overview = load("overview")
        payload["overview"] = _pick(overview if isinstance(overview, dict) else None, [
            "tradeDate", "updatedAt", "totalTurnover", "upCount", "downCount", "flatCount",
            "avgChangePercent", "medianChangePercent", "northNetBuy", "northNetInflow",
            "northDataDate", "northDataStatus", "limitUpCount", "limitDownCount", "marketFlow", "meta",
        ])
    if "market_indices" in included_types:
        indices = load("market_indices")
        if isinstance(indices, dict):
            payload["market_indices"] = {
                "coverage": indices.get("coverage"),
                "leader": indices.get("leader"),
                "laggard": indices.get("laggard"),
                "items": indices.get("items", [])[:12],
                "meta": indices.get("meta"),
            }
    if "breadth" in included_types:
        breadth = load("breadth")
        if isinstance(breadth, dict):
            payload["breadth"] = _pick(breadth, ["distribution", "newHighLow", "activityDate", "turnoverStats", "meta"])
    if "style_rotation" in included_types:
        style = load("style_rotation")
        if isinstance(style, dict):
            payload["style_rotation"] = {
                "leader": style.get("leader"),
                "laggard": style.get("laggard"),
                "styles": style.get("styles", []),
                "meta": style.get("meta"),
            }
    if "north_money" in included_types:
        north = load("north_money")
        if isinstance(north, dict):
            payload["north_money"] = {
                "available": north.get("available"),
                "error": north.get("error"),
                "latestValidDate": north.get("latestValidDate"),
                "summary": north.get("summary", [])[:4],
                "historyTail": north.get("history", [])[-5:],
                "meta": north.get("meta"),
            }
    if "sentiment" in included_types:
        sentiment = load("sentiment")
        if isinstance(sentiment, dict):
            payload["sentiment"] = _pick(sentiment, [
                "limitUpCount", "limitDownCount", "dataQuality", "highestBoard", "breakCount",
                "breakRate", "marketPhase", "hotIndustries", "leaders", "sourceErrors", "meta",
            ])
            if isinstance(payload["sentiment"].get("leaders"), list):
                payload["sentiment"]["leaders"] = payload["sentiment"]["leaders"][:15]
    if "sector_rank" in included_types:
        sector_rank = load("sector_rank")
        payload["sector_rank"] = {
            "topByChange": _sort_records(sector_rank, "涨跌幅", True, 10),
            "bottomByChange": _sort_records(sector_rank, "涨跌幅", False, 10),
        }
    if "sector_fund_flow" in included_types:
        sector_flow = load("sector_fund_flow")
        payload["sector_fund_flow"] = {
            "topInflow": _sort_records(sector_flow, "今日主力净流入-净额", True, 10),
            "topOutflow": _sort_records(sector_flow, "今日主力净流入-净额", False, 10),
        }
    if "limit_up_pool" in included_types:
        limit_up = load("limit_up_pool")
        payload["limit_up_pool"] = {
            "leaders": sorted(
                [row for row in limit_up if isinstance(row, dict)] if isinstance(limit_up, list) else [],
                key=lambda item: (_safe_num(item.get("连板数")), _safe_num(item.get("封板资金"))),
                reverse=True,
            )[:20]
        }
    if "limit_down_pool" in included_types:
        limit_down = load("limit_down_pool")
        payload["limit_down_pool"] = {"items": (limit_down if isinstance(limit_down, list) else [])[:20]}
    if "quality_report" in included_types:
        quality = load("quality_report")
        if isinstance(quality, dict):
            payload["quality_report"] = _pick(quality, ["level", "score", "summary", "checks", "meta"])
    return payload


def _build_market_ai_context(start_date: str, end_date: str, included_types: list[str] | None, max_days: int) -> dict:
    if start_date > end_date:
        start_date, end_date = end_date, start_date
    allowed = set(market_data_store.MARKET_DATA_TYPES)
    selected_types = set(included_types or market_data_store.MARKET_DATA_TYPES) & allowed
    if not selected_types:
        selected_types = set(market_data_store.MARKET_DATA_TYPES)
    snapshots = [item for item in market_data_store.list_market_snapshots() if start_date <= item.get("tradeDate", "") <= end_date]
    snapshots = sorted(snapshots, key=lambda item: item["tradeDate"])
    omitted = max(0, len(snapshots) - max_days)
    if len(snapshots) > max_days:
        if max_days <= 2:
            snapshots = snapshots[-max_days:]
        else:
            snapshots = [snapshots[0], *snapshots[-(max_days - 1):]]
    dates = [item["tradeDate"] for item in snapshots]
    return {
        "range": {"startDate": start_date, "endDate": end_date, "snapshotCount": len(dates), "omittedSnapshots": omitted},
        "includedDataTypes": sorted(selected_types),
        "snapshots": [_compress_market_payload(date, selected_types) for date in dates],
    }


def _clamp_score(value: float, minimum: int = 0, maximum: int = 100) -> int:
    return int(max(minimum, min(maximum, round(value))))


def _format_cn_money(value: float | None) -> str:
    if value is None:
        return "—"
    abs_value = abs(value)
    if abs_value >= 1000000000000:
        return f"{value / 1000000000000:.2f}万亿"
    if abs_value >= 100000000:
        return f"{value / 100000000:.2f}亿"
    if abs_value >= 10000:
        return f"{value / 10000:.2f}万"
    return f"{value:.0f}"


def _market_empty_analysis(context: dict, reason: str) -> dict:
    return {
        "summary": {"stage": "数据不足", "emotion_score": 0, "risk_level": "高", "confidence": 0},
        "conclusion": {"one_line": reason, "reasoning": ["所选区间没有可用于规则计算的本地市场快照"]},
        "strategy": {"can_do": ["先下载所选日期区间的市场数据"], "cannot_do": ["不要基于缺失数据判断市场阶段"], "watch_signals": []},
        "mainline": {"sectors": [], "status": "无数据"},
        "leaders": [],
        "risk": {"warnings": ["缺少本地市场快照"], "anomalies": [reason]},
        "range": context.get("range"),
    }


def _load_market_record(trade_date: str) -> dict:
    return {
        "tradeDate": trade_date,
        "overview": market_data_store.load_market_data(trade_date, "overview"),
        "sentiment": market_data_store.load_market_data(trade_date, "sentiment"),
        "breadth": market_data_store.load_market_data(trade_date, "breadth"),
        "market_indices": market_data_store.load_market_data(trade_date, "market_indices"),
        "north_money": market_data_store.load_market_data(trade_date, "north_money"),
        "style_rotation": market_data_store.load_market_data(trade_date, "style_rotation"),
        "sector_rank": market_data_store.load_market_data(trade_date, "sector_rank"),
        "sector_fund_flow": market_data_store.load_market_data(trade_date, "sector_fund_flow"),
        "limit_up_pool": market_data_store.load_market_data(trade_date, "limit_up_pool"),
        "limit_down_pool": market_data_store.load_market_data(trade_date, "limit_down_pool"),
        "quality_report": market_data_store.load_market_data(trade_date, "quality_report"),
    }


def _activity_value(breadth: dict, name: str) -> float | None:
    activity = breadth.get("activity") if isinstance(breadth, dict) else None
    if not isinstance(activity, list):
        return None
    for item in activity:
        if isinstance(item, dict) and item.get("item") == name:
            return _safe_num(item.get("value"))
    return None


def _latest_market_metrics(record: dict) -> dict:
    overview = record.get("overview") if isinstance(record.get("overview"), dict) else {}
    sentiment = record.get("sentiment") if isinstance(record.get("sentiment"), dict) else {}
    breadth = record.get("breadth") if isinstance(record.get("breadth"), dict) else {}
    limit_up_pool = record.get("limit_up_pool") if isinstance(record.get("limit_up_pool"), list) else []
    limit_down_pool = record.get("limit_down_pool") if isinstance(record.get("limit_down_pool"), list) else []
    up_count = _safe_num(overview.get("upCount"), _activity_value(breadth, "上涨") or 0)
    down_count = _safe_num(overview.get("downCount"), _activity_value(breadth, "下跌") or 0)
    limit_up_count = _safe_num(sentiment.get("limitUpCount"), _safe_num(overview.get("limitUpCount"), len(limit_up_pool)))
    limit_down_count = _safe_num(sentiment.get("limitDownCount"), _safe_num(overview.get("limitDownCount"), len(limit_down_pool)))
    highest_board = _safe_num(sentiment.get("highestBoard"), max((_safe_num(item.get("连板数")) for item in limit_up_pool if isinstance(item, dict)), default=0))
    break_count = _safe_num(sentiment.get("breakCount"))
    break_rate = _safe_num(sentiment.get("breakRate"))
    if break_rate <= 0 and break_count > 0:
        break_rate = break_count / max(1, break_count + limit_up_count) * 100
    return {
        "tradeDate": record.get("tradeDate"),
        "upCount": up_count,
        "downCount": down_count,
        "limitUpCount": limit_up_count,
        "limitDownCount": limit_down_count,
        "highestBoard": highest_board,
        "breakCount": break_count,
        "breakRate": break_rate,
    }


def _calc_emotion_score(metrics: dict) -> int:
    total_active = max(1, metrics["upCount"] + metrics["downCount"])
    breadth_ratio = metrics["upCount"] / total_active
    limit_up_score = min(metrics["limitUpCount"] / 100 * 25, 25)
    board_score = min(metrics["highestBoard"] / 6 * 25, 25)
    breadth_score = breadth_ratio * 25
    break_score = max(0, 1 - metrics["breakRate"] / 100) * 15
    limit_down_penalty = min(metrics["limitDownCount"] * 1.2, 20)
    return _clamp_score(20 + limit_up_score + board_score + breadth_score + break_score - limit_down_penalty)


def _calc_market_stage(emotion_score: int, highest_board: float, break_rate: float) -> str:
    if emotion_score >= 80 and highest_board >= 5 and break_rate <= 55:
        return "主升期"
    if emotion_score >= 65:
        return "启动期（分歧中）" if break_rate > 55 else "启动期"
    if emotion_score < 40:
        return "冰点"
    if break_rate > 55:
        return "分歧期"
    return "震荡期"


def _calc_risk_level(metrics: dict, previous_metrics: dict | None, emotion_score: int) -> str:
    limit_down_increased = False
    if previous_metrics:
        limit_down_increased = metrics["limitDownCount"] > previous_metrics["limitDownCount"]
    if metrics["breakRate"] > 55 and (limit_down_increased or metrics["limitDownCount"] >= 10):
        return "高"
    if metrics["breakRate"] > 65 or metrics["limitDownCount"] >= 20 or emotion_score < 45:
        return "高"
    if emotion_score >= 70 and metrics["breakRate"] < 40 and metrics["limitDownCount"] < 8:
        return "低"
    return "中"


def _collect_quality_anomalies(records: list[dict], included_types: list[str]) -> tuple[list[str], int]:
    anomalies: list[str] = []
    has_time_mismatch = False
    has_missing = False
    has_abnormal_value = False
    has_core_missing = False
    for record in records:
        trade_date = record["tradeDate"]
        for data_type in included_types:
            value = record.get(data_type)
            if value is None or value == [] or value == {}:
                has_missing = True
                if data_type in {"overview", "sentiment", "breadth"}:
                    has_core_missing = True
                anomalies.append(f"{trade_date} 缺少 {data_type} 数据")
        quality_report = record.get("quality_report") if isinstance(record.get("quality_report"), dict) else {}
        checks = quality_report.get("checks") if isinstance(quality_report, dict) else []
        if isinstance(checks, list):
            for check in checks:
                if not isinstance(check, dict):
                    continue
                if check.get("status") in {"warning", "error", "failed"}:
                    message = str(check.get("message") or "数据质量异常")
                    anomalies.append(message)
                    if "不一致" in message or "不匹配" in message or "无法历史回放" in message:
                        has_time_mismatch = True
        for data_type, value in record.items():
            if not isinstance(value, dict):
                continue
            meta = value.get("meta") if isinstance(value.get("meta"), dict) else {}
            if meta.get("status") in {"warning", "error"}:
                warning = str(meta.get("warning") or f"{trade_date} {data_type} 数据质量为 {meta.get('status')}")
                anomalies.append(warning)
                if meta.get("sourceTradeDate") and meta.get("requestedTradeDate") and meta.get("sourceTradeDate") != meta.get("requestedTradeDate"):
                    has_time_mismatch = True
        limit_down_pool = record.get("limit_down_pool") if isinstance(record.get("limit_down_pool"), list) else []
        abnormal_rows = [item for item in limit_down_pool if isinstance(item, dict) and (_safe_num(item.get("最新价")) <= 0 or _safe_num(item.get("涨跌幅")) <= -90)]
        if abnormal_rows:
            has_abnormal_value = True
            anomalies.append(f"{trade_date} 跌停池存在 {len(abnormal_rows)} 条价格为 0 或跌幅异常记录")
    confidence = 100
    if has_time_mismatch:
        confidence -= 20
    if has_missing:
        confidence -= 20
    if has_abnormal_value:
        confidence -= 10
    if has_core_missing:
        confidence -= 30
    unique_anomalies = list(dict.fromkeys(item for item in anomalies if item))[:10]
    return unique_anomalies, _clamp_score(confidence)


def _sector_stats_for_date(record: dict) -> dict[str, dict]:
    sector_rank = record.get("sector_rank") if isinstance(record.get("sector_rank"), list) else []
    sector_flow = record.get("sector_fund_flow") if isinstance(record.get("sector_fund_flow"), list) else []
    limit_up_pool = record.get("limit_up_pool") if isinstance(record.get("limit_up_pool"), list) else []
    hot_industries = []
    sentiment = record.get("sentiment") if isinstance(record.get("sentiment"), dict) else {}
    if isinstance(sentiment.get("hotIndustries"), list):
        hot_industries = sentiment["hotIndustries"]
    sector_names = set()
    rank_by_name: dict[str, dict] = {}
    for item in sector_rank:
        if isinstance(item, dict) and item.get("板块名称"):
            name = str(item["板块名称"])
            sector_names.add(name)
            rank_by_name[name] = item
    flow_by_name: dict[str, dict] = {}
    for item in sector_flow:
        if isinstance(item, dict) and item.get("名称"):
            name = str(item["名称"])
            sector_names.add(name)
            flow_by_name[name] = item
    limit_up_counts: dict[str, int] = {}
    for item in limit_up_pool:
        if isinstance(item, dict) and item.get("所属行业"):
            name = str(item["所属行业"])
            sector_names.add(name)
            limit_up_counts[name] = limit_up_counts.get(name, 0) + 1
    for item in hot_industries:
        if isinstance(item, dict) and item.get("industry"):
            name = str(item["industry"])
            sector_names.add(name)
            limit_up_counts[name] = max(limit_up_counts.get(name, 0), int(_safe_num(item.get("limitUpCount"))))
    max_limit_up = max(limit_up_counts.values(), default=0)
    positive_changes = [_safe_num(rank_by_name.get(name, {}).get("涨跌幅"), _safe_num(flow_by_name.get(name, {}).get("今日涨跌幅"))) for name in sector_names]
    max_change = max([value for value in positive_changes if value > 0], default=0)
    positive_flows = [_safe_num(flow_by_name.get(name, {}).get("今日主力净流入-净额")) for name in sector_names]
    max_flow = max([value for value in positive_flows if value > 0], default=0)
    stats: dict[str, dict] = {}
    for name in sector_names:
        change = _safe_num(rank_by_name.get(name, {}).get("涨跌幅"), _safe_num(flow_by_name.get(name, {}).get("今日涨跌幅")))
        flow = _safe_num(flow_by_name.get(name, {}).get("今日主力净流入-净额"))
        limit_up_count = limit_up_counts.get(name, 0)
        limit_score = (limit_up_count / max_limit_up * 40) if max_limit_up else 0
        change_score = (max(change, 0) / max_change * 30) if max_change else 0
        flow_score = (max(flow, 0) / max_flow * 30) if max_flow else 0
        stats[name] = {
            "name": name,
            "limitUpCount": limit_up_count,
            "changePercent": change,
            "mainNetInflow": flow,
            "strengthScore": _clamp_score(limit_score + change_score + flow_score),
        }
    return stats


def _sector_trend(name: str, records: list[dict], latest_change: float) -> str:
    if len(records) < 2:
        if latest_change > 0.3:
            return "up"
        if latest_change < -0.3:
            return "down"
        return "flat"
    previous_stats = _sector_stats_for_date(records[-2])
    previous_change = _safe_num(previous_stats.get(name, {}).get("changePercent"))
    if latest_change - previous_change > 0.3:
        return "up"
    if latest_change - previous_change < -0.3:
        return "down"
    return "flat"


def _sector_streak(name: str, records: list[dict]) -> int:
    streak = 0
    for record in reversed(records):
        stats = _sector_stats_for_date(record)
        if _safe_num(stats.get(name, {}).get("strengthScore")) >= 55:
            streak += 1
        else:
            break
    return streak


def _identify_mainline(records: list[dict]) -> dict:
    latest_stats = _sector_stats_for_date(records[-1]) if records else {}
    ranked = sorted(latest_stats.values(), key=lambda item: item["strengthScore"], reverse=True)
    sectors = []
    for item in ranked[:6]:
        if item["strengthScore"] < 35:
            continue
        streak = _sector_streak(item["name"], records)
        is_mainline = item["strengthScore"] >= 60 and streak >= 2
        trend = _sector_trend(item["name"], records, item["changePercent"])
        reason = (
            f"涨停 {item['limitUpCount']} 只，行业涨幅 {item['changePercent']:.2f}%，"
            f"主力净流入 {_format_cn_money(item['mainNetInflow'])}，连续强势 {streak} 天"
        )
        if item["strengthScore"] >= 60 and streak < 2:
            reason += "，但连续性不足，暂按主线候选观察"
        sectors.append({
            "name": item["name"],
            "strength_score": item["strengthScore"],
            "trend": trend,
            "is_mainline": is_mainline,
            "reason": reason,
        })
    confirmed_count = len([item for item in sectors if item["is_mainline"]])
    if confirmed_count >= 2:
        status = "主线强"
    elif confirmed_count == 1:
        status = "主线较强"
    elif sectors and sectors[0]["strength_score"] >= 60:
        status = "主线候选，持续性待确认"
    elif len([item for item in sectors[:4] if item["strength_score"] >= 45]) >= 3:
        status = "分歧轮动"
    else:
        status = "无明确主线"
    return {"sectors": sectors, "status": status}


def _first_limit_time_score(value: Any) -> int:
    text = str(value or "")
    if len(text) != 6 or not text.isdigit():
        return 0
    hour = int(text[:2])
    minute = int(text[2:4])
    minutes = hour * 60 + minute
    if minutes <= 9 * 60 + 35:
        return 10
    if minutes <= 10 * 60:
        return 7
    if minutes <= 11 * 60 + 30:
        return 4
    return 1


def _identify_leaders(records: list[dict], mainline: dict) -> list[dict]:
    latest = records[-1] if records else {}
    limit_up_pool = latest.get("limit_up_pool") if isinstance(latest.get("limit_up_pool"), list) else []
    main_sector_names = {item["name"] for item in mainline.get("sectors", []) if item.get("is_mainline")}
    if not main_sector_names:
        main_sector_names = {item["name"] for item in mainline.get("sectors", [])[:3]}
    sector_best_board: dict[str, float] = {}
    for item in limit_up_pool:
        if not isinstance(item, dict):
            continue
        sector = str(item.get("所属行业") or "—")
        sector_best_board[sector] = max(sector_best_board.get(sector, 0), _safe_num(item.get("连板数")))
    highest_board = max((_safe_num(item.get("连板数")) for item in limit_up_pool if isinstance(item, dict)), default=0)
    ranked = sorted(
        [item for item in limit_up_pool if isinstance(item, dict)],
        key=lambda item: (_safe_num(item.get("连板数")), _safe_num(item.get("封板资金")), -_safe_num(item.get("炸板次数"))),
        reverse=True,
    )
    leaders = []
    total_leader_assigned = False
    for item in ranked[:10]:
        sector = str(item.get("所属行业") or "—")
        board_height = int(_safe_num(item.get("连板数")))
        if not total_leader_assigned and board_height == int(highest_board) and board_height > 0:
            role = "总龙头"
            total_leader_assigned = True
        elif sector in main_sector_names and board_height >= int(sector_best_board.get(sector, 0)):
            role = "板块龙头"
        else:
            role = "跟风"
        strength = _clamp_score(
            min(board_height / max(1, highest_board) * 55, 55)
            + min(_safe_num(item.get("封板资金")) / 200000000 * 20, 20)
            + _first_limit_time_score(item.get("首次封板时间"))
            + (10 if sector in main_sector_names else 0)
            + (5 if _safe_num(item.get("炸板次数")) == 0 else 0)
        )
        leaders.append({
            "code": str(item.get("代码") or item.get("symbol") or ""),
            "name": str(item.get("名称") or item.get("name") or "—"),
            "sector": sector,
            "board_height": board_height,
            "role": role,
            "strength": strength,
        })
    return leaders


def _market_warnings(metrics: dict, previous_metrics: dict | None, risk_level: str) -> list[str]:
    warnings: list[str] = []
    if metrics["breakRate"] > 55:
        warnings.append(f"炸板率 {metrics['breakRate']:.1f}% 处于高位，说明资金分歧明显")
    if metrics["limitDownCount"] >= 10:
        warnings.append(f"跌停 {int(metrics['limitDownCount'])} 只，亏钱效应不能忽视")
    if metrics["upCount"] < metrics["downCount"]:
        warnings.append("下跌家数多于上涨家数，指数表现可能掩盖个股分化")
    if previous_metrics and metrics["limitUpCount"] < previous_metrics["limitUpCount"] and metrics["breakRate"] > 50:
        warnings.append("涨停数量回落且炸板率偏高，短线接力容错率下降")
    if not warnings and risk_level == "低":
        warnings.append("情绪较强但仍需等待主线持续性和成交确认")
    if not warnings:
        warnings.append("市场信号中性，避免在无主线阶段提高交易频率")
    return warnings


def _build_rule_strategy(stage: str, risk_level: str, mainline: dict, metrics: dict) -> dict:
    has_mainline = any(item.get("is_mainline") for item in mainline.get("sectors", []))
    has_candidate = bool(mainline.get("sectors"))
    can_do = []
    cannot_do = []
    watch_signals = []
    if risk_level == "低" and has_mainline:
        can_do.append("围绕已验证主线做低位补涨或龙头分歧低吸")
    elif has_candidate:
        can_do.append("只在主线候选方向做小仓位试错，等待连续性确认")
    else:
        can_do.append("降低交易频率，优先观察新主线是否形成")
    if "启动期" in stage:
        can_do.append("关注首板、二板和板块内低位扩散，而不是盲目追高")
    if risk_level == "高":
        cannot_do.append("不要追高接力高位连板")
        cannot_do.append("不要在炸板率高位时扩大仓位")
    else:
        cannot_do.append("不要脱离主线做随机轮动交易")
        cannot_do.append("不要忽视数据质量警告直接放大结论")
    watch_signals.append("连板高度是否突破 5 板并带动板块扩散")
    watch_signals.append("炸板率是否下降至 50% 以下")
    watch_signals.append("主线行业是否连续 2 天以上同时获得涨幅、涨停数和资金流支持")
    if metrics["upCount"] <= metrics["downCount"]:
        watch_signals.append("上涨家数能否重新压过下跌家数")
    return {"can_do": can_do, "cannot_do": cannot_do, "watch_signals": watch_signals}


def _trend_label(values: list[float], unit: str = "") -> str:
    if len(values) < 2:
        return "样本不足"
    first_value = values[0]
    last_value = values[-1]
    midpoint = values[len(values) // 2]
    if last_value > first_value * 1.1:
        return f"上升至 {last_value:.1f}{unit}"
    if last_value < first_value * 0.9:
        return f"回落至 {last_value:.1f}{unit}"
    if midpoint > first_value and midpoint > last_value:
        return f"上升后回落，最新 {last_value:.1f}{unit}"
    return f"基本持平，最新 {last_value:.1f}{unit}"


def _build_market_rule_analysis(context: dict) -> dict:
    dates = [item.get("tradeDate") for item in context.get("snapshots", []) if item.get("tradeDate")]
    records = [_load_market_record(trade_date) for trade_date in dates]
    if not records:
        return _market_empty_analysis(context, "所选区间没有本地市场快照，无法分析")
    latest_metrics = _latest_market_metrics(records[-1])
    previous_metrics = _latest_market_metrics(records[0]) if len(records) > 1 else None
    emotion_score = _calc_emotion_score(latest_metrics)
    stage = _calc_market_stage(emotion_score, latest_metrics["highestBoard"], latest_metrics["breakRate"])
    risk_level = _calc_risk_level(latest_metrics, previous_metrics, emotion_score)
    anomalies, confidence = _collect_quality_anomalies(records, context.get("includedDataTypes", []))
    if risk_level == "高":
        confidence = min(confidence, 80)
    mainline = _identify_mainline(records)
    leaders = _identify_leaders(records, mainline)
    warnings = _market_warnings(latest_metrics, previous_metrics, risk_level)
    strategy = _build_rule_strategy(stage, risk_level, mainline, latest_metrics)
    top_sectors = [item["name"] for item in mainline.get("sectors", [])[:3]]
    one_line = f"当前市场处于{stage}，情绪 {emotion_score} 分，风险{risk_level}，{mainline.get('status', '主线不明')}。"
    reasoning = [
        f"涨停 {int(latest_metrics['limitUpCount'])} 只、跌停 {int(latest_metrics['limitDownCount'])} 只、最高 {int(latest_metrics['highestBoard'])} 板、炸板率 {latest_metrics['breakRate']:.1f}%",
        f"上涨 {int(latest_metrics['upCount'])} 家、下跌 {int(latest_metrics['downCount'])} 家，反映个股赚钱效应",
    ]
    if top_sectors:
        reasoning.append(f"强势方向集中在 {' / '.join(top_sectors)}，状态为{mainline.get('status')}")
    if anomalies:
        reasoning.append("存在数据质量异常，结论置信度需要折扣")
    raw_signals = {
        "stage": stage,
        "emotion_score": emotion_score,
        "risk_level": risk_level,
        "main_sectors": top_sectors,
        "leaders": [item["name"] for item in leaders[:5]],
        "anomalies": anomalies[:5],
        "trends": {
            "涨停数": _trend_label([_latest_market_metrics(record)["limitUpCount"] for record in records]),
            "炸板率": _trend_label([_latest_market_metrics(record)["breakRate"] for record in records], "%"),
        },
    }
    return {
        "summary": {"stage": stage, "emotion_score": emotion_score, "risk_level": risk_level, "confidence": confidence},
        "conclusion": {"one_line": one_line, "reasoning": reasoning},
        "strategy": strategy,
        "mainline": mainline,
        "leaders": leaders,
        "risk": {"warnings": warnings, "anomalies": anomalies},
        "range": context.get("range"),
        "includedDataTypes": context.get("includedDataTypes", []),
        "rawSignals": raw_signals,
    }


def _is_string_list(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def _merge_market_ai_text(rule_analysis: dict, ai_analysis: dict) -> dict:
    if not isinstance(ai_analysis, dict):
        return rule_analysis
    conclusion = ai_analysis.get("conclusion") if isinstance(ai_analysis.get("conclusion"), dict) else {}
    if isinstance(conclusion.get("one_line"), str) and conclusion["one_line"].strip():
        rule_analysis["conclusion"]["one_line"] = conclusion["one_line"].strip()
    if _is_string_list(conclusion.get("reasoning")) and conclusion["reasoning"]:
        rule_analysis["conclusion"]["reasoning"] = conclusion["reasoning"][:6]
    strategy = ai_analysis.get("strategy") if isinstance(ai_analysis.get("strategy"), dict) else {}
    for key in ["can_do", "cannot_do", "watch_signals"]:
        if _is_string_list(strategy.get(key)) and strategy[key]:
            rule_analysis["strategy"][key] = strategy[key][:6]
    risk = ai_analysis.get("risk") if isinstance(ai_analysis.get("risk"), dict) else {}
    if _is_string_list(risk.get("warnings")) and risk["warnings"]:
        rule_analysis["risk"]["warnings"] = risk["warnings"][:6]
    return rule_analysis



def _strip_json_text(text: str) -> str:
    text = text.strip()
    if "```json" in text:
        return text.split("```json", 1)[1].split("```", 1)[0].strip()
    if "```" in text:
        return text.split("```", 1)[1].split("```", 1)[0].strip()
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return text[start:end + 1]
    return text


async def _call_market_ai(provider, system_prompt: str, user_prompt: str) -> dict:
    if hasattr(provider, "client") and hasattr(provider.client, "chat"):
        response = await provider.client.chat.completions.create(
            model=provider.model,
            messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
            max_tokens=3072,
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content or "{}"
        return json.loads(_strip_json_text(content))
    if hasattr(provider, "client") and hasattr(provider.client, "messages"):
        response = await provider.client.messages.create(
            model=provider.model,
            max_tokens=3072,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        content = response.content[0].text if response.content else "{}"
        return json.loads(_strip_json_text(content))
    raise RuntimeError("当前 AI provider 不支持市场分析调用")


def _market_ai_not_configured(rule_analysis: dict, message: str) -> dict:
    rule_analysis["aiStatus"] = {"available": False, "message": message}
    rule_analysis["generatedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return rule_analysis



async def _build_ai_financial_context(symbol: str) -> dict:
    summary = await stock_service.get_financial_summary(symbol)
    return {
        "summary": summary.model_dump(),
        "annual": [item.model_dump() for item in summary.annual[:10]],
        "quarterly": [item.model_dump() for item in summary.quarterly[:12]],
    }


def _ai_not_configured_analysis(symbol: str, stock_name: str) -> AIAnalysis:
    return AIAnalysis(
        summary=f"{stock_name}（{symbol}）AI 分析服务未配置",
        score=0,
        style="未知",
        highlights=[],
        risks=["AI 服务未配置 API Key，请在设置页面配置"],
        companyOverview="",
        marketPerformance="",
        financialPerformance="",
        valuationAnalysis="",
        newsDigest="",
        conclusion="请在设置页面配置 AI 服务后重试",
    )


def _save_ai_analysis(symbol: str, analysis: AIAnalysis) -> None:
    data_store.save_stock_data(symbol, "ai_analysis", analysis.model_dump())


def _load_ai_analysis(symbol: str) -> AIAnalysis | None:
    local = data_store.load_stock_data(symbol, "ai_analysis")
    if not isinstance(local, dict):
        return None
    try:
        return AIAnalysis(**local)
    except Exception:
        return None


@router.get("/stock/{symbol}/analyze/saved", response_model=AIAnalysis | None)
async def saved_analysis(symbol: str):
    return _load_ai_analysis(symbol)


@router.post("/market/analyze")
async def analyze_market(body: MarketAnalyzeRequest):
    context = _build_market_ai_context(body.startDate, body.endDate, body.dataTypes, max(1, min(body.maxDays, 60)))
    rule_analysis = _build_market_rule_analysis(context)
    if not context["snapshots"]:
        rule_analysis["generatedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        return rule_analysis
    try:
        provider = ai_service.get_ai_provider()
    except AIConfigError as exception:
        return _market_ai_not_configured(rule_analysis, f"AI 服务未配置：{exception}")

    user_prompt = (
        "请基于后端规则引擎结果，生成交易辅助系统的中文结构化总结。\n"
        "注意：summary/mainline/leaders/risk.anomalies 是规则计算结果，只能原样保留；"
        "你只能润色 conclusion、strategy、risk.warnings 的表达。\n\n"
        f"分析范围：{body.startDate} 至 {body.endDate}\n"
        f"实际快照数量：{context['range']['snapshotCount']}，省略快照数量：{context['range']['omittedSnapshots']}\n"
        f"用户选择的数据类型：{json.dumps(context['includedDataTypes'], ensure_ascii=False)}\n\n"
        f"ruleAnalysis JSON：\n{json.dumps(rule_analysis, ensure_ascii=False)}\n\n"
        f"evidenceContext JSON：\n{json.dumps(context, ensure_ascii=False)}"
    )
    try:
        ai_analysis = await _call_market_ai(provider, MARKET_ANALYSIS_SYSTEM, user_prompt)
        result = _merge_market_ai_text(rule_analysis, ai_analysis)
        result["aiStatus"] = {"available": True, "message": "AI 已基于规则结果完成总结"}
        result["generatedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        return result
    except Exception as exception:
        logger.exception("market AI analysis failed")
        rule_analysis["aiStatus"] = {"available": False, "message": f"AI 调用失败：{exception}"}
        rule_analysis["generatedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        return rule_analysis



@router.post("/stock/{symbol}/analyze", response_model=AIAnalysis)
async def analyze(symbol: str):
    profile = await stock_service.get_stock_profile(symbol)
    financial_context = await _build_ai_financial_context(symbol)
    news = await stock_service.get_news(symbol)

    try:
        provider = ai_service.get_ai_provider()
    except AIConfigError:
        return _ai_not_configured_analysis(symbol, profile.name)

    result = await provider.analyze(
        symbol=symbol,
        stock_name=profile.name,
        profile_data=profile.model_dump(),
        financials_data=financial_context,
        news_data=[n.model_dump() for n in news],
    )
    _save_ai_analysis(symbol, result)
    return result


@router.post("/stock/{symbol}/analyze/stream")
async def analyze_stream(symbol: str):
    profile = await stock_service.get_stock_profile(symbol)
    financial_context = await _build_ai_financial_context(symbol)
    news = await stock_service.get_news(symbol)

    try:
        provider = ai_service.get_ai_provider()
    except AIConfigError as e:
        async def not_configured():
            yield f"data: {json.dumps({'field': '__error__', 'value': f'AI 服务未配置：{e}'}, ensure_ascii=False)}\n\n"
        return StreamingResponse(not_configured(), media_type="text/event-stream")

    async def event_generator():
        try:
            yielded_any = False
            collected: dict = {}
            async for field_name, value in provider.analyze_stream(
                symbol=symbol,
                stock_name=profile.name,
                profile_data=profile.model_dump(),
                financials_data=financial_context,
                news_data=[n.model_dump() for n in news],
            ):
                yielded_any = True
                collected[field_name] = value
                yield f"data: {json.dumps({'field': field_name, 'value': value}, ensure_ascii=False)}\n\n"
            if not yielded_any:
                yield f"data: {json.dumps({'field': '__error__', 'value': 'AI 未返回有效内容，请检查模型是否支持 JSON 输出或流式响应'}, ensure_ascii=False)}\n\n"
                return
            try:
                _save_ai_analysis(symbol, AIAnalysis(**collected))
            except Exception as e:
                logger.warning("failed to persist AI analysis for %s: %s", symbol, e)
            yield f"data: {json.dumps({'field': '__done__'}, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.exception("AI stream failed for %s", symbol)
            yield f"data: {json.dumps({'field': '__error__', 'value': f'AI 分析失败：{e}'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/stock/{symbol}/report", response_model=AIReport)
async def report(symbol: str):
    profile = await stock_service.get_stock_profile(symbol)
    financial_context = await _build_ai_financial_context(symbol)
    news = await stock_service.get_news(symbol)

    try:
        provider = ai_service.get_ai_provider()
    except AIConfigError:
        return AIReport(
            sections=[
                AIReportSection(
                    title="AI 服务未配置",
                    content="请在 server/.env 中配置 STOCK_ANTHROPIC_API_KEY 或其他 AI 提供商的密钥后重启服务。",
                )
            ],
            generatedAt="",
        )

    return await provider.report(
        symbol=symbol,
        stock_name=profile.name,
        profile_data=profile.model_dump(),
        financials_data=financial_context,
        news_data=[n.model_dump() for n in news],
    )


@router.post("/stock/{symbol}/news/analyze")
async def analyze_news_item(symbol: str, body: NewsAnalyzeRequest):
    try:
        provider = ai_service.get_ai_provider()
    except AIConfigError:
        return {
            "sentiment": "neutral",
            "summary": "AI 服务未配置",
            "key_points": [],
            "risk_factors": ["请在设置页面配置 AI 服务后重试"],
        }

    content = body.content
    # If content is empty and URL is a notice/report, download and extract text
    if not content and body.url:
        from services.stock_service import get_notice_content
        downloaded = await get_notice_content(body.url)
        if downloaded:
            content = downloaded

    return await provider.analyze_news_item(body.title, content)

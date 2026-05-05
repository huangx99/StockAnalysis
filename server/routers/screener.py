import asyncio
import hashlib
import logging
import os
import json
import time
import re
import urllib.request
from datetime import datetime, timedelta
from functools import lru_cache
from collections import Counter
from fastapi import APIRouter, HTTPException

from models.stock import (
    ScreenerRequest, ScreenedStock, ScreenerResponse, ScreenerDiagnosis, FinancialPeriodMetrics,
    FormulaGenerateRequest, FormulaGenerateResponse, ScreenerInsight,
)
from services import data_store, ai_service
from services.ai_service import AIConfigError
from services.screener_formula import (
    FormulaError, compile_formula, formula_field_catalog, validate_formula,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["screener"])


@lru_cache(maxsize=1)
def _load_stock_names() -> dict[str, str]:
    path = data_store.DATA_DIR.parent / "stock_list.json"
    if not path.exists():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            items = json.load(f)
        if not isinstance(items, list):
            return {}
        return {
            str(item.get("code", "")): str(item.get("name", ""))
            for item in items
            if item.get("code") and item.get("name")
        }
    except Exception as e:
        logger.warning("[screener] failed to load stock names: %s", e)
        return {}


_SNAPSHOT_TTL_SECONDS = 300
_SIGNATURE_TTL_SECONDS = 30
_SNAPSHOT_SCHEMA_VERSION = 2
_SNAPSHOT_FILE = data_store.DATA_DIR.parent / "screener_snapshot.json"
_AI_INSIGHT_CACHE_SCHEMA = 5
_AI_INSIGHT_CACHE_DIR = data_store.DATA_DIR.parent / "screener_ai_insights"
_snapshot_cache: dict[str, object] = {"built_at": 0.0, "signature": None, "rows": []}
_signature_cache: dict[str, object] = {"built_at": 0.0, "symbols": (), "signature": None}
_recent_strength_cache: dict[str, tuple[float, float]] = {}


def _data_signature(symbols: list[str]) -> tuple[int, int, float]:
    symbols_key = tuple(symbols)
    now = time.time()
    if (
        _signature_cache.get("symbols") == symbols_key
        and now - float(_signature_cache.get("built_at") or 0) < _SIGNATURE_TTL_SECONDS
    ):
        cached = _signature_cache.get("signature")
        if isinstance(cached, tuple):
            return cached

    latest = 0.0
    for symbol in symbols:
        stock_dir = data_store.DATA_DIR / symbol
        for filename in ("profile.json", "financial_periods.json", "kline_day.json"):
            path = stock_dir / filename
            if path.exists():
                try:
                    latest = max(latest, path.stat().st_mtime)
                except OSError:
                    pass
    signature = (_SNAPSHOT_SCHEMA_VERSION, len(symbols), latest)
    _signature_cache.update({"built_at": now, "symbols": symbols_key, "signature": signature})
    return signature


def _load_snapshot_file(signature: tuple[int, int, float]) -> list[ScreenedStock] | None:
    if not _SNAPSHOT_FILE.exists():
        return None
    try:
        with open(_SNAPSHOT_FILE, "r", encoding="utf-8") as f:
            payload = json.load(f)
        if tuple(payload.get("signature") or ()) != signature:
            return None
        rows = payload.get("rows")
        if not isinstance(rows, list):
            return None
        return [ScreenedStock(**row) for row in rows]
    except Exception as e:
        logger.warning("[screener] failed to load snapshot file: %s", e)
        return None


def _save_snapshot_file(signature: tuple[int, int, float], rows: list[ScreenedStock]) -> None:
    try:
        _SNAPSHOT_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(_SNAPSHOT_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "signature": list(signature),
                "rows": [row.model_dump() for row in rows],
            }, f, ensure_ascii=False)
    except Exception as e:
        logger.warning("[screener] failed to save snapshot file: %s", e)


def _to_float(value: object, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _to_sort_number(value: object) -> float | None:
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, list):
        for item in value:
            number = _to_sort_number(item)
            if number is not None:
                return number
        return None
    try:
        if value is None or value == "":
            return None
        number = float(value)
        if number != number or number in (float("inf"), float("-inf")):
            return None
        return number
    except (TypeError, ValueError):
        return None


def _sort_by_formula_value(results: list[ScreenedStock], sort_dir: str) -> None:
    if sort_dir == "desc":
        results.sort(key=lambda stock: (stock.formulaSortValue is not None, stock.formulaSortValue or 0.0), reverse=True)
    else:
        results.sort(key=lambda stock: (stock.formulaSortValue is None, stock.formulaSortValue or 0.0))


def _compute_consecutive_growth_years_raw(periods: list[dict]) -> int:
    fy_periods = sorted(
        [p for p in periods if p.get("reportQuarter") == "FY"],
        key=lambda p: int(p.get("reportYear") or 0),
        reverse=True,
    )
    count = 0
    for period in fy_periods:
        if _to_float(period.get("netProfitYoY")) > 0 and _to_float(period.get("revenueYoY")) > 0:
            count += 1
        else:
            break
    return count


def _latest_fy(periods: list[dict]) -> dict:
    fy_periods = [p for p in periods if p.get("reportQuarter") == "FY"]
    if not fy_periods:
        return {}
    return max(fy_periods, key=lambda p: int(p.get("reportYear") or 0))


def _build_screener_rows(symbols: list[str], stock_names: dict[str, str]) -> list[ScreenedStock]:
    rows: list[ScreenedStock] = []
    for symbol in symbols:
        raw_periods = data_store.load_stock_data(symbol, "financial_periods")
        periods = raw_periods if isinstance(raw_periods, list) else []
        profile = _load_profile(symbol)
        latest_fy = _latest_fy(periods)
        has_kline_data = data_store.has_stock_data(symbol, "kline_day")

        rows.append(ScreenedStock(
            symbol=symbol,
            name=profile.get("name", "") or stock_names.get(symbol, "") or symbol,
            industry=profile.get("industry", "") or "",
            currentPrice=_to_float(profile.get("currentPrice")),
            changePercent=_to_float(profile.get("changePercent")),
            pe=_to_float(profile.get("pe")),
            pb=_to_float(profile.get("pb")),
            marketCap=_to_float(profile.get("marketCap")),
            roe=_to_float(latest_fy.get("roe")),
            netProfitYoY=_to_float(latest_fy.get("netProfitYoY")),
            revenueYoY=_to_float(latest_fy.get("revenueYoY")),
            grossMargin=_to_float(latest_fy.get("grossMargin")),
            netMargin=_to_float(latest_fy.get("netMargin")),
            debtAssetRatio=_to_float(latest_fy.get("debtAssetRatio")),
            consecutiveGrowthYears=_compute_consecutive_growth_years_raw(periods),
            recentStrength=0.0,
            hasProfileData=bool(profile),
            hasFinancialData=bool(periods),
            hasKlineData=has_kline_data,
        ))
    return rows


def _get_screener_rows(symbols: list[str], stock_names: dict[str, str]) -> list[ScreenedStock]:
    signature = _data_signature(symbols)
    now = time.time()
    if (
        _snapshot_cache.get("signature") == signature
        and now - float(_snapshot_cache.get("built_at") or 0) < _SNAPSHOT_TTL_SECONDS
    ):
        return list(_snapshot_cache.get("rows") or [])

    file_rows = _load_snapshot_file(signature)
    if file_rows is not None:
        _snapshot_cache.update({"signature": signature, "built_at": now, "rows": file_rows})
        logger.info("[screener] loaded snapshot file: %d rows", len(file_rows))
        return list(file_rows)

    rows = _build_screener_rows(symbols, stock_names)
    _snapshot_cache.update({"signature": signature, "built_at": now, "rows": rows})
    _save_snapshot_file(signature, rows)
    logger.info("[screener] built snapshot: %d rows", len(rows))
    return list(rows)


def _get_recent_strength(symbol: str) -> float:
    path = data_store.DATA_DIR / symbol / "kline_day.json"
    try:
        mtime = path.stat().st_mtime
    except OSError:
        mtime = 0.0
    cached = _recent_strength_cache.get(symbol)
    if cached and cached[0] == mtime:
        return cached[1]
    value = _compute_recent_strength(_load_kline(symbol))
    _recent_strength_cache[symbol] = (mtime, value)
    return value

def _compute_consecutive_growth_years(periods: list[FinancialPeriodMetrics]) -> int:
    """Count consecutive FY years (going back from most recent) with positive netProfitYoY and revenueYoY."""
    fy_periods = sorted(
        [p for p in periods if p.reportQuarter == "FY"],
        key=lambda p: p.reportYear,
        reverse=True,
    )
    count = 0
    for p in fy_periods:
        if p.netProfitYoY > 0 and p.revenueYoY > 0:
            count += 1
        else:
            break
    return count



def _matches_query(row: ScreenedStock, query: str) -> bool:
    return (
        query in row.symbol.lower()
        or query in row.name.lower()
        or query in row.industry.lower()
    )


def _evaluate_row(row: ScreenedStock, req: ScreenerRequest) -> tuple[ScreenedStock, list[str]]:
    reasons: list[str] = []
    current = row

    if req.preset == "consecutive_growth":
        if not current.hasFinancialData:
            reasons.append("缺少年度财务数据，无法计算连续增长年数；请先在数据中心刷新该股财务数据")
        elif current.consecutiveGrowthYears < 3:
            reasons.append(f"连续增长年数 {current.consecutiveGrowthYears} 年，低于 3 年")

    elif req.preset == "recent_strength":
        if not current.hasKlineData:
            reasons.append("缺少日 K 线数据，无法计算近 3 月涨幅；请先在数据中心刷新该股行情数据")
        else:
            current = current.model_copy(update={"recentStrength": _get_recent_strength(current.symbol)})
            if current.recentStrength <= 0:
                reasons.append(f"近 3 月涨幅 {current.recentStrength:.2f}%，未大于 0%")

    elif req.preset == "profit_growth_rank":
        if not current.hasFinancialData:
            reasons.append("缺少年度财务数据，无法计算净利润增速；请先在数据中心刷新该股财务数据")
        elif current.netProfitYoY <= 0:
            reasons.append(f"净利润增速 {current.netProfitYoY:.2f}%，未大于 0%")

    elif req.preset == "custom":
        pass

    else:
        reasons.append(f"未知筛选策略：{req.preset}")

    if any(value is not None for value in (req.minRoe, req.maxDebtRatio, req.minRevenueYoY, req.minNetProfitYoY)) and not current.hasFinancialData:
        reasons.append("缺少年度财务数据，无法判断 ROE、负债率或增长指标；请先刷新该股财务数据")
    elif req.minRoe is not None and current.roe < req.minRoe:
        reasons.append(f"ROE {current.roe:.2f}%，低于 {req.minRoe:.2f}%")
    if current.hasFinancialData and req.maxDebtRatio is not None and current.debtAssetRatio > req.maxDebtRatio:
        reasons.append(f"资产负债率 {current.debtAssetRatio:.2f}%，高于 {req.maxDebtRatio:.2f}%")
    if current.hasFinancialData and req.minRevenueYoY is not None and current.revenueYoY < req.minRevenueYoY:
        reasons.append(f"营收增速 {current.revenueYoY:.2f}%，低于 {req.minRevenueYoY:.2f}%")
    if current.hasFinancialData and req.minNetProfitYoY is not None and current.netProfitYoY < req.minNetProfitYoY:
        reasons.append(f"净利润增速 {current.netProfitYoY:.2f}%，低于 {req.minNetProfitYoY:.2f}%")
    if any(value is not None for value in (req.maxPe, req.maxPb, req.minMarketCap, req.maxMarketCap)) and not current.hasProfileData:
        reasons.append("缺少行情/估值数据，无法判断 PE、PB 或市值；请先刷新该股基础行情数据")
    elif req.maxPe is not None and (current.pe <= 0 or current.pe > req.maxPe):
        reasons.append(f"PE {current.pe:.2f}，不在 0 到 {req.maxPe:.2f} 范围内")
    if current.hasProfileData and req.maxPb is not None and (current.pb <= 0 or current.pb > req.maxPb):
        reasons.append(f"PB {current.pb:.2f}，不在 0 到 {req.maxPb:.2f} 范围内")
    if current.hasProfileData and req.minMarketCap is not None and (current.marketCap <= 0 or current.marketCap < req.minMarketCap * 1e8):
        reasons.append(f"市值 {current.marketCap / 1e8:.2f} 亿，低于 {req.minMarketCap:.2f} 亿")
    if current.hasProfileData and req.maxMarketCap is not None and (current.marketCap <= 0 or current.marketCap > req.maxMarketCap * 1e8):
        reasons.append(f"市值 {current.marketCap / 1e8:.2f} 亿，高于 {req.maxMarketCap:.2f} 亿")
    if req.industry and req.industry != current.industry:
        reasons.append(f"行业为 {current.industry or '未知'}，不是 {req.industry}")

    return current, reasons


def _diagnose_query(rows: list[ScreenedStock], req: ScreenerRequest, query: str, matched_results: list[ScreenedStock]) -> ScreenerDiagnosis | None:
    if not query or matched_results:
        return None
    candidates = [row for row in rows if _matches_query(row, query)]
    if not candidates:
        return None
    diagnosed, reasons = _evaluate_row(candidates[0], req)
    if not reasons:
        reasons = ["该股票匹配当前筛选条件，但不在当前搜索结果中；请尝试清空搜索或切换页码。"]
    return ScreenerDiagnosis(stock=diagnosed, reasons=reasons)

def _compute_recent_strength(kline: list[dict]) -> float:
    """Compute percentage change over approximately last 60 trading days."""
    if not kline or len(kline) < 2:
        return 0.0
    lookback = min(60, len(kline) - 1)
    if lookback < 1:
        return 0.0
    start_close = kline[-lookback - 1].get("close", 0)
    end_close = kline[-1].get("close", 0)
    if start_close and start_close > 0:
        return (end_close - start_close) / start_close * 100
    return 0.0


def _load_financial_periods(symbol: str) -> list[FinancialPeriodMetrics]:
    data = data_store.load_stock_data(symbol, "financial_periods")
    if isinstance(data, list) and data:
        try:
            return [FinancialPeriodMetrics(**item) for item in data]
        except Exception:
            return []
    return []


def _load_profile(symbol: str) -> dict:
    data = data_store.load_stock_data(symbol, "profile")
    if isinstance(data, dict):
        return data
    return {}


def _load_kline(symbol: str) -> list[dict]:
    data = data_store.load_stock_data(symbol, "kline_day")
    if isinstance(data, list):
        return data
    return []


def _get_data_freshness(symbols: list[str]) -> str:
    """Get the most recent profile update time across all stocks."""
    latest = ""
    for sym in symbols[:50]:
        path = data_store.DATA_DIR / sym / "profile.json"
        if path.exists():
            try:
                mtime = os.path.getmtime(str(path))
                dt = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d")
                if not latest or dt > latest:
                    latest = dt
            except OSError:
                pass
    return latest


class AIJsonParseError(ValueError):
    def __init__(self, message: str, raw_text: str):
        super().__init__(message)
        self.raw_text = raw_text


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


def _escape_control_chars_in_json_strings(text: str) -> str:
    result: list[str] = []
    in_string = False
    escaped = False
    for char in text:
        if escaped:
            result.append(char)
            escaped = False
            continue
        if char == "\\" and in_string:
            result.append(char)
            escaped = True
            continue
        if char == '"':
            in_string = not in_string
            result.append(char)
            continue
        if in_string and char in {"\n", "\r", "\t"}:
            result.append(" ")
            continue
        result.append(char)
    return "".join(result)


def _balance_json_text(text: str) -> str:
    text = text.strip()
    stack: list[str] = []
    in_string = False
    escaped = False
    for char in text:
        if escaped:
            escaped = False
            continue
        if char == "\\" and in_string:
            escaped = True
            continue
        if char == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if char in "[{":
            stack.append(char)
        elif char in "]}" and stack:
            opener = stack[-1]
            if (opener == "[" and char == "]") or (opener == "{" and char == "}"):
                stack.pop()
    if in_string:
        text += '"'
    while stack:
        opener = stack.pop()
        text += "]" if opener == "[" else "}"
    return re.sub(r",\s*([}\]])", r"\1", text)


def _try_repair_ai_json(text: str) -> dict | None:
    candidates = []
    escaped = _escape_control_chars_in_json_strings(text)
    candidates.append(escaped)
    candidates.append(_balance_json_text(escaped))
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            continue
    return None


def _loads_ai_json(content: str) -> dict:
    stripped = _strip_json_text(content)
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError as exc:
        repaired = _try_repair_ai_json(stripped)
        if repaired is not None:
            logger.warning("[screener] AI returned malformed JSON but repair succeeded: %s", exc)
            return repaired
        logger.warning("[screener] AI returned invalid JSON: %s; raw=%s", exc, content[:1200])
        raise AIJsonParseError(str(exc), content) from exc
    if not isinstance(parsed, dict):
        raise AIJsonParseError("AI 返回不是 JSON 对象", content)
    return parsed


async def _call_formula_ai(provider, system_prompt: str, user_prompt: str, max_tokens: int = 3000) -> dict:
    if hasattr(provider, "client") and hasattr(provider.client, "chat"):
        response = await provider.client.chat.completions.create(
            model=provider.model,
            messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
            max_tokens=max_tokens,
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content or "{}"
        return _loads_ai_json(content)
    if hasattr(provider, "client") and hasattr(provider.client, "messages"):
        response = await provider.client.messages.create(
            model=provider.model,
            max_tokens=max_tokens,
            temperature=0.1,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        content = response.content[0].text if response.content else "{}"
        return _loads_ai_json(content)
    raise RuntimeError("当前 AI provider 不支持公式生成")


async def _call_ai_text(provider, system_prompt: str, user_prompt: str, max_tokens: int = 700) -> str:
    if hasattr(provider, "client") and hasattr(provider.client, "chat"):
        response = await provider.client.chat.completions.create(
            model=provider.model,
            messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
            max_tokens=max_tokens,
            temperature=0.2,
        )
        return (response.choices[0].message.content or "").strip()
    if hasattr(provider, "client") and hasattr(provider.client, "messages"):
        response = await provider.client.messages.create(
            model=provider.model,
            max_tokens=max_tokens,
            temperature=0.2,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        return (response.content[0].text if response.content else "").strip()
    raise RuntimeError("当前 AI provider 不支持文本生成")


def _as_string_list(value: object, limit: int = 8) -> list[str]:
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for item in value[:limit]:
        if isinstance(item, str) and item.strip():
            items.append(item.strip())
        elif isinstance(item, dict):
            text = str(item.get("text") or item.get("label") or item.get("name") or "").strip()
            if text:
                items.append(text)
    return items


def _as_field_list(value: object, limit: int = 12) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    fields: list[dict[str, object]] = []
    for item in value[:limit]:
        if isinstance(item, str) and item.strip():
            fields.append({"name": item.strip(), "meaning": "AI 使用的公式字段"})
        elif isinstance(item, dict):
            name = str(item.get("name") or item.get("field") or item.get("label") or "").strip()
            if not name:
                continue
            fields.append({
                "name": name,
                "meaning": str(item.get("meaning") or item.get("description") or "AI 使用的公式字段"),
                "unit": str(item.get("unit") or ""),
            })
    return fields


def _formula_field_names(formula: str) -> list[str]:
    names = re.findall(r"@([^\s()+\-*/%<>=!,]+)", formula or "")
    return [name.strip() for name in names if name.strip()]


def _default_investment_logic(filter_formula: str, sort_formula: str, sort_dir: str) -> list[str]:
    fields = _formula_field_names(filter_formula)
    sort_fields = _formula_field_names(sort_formula)
    logic: list[str] = []
    industries = [field for field in fields if field.endswith(("行业", "板块", "概念"))]
    if industries:
        logic.append(f"只看{'、'.join(industries[:3])}相关公司，先把研究范围缩小到目标赛道")
    if "EXISTS" in filter_formula.upper() and sort_fields:
        logic.append(f"优先选择已经披露{sort_fields[0]}的公司，避免用缺失数据做排名")
    if sort_fields:
        direction = "从高到低" if sort_dir == "desc" else "从低到高"
        metric = sort_fields[0]
        if "净利润" in metric:
            logic.append(f"按{metric}{direction}排序，用利润规模观察公司在行业里的竞争位置")
        elif "ROE" in metric.upper():
            logic.append(f"按{metric}{direction}排序，优先观察盈利效率更强的公司")
        elif "市值" in metric:
            logic.append(f"按{metric}{direction}排序，观察市场定价和龙头体量")
        else:
            logic.append(f"按{metric}{direction}排序，找出该指标表现最突出的公司")
    return logic or ["把用户描述转换成可执行筛选条件，并按关键投资指标排序"]


def _default_use_cases(filter_formula: str, sort_formula: str) -> list[str]:
    text = f"{filter_formula} {sort_formula}"
    cases: list[str] = []
    if "行业" in text or "板块" in text or "概念" in text:
        cases.append("快速缩小行业研究范围，先看同一赛道里的代表公司")
    if "净利润" in text:
        cases.extend(["寻找行业龙头或利润规模靠前的公司", "观察行业利润是否向少数公司集中"])
    elif "ROE" in text.upper():
        cases.extend(["寻找盈利效率较高的公司", "对比同行业公司的资产回报能力"])
    elif "营收" in text:
        cases.extend(["寻找收入规模或增长更突出的公司", "观察行业需求扩张情况"])
    return cases[:4] or ["生成初筛名单，作为后续人工研究和财报核验的入口"]


FORMULA_AI_SYSTEM = """你是 A 股量化筛选公式助手。
你只能基于给定字段生成公式，不能编造不存在字段。
用户可能需要两类公式：
1. filterFormula：筛选公式，结果必须能判断 true/false，可为空。
2. sortFormula：排序公式，结果必须是数值，可为空；sortDir 用 desc 表示从高到低排行，asc 表示从低到高排行。
公式语法：字段必须以 @ 开头；支持 > >= < <= == !=，AND/OR/NOT，括号，+ - * /，函数 AVG/MIN/MAX/SUM/COUNT/EXISTS/MISSING/CAGR。
行业/板块分类也作为布尔字段使用，例如 @小金属行业、@稀土行业、@银行行业；多个行业用 OR 连接。
如果用户说“排行/排名/最高/最低/前十”，通常把核心指标放进 sortFormula；为了排除缺数据股票，可用 filterFormula = EXISTS(@字段)。
例如“2026Q1季度净利润排行”应返回 filterFormula="EXISTS(@2026Q1净利润)", sortFormula="@2026Q1净利润", sortDir="desc"。
例如“小金属行业 ROE 排行”应返回 filterFormula="@小金属行业 AND EXISTS(@ROE)", sortFormula="@ROE", sortDir="desc"。
如果用户需求无法用字段表达，返回 ok=false 并说明原因。
除公式外，还必须给出投资视角解释，而不是工程视角解释：
- summary：一句话说明这个策略想帮用户找到什么股票。
- investmentLogic：用投资语言拆解核心逻辑，例如“只看半导体行业”“挑出已经披露一季报的公司”“按净利润规模排序”。不要写“使用 EXISTS 避免空值”这种工程解释。
- useCases：说明适用场景，例如“找行业龙头公司”“判断行业利润集中度”。
- steps 可以保留技术拆解，但必须短，不能替代投资解释。
- usedFields 解释字段含义；warnings 说明局限；validationPlan 说明如何验证结果。
必须返回 JSON：{"ok":boolean,"title":string,"summary":string,"investmentLogic":[string],"useCases":[string],"filterFormula":string,"sortFormula":string,"sortDir":"asc|desc","explanation":string,"steps":[string],"usedFields":[{"name":string,"meaning":string,"unit":string}],"warnings":[string],"validationPlan":[string],"reason":string}
"""


@router.get("/screener/formula/fields")
async def formula_fields():
    return {"items": formula_field_catalog()}


@router.post("/screener/formula/validate")
async def formula_validate(body: dict):
    return validate_formula(str(body.get("formula") or ""))


@router.post("/screener/formula/generate", response_model=FormulaGenerateResponse)
async def formula_generate(body: FormulaGenerateRequest):
    description = body.description.strip()
    if not description:
        return FormulaGenerateResponse(ok=False, reason="请先描述你想筛选什么股票")
    try:
        provider = ai_service.get_ai_provider()
    except AIConfigError as exception:
        return FormulaGenerateResponse(ok=False, reason=f"AI 服务未配置：{exception}")

    fields = formula_field_catalog()
    examples = [
        {"description": "ROE高、增长快、估值不贵", "filterFormula": "@ROE > 12 AND @净利润同比 > 20 AND @市盈率TTM < 30", "sortFormula": "@ROE", "sortDir": "desc"},
        {"description": "近三年营收和净利润持续增长", "filterFormula": "MIN(@近3年净利润同比) > 0 AND MIN(@近3年营收同比) > 0", "sortFormula": "AVG(@近3年净利润同比)", "sortDir": "desc"},
        {"description": "2026Q1季度净利润排行", "filterFormula": "EXISTS(@2026Q1净利润)", "sortFormula": "@2026Q1净利润", "sortDir": "desc"},
        {"description": "2025Q1净利润同比增速排名", "filterFormula": "EXISTS(@2025Q1净利润同比)", "sortFormula": "@2025Q1净利润同比", "sortDir": "desc"},
        {"description": "小金属行业 ROE 排行", "filterFormula": "@小金属行业 AND EXISTS(@ROE)", "sortFormula": "@ROE", "sortDir": "desc"},
    ]
    user_prompt = (
        f"用户需求：{description}\n\n"
        f"可用字段 JSON：{json.dumps(fields, ensure_ascii=False)}\n\n"
        f"动态字段规则：支持 @2025Q1净利润、@2024净利润、@净利润[2025Q1]、@近3年净利润同比、@近4季营收同比；行业字段可写 @小金属行业、@稀土行业。\n"
        f"示例：{json.dumps(examples, ensure_ascii=False)}\n"
        "请生成尽量简单、可执行的筛选公式和/或排序公式。解释必须面向投资者：这能帮用户找什么、适合什么场景、有什么局限。"
    )
    try:
        result = await _call_formula_ai(provider, FORMULA_AI_SYSTEM, user_prompt)
        if not result.get("ok"):
            return FormulaGenerateResponse(
                ok=False,
                reason=str(result.get("reason") or result.get("explanation") or "AI 无法用当前字段表达该需求"),
            )
        filter_formula = str(result.get("filterFormula") or result.get("formula") or "").strip()
        sort_formula = str(result.get("sortFormula") or "").strip()
        sort_dir = str(result.get("sortDir") or "desc").strip().lower()
        if sort_dir not in {"asc", "desc"}:
            sort_dir = "desc"
        if not filter_formula and not sort_formula:
            return FormulaGenerateResponse(ok=False, reason="AI 没有生成可执行的筛选公式或排序公式")
        if filter_formula:
            validation = validate_formula(filter_formula)
            if not validation.get("ok"):
                return FormulaGenerateResponse(ok=False, reason=f"AI 生成的筛选公式未通过校验：{validation.get('message')}")
        if sort_formula:
            validation = validate_formula(sort_formula)
            if not validation.get("ok"):
                return FormulaGenerateResponse(ok=False, reason=f"AI 生成的排序公式未通过校验：{validation.get('message')}")
        title = str(result.get("title") or "AI 公式")
        summary = str(result.get("summary") or result.get("explanation") or title)
        investment_logic = _as_string_list(result.get("investmentLogic")) or _default_investment_logic(filter_formula, sort_formula, sort_dir)
        use_cases = _as_string_list(result.get("useCases")) or _default_use_cases(filter_formula, sort_formula)
        steps = _as_string_list(result.get("steps"))
        if not steps:
            if filter_formula:
                steps.append(f"筛选：{filter_formula}")
            if sort_formula:
                steps.append(f"排序：按 {sort_formula} {'升序' if sort_dir == 'asc' else '降序'}")
        used_fields = _as_field_list(result.get("usedFields"))
        warnings = _as_string_list(result.get("warnings"))
        validation_plan = _as_string_list(result.get("validationPlan"))
        if not validation_plan:
            validation_plan = ["校验筛选公式语法", "校验排序公式语法", "试运行并查看匹配数量和 Top 5"]
        return FormulaGenerateResponse(
            ok=True,
            formula=filter_formula,
            filterFormula=filter_formula,
            sortFormula=sort_formula,
            sortDir=sort_dir,
            title=title,
            summary=summary,
            explanation=str(result.get("explanation") or summary),
            investmentLogic=investment_logic,
            useCases=use_cases,
            steps=steps,
            usedFields=used_fields,
            warnings=warnings,
            validationPlan=validation_plan,
        )
    except Exception as exception:
        logger.exception("formula AI generation failed")
        return FormulaGenerateResponse(ok=False, reason=f"AI 生成失败：{exception}")


_SORT_LABELS = {
    "netProfitYoY": "净利润增速",
    "revenueYoY": "营收增速",
    "roe": "ROE",
    "grossMargin": "毛利率",
    "netMargin": "净利率",
    "pe": "市盈率",
    "pb": "市净率",
    "marketCap": "市值",
    "recentStrength": "近3月涨幅",
    "consecutiveGrowthYears": "连续增长年数",
    "changePercent": "涨跌幅",
}
_TOPIC_KEYWORDS = {
    "业绩增长": ("增长", "高增", "超预期", "净利润", "同比", "盈利"),
    "价格周期": ("涨价", "价格", "周期", "库存", "景气", "复苏"),
    "AI算力": ("AI", "算力", "服务器", "GPU", "英伟达", "数据中心"),
    "存储芯片": ("存储", "DRAM", "NAND", "HBM", "内存"),
    "扩产并购": ("扩产", "投产", "产能", "并购", "收购", "项目"),
    "风险压力": ("下滑", "亏损", "减持", "诉讼", "风险", "预警"),
}
_POSITIVE_RATINGS = {"买入", "增持", "推荐", "强烈推荐", "优于大市", "跑赢行业"}


def _extract_formula_fields(formula: str | None) -> list[str]:
    return [item.strip() for item in re.findall(r"@([^\s()+\-*/%<>=!,]+)", formula or "") if item.strip()]


def _sort_metric_label(req: ScreenerRequest) -> str:
    if req.sortFormula and req.sortFormula.strip():
        fields = _extract_formula_fields(req.sortFormula)
        if len(fields) == 1:
            return fields[0]
        return req.sortFormula.strip().replace("@", "")
    return _SORT_LABELS.get(req.sortBy, req.sortBy)


def _classify_metric(label: str, sort_by: str) -> str:
    text = f"{label} {sort_by}".lower()
    if "净利润" in label or "profit" in text:
        return "profit"
    if "roe" in text:
        return "roe"
    if "营收" in label or "revenue" in text:
        return "revenue"
    if "同比" in label or "增速" in label or "yoy" in text:
        return "growth"
    if "市值" in label or "marketcap" in text:
        return "size"
    if "pe" in text or "pb" in text or "市盈率" in label or "市净率" in label:
        return "valuation"
    if "涨幅" in label or "strength" in text or "change" in text:
        return "momentum"
    return "general"


def _metric_value(row: ScreenedStock, req: ScreenerRequest) -> float | None:
    if req.sortFormula and req.sortFormula.strip():
        return row.formulaSortValue
    return _to_sort_number(getattr(row, req.sortBy, None))


def _format_insight_number(value: float | None, metric_kind: str) -> str:
    if value is None:
        return "-"
    abs_value = abs(value)
    if metric_kind in {"profit", "revenue", "size"} and abs_value >= 1e8:
        return f"{value / 1e8:.2f}亿"
    if abs_value >= 10000:
        return f"{value:.0f}"
    return f"{value:.2f}"


def _load_list_data(symbol: str, data_type: str) -> list[dict]:
    data = data_store.load_stock_data(symbol, data_type)
    return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []


def _collect_media_signals(rows: list[ScreenedStock]) -> tuple[list[str], list[str], list[dict[str, object]]]:
    topic_counter: Counter[str] = Counter()
    rating_counter: Counter[str] = Counter()
    institution_counter: Counter[str] = Counter()
    evidence: list[dict[str, object]] = []

    for row in rows[:10]:
        news_items = sorted(_load_list_data(row.symbol, "news"), key=lambda item: str(item.get("publishTime") or ""), reverse=True)[:8]
        report_items = sorted(_load_list_data(row.symbol, "reports"), key=lambda item: str(item.get("publishTime") or ""), reverse=True)[:6]
        for item in news_items:
            text = " ".join(str(item.get(key) or "") for key in ("title", "summary", "content"))
            for topic, keywords in _TOPIC_KEYWORDS.items():
                if any(keyword.lower() in text.lower() for keyword in keywords):
                    topic_counter[topic] += 1
            if len(evidence) < 8 and item.get("title"):
                evidence.append({
                    "symbol": row.symbol,
                    "name": row.name,
                    "type": "新闻",
                    "title": str(item.get("title") or "")[:80],
                    "date": str(item.get("publishTime") or "")[:10],
                    "source": str(item.get("source") or ""),
                })
        for item in report_items:
            title = str(item.get("title") or "")
            rating = str(item.get("rating") or "").strip()
            institution = str(item.get("institution") or "").strip()
            if rating:
                rating_counter[rating] += 1
            if institution:
                institution_counter[institution] += 1
            for topic, keywords in _TOPIC_KEYWORDS.items():
                if any(keyword.lower() in title.lower() for keyword in keywords):
                    topic_counter[topic] += 1
            if len(evidence) < 12 and title:
                evidence.append({
                    "symbol": row.symbol,
                    "name": row.name,
                    "type": "研报",
                    "title": title[:80],
                    "date": str(item.get("publishTime") or "")[:10],
                    "source": institution,
                    "rating": rating,
                })

    news_insights: list[str] = []
    for topic, count in topic_counter.most_common(3):
        if count >= 2:
            if topic == "风险压力":
                news_insights.append(f"新闻/研报中多次出现{topic}相关表述，说明结果需要结合风险事件进一步排查")
            else:
                news_insights.append(f"新闻/研报中{topic}线索较多，可能是本轮排名靠前公司的共同驱动因素之一")

    report_insights: list[str] = []
    positive_count = sum(count for rating, count in rating_counter.items() if any(word in rating for word in _POSITIVE_RATINGS))
    total_ratings = sum(rating_counter.values())
    if total_ratings:
        report_insights.append(f"Top 公司近期开奖研报共记录 {total_ratings} 条评级，其中偏正面评级约 {positive_count} 条，可作为市场关注度参考")
    if institution_counter:
        names = "、".join(name for name, _ in institution_counter.most_common(3))
        report_insights.append(f"覆盖机构较活跃的来源包括 {names}，后续可进一步查看具体研报假设")

    return news_insights, report_insights, evidence


def _build_result_insight(results: list[ScreenedStock], req: ScreenerRequest) -> ScreenerInsight | None:
    if not results:
        return None

    metric_label = _sort_metric_label(req)
    metric_kind = _classify_metric(metric_label, req.sortBy)
    top_rows = results[:10]
    top3 = top_rows[:3]
    values = [_metric_value(row, req) for row in top_rows]
    numeric_values = [value for value in values if value is not None]
    top3_values = [_metric_value(row, req) for row in top3]
    top3_numeric = [value for value in top3_values if value is not None]
    top_names = "、".join(row.name or row.symbol for row in top3)
    industries = Counter(row.industry or "未知行业" for row in top_rows)
    primary_industry, primary_count = industries.most_common(1)[0]

    ranking_reasons: list[str] = []
    structure_insights: list[str] = []
    warnings: list[str] = []
    next_steps: list[str] = []

    if top3:
        ranking_reasons.append(f"{top_names} 排在前列，核心原因是它们的{metric_label}在当前股票池中靠前")
    if len(numeric_values) >= 2:
        first = numeric_values[0]
        last = numeric_values[-1]
        first_text = _format_insight_number(first, metric_kind)
        last_text = _format_insight_number(last, metric_kind)
        if first > 0 and last > 0:
            ratio = first / last if last else 0
            if ratio >= 3:
                structure_insights.append(f"第1名与第10名{metric_label}差距约 {ratio:.1f} 倍，头部优势较明显")
            else:
                structure_insights.append(f"Top 10 的{metric_label}分布相对接近，行业内部并非单一公司独大")
        ranking_reasons.append(f"当前 Top 10 中，首位{metric_label}约 {first_text}，第10名约 {last_text}")
    if top3_numeric and numeric_values and all(value >= 0 for value in numeric_values):
        top3_sum = sum(top3_numeric)
        top10_sum = sum(numeric_values)
        if top10_sum > 0:
            share = top3_sum / top10_sum * 100
            if share >= 60:
                structure_insights.append(f"Top 3 合计贡献 Top 10 约 {share:.0f}% 的{metric_label}，结果呈现较高集中度")
            elif share >= 40:
                structure_insights.append(f"Top 3 合计贡献 Top 10 约 {share:.0f}% 的{metric_label}，头部公司具备一定优势")
    if primary_count >= 4:
        structure_insights.append(f"Top 10 中有 {primary_count} 家属于{primary_industry}，说明结果可能集中在该细分方向")

    if metric_kind == "profit":
        next_steps.extend(["继续核验营收增速、毛利率和经营现金流，判断利润质量", "查看利润是否来自主营业务，而非一次性收益"])
        conclusion = "当前结果更适合用来观察行业利润规模和龙头集中度，不宜单独作为买卖依据"
    elif metric_kind == "roe":
        next_steps.extend(["结合负债率和净利率判断高 ROE 是否可持续", "排查一次性收益或高杠杆导致的 ROE 偏高"])
        conclusion = "当前结果更适合寻找盈利效率较高的公司，但还需要验证质量和持续性"
    elif metric_kind == "growth":
        next_steps.extend(["检查低基数因素，避免把一次性反弹误判为长期成长", "结合收入、利润和现金流三项指标交叉验证"])
        conclusion = "当前结果更适合寻找阶段性高增长公司，但需要警惕低基数和周期波动"
    elif metric_kind == "valuation":
        next_steps.extend(["结合盈利质量判断低估值是否对应基本面风险", "对比行业平均估值和历史估值区间"])
        conclusion = "当前结果更适合做估值线索初筛，但低估值不等于低风险"
    else:
        next_steps.extend(["打开 Top 公司详情页，核对财务趋势和公告新闻", "结合估值、现金流和行业景气度进行二次筛选"])
        conclusion = "当前结果适合作为研究起点，需要结合更多基本面信息继续验证"

    news_insights, report_insights, evidence = _collect_media_signals(top_rows)
    if news_insights:
        if any("价格周期" in item or "存储芯片" in item for item in news_insights) and ("半导体" in primary_industry or "芯片" in " ".join(news_insights)):
            conclusion = "当前结果显示行业内部可能处于结构性分化阶段，部分细分链条的利润表现更突出"
    if not news_insights and not report_insights:
        warnings.append("本次 Top 公司缺少足够新闻/研报线索，结果洞察主要基于筛选数值本身")
    warnings.append("结果洞察基于本地已下载数据和新闻研报摘要生成，需结合最新公告与财报原文复核")

    summary = ranking_reasons[0] if ranking_reasons else f"本次结果按{metric_label}排序，适合作为进一步研究的初筛名单"
    return ScreenerInsight(
        title=f"结果洞察 · {metric_label}",
        summary=summary,
        generationMethod="规则生成",
        generatedAt=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        rankingReasons=ranking_reasons[:4],
        structureInsights=structure_insights[:4],
        newsInsights=news_insights[:4],
        reportInsights=report_insights[:4],
        conclusion=conclusion,
        nextSteps=next_steps[:5],
        warnings=warnings[:4],
        evidence=evidence[:12],
        limitations=["规则洞察由本地筛选结果、排序值、新闻/研报摘要和标题统计生成，未调用 AI。"],
    )


_AI_INSIGHT_SYSTEM = """你是A股投资研究助理。只能基于 evidencePack 写，不能补充外部事实。
不要输出 JSON，不要 markdown 表格，只输出两段：内容、依据样本。
内容必须写成4行，每行以「核心结论：」「驱动拆解：」「风险验证：」「怎么使用：」开头，总长度约300-500字。
必须使用 evidencePack.computedInsight 里的具体数字、排名差距、Top3占比、现金流/研报/新闻线索；不要只说龙头优势明显。
依据样本列3-5条，每条格式为「股票名/代码：具体依据」。
必须说明不构成买卖建议；如果涉及研报，只能用标题/机构/评级，PDF研报全文解析当前暂未接入。
"""


def _parse_date_value(value: object) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(text[:19] if "%H" in fmt else text[:10], fmt)
        except ValueError:
            continue
    return None


def _within_range(value: object, start: datetime, end: datetime) -> bool:
    dt = _parse_date_value(value)
    return bool(dt and start <= dt <= end)


def _safe_text(value: object, limit: int = 500) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:limit]


def _fetch_url_text(url: str, timeout: float = 3.0, limit: int = 1200) -> str:
    if not url or url.lower().endswith(".pdf"):
        return ""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 StockAnalysis/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            content_type = response.headers.get("Content-Type", "")
            if "text" not in content_type and "html" not in content_type and "json" not in content_type:
                return ""
            raw = response.read(limit * 4)
        text = raw.decode("utf-8", errors="ignore")
        text = re.sub(r"<script[\s\S]*?</script>", " ", text, flags=re.IGNORECASE)
        text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.IGNORECASE)
        text = re.sub(r"<[^>]+>", " ", text)
        return _safe_text(text, limit)
    except Exception as exc:
        logger.info("[screener] fetch insight link failed: %s %s", url, exc)
        return ""


def _period_summary(symbol: str) -> dict[str, object]:
    periods = _load_list_data(symbol, "financial_periods")
    if not periods:
        return {}
    latest = sorted(periods, key=lambda item: str(item.get("reportDate") or ""), reverse=True)[:2]
    return {
        "latestPeriods": [
            {
                "period": f"{item.get('reportYear')}{item.get('reportQuarter')}",
                "revenue": item.get("revenue"),
                "revenueYoY": item.get("revenueYoY"),
                "netProfit": item.get("netProfit"),
                "netProfitYoY": item.get("netProfitYoY"),
                "roe": item.get("roe"),
                "grossMargin": item.get("grossMargin"),
                "operatingCashFlow": item.get("operatingCashFlow"),
                "cfoToNetProfit": item.get("cfoToNetProfit"),
            }
            for item in latest
        ]
    }


def _build_ai_evidence_pack(req: ScreenerRequest, response: ScreenerResponse, fetch_links: bool) -> dict[str, object]:
    now = datetime.now()
    start = now - timedelta(days=180)
    top_items = response.items[:10]
    link_fetch_budget = 3
    fetched_count = 0
    stocks: list[dict[str, object]] = []
    fetched_texts: list[dict[str, str]] = []

    for row in top_items:
        news_items = [item for item in _load_list_data(row.symbol, "news") if _within_range(item.get("publishTime"), start, now)]
        report_items = [item for item in _load_list_data(row.symbol, "reports") if _within_range(item.get("publishTime"), start, now)]
        news_items = sorted(news_items, key=lambda item: str(item.get("publishTime") or ""), reverse=True)[:3]
        report_items = sorted(report_items, key=lambda item: str(item.get("publishTime") or ""), reverse=True)[:2]

        compact_news = []
        for item in news_items:
            url = str(item.get("url") or "")
            compact = {
                "title": _safe_text(item.get("title"), 120),
                "date": str(item.get("publishTime") or "")[:10],
                "source": _safe_text(item.get("source"), 40),
                "summary": _safe_text(item.get("summary") or item.get("content"), 140),
                "url": url,
            }
            compact_news.append(compact)
            if fetch_links and fetched_count < link_fetch_budget and url and not url.lower().endswith(".pdf"):
                fetched = _fetch_url_text(url)
                if fetched:
                    fetched_texts.append({"symbol": row.symbol, "name": row.name, "url": url, "title": compact["title"], "text": fetched})
                    fetched_count += 1

        compact_reports = [
            {
                "title": _safe_text(item.get("title"), 120),
                "date": str(item.get("publishTime") or "")[:10],
                "institution": _safe_text(item.get("institution"), 40),
                "rating": _safe_text(item.get("rating"), 20),
                "url": str(item.get("url") or ""),
                "note": "研报 PDF 全文暂未解析，本条仅使用标题、机构、评级、日期和链接。",
            }
            for item in report_items
        ]

        stocks.append({
            "symbol": row.symbol,
            "name": row.name,
            "industry": row.industry,
            "sortValue": row.formulaSortValue if req.sortFormula else _metric_value(row, req),
            "formulaValues": row.formulaValues,
            "profile": {
                "currentPrice": row.currentPrice,
                "marketCap": row.marketCap,
                "pe": row.pe,
                "pb": row.pb,
                "roe": row.roe,
                "netProfitYoY": row.netProfitYoY,
                "revenueYoY": row.revenueYoY,
            },
            "financialSummary": _period_summary(row.symbol),
            "news": compact_news,
            "reports": compact_reports,
        })

    return {
        "timeRange": f"{start.strftime('%Y-%m-%d')} 至 {now.strftime('%Y-%m-%d')}",
        "dataScope": "Top 10 股票；每只最多最近 3 条新闻、2 条研报；新闻链接最多抓取 3 条正文；研报 PDF 全文解析属于第二版功能，本版暂未接入。",
        "screenerRequest": req.model_dump(),
        "sortMetric": _sort_metric_label(req),
        "matchedCount": response.total,
        "ruleInsight": response.insight.model_dump() if response.insight else None,
        "stocks": stocks,
        "fetchedLinkTexts": fetched_texts,
        "limitations": [
            "AI 只能基于本地数据、新闻/研报摘要和成功抓取的新闻正文生成洞察，不使用未提供的外部信息。",
            "研报 PDF 全文解析属于第二版功能，当前版本暂未接入，不会读取 PDF 正文，避免误导。",
            "链接抓取有超时和数量限制，失败时不会假装读取原文。",
        ],
    }


def _format_prompt_number(value: object) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "-"
    if abs(number) >= 1e8:
        return f"{number / 1e8:.2f}亿"
    if abs(number) >= 1e4:
        return f"{number / 1e4:.2f}万"
    return f"{number:.2f}"


def _build_computed_ai_insight(stocks: list[dict[str, object]], rule: dict[str, object]) -> dict[str, object]:
    numeric_rows = []
    for stock in stocks:
        try:
            value = float(stock.get("sortValue"))
        except (TypeError, ValueError):
            continue
        numeric_rows.append((stock, value))
    top_rows = numeric_rows[:5]
    top3 = numeric_rows[:3]
    top3_sum = sum(value for _, value in top3)
    top_sum = sum(value for _, value in top_rows)
    first_value = numeric_rows[0][1] if numeric_rows else None
    last_value = numeric_rows[-1][1] if len(numeric_rows) >= 2 else None
    cash_flow_alerts = []
    for stock in stocks[:5]:
        financial = stock.get("latestFinancial") if isinstance(stock.get("latestFinancial"), dict) else {}
        cfo = financial.get("operatingCashFlow")
        try:
            cfo_number = float(cfo)
        except (TypeError, ValueError):
            continue
        if cfo_number < 0:
            cash_flow_alerts.append(f"{stock.get('name') or stock.get('symbol')}经营现金流为{_format_prompt_number(cfo_number)}")
    news_clues = []
    report_clues = []
    for stock in stocks[:5]:
        for news in list(stock.get("news") or [])[:1]:
            if isinstance(news, dict) and news.get("title"):
                news_clues.append(f"{stock.get('name') or stock.get('symbol')}：{news.get('title')}")
        for report in list(stock.get("reports") or [])[:1]:
            if isinstance(report, dict) and report.get("title"):
                rating = f"，评级{report.get('rating')}" if report.get("rating") else ""
                institution = f"{report.get('institution')}" if report.get("institution") else "研报"
                report_clues.append(f"{stock.get('name') or stock.get('symbol')}：{institution}{rating}，{report.get('title')}")
    return {
        "topLeaders": [f"{stock.get('name') or stock.get('symbol')}：{_format_prompt_number(value)}" for stock, value in top3],
        "top3ShareInTop5": f"{top3_sum / top_sum * 100:.1f}%" if top_sum > 0 and top3_sum >= 0 else "",
        "leaderToFifthGap": f"{first_value / last_value:.1f}倍" if first_value and last_value and last_value > 0 else "",
        "cashFlowAlerts": cash_flow_alerts[:3],
        "newsClues": news_clues[:3],
        "reportClues": report_clues[:3],
        "ruleConclusion": rule.get("conclusion"),
    }


def _build_ai_prompt_pack(evidence_pack: dict[str, object]) -> dict[str, object]:
    stocks = []
    for item in list(evidence_pack.get("stocks") or [])[:5]:
        if not isinstance(item, dict):
            continue
        financial = item.get("financialSummary") if isinstance(item.get("financialSummary"), dict) else {}
        periods = financial.get("latestPeriods") if isinstance(financial, dict) else []
        news = item.get("news") if isinstance(item.get("news"), list) else []
        reports = item.get("reports") if isinstance(item.get("reports"), list) else []
        stocks.append({
            "symbol": item.get("symbol"),
            "name": item.get("name"),
            "industry": item.get("industry"),
            "sortValue": item.get("sortValue"),
            "formulaValues": item.get("formulaValues"),
            "profile": item.get("profile"),
            "latestFinancial": periods[0] if periods else {},
            "news": [
                {
                    "date": news_item.get("date"),
                    "title": _safe_text(news_item.get("title"), 70),
                    "summary": _safe_text(news_item.get("summary"), 70),
                }
                for news_item in news[:1]
                if isinstance(news_item, dict)
            ],
            "reports": [
                {
                    "date": report.get("date"),
                    "title": _safe_text(report.get("title"), 70),
                    "institution": report.get("institution"),
                    "rating": report.get("rating"),
                }
                for report in reports[:1]
                if isinstance(report, dict)
            ],
        })
    rule = evidence_pack.get("ruleInsight") if isinstance(evidence_pack.get("ruleInsight"), dict) else {}
    computed_insight = _build_computed_ai_insight(stocks, rule)
    return {
        "timeRange": evidence_pack.get("timeRange"),
        "dataScope": evidence_pack.get("dataScope"),
        "sortMetric": evidence_pack.get("sortMetric"),
        "matchedCount": evidence_pack.get("matchedCount"),
        "computedInsight": computed_insight,
        "ruleInsight": {
            "summary": rule.get("summary"),
            "rankingReasons": list(rule.get("rankingReasons") or [])[:2],
            "structureInsights": list(rule.get("structureInsights") or [])[:2],
            "newsInsights": list(rule.get("newsInsights") or [])[:2],
            "reportInsights": list(rule.get("reportInsights") or [])[:2],
            "conclusion": rule.get("conclusion"),
        },
        "stocks": stocks,
        "fetchedLinkTexts": [
            {
                "symbol": item.get("symbol"),
                "name": item.get("name"),
                "title": _safe_text(item.get("title"), 70),
                "text": _safe_text(item.get("text"), 350),
            }
            for item in list(evidence_pack.get("fetchedLinkTexts") or [])[:2]
            if isinstance(item, dict)
        ],
        "limitations": evidence_pack.get("limitations"),
    }


def _ai_insight_cache_key(req: ScreenerRequest, response: ScreenerResponse) -> str:
    stocks = [
        {
            "symbol": item.symbol,
            "sortValue": item.formulaSortValue if req.sortFormula else _metric_value(item, req),
            "formulaValues": item.formulaValues,
        }
        for item in response.items[:10]
    ]
    payload = {
        "schema": _AI_INSIGHT_CACHE_SCHEMA,
        "request": req.model_dump(),
        "dataDate": response.dataDate,
        "matchedCount": response.total,
        "stocks": stocks,
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _load_ai_insight_cache(cache_key: str) -> ScreenerInsight | None:
    path = _AI_INSIGHT_CACHE_DIR / f"{cache_key}.json"
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as file:
            payload = json.load(file)
        if payload.get("schema") != _AI_INSIGHT_CACHE_SCHEMA:
            return None
        insight_data = payload.get("insight") or {}
        insight = ScreenerInsight(**insight_data)
        note = "该 AI 洞察来自本地缓存；如需基于最新材料重算，请点击重新生成。"
        if note not in insight.limitations:
            insight.limitations = [note, *insight.limitations]
        return insight
    except Exception as exc:
        logger.warning("[screener] failed to load AI insight cache %s: %s", cache_key, exc)
        return None


def _save_ai_insight_cache(cache_key: str, insight: ScreenerInsight) -> None:
    try:
        _AI_INSIGHT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        path = _AI_INSIGHT_CACHE_DIR / f"{cache_key}.json"
        payload = {
            "schema": _AI_INSIGHT_CACHE_SCHEMA,
            "savedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "insight": insight.model_dump(),
        }
        with open(path, "w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False, indent=2)
    except Exception as exc:
        logger.warning("[screener] failed to save AI insight cache %s: %s", cache_key, exc)


def _decode_json_string_literal(value: str) -> str:
    try:
        return json.loads(value)
    except Exception:
        return value.strip('"').replace('\\"', '"').strip()


def _extract_ai_string(raw_text: str, key: str) -> str:
    match = re.search(rf'"{re.escape(key)}"\s*:\s*("(?:\\.|[^"\\])*)', raw_text, flags=re.DOTALL)
    if not match:
        return ""
    value = match.group(1)
    if value.endswith('"'):
        return _decode_json_string_literal(value)
    return _safe_text(value.strip('"'), 180)


def _extract_ai_string_array(raw_text: str, key: str, limit: int = 3) -> list[str]:
    match = re.search(rf'"{re.escape(key)}"\s*:\s*\[([\s\S]*?)(?:\]|$)', raw_text)
    if not match:
        return []
    block = match.group(1)
    items: list[str] = []
    for item_match in re.finditer(r'"(?:\\.|[^"\\])*"', block):
        text = _decode_json_string_literal(item_match.group(0))
        if text:
            items.append(_safe_text(text, 120))
        if len(items) >= limit:
            break
    return items


def _split_ai_text_insight(raw_text: str) -> tuple[str, list[str]]:
    text = re.sub(r"\r\n?", "\n", raw_text or "").strip()
    text = re.sub(r"```[a-zA-Z]*|```", "", text).strip()
    content = text
    evidence_text = ""
    evidence_match = re.search(r"依据样本[:：]?([\s\S]*)", text)
    content_match = re.search(r"内容[:：]([\s\S]*?)(?:依据样本[:：]?|$)", text)
    if content_match:
        content = content_match.group(1).strip()
    elif evidence_match:
        content = text[:evidence_match.start()].strip()
    if evidence_match:
        evidence_text = evidence_match.group(1).strip()
    content = re.sub(r"^[\-•\d.、\s]+", "", content).strip()
    content = _safe_text(content, 900)
    raw_lines = evidence_text.split("\n")
    if len([line for line in raw_lines if line.strip()]) <= 1:
        raw_lines = re.split(r"(?<=[。；;])\s*(?=[^。；;：:]{1,18}/?\d{6}[:：])", evidence_text)
    lines = []
    for line in raw_lines:
        cleaned = re.sub(r"^[\-•\d.、\s]+", "", line).strip(" ；;")
        if cleaned:
            lines.append(_safe_text(cleaned, 220))
    return content or _safe_text(text, 900), lines[:5]


def _evidence_from_ai_lines(lines: list[str], evidence_pack: dict[str, object], fallback: ScreenerInsight | None) -> list[dict[str, object]]:
    stocks = [item for item in list(evidence_pack.get("stocks") or []) if isinstance(item, dict)]
    evidence: list[dict[str, object]] = []
    for line in lines:
        matched = None
        for stock in stocks:
            symbol = str(stock.get("symbol") or "")
            name = str(stock.get("name") or "")
            if (symbol and symbol in line) or (name and name in line):
                matched = stock
                break
        evidence.append({
            "symbol": str((matched or {}).get("symbol") or ""),
            "name": str((matched or {}).get("name") or ""),
            "type": "AI依据",
            "title": line,
            "date": "",
            "source": "AI洞察",
            "url": "",
        })
    if evidence:
        return evidence[:4]
    if fallback and fallback.evidence:
        return fallback.evidence[:4]
    return [
        {
            "symbol": str(stock.get("symbol") or ""),
            "name": str(stock.get("name") or ""),
            "type": "排序样本",
            "title": f"{stock.get('name') or stock.get('symbol')}：排序值 {stock.get('sortValue')}",
            "date": "",
            "source": "筛选结果",
            "url": "",
        }
        for stock in stocks[:4]
    ]


def _insight_from_ai_text(raw_text: str, fallback: ScreenerInsight | None, evidence_pack: dict[str, object]) -> ScreenerInsight:
    fallback = fallback or ScreenerInsight()
    content, evidence_lines = _split_ai_text_insight(raw_text)
    evidence = _evidence_from_ai_lines(evidence_lines, evidence_pack, fallback)
    return ScreenerInsight(
        title="AI洞察",
        summary=content,
        generationMethod="AI生成",
        generatedAt=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        timeRange=str(evidence_pack.get("timeRange") or ""),
        rankingReasons=[content],
        structureInsights=[],
        newsInsights=[],
        reportInsights=[],
        conclusion=content,
        nextSteps=[],
        warnings=[],
        evidence=evidence,
        limitations=["AI 洞察基于当前筛选结果和本地摘要生成，不构成买卖建议。", "研报 PDF 全文解析属于第二版功能，当前版本暂未接入。"],
    )


def _insight_from_ai_failure(message: str, fallback: ScreenerInsight | None, evidence_pack: dict[str, object]) -> ScreenerInsight:
    insight = (fallback or ScreenerInsight()).model_copy(deep=True)
    insight.generationMethod = "规则生成"
    insight.generatedAt = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    insight.timeRange = insight.timeRange or str(evidence_pack.get("timeRange") or "")
    insight.summary = "AI 洞察暂未生成，当前显示规则洞察。"
    insight.warnings = [f"AI 洞察暂未生成：{message}。"]
    insight.limitations = ["当前内容为规则洞察，未使用 AI 生成。", "研报 PDF 全文解析属于第二版功能，当前版本暂未接入。"]
    return insight


def _insight_from_malformed_ai(raw_text: str, fallback: ScreenerInsight | None, evidence_pack: dict[str, object]) -> ScreenerInsight:
    fallback = fallback or ScreenerInsight()
    limitations = ["AI 返回的 JSON 结构不完整，系统已先修复可读取内容。", "研报 PDF 全文解析属于第二版功能，当前版本暂未接入。"]
    malformed_note = "AI 返回格式不完整，已自动修复后展示。"
    warnings = [malformed_note]
    return ScreenerInsight(
        title=_extract_ai_string(raw_text, "title") or fallback.title or "AI结果洞察",
        summary=_extract_ai_string(raw_text, "summary") or fallback.summary or "AI 返回结构不完整，已降级展示可验证洞察。",
        generationMethod="AI生成",
        generatedAt=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        timeRange=str(evidence_pack.get("timeRange") or ""),
        rankingReasons=_extract_ai_string_array(raw_text, "rankingReasons") or fallback.rankingReasons,
        structureInsights=_extract_ai_string_array(raw_text, "structureInsights") or fallback.structureInsights,
        newsInsights=_extract_ai_string_array(raw_text, "newsInsights") or fallback.newsInsights,
        reportInsights=_extract_ai_string_array(raw_text, "reportInsights") or fallback.reportInsights,
        conclusion=_extract_ai_string(raw_text, "conclusion") or fallback.conclusion,
        nextSteps=_extract_ai_string_array(raw_text, "nextSteps") or fallback.nextSteps,
        warnings=warnings[:4],
        evidence=fallback.evidence,
        limitations=limitations,
    )


def _insight_from_ai_result(result: dict, fallback: ScreenerInsight | None, evidence_pack: dict[str, object]) -> ScreenerInsight:
    fallback = fallback or ScreenerInsight()
    evidence = result.get("evidence") if isinstance(result.get("evidence"), list) else []
    clean_evidence: list[dict[str, object]] = []
    for item in evidence[:12]:
        if isinstance(item, dict):
            clean_evidence.append({
                "symbol": str(item.get("symbol") or ""),
                "name": str(item.get("name") or ""),
                "type": str(item.get("type") or ""),
                "title": str(item.get("title") or "")[:120],
                "date": str(item.get("date") or "")[:10],
                "source": str(item.get("source") or "")[:60],
                "url": str(item.get("url") or ""),
            })
    return ScreenerInsight(
        title=str(result.get("title") or fallback.title or "AI结果洞察"),
        summary=str(result.get("summary") or fallback.summary or "AI 基于当前筛选结果生成洞察"),
        generationMethod="AI生成",
        generatedAt=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        timeRange=str(evidence_pack.get("timeRange") or ""),
        rankingReasons=_as_string_list(result.get("rankingReasons")) or fallback.rankingReasons,
        structureInsights=_as_string_list(result.get("structureInsights")) or fallback.structureInsights,
        newsInsights=_as_string_list(result.get("newsInsights")) or fallback.newsInsights,
        reportInsights=_as_string_list(result.get("reportInsights")) or fallback.reportInsights,
        conclusion=str(result.get("conclusion") or fallback.conclusion),
        nextSteps=_as_string_list(result.get("nextSteps")) or fallback.nextSteps,
        warnings=_as_string_list(result.get("warnings")) or fallback.warnings,
        evidence=clean_evidence or fallback.evidence,
        limitations=_as_string_list(result.get("limitations")) or list(evidence_pack.get("limitations") or []),
    )


@router.post("/screener/insight/ai", response_model=ScreenerInsight)
async def screener_ai_insight(body: dict):
    try:
        req = ScreenerRequest(**(body.get("screenerRequest") or {}))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"筛选请求无效：{exc}") from exc
    fetch_links = bool(body.get("fetchLinks", False))
    force_refresh = bool(body.get("forceRefresh", False))
    req = req.model_copy(update={"page": 1, "pageSize": 5})
    response = await run_screener(req)
    if not response.items:
        raise HTTPException(status_code=400, detail="当前筛选结果为空，无法生成 AI 洞察")
    cache_key = _ai_insight_cache_key(req, response)
    if not force_refresh:
        cached = _load_ai_insight_cache(cache_key)
        if cached:
            return cached

    try:
        provider = ai_service.get_ai_provider()
    except AIConfigError as exception:
        raise HTTPException(status_code=400, detail=f"AI 服务未配置：{exception}") from exception

    evidence_pack = _build_ai_evidence_pack(req, response, fetch_links)
    prompt_pack = _build_ai_prompt_pack(evidence_pack)
    user_prompt = (
        "请根据 evidencePack 输出两段文本：内容、依据样本。不要 JSON。内容必须有四行：核心结论、驱动拆解、风险验证、怎么使用。"
        f"evidencePack={json.dumps(prompt_pack, ensure_ascii=False, separators=(',', ':'))}"
    )
    try:
        raw_text = await asyncio.wait_for(_call_ai_text(provider, _AI_INSIGHT_SYSTEM, user_prompt, max_tokens=1100), timeout=90)
        insight = _insight_from_ai_text(raw_text, response.insight, evidence_pack)
        _save_ai_insight_cache(cache_key, insight)
        return insight
    except TimeoutError:
        logger.exception("AI insight generation timed out")
        return _insight_from_ai_failure("AI 服务响应超时，可稍后重试或点击重新生成", response.insight, evidence_pack)
    except Exception as exception:
        logger.exception("AI insight generation failed")
        message = str(exception) or exception.__class__.__name__
        return _insight_from_ai_failure(message, response.insight, evidence_pack)


@router.post("/screener/run", response_model=ScreenerResponse)
async def run_screener(req: ScreenerRequest):
    symbols = data_store.list_stock_symbols_with_data()
    if not symbols:
        return ScreenerResponse(scannedCount=0)

    stock_names = _load_stock_names()

    presets = {"consecutive_growth", "recent_strength", "profit_growth_rank"}
    if req.preset not in presets and req.preset != "custom":
        raise HTTPException(status_code=400, detail=f"Invalid preset: {req.preset}")

    formula = None
    if req.formula and req.formula.strip():
        try:
            formula = compile_formula(req.formula)
        except FormulaError as exception:
            raise HTTPException(status_code=400, detail=str(exception)) from exception

    sort_formula = None
    if req.sortFormula and req.sortFormula.strip():
        try:
            sort_formula = compile_formula(req.sortFormula)
        except FormulaError as exception:
            raise HTTPException(status_code=400, detail=str(exception)) from exception

    rows = _get_screener_rows(symbols, stock_names)
    query = (req.q or "").strip().lower()
    candidate_rows = [row for row in rows if _matches_query(row, query)] if query else rows
    results: list[ScreenedStock] = []

    for row in candidate_rows:
        row, reasons = _evaluate_row(row, req)
        if reasons:
            continue
        formula_values = {}
        formula_reason = ""
        formula_sort_value = None
        if formula is not None:
            try:
                matched, values, reason = formula.evaluate(row)
            except FormulaError as exception:
                raise HTTPException(status_code=400, detail=str(exception)) from exception
            if not matched:
                continue
            formula_values.update(values)
            formula_reason = reason
        if sort_formula is not None:
            try:
                sort_value, sort_values = sort_formula.evaluate_value(row)
            except FormulaError as exception:
                raise HTTPException(status_code=400, detail=str(exception)) from exception
            formula_values.update(sort_values)
            formula_sort_value = _to_sort_number(sort_value)
        if formula is not None or sort_formula is not None:
            row = row.model_copy(update={
                "formulaValues": formula_values,
                "formulaReason": formula_reason,
                "formulaSortValue": formula_sort_value,
            })
        results.append(row)

    diagnosis = _diagnose_query(rows, req, query, results)

    if sort_formula is not None:
        _sort_by_formula_value(results, req.sortDir)
    else:
        sort_field = req.sortBy
        reverse = req.sortDir == "desc"
        try:
            results.sort(key=lambda s: getattr(s, sort_field, 0.0) or 0.0, reverse=reverse)
        except Exception:
            results.sort(key=lambda s: s.netProfitYoY or 0.0, reverse=True)

    total = len(results)
    insight = _build_result_insight(results, req)
    start = (req.page - 1) * req.pageSize
    end = start + req.pageSize

    return ScreenerResponse(
        items=results[start:end],
        total=total,
        matchedCount=total,
        page=req.page,
        pageSize=req.pageSize,
        scannedCount=len(symbols),
        dataDate=_get_data_freshness(symbols),
        diagnosis=diagnosis,
        insight=insight,
    )

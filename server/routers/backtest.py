import math
import re
from bisect import bisect_left, bisect_right
from datetime import datetime, timedelta
from statistics import mean
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from models.stock import ScreenedStock
from services import data_store
from services.screener_formula import (
    FormulaError,
    _BRACKET_RE,
    _FIELD_BY_LABEL,
    _INDUSTRY_SUFFIXES,
    _LATEST_RE,
    _METRIC_LABELS,
    _QUARTER_RE,
    _RECENT_RE,
    _YEAR_RE,
    _match_industry,
    _to_float as formula_to_float,
    _truthy,
    compile_formula,
)

router = APIRouter(prefix="/api", tags=["backtest"])

ScoreMode = Literal[
    "composite",
    "opportunity",
    "quality",
    "growth",
    "profitability",
    "cashflow",
    "safety",
    "efficiency",
    "valuation",
]


def _today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


class BacktestRequest(BaseModel):
    industry: str | None = None
    asOfDate: str = "2025-01-02"
    endDate: str = "2025-12-31"
    topN: int = Field(default=10, ge=1, le=100)
    scoreMode: ScoreMode = "opportunity"
    formula: str | None = None
    sortFormula: str | None = None
    sortDir: Literal["asc", "desc"] = "desc"
    rebalanceFrequency: Literal["none", "quarter"] = "none"
    benchmark: Literal["industry_equal", "all_a_equal"] = "industry_equal"
    minPeriods: int = Field(default=2, ge=1, le=12)
    maxSymbols: int = Field(default=800, ge=20, le=3000)


def _parse_date(value: str) -> datetime:
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"日期格式错误：{value}") from exc


def _date_str(value: datetime) -> str:
    return value.strftime("%Y-%m-%d")


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        number = float(value)
        if math.isnan(number) or math.isinf(number):
            return default
        return number
    except Exception:
        return default


def _avg(values: list[float]) -> float:
    clean = [v for v in values if math.isfinite(v)]
    return float(mean(clean)) if clean else 0.0


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _percentile(value: float, values: list[float], higher_better: bool = True) -> float:
    clean = sorted(v for v in values if math.isfinite(v))
    if not clean:
        return 50.0
    if higher_better:
        rank = bisect_right(clean, value)
        return rank / len(clean) * 100
    rank = len(clean) - bisect_left(clean, value)
    return rank / len(clean) * 100


def _rank_ic(rows: list[dict[str, Any]]) -> float:
    pairs = [(r.get("score"), r.get("returnPct")) for r in rows if r.get("returnPct") is not None]
    pairs = [(float(a), float(b)) for a, b in pairs if math.isfinite(float(a)) and math.isfinite(float(b))]
    if len(pairs) < 3:
        return 0.0
    score_order = {id_pair: rank for rank, id_pair in enumerate(sorted(range(len(pairs)), key=lambda i: pairs[i][0]), start=1)}
    ret_order = {id_pair: rank for rank, id_pair in enumerate(sorted(range(len(pairs)), key=lambda i: pairs[i][1]), start=1)}
    xs = [score_order[i] for i in range(len(pairs))]
    ys = [ret_order[i] for i in range(len(pairs))]
    mx, my = mean(xs), mean(ys)
    numerator = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    denominator = math.sqrt(sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys))
    return round(numerator / denominator, 4) if denominator else 0.0


def _load_json_list(symbol: str, data_type: str) -> list[dict[str, Any]]:
    data = data_store.load_stock_data(symbol, data_type)
    return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []


def _load_profile(symbol: str) -> dict[str, Any]:
    data = data_store.load_stock_data(symbol, "profile")
    return data if isinstance(data, dict) else {}


def _notice_date(period: dict[str, Any]) -> str:
    notice = str(period.get("noticeDate") or "")[:10]
    if notice:
        return notice
    report_date = str(period.get("reportDate") or "")[:10]
    if not report_date:
        return "9999-12-31"
    try:
        base = _parse_date(report_date)
    except HTTPException:
        return "9999-12-31"
    quarter = str(period.get("reportQuarter") or "")
    delay = 120 if quarter == "FY" else 45
    return _date_str(base + timedelta(days=delay))


def _period_label(period: dict[str, Any]) -> str:
    return f"{period.get('reportYear')}{period.get('reportQuarter')}"


def _available_periods(symbol: str, as_of: str) -> list[dict[str, Any]]:
    periods = _load_json_list(symbol, "financial_periods")
    visible = [p for p in periods if _notice_date(p) <= as_of]
    return sorted(visible, key=lambda p: str(p.get("reportDate") or ""))


def _latest_fy(periods: list[dict[str, Any]]) -> dict[str, Any] | None:
    fy = [p for p in periods if p.get("reportQuarter") == "FY"]
    return fy[-1] if fy else (periods[-1] if periods else None)


def _previous_period(periods: list[dict[str, Any]]) -> dict[str, Any] | None:
    return periods[-2] if len(periods) >= 2 else None


def _consecutive_growth_years(periods: list[dict[str, Any]]) -> int:
    fy_periods = sorted([p for p in periods if p.get("reportQuarter") == "FY"], key=lambda p: int(p.get("reportYear") or 0), reverse=True)
    count = 0
    for p in fy_periods:
        if _safe_float(p.get("netProfitYoY")) > 0 and _safe_float(p.get("revenueYoY")) > 0:
            count += 1
        else:
            break
    return count


def _score_row(row: dict[str, Any], prev: dict[str, Any] | None) -> dict[str, float]:
    revenue_yoy = _safe_float(row.get("revenueYoY"))
    profit_yoy = _safe_float(row.get("netProfitYoY"))
    roe = _safe_float(row.get("roe"))
    net_margin = _safe_float(row.get("netMargin"))
    debt = _safe_float(row.get("debtAssetRatio"))
    current_ratio = _safe_float(row.get("currentRatio"))
    net_profit = _safe_float(row.get("netProfit"))
    cfo = _safe_float(row.get("operatingCashFlow"))
    fcf = _safe_float(row.get("freeCashFlow"))

    growth = 0.0
    growth += 12 if revenue_yoy > 20 else 8 if revenue_yoy > 10 else 5 if revenue_yoy > 0 else 0
    growth += 13 if profit_yoy > 20 else 9 if profit_yoy > 10 else 5 if profit_yoy > 0 else 0

    profitability = 0.0
    profitability += 15 if roe > 20 else 10 if roe > 10 else 5
    profitability += 10 if net_margin > 20 else 6 if net_margin > 10 else 3

    cfo_ratio = cfo / net_profit if net_profit > 0 else None
    cashflow = 12 if cfo_ratio is not None and cfo_ratio > 1 else 8 if cfo_ratio is not None and cfo_ratio > 0.7 else 7 if net_profit <= 0 and cfo > 0 else 3
    cashflow += 8 if fcf > 0 else 0

    safety = 10 if debt < 30 else 6 if debt < 60 else 2
    safety += 5 if current_ratio > 1.5 else 0

    asset_turnover = _safe_float(row.get("assetTurnover"))
    prev_asset_turnover = _safe_float(prev.get("assetTurnover")) if prev else 0
    efficiency = 8 if prev and asset_turnover > prev_asset_turnover else 4
    revenue = _safe_float(row.get("revenue"))
    prev_revenue = _safe_float(prev.get("revenue")) if prev else 0
    expense = _safe_float(row.get("salesExpense")) + _safe_float(row.get("manageExpense")) + _safe_float(row.get("financeExpense"))
    prev_expense = (_safe_float(prev.get("salesExpense")) + _safe_float(prev.get("manageExpense")) + _safe_float(prev.get("financeExpense"))) if prev else 0
    expense_ratio = expense / revenue if revenue else 0
    prev_expense_ratio = prev_expense / prev_revenue if prev_revenue else None
    if prev_expense_ratio is not None and expense_ratio < prev_expense_ratio:
        efficiency += 7

    total = _clamp(growth + profitability + cashflow + safety + efficiency)
    return {
        "total": round(total, 2),
        "growth": round(growth, 2),
        "profitability": round(profitability, 2),
        "cashflow": round(cashflow, 2),
        "safety": round(safety, 2),
        "efficiency": round(efficiency, 2),
    }


def _price_points(symbol: str) -> list[tuple[str, float]]:
    rows = _load_json_list(symbol, "kline_day")
    points: list[tuple[str, float]] = []
    for item in rows:
        date = str(item.get("date") or "")[:10]
        close = _safe_float(item.get("close"), 0)
        if date and close > 0:
            points.append((date, close))
    return sorted(points, key=lambda x: x[0])


def _first_price_on_or_after(points: list[tuple[str, float]], date: str) -> tuple[str, float] | None:
    idx = bisect_left([p[0] for p in points], date)
    if idx >= len(points):
        return None
    return points[idx]


def _last_price_on_or_before(points: list[tuple[str, float]], date: str) -> tuple[str, float] | None:
    idx = bisect_right([p[0] for p in points], date) - 1
    if idx < 0:
        return None
    return points[idx]


def _future_return(symbol: str, start_date: str, end_date: str) -> dict[str, Any] | None:
    points = _price_points(symbol)
    start = _first_price_on_or_after(points, start_date)
    end = _last_price_on_or_before(points, end_date)
    if not start or not end or end[0] <= start[0] or start[1] <= 0:
        return None
    in_range = [(d, p) for d, p in points if start[0] <= d <= end[0]]
    peak = start[1]
    max_drawdown = 0.0
    for _, price in in_range:
        peak = max(peak, price)
        if peak > 0:
            max_drawdown = min(max_drawdown, (price - peak) / peak * 100)
    return {
        "startDate": start[0],
        "endDate": end[0],
        "startPrice": round(start[1], 3),
        "endPrice": round(end[1], 3),
        "returnPct": round((end[1] - start[1]) / start[1] * 100, 2),
        "maxDrawdown": round(max_drawdown, 2),
    }


def _add_months(date: datetime, months: int) -> datetime:
    month = date.month - 1 + months
    year = date.year + month // 12
    month = month % 12 + 1
    day = min(date.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
    return datetime(year, month, day)


class HistoricalFormulaContext:
    def __init__(self, row: ScreenedStock, periods: list[dict[str, Any]], kline_until_asof: list[dict[str, Any]], profile: dict[str, Any]):
        self.row = row
        self._periods = sorted(periods, key=lambda item: str(item.get("reportDate") or ""), reverse=True)
        self._kline = kline_until_asof
        self._profile = profile
        self.used_fields: dict[str, Any] = {}

    def resolve(self, raw_name: str) -> Any:
        name = raw_name.strip()
        value = self._resolve(name)
        self.used_fields[name] = value
        return value

    def _resolve(self, name: str) -> Any:
        normalized = name.lower()
        field = _FIELD_BY_LABEL.get(normalized)
        if field:
            return self._resolve_known_field(field.key)
        if self._is_industry_field_name(name):
            return _match_industry(self.row.industry or "", name)
        bracket = _BRACKET_RE.match(name)
        if bracket:
            metric_label, period_label = bracket.groups()
            return self._period_metric(period_label.upper(), metric_label)
        recent = _RECENT_RE.match(name)
        if recent:
            count = int(recent.group(1))
            scope = recent.group(2)
            metric_label = recent.group(3)
            return self._recent_metric_values(count, scope, metric_label)
        quarter = _QUARTER_RE.match(name)
        if quarter:
            year, quarter_label, metric_label = quarter.groups()
            quarter_label = quarter_label.upper()
            quarter_map = {"年报": "FY", "一季报": "Q1", "中报": "H1", "三季报": "Q3"}
            return self._period_metric(f"{year}{quarter_map.get(quarter_label, quarter_label)}", metric_label)
        latest = _LATEST_RE.match(name)
        if latest:
            scope = latest.group(1) or "年度"
            metric_label = latest.group(2)
            periods = self._fy_periods() if scope in {"年度", "年报"} else self._periods
            return self._metric_from_period(periods[0] if periods else None, metric_label)
        year = _YEAR_RE.match(name)
        if year:
            year_value, metric_label = year.groups()
            return self._period_metric(f"{year_value}FY", metric_label)
        raise FormulaError(f"未知字段：@{name}")

    def _is_industry_field_name(self, name: str) -> bool:
        clean = name.strip()
        for suffix in _INDUSTRY_SUFFIXES:
            if clean.endswith(suffix):
                clean = clean[: -len(suffix)]
        return bool(clean) and _match_industry(self.row.industry or "", clean)

    def _resolve_known_field(self, key: str) -> Any:
        if hasattr(self.row, key):
            return getattr(self.row, key)
        if key.startswith("latest."):
            return self._metric_from_period(self._latest_fy(), key.split(".", 1)[1])
        if key in {"currentPrice", "changePercent", "pe", "pb", "marketCap", "freeFloatMarketCap", "turnoverRate", "volumeRatio"}:
            return self._profile.get(key, getattr(self.row, key, None))
        if key in {"close", "ma5", "ma10", "ma20", "ma60"}:
            if not self._kline:
                return None
            return formula_to_float(self._kline[-1].get("close" if key == "close" else key), None)
        if key == "change20d":
            return self._kline_change(20)
        if key in {"change60d", "recentStrength"}:
            return self._kline_change(60)
        if key == "hasProfileData":
            return bool(self._profile)
        if key == "hasFinancialData":
            return bool(self._periods)
        if key == "hasKlineData":
            return bool(self._kline)
        return None

    def _fy_periods(self) -> list[dict[str, Any]]:
        return [item for item in self._periods if item.get("reportQuarter") == "FY"]

    def _latest_fy(self) -> dict[str, Any] | None:
        periods = self._fy_periods()
        return periods[0] if periods else (self._periods[0] if self._periods else None)

    def _metric_key(self, label_or_key: str) -> str | None:
        clean = label_or_key.strip()
        return _METRIC_LABELS.get(clean) or _METRIC_LABELS.get(clean.upper()) or (clean if re.match(r"^[A-Za-z][A-Za-z0-9_]*$", clean) else None)

    def _metric_from_period(self, period: dict[str, Any] | None, metric_label: str) -> Any:
        if not period:
            return None
        key = self._metric_key(metric_label)
        if not key:
            raise FormulaError(f"未知财务指标：{metric_label}")
        return formula_to_float(period.get(key), None)

    def _period_metric(self, period_label: str, metric_label: str) -> Any:
        match = re.match(r"^(\d{4})(Q1|H1|Q3|FY)?$", period_label.upper())
        if not match:
            raise FormulaError(f"未知报告期：{period_label}")
        year = int(match.group(1))
        quarter = match.group(2) or "FY"
        for period in self._periods:
            if int(period.get("reportYear") or 0) == year and str(period.get("reportQuarter") or "").upper() == quarter:
                return self._metric_from_period(period, metric_label)
        return None

    def _recent_metric_values(self, count: int, scope: str, metric_label: str) -> list[float]:
        source = self._fy_periods() if scope == "年" else self._periods
        values: list[float] = []
        for period in source[:max(0, count)]:
            value = self._metric_from_period(period, metric_label)
            if value is not None:
                values.append(value)
        return values

    def _kline_change(self, days: int) -> Any:
        if len(self._kline) <= days:
            return None
        start = formula_to_float(self._kline[-days - 1].get("close"), None)
        end = formula_to_float(self._kline[-1].get("close"), None)
        if not start or end is None:
            return None
        return (end - start) / start * 100


def _build_universe(req: BacktestRequest) -> list[dict[str, Any]]:
    as_of = req.asOfDate
    symbols = data_store.list_stock_symbols_with_data()[: req.maxSymbols]
    rows: list[dict[str, Any]] = []
    for symbol in symbols:
        profile = _load_profile(symbol)
        industry = str(profile.get("industry") or "")
        if req.industry and industry != req.industry:
            continue
        periods = _available_periods(symbol, as_of)
        latest = _latest_fy(periods)
        prev = _previous_period(periods)
        kline = [item for item in _load_json_list(symbol, "kline_day") if str(item.get("date") or "")[:10] <= as_of]
        has_kline = bool(kline)
        if not latest or len(periods) < req.minPeriods or not has_kline:
            continue
        profile_price = _first_price_on_or_after(_price_points(symbol), as_of)
        current_price = profile_price[1] if profile_price else _safe_float(profile.get("currentPrice"))
        row = ScreenedStock(
            symbol=symbol,
            name=str(profile.get("name") or symbol),
            industry=industry,
            currentPrice=current_price,
            changePercent=0.0,
            pe=_safe_float(profile.get("pe")),
            pb=_safe_float(profile.get("pb")),
            marketCap=_safe_float(profile.get("marketCap")),
            roe=_safe_float(latest.get("roe")),
            netProfitYoY=_safe_float(latest.get("netProfitYoY")),
            revenueYoY=_safe_float(latest.get("revenueYoY")),
            grossMargin=_safe_float(latest.get("grossMargin")),
            netMargin=_safe_float(latest.get("netMargin")),
            debtAssetRatio=_safe_float(latest.get("debtAssetRatio")),
            consecutiveGrowthYears=_consecutive_growth_years(periods),
            recentStrength=0.0,
            hasProfileData=bool(profile),
            hasFinancialData=bool(periods),
            hasKlineData=has_kline,
        )
        scores = _score_row(latest, prev)
        rows.append({
            "row": row,
            "profile": profile,
            "periods": periods,
            "latest": latest,
            "latestPeriod": _period_label(latest),
            "kline": kline,
            "scores": scores,
        })
    return rows


def _apply_formula(rows: list[dict[str, Any]], req: BacktestRequest) -> list[dict[str, Any]]:
    filter_formula = compile_formula(req.formula) if req.formula and req.formula.strip() else None
    sort_formula = compile_formula(req.sortFormula) if req.sortFormula and req.sortFormula.strip() else None
    results = []
    for item in rows:
        row: ScreenedStock = item["row"]
        if filter_formula is not None:
            ctx = HistoricalFormulaContext(row, item["periods"], item["kline"], item["profile"])
            matched = _truthy(filter_formula.ast.eval(ctx))
            if not matched:
                continue
            item["formulaValues"] = ctx.used_fields
        if sort_formula is not None:
            ctx = HistoricalFormulaContext(row, item["periods"], item["kline"], item["profile"])
            value = formula_to_float(sort_formula.ast.eval(ctx), None)
            item["formulaSortValue"] = value
            item["formulaValues"] = {**item.get("formulaValues", {}), **ctx.used_fields}
        results.append(item)
    if sort_formula is not None:
        reverse = req.sortDir == "desc"
        results.sort(key=lambda item: (item.get("formulaSortValue") is not None, item.get("formulaSortValue") or 0), reverse=reverse)
    return results


def _enrich_scores(rows: list[dict[str, Any]], req: BacktestRequest) -> list[dict[str, Any]]:
    pe_values = [_safe_float(item["row"].pe) for item in rows if _safe_float(item["row"].pe) > 0]
    pb_values = [_safe_float(item["row"].pb) for item in rows if _safe_float(item["row"].pb) > 0]
    total_values = [item["scores"]["total"] for item in rows]
    growth_values = [item["scores"]["growth"] for item in rows]
    profitability_values = [item["scores"]["profitability"] for item in rows]
    cashflow_values = [item["scores"]["cashflow"] for item in rows]
    safety_values = [item["scores"]["safety"] for item in rows]
    efficiency_values = [item["scores"]["efficiency"] for item in rows]
    for item in rows:
        row: ScreenedStock = item["row"]
        scores = item["scores"]
        relative = _avg([
            _percentile(scores["total"], total_values),
            _percentile(scores["growth"], growth_values),
            _percentile(scores["profitability"], profitability_values),
            _percentile(scores["cashflow"], cashflow_values),
            _percentile(scores["safety"], safety_values),
            _percentile(scores["efficiency"], efficiency_values),
        ])
        pe_pct = _percentile(_safe_float(row.pe), pe_values, higher_better=False) if row.pe > 0 else 45
        pb_pct = _percentile(_safe_float(row.pb), pb_values, higher_better=False) if row.pb > 0 else 45
        valuation = _avg([pe_pct, pb_pct])
        quality = _avg([scores["total"], relative, scores["profitability"] * 4, scores["cashflow"] * 5])
        opportunity = _avg([quality, valuation, scores["growth"] * 4, scores["safety"] * 6])
        composite = scores["total"] * 0.6 + relative * 0.4
        item["scoreBreakdown"] = {
            "composite": round(_clamp(composite), 2),
            "opportunity": round(_clamp(opportunity), 2),
            "quality": round(_clamp(quality), 2),
            "growth": round(_clamp(scores["growth"] * 4), 2),
            "profitability": round(_clamp(scores["profitability"] * 4), 2),
            "cashflow": round(_clamp(scores["cashflow"] * 5), 2),
            "safety": round(_clamp(scores["safety"] * 6.67), 2),
            "efficiency": round(_clamp(scores["efficiency"] * 6.67), 2),
            "valuation": round(_clamp(valuation), 2),
            "relative": round(relative, 2),
        }
        item["activeScore"] = item["scoreBreakdown"].get(req.scoreMode, item["scoreBreakdown"]["opportunity"])
    if req.sortFormula:
        return rows
    return sorted(rows, key=lambda item: item["activeScore"], reverse=True)


def _result_row(item: dict[str, Any], req: BacktestRequest, benchmark_return: float = 0.0) -> dict[str, Any] | None:
    row: ScreenedStock = item["row"]
    ret = _future_return(row.symbol, req.asOfDate, req.endDate)
    if not ret:
        return None
    horizons = {}
    start_dt = _parse_date(req.asOfDate)
    for months in (1, 3, 6, 12):
        horizon_end = min(_add_months(start_dt, months), _parse_date(req.endDate))
        horizon = _future_return(row.symbol, req.asOfDate, _date_str(horizon_end))
        horizons[f"m{months}"] = horizon["returnPct"] if horizon else None
    excess = ret["returnPct"] - benchmark_return
    return {
        "symbol": row.symbol,
        "name": row.name,
        "industry": row.industry,
        "score": round(item["activeScore"], 2),
        "scoreBreakdown": item["scoreBreakdown"],
        "latestPeriod": item["latestPeriod"],
        "formulaSortValue": item.get("formulaSortValue"),
        "formulaValues": item.get("formulaValues", {}),
        **ret,
        "excessReturn": round(excess, 2),
        "horizons": horizons,
        "maxDrawdown": ret["maxDrawdown"],
        "reasons": _mistake_reasons(item, ret["returnPct"], benchmark_return),
    }


def _mistake_reasons(item: dict[str, Any], return_pct: float, benchmark_return: float) -> list[str]:
    row: ScreenedStock = item["row"]
    latest = item["latest"]
    reasons: list[str] = []
    if return_pct - benchmark_return < -10:
        if row.pe > 45 or row.pb > 6:
            reasons.append("估值偏高，财务高分可能已被价格提前透支")
        if _safe_float(latest.get("netProfitYoY")) > 30 and item["scoreBreakdown"].get("valuation", 50) < 45:
            reasons.append("高增长与估值不匹配，存在成长兑现不足风险")
        net_profit = _safe_float(latest.get("netProfit"))
        cfo = _safe_float(latest.get("operatingCashFlow"))
        if net_profit > 0 and cfo / net_profit < 0.5:
            reasons.append("利润现金含量低，净利润增长缺少现金流支撑")
        if _safe_float(latest.get("debtAssetRatio")) > 65:
            reasons.append("资产负债率偏高，回撤阶段风险放大")
        if not reasons:
            reasons.append("高分后跑输，需复核行业景气、公告风险或模型权重")
    return reasons


def _portfolio_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    returns = [r["returnPct"] for r in rows if r.get("returnPct") is not None]
    drawdowns = [r["maxDrawdown"] for r in rows if r.get("maxDrawdown") is not None]
    excess = [r["excessReturn"] for r in rows if r.get("excessReturn") is not None]
    if not returns:
        return {"avgReturn": 0, "medianReturn": 0, "winRate": 0, "avgExcess": 0, "maxDrawdown": 0, "count": 0}
    sorted_returns = sorted(returns)
    mid = len(sorted_returns) // 2
    median = sorted_returns[mid] if len(sorted_returns) % 2 else (sorted_returns[mid - 1] + sorted_returns[mid]) / 2
    return {
        "avgReturn": round(_avg(returns), 2),
        "medianReturn": round(median, 2),
        "winRate": round(len([r for r in returns if r > 0]) / len(returns) * 100, 2),
        "avgExcess": round(_avg(excess), 2),
        "maxDrawdown": round(min(drawdowns) if drawdowns else 0, 2),
        "count": len(returns),
    }


def _split_groups(result_rows: list[dict[str, Any]]) -> dict[str, Any]:
    rows = sorted(result_rows, key=lambda r: r["score"], reverse=True)
    if not rows:
        return {"top": [], "middle": [], "bottom": [], "summary": []}
    cut = max(1, math.ceil(len(rows) * 0.2))
    top = rows[:cut]
    bottom = rows[-cut:]
    middle = rows[cut:-cut] if len(rows) > cut * 2 else []
    summary = [
        {"group": "高分组Top20%", **_portfolio_metrics(top)},
        {"group": "中分组Middle60%", **_portfolio_metrics(middle)},
        {"group": "低分组Bottom20%", **_portfolio_metrics(bottom)},
    ]
    return {"top": top, "middle": middle, "bottom": bottom, "summary": summary}


def _benchmark_return(rows: list[dict[str, Any]], req: BacktestRequest) -> float:
    values = []
    for item in rows:
        ret = _future_return(item["row"].symbol, req.asOfDate, req.endDate)
        if ret:
            values.append(ret["returnPct"])
    return round(_avg(values), 2)


def _rolling_dates(as_of: str, end: str) -> list[str]:
    start = _parse_date(as_of)
    end_dt = _parse_date(end)
    dates = []
    current = start
    while current < end_dt:
        dates.append(_date_str(current))
        current = _add_months(current, 3)
    return dates[:12]


def _run_single(req: BacktestRequest) -> dict[str, Any]:
    rows = _build_universe(req)
    if req.formula or req.sortFormula:
        rows = _apply_formula(rows, req)
    rows = _enrich_scores(rows, req)
    benchmark = _benchmark_return(rows, req)
    result_rows = []
    for item in rows:
        result = _result_row(item, req, benchmark)
        if result:
            result_rows.append(result)
    if req.sortFormula:
        reverse = req.sortDir == "desc"
        result_rows.sort(key=lambda r: (r.get("formulaSortValue") is not None, r.get("formulaSortValue") or 0), reverse=reverse)
    else:
        result_rows.sort(key=lambda r: r["score"], reverse=True)
    groups = _split_groups(result_rows)
    top_rows = result_rows[: req.topN]
    mistakes = [r for r in top_rows if r["excessReturn"] < -10 or r["returnPct"] < -15]
    mistakes.sort(key=lambda r: r["excessReturn"])
    factor_rows = []
    for factor in ["composite", "opportunity", "quality", "growth", "profitability", "cashflow", "safety", "efficiency", "valuation"]:
        factor_input = [{"score": r["scoreBreakdown"].get(factor, 0), "returnPct": r["returnPct"]} for r in result_rows]
        sorted_factor = sorted(result_rows, key=lambda r: r["scoreBreakdown"].get(factor, 0), reverse=True)
        top_factor = sorted_factor[: max(1, math.ceil(len(sorted_factor) * 0.2))]
        factor_rows.append({
            "factor": factor,
            "rankIc": _rank_ic(factor_input),
            "topAvgReturn": _portfolio_metrics(top_factor)["avgReturn"],
            "topWinRate": _portfolio_metrics(top_factor)["winRate"],
        })
    return {
        "params": req.model_dump(),
        "asOfDate": req.asOfDate,
        "endDate": req.endDate,
        "universeCount": len(rows),
        "benchmarkReturn": benchmark,
        "topPortfolio": {**_portfolio_metrics(top_rows), "benchmarkReturn": benchmark},
        "allPortfolio": _portfolio_metrics(result_rows),
        "rankIc": _rank_ic(result_rows),
        "topRows": top_rows,
        "allRows": result_rows[:300],
        "groups": groups,
        "factorValidation": factor_rows,
        "mistakes": mistakes[:30],
        "insights": _build_insights(top_rows, groups, factor_rows, mistakes, benchmark),
    }


def _build_insights(top_rows: list[dict[str, Any]], groups: dict[str, Any], factors: list[dict[str, Any]], mistakes: list[dict[str, Any]], benchmark: float) -> list[str]:
    insights: list[str] = []
    top_metrics = _portfolio_metrics(top_rows)
    top_group = groups.get("summary", [{}])[0] if groups.get("summary") else {}
    bottom_group = groups.get("summary", [{}, {}, {}])[-1] if groups.get("summary") else {}
    if top_metrics["avgExcess"] > 5:
        insights.append(f"Top组合平均超额收益 {top_metrics['avgExcess']}%，模型在该区间具备正向筛选能力。")
    elif top_metrics["avgExcess"] < -5:
        insights.append(f"Top组合平均超额收益 {top_metrics['avgExcess']}%，模型在该区间失效，需要复核权重。")
    else:
        insights.append("Top组合与基准接近，模型区分度一般，需要看分层和因子贡献。")
    if top_group.get("avgReturn", 0) > bottom_group.get("avgReturn", 0):
        insights.append(f"高分组收益 {top_group.get('avgReturn', 0)}%，低分组 {bottom_group.get('avgReturn', 0)}%，分层方向正确。")
    else:
        insights.append(f"高分组未跑赢低分组，高分可能来自已透支指标或行业风格切换。")
    best_factor = max(factors, key=lambda x: x.get("rankIc", 0), default=None)
    worst_factor = min(factors, key=lambda x: x.get("rankIc", 0), default=None)
    if best_factor:
        insights.append(f"当前最有效因子是 {best_factor['factor']}，Rank IC={best_factor['rankIc']}。")
    if worst_factor and worst_factor.get("rankIc", 0) < -0.05:
        insights.append(f"拖后腿因子是 {worst_factor['factor']}，Rank IC={worst_factor['rankIc']}，建议降权或增加约束。")
    if mistakes:
        insights.append(f"Top组合中发现 {len(mistakes)} 个明显误判样本，需重点复盘估值、现金流和后续财报拐点。")
    insights.append(f"基准使用行业/样本等权收益，当前区间基准收益 {benchmark}%。")
    return insights


@router.post("/backtest/validate")
async def validate_backtest(req: BacktestRequest):
    start = _parse_date(req.asOfDate)
    end = _parse_date(req.endDate)
    if end <= start:
        raise HTTPException(status_code=400, detail="结束日期必须晚于选股日期")
    try:
        single = _run_single(req)
        rolling = []
        if req.rebalanceFrequency == "quarter":
            for date in _rolling_dates(req.asOfDate, req.endDate):
                next_date = min(_add_months(_parse_date(date), 3), end)
                sub_req = req.model_copy(update={"asOfDate": date, "endDate": _date_str(next_date), "rebalanceFrequency": "none"})
                sub = _run_single(sub_req)
                rolling.append({
                    "asOfDate": date,
                    "endDate": _date_str(next_date),
                    "avgReturn": sub["topPortfolio"]["avgReturn"],
                    "benchmarkReturn": sub["benchmarkReturn"],
                    "avgExcess": sub["topPortfolio"]["avgExcess"],
                    "rankIc": sub["rankIc"],
                    "count": sub["topPortfolio"]["count"],
                })
        single["rolling"] = rolling
        single["generatedAt"] = _today()
        return single
    except FormulaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

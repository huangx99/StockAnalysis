import json
import logging
import math
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from models.stock import ScreenedStock
from services import data_store

logger = logging.getLogger(__name__)


class FormulaError(ValueError):
    pass


@dataclass
class FormulaField:
    key: str
    label: str
    category: str
    description: str = ""
    aliases: tuple[str, ...] = ()
    unit: str = ""


FORMULA_FIELDS: list[FormulaField] = [
    FormulaField("currentPrice", "最新价", "行情估值", "最新行情价格"),
    FormulaField("changePercent", "涨跌幅", "行情估值", "最新涨跌幅", unit="%"),
    FormulaField("pe", "市盈率TTM", "行情估值", "动态市盈率", aliases=("PE", "市盈率")),
    FormulaField("pb", "市净率", "行情估值", "市净率", aliases=("PB",)),
    FormulaField("marketCap", "总市值", "行情估值", "总市值，单位为元", aliases=("市值",)),
    FormulaField("freeFloatMarketCap", "流通市值", "行情估值", "流通市值，单位为元"),
    FormulaField("turnoverRate", "换手率", "行情估值", "最新换手率", unit="%"),
    FormulaField("volumeRatio", "量比", "行情估值", "最新量比"),
    FormulaField("latest.roe", "ROE", "最新财务", "最新年度 ROE", unit="%"),
    FormulaField("latest.revenueYoY", "营收同比", "最新财务", "最新年度营收同比", aliases=("营收增速",), unit="%"),
    FormulaField("latest.netProfitYoY", "净利润同比", "最新财务", "最新年度净利润同比", aliases=("净利同比", "净利增速", "净利润增速"), unit="%"),
    FormulaField("latest.grossMargin", "毛利率", "最新财务", "最新年度毛利率", unit="%"),
    FormulaField("latest.netMargin", "净利率", "最新财务", "最新年度净利率", unit="%"),
    FormulaField("latest.debtAssetRatio", "资产负债率", "最新财务", "最新年度资产负债率", unit="%"),
    FormulaField("latest.revenue", "营业收入", "最新财务", "最新年度营业收入", aliases=("营收",)),
    FormulaField("latest.netProfit", "净利润", "最新财务", "最新年度净利润"),
    FormulaField("latest.operatingCashFlow", "经营现金流", "最新财务", "最新年度经营现金流"),
    FormulaField("latest.freeCashFlow", "自由现金流", "最新财务", "最新年度自由现金流"),
    FormulaField("latest.eps", "EPS", "最新财务", "最新年度每股收益"),
    FormulaField("consecutiveGrowthYears", "连续增长年数", "趋势统计", "营收与净利润连续正增长年数"),
    FormulaField("recentStrength", "近3月涨幅", "技术指标", "近 60 个交易日涨跌幅", unit="%"),
    FormulaField("close", "收盘价", "技术指标", "最新日 K 收盘价"),
    FormulaField("ma5", "MA5", "技术指标", "5 日均线"),
    FormulaField("ma10", "MA10", "技术指标", "10 日均线"),
    FormulaField("ma20", "MA20", "技术指标", "20 日均线"),
    FormulaField("ma60", "MA60", "技术指标", "60 日均线"),
    FormulaField("change20d", "近20日涨跌幅", "技术指标", "近 20 个交易日涨跌幅", unit="%"),
    FormulaField("change60d", "近60日涨跌幅", "技术指标", "近 60 个交易日涨跌幅", unit="%"),
    FormulaField("hasProfileData", "有基本信息", "数据状态", "本地是否有基本信息"),
    FormulaField("hasFinancialData", "有财务数据", "数据状态", "本地是否有财务数据"),
    FormulaField("hasKlineData", "有日K", "数据状态", "本地是否有日 K 数据"),
    FormulaField("hasNews", "有新闻", "数据状态", "本地是否有新闻数据", aliases=("新闻",)),
    FormulaField("hasNotices", "有公告", "数据状态", "本地是否有公告数据", aliases=("公告",)),
    FormulaField("hasReports", "有研报", "数据状态", "本地是否有研报数据", aliases=("研报",)),
]

_FIELD_BY_LABEL: dict[str, FormulaField] = {}
for field in FORMULA_FIELDS:
    _FIELD_BY_LABEL[field.label.lower()] = field
    _FIELD_BY_LABEL[field.key.lower()] = field
    for alias in field.aliases:
        _FIELD_BY_LABEL[alias.lower()] = field

_METRIC_LABELS: dict[str, str] = {
    "营业收入": "revenue",
    "营收": "revenue",
    "营收同比": "revenueYoY",
    "营收增速": "revenueYoY",
    "净利润": "netProfit",
    "净利润同比": "netProfitYoY",
    "净利同比": "netProfitYoY",
    "净利润增速": "netProfitYoY",
    "毛利率": "grossMargin",
    "净利率": "netMargin",
    "ROE": "roe",
    "ROA": "roa",
    "资产负债率": "debtAssetRatio",
    "经营现金流": "operatingCashFlow",
    "自由现金流": "freeCashFlow",
    "EPS": "eps",
    "总资产": "totalAssets",
    "总负债": "totalLiabilities",
    "股东权益": "equity",
    "货币资金": "cash",
    "应收账款": "accountsReceivable",
    "存货": "inventory",
    "商誉": "goodwill",
    "研发费用": "rdExpense",
    "销售费用": "salesExpense",
    "管理费用": "manageExpense",
    "财务费用": "financeExpense",
    "营业利润": "operatingProfit",
    "利润总额": "totalProfit",
    "扣非净利润": "deductedNetProfit",
    "经营现金流同比": "operatingCashFlowYoY",
    "现金流净利比": "cfoToNetProfit",
}
_QUARTER_RE = re.compile(r"^(\d{4})(Q1|H1|Q3|FY|年报|一季报|中报|三季报)(.+)$", re.IGNORECASE)
_YEAR_RE = re.compile(r"^(\d{4})(.+)$")
_RECENT_RE = re.compile(r"^近(\d+)(年|季)(.+)$")
_BRACKET_RE = re.compile(r"^(.+)\[(\d{4}(?:Q1|H1|Q3|FY)?)\]$", re.IGNORECASE)
_LATEST_RE = re.compile(r"^最新(季度|年度|年报)?(.+)$")
_INDUSTRY_SUFFIXES = ("行业", "板块", "概念")
_INVALID_INDUSTRY_NAMES = {"", "-", "--", "未知", "其他"}
_INDUSTRY_KEYWORD_ALIASES: dict[str, tuple[str, ...]] = {
    "稀土": ("小金属", "金属新材料"),
    "稀土永磁": ("小金属", "金属新材料"),
    "有色": ("工业金属", "小金属", "贵金属", "能源金属", "金属新材料"),
}
_INDUSTRY_CACHE_TTL_SECONDS = 300
_industry_cache: dict[str, Any] = {"built_at": 0.0, "counts": {}}


def _industry_counts() -> dict[str, int]:
    now = time.time()
    cached = _industry_cache.get("counts")
    if isinstance(cached, dict) and now - float(_industry_cache.get("built_at") or 0) < _INDUSTRY_CACHE_TTL_SECONDS:
        return cached

    counts: dict[str, int] = {}
    for symbol in data_store.list_stock_symbols_with_data():
        profile = data_store.load_stock_data(symbol, "profile")
        if not isinstance(profile, dict):
            continue
        industry = str(profile.get("industry") or "").strip()
        if industry in _INVALID_INDUSTRY_NAMES:
            continue
        counts[industry] = counts.get(industry, 0) + 1
    _industry_cache.update({"built_at": now, "counts": counts})
    return counts


def _industry_keyword(label: str) -> str:
    keyword = label.strip().lstrip("@").strip()
    for suffix in _INDUSTRY_SUFFIXES:
        if keyword.endswith(suffix) and len(keyword) > len(suffix):
            keyword = keyword[:-len(suffix)].strip()
            break
    return keyword


def _match_industry(row_industry: str, label: str) -> bool:
    industry = row_industry.strip()
    keyword = _industry_keyword(label)
    if industry in _INVALID_INDUSTRY_NAMES or not keyword:
        return False
    candidates = (keyword, *_INDUSTRY_KEYWORD_ALIASES.get(keyword, ()))
    return any(industry == item or item in industry or industry in item for item in candidates)


def _is_industry_field_name(name: str) -> bool:
    clean = name.strip()
    if not clean:
        return False
    if any(clean.endswith(suffix) and len(clean) > len(suffix) for suffix in _INDUSTRY_SUFFIXES):
        return True
    keyword = _industry_keyword(clean)
    return keyword in _industry_counts() or keyword in _INDUSTRY_KEYWORD_ALIASES


def formula_field_catalog() -> list[dict[str, Any]]:
    fields = [
        {
            "key": field.key,
            "label": field.label,
            "category": field.category,
            "description": field.description,
            "aliases": list(field.aliases),
            "unit": field.unit,
        }
        for field in FORMULA_FIELDS
    ]
    counts = _industry_counts()
    for industry, count in sorted(counts.items(), key=lambda item: (-item[1], item[0])):
        fields.append({
            "key": f"industry.{industry}",
            "label": f"{industry}行业",
            "category": "行业分类",
            "description": f"所属行业为 {industry}，本地 {count} 只股票",
            "aliases": [industry, f"{industry}板块", f"{industry}概念"],
            "unit": "",
        })
    for keyword, aliases in _INDUSTRY_KEYWORD_ALIASES.items():
        if keyword in counts:
            continue
        matched_count = sum(count for industry, count in counts.items() if _match_industry(industry, keyword))
        fields.append({
            "key": f"industry.{keyword}",
            "label": f"{keyword}行业",
            "category": "行业分类",
            "description": f"常用分类：匹配 {'、'.join(aliases)} 等本地行业，本地约 {matched_count} 只股票",
            "aliases": [keyword, f"{keyword}板块", f"{keyword}概念"],
            "unit": "",
        })
    return fields


def _to_float(value: Any, default: float | None = None) -> float | None:
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    try:
        if value is None or value == "":
            return default
        if isinstance(value, str) and value.strip().lower() in {"nan", "none", "null"}:
            return default
        number = float(value)
        if math.isnan(number) or math.isinf(number):
            return default
        return number
    except (TypeError, ValueError):
        return default


def _truthy(value: Any) -> bool:
    if isinstance(value, list):
        return bool(value) and all(_truthy(item) for item in value)
    if isinstance(value, bool):
        return value
    number = _to_float(value, None)
    if number is not None:
        return number != 0
    return bool(value)


def _is_missing(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, list):
        return len(value) == 0 or all(_is_missing(item) for item in value)
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return math.isnan(float(value)) if isinstance(value, float) else False
    return value == ""


class FormulaContext:
    def __init__(self, row: ScreenedStock):
        self.row = row
        self._profile: dict | None = None
        self._periods: list[dict] | None = None
        self._kline: list[dict] | None = None
        self.used_fields: dict[str, Any] = {}

    @property
    def symbol(self) -> str:
        return self.row.symbol

    def profile(self) -> dict:
        if self._profile is None:
            data = data_store.load_stock_data(self.symbol, "profile")
            self._profile = data if isinstance(data, dict) else {}
        return self._profile

    def periods(self) -> list[dict]:
        if self._periods is None:
            data = data_store.load_stock_data(self.symbol, "financial_periods")
            items = data if isinstance(data, list) else []
            self._periods = sorted(
                [item for item in items if isinstance(item, dict)],
                key=lambda item: str(item.get("reportDate") or ""),
                reverse=True,
            )
        return self._periods

    def kline(self) -> list[dict]:
        if self._kline is None:
            data = data_store.load_stock_data(self.symbol, "kline_day")
            self._kline = data if isinstance(data, list) else []
        return self._kline

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

        if _is_industry_field_name(name):
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
            periods = self._fy_periods() if scope in {"年度", "年报"} else self.periods()
            return self._metric_from_period(periods[0] if periods else None, metric_label)

        year = _YEAR_RE.match(name)
        if year:
            year_value, metric_label = year.groups()
            return self._period_metric(f"{year_value}FY", metric_label)

        raise FormulaError(f"未知字段：@{name}")

    def _resolve_known_field(self, key: str) -> Any:
        if hasattr(self.row, key):
            return getattr(self.row, key)
        if key.startswith("latest."):
            return self._metric_from_period(self._latest_fy(), key.split(".", 1)[1])
        if key in {"currentPrice", "changePercent", "pe", "pb", "marketCap", "freeFloatMarketCap", "turnoverRate", "volumeRatio"}:
            return self.profile().get(key, getattr(self.row, key, None))
        if key in {"close", "ma5", "ma10", "ma20", "ma60"}:
            kline = self.kline()
            if not kline:
                return None
            return _to_float(kline[-1].get("close" if key == "close" else key), None)
        if key == "change20d":
            return self._kline_change(20)
        if key == "change60d":
            return self._kline_change(60)
        if key == "recentStrength":
            return self._kline_change(60)
        if key == "hasProfileData":
            return data_store.has_stock_data(self.symbol, "profile")
        if key == "hasFinancialData":
            return data_store.has_stock_data(self.symbol, "financial_periods") or data_store.has_stock_data(self.symbol, "financials")
        if key == "hasKlineData":
            return data_store.has_stock_data(self.symbol, "kline_day")
        if key == "hasNews":
            return data_store.has_stock_data(self.symbol, "news")
        if key == "hasNotices":
            return data_store.has_stock_data(self.symbol, "notices")
        if key == "hasReports":
            return data_store.has_stock_data(self.symbol, "reports")
        return None

    def _fy_periods(self) -> list[dict]:
        return [item for item in self.periods() if item.get("reportQuarter") == "FY"]

    def _latest_fy(self) -> dict | None:
        periods = self._fy_periods()
        return periods[0] if periods else None

    def _metric_key(self, label_or_key: str) -> str | None:
        clean = label_or_key.strip()
        return _METRIC_LABELS.get(clean) or _METRIC_LABELS.get(clean.upper()) or (clean if re.match(r"^[A-Za-z][A-Za-z0-9_]*$", clean) else None)

    def _metric_from_period(self, period: dict | None, metric_label: str) -> Any:
        if not period:
            return None
        key = self._metric_key(metric_label)
        if not key:
            raise FormulaError(f"未知财务指标：{metric_label}")
        return _to_float(period.get(key), None)

    def _period_metric(self, period_label: str, metric_label: str) -> Any:
        period_label = period_label.upper()
        match = re.match(r"^(\d{4})(Q1|H1|Q3|FY)?$", period_label)
        if not match:
            raise FormulaError(f"未知报告期：{period_label}")
        year = int(match.group(1))
        quarter = match.group(2) or "FY"
        for period in self.periods():
            if int(period.get("reportYear") or 0) == year and str(period.get("reportQuarter") or "").upper() == quarter:
                return self._metric_from_period(period, metric_label)
        return None

    def _recent_metric_values(self, count: int, scope: str, metric_label: str) -> list[float]:
        source = self._fy_periods() if scope == "年" else self.periods()
        values: list[float] = []
        for period in source[:max(0, count)]:
            value = self._metric_from_period(period, metric_label)
            if value is not None:
                values.append(value)
        return values

    def _kline_change(self, days: int) -> Any:
        kline = self.kline()
        if len(kline) <= days:
            return None
        start = _to_float(kline[-days - 1].get("close"), None)
        end = _to_float(kline[-1].get("close"), None)
        if not start or end is None:
            return None
        return (end - start) / start * 100


@dataclass
class Token:
    kind: str
    value: Any
    pos: int


def tokenize(formula: str) -> list[Token]:
    tokens: list[Token] = []
    i = 0
    while i < len(formula):
        char = formula[i]
        if char.isspace():
            i += 1
            continue
        if char == "@":
            start = i
            i += 1
            while i < len(formula):
                current = formula[i]
                if current.isspace() or current in ",()+-*/%<>=!":
                    break
                i += 1
            name = formula[start + 1:i].strip()
            if not name:
                raise FormulaError("@ 后面需要字段名")
            tokens.append(Token("FIELD", name, start))
            continue
        two = formula[i:i + 2]
        if two in {">=", "<=", "==", "!="}:
            tokens.append(Token("OP", two, i))
            i += 2
            continue
        if char in "><+-*/%(),":
            tokens.append(Token("OP", char, i))
            i += 1
            continue
        if char.isdigit() or char == ".":
            start = i
            i += 1
            while i < len(formula) and (formula[i].isdigit() or formula[i] == "."):
                i += 1
            try:
                tokens.append(Token("NUMBER", float(formula[start:i]), start))
            except ValueError as exc:
                raise FormulaError(f"数字格式错误：{formula[start:i]}") from exc
            continue
        if char.isalpha() or "\u4e00" <= char <= "\u9fff" or char == "_":
            start = i
            i += 1
            while i < len(formula) and (formula[i].isalnum() or formula[i] == "_" or "\u4e00" <= formula[i] <= "\u9fff"):
                i += 1
            word = formula[start:i]
            upper = word.upper()
            if upper in {"AND", "OR", "NOT"} or word in {"且", "或", "非"}:
                tokens.append(Token("LOGIC", {"且": "AND", "或": "OR", "非": "NOT"}.get(word, upper), start))
            elif upper in {"TRUE", "FALSE"} or word in {"真", "假"}:
                tokens.append(Token("BOOL", upper == "TRUE" or word == "真", start))
            else:
                tokens.append(Token("IDENT", word, start))
            continue
        raise FormulaError(f"无法识别字符：{char}")
    tokens.append(Token("EOF", None, len(formula)))
    return tokens


class Node:
    def eval(self, context: FormulaContext) -> Any:
        raise NotImplementedError


@dataclass
class NumberNode(Node):
    value: float
    def eval(self, context: FormulaContext) -> Any:
        return self.value


@dataclass
class BoolNode(Node):
    value: bool
    def eval(self, context: FormulaContext) -> Any:
        return self.value


@dataclass
class FieldNode(Node):
    name: str
    def eval(self, context: FormulaContext) -> Any:
        return context.resolve(self.name)


@dataclass
class UnaryNode(Node):
    op: str
    child: Node
    def eval(self, context: FormulaContext) -> Any:
        value = self.child.eval(context)
        if self.op == "NOT":
            return not _truthy(value)
        if self.op == "-":
            number = _to_float(value, None)
            return -number if number is not None else None
        return value


@dataclass
class BinaryNode(Node):
    op: str
    left: Node
    right: Node
    def eval(self, context: FormulaContext) -> Any:
        if self.op == "AND":
            return _truthy(self.left.eval(context)) and _truthy(self.right.eval(context))
        if self.op == "OR":
            return _truthy(self.left.eval(context)) or _truthy(self.right.eval(context))
        left = self.left.eval(context)
        right = self.right.eval(context)
        if self.op in {">", ">=", "<", "<=", "==", "!="}:
            return _compare(left, right, self.op)
        return _numeric_binary(left, right, self.op)


@dataclass
class FunctionNode(Node):
    name: str
    args: list[Node]
    def eval(self, context: FormulaContext) -> Any:
        name = self.name.upper()
        values = [arg.eval(context) for arg in self.args]
        flattened: list[Any] = []
        for value in values:
            if isinstance(value, list):
                flattened.extend(value)
            else:
                flattened.append(value)
        numbers = [number for number in (_to_float(value, None) for value in flattened) if number is not None]
        if name == "AVG":
            return sum(numbers) / len(numbers) if numbers else None
        if name == "SUM":
            return sum(numbers) if numbers else None
        if name == "MIN":
            return min(numbers) if numbers else None
        if name == "MAX":
            return max(numbers) if numbers else None
        if name == "COUNT":
            return len([value for value in flattened if not _is_missing(value)])
        if name == "EXISTS":
            return any(not _is_missing(value) for value in flattened)
        if name == "MISSING":
            return all(_is_missing(value) for value in flattened)
        if name == "CAGR":
            if len(numbers) < 2 or numbers[-1] <= 0:
                return None
            latest = numbers[0]
            earliest = numbers[-1]
            years = len(numbers) - 1
            if earliest <= 0 or years <= 0:
                return None
            return (math.pow(latest / earliest, 1 / years) - 1) * 100
        raise FormulaError(f"未知函数：{self.name}")


def _compare(left: Any, right: Any, op: str) -> bool:
    if isinstance(left, list):
        return bool(left) and all(_compare(item, right, op) for item in left)
    if isinstance(right, list):
        return bool(right) and all(_compare(left, item, op) for item in right)
    if op in {"==", "!="}:
        if isinstance(left, bool) or isinstance(right, bool):
            result = _truthy(left) == _truthy(right)
        else:
            left_num = _to_float(left, None)
            right_num = _to_float(right, None)
            result = left_num == right_num if left_num is not None and right_num is not None else left == right
        return result if op == "==" else not result
    left_num = _to_float(left, None)
    right_num = _to_float(right, None)
    if left_num is None or right_num is None:
        return False
    if op == ">":
        return left_num > right_num
    if op == ">=":
        return left_num >= right_num
    if op == "<":
        return left_num < right_num
    if op == "<=":
        return left_num <= right_num
    return False


def _numeric_binary(left: Any, right: Any, op: str) -> Any:
    left_num = _to_float(left, None)
    right_num = _to_float(right, None)
    if left_num is None or right_num is None:
        return None
    if op == "+":
        return left_num + right_num
    if op == "-":
        return left_num - right_num
    if op == "*":
        return left_num * right_num
    if op == "/":
        return left_num / right_num if right_num != 0 else None
    if op == "%":
        return left_num % right_num if right_num != 0 else None
    return None


class Parser:
    def __init__(self, tokens: list[Token]):
        self.tokens = tokens
        self.index = 0

    def current(self) -> Token:
        return self.tokens[self.index]

    def match(self, value: str | None = None, kind: str | None = None) -> Token | None:
        token = self.current()
        if kind and token.kind != kind:
            return None
        if value and token.value != value:
            return None
        self.index += 1
        return token

    def expect(self, value: str | None = None, kind: str | None = None) -> Token:
        token = self.match(value, kind)
        if not token:
            expected = value or kind or "token"
            raise FormulaError(f"公式语法错误：期望 {expected}，实际 {self.current().value}")
        return token

    def parse(self) -> Node:
        node = self.parse_or()
        if self.current().kind != "EOF":
            raise FormulaError(f"公式末尾有无法解析内容：{self.current().value}")
        return node

    def parse_or(self) -> Node:
        node = self.parse_and()
        while self.current().kind == "LOGIC" and self.current().value == "OR":
            self.index += 1
            node = BinaryNode("OR", node, self.parse_and())
        return node

    def parse_and(self) -> Node:
        node = self.parse_compare()
        while self.current().kind == "LOGIC" and self.current().value == "AND":
            self.index += 1
            node = BinaryNode("AND", node, self.parse_compare())
        return node

    def parse_compare(self) -> Node:
        node = self.parse_add()
        while self.current().kind == "OP" and self.current().value in {">", ">=", "<", "<=", "==", "!="}:
            op = self.current().value
            self.index += 1
            node = BinaryNode(op, node, self.parse_add())
        return node

    def parse_add(self) -> Node:
        node = self.parse_mul()
        while self.current().kind == "OP" and self.current().value in {"+", "-"}:
            op = self.current().value
            self.index += 1
            node = BinaryNode(op, node, self.parse_mul())
        return node

    def parse_mul(self) -> Node:
        node = self.parse_unary()
        while self.current().kind == "OP" and self.current().value in {"*", "/", "%"}:
            op = self.current().value
            self.index += 1
            node = BinaryNode(op, node, self.parse_unary())
        return node

    def parse_unary(self) -> Node:
        if self.current().kind == "LOGIC" and self.current().value == "NOT":
            self.index += 1
            return UnaryNode("NOT", self.parse_unary())
        if self.current().kind == "OP" and self.current().value == "-":
            self.index += 1
            return UnaryNode("-", self.parse_unary())
        return self.parse_primary()

    def parse_primary(self) -> Node:
        token = self.current()
        if token.kind == "NUMBER":
            self.index += 1
            return NumberNode(token.value)
        if token.kind == "BOOL":
            self.index += 1
            return BoolNode(token.value)
        if token.kind == "FIELD":
            self.index += 1
            return FieldNode(token.value)
        if token.kind == "IDENT":
            self.index += 1
            name = token.value
            self.expect("(", "OP")
            args: list[Node] = []
            if not self.match(")", "OP"):
                while True:
                    args.append(self.parse_or())
                    if self.match(")", "OP"):
                        break
                    self.expect(",", "OP")
            return FunctionNode(name, args)
        if self.match("(", "OP"):
            node = self.parse_or()
            self.expect(")", "OP")
            return node
        raise FormulaError(f"公式语法错误：无法解析 {token.value}")


@dataclass
class CompiledFormula:
    formula: str
    ast: Node

    def evaluate_value(self, row: ScreenedStock) -> tuple[Any, dict[str, Any]]:
        context = FormulaContext(row)
        try:
            result = self.ast.eval(context)
            return result, context.used_fields
        except FormulaError as exc:
            raise exc
        except Exception as exc:
            logger.exception("formula evaluation failed for %s", row.symbol)
            raise FormulaError(f"公式执行失败：{exc}") from exc

    def evaluate(self, row: ScreenedStock) -> tuple[bool, dict[str, Any], str]:
        result, values = self.evaluate_value(row)
        matched = _truthy(result)
        reason = "满足公式" if matched else "不满足公式"
        return matched, values, reason


def compile_formula(formula: str) -> CompiledFormula:
    if not formula or not formula.strip():
        raise FormulaError("公式不能为空")
    tokens = tokenize(formula)
    ast = Parser(tokens).parse()
    return CompiledFormula(formula=formula.strip(), ast=ast)


def validate_formula(formula: str) -> dict[str, Any]:
    try:
        compile_formula(formula)
        return {"ok": True, "message": "公式有效"}
    except FormulaError as exc:
        return {"ok": False, "message": str(exc)}

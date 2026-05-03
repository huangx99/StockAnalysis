"""
Column schemas for AKShare functions.

When AKShare renames columns after a version update:
1. Add old_name -> new_name to the relevant rename_map
2. Restart the server
No other code changes needed.
"""

SPOT_EM_COLUMNS = {
    "required": ["代码", "名称", "最新价", "涨跌幅"],
    "optional": [
        "涨跌额", "成交量", "成交额", "振幅", "最高", "最低",
        "今开", "昨收", "量比", "换手率", "市盈率-动态", "市净率",
        "总市值", "流通市值", "涨速", "5分钟涨跌", "60日涨跌幅", "年初至今涨跌幅",
    ],
    "rename_map": {},
    "defaults": {
        "涨跌额": 0.0,
        "成交量": 0,
        "成交额": 0.0,
        "振幅": 0.0,
        "换手率": 0.0,
        "市盈率-动态": 0.0,
        "市净率": 0.0,
        "总市值": 0.0,
        "流通市值": 0.0,
        "60日涨跌幅": 0.0,
        "年初至今涨跌幅": 0.0,
    },
}

HIST_COLUMNS = {
    "required": ["日期", "开盘", "收盘", "最高", "最低", "成交量"],
    "optional": ["股票代码", "成交额", "振幅", "涨跌幅", "涨跌额", "换手率"],
    "rename_map": {},
    "defaults": {
        "成交额": 0.0,
        "振幅": 0.0,
        "涨跌幅": 0.0,
        "涨跌额": 0.0,
        "换手率": 0.0,
    },
}

INDIVIDUAL_INFO_COLUMNS = {
    "required": ["item", "value"],
    "optional": [],
    "rename_map": {},
    "defaults": {},
}

NEWS_COLUMNS = {
    "required": ["新闻标题"],
    "optional": ["关键词", "新闻内容", "发布时间", "文章来源", "新闻链接"],
    "rename_map": {},
    "defaults": {
        "新闻内容": "",
        "发布时间": "",
        "文章来源": "",
        "新闻链接": "",
    },
}

# stock_financial_report_sina with symbol='利润表'
FINANCIAL_PROFIT_COLUMNS = {
    "required": ["报告日"],
    "optional": [
        "营业总收入", "营业成本", "营业总成本",
        "归属于母公司所有者的净利润", "净利润", "利润总额",
        "营业利润", "基本每股收益", "研发费用", "财务费用",
        "扣除非经常性损益后的净利润",
    ],
    "rename_map": {
        "营业收入": "营业总收入",
        "营业支出": "营业总成本",
        "归属于母公司的净利润": "归属于母公司所有者的净利润",
        "每股收益": "基本每股收益",
        "扣非净利润": "扣除非经常性损益后的净利润",
    },
    "defaults": {
        "营业成本": 0,
        "基本每股收益": 0,
        "研发费用": 0,
        "财务费用": 0,
    },
}

# stock_financial_report_sina with symbol='资产负债表'
FINANCIAL_BALANCE_COLUMNS = {
    "required": ["报告日"],
    "optional": [
        "资产总计", "负债合计",
        "归属于母公司股东权益合计", "所有者权益(或股东权益)合计",
    ],
    "rename_map": {
        "归属于母公司股东的权益": "归属于母公司股东权益合计",
    },
    "defaults": {},
}

# stock_financial_report_sina with symbol='现金流量表'
FINANCIAL_CASHFLOW_COLUMNS = {
    "required": ["报告日"],
    "optional": [
        "经营活动产生的现金流量净额",
        "投资活动产生的现金流量净额",
        "筹资活动产生的现金流量净额",
    ],
    "rename_map": {},
    "defaults": {},
}

# stock_fhps_em — 分红配送
DIVIDEND_COLUMNS = {
    "required": [],
    "optional": [
        "报告日", "除权除息日", "派息", "送股", "转增",
        "股权登记日", "进度",
    ],
    "rename_map": {
        "除息日": "除权除息日",
    },
    "defaults": {
        "派息": 0,
        "送股": 0,
        "转增": 0,
    },
}

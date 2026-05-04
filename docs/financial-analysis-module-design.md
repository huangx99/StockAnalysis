# 财务分析模块设计方案（审核稿）

日期：2026-05-04

## 1. 现状判断

当前财务分析模块的主要问题不是 UI 细节，而是数据模型和分析口径太薄：

- 后端 `FinancialStatement` 只保留年度少量字段，且只筛选 `1231` 年报，缺少季报、中报、TTM、同比/环比、公告日期、报告类型、审计意见等专业分析必需维度。
- 数据下载只合并利润表、资产负债表、现金流量表的少数字段，丢失大量原始科目，后续无法做结构化分析、杜邦拆解、现金流质量、营运效率、偿债风险等判断。
- 前端只展示“表格 + 4 个趋势图 + 分红”，没有财务摘要、质量评分、异常预警、行业对比、估值联动、财报事件流。
- 分红下载目前使用 `stock_fhps_em(symbol=symbol)`，但本地 AKShare 1.18.60 中该函数签名是 `stock_fhps_em(date='20231231')`，按个股应优先改用 `stock_fhps_detail_em(symbol)` 或 `stock_dividend_cninfo(symbol)`。

## 2. 目标定位

把“财务分析”从简单报表展示升级为“面向投资研究的财务体检模块”：

- 看得全：覆盖三大报表、关键指标、分红、估值、预测、公告与研报。
- 看得懂：自动计算增长、盈利、现金流、资产质量、偿债、营运效率、股东回报。
- 看得准：保留原始字段、统一单位、标记数据来源和更新时间，避免只存派生结果导致不可追溯。
- 能比较：支持同公司多期对比、同行/行业分位、当前估值与历史估值对比。
- 能预警：发现收入利润背离、利润现金流背离、资产减值、应收/存货异常、负债压力、分红不可持续等风险。

## 3. 建议下载的数据

### 3.1 必须下载（MVP）

| 数据类型 | 建议来源/API | 频率 | 用途 | 关键字段 |
| --- | --- | --- | --- | --- |
| 利润表原始数据 | `stock_profit_sheet_by_report_em(SH/SZ/BJ+code)`，备选 `stock_financial_report_sina` | 季度/年度 | 收入、利润、费用、EPS、扣非 | `REPORT_DATE`, `REPORT_TYPE`, `NOTICE_DATE`, `TOTAL_OPERATE_INCOME`, `OPERATE_INCOME`, `OPERATE_COST`, `SALE_EXPENSE`, `MANAGE_EXPENSE`, `RESEARCH_EXPENSE`, `FINANCE_EXPENSE`, `OPERATE_PROFIT`, `TOTAL_PROFIT`, `NETPROFIT`, `PARENT_NETPROFIT`, `DEDUCT_PARENT_NETPROFIT`, `BASIC_EPS` |
| 资产负债表原始数据 | `stock_balance_sheet_by_report_em(SH/SZ/BJ+code)`，备选 `stock_financial_report_sina` | 季度/年度 | 资产结构、负债、权益、营运资本 | `TOTAL_ASSETS`, `TOTAL_LIABILITIES`, `TOTAL_EQUITY`, `TOTAL_PARENT_EQUITY`, `MONETARYFUNDS`, `ACCOUNTS_RECE`, `NOTE_ACCOUNTS_RECE`, `INVENTORY`, `CONTRACT_LIAB`, `FIXED_ASSET`, `INTANGIBLE_ASSET`, `GOODWILL`, `SHORT_LOAN`, `LONG_LOAN`, `BOND_PAYABLE` |
| 现金流量表原始数据 | `stock_cash_flow_sheet_by_report_em(SH/SZ/BJ+code)`，备选 `stock_financial_report_sina` | 季度/年度 | 经营现金流、资本开支、自由现金流、融资动作 | `NETCASH_OPERATE`, `NETCASH_INVEST`, `NETCASH_FINANCE`, `CONSTRUCT_LONG_ASSET`, `ASSIGN_DIVIDEND_PORFIT`, `CCE_ADD`, `END_CCE` |
| 财务指标快照 | `stock_financial_analysis_indicator(code, start_year)` / `stock_financial_abstract(code)` | 季度/年度 | 补充 ROE、毛利率、周转率、流动比率等已计算指标 | 净资产收益率、销售毛利率、销售净利率、资产负债率、流动比率、速动比率、存货周转率、应收账款周转率、总资产周转率、经营现金净流量与净利润比率 |
| 分红送转 | `stock_fhps_detail_em(code)`，备选 `stock_dividend_cninfo(code)` | 年度/事件 | 股东回报、股息率、分红率 | 报告期、现金分红比例、股息率、每股收益、股权登记日、除权除息日、方案进度、分红说明 |
| 行情与估值基础 | 已有 `stock_zh_a_spot_em` + 日 K | 日/分钟 | 市值、PE/PB、股息率、估值联动 | 总市值、流通市值、PE、PB、收盘价、成交额、换手率 |

### 3.2 强烈建议下载（专业版 P1）

| 数据类型 | 建议来源/API | 用途 |
| --- | --- | --- |
| 财报公告 PDF/HTML | 已有 `stock_zh_a_disclosure_report_cninfo` | 关联年报/季报原文，支持 AI 摘要、管理层讨论、审计意见、风险提示抽取 |
| 券商研报与盈利预测 | 已有 `stock_research_report_em`，可补 `stock_profit_forecast_em` / `stock_profit_forecast_ths` | 预测 EPS、预测 PE、评级变化、市场预期差 |
| 行业分类和行业指标 | 当前 `stock_individual_info_em` + 行业成分/行业行情 | 同行业分位，避免跨行业误判毛利率、杠杆和周转 |
| 历史估值序列 | 日 K + 每期 EPS/BPS 派生，或补充可用估值接口 | 当前估值 vs 历史分位，估值消化/戴维斯双击分析 |
| 十大股东/股本结构 | AKShare 股东类接口，后续按可用性接入 | 股本变动、回购、减持、股权集中度、每股指标还原 |

### 3.3 后续增强（P2）

| 数据类型 | 用途 |
| --- | --- |
| 业绩预告/快报 | 在正式报表前提前预警增长变化 |
| 资产减值、商誉、应收账款账龄 | 识别利润质量和爆雷风险 |
| 分产品/分地区收入 | 业务结构变化、第二增长曲线分析 |
| 关联交易、担保、诉讼 | 风险雷达 |
| 北向资金、机构持仓、基金持仓 | 和财务趋势结合判断资金偏好 |

## 4. 建议的数据模型

### 4.1 原始层（必须保留）

按股票和数据类型保存原始记录，不只保存聚合后的 `financials`：

- `financial_income_raw`：利润表原始字段。
- `financial_balance_raw`：资产负债表原始字段。
- `financial_cashflow_raw`：现金流量表原始字段。
- `financial_indicator_raw`：财务指标/摘要原始字段。
- `dividends_raw`：分红送转原始字段。
- `financial_source_meta`：来源、接口名、下载时间、AKShare 版本、字段映射版本。

### 4.2 标准层（面向接口/UI）

新增标准化模型，建议不要继续用只有 `year` 的 `FinancialStatement`：

```text
FinancialPeriod
- symbol
- reportDate: YYYY-MM-DD
- reportYear
- reportQuarter: Q1/H1/Q3/FY
- reportType: 一季报/中报/三季报/年报
- noticeDate
- currency
- isAnnual
- isTTMAvailable
- source
- updatedAt

FinancialMetrics
- income: 收入、成本、毛利、费用、利润、扣非、EPS
- balance: 资产、负债、权益、现金、应收、存货、合同负债、有息负债、商誉
- cashflow: CFO、CFI、CFF、CapEx、FCF、现金净增加
- ratios: 毛利率、净利率、ROE、ROA、资产负债率、流动比率、速动比率、周转率、现金含量、分红率
- growth: 营收同比、净利同比、扣非同比、CFO 同比、资产/权益同比
- quality: 经营现金流/净利润、扣非/净利润、费用率、应收+存货/收入、商誉/净资产
- valuation: PE/PB/PS/PCF、股息率、历史分位、行业分位
```

### 4.3 派生层（分析结果）

- `financial_summary`：最近一期摘要、年度摘要、TTM 摘要。
- `financial_scores`：成长、盈利、现金流、偿债、营运、股东回报、估值吸引力。
- `financial_alerts`：异常规则命中列表。
- `financial_peer_compare`：行业分位、同行均值/中位数。

## 5. 核心分析功能设计

### 5.1 页面信息架构

建议把财务 Tab 拆成 6 个二级页签：

1. 财务体检：总分、六维雷达、最近一期摘要、核心优缺点、风险提示。
2. 三大报表：利润表、资产负债表、现金流量表，可切换年度/单季/累计/TTM。
3. 指标趋势：成长能力、盈利能力、现金流质量、偿债能力、营运效率、股东回报。
4. 估值联动：PE/PB/PS/股息率、历史分位、EPS/净资产驱动、价格与业绩同图。
5. 同行对比：和同行/行业中位数比较毛利率、ROE、净利率、资产负债率、估值。
6. 财报事件：财报公告、分红方案、研报预测、AI 财报摘要。

### 5.2 首屏卡片

首屏不建议直接放大表格，应先给结论：

- 最新财报：`2026Q1 / 2025FY`、披露日期、是否已更新。
- 增长：营收同比、归母净利同比、扣非净利同比、TTM 营收/利润。
- 盈利：毛利率、净利率、ROE、ROA。
- 现金流：CFO、FCF、CFO/净利润。
- 偿债：资产负债率、有息负债率、现金短债比。
- 回报：近 3 年累计分红、分红率、股息率。
- 估值：PE/PB/PS/股息率、历史分位、同行分位。

### 5.3 专业指标体系

| 维度 | 指标 | 判断重点 |
| --- | --- | --- |
| 成长能力 | 营收 YoY、归母净利 YoY、扣非净利 YoY、CFO YoY、3 年 CAGR | 是真实成长还是一次性收益 |
| 盈利能力 | 毛利率、净利率、ROE、ROA、ROIC、费用率 | 护城河、价格权、费用控制 |
| 现金流质量 | CFO/净利润、FCF、CapEx/收入、收现比 | 利润是否能变成现金 |
| 资产质量 | 应收/收入、存货/收入、商誉/净资产、减值损失 | 是否有减值和回款压力 |
| 偿债能力 | 资产负债率、有息负债率、流动比率、速动比率、现金短债比 | 杠杆和短期流动性 |
| 营运效率 | 应收周转、存货周转、总资产周转 | 经营效率是否改善 |
| 股东回报 | EPS、BPS、DPS、分红率、股息率、回购 | 是否持续回报股东 |
| 估值 | PE、PB、PS、PCF、PEG、历史/行业分位 | 价格是否匹配基本面 |

### 5.4 异常预警规则

MVP 就可以先做规则引擎，不必一开始做复杂模型：

- 利润质量：净利润增长为正但 CFO 连续为负，或 `CFO/净利润 < 0.5`。
- 收入质量：营收增长明显高于经营现金流增长，且应收账款/收入上升。
- 盈利恶化：毛利率或净利率连续 3 期下降。
- 费用异常：销售/管理/研发/财务费用率单期大幅上升。
- 资产风险：商誉/净资产过高，资产减值损失大幅增加。
- 偿债风险：资产负债率上升、有息负债增长、现金短债比下降。
- 分红风险：高分红但 FCF 不足，或分红率长期超过可持续水平。
- 估值风险：利润下滑但 PE/PB 处于历史高分位。

## 6. 后端接口建议

保留现有 `/api/stock/{symbol}/financials` 兼容旧前端，但新增更专业接口：

| 接口 | 说明 |
| --- | --- |
| `GET /api/stock/{symbol}/financial/periods?period=quarter|annual&limit=20` | 标准化分期财务数据 |
| `GET /api/stock/{symbol}/financial/summary` | 最新财务摘要、TTM、评分、预警 |
| `GET /api/stock/{symbol}/financial/statements?type=income|balance|cashflow&period=annual|quarter` | 三大报表明细 |
| `GET /api/stock/{symbol}/financial/ratios?period=annual|quarter|ttm` | 指标趋势 |
| `GET /api/stock/{symbol}/financial/valuation` | 估值、历史分位、估值与业绩联动 |
| `GET /api/stock/{symbol}/financial/dividends` | 分红送转明细和统计 |
| `GET /api/stock/{symbol}/financial/alerts` | 异常预警列表 |
| `GET /api/stock/{symbol}/financial/peers` | 同行业对比 |

下载器数据类型建议扩展：

```text
financial_income
financial_balance
financial_cashflow
financial_indicators
financial_dividends
financial_forecasts
financial_notices
financial_peer_baseline
```

## 7. 前端组件建议

现有 `FinancialTable` 和 `FinancialTrendChart` 可以保留，但应重构为：

- `FinancialHealthOverview`：财务体检总览、评分、雷达图、风险标签。
- `FinancialPeriodSelector`：年度/季度/TTM 切换。
- `StatementTable`：三大报表通用表格，支持同比、占收入比、展开科目。
- `RatioTrendPanel`：指标趋势，多指标对比。
- `CashflowQualityPanel`：净利润 vs CFO vs FCF、现金含量。
- `DuPontPanel`：ROE = 净利率 × 总资产周转率 × 权益乘数。
- `ValuationPanel`：PE/PB/PS/股息率和历史分位。
- `DividendPanel`：分红明细、分红率、股息率、连续分红年数。
- `FinancialAlertsPanel`：风险预警和解释。
- `PeerComparePanel`：行业对比条形图/分位图。

## 8. 实施优先级

### 阶段 1：补齐数据底座（优先）

- 改造 AKShare 适配层，新增东方财富三大报表接口，统一股票代码格式为 `SH600519` / `SZ000001` / `BJxxxxxx`。
- 保存三大报表原始数据，不再只保存聚合字段。
- 修正分红接口为 `stock_fhps_detail_em` 或 `stock_dividend_cninfo`。
- 新增标准化映射和单位处理，所有金额统一人民币元，前端再格式化为万/亿。
- 财务接口支持季度、年度、TTM。

### 阶段 2：专业指标和预警

- 计算同比、环比、TTM、3 年 CAGR。
- 计算成长、盈利、现金流、偿债、营运、回报六类指标。
- 增加财务质量评分和规则预警。
- 前端改造首屏为财务体检卡片。

### 阶段 3：估值和同行对比

- 将行情、EPS、BPS、CFO、分红联动，计算 PE/PB/PS/PCF/股息率。
- 增加历史分位和同行分位。
- 增加行业基准缓存，避免每次打开个股都抓全行业。

### 阶段 4：AI 财报解读

- 把财报公告、三大报表、指标变化、研报预测作为上下文。
- 输出“业绩变化原因、现金流质量、风险因素、下一期关注点”。
- AI 结论必须带数据依据，避免空泛评论。

## 9. MVP 验收标准

首版重做完成后，建议用以下标准验收：

- 任意 A 股可展示最近 12 个季度 + 最近 10 个年度财务数据。
- 三大报表关键科目可追溯到原始来源，并显示报告日期/披露日期。
- 支持年度、单季、累计、TTM 四种口径中的至少年度 + TTM。
- 至少展示 30 个专业指标，覆盖增长、盈利、现金流、偿债、营运、回报。
- 至少 8 条财务风险规则可运行，并能解释触发原因。
- 分红数据按个股正确下载，不再使用按日期全市场接口误当个股接口。
- 前端首屏能在 10 秒内回答：业绩是否增长、利润质量如何、估值是否贵、主要风险是什么。

## 10. 推荐先改的具体点

1. 后端模型：新增 `FinancialPeriod` / `FinancialMetrics`，保留旧 `FinancialStatement` 兼容。
2. 数据下载：从“年度聚合 financials”改为“原始三表 + 指标 + 分红”的多文件保存。
3. 数据源：三大报表优先换成东方财富 `*_by_report_em`，因为字段更完整且自带同比字段。
4. 口径：不要只看年报；至少接入季度报表和 TTM。
5. UI：先做财务体检首屏，再做明细表格。
6. AI：等结构化指标稳定后再接入，否则 AI 会基于不完整数据给出不专业结论。

## 11. 参考来源

- AKShare 官方股票数据文档：https://akshare.akfamily.xyz/data/stock/stock.html
- AKShare GitHub：https://github.com/akfamily/akshare
- 本地环境验证：AKShare `1.18.60`，已确认 `stock_profit_sheet_by_report_em`、`stock_balance_sheet_by_report_em`、`stock_cash_flow_sheet_by_report_em`、`stock_financial_analysis_indicator`、`stock_fhps_detail_em`、`stock_dividend_cninfo`、`stock_research_report_em` 可用。

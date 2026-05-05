import type { FinancialPeriodMetrics } from '@/types'

export type InsightLevel = '优秀' | '良好' | '一般' | '风险' | '数据不足'
export type InsightTrend = '改善' | '稳定' | '恶化' | '放缓' | '拐点' | '数据不足'
export type InsightModule = 'growth' | 'profitability' | 'cashflow' | 'safety' | 'efficiency' | 'expense'

export interface FinancialInsight {
  module: InsightModule
  title: string
  level: InsightLevel
  trend: InsightTrend
  tags: string[]
  summary: string
  decision: string
  impact: string
  evidence: string[]
  watchList: string[]
  formulas: string[]
  severity: 1 | 2 | 3
}

export interface FinancialScorePoint {
  period: string
  score: number
  rating: string
  growth: number
  profitability: number
  cashflow: number
  safety: number
  efficiency: number
}

export interface FinancialInsightResult {
  headline: string
  conclusion: string
  lifecycle: string
  riskLevel: '低' | '中' | '高'
  riskReasons: string[]
  investmentType: string
  crossFindings: string[]
  watchList: string[]
  keyFindings: string[]
  insights: Record<InsightModule, FinancialInsight>
  score: {
    total: number
    rating: string
    points: FinancialScorePoint[]
    reasons: string[]
    formulas: string[]
  }
}

function valid(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function pct(value: number | null | undefined): string {
  if (!valid(value)) return '—'
  return `${value.toFixed(1)}%`
}

function money(value: number | null | undefined): string {
  if (!valid(value) || value === 0) return '—'
  const abs = Math.abs(value)
  if (abs >= 100000000) return `${(value / 100000000).toFixed(1)}亿`
  if (abs >= 10000) return `${(value / 10000).toFixed(0)}万`
  return value.toFixed(0)
}

function periodLabel(row: FinancialPeriodMetrics): string {
  return `${row.reportYear}${row.reportQuarter}`
}

function latestRows(rows: FinancialPeriodMetrics[], count = 3) {
  return rows.slice(Math.max(0, rows.length - count))
}

function last<T>(items: T[]): T | null {
  return items.length ? items[items.length - 1] : null
}

function previous<T>(items: T[]): T | null {
  return items.length >= 2 ? items[items.length - 2] : null
}

function consecutiveDown(values: number[], count = 3): boolean {
  if (values.length < count) return false
  const sample = values.slice(-count)
  return sample.every((value, index) => index === 0 || value < sample[index - 1])
}

function consecutiveUp(values: number[], count = 3): boolean {
  if (values.length < count) return false
  const sample = values.slice(-count)
  return sample.every((value, index) => index === 0 || value > sample[index - 1])
}

function positiveToNegative(values: number[]): boolean {
  if (values.length < 2) return false
  const prev = values[values.length - 2]
  const current = values[values.length - 1]
  return prev > 0 && current < 0
}

function deltaText(label: string, current: number, prev: number | null, unit = '%') {
  if (!valid(prev)) return `${label} ${unit === '%' ? pct(current) : current.toFixed(2)}`
  const delta = current - prev
  const sign = delta >= 0 ? '+' : ''
  return `${label} ${unit === '%' ? pct(current) : current.toFixed(2)}，较上期${sign}${delta.toFixed(1)}${unit}`
}

function rating(score: number): string {
  if (score >= 85) return 'A（强）'
  if (score >= 75) return 'B（良好）'
  if (score >= 60) return 'C（一般）'
  if (score >= 40) return 'D（偏弱）'
  return 'E（风险）'
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)))
}

function scoreRow(row: FinancialPeriodMetrics, prev: FinancialPeriodMetrics | null): FinancialScorePoint {
  let growth = 0
  if (row.revenueYoY > 20) growth += 12
  else if (row.revenueYoY > 10) growth += 8
  else if (row.revenueYoY > 0) growth += 5
  if (row.netProfitYoY > 20) growth += 13
  else if (row.netProfitYoY > 10) growth += 9
  else if (row.netProfitYoY > 0) growth += 5

  let profitability = 0
  if (row.roe > 20) profitability += 15
  else if (row.roe > 10) profitability += 10
  else profitability += 5
  if (row.netMargin > 20) profitability += 10
  else if (row.netMargin > 10) profitability += 6
  else profitability += 3

  let cashflow = 0
  const cfoRatio = row.netProfit > 0 ? row.operatingCashFlow / row.netProfit : null
  if (cfoRatio != null && cfoRatio > 1) cashflow += 12
  else if (cfoRatio != null && cfoRatio > 0.7) cashflow += 8
  else if (row.netProfit <= 0 && row.operatingCashFlow > 0) cashflow += 7
  else cashflow += 3
  if (row.freeCashFlow > 0) cashflow += 8

  let safety = 0
  if (row.debtAssetRatio < 30) safety += 10
  else if (row.debtAssetRatio < 60) safety += 6
  else safety += 2
  if (row.currentRatio > 1.5) safety += 5

  let efficiency = 0
  if (prev && row.assetTurnover > prev.assetTurnover) efficiency += 8
  else efficiency += 4
  const currentExpenseRatio = row.revenue ? (row.salesExpense + row.manageExpense + row.financeExpense) / row.revenue : 0
  const prevExpenseRatio = prev?.revenue ? (prev.salesExpense + prev.manageExpense + prev.financeExpense) / prev.revenue : null
  if (prevExpenseRatio != null && currentExpenseRatio < prevExpenseRatio) efficiency += 7

  const total = clampScore(growth + profitability + cashflow + safety + efficiency)
  return {
    period: periodLabel(row),
    score: total,
    rating: rating(total),
    growth,
    profitability,
    cashflow,
    safety,
    efficiency,
  }
}

function scoreRows(rows: FinancialPeriodMetrics[]): FinancialScorePoint[] {
  return rows.map((row, index) => scoreRow(row, index > 0 ? rows[index - 1] : null))
}

function buildGrowthInsight(rows: FinancialPeriodMetrics[]): FinancialInsight {
  const current = last(rows)
  const prev = previous(rows)
  if (!current) return emptyInsight('growth', '增长趋势')
  const revenueYoys = rows.map((row) => row.revenueYoY).filter(valid)
  const profitYoys = rows.map((row) => row.netProfitYoY).filter(valid)
  const tags: string[] = []
  let level: InsightLevel = '一般'
  let trend: InsightTrend = '稳定'
  let severity: 1 | 2 | 3 = 2

  if (current.revenueYoY > 20 && current.netProfitYoY > 20) {
    level = '优秀'
    tags.push('高增长')
    severity = 1
  } else if (current.revenueYoY > 0 && current.netProfitYoY > 0) {
    level = '良好'
    tags.push('正增长')
    severity = 1
  } else if (current.revenueYoY > 0 && current.netProfitYoY < 0) {
    level = '风险'
    tags.push('增收不增利')
    severity = 3
  } else if (current.revenueYoY < 0 || current.netProfitYoY < 0) {
    level = '风险'
    tags.push('负增长')
    severity = 3
  }
  if (positiveToNegative(profitYoys)) {
    trend = '拐点'
    tags.push('利润拐点')
    severity = 3
  } else if (consecutiveDown(revenueYoys) && consecutiveDown(profitYoys)) {
    trend = '放缓'
    tags.push('增长放缓')
    severity = Math.max(severity, 2) as 1 | 2 | 3
  } else if (consecutiveUp(revenueYoys) || consecutiveUp(profitYoys)) {
    trend = '改善'
  }

  return {
    module: 'growth',
    title: '增长趋势',
    level,
    trend,
    tags,
    summary: current.revenueYoY > 0 && current.netProfitYoY < 0
      ? '收入仍在增长，但净利润已经下滑，增长质量转弱。'
      : `最新营收YoY为${pct(current.revenueYoY)}，净利润YoY为${pct(current.netProfitYoY)}，增长状态为${level}。`,
    decision: current.revenueYoY > 0 && current.netProfitYoY < 0
      ? '收入没有有效传导到利润，当前更像“增收不增利”，应优先验证利润拐点是否持续。'
      : trend === '拐点'
        ? '利润增速已经由正转负，增长逻辑出现拐点，短期需要谨慎看待成长性。'
        : trend === '放缓'
          ? '增长仍可能存在，但速度正在放慢，估值逻辑可能从高成长切换到稳增长。'
          : level === '优秀'
            ? '收入和利润同步高增长，成长逻辑仍较强。'
            : '增长状态暂未出现强烈异常，但仍需跟踪收入和利润是否同步。',
    impact: trend === '拐点' || tags.includes('增收不增利')
      ? '如果后续净利润YoY不能修复，市场可能更关注利润质量而不是营收规模。'
      : '增长稳定时更适合观察趋势延续性，而不是只看单期高低。',
    evidence: [
      `${periodLabel(current)}营收 ${money(current.revenue)}，YoY ${pct(current.revenueYoY)}`,
      `${periodLabel(current)}净利润 ${money(current.netProfit)}，YoY ${pct(current.netProfitYoY)}`,
      deltaText('净利润YoY', current.netProfitYoY, prev?.netProfitYoY ?? null),
    ],
    watchList: [
      '净利润YoY是否恢复或保持为正。',
      '营收增长是否能重新传导到净利润。',
      '最近3期YoY是否继续下行。',
    ],
    formulas: [
      '营收YoY = (本期营收 - 上年同期营收) / 上年同期营收 × 100%',
      '净利润YoY = (本期净利润 - 上年同期净利润) / 上年同期净利润 × 100%',
      '增长评级：营收YoY和净利润YoY均 >20% 为优秀；均 >0 为良好；出现负增长或增收不增利为风险。',
      '趋势判断：最近3期YoY连续下降为放缓；净利润YoY由正转负为拐点。',
    ],
    severity,
  }
}

function buildProfitabilityInsight(rows: FinancialPeriodMetrics[]): FinancialInsight {
  const current = last(rows)
  const prev = previous(rows)
  if (!current) return emptyInsight('profitability', '赚钱能力')
  const roes = rows.map((row) => row.roe).filter(valid)
  const margins = rows.map((row) => row.netMargin).filter(valid)
  const tags: string[] = []
  let level: InsightLevel = '一般'
  let trend: InsightTrend = '稳定'
  let severity: 1 | 2 | 3 = 2

  if (current.roe > 20 && current.netMargin > 15) {
    level = '优秀'
    tags.push('高盈利')
    severity = 1
  } else if (current.roe > 10 && current.netMargin > 8) {
    level = '良好'
    severity = 1
  } else if (current.roe < 8 || current.netMargin < 3) {
    level = '风险'
    tags.push('弱盈利')
    severity = 3
  }
  if (consecutiveDown(roes) || consecutiveDown(margins)) {
    trend = '恶化'
    tags.push('盈利下行')
    severity = Math.max(severity, 2) as 1 | 2 | 3
  } else if (consecutiveUp(roes) || consecutiveUp(margins)) {
    trend = '改善'
  }

  return {
    module: 'profitability',
    title: '赚钱能力',
    level,
    trend,
    tags,
    summary: `ROE为${pct(current.roe)}，净利率为${pct(current.netMargin)}，盈利能力处于${level}水平。`,
    decision: trend === '恶化'
      ? '盈利能力正在下行，说明公司赚钱效率变弱，需要关注ROE和净利率是否止跌。'
      : level === '优秀'
        ? '盈利能力较强，公司仍具备较好的赚钱效率。'
        : level === '风险'
          ? '盈利能力偏弱，单看收入规模不足以支撑乐观判断。'
          : '盈利水平尚可，关键在于后续ROE能否保持稳定。',
    impact: trend === '恶化'
      ? 'ROE持续下行可能压制估值中枢，也会削弱长期复利能力。'
      : '盈利稳定时，公司更容易维持经营质量和估值韧性。',
    evidence: [
      deltaText('ROE', current.roe, prev?.roe ?? null),
      deltaText('净利率', current.netMargin, prev?.netMargin ?? null),
      `${periodLabel(current)}毛利率 ${pct(current.grossMargin)}，ROA ${pct(current.roa)}`,
    ],
    watchList: [
      'ROE是否连续止跌或重新上行。',
      '净利率是否继续低于历史水平。',
      '毛利率变化是否提前反映盈利压力。',
    ],
    formulas: [
      'ROE = 归母净利润 / 归母权益 × 100%',
      '净利率 = 归母净利润 / 营业收入 × 100%',
      '盈利评级：ROE>20%且净利率>15%为优秀；ROE>10%且净利率>8%为良好；ROE<8%或净利率<3%为风险。',
      '趋势判断：ROE或净利率最近3期连续下降为恶化，连续上升为改善。',
    ],
    severity,
  }
}

function buildCashflowInsight(rows: FinancialPeriodMetrics[]): FinancialInsight {
  const current = last(rows)
  const prev = previous(rows)
  if (!current) return emptyInsight('cashflow', '现金流质量')
  const ratio = current.netProfit > 0 ? current.operatingCashFlow / current.netProfit : null
  const fcfs = rows.map((row) => row.freeCashFlow).filter(valid)
  const tags: string[] = []
  let level: InsightLevel = '一般'
  let trend: InsightTrend = '稳定'
  let severity: 1 | 2 | 3 = 2

  if (ratio != null && ratio > 1 && current.freeCashFlow > 0) {
    level = '优秀'
    tags.push('利润含金量高')
    severity = 1
  } else if ((ratio != null && ratio >= 0.7) || (current.netProfit <= 0 && current.operatingCashFlow > 0)) {
    level = '良好'
    severity = 1
  } else {
    level = '风险'
    tags.push('利润含金量低')
    severity = 3
  }
  if (current.freeCashFlow < 0) tags.push('FCF为负')
  if (consecutiveDown(fcfs, 2)) {
    trend = '恶化'
    severity = Math.max(severity, 2) as 1 | 2 | 3
  } else if (consecutiveUp(fcfs, 2)) {
    trend = '改善'
  }

  return {
    module: 'cashflow',
    title: '现金流质量',
    level,
    trend,
    tags,
    summary: ratio == null
      ? `净利润为${money(current.netProfit)}，CFO为${money(current.operatingCashFlow)}，亏损或低利润阶段改用现金流正负判断。`
      : `CFO/净利润为${ratio.toFixed(2)}，自由现金流为${money(current.freeCashFlow)}，现金质量为${level}。`,
    decision: ratio == null
      ? '净利润为负或过低时，CFO/净利润会失真，因此优先看经营现金流和自由现金流是否为正。'
      : level === '优秀'
        ? '利润有较强现金支撑，现金流质量较好。'
        : level === '良好'
          ? '利润仍有现金支撑，但强度未达到优秀，需要观察现金含量是否继续改善。'
          : '利润现金支撑不足，存在利润含金量偏低的风险。',
    impact: trend === '恶化'
      ? '现金流趋势继续走弱时，可能从利润质量问题演变为经营压力。'
      : '现金流保持正向时，盈利波动对公司安全边际的冲击相对可控。',
    evidence: [
      `${periodLabel(current)}经营现金流 ${money(current.operatingCashFlow)}，净利润 ${money(current.netProfit)}`,
      ratio == null ? '净利润小于等于0，未直接使用CFO/净利润比值评分' : `CFO/净利润 = ${ratio.toFixed(2)}`,
      deltaText('自由现金流', current.freeCashFlow / 100000000, prev ? prev.freeCashFlow / 100000000 : null, '亿'),
    ],
    watchList: [
      'CFO/净利润是否回到1以上。',
      '自由现金流是否持续为正。',
      '经营现金流是否连续低于净利润。',
    ],
    formulas: [
      'CFO/净利润 = 经营现金流 / 归母净利润；净利润<=0时不直接使用该比值，改看CFO和FCF是否为正。',
      '自由现金流FCF = 经营现金流 - 资本开支。',
      '现金流评级：CFO/净利润>1且FCF>0为优秀；CFO/净利润>=0.7为良好；低于0.7或FCF为负偏风险。',
      '趋势判断：FCF连续2期下降为恶化，连续2期上升为改善。',
    ],
    severity,
  }
}

function buildSafetyInsight(rows: FinancialPeriodMetrics[]): FinancialInsight {
  const current = last(rows)
  const prev = previous(rows)
  if (!current) return emptyInsight('safety', '资产安全')
  const debtRatios = rows.map((row) => row.debtAssetRatio).filter(valid)
  const tags: string[] = []
  let level: InsightLevel = '一般'
  let trend: InsightTrend = '稳定'
  let severity: 1 | 2 | 3 = 2

  if (current.debtAssetRatio < 30 && current.currentRatio > 1.5) {
    level = '优秀'
    tags.push('低杠杆')
    severity = 1
  } else if (current.debtAssetRatio < 60) {
    level = '良好'
    severity = 1
  } else {
    level = '风险'
    tags.push('高负债')
    severity = 3
  }
  if (consecutiveUp(debtRatios) && current.debtAssetRatio > 60) {
    trend = '恶化'
    tags.push('杠杆上升')
    severity = 3
  } else if (consecutiveDown(debtRatios)) {
    trend = '改善'
  }
  if (current.goodwill > current.equity * 0.2 && current.equity > 0) tags.push('商誉占比高')

  return {
    module: 'safety',
    title: '资产安全',
    level,
    trend,
    tags,
    summary: `资产负债率为${pct(current.debtAssetRatio)}，流动比率为${current.currentRatio?.toFixed(2) || '—'}，资产安全性为${level}。`,
    decision: level === '风险'
      ? '杠杆水平偏高，资产安全边际不足，需要关注偿债和再融资压力。'
      : trend === '恶化'
        ? '负债率正在上升，虽然未必立即危险，但安全边际在变薄。'
        : level === '优秀'
          ? '负债和流动性结构较稳，资产端暂未构成主要矛盾。'
          : '资产结构整体可控，但仍需观察负债率和应收存货变化。',
    impact: level === '风险'
      ? '高杠杆会放大盈利下滑和现金流波动的影响。'
      : '资产安全性较好时，公司更有空间消化短期经营波动。',
    evidence: [
      deltaText('资产负债率', current.debtAssetRatio, prev?.debtAssetRatio ?? null),
      `流动比率 ${current.currentRatio?.toFixed(2) || '—'}，速动比率 ${current.quickRatio?.toFixed(2) || '—'}`,
      `货币资金 ${money(current.cash)}，应收 ${money(current.accountsReceivable)}，存货 ${money(current.inventory)}，商誉 ${money(current.goodwill)}`,
    ],
    watchList: [
      '资产负债率是否继续上升。',
      '应收账款和存货是否异常扩张。',
      '商誉占权益比例是否继续提高。',
    ],
    formulas: [
      '资产负债率 = 总负债 / 总资产 × 100%',
      '流动比率 = 流动资产 / 流动负债；速动比率 = 速动资产 / 流动负债。',
      '安全评级：负债率<30%且流动比率>1.5为优秀；负债率<60%为良好；负债率>=60%为风险。',
      '趋势判断：负债率连续3期上升且高于60%为恶化，连续下降为改善。',
    ],
    severity,
  }
}

function buildEfficiencyInsight(rows: FinancialPeriodMetrics[]): FinancialInsight {
  const current = last(rows)
  const prev = previous(rows)
  if (!current) return emptyInsight('efficiency', '运营效率')
  const turnovers = rows.map((row) => row.assetTurnover).filter(valid)
  const tags: string[] = []
  let level: InsightLevel = '一般'
  let trend: InsightTrend = '稳定'
  let severity: 1 | 2 | 3 = 2

  if (prev && current.assetTurnover > prev.assetTurnover && current.receivableTurnover >= prev.receivableTurnover) {
    level = '良好'
    trend = '改善'
    tags.push('效率提升')
    severity = 1
  } else if (prev && current.assetTurnover < prev.assetTurnover) {
    level = '一般'
    trend = '恶化'
    tags.push('效率下降')
    severity = 2
  }
  if (consecutiveDown(turnovers)) {
    trend = '恶化'
    severity = 3
  }

  return {
    module: 'efficiency',
    title: '运营效率',
    level,
    trend,
    tags,
    summary: `资产周转率为${current.assetTurnover?.toFixed(2) || '—'}，应收周转率为${current.receivableTurnover?.toFixed(2) || '—'}，运营效率${trend}。`,
    decision: trend === '改善'
      ? '资产和应收周转改善，说明经营效率有所提升。'
      : trend === '恶化'
        ? '运营效率走弱，可能意味着资产占用增加或收入释放变慢。'
        : '运营效率整体平稳，暂未成为主要矛盾。',
    impact: trend === '恶化'
      ? '周转效率下降会拖累ROE，也可能加大现金流压力。'
      : '效率稳定有助于维持盈利质量，但仍要结合收入和现金流一起看。',
    evidence: [
      deltaText('资产周转率', current.assetTurnover, prev?.assetTurnover ?? null, ''),
      deltaText('应收周转率', current.receivableTurnover, prev?.receivableTurnover ?? null, ''),
      deltaText('存货周转率', current.inventoryTurnover, prev?.inventoryTurnover ?? null, ''),
    ],
    watchList: [
      '资产周转率是否连续下降。',
      '应收周转率是否显著低于历史水平。',
      '存货周转率下降是否伴随库存压力。',
    ],
    formulas: [
      '资产周转率 = 营业收入 / 平均总资产。',
      '应收周转率 = 营业收入 / 平均应收账款；存货周转率 = 营业成本 / 平均存货。',
      '效率评级：资产周转率和应收周转率较上期同步提升为良好；资产周转率下降为一般或恶化。',
      '趋势判断：资产周转率最近3期连续下降为恶化。',
    ],
    severity,
  }
}

function expenseRatio(row: FinancialPeriodMetrics, key: 'salesExpense' | 'manageExpense' | 'rdExpense' | 'financeExpense') {
  return row.revenue ? (row[key] / row.revenue) * 100 : 0
}

function buildExpenseInsight(rows: FinancialPeriodMetrics[]): FinancialInsight {
  const current = last(rows)
  const prev = previous(rows)
  if (!current) return emptyInsight('expense', '费用控制')
  const currentCore = expenseRatio(current, 'salesExpense') + expenseRatio(current, 'manageExpense') + expenseRatio(current, 'financeExpense')
  const prevCore = prev ? expenseRatio(prev, 'salesExpense') + expenseRatio(prev, 'manageExpense') + expenseRatio(prev, 'financeExpense') : null
  const rdRatio = expenseRatio(current, 'rdExpense')
  const tags: string[] = []
  let level: InsightLevel = '一般'
  let trend: InsightTrend = '稳定'
  let severity: 1 | 2 | 3 = 2

  if (prevCore != null && currentCore < prevCore) {
    level = '良好'
    trend = '改善'
    tags.push('费用率下降')
    severity = 1
  } else if (prevCore != null && currentCore > prevCore + 3) {
    level = '风险'
    trend = '恶化'
    tags.push('费用扩张')
    severity = 3
  }
  if (prev && expenseRatio(current, 'rdExpense') > expenseRatio(prev, 'rdExpense')) tags.push('研发投入增加')

  return {
    module: 'expense',
    title: '费用控制',
    level,
    trend,
    tags,
    summary: `核心费用率为${pct(currentCore)}，研发费用率为${pct(rdRatio)}，费用控制${trend}。`,
    decision: trend === '改善'
      ? '核心费用率下降，费用控制对利润形成正向支撑。'
      : level === '风险'
        ? '核心费用率扩张较快，可能侵蚀利润，需要区分短期投入还是经营压力。'
        : '费用控制整体稳定，研发投入变化需要结合业务阶段判断。',
    impact: level === '风险'
      ? '费用率持续上升会削弱净利率，并可能导致增收不增利。'
      : '费用率稳定有助于利润率保持韧性。',
    evidence: [
      `销售费用率 ${pct(expenseRatio(current, 'salesExpense'))}，管理费用率 ${pct(expenseRatio(current, 'manageExpense'))}`,
      `研发费用率 ${pct(rdRatio)}，财务费用率 ${pct(expenseRatio(current, 'financeExpense'))}`,
      prevCore == null ? '暂无上期费用率对比' : `核心费用率较上期${currentCore - prevCore >= 0 ? '+' : ''}${(currentCore - prevCore).toFixed(1)}pct`,
    ],
    watchList: [
      '销售和管理费用率是否继续上升。',
      '研发费用率上升是否带来收入或毛利改善。',
      '财务费用率是否反映债务压力。',
    ],
    formulas: [
      '单项费用率 = 单项费用 / 营业收入 × 100%。',
      '核心费用率 = 销售费用率 + 管理费用率 + 财务费用率；研发费用率单独展示，因投入增加可能是正面信号。',
      '费用评级：核心费用率下降为改善；较上期上升超过3pct为风险。',
    ],
    severity,
  }
}

function emptyInsight(module: InsightModule, title: string): FinancialInsight {
  return {
    module,
    title,
    level: '数据不足',
    trend: '数据不足',
    tags: ['数据不足'],
    summary: '当前数据不足，暂无法形成稳定判断。',
    decision: '数据不足时不输出投资判断，避免误导。',
    impact: '建议先补齐财务数据后再观察趋势。',
    evidence: ['至少需要1期财务指标，趋势判断建议3期以上。'],
    watchList: ['补齐年度或季度财务指标。'],
    formulas: ['规则引擎只使用本地已下载财务指标，不使用AI编造缺失数据。'],
    severity: 2,
  }
}

function lifecycle(insights: Record<InsightModule, FinancialInsight>) {
  if (insights.growth.tags.includes('高增长') && insights.profitability.level !== '风险') return '高速增长期'
  if (insights.growth.trend === '放缓' && insights.cashflow.level !== '风险') return '成熟期'
  if (insights.growth.level === '风险' || insights.profitability.trend === '恶化') return '承压期'
  if (insights.cashflow.trend === '改善' && insights.growth.trend === '改善') return '修复期'
  return '稳定观察期'
}

function investmentType(insights: Record<InsightModule, FinancialInsight>, stage: string) {
  if (insights.growth.tags.includes('高增长') && insights.profitability.level !== '风险') return '高速成长型'
  if (insights.cashflow.level === '优秀' && insights.growth.trend !== '改善') return '现金牛型'
  if (stage === '成熟期' && insights.safety.level !== '风险') return '成熟白马型'
  if (stage === '承压期' && insights.safety.level === '风险') return '高风险承压型'
  if (stage === '承压期') return '周期/经营承压型'
  if (stage === '修复期') return '基本面修复型'
  return '均衡观察型'
}

function riskReasons(insights: Record<InsightModule, FinancialInsight>) {
  const reasons: string[] = []
  if (insights.growth.tags.includes('利润拐点')) reasons.push('净利润增速出现拐点')
  if (insights.growth.tags.includes('增收不增利')) reasons.push('收入增长未传导到利润')
  if (insights.profitability.trend === '恶化') reasons.push('ROE或净利率连续走弱')
  if (insights.cashflow.level === '风险') reasons.push('利润现金支撑不足')
  if (insights.cashflow.trend === '恶化') reasons.push('自由现金流趋势恶化')
  if (insights.safety.level === '风险') reasons.push('资产负债率偏高')
  if (insights.efficiency.trend === '恶化') reasons.push('运营效率下降')
  if (insights.expense.level === '风险') reasons.push('核心费用率扩张较快')
  return reasons
}

function riskLevelFrom(reasons: string[], insights: Record<InsightModule, FinancialInsight>): '低' | '中' | '高' {
  const severeCount = Object.values(insights).filter((item) => item.severity === 3).length
  if (severeCount >= 2 || reasons.length >= 4) return '高'
  if (severeCount === 1 || reasons.length >= 2) return '中'
  return '低'
}

function buildCrossFindings(insights: Record<InsightModule, FinancialInsight>) {
  const findings: string[] = []
  if ((insights.growth.trend === '拐点' || insights.growth.trend === '放缓') && insights.cashflow.level !== '风险') {
    findings.push('增长和盈利正在承压，但现金流尚未同步失控，当前更像盈利压力而不是流动性危机。')
  }
  if (insights.growth.tags.includes('增收不增利') && insights.expense.level === '风险') {
    findings.push('增收不增利同时叠加费用率扩张，利润被费用侵蚀的可能性较高。')
  }
  if (insights.profitability.trend === '恶化' && insights.efficiency.trend === '恶化') {
    findings.push('盈利能力和运营效率同步走弱，ROE下行可能不只是利润率问题，也可能来自资产周转变慢。')
  }
  if (insights.cashflow.level === '优秀' && insights.safety.level !== '风险') {
    findings.push('现金流和资产安全性形成支撑，公司短期抗风险能力较好。')
  }
  if (insights.cashflow.level === '风险' && insights.safety.level === '风险') {
    findings.push('现金流和资产安全同时偏弱，需要优先排查偿债压力和经营现金回款。')
  }
  if (findings.length === 0) findings.push('各模块暂未形成强烈共振信号，建议继续观察趋势变化。')
  return findings
}

function buildWatchList(insights: Record<InsightModule, FinancialInsight>) {
  const items: string[] = []
  if (insights.growth.trend === '拐点' || insights.growth.trend === '放缓') items.push('利润YoY能否恢复，收入增长是否继续放缓。')
  if (insights.profitability.trend === '恶化') items.push('ROE和净利率是否止跌。')
  if (insights.cashflow.level !== '优秀' || insights.cashflow.trend === '恶化') items.push('CFO/净利润是否回到1以上，自由现金流是否保持为正。')
  if (insights.safety.level === '风险' || insights.safety.trend === '恶化') items.push('资产负债率、应收账款、存货是否继续抬升。')
  if (insights.expense.level === '风险') items.push('销售/管理/财务费用率是否继续侵蚀利润。')
  if (items.length < 3) {
    Object.values(insights).forEach((insight) => {
      insight.watchList.forEach((item) => {
        if (items.length < 5 && !items.includes(item)) items.push(item)
      })
    })
  }
  return items.slice(0, 5)
}

function headline(insights: Record<InsightModule, FinancialInsight>, score: FinancialScorePoint | null, stage: string, risk: '低' | '中' | '高') {
  return `核心判断：公司处于${stage}，增长${insights.growth.trend}，盈利${insights.profitability.trend}，现金流${insights.cashflow.level}，风险等级${risk}，综合评分${score ? `${score.score}（${score.rating}）` : '—'}。`
}

function conclusionText(stage: string, risk: '低' | '中' | '高', type: string, crossFindings: string[]) {
  const riskText = risk === '高' ? '需要谨慎，优先排查财务压力。' : risk === '中' ? '短期有压力，但仍需结合后续披露确认。' : '暂未出现明显财务红灯。'
  return `总体：当前更接近“${type}”，处于${stage}。${riskText}${crossFindings[0] ? ` ${crossFindings[0]}` : ''}`
}

export function analyzeFinancialInsights(rows: FinancialPeriodMetrics[]): FinancialInsightResult {
  const sorted = [...rows].sort((a, b) => a.reportDate.localeCompare(b.reportDate))
  const recent = latestRows(sorted, 8)
  const scorePoints = scoreRows(sorted)
  const currentScore = last(scorePoints)
  const insights: Record<InsightModule, FinancialInsight> = {
    growth: buildGrowthInsight(recent),
    profitability: buildProfitabilityInsight(recent),
    cashflow: buildCashflowInsight(recent),
    safety: buildSafetyInsight(recent),
    efficiency: buildEfficiencyInsight(recent),
    expense: buildExpenseInsight(recent),
  }
  const stage = lifecycle(insights)
  const reasons = riskReasons(insights)
  const risk = riskLevelFrom(reasons, insights)
  const type = investmentType(insights, stage)
  const crossFindings = buildCrossFindings(insights)
  const watchList = buildWatchList(insights)
  const keyFindings = [
    insights.growth.decision,
    insights.profitability.decision,
    insights.cashflow.decision,
    insights.safety.decision,
  ]
  return {
    headline: headline(insights, currentScore, stage, risk),
    conclusion: conclusionText(stage, risk, type, crossFindings),
    lifecycle: stage,
    riskLevel: risk,
    riskReasons: reasons.length ? reasons : ['核心财务信号未触发明显风险规则'],
    investmentType: type,
    crossFindings,
    watchList,
    keyFindings,
    insights,
    score: {
      total: currentScore?.score ?? 0,
      rating: currentScore?.rating ?? '—',
      points: scorePoints,
      reasons: Object.values(insights).map((item) => `${item.title}：${item.level} / ${item.trend}`),
      formulas: [
        '总分 = 成长25分 + 盈利25分 + 现金流20分 + 安全性15分 + 效率15分。',
        '成长 = 营收YoY最高12分 + 净利润YoY最高13分。',
        '盈利 = ROE最高15分 + 净利率最高10分。',
        '现金流 = CFO/净利润最高12分 + FCF为正8分；净利润<=0时改看CFO和FCF正负。',
        '安全性 = 资产负债率最高10分 + 流动比率>1.5加5分。',
        '效率 = 资产周转率提升最高8分 + 核心费用率下降最高7分。',
      ],
    },
  }
}

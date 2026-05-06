import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BarChart3, Brain, ChevronRight, Loader2, RefreshCw, Search, ShieldAlert, Trophy, Users, X } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { getDataStocks, getFinancialPeriods, getIndustryCompare, getIndustryList, getStockProfile, rebuildIndustrySnapshot, searchStocks } from '@/api/real/stockApi'
import type { FinancialScorePoint } from '@/components/stock/financialInsightEngine'
import { analyzeFinancialInsights, type FinancialInsightResult } from '@/components/stock/financialInsightEngine'
import stockCycleTagsRaw from '@/data/stockCycleTags.json'
import type { FinancialPeriodMetrics, IndustryPeerData, IndustryPeerProfile, IndustrySummaryItem, StockDataSummary, StockSearchResult } from '@/types'

type PeriodMode = 'annual' | 'quarter'
type ActiveTab = 'ranking' | 'insight'
type ScoreMode = 'composite' | 'quality' | 'cycle' | 'opportunity'

type PeerScore = {
  symbol: string
  name: string
  industry: string
  profile: IndustryPeerData['profile']
  periodsCount: number
  result: FinancialInsightResult
  latestPoint: FinancialScorePoint | null
  absoluteScore: number
  absolutePercentile: number
  relativeScore: number
  industryScore: number
  cycleAdjustedScore: number
  longTermQualityScore: number
  cycleElasticityScore: number
  activeScore: number
  activeScoreLabel: string
  investmentOpportunityScore: number
  opportunityZone: '机会区' | '观察区' | '风险区'
  opportunityConclusion: string
  fundamentalScore10: number
  timingScore10: number
  valuationScore10: number
  riskControlScore10: number
  valuationSummary: string
  rank: number
  relativeRank: number
  companyType: string
  companyTags: string[]
  cyclicExposure: number
  resources: string[]
  profitabilityStability: number
  cashflowStability: number
  profitVolatility: number
  cycleOpportunityScore: number
  cycleRiskAdjustment: number
  cycleRiskLevel: '低' | '中' | '高'
  cycleJudgement: string
  dimensionPercentiles: {
    growth: number
    profitability: number
    cashflow: number
    safety: number
    efficiency: number
  }
}

type UnscorablePeer = {
  symbol: string
  name: string
  industry: string
  profile: IndustryPeerData['profile']
  periodsCount: number
  reason: string
  actionHint: string
}

type StockCycleTag = {
  companyType: string
  cyclicExposure: number
  resources: string[]
  tags: string[]
}

type CommodityCycleData = {
  name: string
  pricePercentile5y: number
  trend3m: number
  inventoryTrend: '上升' | '下降' | '持平' | '未知'
  cyclePosition: string
  opportunityScore: number
  riskAdjustment: number
  sourceNote: string
  updatedAt: string
}

type IndustryCycleContext = {
  industryType: '周期资源型' | '成长制造型' | '稳定现金流型' | '通用财务型'
  isCyclical: boolean
  commodities: CommodityCycleData[]
  avgPricePercentile: number | null
  avgTrend3m: number | null
  inventorySummary: string
  cyclePosition: string
  opportunityScore: number
  riskAdjustment: number
  interpretation: string
  modelNote: string
}

const stockCycleTags = stockCycleTagsRaw as Record<string, StockCycleTag>
const MIN_SCORE_PERIODS = 2
const chartMargin = { top: 12, right: 18, bottom: 8, left: 0 }
const COLORS = ['var(--accent-primary)', 'var(--accent-secondary)', 'var(--up-red)', 'var(--warning)', 'var(--chart-ma20)']

const SCORE_MODE_LABELS: Record<ScoreMode, string> = {
  composite: '综合榜',
  quality: '长期质量榜',
  cycle: '周期弹性榜',
  opportunity: '投资机会榜',
}

type IndustryCompareViewState = {
  industry?: string
  period?: PeriodMode
  scoreMode?: ScoreMode
  activeTab?: ActiveTab
  showUnscorable?: boolean
}

const INDUSTRY_COMPARE_STATE_KEY = 'stock_analysis.industry_compare.view_state'

function isPeriodMode(value: string | null): value is PeriodMode {
  return value === 'annual' || value === 'quarter'
}

function isScoreMode(value: string | null): value is ScoreMode {
  return value === 'composite' || value === 'quality' || value === 'cycle' || value === 'opportunity'
}

function isActiveTab(value: string | null): value is ActiveTab {
  return value === 'ranking' || value === 'insight'
}

function readStoredIndustryCompareState(): IndustryCompareViewState {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(INDUSTRY_COMPARE_STATE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as IndustryCompareViewState
    return {
      industry: typeof parsed.industry === 'string' ? parsed.industry : undefined,
      period: isPeriodMode(parsed.period ?? null) ? parsed.period : undefined,
      scoreMode: isScoreMode(parsed.scoreMode ?? null) ? parsed.scoreMode : undefined,
      activeTab: isActiveTab(parsed.activeTab ?? null) ? parsed.activeTab : undefined,
      showUnscorable: typeof parsed.showUnscorable === 'boolean' ? parsed.showUnscorable : undefined,
    }
  } catch {
    return {}
  }
}

function initialIndustryCompareState(params: URLSearchParams): IndustryCompareViewState {
  const stored = readStoredIndustryCompareState()
  const industry = params.get('industry') || stored.industry
  const periodParam = params.get('period')
  const modeParam = params.get('mode')
  const tabParam = params.get('tab')
  const showUnscorableParam = params.get('showUnscorable')
  return {
    industry,
    period: isPeriodMode(periodParam) ? periodParam : stored.period,
    scoreMode: isScoreMode(modeParam) ? modeParam : stored.scoreMode,
    activeTab: isActiveTab(tabParam) ? tabParam : stored.activeTab,
    showUnscorable: showUnscorableParam == null ? stored.showUnscorable : showUnscorableParam !== '0',
  }
}

function persistIndustryCompareState(state: Required<IndustryCompareViewState>) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(INDUSTRY_COMPARE_STATE_KEY, JSON.stringify(state))
}

const CYCLICAL_INDUSTRY_KEYWORDS = ['小金属', '稀土', '有色', '工业金属', '能源金属', '贵金属', '煤炭', '焦炭', '钢铁', '化工', '化学原料', '基础化学', '石油', '油气']
const STABLE_INDUSTRY_KEYWORDS = ['银行', '保险', '公用事业', '电力', '燃气', '铁路', '高速公路']
const GROWTH_INDUSTRY_KEYWORDS = ['半导体', '软件', '消费电子', '医疗器械', '创新药', '电池', '光伏设备', '机器人']

const INDUSTRY_COMMODITIES: Record<string, string[]> = {
  小金属: ['锡', '钨', '锑', '钼'],
  稀土: ['氧化镨钕', '氧化镝'],
  有色: ['铜', '铝', '锌'],
  工业金属: ['铜', '铝', '锌'],
  能源金属: ['锂', '钴', '镍'],
  贵金属: ['黄金', '白银'],
  煤炭: ['动力煤', '焦煤'],
  焦炭: ['焦煤', '焦炭'],
  钢铁: ['螺纹钢', '铁矿石'],
  化工: ['原油', 'PTA'],
}

const COMMODITY_CYCLE_DATA: Record<string, CommodityCycleData> = {
  锡: { name: '锡', pricePercentile5y: 82, trend3m: 18, inventoryTrend: '下降', cyclePosition: '高位强势', opportunityScore: 42, riskAdjustment: 14, updatedAt: '手动维护', sourceNote: '本地周期参数，需定期按锡价和库存更新。' },
  钨: { name: '钨', pricePercentile5y: 76, trend3m: 8, inventoryTrend: '持平', cyclePosition: '偏高震荡', opportunityScore: 50, riskAdjustment: 8, updatedAt: '手动维护', sourceNote: '本地周期参数，需定期按钨精矿/APT价格更新。' },
  锑: { name: '锑', pricePercentile5y: 86, trend3m: 15, inventoryTrend: '下降', cyclePosition: '高位强势', opportunityScore: 40, riskAdjustment: 15, updatedAt: '手动维护', sourceNote: '本地周期参数，需定期按锑锭价格更新。' },
  钼: { name: '钼', pricePercentile5y: 63, trend3m: 4, inventoryTrend: '持平', cyclePosition: '中高位震荡', opportunityScore: 58, riskAdjustment: 6, updatedAt: '手动维护', sourceNote: '本地周期参数，需定期按钼铁价格更新。' },
  氧化镨钕: { name: '氧化镨钕', pricePercentile5y: 48, trend3m: 6, inventoryTrend: '下降', cyclePosition: '低位修复', opportunityScore: 68, riskAdjustment: 2, updatedAt: '手动维护', sourceNote: '本地周期参数，需定期按稀土价格更新。' },
  氧化镝: { name: '氧化镝', pricePercentile5y: 52, trend3m: 3, inventoryTrend: '持平', cyclePosition: '中位修复', opportunityScore: 62, riskAdjustment: 3, updatedAt: '手动维护', sourceNote: '本地周期参数，需定期按稀土价格更新。' },
  铜: { name: '铜', pricePercentile5y: 78, trend3m: 7, inventoryTrend: '下降', cyclePosition: '偏高强势', opportunityScore: 50, riskAdjustment: 10, updatedAt: '手动维护', sourceNote: '本地周期参数，需定期按铜价和交易所库存更新。' },
  铝: { name: '铝', pricePercentile5y: 66, trend3m: 4, inventoryTrend: '下降', cyclePosition: '中高位偏强', opportunityScore: 56, riskAdjustment: 7, updatedAt: '手动维护', sourceNote: '本地周期参数，需定期按铝价和库存更新。' },
  锌: { name: '锌', pricePercentile5y: 58, trend3m: 2, inventoryTrend: '持平', cyclePosition: '中位震荡', opportunityScore: 60, riskAdjustment: 4, updatedAt: '手动维护', sourceNote: '本地周期参数，需定期按锌价和库存更新。' },
  锂: { name: '锂', pricePercentile5y: 28, trend3m: 5, inventoryTrend: '下降', cyclePosition: '低位修复', opportunityScore: 78, riskAdjustment: -2, updatedAt: '手动维护', sourceNote: '本地周期参数，需定期按碳酸锂价格更新。' },
  钴: { name: '钴', pricePercentile5y: 38, trend3m: 3, inventoryTrend: '持平', cyclePosition: '偏低修复', opportunityScore: 70, riskAdjustment: 0, updatedAt: '手动维护', sourceNote: '本地周期参数，需定期按钴价更新。' },
  镍: { name: '镍', pricePercentile5y: 45, trend3m: -2, inventoryTrend: '上升', cyclePosition: '中位偏弱', opportunityScore: 48, riskAdjustment: 7, updatedAt: '手动维护', sourceNote: '本地周期参数，需定期按镍价和库存更新。' },
  黄金: { name: '黄金', pricePercentile5y: 88, trend3m: 9, inventoryTrend: '未知', cyclePosition: '高位强势', opportunityScore: 45, riskAdjustment: 10, updatedAt: '手动维护', sourceNote: '本地周期参数，黄金还需结合实际利率和美元周期。' },
  动力煤: { name: '动力煤', pricePercentile5y: 54, trend3m: -3, inventoryTrend: '上升', cyclePosition: '中位偏弱', opportunityScore: 45, riskAdjustment: 8, updatedAt: '手动维护', sourceNote: '本地周期参数，需定期按煤价和港口库存更新。' },
  焦煤: { name: '焦煤', pricePercentile5y: 46, trend3m: -4, inventoryTrend: '上升', cyclePosition: '中低位偏弱', opportunityScore: 48, riskAdjustment: 7, updatedAt: '手动维护', sourceNote: '本地周期参数，需定期按焦煤价格更新。' },
  螺纹钢: { name: '螺纹钢', pricePercentile5y: 35, trend3m: -2, inventoryTrend: '上升', cyclePosition: '偏低探底', opportunityScore: 52, riskAdjustment: 5, updatedAt: '手动维护', sourceNote: '本地周期参数，需定期按钢价和库存更新。' },
  铁矿石: { name: '铁矿石', pricePercentile5y: 60, trend3m: -1, inventoryTrend: '上升', cyclePosition: '中位偏弱', opportunityScore: 48, riskAdjustment: 7, updatedAt: '手动维护', sourceNote: '本地周期参数，需定期按铁矿石价格和港口库存更新。' },
  原油: { name: '原油', pricePercentile5y: 55, trend3m: 1, inventoryTrend: '持平', cyclePosition: '中位震荡', opportunityScore: 55, riskAdjustment: 5, updatedAt: '手动维护', sourceNote: '本地周期参数，需定期按油价和库存更新。' },
  PTA: { name: 'PTA', pricePercentile5y: 50, trend3m: 2, inventoryTrend: '持平', cyclePosition: '中位震荡', opportunityScore: 56, riskAdjustment: 4, updatedAt: '手动维护', sourceNote: '本地周期参数，需定期按化工品价格更新。' },
}

function tooltipStyle() {
  return {
    backgroundColor: 'var(--bg-elevated)',
    border: '1px solid var(--border-subtle)',
    borderRadius: '8px',
    color: 'var(--text-primary)',
    fontSize: '12px',
  }
}

function formatMoney(value: number) {
  if (!value || Number.isNaN(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 100000000) return `${(value / 100000000).toFixed(1)}亿`
  if (abs >= 10000) return `${(value / 10000).toFixed(0)}万`
  return value.toFixed(0)
}

function avg(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function median(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function percentile(value: number, values: number[], higherBetter = true) {
  const clean = values.filter((item) => Number.isFinite(item))
  if (clean.length <= 1) return clean.length === 1 ? 100 : 0
  const betterOrEqual = clean.filter((item) => higherBetter ? item <= value : item >= value).length
  return Math.round((betterOrEqual / clean.length) * 100)
}

function riskColor(level: string) {
  if (level === '高') return 'var(--down-green)'
  if (level === '中') return 'var(--warning)'
  return 'var(--up-red)'
}

function industryPosition(score: number) {
  if (score >= 90) return { label: '🔥 行业前10%', tone: 'var(--up-red)', bg: 'rgba(239,68,68,0.14)', hint: '行业头部' }
  if (score >= 75) return { label: '🟢 行业前25%', tone: 'var(--accent-primary)', bg: 'rgba(59,130,246,0.14)', hint: '行业靠前' }
  if (score >= 50) return { label: '🟡 行业中游', tone: 'var(--warning)', bg: 'rgba(245,158,11,0.14)', hint: '中位附近' }
  if (score >= 20) return { label: '🟠 行业后半', tone: 'var(--text-secondary)', bg: 'rgba(148,163,184,0.14)', hint: '相对偏弱' }
  return { label: '🔴 行业后20%', tone: 'var(--down-green)', bg: 'rgba(34,197,94,0.14)', hint: '行业靠后' }
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function stdev(values: number[]) {
  const clean = values.filter((value) => Number.isFinite(value))
  if (clean.length <= 1) return 0
  const mean = avg(clean)
  const variance = avg(clean.map((value) => (value - mean) ** 2))
  return Math.sqrt(variance)
}

function matchesAny(value: string, keywords: string[]) {
  return keywords.some((keyword) => value.includes(keyword))
}

function matchedIndustryCommodities(industry: string) {
  const entry = Object.entries(INDUSTRY_COMMODITIES).find(([keyword]) => industry.includes(keyword))
  return entry?.[1] ?? []
}

function inferIndustryType(industry: string): IndustryCycleContext['industryType'] {
  if (matchesAny(industry, CYCLICAL_INDUSTRY_KEYWORDS)) return '周期资源型'
  if (matchesAny(industry, STABLE_INDUSTRY_KEYWORDS)) return '稳定现金流型'
  if (matchesAny(industry, GROWTH_INDUSTRY_KEYWORDS)) return '成长制造型'
  return '通用财务型'
}

function opportunityWeightsForContext(context: Pick<IndustryCycleContext, 'industryType' | 'isCyclical'>) {
  if (context.isCyclical) return { fundamental: 0.25, timing: 0.35, valuation: 0.25, risk: 0.15 }
  if (context.industryType === '成长制造型') return { fundamental: 0.35, timing: 0.15, valuation: 0.30, risk: 0.20 }
  if (context.industryType === '稳定现金流型') return { fundamental: 0.30, timing: 0.05, valuation: 0.35, risk: 0.30 }
  return { fundamental: 0.35, timing: 0.10, valuation: 0.35, risk: 0.20 }
}

function opportunityWeightText(context: Pick<IndustryCycleContext, 'industryType' | 'isCyclical'>) {
  const weights = opportunityWeightsForContext(context)
  return `基本面${Math.round(weights.fundamental * 100)}% / 时机${Math.round(weights.timing * 100)}% / 估值${Math.round(weights.valuation * 100)}% / 风险${Math.round(weights.risk * 100)}%`
}

function nonCycleTimingScore(context: IndustryCycleContext, latestPoint: FinancialScorePoint | null, relativeScore: number) {
  if (context.industryType === '稳定现金流型') {
    return clamp(avg([latestPoint?.cashflow ?? 50, latestPoint?.safety ?? 50, relativeScore]))
  }
  if (context.industryType === '成长制造型') {
    return clamp(avg([latestPoint?.growth ?? 50, latestPoint?.profitability ?? 50, relativeScore]))
  }
  return clamp(avg([latestPoint?.growth ?? 50, latestPoint?.profitability ?? 50, latestPoint?.cashflow ?? 50, relativeScore]))
}

function nonCycleModelCopy(industryType: IndustryCycleContext['industryType']) {
  if (industryType === '成长制造型') {
    return {
      position: '成长兑现模型',
      interpretation: '非周期成长行业重点看业绩兑现、盈利质量、估值匹配和风险控制，不用商品价格高低修正。',
      modelNote: '成长制造模型：把“好公司”与“买入价格”分开，避免只按高增长追高。',
    }
  }
  if (industryType === '稳定现金流型') {
    return {
      position: '现金流防守模型',
      interpretation: '稳定现金流行业重点看现金流、安全边际、估值位置和财务风险，成长弹性权重较低。',
      modelNote: '稳定现金流模型：更关注分红/现金流质量、资产安全和估值吸引力。',
    }
  }
  return {
    position: '通用财务模型',
    interpretation: '当前行业没有明确商品周期锚，按基本面、估值、业绩时机和风险控制做机会评分。',
    modelNote: '通用财务模型：更关注成长、盈利、现金流、安全、效率和估值匹配。',
  }
}

function getCommodityCycles(resources: string[], industry: string) {
  const names = Array.from(new Set([...resources, ...matchedIndustryCommodities(industry)]))
  return names
    .map((name) => COMMODITY_CYCLE_DATA[name])
    .filter((item): item is CommodityCycleData => Boolean(item))
}

function buildIndustryCycleContext(industry: string, peers: IndustryPeerData[] = []): IndustryCycleContext {
  const industryType = inferIndustryType(industry)
  const resources = peers.flatMap((peer) => stockCycleTags[peer.symbol]?.resources ?? [])
  const commodities = getCommodityCycles(resources, industry)
  const isCyclical = industryType === '周期资源型' || commodities.length > 0
  if (!isCyclical) {
    const copy = nonCycleModelCopy(industryType)
    return {
      industryType,
      isCyclical: false,
      commodities: [],
      avgPricePercentile: null,
      avgTrend3m: null,
      inventorySummary: '不适用',
      cyclePosition: copy.position,
      opportunityScore: 50,
      riskAdjustment: 0,
      interpretation: copy.interpretation,
      modelNote: copy.modelNote,
    }
  }
  if (commodities.length === 0) {
    return {
      industryType: '周期资源型',
      isCyclical: true,
      commodities: [],
      avgPricePercentile: null,
      avgTrend3m: null,
      inventorySummary: '未配置',
      cyclePosition: '周期数据未配置',
      opportunityScore: 50,
      riskAdjustment: 8,
      interpretation: '已识别为周期行业，但暂未配置对应商品价格和库存周期；评分会提示周期属性，但不做强修正。',
      modelNote: '周期模型：需结合商品价格分位、库存趋势和利润波动判断机会/风险。',
    }
  }
  const avgPricePercentile = avg(commodities.map((item) => item.pricePercentile5y))
  const avgTrend3m = avg(commodities.map((item) => item.trend3m))
  const opportunityScore = avg(commodities.map((item) => item.opportunityScore))
  const riskAdjustment = avg(commodities.map((item) => item.riskAdjustment))
  const inventoryCounts = commodities.reduce<Record<string, number>>((acc, item) => {
    acc[item.inventoryTrend] = (acc[item.inventoryTrend] || 0) + 1
    return acc
  }, {})
  const inventorySummary = Object.entries(inventoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '未知'
  const cyclePosition = avgPricePercentile >= 80 && avgTrend3m >= 0
    ? '高位强势'
    : avgPricePercentile >= 75 && avgTrend3m < 0
      ? '高位回落'
      : avgPricePercentile <= 35 && avgTrend3m > 0
        ? '低位修复'
        : avgPricePercentile <= 35
          ? '低位探底'
          : avgTrend3m > 5
            ? '中位修复'
            : avgTrend3m < -5
              ? '中位转弱'
              : '中位震荡'
  const interpretation = cyclePosition.includes('高位')
    ? '商品价格分位偏高，财务高增长更可能包含价格周期贡献；弹性仍在，但应提高回撤和利润回落风险权重。'
    : cyclePosition.includes('低位修复')
      ? '商品价格仍处低位并出现修复迹象，周期机会属性更强，但需要库存和价格趋势继续确认。'
      : cyclePosition.includes('低位探底')
        ? '商品价格处于低位但趋势尚未确认，更适合等待供需或库存拐点。'
        : '商品价格处于中位区间，需同时观察公司质量和价格趋势，避免只按单期利润增速判断。'
  return {
    industryType: '周期资源型',
    isCyclical: true,
    commodities,
    avgPricePercentile: Math.round(avgPricePercentile),
    avgTrend3m: Number(avgTrend3m.toFixed(1)),
    inventorySummary,
    cyclePosition,
    opportunityScore: Math.round(opportunityScore),
    riskAdjustment: Math.round(riskAdjustment),
    interpretation,
    modelNote: '周期模型：财务分只回答“公司当期表现”，周期位置用于判断“现在更像机会还是风险”。',
  }
}

function inferStockCycleTag(peer: IndustryPeerData, context: IndustryCycleContext): StockCycleTag {
  const configured = stockCycleTags[peer.symbol]
  if (configured) return configured
  if (context.isCyclical) {
    return {
      companyType: context.commodities.length ? '周期资源型' : '周期属性待确认',
      cyclicExposure: context.commodities.length ? 76 : 62,
      resources: context.commodities.map((item) => item.name),
      tags: ['行业推断', '周期属性'],
    }
  }
  if (context.industryType === '成长制造型') {
    return { companyType: '成长制造型', cyclicExposure: 20, resources: [], tags: ['行业推断', '成长制造'] }
  }
  if (context.industryType === '稳定现金流型') {
    return { companyType: '稳定现金流型', cyclicExposure: 15, resources: [], tags: ['行业推断', '稳定现金流'] }
  }
  return { companyType: '通用财务型', cyclicExposure: 30, resources: [], tags: ['行业推断'] }
}

function metricStability(rows: FinancialPeriodMetrics[], selector: (row: FinancialPeriodMetrics) => number, scale = 3) {
  const values = rows.map(selector).filter((value) => Number.isFinite(value))
  if (values.length <= 1) return 60
  return clamp(100 - stdev(values) * scale)
}

function cfoRatioStability(rows: FinancialPeriodMetrics[]) {
  const values = rows
    .map((row) => row.netProfit > 0 ? row.operatingCashFlow / row.netProfit : null)
    .filter((value): value is number => value != null && Number.isFinite(value))
    .map((value) => Math.max(-2, Math.min(3, value)) * 100)
  if (values.length <= 1) return 60
  return clamp(100 - stdev(values) * 0.6)
}

function profitabilityStability(rows: FinancialPeriodMetrics[]) {
  return Math.round(avg([
    metricStability(rows, (row) => row.roe, 2.4),
    metricStability(rows, (row) => row.netMargin, 2.6),
    metricStability(rows, (row) => row.grossMargin, 2.2),
  ]))
}

function profitVolatility(rows: FinancialPeriodMetrics[]) {
  return clamp(stdev(rows.map((row) => row.netProfitYoY).filter((value) => Number.isFinite(value))), 0, 100)
}

function cycleRiskLevel(cyclicExposure: number, riskAdjustment: number, profitVolatilityScore: number): '低' | '中' | '高' {
  const riskScore = cyclicExposure * 0.45 + riskAdjustment * 2 + profitVolatilityScore * 0.25
  if (riskScore >= 70) return '高'
  if (riskScore >= 42) return '中'
  return '低'
}

function activeScoreForMode(mode: ScoreMode, scores: { cycleAdjustedScore: number; longTermQualityScore: number; cycleElasticityScore: number; investmentOpportunityScore: number }) {
  if (mode === 'quality') return { score: scores.longTermQualityScore, label: '长期质量分' }
  if (mode === 'cycle') return { score: scores.cycleElasticityScore, label: '周期弹性分' }
  if (mode === 'opportunity') return { score: Math.round(scores.investmentOpportunityScore * 10), label: '投资机会分' }
  return { score: scores.cycleAdjustedScore, label: '周期修正综合分' }
}

function opportunityZone(score10: number): '机会区' | '观察区' | '风险区' {
  if (score10 >= 7.2) return '机会区'
  if (score10 >= 5.0) return '观察区'
  return '风险区'
}

function opportunityTone(zone: string) {
  if (zone === '机会区') return { color: 'var(--accent-primary)', bg: 'rgba(59,130,246,0.14)' }
  if (zone === '观察区') return { color: 'var(--warning)', bg: 'rgba(245,158,11,0.14)' }
  return { color: 'var(--up-red)', bg: 'rgba(239,68,68,0.14)' }
}

function valuationGrowthMatch(row: FinancialPeriodMetrics | null, pe: number) {
  const growth = row?.netProfitYoY ?? 0
  if (!Number.isFinite(pe) || pe <= 0) return growth > 20 ? 62 : 45
  if (growth > 30 && pe <= 25) return 88
  if (growth > 20 && pe <= 35) return 78
  if (growth > 10 && pe <= 25) return 72
  if (growth <= 0 && pe >= 30) return 22
  if (growth <= 0 && pe >= 15) return 38
  if (pe <= 12) return 75
  if (pe <= 25) return 62
  if (pe <= 45) return 45
  return 25
}

function valuationSummary(pe: number, pb: number, valuationScore: number) {
  const level = valuationScore >= 75 ? '偏便宜' : valuationScore >= 55 ? '合理' : valuationScore >= 35 ? '偏贵' : '较贵'
  return `${level}；PE ${pe > 0 ? pe.toFixed(1) : '—'}，PB ${pb > 0 ? pb.toFixed(1) : '—'}`
}

function buildOpportunityConclusion(zone: '机会区' | '观察区' | '风险区', context: IndustryCycleContext, valuationScore10: number, timingScore10: number, riskControlScore10: number) {
  if (zone === '机会区') {
    return context.isCyclical
      ? '周期位置和估值赔率相对友好，可作为机会候选继续复核商品价格与库存。'
      : '基本面、估值和风险控制组合较好，可作为非周期机会候选继续复核。'
  }
  if (zone === '风险区') {
    if (context.isCyclical && timingScore10 < 4.5) return '周期位置不友好，当前更偏高位风险或等待区。'
    if (valuationScore10 < 4) return '估值吸引力不足，即使公司质量较好也需要注意买入价格。'
    if (riskControlScore10 < 4) return '风险控制分偏低，需优先排查财务、周期或经营风险。'
    return '综合赔率不足，当前不适合只按财务高分追高。'
  }
  return context.isCyclical
    ? '周期和估值没有形成明显赔率优势，适合观察价格、库存和利润率变化。'
    : '基本面与估值处于中性状态，适合观察业绩兑现和估值变化。'
}

function opportunityScoreForPeer(params: {
  context: IndustryCycleContext
  longTermQualityScore: number
  cycleElasticityScore: number
  relativeScore: number
  profitabilityStable: number
  cashflowStable: number
  cycleRisk: '低' | '中' | '高'
  cycleOpportunityScore: number
  cycleRiskAdjustment: number
  financialRisk: '低' | '中' | '高'
  peer: IndustryPeerData
  latestPoint: FinancialScorePoint | null
  pePercentile: number
  pbPercentile: number
}) {
  const { context, longTermQualityScore, relativeScore, profitabilityStable, cashflowStable, cycleRisk, cycleOpportunityScore, cycleRiskAdjustment, financialRisk, peer, latestPoint, pePercentile, pbPercentile } = params
  const latestPeriod = peer.periods.at(-1) ?? null
  const pe = peer.profile.pe || 0
  const pb = peer.profile.pb || 0
  const growthMatch = valuationGrowthMatch(latestPeriod, pe)
  const valuationScore = clamp(avg([pePercentile, pbPercentile, growthMatch]))
  const fundamentalScore = clamp(avg([longTermQualityScore, relativeScore, profitabilityStable, cashflowStable]))
  const timingScore = context.isCyclical
    ? clamp(cycleOpportunityScore - Math.max(0, cycleRiskAdjustment) * 0.35)
    : nonCycleTimingScore(context, latestPoint, relativeScore)
  const financialRiskPenalty = financialRisk === '高' ? 30 : financialRisk === '中' ? 14 : 4
  const cycleRiskPenalty = context.isCyclical ? (cycleRisk === '高' ? 30 : cycleRisk === '中' ? 16 : 6) : 4
  const leveragePenalty = latestPeriod?.debtAssetRatio ? Math.max(0, latestPeriod.debtAssetRatio - 55) * 0.45 : 0
  const riskControl = clamp(100 - financialRiskPenalty - cycleRiskPenalty - leveragePenalty)
  const weights = opportunityWeightsForContext(context)
  const score100 = clamp(
    fundamentalScore * weights.fundamental +
    timingScore * weights.timing +
    valuationScore * weights.valuation +
    riskControl * weights.risk,
  )
  const score10 = Number((score100 / 10).toFixed(1))
  const zone = opportunityZone(score10)
  return {
    investmentOpportunityScore: score10,
    opportunityZone: zone,
    opportunityConclusion: buildOpportunityConclusion(zone, context, valuationScore / 10, timingScore / 10, riskControl / 10),
    fundamentalScore10: Number((fundamentalScore / 10).toFixed(1)),
    timingScore10: Number((timingScore / 10).toFixed(1)),
    valuationScore10: Number((valuationScore / 10).toFixed(1)),
    riskControlScore10: Number((riskControl / 10).toFixed(1)),
    valuationSummary: valuationSummary(pe, pb, valuationScore),
  }
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-border-subtle ${className}`} style={{ backgroundColor: 'var(--bg-surface)' }}>
      {children}
    </section>
  )
}

function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border-subtle px-3 py-2" style={{ backgroundColor: 'var(--bg-base)' }}>
      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <div className="mt-1 font-data-md" style={{ color: tone || 'var(--text-primary)' }}>{value}</div>
      {hint && <div className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{hint}</div>}
    </div>
  )
}


async function loadAllLocalStocks(maxItems = 1000): Promise<StockDataSummary[]> {
  const pageSize = 200
  const first = await getDataStocks(1, pageSize, '', false)
  const items = [...first.items]
  const totalPages = Math.min(Math.ceil(first.total / pageSize), Math.ceil(maxItems / pageSize))
  for (let page = 2; page <= totalPages; page += 1) {
    const res = await getDataStocks(page, pageSize, '', false)
    items.push(...res.items)
  }
  return items.slice(0, maxItems)
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let index = 0; index < items.length; index += limit) {
    const chunk = items.slice(index, index + limit)
    const chunkResults = await Promise.all(chunk.map(worker))
    results.push(...chunkResults)
  }
  return results
}

function hasFinancialPeriods(stock: StockDataSummary) {
  return Boolean(stock.dataTypes?.financial_periods?.exists || stock.dataTypes?.financials?.exists)
}

async function buildIndustryListFromLocal(): Promise<{ items: IndustrySummaryItem[] }> {
  const stocks = await loadAllLocalStocks(1200)
  const missingIndustryStocks = stocks.filter((stock) => !stock.industry || stock.industry === '未知')
  const profileMap = new Map<string, IndustryPeerProfile>()
  await mapLimit(missingIndustryStocks, 16, async (stock) => {
    try {
      const profile = await getStockProfile(stock.symbol)
      profileMap.set(stock.symbol, {
        symbol: profile.symbol,
        name: profile.name,
        industry: profile.industry || '未知',
        currentPrice: profile.currentPrice,
        changePercent: profile.changePercent,
        marketCap: profile.marketCap,
        pe: profile.pe,
        pb: profile.pb,
      })
    } catch {
      // Ignore individual fallback failures.
    }
  })
  const counts = new Map<string, { count: number; scorableCount: number }>()
  stocks.forEach((stock) => {
    const industry = stock.industry || profileMap.get(stock.symbol)?.industry || '未知'
    if (!industry || industry === '未知') return
    const item = counts.get(industry) || { count: 0, scorableCount: 0 }
    item.count += 1
    if (hasFinancialPeriods(stock)) item.scorableCount += 1
    counts.set(industry, item)
  })
  const items = Array.from(counts.entries())
    .map(([industry, item]) => ({ industry, ...item }))
    .sort((a, b) => b.scorableCount - a.scorableCount || b.count - a.count || a.industry.localeCompare(b.industry))
  return { items }
}

async function buildIndustryCompareFromLocal(params: {
  industry: string
  period: PeriodMode
  q: string
  completeOnly: boolean
  limit: number
}): Promise<IndustryPeerData[]> {
  const stocks = await loadAllLocalStocks(1500)
  const profiles = await mapLimit(stocks, 20, async (stock) => {
    try {
      const profile = await getStockProfile(stock.symbol)
      return {
        stock,
        profile: {
          symbol: profile.symbol,
          name: profile.name,
          industry: profile.industry || stock.industry || '未知',
          currentPrice: profile.currentPrice,
          changePercent: profile.changePercent,
          marketCap: profile.marketCap,
          pe: profile.pe,
          pb: profile.pb,
        } satisfies IndustryPeerProfile,
      }
    } catch {
      return {
        stock,
        profile: {
          symbol: stock.symbol,
          name: stock.name || '',
          industry: stock.industry || '未知',
          currentPrice: 0,
          changePercent: 0,
          marketCap: 0,
          pe: 0,
          pb: 0,
        } satisfies IndustryPeerProfile,
      }
    }
  })
  const ql = params.q.trim().toLowerCase()
  const matched = profiles
    .filter(({ profile }) => !params.industry || profile.industry === params.industry)
    .filter(({ stock, profile }) => !ql || stock.symbol.toLowerCase().includes(ql) || profile.name.toLowerCase().includes(ql))
    .filter(({ stock }) => !params.completeOnly || hasFinancialPeriods(stock))
    .slice(0, params.limit)
  return mapLimit(matched, 16, async ({ stock, profile }) => {
    let periods = [] as IndustryPeerData['periods']
    try {
      periods = await getFinancialPeriods(stock.symbol, params.period, 16)
    } catch {
      periods = []
    }
    return {
      symbol: stock.symbol,
      name: profile.name || stock.name || stock.symbol,
      industry: profile.industry,
      profile,
      periods,
      hasFinancialData: periods.length > 0,
    }
  })
}

function buildPeerScores(peers: IndustryPeerData[], industry: string, scoreMode: ScoreMode): PeerScore[] {
  const base = peers
    .filter((peer) => peer.periods.length >= MIN_SCORE_PERIODS)
    .map((peer) => {
      const result = analyzeFinancialInsights(peer.periods)
      const latestPoint = result.score.points.at(-1) ?? null
      return {
        peer,
        result,
        latestPoint,
        absoluteScore: result.score.total,
      }
    })

  const totals = base.map((item) => item.absoluteScore)
  const growthValues = base.map((item) => item.latestPoint?.growth ?? 0)
  const profitabilityValues = base.map((item) => item.latestPoint?.profitability ?? 0)
  const cashflowValues = base.map((item) => item.latestPoint?.cashflow ?? 0)
  const safetyValues = base.map((item) => item.latestPoint?.safety ?? 0)
  const efficiencyValues = base.map((item) => item.latestPoint?.efficiency ?? 0)
  const peValues = base.map((item) => item.peer.profile.pe).filter((value) => Number.isFinite(value) && value > 0)
  const pbValues = base.map((item) => item.peer.profile.pb).filter((value) => Number.isFinite(value) && value > 0)

  const cycleContext = buildIndustryCycleContext(industry, peers)
  const scored = base.map((item) => {
    const absolutePercentile = percentile(item.absoluteScore, totals)
    const dimensionPercentiles = {
      growth: percentile(item.latestPoint?.growth ?? 0, growthValues),
      profitability: percentile(item.latestPoint?.profitability ?? 0, profitabilityValues),
      cashflow: percentile(item.latestPoint?.cashflow ?? 0, cashflowValues),
      safety: percentile(item.latestPoint?.safety ?? 0, safetyValues),
      efficiency: percentile(item.latestPoint?.efficiency ?? 0, efficiencyValues),
    }
    const relativeScore = Math.round(avg([
      absolutePercentile,
      dimensionPercentiles.growth,
      dimensionPercentiles.profitability,
      dimensionPercentiles.cashflow,
      dimensionPercentiles.safety,
      dimensionPercentiles.efficiency,
    ]))
    const tag = inferStockCycleTag(item.peer, cycleContext)
    const stockCommodities = getCommodityCycles(tag.resources, industry)
    const stockOpportunityScore = stockCommodities.length ? Math.round(avg(stockCommodities.map((commodity) => commodity.opportunityScore))) : cycleContext.opportunityScore
    const stockRiskAdjustment = stockCommodities.length ? Math.round(avg(stockCommodities.map((commodity) => commodity.riskAdjustment))) : cycleContext.riskAdjustment
    const profitabilityStable = profitabilityStability(item.peer.periods)
    const cashflowStable = cfoRatioStability(item.peer.periods)
    const profitVolatilityScore = profitVolatility(item.peer.periods)
    const industryScore = Math.round(item.absoluteScore * 0.6 + relativeScore * 0.4)
    const longTermQualityScore = clamp(
      item.absoluteScore * 0.35 +
      relativeScore * 0.2 +
      profitabilityStable * 0.2 +
      cashflowStable * 0.15 +
      (100 - tag.cyclicExposure) * 0.1 -
      Math.max(0, stockRiskAdjustment) * 0.35,
    )
    const cycleElasticityScore = clamp(
      tag.cyclicExposure * 0.35 +
      profitVolatilityScore * 0.22 +
      dimensionPercentiles.growth * 0.18 +
      relativeScore * 0.15 +
      stockOpportunityScore * 0.1,
    )
    const cycleAdjustedScore = cycleContext.isCyclical
      ? clamp(industryScore + (stockOpportunityScore - 50) * 0.16 - stockRiskAdjustment * 0.35)
      : industryScore
    const risk = cycleRiskLevel(tag.cyclicExposure, stockRiskAdjustment, profitVolatilityScore)
    const pePercentile = item.peer.profile.pe > 0 && peValues.length ? percentile(item.peer.profile.pe, peValues, false) : 45
    const pbPercentile = item.peer.profile.pb > 0 && pbValues.length ? percentile(item.peer.profile.pb, pbValues, false) : 45
    const opportunity = opportunityScoreForPeer({
      context: cycleContext,
      longTermQualityScore,
      cycleElasticityScore,
      relativeScore,
      profitabilityStable,
      cashflowStable,
      cycleRisk: risk,
      cycleOpportunityScore: stockOpportunityScore,
      cycleRiskAdjustment: stockRiskAdjustment,
      financialRisk: item.result.riskLevel,
      peer: item.peer,
      latestPoint: item.latestPoint,
      pePercentile,
      pbPercentile,
    })
    const active = activeScoreForMode(scoreMode, { cycleAdjustedScore, longTermQualityScore, cycleElasticityScore, investmentOpportunityScore: opportunity.investmentOpportunityScore })
    const cycleJudgement = cycleContext.isCyclical
      ? `${cycleContext.cyclePosition}：${risk === '高' ? '弹性强但回撤风险高' : risk === '中' ? '需结合商品价格位置观察' : '周期风险相对可控'}`
      : '非周期行业，按通用财务模型评价'
    return {
      symbol: item.peer.symbol,
      name: item.peer.name,
      industry: item.peer.industry,
      profile: item.peer.profile,
      periodsCount: item.peer.periods.length,
      result: item.result,
      latestPoint: item.latestPoint,
      absoluteScore: item.absoluteScore,
      absolutePercentile,
      relativeScore,
      industryScore,
      cycleAdjustedScore,
      longTermQualityScore,
      cycleElasticityScore,
      activeScore: active.score,
      activeScoreLabel: active.label,
      investmentOpportunityScore: opportunity.investmentOpportunityScore,
      opportunityZone: opportunity.opportunityZone,
      opportunityConclusion: opportunity.opportunityConclusion,
      fundamentalScore10: opportunity.fundamentalScore10,
      timingScore10: opportunity.timingScore10,
      valuationScore10: opportunity.valuationScore10,
      riskControlScore10: opportunity.riskControlScore10,
      valuationSummary: opportunity.valuationSummary,
      rank: 0,
      relativeRank: 0,
      companyType: tag.companyType,
      companyTags: tag.tags,
      cyclicExposure: tag.cyclicExposure,
      resources: tag.resources,
      profitabilityStability: profitabilityStable,
      cashflowStability: cashflowStable,
      profitVolatility: profitVolatilityScore,
      cycleOpportunityScore: stockOpportunityScore,
      cycleRiskAdjustment: stockRiskAdjustment,
      cycleRiskLevel: risk,
      cycleJudgement,
      dimensionPercentiles,
    }
  })

  const byActiveScore = [...scored].sort((a, b) => b.activeScore - a.activeScore)
  const byRelative = [...scored].sort((a, b) => b.relativeScore - a.relativeScore)
  byActiveScore.forEach((row, index) => { row.rank = index + 1 })
  byRelative.forEach((row, index) => { row.relativeRank = index + 1 })
  return byActiveScore
}

function getUnscorableReason(peer: IndustryPeerData, period: PeriodMode) {
  const periodName = period === 'annual' ? '年度' : '季度'
  if (!peer.industry || peer.industry === '未知' || !peer.profile?.industry || peer.profile.industry === '未知') {
    return { reason: '行业分类缺失', actionHint: '先更新基本信息，或重建行业快照。' }
  }
  if (!peer.hasFinancialData || peer.periods.length === 0) {
    return { reason: `缺少${periodName}财务期间数据`, actionHint: `下载或更新财务数据；也可切换${period === 'annual' ? '季度' : '年度'}口径查看。` }
  }
  if (peer.periods.length < MIN_SCORE_PERIODS) {
    return { reason: `${periodName}财务样本不足`, actionHint: `当前只有${peer.periods.length}期数据，至少需要${MIN_SCORE_PERIODS}期才能计算趋势评分。` }
  }
  return null
}

function buildUnscorablePeers(peers: IndustryPeerData[], period: PeriodMode): UnscorablePeer[] {
  return peers
    .map((peer) => {
      const reason = getUnscorableReason(peer, period)
      if (!reason) return null
      return {
        symbol: peer.symbol,
        name: peer.name,
        industry: peer.industry,
        profile: peer.profile,
        periodsCount: peer.periods.length,
        reason: reason.reason,
        actionHint: reason.actionHint,
      }
    })
    .filter((peer): peer is UnscorablePeer => Boolean(peer))
    .sort((a, b) => a.reason.localeCompare(b.reason) || a.symbol.localeCompare(b.symbol))
}

function groupPeers(peers: PeerScore[]) {
  return {
    leaders: peers.filter((peer) => peer.rank <= Math.max(3, Math.ceil(peers.length * 0.1)) && peer.result.riskLevel !== '高').slice(0, 8),
    growers: [...peers].sort((a, b) => (b.latestPoint?.growth ?? 0) - (a.latestPoint?.growth ?? 0)).slice(0, 8),
    cashCows: peers.filter((peer) => (peer.latestPoint?.cashflow ?? 0) >= 16 || peer.result.investmentType.includes('现金牛')).slice(0, 8),
    repair: peers.filter((peer) => peer.result.investmentType.includes('修复') || peer.result.lifecycle === '修复期').slice(0, 8),
    risks: peers.filter((peer) => peer.result.riskLevel !== '低').sort((a, b) => b.result.riskReasons.length - a.result.riskReasons.length).slice(0, 8),
  }
}

export default function IndustryCompare() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const initialViewState = initialIndustryCompareState(params)
  const [industries, setIndustries] = useState<IndustrySummaryItem[]>([])
  const [industry, setIndustry] = useState(initialViewState.industry || '')
  const [period, setPeriod] = useState<PeriodMode>(initialViewState.period || 'annual')
  const [scoreMode, setScoreMode] = useState<ScoreMode>(initialViewState.scoreMode || 'composite')
  const [stockSearchQuery, setStockSearchQuery] = useState('')
  const [stockSearchResults, setStockSearchResults] = useState<StockSearchResult[]>([])
  const [showStockSearchResults, setShowStockSearchResults] = useState(false)
  const [locatingStock, setLocatingStock] = useState(false)
  const suppressNextStockSearchRef = useRef(false)
  const [showUnscorable, setShowUnscorable] = useState(initialViewState.showUnscorable ?? true)
  const [activeTab, setActiveTab] = useState<ActiveTab>(initialViewState.activeTab || 'ranking')
  const [peers, setPeers] = useState<IndustryPeerData[]>([])
  const [loadingIndustries, setLoadingIndustries] = useState(true)
  const [loadingPeers, setLoadingPeers] = useState(false)
  const [rebuildingSnapshot, setRebuildingSnapshot] = useState(false)
  const [snapshotUpdatedAt, setSnapshotUpdatedAt] = useState('')
  const [reloadSeq, setReloadSeq] = useState(0)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    setLoadingIndustries(true)
    getIndustryList()
      .then((res) => {
        if (!mounted) return
        setIndustries(res.items)
        setSnapshotUpdatedAt(res.updatedAt || '')
        setNotice(res.updatedAt ? `已读取本地行业快照：${res.updatedAt}` : '')
        if (!industry && res.items.length > 0) setIndustry(res.items[0].industry)
      })
      .catch(async (err) => {
        try {
          const fallback = await buildIndustryListFromLocal()
          if (!mounted) return
          setIndustries(fallback.items)
          setSnapshotUpdatedAt('')
          setNotice('当前使用前端本地保底推导；后端更新并重启后可保存行业快照。')
          if (!industry && fallback.items.length > 0) setIndustry(fallback.items[0].industry)
          setError('行业接口不可用，已使用本地股票数据生成行业分类保底。')
        } catch {
          if (mounted) setError(err instanceof Error ? err.message : '行业列表加载失败')
        }
      })
      .finally(() => mounted && setLoadingIndustries(false))
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (suppressNextStockSearchRef.current) {
      suppressNextStockSearchRef.current = false
      return
    }
    const query = stockSearchQuery.trim()
    if (!query) {
      setStockSearchResults([])
      setShowStockSearchResults(false)
      return
    }
    let mounted = true
    const timer = setTimeout(async () => {
      try {
        const res = await searchStocks(query)
        if (!mounted) return
        setStockSearchResults(res.slice(0, 8))
        setShowStockSearchResults(true)
      } catch {
        if (!mounted) return
        setStockSearchResults([])
        setShowStockSearchResults(false)
      }
    }, 250)
    return () => {
      mounted = false
      clearTimeout(timer)
    }
  }, [stockSearchQuery])

  useEffect(() => {
    const state = { industry, period, scoreMode, activeTab, showUnscorable }
    persistIndustryCompareState(state)
    if (!industry) return
    setParams({
      industry,
      period,
      mode: scoreMode,
      tab: activeTab,
      showUnscorable: showUnscorable ? '1' : '0',
    }, { replace: true })
  }, [activeTab, industry, period, scoreMode, setParams, showUnscorable])

  useEffect(() => {
    if (!industry) return
    let mounted = true
    setLoadingPeers(true)
    setError('')
    getIndustryCompare({ industry, period, completeOnly: false, limit: 1000 })
      .then((res) => {
        if (!mounted) return
        setPeers(res.items)
        if (res.updatedAt) setSnapshotUpdatedAt(res.updatedAt)
      })
      .catch(async (err) => {
        try {
          const fallbackItems = await buildIndustryCompareFromLocal({ industry, period, q: '', completeOnly: false, limit: 600 })
          if (!mounted) return
          setPeers(fallbackItems)
          setError('行业对比接口不可用，已使用本地 profile + 财务数据保底生成。')
        } catch {
          if (mounted) setError(err instanceof Error ? err.message : '行业对比加载失败')
        }
      })
      .finally(() => { if (mounted) setLoadingPeers(false) })
    return () => { mounted = false }
  }, [industry, period, reloadSeq])

  const cycleContext = useMemo(() => buildIndustryCycleContext(industry, peers), [industry, peers])
  const scoredPeers = useMemo(() => buildPeerScores(peers, industry, scoreMode), [peers, industry, scoreMode])
  const unscorablePeers = useMemo(() => buildUnscorablePeers(peers, period), [peers, period])
  const groups = useMemo(() => groupPeers(scoredPeers), [scoredPeers])
  const top10 = scoredPeers.slice(0, 10)
  const scoreValues = scoredPeers.map((peer) => peer.activeScore)
  const coverageRate = peers.length ? Math.round((scoredPeers.length / peers.length) * 100) : 0
  const industryInfo = industries.find((item) => item.industry === industry)
  const selectedTop = scoredPeers[0]
  const industryAverageRadar = useMemo(() => {
    if (scoredPeers.length === 0) return []
    return [
      { subject: '成长', top: selectedTop?.dimensionPercentiles.growth ?? 0, average: Math.round(avg(scoredPeers.map((peer) => peer.dimensionPercentiles.growth))) },
      { subject: '盈利', top: selectedTop?.dimensionPercentiles.profitability ?? 0, average: Math.round(avg(scoredPeers.map((peer) => peer.dimensionPercentiles.profitability))) },
      { subject: '现金流', top: selectedTop?.dimensionPercentiles.cashflow ?? 0, average: Math.round(avg(scoredPeers.map((peer) => peer.dimensionPercentiles.cashflow))) },
      { subject: '安全', top: selectedTop?.dimensionPercentiles.safety ?? 0, average: Math.round(avg(scoredPeers.map((peer) => peer.dimensionPercentiles.safety))) },
      { subject: '效率', top: selectedTop?.dimensionPercentiles.efficiency ?? 0, average: Math.round(avg(scoredPeers.map((peer) => peer.dimensionPercentiles.efficiency))) },
    ]
  }, [scoredPeers, selectedTop])

  const insightText = useMemo(() => {
    if (scoredPeers.length === 0) return '当前行业本地财务数据不足，暂无法形成行业洞察。'
    const riskCount = scoredPeers.filter((peer) => peer.result.riskLevel !== '低').length
    const leader = scoredPeers[0]
    const cashLeader = [...scoredPeers].sort((a, b) => (b.latestPoint?.cashflow ?? 0) - (a.latestPoint?.cashflow ?? 0))[0]
    const growthLeader = [...scoredPeers].sort((a, b) => (b.latestPoint?.growth ?? 0) - (a.latestPoint?.growth ?? 0))[0]
    return `${industry}行业可评分公司${scoredPeers.length}家，当前采用${SCORE_MODE_LABELS[scoreMode]}，榜单均值${avg(scoreValues).toFixed(1)}，中位数${median(scoreValues).toFixed(1)}。当前领先的是${leader.name}，成长领先样本是${growthLeader.name}，现金流领先样本是${cashLeader.name}；风险等级非低的公司${riskCount}家，行业内部存在分化。${cycleContext.isCyclical ? `本行业识别为周期行业，周期位置为${cycleContext.cyclePosition}。` : ''}`
  }, [cycleContext.cyclePosition, cycleContext.isCyclical, industry, scoreMode, scoredPeers, scoreValues])


  const handleRefreshPeers = () => {
    if (!industry) return
    setReloadSeq((value) => value + 1)
  }

  const handleLocateStockIndustry = async (stock: StockSearchResult) => {
    setLocatingStock(true)
    setError('')
    setShowStockSearchResults(false)
    suppressNextStockSearchRef.current = true
    setStockSearchQuery(`${stock.symbol} ${stock.name}`)
    try {
      const profile = await getStockProfile(stock.symbol)
      const nextIndustry = profile.industry || ''
      if (!nextIndustry || nextIndustry === '未知') {
        setError(`${stock.name}(${stock.symbol}) 暂未识别到行业分类，请先下载或更新该股票基本信息。`)
        return
      }
      setIndustry(nextIndustry)
      setNotice(`已定位 ${stock.name}(${stock.symbol}) 所属行业：${nextIndustry}，正在加载同行对比。`)
      if (!industries.some((item) => item.industry === nextIndustry)) {
        setIndustries((items) => [{ industry: nextIndustry, count: 0, scorableCount: 0 }, ...items])
        setNotice(`已定位 ${stock.name}(${stock.symbol}) 所属行业：${nextIndustry}。当前快照中该行业样本可能不足，可点击“重建快照”刷新本地行业列表。`)
      }
    } catch (err) {
      setError(`定位股票行业失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setLocatingStock(false)
    }
  }

  const handleStockSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && stockSearchResults.length > 0) {
      handleLocateStockIndustry(stockSearchResults[0])
    }
  }

  const handleRebuildSnapshot = async () => {
    setRebuildingSnapshot(true)
    setError('')
    setNotice('正在重建本地行业快照，会重新扫描已下载股票的行业分类。')
    try {
      const res = await rebuildIndustrySnapshot()
      setIndustries(res.items)
      setSnapshotUpdatedAt(res.updatedAt || '')
      setNotice(`本地行业快照已更新${res.updatedAt ? `：${res.updatedAt}` : ''}，下次打开会直接读取快照。`)
      if (res.items.length > 0 && !res.items.some((item) => item.industry === industry)) {
        setIndustry(res.items[0].industry)
      }
      setReloadSeq((value) => value + 1)
    } catch (err) {
      setError(`重建行业快照失败：${err instanceof Error ? err.message : '未知错误'}。如果返回 404，请重启后端服务后再试。`)
    } finally {
      setRebuildingSnapshot(false)
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-[1800px] mx-auto flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          <BarChart3 className="w-4 h-4" />
          行业横向选股系统
        </div>
        <h1 className="font-h1 text-2xl md:text-3xl" style={{ color: 'var(--text-primary)' }}>行业对比</h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>选择行业后，系统会复用单股规则引擎，计算同行综合评分、行业分位分、风险等级、投资类型和行业洞察。</p>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.3fr_0.65fr_0.65fr_1fr_auto_auto] xl:items-end">
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>行业</span>
            <select
              value={industry}
              onChange={(event) => setIndustry(event.target.value)}
              className="rounded-lg border border-border-subtle px-3 py-2 outline-none"
              style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
            >
              {loadingIndustries && <option>加载中...</option>}
              {industries.map((item) => (
                <option key={item.industry} value={item.industry}>{item.industry}（{item.scorableCount}/{item.count}）</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>数据口径</span>
            <select
              value={period}
              onChange={(event) => setPeriod(event.target.value as PeriodMode)}
              className="rounded-lg border border-border-subtle px-3 py-2 outline-none"
              style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
            >
              <option value="annual">年度</option>
              <option value="quarter">季度</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>评分视角</span>
            <select
              value={scoreMode}
              onChange={(event) => setScoreMode(event.target.value as ScoreMode)}
              className="rounded-lg border border-border-subtle px-3 py-2 outline-none"
              style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
            >
              <option value="composite">综合榜</option>
              <option value="quality">长期质量榜</option>
              <option value="cycle">周期弹性榜</option>
              <option value="opportunity">投资机会榜</option>
            </select>
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2" style={{ backgroundColor: 'var(--bg-base)' }}>
            <input type="checkbox" checked={showUnscorable} onChange={(event) => setShowUnscorable(event.target.checked)} />
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>显示不可评分</span>
          </label>
          <label className="relative flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>按股票定位行业</span>
            <div className="flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2" style={{ backgroundColor: 'var(--bg-base)' }}>
              {locatingStock ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent-primary)' }} /> : <Search className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
              <input
                value={stockSearchQuery}
                onChange={(event) => setStockSearchQuery(event.target.value)}
                onFocus={() => stockSearchResults.length > 0 && setShowStockSearchResults(true)}
                onKeyDown={handleStockSearchKeyDown}
                placeholder="输入代码 / 名称，自动切到所属行业"
                className="w-full bg-transparent text-sm outline-none"
                style={{ color: 'var(--text-primary)' }}
              />
              {stockSearchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    suppressNextStockSearchRef.current = false
                    setStockSearchQuery('')
                    setStockSearchResults([])
                    setShowStockSearchResults(false)
                  }}
                  aria-label="清空股票搜索"
                >
                  <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                </button>
              )}
            </div>
            {showStockSearchResults && stockSearchResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border-subtle shadow-xl" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                {stockSearchResults.map((stock) => (
                  <button
                    key={stock.symbol}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault()
                      handleLocateStockIndustry(stock)
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-bg-surface-hover"
                  >
                    <span className="font-data-sm" style={{ color: 'var(--text-primary)' }}>{stock.symbol}</span>
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{stock.name}</span>
                    <span className="ml-auto rounded px-1.5 py-0.5 text-[11px]" style={{ backgroundColor: 'var(--accent-primary)26', color: 'var(--accent-primary)' }}>{stock.market}</span>
                  </button>
                ))}
              </div>
            )}
          </label>
          <button
            onClick={handleRefreshPeers}
            disabled={!industry || loadingPeers}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent-primary)' }}
          >
            刷新
          </button>
          <button
            onClick={handleRebuildSnapshot}
            disabled={rebuildingSnapshot || loadingIndustries}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-subtle px-4 py-2 text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
            title="重新扫描本地已下载股票，保存行业分类快照"
          >
            {rebuildingSnapshot ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            重建快照
          </button>
        </div>
      </Card>

      {(notice || snapshotUpdatedAt) && (
        <Card className="p-3 text-xs">
          <span style={{ color: 'var(--text-secondary)' }}>
            {notice || `本地行业快照：${snapshotUpdatedAt}`}；行业快照会保存到后端本地文件，下次打开优先读取，不会重复推导。
          </span>
        </Card>
      )}

      {error && (
        <Card className="p-4 text-sm">
          <span style={{ color: 'var(--danger)' }}>{error}</span>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Metric label="行业公司" value={`${industryInfo?.count ?? peers.length}`} hint="本地已下载" />
        <Metric label="已加载样本" value={`${peers.length}`} hint="当前接口返回" />
        <Metric label="可评分公司" value={`${scoredPeers.length}`} hint={period === 'annual' ? '年度口径' : '季度口径'} />
        <Metric label="不可评分" value={`${unscorablePeers.length}`} hint="见下方原因" tone="var(--warning)" />
        <Metric label="评分覆盖率" value={peers.length ? `${coverageRate}%` : '—'} hint="可评分/已加载" />
        <Metric label="行业均分" value={scoreValues.length ? avg(scoreValues).toFixed(1) : '—'} />
        <Metric label="最高分" value={selectedTop ? String(selectedTop.activeScore) : '—'} hint={selectedTop ? `${selectedTop.name} · ${selectedTop.activeScoreLabel}` : undefined} tone="var(--up-red)" />
        <Metric label="风险公司" value={`${scoredPeers.filter((peer) => peer.result.riskLevel !== '低').length}`} hint="中/高风险" tone="var(--warning)" />
      </div>

      <Card className="p-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-h3 text-lg" style={{ color: 'var(--text-primary)' }}>{cycleContext.isCyclical ? '周期位置' : '行业机会模型'}</h2>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{cycleContext.modelNote}</p>
              </div>
              <span className="rounded px-2 py-1 text-xs" style={{ color: 'var(--accent-primary)', backgroundColor: 'rgba(59,130,246,0.12)' }}>{cycleContext.industryType}</span>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <Metric label={cycleContext.isCyclical ? '周期位置' : '模型定位'} value={cycleContext.cyclePosition} hint={cycleContext.interpretation} />
              <Metric label="价格分位" value={cycleContext.avgPricePercentile != null ? `${cycleContext.avgPricePercentile}%` : '不适用'} hint={cycleContext.isCyclical ? '近5年分位' : '非周期不使用商品价格'} />
              <Metric label={cycleContext.isCyclical ? '库存周期' : '时机判断'} value={cycleContext.inventorySummary} hint={cycleContext.avgTrend3m != null ? `3个月趋势 ${cycleContext.avgTrend3m > 0 ? '+' : ''}${cycleContext.avgTrend3m}%` : cycleContext.isCyclical ? '—' : '看业绩兑现/现金流/安全性'} />
              <Metric label="机会权重" value={opportunityWeightText(cycleContext)} hint={cycleContext.isCyclical ? `周期机会分 ${cycleContext.opportunityScore}` : '非周期独立权重'} />
            </div>
            {cycleContext.commodities.length > 0 && (
              <div className="flex flex-wrap gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                {cycleContext.commodities.map((item) => (
                  <span key={item.name} className="rounded-full border border-border-subtle px-3 py-1" style={{ backgroundColor: 'var(--bg-base)' }}>
                    {item.name}：{item.pricePercentile5y}% / {item.cyclePosition}
                  </span>
                ))}
              </div>
            )}
          </div>
        </Card>

      <div className="flex items-center gap-2 border-b border-border-subtle">
        {[
          { key: 'ranking', label: '评分榜' },
          { key: 'insight', label: '行业洞察' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as ActiveTab)}
            className="relative px-4 py-2.5 text-sm font-medium"
            style={{ color: activeTab === tab.key ? 'var(--accent-primary)' : 'var(--text-secondary)' }}
          >
            {tab.label}
            {activeTab === tab.key && <span className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ backgroundColor: 'var(--accent-primary)' }} />}
          </button>
        ))}
        {loadingPeers && <Loader2 className="ml-auto w-4 h-4 animate-spin" style={{ color: 'var(--accent-primary)' }} />}
      </div>

      {activeTab === 'ranking' ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-h3 text-lg" style={{ color: 'var(--text-primary)' }}>Top 10 {SCORE_MODE_LABELS[scoreMode]}</h2>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>当前榜单分会随“评分视角”切换；投资机会榜采用10分制后换算展示，综合考虑基本面、周期/时机、估值和风险。</p>
                </div>
                <Trophy className="w-5 h-5" style={{ color: 'var(--warning)' }} />
              </div>
              <div className="h-[360px]">
                {top10.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>暂无可评分数据</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={top10.map((peer) => ({ ...peer, label: peer.name || peer.symbol }))} margin={chartMargin}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} interval={0} angle={-18} height={54} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} domain={[0, 100]} />
                      <Tooltip contentStyle={tooltipStyle()} />
                      <Bar dataKey="activeScore" name={SCORE_MODE_LABELS[scoreMode]} radius={[4, 4, 0, 0]} onClick={(row) => navigate(`/stock/${row.symbol}`)}>
                        {top10.map((peer, index) => <Cell key={peer.symbol} fill={COLORS[index % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            <Card className="p-4">
              <h2 className="font-h3 text-lg mb-1" style={{ color: 'var(--text-primary)' }}>行业第一 vs 行业平均</h2>
              <p className="mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>用行业百分位展示维度差异</p>
              <div className="h-[360px]">
                {industryAverageRadar.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>暂无雷达数据</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={industryAverageRadar} outerRadius="72%">
                      <PolarGrid stroke="var(--chart-grid)" />
                      <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                      <PolarRadiusAxis domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                      <Radar dataKey="top" name={selectedTop?.name || '第一名'} stroke="var(--accent-primary)" fill="var(--accent-primary)" fillOpacity={0.25} />
                      <Radar dataKey="average" name="行业平均" stroke="var(--warning)" fill="var(--warning)" fillOpacity={0.16} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Tooltip contentStyle={tooltipStyle()} />
                    </RadarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="border-b border-border-subtle px-4 py-3">
              <h2 className="font-h3 text-lg" style={{ color: 'var(--text-primary)' }}>同行评分表</h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>榜单会随评分视角切换；投资机会分为10分制。当前行业权重：{opportunityWeightText(cycleContext)}；周期行业看商品位置，成长/稳定/通用行业使用各自非周期模型。</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1800px] text-left">
                <thead style={{ backgroundColor: 'var(--bg-surface-hover)' }}>
                  <tr>
                    {['排名', '股票', SCORE_MODE_LABELS[scoreMode], '机会分', '机会区间', '估值', '长期质量', '周期弹性', '行业分位分', '行业位置', '公司类型', '周期位置', '周期风险', '风险', '成长', '盈利', '现金流', '安全', '效率', '核心判断', '评分说明', '操作'].map((item) => (
                      <th key={item} className="px-4 py-3 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{item}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {scoredPeers.map((peer) => {
                    const position = industryPosition(peer.relativeScore)
                    return (
                      <tr key={peer.symbol} className="border-b border-border-subtle hover:bg-bg-surface-hover transition-colors">
                        <td className="px-4 py-3 font-data-sm" style={{ color: peer.rank <= 3 ? 'var(--warning)' : 'var(--text-primary)' }}>#{peer.rank}</td>
                        <td className="px-4 py-3">
                          <button onClick={() => navigate(`/stock/${peer.symbol}`)} className="text-left">
                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{peer.name || peer.symbol}</div>
                            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{peer.symbol} · {formatMoney(peer.profile.marketCap)}</div>
                          </button>
                        </td>
                        <td className="px-4 py-3 font-data-sm" style={{ color: 'var(--accent-primary)' }}>{peer.activeScore}</td>
                        <td className="px-4 py-3 font-data-sm">{peer.investmentOpportunityScore}/10</td>
                        <td className="px-4 py-3">
                          <span className="rounded px-2 py-0.5 text-xs" style={{ color: opportunityTone(peer.opportunityZone).color, backgroundColor: opportunityTone(peer.opportunityZone).bg }}>{peer.opportunityZone}</span>
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{peer.valuationSummary}</td>
                        <td className="px-4 py-3 font-data-sm">{peer.longTermQualityScore}</td>
                        <td className="px-4 py-3 font-data-sm">{peer.cycleElasticityScore}</td>
                        <td className="px-4 py-3">
                          <div className="font-data-sm" style={{ color: 'var(--text-primary)' }}>{peer.relativeScore}%</div>
                          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>分位排名 #{peer.relativeRank}/{scoredPeers.length}</div>
                        </td>
                        <td className="px-4 py-3"><span className="rounded px-2 py-0.5 text-xs" style={{ color: position.tone, backgroundColor: position.bg }}>{position.label}</span></td>
                        <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{peer.companyType}</td>
                        <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{peer.cycleJudgement}</td>
                        <td className="px-4 py-3 text-xs">
                          <span className="rounded px-2 py-0.5 text-xs" style={{ color: peer.cycleRiskLevel === '高' ? 'var(--up-red)' : peer.cycleRiskLevel === '中' ? 'var(--warning)' : 'var(--accent-primary)', backgroundColor: peer.cycleRiskLevel === '高' ? 'rgba(239,68,68,0.12)' : peer.cycleRiskLevel === '中' ? 'rgba(245,158,11,0.12)' : 'rgba(59,130,246,0.12)' }}>{peer.cycleRiskLevel}</span>
                        </td>
                        <td className="px-4 py-3"><span className="rounded px-2 py-0.5 text-xs" style={{ color: riskColor(peer.result.riskLevel), backgroundColor: `${riskColor(peer.result.riskLevel)}1f` }}>{peer.result.riskLevel}</span></td>
                        <td className="px-4 py-3 font-data-sm">{peer.latestPoint?.growth ?? '—'}</td>
                        <td className="px-4 py-3 font-data-sm">{peer.latestPoint?.profitability ?? '—'}</td>
                        <td className="px-4 py-3 font-data-sm">{peer.latestPoint?.cashflow ?? '—'}</td>
                        <td className="px-4 py-3 font-data-sm">{peer.latestPoint?.safety ?? '—'}</td>
                        <td className="px-4 py-3 font-data-sm">{peer.latestPoint?.efficiency ?? '—'}</td>
                        <td className="px-4 py-3 text-xs max-w-[320px]" style={{ color: 'var(--text-secondary)' }}>{peer.result.conclusion}</td>
                        <td className="px-4 py-3 text-xs min-w-[280px]" style={{ color: 'var(--text-secondary)' }}>
                          <details>
                            <summary className="cursor-pointer" style={{ color: 'var(--accent-primary)' }}>查看公式</summary>
                            <div className="mt-2 flex flex-col gap-1 leading-relaxed">
                              <span>{peer.activeScoreLabel} = {peer.activeScore}</span>
                              <span>投资机会 = {peer.investmentOpportunityScore}/10（基本面{peer.fundamentalScore10}、时机{peer.timingScore10}、估值{peer.valuationScore10}、风险控制{peer.riskControlScore10}）</span>
                              <span>{peer.opportunityConclusion}</span>
                              <span>综合分 = {peer.absoluteScore} × 60% + {peer.relativeScore} × 40% = {peer.industryScore}</span>
                              <span>长期质量 = 绝对分、分位、稳定性、现金流质量、周期惩罚综合</span>
                              <span>周期弹性 = 周期暴露、利润波动、增长分位、周期机会综合</span>
                              <span>行业分位 = 平均(绝对{peer.absolutePercentile}、成长{peer.dimensionPercentiles.growth}、盈利{peer.dimensionPercentiles.profitability}、现金流{peer.dimensionPercentiles.cashflow}、安全{peer.dimensionPercentiles.safety}、效率{peer.dimensionPercentiles.efficiency})</span>
                              <span>样本：{peer.periodsCount}期{period === 'annual' ? '年度' : '季度'}财务数据</span>
                            </div>
                          </details>
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => navigate(`/stock/${peer.symbol}`)} className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--accent-primary)' }}>查看单股 <ChevronRight className="w-3 h-3" /></button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {showUnscorable && (
            <Card className="overflow-hidden">
              <div className="border-b border-border-subtle px-4 py-3">
                <h2 className="font-h3 text-lg" style={{ color: 'var(--text-primary)' }}>不可评分公司</h2>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>这些公司属于当前行业样本，但未纳入评分榜；主要原因是行业分类或当前口径财务期间数据不足。</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] text-left">
                  <thead style={{ backgroundColor: 'var(--bg-surface-hover)' }}>
                    <tr>
                      {['股票', '不可评分原因', '当前数据', '建议操作', '操作'].map((item) => (
                        <th key={item} className="px-4 py-3 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{item}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {unscorablePeers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>当前加载样本都满足评分条件。</td>
                      </tr>
                    ) : (
                      unscorablePeers.slice(0, 120).map((peer) => (
                        <tr key={peer.symbol} className="border-b border-border-subtle hover:bg-bg-surface-hover transition-colors">
                          <td className="px-4 py-3">
                            <button onClick={() => navigate(`/stock/${peer.symbol}`)} className="text-left">
                              <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{peer.name || peer.symbol}</div>
                              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{peer.symbol} · {peer.industry}</div>
                            </button>
                          </td>
                          <td className="px-4 py-3 text-sm" style={{ color: 'var(--warning)' }}>{peer.reason}</td>
                          <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{period === 'annual' ? '年度' : '季度'}财务期数：{peer.periodsCount}</td>
                          <td className="px-4 py-3 text-xs max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>{peer.actionHint}</td>
                          <td className="px-4 py-3">
                            <button onClick={() => navigate(`/stock/${peer.symbol}`)} className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--accent-primary)' }}>查看单股 <ChevronRight className="w-3 h-3" /></button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {unscorablePeers.length > 120 && <div className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>仅展示前 120 家不可评分公司，共 {unscorablePeers.length} 家。</div>}
            </Card>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <Brain className="mt-0.5 w-5 h-5" style={{ color: 'var(--accent-secondary)' }} />
              <div>
                <h2 className="font-h3 text-lg" style={{ color: 'var(--text-primary)' }}>行业洞察</h2>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{insightText}</p>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {[
              { title: '行业龙头型', desc: '综合分靠前、风险不高，适合观察行业核心资产。', items: groups.leaders, icon: Trophy },
              { title: '成长弹性型', desc: '成长维度领先，但仍需复核现金流和安全性。', items: groups.growers, icon: BarChart3 },
              { title: '现金牛型', desc: '现金流维度较强，适合观察利润含金量。', items: groups.cashCows, icon: Users },
              { title: '修复型', desc: '规则识别为修复或改善阶段，适合跟踪变化。', items: groups.repair, icon: Brain },
              { title: '风险型', desc: '风险等级非低或风险原因较多，需要优先排查。', items: groups.risks, icon: ShieldAlert },
            ].map((group) => {
              const Icon = group.icon
              return (
                <Card key={group.title} className="p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-h3 text-base" style={{ color: 'var(--text-primary)' }}>{group.title}</h3>
                      <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{group.desc}</p>
                    </div>
                    <Icon className="w-5 h-5" style={{ color: group.title === '风险型' ? 'var(--warning)' : 'var(--accent-primary)' }} />
                  </div>
                  {group.items.length === 0 ? (
                    <div className="py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>暂无匹配公司</div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {group.items.map((peer) => (
                        <button key={peer.symbol} onClick={() => navigate(`/stock/${peer.symbol}`)} className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle px-3 py-2 text-left hover:bg-bg-surface-hover">
                          <div>
                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{peer.name} <span className="font-data-sm" style={{ color: 'var(--text-muted)' }}>{peer.symbol}</span></div>
                            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{peer.result.conclusion}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-data-sm" style={{ color: 'var(--accent-primary)' }}>{peer.activeScore}</div>
                            <div className="text-xs" style={{ color: riskColor(peer.result.riskLevel) }}>{peer.result.riskLevel}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </Card>
              )
            })}
          </div>

          <Card className="p-4">
            <h3 className="font-h3 text-base mb-3" style={{ color: 'var(--text-primary)' }}>综合分趋势分布</h3>
            <div className="h-[320px]">
              {scoredPeers.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>暂无趋势分布</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={scoredPeers.slice(0, 20).map((peer) => ({ name: peer.name, score: peer.activeScore, absolute: peer.industryScore, relative: peer.relativeScore }))} margin={chartMargin}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} interval={0} angle={-18} height={54} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} domain={[0, 100]} />
                    <Tooltip contentStyle={tooltipStyle()} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="score" name="行业综合分" stroke="var(--accent-primary)" strokeWidth={2} dot />
                    <Line type="monotone" dataKey="absolute" name="周期修正综合分" stroke="var(--accent-secondary)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="relative" name="行业分位分" stroke="var(--warning)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

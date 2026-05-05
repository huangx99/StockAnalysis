import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BarChart3, Brain, ChevronRight, Loader2, RefreshCw, Search, ShieldAlert, Trophy, Users } from 'lucide-react'
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
import { getDataStocks, getFinancialPeriods, getIndustryCompare, getIndustryList, getStockProfile, rebuildIndustrySnapshot } from '@/api/real/stockApi'
import type { FinancialScorePoint } from '@/components/stock/financialInsightEngine'
import { analyzeFinancialInsights, type FinancialInsightResult } from '@/components/stock/financialInsightEngine'
import type { IndustryPeerData, IndustryPeerProfile, IndustrySummaryItem, StockDataSummary } from '@/types'

type PeriodMode = 'annual' | 'quarter'
type ActiveTab = 'ranking' | 'insight'

type PeerScore = {
  symbol: string
  name: string
  industry: string
  profile: IndustryPeerData['profile']
  periodsCount: number
  result: FinancialInsightResult
  latestPoint: FinancialScorePoint | null
  absoluteScore: number
  relativeScore: number
  industryScore: number
  rank: number
  relativeRank: number
  dimensionPercentiles: {
    growth: number
    profitability: number
    cashflow: number
    safety: number
    efficiency: number
  }
}

const chartMargin = { top: 12, right: 18, bottom: 8, left: 0 }
const COLORS = ['var(--accent-primary)', 'var(--accent-secondary)', 'var(--up-red)', 'var(--warning)', 'var(--chart-ma20)']

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

function buildPeerScores(peers: IndustryPeerData[]): PeerScore[] {
  const base = peers
    .filter((peer) => peer.periods.length > 0)
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

  const scored = base.map((item) => {
    const dimensionPercentiles = {
      growth: percentile(item.latestPoint?.growth ?? 0, growthValues),
      profitability: percentile(item.latestPoint?.profitability ?? 0, profitabilityValues),
      cashflow: percentile(item.latestPoint?.cashflow ?? 0, cashflowValues),
      safety: percentile(item.latestPoint?.safety ?? 0, safetyValues),
      efficiency: percentile(item.latestPoint?.efficiency ?? 0, efficiencyValues),
    }
    const relativeScore = Math.round(avg([
      percentile(item.absoluteScore, totals),
      dimensionPercentiles.growth,
      dimensionPercentiles.profitability,
      dimensionPercentiles.cashflow,
      dimensionPercentiles.safety,
      dimensionPercentiles.efficiency,
    ]))
    return {
      symbol: item.peer.symbol,
      name: item.peer.name,
      industry: item.peer.industry,
      profile: item.peer.profile,
      periodsCount: item.peer.periods.length,
      result: item.result,
      latestPoint: item.latestPoint,
      absoluteScore: item.absoluteScore,
      relativeScore,
      industryScore: Math.round(item.absoluteScore * 0.6 + relativeScore * 0.4),
      rank: 0,
      relativeRank: 0,
      dimensionPercentiles,
    }
  })

  const byIndustryScore = [...scored].sort((a, b) => b.industryScore - a.industryScore)
  const byRelative = [...scored].sort((a, b) => b.relativeScore - a.relativeScore)
  byIndustryScore.forEach((row, index) => { row.rank = index + 1 })
  byRelative.forEach((row, index) => { row.relativeRank = index + 1 })
  return byIndustryScore
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
  const [industries, setIndustries] = useState<IndustrySummaryItem[]>([])
  const [industry, setIndustry] = useState(params.get('industry') || '')
  const [period, setPeriod] = useState<PeriodMode>((params.get('period') as PeriodMode) || 'annual')
  const [query, setQuery] = useState('')
  const [completeOnly, setCompleteOnly] = useState(true)
  const [activeTab, setActiveTab] = useState<ActiveTab>('ranking')
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
    if (!industry) return
    setParams({ industry, period })
    let mounted = true
    setLoadingPeers(true)
    setError('')
    const timer = setTimeout(() => {
      getIndustryCompare({ industry, period, q: query, completeOnly, limit: 600 })
        .then((res) => {
          if (!mounted) return
          setPeers(res.items)
          if (res.updatedAt) setSnapshotUpdatedAt(res.updatedAt)
        })
        .catch(async (err) => {
          try {
            const fallbackItems = await buildIndustryCompareFromLocal({ industry, period, q: query, completeOnly, limit: 300 })
            if (!mounted) return
            setPeers(fallbackItems)
            setError('行业对比接口不可用，已使用本地 profile + 财务数据保底生成。')
          } catch {
            if (mounted) setError(err instanceof Error ? err.message : '行业对比加载失败')
          }
        })
        .finally(() => { if (mounted) setLoadingPeers(false) })
    }, query ? 250 : 0)
    return () => {
      mounted = false
      clearTimeout(timer)
    }
  }, [industry, period, query, completeOnly, reloadSeq, setParams])

  const scoredPeers = useMemo(() => buildPeerScores(peers), [peers])
  const groups = useMemo(() => groupPeers(scoredPeers), [scoredPeers])
  const top10 = scoredPeers.slice(0, 10)
  const scoreValues = scoredPeers.map((peer) => peer.industryScore)
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
    return `${industry}行业可评分公司${scoredPeers.length}家，行业综合分均值${avg(scoreValues).toFixed(1)}，中位数${median(scoreValues).toFixed(1)}。当前综合领先的是${leader.name}，成长领先样本是${growthLeader.name}，现金流领先样本是${cashLeader.name}；风险等级非低的公司${riskCount}家，行业内部存在分化。`
  }, [industry, scoredPeers, scoreValues])


  const handleRefreshPeers = () => {
    if (!industry) return
    setReloadSeq((value) => value + 1)
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
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>选择行业后，系统会复用单股规则引擎，计算同行综合评分、行业相对分、风险等级、投资类型和行业洞察。</p>
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
          <label className="flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2" style={{ backgroundColor: 'var(--bg-base)' }}>
            <input type="checkbox" checked={completeOnly} onChange={(event) => setCompleteOnly(event.target.checked)} />
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>仅可评分</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>搜索股票</span>
            <div className="flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2" style={{ backgroundColor: 'var(--bg-base)' }}>
              <Search className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="代码 / 名称"
                className="w-full bg-transparent text-sm outline-none"
                style={{ color: 'var(--text-primary)' }}
              />
            </div>
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="行业公司" value={`${industryInfo?.count ?? peers.length}`} hint="本地已下载" />
        <Metric label="可评分公司" value={`${scoredPeers.length}`} hint={period === 'annual' ? '年度口径' : '季度口径'} />
        <Metric label="行业均分" value={scoreValues.length ? avg(scoreValues).toFixed(1) : '—'} />
        <Metric label="行业中位数" value={scoreValues.length ? median(scoreValues).toFixed(1) : '—'} />
        <Metric label="最高分" value={selectedTop ? String(selectedTop.industryScore) : '—'} hint={selectedTop?.name} tone="var(--up-red)" />
        <Metric label="风险公司" value={`${scoredPeers.filter((peer) => peer.result.riskLevel !== '低').length}`} hint="中/高风险" tone="var(--warning)" />
      </div>

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
                  <h2 className="font-h3 text-lg" style={{ color: 'var(--text-primary)' }}>Top 10 综合行业评分</h2>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>行业评分 = 60% 绝对财务评分 + 40% 行业内相对分</p>
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
                      <Bar dataKey="industryScore" name="行业综合分" radius={[4, 4, 0, 0]} onClick={(row) => navigate(`/stock/${row.symbol}`)}>
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
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>点击股票可进入单股分析，所有结论来自本地规则引擎。</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] text-left">
                <thead style={{ backgroundColor: 'var(--bg-surface-hover)' }}>
                  <tr>
                    {['排名', '股票', '综合分', '相对分', '成长', '盈利', '现金流', '安全', '效率', '风险', '类型', '核心判断', '操作'].map((item) => (
                      <th key={item} className="px-4 py-3 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{item}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {scoredPeers.map((peer) => (
                    <tr key={peer.symbol} className="border-b border-border-subtle hover:bg-bg-surface-hover transition-colors">
                      <td className="px-4 py-3 font-data-sm" style={{ color: peer.rank <= 3 ? 'var(--warning)' : 'var(--text-primary)' }}>#{peer.rank}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => navigate(`/stock/${peer.symbol}`)} className="text-left">
                          <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{peer.name || peer.symbol}</div>
                          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{peer.symbol} · {formatMoney(peer.profile.marketCap)}</div>
                        </button>
                      </td>
                      <td className="px-4 py-3 font-data-sm" style={{ color: 'var(--accent-primary)' }}>{peer.industryScore}</td>
                      <td className="px-4 py-3 font-data-sm">{peer.relativeScore}</td>
                      <td className="px-4 py-3 font-data-sm">{peer.latestPoint?.growth ?? '—'}</td>
                      <td className="px-4 py-3 font-data-sm">{peer.latestPoint?.profitability ?? '—'}</td>
                      <td className="px-4 py-3 font-data-sm">{peer.latestPoint?.cashflow ?? '—'}</td>
                      <td className="px-4 py-3 font-data-sm">{peer.latestPoint?.safety ?? '—'}</td>
                      <td className="px-4 py-3 font-data-sm">{peer.latestPoint?.efficiency ?? '—'}</td>
                      <td className="px-4 py-3"><span className="rounded px-2 py-0.5 text-xs" style={{ color: riskColor(peer.result.riskLevel), backgroundColor: `${riskColor(peer.result.riskLevel)}1f` }}>{peer.result.riskLevel}</span></td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{peer.result.investmentType}</td>
                      <td className="px-4 py-3 text-xs max-w-[320px]" style={{ color: 'var(--text-secondary)' }}>{peer.result.conclusion}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => navigate(`/stock/${peer.symbol}`)} className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--accent-primary)' }}>查看单股 <ChevronRight className="w-3 h-3" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
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
                            <div className="font-data-sm" style={{ color: 'var(--accent-primary)' }}>{peer.industryScore}</div>
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
                  <LineChart data={scoredPeers.slice(0, 20).map((peer) => ({ name: peer.name, score: peer.industryScore, absolute: peer.absoluteScore, relative: peer.relativeScore }))} margin={chartMargin}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} interval={0} angle={-18} height={54} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} domain={[0, 100]} />
                    <Tooltip contentStyle={tooltipStyle()} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="score" name="行业综合分" stroke="var(--accent-primary)" strokeWidth={2} dot />
                    <Line type="monotone" dataKey="absolute" name="绝对评分" stroke="var(--accent-secondary)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="relative" name="相对评分" stroke="var(--warning)" strokeWidth={2} dot={false} />
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

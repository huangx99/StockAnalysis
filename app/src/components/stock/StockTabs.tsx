import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight, RotateCw, Search, Calendar } from 'lucide-react'
import type { KLineData, FinancialStatement, FinancialSummary, FinancialPeriodMetrics, DividendRecord, StockDocument, MarketStats, TechnicalIndicators, NewsAnalysis } from '@/types'
import FinancialTable from '@/components/financial/FinancialTable'
import DividendTable from '@/components/financial/DividendTable'
import NewsTimeline from '@/components/news/NewsTimeline'
import { refreshNews } from '@/api/real/stockApi'
import { FinancialChartWorkspace, MarketChartWorkspace, NewsChartWorkspace } from '@/components/stock/StockChartWorkspace'

interface StockTabsProps {
  symbol: string
  klineData: KLineData[]
  financials: FinancialStatement[]
  financialPeriods: FinancialPeriodMetrics[]
  financialSummary: FinancialSummary | null
  dividends: DividendRecord[]
  news: StockDocument[]
  marketStats: MarketStats | null
  technicalIndicators: TechnicalIndicators | null
  loading: {
    market: boolean
    financials: boolean
    news: boolean
    stats: boolean
  }
}

const tabs = [
  { key: 'market', label: '行情分析' },
  { key: 'financial', label: '财务分析' },
  { key: 'news', label: '公告新闻' },
]

function MarketAnalysisTab({ klineData, stats, indicators, loading }: { klineData: KLineData[]; stats: MarketStats | null; indicators: TechnicalIndicators | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-5 h-5 border-2 border-border-subtle border-t-accent-primary rounded-full animate-spin-slow" />
      </div>
    )
  }

  return <MarketChartWorkspace klineData={klineData} stats={stats} indicators={indicators} />
}

function formatMoney(value: number): string {
  if (!value || Number.isNaN(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 100000000) return `${(value / 100000000).toFixed(1)}亿`
  if (abs >= 10000) return `${(value / 10000).toFixed(0)}万`
  return value.toFixed(0)
}

function formatPct(value: number): string {
  if (value == null || Number.isNaN(value)) return '—'
  return `${value.toFixed(1)}%`
}

function PeriodMetricsTable({ data }: { data: FinancialPeriodMetrics[] }) {
  if (data.length === 0) return <div className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>暂无分期财务数据</div>
  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        共 {data.length} 期，范围 {data[data.length - 1]?.reportDate} 至 {data[0]?.reportDate}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border-subtle">
        <table className="w-full text-left min-w-[980px]">
        <thead>
          <tr style={{ backgroundColor: 'var(--bg-surface-hover)' }}>
            {['报告期', '营收', '营收YoY', '归母净利', '净利YoY', '毛利率', 'ROE', 'CFO', 'FCF', '资产负债率'].map((item) => (
              <th key={item} className="font-label px-4 py-3 text-right first:text-left" style={{ color: 'var(--text-secondary)' }}>{item}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.reportDate} className="border-b border-border-subtle hover:bg-bg-surface-hover transition-colors">
              <td className="font-data-sm px-4 py-3" style={{ color: 'var(--text-primary)' }}>{row.reportDate} {row.reportQuarter}</td>
              <td className="font-data-sm px-4 py-3 text-right">{formatMoney(row.revenue)}</td>
              <td className="font-data-sm px-4 py-3 text-right" style={{ color: row.revenueYoY >= 0 ? 'var(--up-red)' : 'var(--down-green)' }}>{formatPct(row.revenueYoY)}</td>
              <td className="font-data-sm px-4 py-3 text-right">{formatMoney(row.netProfit)}</td>
              <td className="font-data-sm px-4 py-3 text-right" style={{ color: row.netProfitYoY >= 0 ? 'var(--up-red)' : 'var(--down-green)' }}>{formatPct(row.netProfitYoY)}</td>
              <td className="font-data-sm px-4 py-3 text-right">{formatPct(row.grossMargin)}</td>
              <td className="font-data-sm px-4 py-3 text-right">{formatPct(row.roe)}</td>
              <td className="font-data-sm px-4 py-3 text-right">{formatMoney(row.operatingCashFlow)}</td>
              <td className="font-data-sm px-4 py-3 text-right">{formatMoney(row.freeCashFlow)}</td>
              <td className="font-data-sm px-4 py-3 text-right">{formatPct(row.debtAssetRatio)}</td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  )
}

function RawDetails({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="rounded-xl border border-border-subtle" style={{ backgroundColor: 'var(--bg-base)' }}>
      <summary className="cursor-pointer px-4 py-3 font-h3 text-sm" style={{ color: 'var(--text-primary)' }}>
        {title}
      </summary>
      <div className="border-t border-border-subtle p-4">
        {children}
      </div>
    </details>
  )
}

function FinancialAnalysisTab({ data, periods, summary, dividends, loading }: { data: FinancialStatement[]; periods: FinancialPeriodMetrics[]; summary: FinancialSummary | null; dividends: DividendRecord[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-5 h-5 border-2 border-border-subtle border-t-accent-primary rounded-full animate-spin-slow" />
      </div>
    )
  }

  const periodRows = periods.length > 0 ? periods : summary?.quarterly ?? []

  return (
    <div className="flex flex-col gap-8">
      <FinancialChartWorkspace data={data} periods={periodRows} summary={summary} dividends={dividends} />

      <section className="flex flex-col gap-3">
        <div>
          <h3 className="font-h3 text-lg" style={{ color: 'var(--text-primary)' }}>原始数据表格</h3>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>图表用于分析，表格保留在最下方用于核对具体数值。</p>
        </div>
        <RawDetails title="年度财务指标明细">
          <FinancialTable data={data} />
        </RawDetails>
        <RawDetails title="分期财务指标明细">
          <PeriodMetricsTable data={periodRows} />
        </RawDetails>
        <RawDetails title="分红配送明细">
          <DividendTable data={dividends} />
        </RawDetails>
      </section>
    </div>
  )
}

function NewsTab({ docs, loading, symbol, savedAnalysisMap, onAnalysisDone }: {
  docs: StockDocument[]
  loading: boolean
  symbol: string
  savedAnalysisMap: Record<string, NewsAnalysis>
  onAnalysisDone: (docId: string, analysis: NewsAnalysis) => void
}) {
  const PAGE_SIZE = 20
  const [docFilter, setDocFilter] = useState('全部')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [activePreset, setActivePreset] = useState('')
  const listTopRef = useRef<HTMLDivElement>(null)

  // Initialize date pickers from data bounds
  useEffect(() => {
    if (docs.length > 0) {
      const dates = docs.map(d => d.publishTime.split(' ')[0]).filter(Boolean).sort()
      if (dates.length > 0) {
        setEndDate(dates[dates.length - 1])
        // Default to last 90 days
        const d = new Date(dates[dates.length - 1])
        d.setDate(d.getDate() - 90)
        const ninetyDaysAgo = d.toISOString().split('T')[0]
        setStartDate(ninetyDaysAgo < dates[0] ? dates[0] : ninetyDaysAgo)
        setActivePreset('近90日')
      }
    }
  }, [docs])

  const sortedDocs = useMemo(() => {
    // Defensive sort: newest first (backend should already sort, but ensure it)
    return [...docs].sort((a, b) => b.publishTime.localeCompare(a.publishTime))
  }, [docs])

  const filtered = useMemo(() => {
    let result = sortedDocs

    if (docFilter !== '全部') {
      const typeMap: Record<string, string> = { '公告': 'announcement', '新闻': 'news', '研报': 'report' }
      result = result.filter(d => d.type === typeMap[docFilter])
    }

    // Date range filter (uses startDate/endDate only)
    if (startDate && endDate) {
      result = result.filter(doc => {
        const docDate = doc.publishTime.split(' ')[0]
        return docDate >= startDate && docDate <= endDate
      })
    } else if (startDate) {
      result = result.filter(doc => {
        const docDate = doc.publishTime.split(' ')[0]
        return docDate >= startDate
      })
    } else if (endDate) {
      result = result.filter(doc => {
        const docDate = doc.publishTime.split(' ')[0]
        return docDate <= endDate
      })
    }

    // Text search
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(d =>
        d.title.toLowerCase().includes(q) ||
        d.summary.toLowerCase().includes(q)
      )
    }

    return result
  }, [sortedDocs, docFilter, startDate, endDate, search])

  // Reset page when filters/search change
  useEffect(() => {
    setPage(1)
  }, [docFilter, startDate, endDate, search])

  // Scroll to top on page change
  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage)
    listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const countLabel = filtered.length !== docs.length ? ` (${filtered.length}/${docs.length})` : ` (${docs.length})`

  const toDateStr = (d: Date) => d.toISOString().split('T')[0]

  const applyPreset = (days: number, label: string) => {
    const dates = docs.map(d => d.publishTime.split(' ')[0]).filter(Boolean).sort()
    if (dates.length === 0) return
    const lastDate = dates[dates.length - 1]
    const firstDate = dates[0]
    const d = new Date(lastDate)
    d.setDate(d.getDate() - days)
    const start = toDateStr(d)
    setStartDate(start < firstDate ? firstDate : start)
    setEndDate(lastDate)
    setActivePreset(label)
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    setRefreshMsg('')
    try {
      const res = await refreshNews(symbol)
      const newCount = res.new_count ?? 0
      setRefreshMsg(newCount > 0 ? `新增 ${newCount} 条` : '已是最新')
    } catch {
      setRefreshMsg('更新失败')
    } finally {
      setRefreshing(false)
      setTimeout(() => setRefreshMsg(''), 3000)
    }
  }

  const handleClearDate = () => {
    setStartDate('')
    setEndDate('')
    setActivePreset('')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-5 h-5 border-2 border-border-subtle border-t-accent-primary rounded-full animate-spin-slow" />
      </div>
    )
  }

  return (
    <div className="py-2">
      <NewsChartWorkspace docs={docs} />

      {/* 原始资讯列表与筛选 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-4">
        <div className="flex items-center gap-1">
          {['全部', '公告', '新闻', '研报'].map((f) => (
            <button
              key={f}
              onClick={() => setDocFilter(f)}
              className="px-2.5 py-1 rounded-md text-xs sm:text-sm font-medium transition-all"
              style={{
                backgroundColor: docFilter === f ? 'var(--accent-primary)' : 'transparent',
                color: docFilter === f ? '#fff' : 'var(--text-secondary)',
              }}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Search input */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-border-subtle" style={{ backgroundColor: 'var(--bg-base)' }}>
          <Search className="w-3 h-3 shrink-0" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="搜索新闻..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-xs outline-none w-24 sm:w-32 md:w-40"
            style={{ backgroundColor: 'transparent', color: 'var(--text-primary)' }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="text-xs shrink-0"
              style={{ color: 'var(--text-muted)' }}
            >
              ✕
            </button>
          )}
        </div>

        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{countLabel}</span>

        {/* Right-side controls: wrap into a second row on mobile */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 md:ml-auto">
          {/* Date pickers */}
          <div className="flex items-center gap-1">
            <Calendar className="w-3 h-3 shrink-0" style={{ color: 'var(--text-muted)' }} />
            <input
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setActivePreset('') }}
              className="px-1 py-0.5 rounded text-xs border border-border-subtle outline-none"
              style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)', width: '104px' }}
            />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>-</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setActivePreset('') }}
              className="px-1 py-0.5 rounded text-xs border border-border-subtle outline-none"
              style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)', width: '104px' }}
            />
            {(startDate || endDate) && (
              <button
                onClick={handleClearDate}
                className="text-xs px-1.5 py-0.5 rounded shrink-0"
                style={{ color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
              >
                清除
              </button>
            )}
          </div>

          {/* Date preset buttons */}
          <div className="flex items-center gap-1">
            {[
              { label: '近7日', days: 7 },
              { label: '近30日', days: 30 },
              { label: '近90日', days: 90 },
              { label: '全部', days: 0 },
            ].map((p) => (
              <button
                key={p.label}
                onClick={() => {
                  if (p.days === 0) {
                    handleClearDate()
                  } else {
                    applyPreset(p.days, p.label)
                  }
                }}
                className="px-1.5 py-1 rounded text-xs font-medium transition-all"
                style={{
                  backgroundColor: activePreset === p.label ? 'var(--accent-primary)' : 'transparent',
                  color: activePreset === p.label ? '#fff' : 'var(--text-muted)',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Refresh button */}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all shrink-0"
            style={{
              backgroundColor: 'var(--accent-secondary)15',
              color: 'var(--accent-secondary)',
              opacity: refreshing ? 0.6 : 1,
            }}
          >
            <RotateCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
            更新
          </button>
          {refreshMsg && (
            <span className="text-xs shrink-0" style={{ color: 'var(--accent-primary)' }}>{refreshMsg}</span>
          )}
        </div>
      </div>

      {/* News list top marker for scroll-to-top */}
      <div ref={listTopRef} />

      <NewsTimeline
        docs={paged}
        symbol={symbol}
        savedAnalysisMap={savedAnalysisMap}
        onAnalysisDone={onAnalysisDone}
      />

      {/* Sticky pagination */}
      {totalPages > 1 && (
        <div
          className="flex items-center justify-center gap-4 mt-6 pt-4 border-t border-border-subtle sticky bottom-0 py-3"
          style={{ backgroundColor: 'var(--bg-surface)' }}
        >
          <button
            onClick={() => handlePageChange(Math.max(1, page - 1))}
            disabled={page === 1}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition-all disabled:opacity-30"
            style={{ color: 'var(--text-secondary)' }}
          >
            <ChevronLeft className="w-4 h-4" />
            上一页
          </button>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            第 {page}/{totalPages} 页
          </span>
          <button
            onClick={() => handlePageChange(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition-all disabled:opacity-30"
            style={{ color: 'var(--text-secondary)' }}
          >
            下一页
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}

export default function StockTabs({ symbol, klineData: _klineData, financials, financialPeriods, financialSummary, dividends, news, marketStats, technicalIndicators, loading }: StockTabsProps) {
  const [activeTab, setActiveTab] = useState<'market' | 'financial' | 'news'>('market')

  // Persist AI news analyses in localStorage
  const [savedAnalysisMap, setSavedAnalysisMap] = useState<Record<string, NewsAnalysis>>(() => {
    try {
      const stored = localStorage.getItem(`news_analysis_${symbol}`)
      return stored ? JSON.parse(stored) : {}
    } catch {
      return {}
    }
  })

  const handleAnalysisDone = useCallback((docId: string, analysis: NewsAnalysis) => {
    setSavedAnalysisMap((prev) => {
      const next = { ...prev, [docId]: analysis }
      try {
        localStorage.setItem(`news_analysis_${symbol}`, JSON.stringify(next))
      } catch { /* ignore */ }
      return next
    })
  }, [symbol])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, delay: 0.4 }}
      className="rounded-xl border border-border-subtle mt-4"
      style={{ backgroundColor: 'var(--bg-surface)' }}
    >
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-5 pt-4 border-b border-border-subtle">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            className="relative px-4 py-2.5 font-h3 text-sm transition-colors"
            style={{
              color: activeTab === tab.key ? 'var(--accent-primary)' : 'var(--text-secondary)',
            }}
          >
            {tab.label}
            {activeTab === tab.key && (
              <motion.div
                layoutId="activeTab"
                className="absolute bottom-0 left-0 right-0 h-[2px]"
                style={{ backgroundColor: 'var(--accent-primary)' }}
                transition={{ duration: 0.15 }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-5">
        <AnimatePresence mode="wait">
          {activeTab === 'market' && (
            <motion.div
              key="market"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <MarketAnalysisTab klineData={_klineData} stats={marketStats} indicators={technicalIndicators} loading={loading.stats} />
            </motion.div>
          )}
          {activeTab === 'financial' && (
            <motion.div
              key="financial"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <FinancialAnalysisTab data={financials} periods={financialPeriods} summary={financialSummary} dividends={dividends ?? []} loading={loading.financials} />
            </motion.div>
          )}
          {activeTab === 'news' && (
            <motion.div
              key="news"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <NewsTab
                docs={news}
                loading={loading.news}
                symbol={symbol}
                savedAnalysisMap={savedAnalysisMap}
                onAnalysisDone={handleAnalysisDone}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

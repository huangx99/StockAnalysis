import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { AlertTriangle, Search, Sparkles, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import StockHeader from '@/components/stock/StockHeader'
import StockMetricCards from '@/components/stock/StockMetricCards'
import StockKLineChart from '@/components/stock/StockKLineChart'
import StockTabs from '@/components/stock/StockTabs'
import AIInsightPanel from '@/components/ai/AIInsightPanel'
import ErrorState from '@/components/common/ErrorState'
import type { StockProfile, KLineData, FinancialStatement, DividendRecord, StockDocument, AIAnalysis, StockStats } from '@/types'
import {
  getStockProfile,
  getKLineData,
  getFinancials,
  getNews,
  getStockStats,
  getDividends,
  streamAIAnalysis,
} from '@/api/real/stockApi'

/* ── Skeleton components ─────────────────────────────── */
function HeaderSkeleton() {
  return (
    <div className="w-full rounded-xl border border-border-subtle px-5 py-5 md:px-6 animate-shimmer"
      style={{ backgroundColor: 'var(--bg-surface)' }}
    >
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="flex-1 space-y-3">
          <div className="h-8 w-40 rounded" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
          <div className="h-5 w-60 rounded" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
        </div>
        <div className="space-y-3">
          <div className="h-8 w-32 rounded" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
          <div className="h-5 w-48 rounded" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
        </div>
      </div>
    </div>
  )
}

function MetricCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-border-subtle px-4 py-4 animate-shimmer"
          style={{ backgroundColor: 'var(--bg-surface)' }}
        >
          <div className="h-3 w-16 rounded mb-2" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
          <div className="h-7 w-24 rounded" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
        </div>
      ))}
    </div>
  )
}

function ChartSkeleton() {
  return (
    <div
      className="rounded-xl border border-border-subtle p-5 animate-shimmer flex flex-col"
      style={{ backgroundColor: 'var(--bg-surface)', minHeight: '460px' }}
    >
      <div className="h-6 w-48 rounded mb-4" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
      <div className="flex-1 rounded" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
    </div>
  )
}

function AISkeleton() {
  return (
    <div
      className="rounded-xl border border-border-subtle p-5 animate-shimmer flex flex-col gap-4"
      style={{ backgroundColor: 'var(--bg-surface)', minHeight: '460px' }}
    >
      <div className="h-6 w-32 rounded" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
      <div className="h-4 w-48 rounded" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
      <div className="h-[100px] w-[100px] rounded-full mx-auto" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-10 rounded" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
      ))}
    </div>
  )
}

/* ── Main page component ─────────────────────────────── */
export default function StockDashboard() {
  const { symbol } = useParams<{ symbol: string }>()

  const [profile, setProfile] = useState<StockProfile | null>(null)
  const [klineData, setKlineData] = useState<KLineData[]>([])
  const [financials, setFinancials] = useState<FinancialStatement[]>([])
  const [dividends, setDividends] = useState<DividendRecord[]>([])
  const [news, setNews] = useState<StockDocument[]>([])
  const [aiAnalysis, setAiAnalysis] = useState<Partial<AIAnalysis> | null>(null)
  const [stockStats, setStockStats] = useState<StockStats | null>(null)

  const [loading, setLoading] = useState({
    profile: true,
    kline: true,
    financials: true,
    news: true,
    stats: true,
    ai: true,
  })

  const [error, setError] = useState<string | null>(null)
  const [isFavorite, setIsFavorite] = useState(false)
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day')
  const [klineLimit, setKlineLimit] = useState(250)
  const [aiStreaming, setAiStreaming] = useState(false)
  const [aiPanelOpen, setAiPanelOpen] = useState(false)

  const isValidSymbol = symbol && /^\d{6}$/.test(symbol)

  const fetchAll = useCallback(async () => {
    if (!isValidSymbol) return
    setError(null)
    setLoading({ profile: true, kline: true, financials: true, news: true, stats: true, ai: true })
    setAiAnalysis(null)
    setStockStats(null)

    // Fetch non-AI data in parallel
    const [p, k, f, n, s, d] = await Promise.allSettled([
      getStockProfile(symbol!),
      getKLineData(symbol!, period, klineLimit),
      getFinancials(symbol!),
      getNews(symbol!),
      getStockStats(symbol!),
      getDividends(symbol!),
    ])

    if (p.status === 'fulfilled') setProfile(p.value)
    if (k.status === 'fulfilled') setKlineData(k.value)
    if (f.status === 'fulfilled') setFinancials(f.value)
    if (n.status === 'fulfilled') setNews(n.value)
    if (s.status === 'fulfilled') setStockStats(s.value)
    if (d.status === 'fulfilled') setDividends(d.value)

    if (p.status === 'rejected') {
      setError(p.reason?.message || '数据加载失败')
    }

    setLoading((l) => ({ ...l, profile: false, kline: false, financials: false, news: false, stats: false }))

    // Start AI streaming
    setLoading((l) => ({ ...l, ai: true }))
    setAiStreaming(true)
    streamAIAnalysis(
      symbol!,
      (field, value) => {
        setAiAnalysis((prev) => ({ ...prev, [field]: value }))
      },
      () => {
        setLoading((l) => ({ ...l, ai: false }))
        setAiStreaming(false)
      },
      () => {
        setLoading((l) => ({ ...l, ai: false }))
        setAiStreaming(false)
      },
    )
  }, [symbol, isValidSymbol])

  const refreshKline = useCallback(async () => {
    if (!isValidSymbol) return
    setLoading((l) => ({ ...l, kline: true }))
    try {
      const k = await getKLineData(symbol!, period, klineLimit)
      setKlineData(k)
    } catch {
      /* ignore */
    } finally {
      setLoading((l) => ({ ...l, kline: false }))
    }
  }, [symbol, period, isValidSymbol, klineLimit])

  const handleLoadAllKline = useCallback(() => {
    setKlineLimit(0)
  }, [])

  const handleRegenerateAI = useCallback(() => {
    if (!isValidSymbol) return
    setAiAnalysis(null)
    setAiStreaming(true)
    streamAIAnalysis(
      symbol!,
      (field, value) => {
        setAiAnalysis((prev) => ({ ...prev, [field]: value }))
      },
      () => setAiStreaming(false),
      () => setAiStreaming(false),
    )
  }, [symbol, isValidSymbol])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  useEffect(() => {
    refreshKline()
  }, [period, refreshKline])

  if (!isValidSymbol) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[60dvh]">
        <AlertTriangle className="w-12 h-12 mb-4" style={{ color: 'var(--warning)' }} />
        <h1 className="font-h1 text-center" style={{ color: 'var(--text-primary)' }}>
          未找到股票代码：{symbol}
        </h1>
        <p className="font-body mt-2 text-center" style={{ color: 'var(--text-secondary)' }}>
          请检查代码是否正确，或返回首页搜索
        </p>
        <Link
          to="/"
          className="mt-6 flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white transition-all hover:scale-[1.02]"
          style={{ backgroundColor: 'var(--accent-primary)' }}
        >
          <Search className="w-4 h-4" />
          返回首页
        </Link>
      </div>
    )
  }

  if (error && !profile) {
    return (
      <div className="p-6">
        <ErrorState
          title="数据加载失败"
          description="请检查网络连接或稍后重试"
          onRetry={fetchAll}
        />
      </div>
    )
  }

  const isInitialLoading = loading.profile && !profile

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
      {/* Stock Header */}
      {isInitialLoading ? (
        <HeaderSkeleton />
      ) : profile ? (
        <StockHeader
          profile={profile}
          onRefresh={fetchAll}
          isFavorite={isFavorite}
          onToggleFavorite={() => setIsFavorite((f) => !f)}
        />
      ) : null}

      {/* Metric Cards */}
      {isInitialLoading ? (
        <MetricCardsSkeleton />
      ) : profile ? (
        <StockMetricCards profile={profile} />
      ) : null}

      {/* Chart section */}
      <div className="mt-4">
        {isInitialLoading ? (
          <ChartSkeleton />
        ) : (
          <StockKLineChart
            data={klineData}
            loading={loading.kline}
            period={period}
            onPeriodChange={setPeriod}
            onLoadAll={handleLoadAllKline}
            hasFullData={klineLimit === 0}
          />
        )}
      </div>

      {/* Tabbed Content */}
      {isInitialLoading ? (
        <div
          className="rounded-xl border border-border-subtle p-5 mt-4 animate-shimmer"
          style={{ backgroundColor: 'var(--bg-surface)', minHeight: '300px' }}
        >
          <div className="h-6 w-48 rounded mb-4" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
          <div className="h-40 rounded" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
        </div>
      ) : (
        <StockTabs
          klineData={klineData}
          financials={financials}
          dividends={dividends}
          news={news}
          marketStats={stockStats?.marketStats ?? null}
          technicalIndicators={stockStats?.technicalIndicators ?? null}
          loading={{
            market: loading.kline,
            financials: loading.financials,
            news: loading.news,
            stats: loading.stats,
          }}
        />
      )}

      {/* AI Panel Toggle Button */}
      <motion.button
        onClick={() => setAiPanelOpen((o) => !o)}
        className="fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-colors"
        style={{ backgroundColor: 'var(--accent-secondary)', color: '#fff' }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        aria-label="toggle AI panel"
      >
        {aiPanelOpen ? <X className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
      </motion.button>

      {/* AI Panel: slide-in from right */}
      <AnimatePresence>
        {aiPanelOpen && (
          <>
            {/* Backdrop on mobile */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 lg:hidden"
              style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
              onClick={() => setAiPanelOpen(false)}
            />
            {/* Panel */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed right-0 top-[56px] bottom-0 z-50 w-[360px] max-w-[90vw] overflow-y-auto border-l border-border-subtle"
              style={{ backgroundColor: 'var(--bg-base)' }}
            >
              <div className="p-4">
                {isInitialLoading ? (
                  <AISkeleton />
                ) : (
                  <AIInsightPanel
                    analysis={aiAnalysis}
                    streaming={aiStreaming}
                    onRegenerate={handleRegenerateAI}
                  />
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

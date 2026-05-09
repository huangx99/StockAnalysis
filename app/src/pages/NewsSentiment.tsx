import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Loader2, RefreshCw, TrendingUp, TrendingDown, Minus,
  AlertTriangle, ExternalLink, Filter, X, Download, ChevronDown, Search,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from 'recharts'
import { Button } from '@/components/ui/button'
import SentimentGauge from '@/components/news/SentimentGauge'
import TopicCloud from '@/components/news/TopicCloud'
import {
  getNewsSentimentOverview,
  getNewsSentimentFeed,
  refreshNewsSentiment,
  searchNewsRealtime,
} from '@/api/real/stockApi'
import type {
  NewsSentimentOverview,
  NewsSentimentItem,
  PaginatedNewsFeed,
} from '@/types'

const SENTIMENT_FILTERS = [
  { value: '', label: '全部' },
  { value: 'positive', label: '利好' },
  { value: 'neutral', label: '中性' },
  { value: 'negative', label: '利空' },
]

const sentimentBadge: Record<string, { label: string; color: string; bg: string }> = {
  positive: { label: '利好', color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
  neutral: { label: '中性', color: '#eab308', bg: 'rgba(234,179,8,0.15)' },
  negative: { label: '利空', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
}

const ALERT_CATEGORIES = ['全部', '退市风险', '政策监管', '市场异动', '公司违规', '情绪突变'] as const

function classifyAlert(title: string, reason: string, backendCategory?: string): string {
  if (backendCategory === '情绪突变') return '情绪突变'
  const text = title + reason
  if (/退市|终止上市|摘牌/.test(text)) return '退市风险'
  if (/立案|处罚|违规|造假|ST|被查|罢免/.test(text)) return '公司违规'
  if (/涨停|暴跌|大涨|跌停|新高|放量|暴涨/.test(text)) return '市场异动'
  if (/政策|央行|证监会|国务院|监管|法规|改革/.test(text)) return '政策监管'
  return '政策监管'
}

const ALERT_CATEGORY_COLORS: Record<string, { color: string; bg: string }> = {
  '退市风险': { color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  '公司违规': { color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  '市场异动': { color: '#eab308', bg: 'rgba(234,179,8,0.12)' },
  '政策监管': { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  '情绪突变': { color: '#a855f7', bg: 'rgba(168,85,247,0.12)' },
}

function fmtTime(t: string) {
  if (!t) return ''
  try {
    const d = new Date(t.replace(' ', 'T'))
    if (isNaN(d.getTime())) return t
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
    return t.slice(5, 16)
  } catch {
    return t
  }
}

function ImportanceBar({ value }: { value: number }) {
  const color = value >= 75 ? '#ef4444' : value >= 50 ? '#eab308' : '#6b7280'
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-elevated)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{value}</span>
    </div>
  )
}

export default function NewsSentiment() {
  const navigate = useNavigate()
  const [overview, setOverview] = useState<NewsSentimentOverview | null>(null)
  const [feed, setFeed] = useState<PaginatedNewsFeed | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [sentimentFilter, setSentimentFilter] = useState('')
  const [topicFilter, setTopicFilter] = useState('')
  const [alertCat, setAlertCat] = useState('全部')
  const [page, setPage] = useState(1)
  const [sourceFilter, setSourceFilter] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [searchResults, setSearchResults] = useState<NewsSentimentItem[] | null>(null)
  const [searching, setSearching] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const [ov, fd] = await Promise.all([
        getNewsSentimentOverview(),
        getNewsSentimentFeed({ page, pageSize: 30, sentiment: sentimentFilter, topic: topicFilter, source: sourceFilter }),
      ])
      setOverview(ov)
      setFeed(fd)
    } catch (e) {
      console.error('Failed to fetch news sentiment:', e)
    } finally {
      setLoading(false)
    }
  }, [page, sentimentFilter, topicFilter, sourceFilter])

  useEffect(() => { fetchData() }, [fetchData])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await refreshNewsSentiment()
      setPage(1)
      await fetchData()
    } finally {
      setRefreshing(false)
    }
  }

  const handleTopicClick = (topic: string) => {
    setTopicFilter(topicFilter === topic ? '' : topic)
    setPage(1)
  }

  const handleStockClick = (symbol: string) => {
    navigate(`/stock/${symbol}`)
  }

  const handleSearch = async () => {
    const q = searchInput.trim()
    if (!q) return
    setSearching(true)
    setSearchQuery(q)
    try {
      const result = await searchNewsRealtime(q, 30)
      setSearchResults(result.items || [])
    } catch (e) {
      console.error('Search failed:', e)
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  const clearSearch = () => {
    setSearchInput('')
    setSearchQuery('')
    setSearchResults(null)
  }

  const handleExport = (format: 'json' | 'csv') => {
    if (!overview) return
    if (format === 'json') {
      const blob = new Blob([JSON.stringify(overview, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `news-sentiment-${new Date().toISOString().slice(0, 10)}.json`; a.click()
      URL.revokeObjectURL(url)
    } else {
      const items = feed?.items || []
      const header = '标题,来源,情绪,评分,重要度,时间,链接'
      const rows = items.map((i) =>
        [i.title, i.source, i.sentiment, i.sentimentScore, i.importance, i.publishTime, i.url].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')
      )
      const csv = [header, ...rows].join('\n')
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `news-sentiment-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
      URL.revokeObjectURL(url)
    }
    setExportOpen(false)
  }

  const sources = feed ? [...new Set(feed.items.map((i) => i.source))].filter(Boolean) : []

  // Close export dropdown on outside click
  useEffect(() => {
    if (!exportOpen) return
    const close = () => setExportOpen(false)
    document.addEventListener('click', close, { once: true })
    return () => document.removeEventListener('click', close)
  }, [exportOpen])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--text-muted)' }} />
      </div>
    )
  }

  const ov = overview || {
    updatedAt: '', totalCount: 0, positiveCount: 0, negativeCount: 0,
    neutralCount: 0, overallScore: 50, marketPhase: '暂无数据',
    trends: [], hotTopics: [], alerts: [], topAffectedStocks: [],
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>新闻舆情监控</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {ov.updatedAt ? `更新于 ${ov.updatedAt}` : '暂无数据，点击刷新获取'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Button onClick={() => setExportOpen(!exportOpen)} variant="outline" size="sm" disabled={!overview}>
              <Download className="w-4 h-4 mr-1.5" />
              导出
              <ChevronDown className="w-3 h-3 ml-1" />
            </Button>
            {exportOpen && (
              <div className="absolute right-0 top-full mt-1 rounded-lg border shadow-lg z-50 py-1 min-w-[100px]"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
                <button onClick={() => handleExport('json')}
                  className="w-full px-3 py-1.5 text-left text-xs hover:bg-bg-surface-hover transition-colors"
                  style={{ color: 'var(--text-primary)' }}>JSON</button>
                <button onClick={() => handleExport('csv')}
                  className="w-full px-3 py-1.5 text-left text-xs hover:bg-bg-surface-hover transition-colors"
                  style={{ color: 'var(--text-primary)' }}>CSV</button>
              </div>
            )}
          </div>
          <Button onClick={handleRefresh} disabled={refreshing} variant="outline" size="sm">
            {refreshing ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
            {refreshing ? '刷新中...' : '刷新舆情'}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          label="新闻总数"
          value={ov.totalCount}
          icon={<Filter className="w-4 h-4" />}
          color="var(--accent-primary)"
        />
        <SummaryCard
          label="利好占比"
          value={ov.totalCount ? `${Math.round((ov.positiveCount / ov.totalCount) * 100)}%` : '-'}
          sub={`${ov.positiveCount}条`}
          icon={<TrendingUp className="w-4 h-4" />}
          color="#22c55e"
        />
        <SummaryCard
          label="利空占比"
          value={ov.totalCount ? `${Math.round((ov.negativeCount / ov.totalCount) * 100)}%` : '-'}
          sub={`${ov.negativeCount}条`}
          icon={<TrendingDown className="w-4 h-4" />}
          color="#ef4444"
        />
        <SummaryCard
          label="市场情绪"
          value={ov.marketPhase}
          sub={ov.overallScore + '分'}
          icon={<Minus className="w-4 h-4" />}
          color={ov.overallScore >= 60 ? '#22c55e' : ov.overallScore <= 40 ? '#ef4444' : '#eab308'}
        />
      </div>

      {/* Alerts */}
      {ov.alerts.length > 0 && (() => {
        const enriched = ov.alerts.map((a) => ({
          ...a,
          category: classifyAlert(a.title, a.reason, (a as any).category),
        }))
        const filtered = alertCat === '全部' ? enriched : enriched.filter((a) => a.category === alertCat)
        return (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-lg border p-3"
            style={{ backgroundColor: 'rgba(239,68,68,0.05)', borderColor: 'rgba(239,68,68,0.2)' }}
          >
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                <span className="text-sm font-medium text-red-500">重要舆情预警</span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({enriched.length})</span>
              </div>
              <div className="flex items-center gap-1">
                {ALERT_CATEGORIES.map((cat) => {
                  const count = cat === '全部' ? enriched.length : enriched.filter((a) => a.category === cat).length
                  if (count === 0 && cat !== '全部') return null
                  return (
                    <button
                      key={cat}
                      onClick={() => setAlertCat(cat)}
                      className="px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors"
                      style={{
                        backgroundColor: alertCat === cat
                          ? (ALERT_CATEGORY_COLORS[cat]?.bg || 'var(--accent-primary)')
                          : 'transparent',
                        color: alertCat === cat
                          ? (ALERT_CATEGORY_COLORS[cat]?.color || '#fff')
                          : 'var(--text-muted)',
                        border: alertCat === cat ? 'none' : '1px solid var(--border-subtle)',
                      }}
                    >
                      {cat} {count}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="space-y-2">
              {filtered.slice(0, 8).map((alert) => {
                const catStyle = ALERT_CATEGORY_COLORS[alert.category] || ALERT_CATEGORY_COLORS['政策监管']
                return (
                  <div key={alert.id} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{fmtTime(alert.publishTime)}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                        style={{ backgroundColor: catStyle.bg, color: catStyle.color }}>
                        {alert.category}
                      </span>
                    </div>
                    <span className="text-sm leading-snug" style={{ color: 'var(--text-primary)' }}>{alert.title}</span>
                  </div>
                )
              })}
            </div>
          </motion.div>
        )
      })()}

      {/* Trend Chart */}
      {ov.trends.length > 0 && (
        <div className="rounded-lg border p-4" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>情绪趋势</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={ov.trends}>
              <defs>
                <linearGradient id="sentGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
              <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: 'var(--text-primary)' }}
              />
              <Area type="monotone" dataKey="score" stroke="#22c55e" fillOpacity={1} fill="url(#sentGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Sector Sentiment */}
      {ov.sectorSentiment && ov.sectorSentiment.length > 0 && (
        <div className="rounded-lg border p-4"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>板块情绪</h3>
          <ResponsiveContainer width="100%" height={Math.max(200, ov.sectorSentiment.length * 36)}>
            <BarChart data={ov.sectorSentiment} layout="vertical" margin={{ left: 60, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis type="number" domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
              <YAxis type="category" dataKey="sector" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} width={55} />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8, fontSize: 12 }}
                formatter={(value: number, _name: string, props: any) => [
                  `${value} (${props.payload.count}条)`, '情绪分',
                ]}
              />
              <Bar dataKey="avgScore" radius={[0, 4, 4, 0]} barSize={20}>
                {ov.sectorSentiment.map((entry, idx) => (
                  <Cell key={idx} fill={entry.avgScore >= 60 ? '#22c55e' : entry.avgScore <= 40 ? '#ef4444' : '#eab308'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Hot Topics - Full Width */}
      {ov.hotTopics.length > 0 && (
        <div className="rounded-lg border p-4"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>热点话题</h3>
          <TopicCloud topics={ov.hotTopics} onTopicClick={handleTopicClick} />
        </div>
      )}

      {/* Main Content: Two Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Left: News Feed */}
        <div className="lg:col-span-3 space-y-3">
          {/* Search Bar */}
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="全网实时搜索新闻..."
                className="w-full pl-9 pr-3 py-2 rounded-lg text-sm border outline-none focus:ring-1"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--text-primary)',
                  '--tw-ring-color': 'var(--accent-primary)',
                } as React.CSSProperties}
              />
            </div>
            <Button onClick={handleSearch} disabled={searching || !searchInput.trim()} variant="outline" size="sm">
              {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            </Button>
            {searchQuery && (
              <Button onClick={clearSearch} variant="outline" size="sm">
                <X className="w-4 h-4 mr-1" /> 清除
              </Button>
            )}
          </div>

          {/* Search Results Header */}
          {searchQuery && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                搜索结果: {searchQuery}
                {searchResults && <span style={{ color: 'var(--text-muted)' }}> ({searchResults.length}条)</span>}
              </span>
            </div>
          )}

          {/* Filters - hidden during search */}
          {!searchQuery && <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              {SENTIMENT_FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => { setSentimentFilter(f.value); setPage(1) }}
                  className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
                  style={{
                    backgroundColor: sentimentFilter === f.value ? 'var(--accent-primary)' : 'var(--bg-elevated)',
                    color: sentimentFilter === f.value ? '#fff' : 'var(--text-secondary)',
                  }}
                >
                  {f.label}
                </button>
              ))}
              {topicFilter && (
                <button
                  onClick={() => { setTopicFilter(''); setPage(1) }}
                  className="flex items-center gap-1 px-2 py-1 rounded-full text-xs"
                  style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                >
                  {topicFilter} <X className="w-3 h-3" />
                </button>
              )}
            </div>
            {sources.length > 1 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>来源:</span>
                <button
                  onClick={() => { setSourceFilter(''); setPage(1) }}
                  className="px-2 py-0.5 rounded-full text-[11px] transition-colors"
                  style={{
                    backgroundColor: sourceFilter === '' ? 'var(--accent-primary)' : 'transparent',
                    color: sourceFilter === '' ? '#fff' : 'var(--text-muted)',
                    border: sourceFilter === '' ? 'none' : '1px solid var(--border-subtle)',
                  }}
                >全部</button>
                {sources.slice(0, 12).map((src) => (
                  <button
                    key={src}
                    onClick={() => { setSourceFilter(sourceFilter === src ? '' : src); setPage(1) }}
                    className="px-2 py-0.5 rounded-full text-[11px] transition-colors"
                    style={{
                      backgroundColor: sourceFilter === src ? 'var(--accent-primary)' : 'transparent',
                      color: sourceFilter === src ? '#fff' : 'var(--text-muted)',
                      border: sourceFilter === src ? 'none' : '1px solid var(--border-subtle)',
                    }}
                  >{src}</button>
                ))}
              </div>
            )}
          </div>}

          {/* News List */}
          <div className="space-y-2">
            {searching ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--text-muted)' }} />
                <span className="ml-2 text-sm" style={{ color: 'var(--text-muted)' }}>正在全网搜索...</span>
              </div>
            ) : searchResults ? (
              searchResults.length > 0 ? (
                searchResults.map((item) => <NewsCard key={item.id} item={item} onStockClick={handleStockClick} />)
              ) : (
                <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
                  未找到与「{searchQuery}」相关的新闻
                </div>
              )
            ) : feed && feed.items.length > 0 ? (
              feed.items.map((item) => <NewsCard key={item.id} item={item} onStockClick={handleStockClick} />)
            ) : (
              <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
                {overview ? '暂无符合条件的新闻' : '暂无数据，请点击「刷新舆情」获取'}
              </div>
            )}
          </div>

          {/* Pagination */}
          {!searchResults && feed && feed.total > feed.pageSize && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button
                variant="outline" size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                上一页
              </Button>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {page} / {Math.ceil(feed.total / feed.pageSize)}
              </span>
              <Button
                variant="outline" size="sm"
                disabled={page >= Math.ceil(feed.total / feed.pageSize)}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </Button>
            </div>
          )}
        </div>

        {/* Right: Panels */}
        <div className="lg:col-span-2 space-y-4">
          {/* Sentiment Gauge */}
          <div className="rounded-lg border p-4 flex flex-col items-center"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <h3 className="text-sm font-medium mb-1 self-start" style={{ color: 'var(--text-primary)' }}>市场情绪指数</h3>
            <SentimentGauge score={ov.overallScore} size={160} label={ov.marketPhase} />
          </div>

          {/* Affected Stocks */}
          <div className="rounded-lg border p-4"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>高频提及股票</h3>
            {ov.topAffectedStocks.length > 0 ? (
              <div className="space-y-1.5">
                {ov.topAffectedStocks.slice(0, 15).map((stock) => (
                  <button
                    key={stock.symbol}
                    onClick={() => handleStockClick(stock.symbol)}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-bg-surface-hover transition-colors text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-data-xs" style={{ color: 'var(--text-primary)' }}>{stock.symbol}</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{stock.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {stock.count != null && (
                        <span className="text-xs px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                          {stock.count}条
                        </span>
                      )}
                      {stock.avgScore != null && (
                        <span className="text-xs font-medium" style={{
                          color: stock.avgScore >= 60 ? '#22c55e' : stock.avgScore <= 40 ? '#ef4444' : '#eab308',
                        }}>
                          {stock.avgScore}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-4" style={{ color: 'var(--text-muted)' }}>暂无数据</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, sub, icon, color }: {
  label: string; value: string | number; sub?: string; icon: React.ReactNode; color: string
}) {
  return (
    <div className="rounded-lg border p-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
      <div className="flex items-center gap-2 mb-1">
        <span style={{ color }}>{icon}</span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
      </div>
      <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{value}</div>
      {sub && <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  )
}

function NewsCard({ item, onStockClick }: { item: NewsSentimentItem; onStockClick: (s: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const badge = sentimentBadge[item.sentiment] || sentimentBadge.neutral

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border p-3 transition-colors hover:bg-bg-surface-hover cursor-pointer"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs px-1.5 py-0.5 rounded font-medium"
              style={{ backgroundColor: badge.bg, color: badge.color }}>
              {badge.label}
            </span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.source}</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{fmtTime(item.publishTime)}</span>
            <ImportanceBar value={item.importance} />
          </div>
          <h4 className="text-sm font-medium leading-snug" style={{ color: 'var(--text-primary)' }}>
            {item.title}
          </h4>

          {/* Topics */}
          {item.topics.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {item.topics.map((t) => (
                <span key={t} className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                  {t}
                </span>
              ))}
            </div>
          )}

          {/* Affected Stocks */}
          {item.affectedStocks.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {item.affectedStocks.slice(0, 5).map((stock) => (
                <button
                  key={stock.symbol}
                  onClick={(e) => { e.stopPropagation(); onStockClick(stock.symbol) }}
                  className="text-xs px-1.5 py-0.5 rounded hover:underline"
                  style={{ backgroundColor: 'rgba(59,130,246,0.1)', color: '#3b82f6' }}
                >
                  {stock.name}({stock.symbol})
                </button>
              ))}
            </div>
          )}
        </div>

        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 p-1 rounded hover:bg-bg-surface-hover"
            title="查看原文"
          >
            <ExternalLink className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
          </a>
        )}
      </div>

      {/* Expanded Content */}
      {expanded && item.content && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mt-2 pt-2 text-xs leading-relaxed"
          style={{ color: 'var(--text-secondary)', borderTop: '1px solid var(--border-subtle)' }}
        >
          {item.content}
          {item.keywords.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {item.keywords.map((kw) => (
                <span key={kw} className="text-[10px] px-1 py-0.5 rounded"
                  style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                  {kw}
                </span>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  )
}

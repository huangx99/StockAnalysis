import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { ExternalLink, ChevronDown, ChevronUp, Sparkles, Loader2 } from 'lucide-react'
import type { StockDocument, NewsAnalysis } from '@/types'
import { analyzeNewsItem } from '@/api/real/stockApi'

interface NewsSummaryCardProps {
  doc: StockDocument
  index: number
  symbol: string
  savedAnalysis?: NewsAnalysis | null
  onAnalysisDone?: (docId: string, analysis: NewsAnalysis) => void
}

function SentimentBadge({ sentiment }: { sentiment: string }) {
  const config: Record<string, { text: string; bg: string; color: string }> = {
    positive: { text: '正面', bg: 'var(--up-red)', color: 'var(--up-red)' },
    neutral: { text: '中性', bg: 'var(--warning)', color: 'var(--warning)' },
    negative: { text: '负面', bg: 'var(--down-green)', color: 'var(--down-green)' },
  }
  const c = config[sentiment] || config.neutral
  return (
    <span
      className="font-label px-2 py-0.5 rounded"
      style={{ backgroundColor: `${c.bg}15`, color: c.color }}
    >
      {c.text}
    </span>
  )
}

function TypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    news: '新闻',
    announcement: '公告',
    report: '研报',
  }
  return (
    <span
      className="font-label px-2 py-0.5 rounded"
      style={{ backgroundColor: 'var(--accent-primary)1F', color: 'var(--accent-primary)' }}
    >
      {labels[type] || type}
    </span>
  )
}

const IMPORTANT_KEYWORDS = [
  { kw: '业绩', color: 'var(--accent-primary)' },
  { kw: '分红', color: 'var(--up-red)' },
  { kw: '增持', color: 'var(--up-red)' },
  { kw: '减持', color: 'var(--down-green)' },
  { kw: '重组', color: 'var(--warning)' },
  { kw: 'ST', color: 'var(--danger)' },
  { kw: '退市', color: 'var(--danger)' },
]

function getImportantHighlight(title: string): { color: string } | null {
  for (const { kw, color } of IMPORTANT_KEYWORDS) {
    if (title.includes(kw)) return { color }
  }
  return null
}

export default function NewsSummaryCard({
  doc,
  index,
  symbol,
  savedAnalysis,
  onAnalysisDone,
}: NewsSummaryCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState<NewsAnalysis | null>(null)
  const [analysisError, setAnalysisError] = useState('')

  const displayAnalysis = analysis || savedAnalysis || null

  const handleOpenUrl = useCallback(() => {
    if (!doc.url) return
    // Use backend proxy for external URLs to avoid Origin header blocking
    const needsProxy = doc.url.includes('cninfo.com.cn') || doc.url.includes('dfcfw.com')
    const proxyUrl = needsProxy
      ? `/api/proxy/notice?url=${encodeURIComponent(doc.url)}`
      : doc.url
    window.open(proxyUrl, '_blank', 'noopener,noreferrer')
  }, [doc.url])

  const handleAnalyze = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (analyzing || displayAnalysis) return
    setAnalyzing(true)
    setAnalysisError('')
    try {
      const result = await analyzeNewsItem(symbol, doc.title, doc.content || doc.summary, doc.url || '')
      setAnalysis(result)
      onAnalysisDone?.(doc.id, result)
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : '分析失败')
    } finally {
      setAnalyzing(false)
    }
  }, [symbol, doc, analyzing, displayAnalysis, onAnalysisDone])

  const dateParts = doc.publishTime.split(' ')
  const date = dateParts[0]
  const time = dateParts[1] || ''
  const important = getImportantHighlight(doc.title)

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: index * 0.08, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] }}
      className="relative flex gap-4"
    >
      {/* Timeline dot + line */}
      <div className="hidden md:flex flex-col items-center shrink-0 w-16">
        <span className="font-data-sm text-right w-full" style={{ color: 'var(--text-muted)' }}>
          {date}
        </span>
        <div
          className="w-2 h-2 rounded-full mt-1 shrink-0"
          style={{
            backgroundColor: doc.type === 'announcement' ? 'var(--accent-primary)' : 'var(--text-muted)',
          }}
        />
      </div>

      {/* Card content */}
      <div className="flex-1 pb-4 pl-0 md:border-l md:border-border-subtle md:pl-4 md:-ml-[9px]">
        <div
          className="rounded-xl border p-3 md:p-4 transition-all hover:border-border-strong"
          style={{
            backgroundColor: 'var(--bg-base)',
            borderColor: 'var(--border-subtle)',
            ...(important ? { borderLeft: `2px solid ${important.color}` } : {}),
          }}
        >
          {/* Date on mobile (hidden on desktop, shown inside card) */}
          <div className="md:hidden flex items-center gap-2 mb-1.5">
            <span className="font-data-sm" style={{ color: 'var(--text-muted)' }}>
              {date}
            </span>
            {time && (
              <span className="font-data-sm" style={{ color: 'var(--text-muted)' }}>
                {time}
              </span>
            )}
          </div>

          {/* Title */}
          <h3 className="font-h3 text-base" style={{ color: 'var(--text-primary)' }}>
            {doc.url ? (
              <button
                className="text-left hover:underline cursor-pointer"
                style={{ color: 'var(--text-primary)', background: 'none', border: 'none', padding: 0, font: 'inherit' }}
                onClick={(e) => {
                  e.stopPropagation()
                  handleOpenUrl()
                }}
              >
                {doc.title}
              </button>
            ) : (
              <span
                className="cursor-pointer hover:underline"
                onClick={() => setExpanded((e) => !e)}
              >
                {doc.title}
              </span>
            )}
          </h3>

          <div className="flex flex-wrap items-center gap-2 mt-2">
            <TypeBadge type={doc.type} />
            <span className="font-data-sm" style={{ color: 'var(--text-muted)' }}>
              {doc.source}
            </span>
            {/* Time shown on desktop only */}
            {time && (
              <span className="hidden md:inline font-data-sm" style={{ color: 'var(--text-muted)' }}>
                {time}
              </span>
            )}
          </div>

          <p className="font-body text-sm mt-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {doc.summary}
          </p>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <SentimentBadge sentiment={doc.sentiment} />
            {important && (
              <span
                className="font-label px-2 py-0.5 rounded text-xs"
                style={{ backgroundColor: `${important.color}15`, color: important.color }}
              >
                重要
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-3">
            {doc.url && (
              <button
                onClick={handleOpenUrl}
                className="flex items-center gap-1 text-sm font-medium transition-colors hover:opacity-80"
                style={{ color: 'var(--accent-primary)', background: 'none', border: 'none', padding: 0 }}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                查看原文
              </button>
            )}
            <button
              onClick={() => setExpanded((e) => !e)}
              className="flex items-center gap-1 text-sm font-medium transition-colors"
              style={{ color: 'var(--text-muted)' }}
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {expanded ? '收起详情' : '展开详情'}
            </button>
          </div>

          {/* Expanded content */}
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              transition={{ duration: 0.2 }}
              className="mt-3 pt-3 border-t border-border-subtle"
            >
              {/* Full content */}
              {doc.content ? (
                <div
                  className="font-body text-sm leading-relaxed mb-4 max-h-60 overflow-y-auto rounded p-3"
                  style={{
                    color: 'var(--text-secondary)',
                    backgroundColor: 'var(--bg-surface)',
                  }}
                >
                  {doc.content}
                </div>
              ) : doc.url ? (
                <div className="mb-4 text-center py-6">
                  <p className="font-body text-sm mb-2" style={{ color: 'var(--text-muted)' }}>
                    暂无全文内容，请点击下方链接查看原文
                  </p>
                  <button
                    onClick={handleOpenUrl}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-80"
                    style={{ backgroundColor: 'var(--accent-primary)', color: '#fff', border: 'none' }}
                  >
                    <ExternalLink className="w-4 h-4" />
                    查看原文
                  </button>
                </div>
              ) : (
                <div className="mb-4 text-center py-4">
                  <p className="font-body text-sm" style={{ color: 'var(--text-muted)' }}>
                    暂无更多内容
                  </p>
                </div>
              )}

              {/* AI Analysis section */}
              {displayAnalysis ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
                    <span className="font-label" style={{ color: 'var(--accent-primary)' }}>AI 分析</span>
                    <SentimentBadge sentiment={displayAnalysis.sentiment} />
                  </div>
                  <p className="font-body text-sm" style={{ color: 'var(--text-primary)' }}>
                    {displayAnalysis.summary}
                  </p>
                  {displayAnalysis.key_points?.length > 0 && (
                    <div>
                      <span className="font-label text-xs" style={{ color: 'var(--text-muted)' }}>关键要点</span>
                      <ul className="mt-1 space-y-1 list-disc list-inside">
                        {displayAnalysis.key_points.map((kp, i) => (
                          <li key={i} className="font-body text-sm" style={{ color: 'var(--text-secondary)' }}>
                            {kp}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {displayAnalysis.risk_factors?.length > 0 && (
                    <div>
                      <span className="font-label text-xs" style={{ color: 'var(--text-muted)' }}>风险因素</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {displayAnalysis.risk_factors.map((rf, i) => (
                          <span
                            key={i}
                            className="font-label px-2 py-0.5 rounded text-xs"
                            style={{ backgroundColor: 'var(--danger)1F', color: 'var(--danger)' }}
                          >
                            {rf}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleAnalyze}
                    disabled={analyzing}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all"
                    style={{
                      backgroundColor: 'var(--accent-primary)15',
                      color: 'var(--accent-primary)',
                      opacity: analyzing ? 0.6 : 1,
                    }}
                  >
                    {analyzing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    {analyzing ? '分析中...' : 'AI 分析'}
                  </button>
                  {analysisError && (
                    <span className="font-body text-xs" style={{ color: 'var(--danger)' }}>
                      {analysisError}
                    </span>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

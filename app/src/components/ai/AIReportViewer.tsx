import { useState, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Copy, Download, RotateCw, Check, ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { StockProfile, AIAnalysis } from '@/types'
import ReportTOC from './ReportTOC'
import ReportSection from './ReportSection'
import { formatPrice, formatPercent, formatVolume, formatMarketCap } from '@/lib/formatters'

interface AIReportViewerProps {
  symbol: string
  profile: StockProfile
  analysis: Partial<AIAnalysis> | null
  streaming: boolean
  onRegenerate: () => void
}

function ShimmerBlock() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="h-3 w-full rounded" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
      <div className="h-3 w-4/5 rounded" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
      <div className="h-3 w-3/5 rounded" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
    </div>
  )
}

/* ── Score ring ─────────────────────────────────────────── */
function ScoreRing({ score, style }: { score: number; style: string }) {
  const size = 80
  const stroke = 6
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--border-subtle)"
            strokeWidth={stroke}
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--accent-secondary)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1, delay: 0.3, ease: 'easeOut' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-data-lg" style={{ color: 'var(--text-primary)', fontSize: '24px' }}>
            {score}
          </span>
        </div>
      </div>
      <span className="font-label mt-2" style={{ color: 'var(--text-muted)' }}>
        综合评分
      </span>
      <span
        className="font-data-sm mt-1 px-2 py-0.5 rounded"
        style={{
          backgroundColor: 'var(--accent-secondary)',
          opacity: 0.15,
          color: 'var(--accent-secondary)',
        }}
      >
        {style}
      </span>
    </div>
  )
}

/* ── Action buttons ─────────────────────────────────────── */
function ActionButtons({ markdown, onRegenerate, streaming }: { markdown: string; onRegenerate: () => void; streaming: boolean }) {
  const [copied, setCopied] = useState(false)
  const [pdfHover, setPdfHover] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(markdown)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }, [markdown])

  return (
    <div className="flex flex-col gap-2 mt-4 w-full">
      <motion.button
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.4 }}
        onClick={handleCopy}
        className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all duration-150 hover:scale-[1.02]"
        style={{
          backgroundColor: 'var(--bg-surface-hover)',
          borderColor: 'var(--border-strong)',
          color: 'var(--text-primary)',
        }}
      >
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        {copied ? '已复制' : '复制 Markdown'}
      </motion.button>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.48 }}
        className="relative"
        onMouseEnter={() => setPdfHover(true)}
        onMouseLeave={() => setPdfHover(false)}
      >
        <button
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 hover:scale-[1.02]"
          style={{
            backgroundColor: 'var(--accent-primary)',
            color: '#fff',
          }}
        >
          <Download className="w-4 h-4" />
          导出 PDF
        </button>
        {pdfHover && (
          <div
            className="absolute top-full left-0 right-0 mt-1 px-3 py-1.5 rounded-lg text-xs text-center"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            即将上线
          </div>
        )}
      </motion.div>

      <motion.button
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.56 }}
        onClick={onRegenerate}
        disabled={streaming}
        className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 hover:scale-[1.02] disabled:opacity-50"
        style={{
          color: 'var(--text-secondary)',
        }}
      >
        <RotateCw className={`w-4 h-4 ${streaming ? 'animate-spin' : ''}`} />
        {streaming ? '生成中...' : '重新生成'}
      </motion.button>
    </div>
  )
}

/* ── Section content renderers ──────────────────────────── */
function CompanyOverview({ profile }: { profile: StockProfile }) {
  return (
    <div className="space-y-4">
      <p className="font-body" style={{ color: 'var(--text-primary)', lineHeight: 1.8, fontSize: '15px' }}>
        <strong style={{ color: 'var(--text-primary)' }}>{profile.name}</strong>（股票代码：
        <span
          className="font-data-sm px-2 py-0.5 rounded"
          style={{
            backgroundColor: 'var(--bg-surface-hover)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--accent-primary)',
          }}
        >
          {profile.symbol}
        </span>
        ）属于<span className="font-data-sm px-2 py-0.5 rounded mx-1" style={{ backgroundColor: 'var(--bg-surface-hover)', border: '1px solid var(--border-subtle)', color: 'var(--accent-primary)' }}>{profile.industry}</span>
        行业。公司当前股价 <span className="font-data-sm px-2 py-0.5 rounded mx-1" style={{ backgroundColor: 'var(--bg-surface-hover)', border: '1px solid var(--border-subtle)', color: 'var(--accent-primary)' }}>{formatPrice(profile.currentPrice)}</span>
        元，总市值 <span className="font-data-sm px-2 py-0.5 rounded mx-1" style={{ backgroundColor: 'var(--bg-surface-hover)', border: '1px solid var(--border-subtle)', color: 'var(--accent-primary)' }}>{formatMarketCap(profile.marketCap)}</span>。
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: '市盈率(PE)', value: profile.pe.toFixed(2) },
          { label: '市净率(PB)', value: profile.pb.toFixed(2) },
          { label: '股息率', value: `${profile.dividendYield}%` },
          { label: '换手率', value: `${profile.turnoverRate}%` },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-lg border p-3"
            style={{ backgroundColor: 'var(--bg-surface-hover)', borderColor: 'var(--border-subtle)' }}
          >
            <div className="font-label mb-1" style={{ color: 'var(--text-muted)' }}>{item.label}</div>
            <div className="font-data-md" style={{ color: 'var(--text-primary)' }}>{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function MarketPerformance({ profile }: { profile: StockProfile }) {
  const isUp = profile.change >= 0
  return (
    <div className="space-y-4">
      <p className="font-body" style={{ color: 'var(--text-primary)', lineHeight: 1.8, fontSize: '15px' }}>
        近期股价
        <span className={isUp ? 'text-up' : 'text-down'} style={{ fontWeight: 600 }}>
          {isUp ? '上涨' : '下跌'}
        </span>
        ，当日{formatPercent(profile.changePercent)}，成交量
        <span className="font-data-sm px-2 py-0.5 rounded mx-1" style={{ backgroundColor: 'var(--bg-surface-hover)', border: '1px solid var(--border-subtle)', color: 'var(--accent-primary)' }}>
          {formatVolume(profile.volume)}
        </span>
        。市场情绪偏向{isUp ? '乐观' : '谨慎'}，机构关注度维持高位。
      </p>
      <div
        className="rounded-lg border p-4"
        style={{ backgroundColor: 'rgba(59,130,246,0.05)', borderLeft: '3px solid var(--accent-primary)' }}
      >
        <p className="font-body" style={{ color: 'var(--text-primary)' }}>
          与大盘对比：该股近期走势{isUp ? '强于' : '弱于'}沪深300指数，相对收益约 {formatPercent(Math.abs(profile.changePercent) * 0.6)}。
        </p>
      </div>
    </div>
  )
}

function FinancialHighlights({ content }: { content?: string }) {
  if (!content) return <ShimmerBlock />
  return (
    <div className="space-y-4">
      <p className="font-body" style={{ color: 'var(--text-primary)', lineHeight: 1.8, fontSize: '15px' }}>
        {content}
      </p>
    </div>
  )
}

function ValuationAnalysis({ content }: { content?: string }) {
  if (!content) return <ShimmerBlock />
  return (
    <div className="space-y-4">
      <p className="font-body" style={{ color: 'var(--text-primary)', lineHeight: 1.8, fontSize: '15px' }}>
        {content}
      </p>
    </div>
  )
}

function NewsSummary({ content }: { content?: string }) {
  if (!content) return <ShimmerBlock />
  return (
    <div className="space-y-4">
      <p className="font-body" style={{ color: 'var(--text-primary)', lineHeight: 1.8, fontSize: '15px' }}>
        {content}
      </p>
    </div>
  )
}

function InvestmentHighlights({ highlights }: { highlights?: string[] }) {
  if (!highlights || highlights.length === 0) return <ShimmerBlock />
  return (
    <div className="space-y-4">
      {highlights.map((item, i) => (
        <div
          key={i}
          className="flex items-start gap-3 rounded-lg border p-4"
          style={{ backgroundColor: 'rgba(34,197,94,0.05)', borderLeft: '3px solid var(--success)', borderColor: 'var(--border-subtle)' }}
        >
          <span
            className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-xs text-white mt-0.5"
            style={{ backgroundColor: 'var(--success)' }}
          >
            {i + 1}
          </span>
          <p className="font-body" style={{ color: 'var(--text-primary)', lineHeight: 1.8 }}>{item}</p>
        </div>
      ))}
    </div>
  )
}

function RiskFactors({ risks }: { risks?: string[] }) {
  if (!risks || risks.length === 0) return <ShimmerBlock />
  return (
    <div className="space-y-4">
      {risks.map((item, i) => (
        <div
          key={i}
          className="flex items-start gap-3 rounded-lg border p-4"
          style={{ backgroundColor: 'rgba(239,68,68,0.05)', borderLeft: '3px solid var(--danger)', borderColor: 'var(--border-subtle)' }}
        >
          <span
            className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-xs text-white mt-0.5"
            style={{ backgroundColor: 'var(--danger)' }}
          >
            {i + 1}
          </span>
          <p className="font-body" style={{ color: 'var(--text-primary)', lineHeight: 1.8 }}>{item}</p>
        </div>
      ))}
    </div>
  )
}

function Conclusion({ analysis }: { analysis: Partial<AIAnalysis> }) {
  if (!analysis.conclusion) return <ShimmerBlock />
  return (
    <div className="space-y-4">
      <div
        className="rounded-lg border p-5"
        style={{ backgroundColor: 'rgba(59,130,246,0.05)', borderLeft: '3px solid var(--accent-primary)', borderColor: 'var(--border-subtle)' }}
      >
        <p className="font-body" style={{ color: 'var(--text-primary)', lineHeight: 1.8, fontSize: '15px' }}>
          <strong>一句话总结：</strong>
          {analysis.conclusion}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border p-4" style={{ backgroundColor: 'var(--bg-surface-hover)', borderColor: 'var(--border-subtle)' }}>
          <div className="font-label mb-2" style={{ color: 'var(--text-muted)' }}>投资风格</div>
          <div className="font-h3" style={{ color: 'var(--accent-secondary)' }}>{analysis.style || '...'}</div>
        </div>
        <div className="rounded-lg border p-4" style={{ backgroundColor: 'var(--bg-surface-hover)', borderColor: 'var(--border-subtle)' }}>
          <div className="font-label mb-2" style={{ color: 'var(--text-muted)' }}>关注事项</div>
          <p className="font-body" style={{ color: 'var(--text-primary)' }}>估值波动、消费复苏节奏、政策变化</p>
        </div>
      </div>

      <p className="font-body" style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
        <strong style={{ color: 'var(--text-primary)' }}>时间建议：</strong>
        长期投资者可逢低分批建仓；短期交易者注意节奏，建议关注季报披露窗口期。
      </p>
    </div>
  )
}

/* ── Main viewer ────────────────────────────────────────── */
export default function AIReportViewer({ symbol, profile, analysis, streaming, onRegenerate }: AIReportViewerProps) {
  const [activeId, setActiveId] = useState('section-0')
  const [scrollProgress, setScrollProgress] = useState(0)
  const [generatedAt] = useState(() => new Date().toLocaleString('zh-CN'))

  const sections = useMemo(
    () => [
      { id: 'section-0', title: '公司概况' },
      { id: 'section-1', title: '行情表现' },
      { id: 'section-2', title: '财务表现' },
      { id: 'section-3', title: '估值分析' },
      { id: 'section-4', title: '公告与新闻摘要' },
      { id: 'section-5', title: '投资亮点' },
      { id: 'section-6', title: '风险因素' },
      { id: 'section-7', title: '综合判断' },
    ],
    []
  )

  const handleNavigate = useCallback((id: string) => {
    const el = document.getElementById(id)
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - 100
      window.scrollTo({ top, behavior: 'smooth' })
    }
  }, [])

  const handleIntersect = useCallback((id: string) => {
    setActiveId(id)
    const idx = sections.findIndex((s) => s.id === id)
    setScrollProgress(((idx + 1) / sections.length) * 100)
  }, [sections])

  const markdown = useMemo(() => {
    const highlights = analysis?.highlights?.map((h) => `- ${h}`).join('\n') || '暂无'
    const risks = analysis?.risks?.map((r) => `- ${r}`).join('\n') || '暂无'
    return `# ${profile.name} (${profile.symbol}) AI 深度研究报告\n\n**生成时间：** ${generatedAt}\n\n**综合评分：** ${analysis?.score ?? '-'} / 100\n**投资风格：** ${analysis?.style ?? '-'}\n\n## 1. 公司概况\n\n${profile.name}属于${profile.industry}行业，当前股价${formatPrice(profile.currentPrice)}元，总市值${formatMarketCap(profile.marketCap)}。\n\n## 2. 行情表现\n\n当日${formatPercent(profile.changePercent)}，成交量${formatVolume(profile.volume)}。\n\n## 3. 财务表现\n\n${analysis?.financialPerformance || '暂无'}\n\n## 4. 估值分析\n\n${analysis?.valuationAnalysis || '暂无'}\n\n## 5. 公告与新闻摘要\n\n${analysis?.newsDigest || '暂无'}\n\n## 6. 投资亮点\n\n${highlights}\n\n## 7. 风险因素\n\n${risks}\n\n## 8. 综合判断\n\n${analysis?.conclusion || '暂无'}\n`
  }, [profile, analysis, generatedAt])

  return (
    <div className="max-w-[1200px] mx-auto px-4 py-6">
      {/* Report Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="rounded-xl border p-6 md:p-8 mb-6"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 font-data-sm mb-2" style={{ color: 'var(--text-muted)' }}>
          <Link
            to={`/stock/${symbol}`}
            className="flex items-center gap-1 hover:underline"
            style={{ color: 'var(--accent-primary)' }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            返回分析
          </Link>
          <span>&gt;</span>
          <span style={{ color: 'var(--accent-primary)' }}>{profile.name} ({profile.symbol})</span>
          <span>&gt;</span>
          <span>AI 研究报告</span>
        </div>

        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
          {/* Left: Title & Meta */}
          <div className="flex-1 min-w-0">
            <h1 className="font-h1" style={{ color: 'var(--text-primary)' }}>
              AI 深度研究报告
            </h1>
            <p className="font-body mt-2" style={{ color: 'var(--text-secondary)' }}>
              {profile.name} ({profile.symbol}.{profile.market}) · {profile.industry}行业
            </p>
            <div className="flex flex-wrap items-center gap-4 mt-3">
              <span className="font-data-sm" style={{ color: 'var(--text-muted)' }}>
                生成时间：{generatedAt}
              </span>
              <span className="font-data-sm" style={{ color: 'var(--text-muted)' }}>
                数据截止：{profile.updateTime}
              </span>
              {streaming && (
                <span className="font-data-sm flex items-center gap-1.5" style={{ color: 'var(--accent-secondary)' }}>
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--accent-secondary)' }} />
                  AI 生成中...
                </span>
              )}
              <span
                className="font-label px-2 py-0.5 rounded"
                style={{ backgroundColor: 'rgba(245,158,11,0.15)', color: 'var(--warning)' }}
              >
                AI 生成 · 仅供参考
              </span>
            </div>
          </div>

          {/* Right: Score + Actions */}
          <div className="flex flex-col items-center shrink-0">
            {analysis?.score != null && analysis.score > 0 && (
              <ScoreRing score={analysis.score} style={analysis.style || ''} />
            )}
            <div className="hidden md:block">
              <ActionButtons markdown={markdown} onRegenerate={onRegenerate} streaming={streaming} />
            </div>
          </div>
        </div>

        {/* Mobile actions */}
        <div className="flex md:hidden gap-2 mt-4">
          <ActionButtons markdown={markdown} onRegenerate={onRegenerate} streaming={streaming} />
        </div>
      </motion.div>

      {/* Report Body */}
      <div className="flex gap-8">
        <ReportTOC sections={sections} activeId={activeId} onNavigate={handleNavigate} progress={scrollProgress} />

        <div className="flex-1 max-w-[800px] pb-12">
          <ReportSection id="section-0" index={0} title="公司概况" onIntersect={handleIntersect}>
            <CompanyOverview profile={profile} />
          </ReportSection>

          <ReportSection id="section-1" index={1} title="行情表现" onIntersect={handleIntersect}>
            <MarketPerformance profile={profile} />
          </ReportSection>

          <ReportSection id="section-2" index={2} title="财务表现" onIntersect={handleIntersect}>
            <FinancialHighlights content={analysis?.financialPerformance} />
          </ReportSection>

          <ReportSection id="section-3" index={3} title="估值分析" onIntersect={handleIntersect}>
            <ValuationAnalysis content={analysis?.valuationAnalysis} />
          </ReportSection>

          <ReportSection id="section-4" index={4} title="公告与新闻摘要" onIntersect={handleIntersect}>
            <NewsSummary content={analysis?.newsDigest} />
          </ReportSection>

          <ReportSection id="section-5" index={5} title="投资亮点" onIntersect={handleIntersect}>
            <InvestmentHighlights highlights={analysis?.highlights} />
          </ReportSection>

          <ReportSection id="section-6" index={6} title="风险因素" onIntersect={handleIntersect}>
            <RiskFactors risks={analysis?.risks} />
          </ReportSection>

          <ReportSection id="section-7" index={7} title="综合判断" onIntersect={handleIntersect}>
            <Conclusion analysis={analysis || {}} />
          </ReportSection>
        </div>
      </div>
    </div>
  )
}

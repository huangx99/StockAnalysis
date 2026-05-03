import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  CheckCircle2, AlertTriangle, Scale, Zap, ChevronDown, Sparkles, Settings,
  Building2, TrendingUp, BarChart3, FileText,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { AIAnalysis } from '@/types'

interface AIInsightPanelProps {
  analysis: Partial<AIAnalysis> | null
  streaming: boolean
  onRegenerate: () => void
}

function ScoreRing({ score }: { score: number }) {
  const radius = 42
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference

  return (
    <div className="relative w-[100px] h-[100px] flex items-center justify-center shrink-0">
      <svg width="100" height="100" className="transform -rotate-90">
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="var(--border-subtle)"
          strokeWidth={6}
        />
        <motion.circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="var(--accent-secondary)"
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, delay: 0.5, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="font-data-lg" style={{ color: 'var(--text-primary)' }}>{score}</span>
        <span className="font-data-sm" style={{ color: 'var(--text-secondary)' }}>/100</span>
      </div>
    </div>
  )
}

function ShimmerBar() {
  return (
    <div className="space-y-2 animate-shimmer">
      <div className="h-3 w-full rounded" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
      <div className="h-3 w-4/5 rounded" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
      <div className="h-3 w-3/5 rounded" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
    </div>
  )
}

function AccordionSection({
  title,
  icon: Icon,
  iconColor,
  children,
  defaultOpen = true,
}: {
  title: string
  icon: React.ElementType
  iconColor: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-lg overflow-hidden"
      style={{ backgroundColor: 'var(--bg-base)' }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-bg-surface-hover"
      >
        <Icon className="w-4 h-4 shrink-0" style={{ color: iconColor }} />
        <span className="font-h3 text-sm flex-1" style={{ color: 'var(--text-primary)' }}>
          {title}
        </span>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
        </motion.div>
      </button>
      <motion.div
        initial={false}
        animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
        transition={{ duration: 0.3 }}
        className="overflow-hidden"
      >
        <div className="px-3 pb-3 pt-1">{children}</div>
      </motion.div>
    </motion.div>
  )
}

const SECTIONS = [
  { key: 'companyOverview', num: 1, title: '公司概况', icon: Building2, color: 'var(--accent-primary)' },
  { key: 'marketPerformance', num: 2, title: '行情表现', icon: TrendingUp, color: 'var(--success)' },
  { key: 'financialPerformance', num: 3, title: '财务表现', icon: BarChart3, color: 'var(--accent-secondary)' },
  { key: 'valuationAnalysis', num: 4, title: '估值分析', icon: Scale, color: 'var(--accent-primary)' },
  { key: 'newsDigest', num: 5, title: '公告与新闻摘要', icon: FileText, color: 'var(--warning)' },
] as const

export default function AIInsightPanel({ analysis, streaming, onRegenerate }: AIInsightPanelProps) {
  const navigate = useNavigate()
  const hasData = analysis && Object.keys(analysis).length > 0

  return (
    <motion.div
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay: 0.4, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] }}
      whileHover={{ boxShadow: '0 0 30px rgba(99,102,241,0.08)' }}
      className="rounded-xl border border-border-subtle p-5 flex flex-col gap-4 transition-shadow"
      style={{
        background: 'linear-gradient(135deg, var(--bg-surface) 0%, rgba(99,102,241,0.03) 100%)',
        borderLeft: '3px solid var(--accent-secondary)',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <img src="/sparkle-icon.svg" alt="sparkle" className="w-4 h-4" />
        <h2 className="font-h2 text-xl" style={{ color: 'var(--text-primary)' }}>AI 综合分析</h2>
        {streaming && (
          <span className="ml-auto font-data-sm flex items-center gap-1.5" style={{ color: 'var(--accent-secondary)' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-accent-secondary animate-pulse" />
            生成中...
          </span>
        )}
      </div>
      <p className="font-body text-sm" style={{ color: 'var(--text-secondary)' }}>
        基于财报、公告、新闻的 AI 评估
      </p>

      {!hasData && !streaming ? (
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <Settings className="w-8 h-8" style={{ color: 'var(--text-muted)' }} />
          <span className="font-body text-sm" style={{ color: 'var(--text-muted)' }}>
            AI 分析服务未配置
          </span>
          <button
            onClick={() => navigate('/settings')}
            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
            style={{
              backgroundColor: 'var(--bg-surface-hover)',
              color: 'var(--accent-primary)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            前往设置
          </button>
        </div>
      ) : (
        <>
          {/* Score ring — show when score arrives */}
          {analysis?.score != null && analysis.score > 0 && (
            <div className="flex items-center gap-4">
              <ScoreRing score={analysis.score} />
              <div className="flex flex-col gap-1">
                <span className="font-body text-sm" style={{ color: 'var(--text-secondary)' }}>
                  投资风格
                </span>
                <span className="font-h3 text-base" style={{ color: 'var(--accent-secondary)' }}>
                  {analysis.style || '...'}
                </span>
              </div>
            </div>
          )}

          {/* Streaming progress indicator */}
          {streaming && !analysis?.score && (
            <div className="flex items-center gap-3 py-2">
              <div className="w-10 h-10 rounded-full border-2 border-accent-secondary border-t-transparent animate-spin" />
              <span className="font-body text-sm" style={{ color: 'var(--text-muted)' }}>AI 正在分析中...</span>
            </div>
          )}

          {/* Collapsible sections — render as content arrives */}
          <div className="flex flex-col gap-2">
            {SECTIONS.map((sec) => {
              const value = analysis?.[sec.key as keyof AIAnalysis]
              const hasContent = value && typeof value === 'string' && value.length > 0
              return (
                <AccordionSection
                  key={sec.key}
                  title={`${sec.num}. ${sec.title}`}
                  icon={sec.icon}
                  iconColor={sec.color}
                >
                  {hasContent ? (
                    <p className="font-body text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                      {value}
                    </p>
                  ) : (
                    <ShimmerBar />
                  )}
                </AccordionSection>
              )
            })}

            {/* Highlights */}
            <AccordionSection
              title="6. 投资亮点"
              icon={CheckCircle2}
              iconColor="var(--success)"
            >
              {analysis?.highlights && analysis.highlights.length > 0 ? (
                <ol className="flex flex-col gap-1.5 list-decimal list-inside">
                  {analysis.highlights.map((item, i) => (
                    <li key={i} className="font-body text-sm pl-1" style={{ color: 'var(--text-primary)' }}>
                      {item}
                    </li>
                  ))}
                </ol>
              ) : (
                <ShimmerBar />
              )}
            </AccordionSection>

            {/* Risks */}
            <AccordionSection
              title="7. 风险因素"
              icon={AlertTriangle}
              iconColor="var(--warning)"
            >
              {analysis?.risks && analysis.risks.length > 0 ? (
                <ol className="flex flex-col gap-1.5 list-decimal list-inside">
                  {analysis.risks.map((item, i) => (
                    <li key={i} className="font-body text-sm pl-1" style={{ color: 'var(--text-primary)' }}>
                      {item}
                    </li>
                  ))}
                </ol>
              ) : (
                <ShimmerBar />
              )}
            </AccordionSection>

            {/* Conclusion */}
            <AccordionSection
              title="8. 综合判断"
              icon={Zap}
              iconColor="var(--accent-secondary)"
            >
              {analysis?.conclusion ? (
                <p className="font-body text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                  {analysis.conclusion}
                </p>
              ) : (
                <ShimmerBar />
              )}
            </AccordionSection>
          </div>

          {/* Regenerate button — only when not streaming */}
          {!streaming && (
            <button
              onClick={onRegenerate}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all hover:scale-[1.01] border border-border-strong mt-2"
              style={{ color: 'var(--text-primary)', backgroundColor: 'var(--bg-surface-hover)' }}
            >
              <Sparkles className="w-4 h-4" />
              重新生成分析
            </button>
          )}
        </>
      )}
    </motion.div>
  )
}

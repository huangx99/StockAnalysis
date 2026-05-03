import { useState } from 'react'
import { motion } from 'framer-motion'
import { ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import type { StockDocument } from '@/types'

interface NewsSummaryCardProps {
  doc: StockDocument
  index: number
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

export default function NewsSummaryCard({ doc, index }: NewsSummaryCardProps) {
  const [expanded, setExpanded] = useState(false)
  const date = doc.publishTime.split(' ')[0]
  const time = doc.publishTime.split(' ')[1] || ''

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: index * 0.08, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] }}
      className="relative flex gap-4"
    >
      {/* Timeline dot + line */}
      <div className="flex flex-col items-center shrink-0 w-20">
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
      <div className="flex-1 pb-4 border-l border-border-subtle pl-4 -ml-[9px]">
        <div
          className="rounded-xl border border-border-subtle p-4 transition-all hover:border-border-strong"
          style={{ backgroundColor: 'var(--bg-base)' }}
        >
          <h3
            className="font-h3 text-base cursor-pointer hover:underline"
            style={{ color: 'var(--text-primary)' }}
            onClick={() => setExpanded((e) => !e)}
          >
            {doc.title}
          </h3>

          <div className="flex flex-wrap items-center gap-2 mt-2">
            <TypeBadge type={doc.type} />
            <span className="font-data-sm" style={{ color: 'var(--text-muted)' }}>
              {doc.source}
            </span>
            {time && (
              <span className="font-data-sm" style={{ color: 'var(--text-muted)' }}>
                {time}
              </span>
            )}
          </div>

          <p className="font-body text-sm mt-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {doc.summary}
          </p>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <SentimentBadge sentiment={doc.sentiment} />
            {doc.risks.map((risk, i) => (
              <span
                key={i}
                className="font-label px-2 py-0.5 rounded"
                style={{ backgroundColor: 'var(--danger)1F', color: 'var(--danger)' }}
              >
                {risk}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-3 mt-3">
            {doc.url && (
              <a
                href={doc.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-sm font-medium transition-colors hover:opacity-80"
                style={{ color: 'var(--accent-primary)' }}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                查看原文
              </a>
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

          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              transition={{ duration: 0.2 }}
              className="mt-3 pt-3 border-t border-border-subtle"
            >
              <p className="font-body text-sm" style={{ color: 'var(--text-muted)' }}>
                更多详情内容待补充...
              </p>
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

import NewsSummaryCard from './NewsSummaryCard'
import type { StockDocument } from '@/types'

interface NewsTimelineProps {
  docs: StockDocument[]
}

export default function NewsTimeline({ docs }: NewsTimelineProps) {
  if (docs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <img src="/empty-state-chart.svg" alt="empty" className="w-[200px] h-[160px] opacity-60" />
        <span className="font-h3 text-lg mt-3" style={{ color: 'var(--text-secondary)' }}>
          暂无相关公告或新闻
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {docs.map((doc, i) => (
        <NewsSummaryCard key={doc.id} doc={doc} index={i} />
      ))}
    </div>
  )
}

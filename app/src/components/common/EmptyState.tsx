interface EmptyStateProps {
  title?: string
  description?: string
  className?: string
}

export default function EmptyState({
  title = '暂无数据',
  description = '暂无相关内容，请稍后重试',
  className = '',
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-12 ${className}`}>
      <img src="/empty-state-chart.svg" alt="empty" className="w-[200px] h-[160px] opacity-60" />
      <span className="font-h3 text-lg" style={{ color: 'var(--text-secondary)' }}>{title}</span>
      <span className="font-body text-sm" style={{ color: 'var(--text-muted)' }}>{description}</span>
    </div>
  )
}

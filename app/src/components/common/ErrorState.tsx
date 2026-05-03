import { AlertTriangle } from 'lucide-react'

interface ErrorStateProps {
  title?: string
  description?: string
  onRetry?: () => void
  className?: string
}

export default function ErrorState({
  title = '加载失败',
  description = '数据加载出错，请检查网络后重试',
  onRetry,
  className = '',
}: ErrorStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-12 ${className}`}>
      <AlertTriangle className="w-8 h-8" style={{ color: 'var(--danger)' }} />
      <span className="font-h3 text-lg" style={{ color: 'var(--text-secondary)' }}>{title}</span>
      <span className="font-body text-sm" style={{ color: 'var(--text-muted)' }}>{description}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all hover:scale-[1.02]"
          style={{ backgroundColor: 'var(--accent-primary)' }}
        >
          重试
        </button>
      )}
    </div>
  )
}

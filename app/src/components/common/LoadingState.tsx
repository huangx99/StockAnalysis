import { Loader2 } from 'lucide-react'

interface LoadingStateProps {
  text?: string
  className?: string
}

export default function LoadingState({ text = '加载中...', className = '' }: LoadingStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-12 ${className}`}>
      <Loader2 className="w-5 h-5 animate-spin-slow" style={{ color: 'var(--accent-primary)' }} />
      <span className="font-body text-sm" style={{ color: 'var(--text-muted)' }}>{text}</span>
    </div>
  )
}

import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer
      className="h-[48px] flex items-center px-6 border-t border-border-subtle"
      style={{ backgroundColor: 'var(--bg-surface)' }}
    >
      <div className="flex items-center gap-4 text-sm" style={{ color: 'var(--text-muted)' }}>
        <span className="font-data-sm">数据引擎</span>
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--success)' }} />
        <span className="font-data-sm">AI 服务</span>
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--success)' }} />
        <span className="font-data-sm hidden sm:inline">数据更新：2026-05-03 15:00</span>
      </div>
      <div className="ml-auto flex items-center gap-4">
        <span className="font-data-sm" style={{ color: 'var(--text-muted)' }}>v1.0.0</span>
        <Link
          to="/"
          className="font-data-sm hover:underline"
          style={{ color: 'var(--accent-primary)' }}
        >
          使用文档
        </Link>
      </div>
    </footer>
  )
}

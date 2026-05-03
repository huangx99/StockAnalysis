import { useCallback } from 'react'
import { motion } from 'framer-motion'

interface ReportTOCProps {
  sections: { id: string; title: string }[]
  activeId: string
  onNavigate: (id: string) => void
  progress: number
}

export default function ReportTOC({ sections, activeId, onNavigate, progress }: ReportTOCProps) {
  const handleClick = useCallback(
    (id: string) => (e: React.MouseEvent) => {
      e.preventDefault()
      onNavigate(id)
    },
    [onNavigate]
  )

  return (
    <div className="sticky top-20 w-[240px] shrink-0 hidden xl:block">
      {/* Progress bar */}
      <div className="h-[2px] w-full rounded-full mb-3" style={{ backgroundColor: 'var(--border-subtle)' }}>
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: 'var(--accent-primary)' }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.2 }}
        />
      </div>

      {/* Nav header */}
      <h3
        className="font-label mb-3"
        style={{ color: 'var(--text-muted)', letterSpacing: '0.05em' }}
      >
        报告目录
      </h3>

      {/* Nav items */}
      <nav className="flex flex-col gap-1">
        {sections.map((section, index) => {
          const isActive = activeId === section.id
          return (
            <motion.a
              key={section.id}
              href={`#${section.id}`}
              onClick={handleClick(section.id)}
              initial={{ opacity: 0, x: -15 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{
                duration: 0.3,
                delay: index * 0.05,
                ease: 'easeOut',
              }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all duration-150 cursor-pointer"
              style={{
                backgroundColor: isActive ? 'var(--bg-surface-hover)' : 'transparent',
                color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                borderLeft: isActive ? '2px solid var(--accent-primary)' : '2px solid transparent',
              }}
            >
              <span
                className="font-data-sm w-6 shrink-0"
                style={{ color: isActive ? 'var(--accent-primary)' : 'var(--text-muted)' }}
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="truncate">{section.title}</span>
            </motion.a>
          )
        })}
      </nav>
    </div>
  )
}

import { useRef, useEffect } from 'react'
import { motion } from 'framer-motion'

interface ReportSectionProps {
  id: string
  index: number
  title: string
  content?: React.ReactNode
  accentColor?: string
  subtitle?: string
  onIntersect?: (id: string) => void
  children?: React.ReactNode
}

const sectionColors = [
  'var(--accent-primary)',
  'var(--chart-ma5)',
  'var(--success)',
  'var(--accent-secondary)',
  'var(--chart-ma10)',
  'var(--up-red)',
  'var(--down-green)',
  'var(--accent-primary)',
]

export default function ReportSection({
  id,
  index,
  title,
  content,
  subtitle,
  onIntersect,
}: ReportSectionProps) {
  const ref = useRef<HTMLDivElement>(null)
  const accentColor = sectionColors[index % sectionColors.length]

  useEffect(() => {
    if (!ref.current || !onIntersect) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            onIntersect(id)
          }
        })
      },
      { threshold: 0.3, rootMargin: '-80px 0px -40% 0px' }
    )

    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [id, onIntersect])

  return (
    <motion.section
      ref={ref}
      id={id}
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.5,
        delay: index * 0.1,
        ease: [0.4, 0, 0.2, 1] as [number, number, number, number],
      }}
      className={index > 0 ? 'pt-8 mt-8 border-t border-border-subtle' : ''}
    >
      {/* Section header */}
      <div className="flex items-center gap-3 mb-4">
        <motion.span
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3, delay: index * 0.1 }}
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white font-data-md"
          style={{ backgroundColor: accentColor }}
        >
          {index + 1}
        </motion.span>
        <h2 className="font-h2" style={{ color: 'var(--text-primary)' }}>
          {title}
        </h2>
      </div>

      {subtitle && (
        <p className="font-body mb-4 ml-11" style={{ color: 'var(--text-secondary)' }}>
          {subtitle}
        </p>
      )}

      {/* Body content */}
      <div className="ml-11">{content}</div>
    </motion.section>
  )
}

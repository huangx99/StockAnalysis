import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

interface SettingsSectionProps {
  title: string
  description?: string
  children: ReactNode
  delay?: number
}

export default function SettingsSection({ title, description, children, delay = 0 }: SettingsSectionProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: delay + 0.1, ease: 'easeOut' }}
      className="rounded-xl border p-6 md:p-8"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
    >
      <h2 className="font-h2 text-lg" style={{ color: 'var(--text-primary)' }}>
        {title}
      </h2>
      {description && (
        <p className="font-body mt-1 mb-6" style={{ color: 'var(--text-secondary)' }}>
          {description}
        </p>
      )}
      <div className="mt-4 space-y-6">{children}</div>
    </motion.div>
  )
}

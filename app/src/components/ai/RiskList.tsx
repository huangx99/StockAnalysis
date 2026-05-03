import { motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'

interface RiskListProps {
  risks: string[]
}

export default function RiskList({ risks }: RiskListProps) {
  return (
    <div className="flex flex-col gap-2">
      {risks.map((risk, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: i * 0.1 }}
          className="flex items-start gap-2 rounded-lg border border-border-subtle px-3 py-2.5"
          style={{ backgroundColor: 'var(--bg-base)' }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--warning)' }} />
          <span className="font-body text-sm" style={{ color: 'var(--text-primary)' }}>
            {risk}
          </span>
        </motion.div>
      ))}
    </div>
  )
}

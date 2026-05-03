import { motion } from 'framer-motion'
import type { DividendRecord } from '@/types'

interface DividendTableProps {
  data: DividendRecord[]
}

export default function DividendTable({ data }: DividendTableProps) {
  if (data.length === 0) {
    return <div className="py-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>暂无分红数据</div>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr style={{ backgroundColor: 'var(--bg-surface-hover)' }}>
            <th className="font-label px-4 py-3" style={{ color: 'var(--text-secondary)' }}>年份</th>
            <th className="font-label px-4 py-3 text-right" style={{ color: 'var(--text-secondary)' }}>每股派息(元)</th>
            <th className="font-label px-4 py-3 text-right" style={{ color: 'var(--text-secondary)' }}>送股</th>
            <th className="font-label px-4 py-3 text-right" style={{ color: 'var(--text-secondary)' }}>转增</th>
            <th className="font-label px-4 py-3" style={{ color: 'var(--text-secondary)' }}>除权除息日</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <motion.tr
              key={row.year}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.05 }}
              className="border-b border-border-subtle hover:bg-bg-surface-hover transition-colors"
            >
              <td className="font-body text-sm px-4 py-3" style={{ color: 'var(--text-primary)' }}>{row.year}</td>
              <td className="font-data-sm px-4 py-3 text-right tabular-nums" style={{ color: row.dividendPerShare > 0 ? 'var(--up-red)' : 'var(--text-muted)' }}>
                {row.dividendPerShare > 0 ? row.dividendPerShare.toFixed(2) : '—'}
              </td>
              <td className="font-data-sm px-4 py-3 text-right tabular-nums" style={{ color: row.bonusShares > 0 ? 'var(--up-red)' : 'var(--text-muted)' }}>
                {row.bonusShares > 0 ? `${row.bonusShares.toFixed(1)}股` : '—'}
              </td>
              <td className="font-data-sm px-4 py-3 text-right tabular-nums" style={{ color: row.reservePerShare > 0 ? 'var(--up-red)' : 'var(--text-muted)' }}>
                {row.reservePerShare > 0 ? `${row.reservePerShare.toFixed(1)}股` : '—'}
              </td>
              <td className="font-data-sm px-4 py-3" style={{ color: 'var(--text-secondary)' }}>
                {row.exDate || '—'}
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

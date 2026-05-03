import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import type { FinancialStatement } from '@/types'
import { formatNumber } from '@/lib/formatters'
import MetricTooltip from '@/components/common/MetricTooltip'

interface FinancialTableProps {
  data: FinancialStatement[]
}

const rows = [
  { key: 'revenue', label: '营业收入', unit: '', isPercent: false, higherIsBetter: true },
  { key: 'netProfit', label: '净利润', unit: '', isPercent: false, higherIsBetter: true },
  { key: 'eps', label: '每股收益(EPS)', unit: '', isPercent: false, higherIsBetter: true },
  { key: 'operatingProfit', label: '营业利润', unit: '', isPercent: false, higherIsBetter: true },
  { key: 'totalProfitBeforeTax', label: '利润总额', unit: '', isPercent: false, higherIsBetter: true },
  { key: 'grossMargin', label: '毛利率', unit: '%', isPercent: true, higherIsBetter: true },
  { key: 'roe', label: 'ROE', unit: '%', isPercent: true, higherIsBetter: true },
  { key: 'operatingCashFlow', label: '经营现金流', unit: '', isPercent: false, higherIsBetter: true },
  { key: 'investingCashFlow', label: '投资现金流', unit: '', isPercent: false, higherIsBetter: true },
  { key: 'financingCashFlow', label: '筹资现金流', unit: '', isPercent: false, higherIsBetter: true },
  { key: 'rdExpense', label: '研发费用', unit: '', isPercent: false, higherIsBetter: true },
  { key: 'financeExpense', label: '财务费用', unit: '', isPercent: false, higherIsBetter: false },
  { key: 'totalAssets', label: '总资产', unit: '', isPercent: false, higherIsBetter: true },
  { key: 'totalLiabilities', label: '总负债', unit: '', isPercent: false, higherIsBetter: false },
  { key: 'equity', label: '股东权益', unit: '', isPercent: false, higherIsBetter: true },
]

function formatValue(value: number, isPercent: boolean): string {
  if (value == null || isNaN(value)) return '—'
  if (isPercent) return `${value.toFixed(1)}%`
  if (value >= 100000000) return `${(value / 100000000).toFixed(0)}亿`
  if (value >= 10000) return `${(value / 10000).toFixed(0)}万`
  return formatNumber(value)
}

function TrendIcon({ values, higherIsBetter }: { values: number[]; higherIsBetter: boolean }) {
  if (values.length < 2) return <Minus className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
  const first = values[0]
  const last = values[values.length - 1]
  const improved = higherIsBetter ? last > first : last < first
  if (improved) return <TrendingUp className="w-3 h-3" style={{ color: 'var(--up-red)' }} />
  return <TrendingDown className="w-3 h-3" style={{ color: 'var(--down-green)' }} />
}

export default function FinancialTable({ data }: FinancialTableProps) {
  const years = data.map((d) => d.year)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr style={{ backgroundColor: 'var(--bg-surface-hover)' }}>
            <th className="font-label px-4 py-3 sticky left-0" style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-surface-hover)' }}>
              指标
            </th>
            {years.map((year) => (
              <th key={year} className="font-label px-4 py-3 text-right" style={{ color: 'var(--text-secondary)' }}>
                {year}
              </th>
            ))}
            <th className="font-label px-4 py-3 text-center" style={{ color: 'var(--text-secondary)' }}>
              趋势
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const values = data.map((d) => d[row.key as keyof FinancialStatement] as number)
            return (
              <motion.tr
                key={row.key}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.03 }}
                className="border-b border-border-subtle hover:bg-bg-surface-hover transition-colors"
              >
                <td className="font-body text-sm px-4 py-3 sticky left-0" style={{ color: 'var(--text-primary)', backgroundColor: 'inherit' }}>
                  <MetricTooltip label={row.label} />
                </td>
                {years.map((year, yi) => (
                  <td key={year} className="font-data-sm px-4 py-3 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {formatValue(values[yi], row.isPercent)}
                  </td>
                ))}
                <td className="px-4 py-3 text-center">
                  <div className="inline-flex items-center justify-center w-6">
                    <TrendIcon values={values} higherIsBetter={row.higherIsBetter} />
                  </div>
                </td>
              </motion.tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

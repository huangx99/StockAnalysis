import { useState, useMemo } from 'react'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { motion } from 'framer-motion'
import type { FinancialStatement } from '@/types'

interface FinancialTrendChartProps {
  data: FinancialStatement[]
}

type SubTab = 'growth' | 'profit' | 'cashflow' | 'valuation'

export default function FinancialTrendChart({ data }: FinancialTrendChartProps) {
  const [subTab, setSubTab] = useState<SubTab>('growth')

  const toYi = (v: number) => Number(((v ?? 0) / 100000000).toFixed(1))

  const chartData = useMemo(() => {
    return [...data]
      .sort((a, b) => a.year - b.year)
      .map((d) => ({
      year: String(d.year),
      revenue: toYi(d.revenue),
      netProfit: toYi(d.netProfit),
      grossMargin: d.grossMargin ?? 0,
      roe: d.roe ?? 0,
      operatingCashFlow: toYi(d.operatingCashFlow),
      investingCashFlow: toYi(d.investingCashFlow),
      financingCashFlow: toYi(d.financingCashFlow),
      totalAssets: toYi(d.totalAssets),
      totalLiabilities: toYi(d.totalLiabilities),
      equity: toYi(d.equity),
    }))
  }, [data])

  const tabs: { key: SubTab; label: string }[] = [
    { key: 'growth', label: '成长性' },
    { key: 'profit', label: '盈利能力' },
    { key: 'cashflow', label: '现金流' },
    { key: 'valuation', label: '资产负债' },
  ]

  const renderChart = () => {
    switch (subTab) {
      case 'growth':
        return (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border-subtle)' }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={50} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={50} />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', fontSize: '12px', fontFamily: 'JetBrains Mono' }}
                labelStyle={{ color: 'var(--text-primary)' }}
              />
              <Legend wrapperStyle={{ fontSize: '12px', color: 'var(--text-secondary)' }} />
              <Line yAxisId="left" type="monotone" dataKey="revenue" name="营收(亿)" stroke="var(--chart-line)" strokeWidth={2} dot={{ r: 3 }} />
              <Line yAxisId="right" type="monotone" dataKey="netProfit" name="净利润(亿)" stroke="var(--success)" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        )
      case 'profit':
        return (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border-subtle)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={40} domain={[0, 100]} />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', fontSize: '12px', fontFamily: 'JetBrains Mono' }}
                labelStyle={{ color: 'var(--text-primary)' }}
              />
              <Legend wrapperStyle={{ fontSize: '12px', color: 'var(--text-secondary)' }} />
              <Line type="monotone" dataKey="grossMargin" name="毛利率(%)" stroke="var(--accent-primary)" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="roe" name="ROE(%)" stroke="var(--accent-secondary)" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        )
      case 'cashflow':
        return (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border-subtle)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={50} />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', fontSize: '12px', fontFamily: 'JetBrains Mono' }}
                labelStyle={{ color: 'var(--text-primary)' }}
              />
              <Legend wrapperStyle={{ fontSize: '12px', color: 'var(--text-secondary)' }} />
              <Bar dataKey="operatingCashFlow" name="经营现金流(亿)" fill="var(--chart-line)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="investingCashFlow" name="投资现金流(亿)" fill="var(--accent-secondary)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="financingCashFlow" name="筹资现金流(亿)" fill="var(--chart-ma20)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )
      case 'valuation':
        return (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border-subtle)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={50} />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', fontSize: '12px', fontFamily: 'JetBrains Mono' }}
                labelStyle={{ color: 'var(--text-primary)' }}
              />
              <Legend wrapperStyle={{ fontSize: '12px', color: 'var(--text-secondary)' }} />
              <Bar dataKey="totalAssets" name="总资产(亿)" fill="var(--chart-ma5)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="equity" name="股东权益(亿)" fill="var(--chart-ma10)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="totalLiabilities" name="总负债(亿)" fill="var(--danger)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className="px-3 py-1 rounded-md text-sm font-medium transition-all"
            style={{
              backgroundColor: subTab === t.key ? 'var(--accent-primary)' : 'transparent',
              color: subTab === t.key ? '#fff' : 'var(--text-secondary)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <motion.div
        key={subTab}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {renderChart()}
      </motion.div>
    </div>
  )
}

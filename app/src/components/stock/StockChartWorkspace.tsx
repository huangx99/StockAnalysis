import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, BarChart3, CheckCircle2, LineChart as LineChartIcon, PieChart as PieChartIcon, ShieldCheck } from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  Radar,
  RadarChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { DividendRecord, FinancialPeriodMetrics, FinancialStatement, FinancialSummary, KLineData, MarketStats, StockDocument, TechnicalIndicators } from '@/types'
import { analyzeFinancialInsights, type FinancialInsight, type FinancialInsightResult } from '@/components/stock/financialInsightEngine'

const COLORS = ['var(--accent-primary)', 'var(--accent-secondary)', 'var(--chart-ma20)', 'var(--up-red)', 'var(--down-green)', 'var(--warning)', 'var(--danger)']
const chartMargin = { top: 12, right: 16, bottom: 8, left: 0 }

function n(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function toYi(value: number | null | undefined): number {
  return Number((n(value) / 100000000).toFixed(2))
}

function toWan(value: number | null | undefined): number {
  return Number((n(value) / 10000).toFixed(2))
}

function pct(value: number | null | undefined): number {
  return Number(n(value).toFixed(2))
}

function formatMoney(value: number | null | undefined): string {
  if (!value || Number.isNaN(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 100000000) return `${(value / 100000000).toFixed(1)}亿`
  if (abs >= 10000) return `${(value / 10000).toFixed(0)}万`
  return value.toFixed(0)
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return `${value.toFixed(1)}%`
}

function formatRatio(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return value.toFixed(2)
}

function EmptyChart({ text = '数据不足，暂无法生成图表' }: { text?: string }) {
  return (
    <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed border-border-subtle text-sm" style={{ color: 'var(--text-muted)' }}>
      {text}
    </div>
  )
}

function ChartCard({ title, subtitle, icon, children, height = 300, insight }: { title: string; subtitle?: string; icon?: React.ReactNode; children: React.ReactNode; height?: number; insight?: FinancialInsight }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="rounded-xl border border-border-subtle p-4"
      style={{ backgroundColor: 'var(--bg-base)' }}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-h3 text-base" style={{ color: 'var(--text-primary)' }}>
            {icon}
            {title}
          </div>
          {subtitle && <div className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{subtitle}</div>}
        </div>
      </div>
      <div style={{ height }}>{children}</div>
      {insight && <InsightPanel insight={insight} />}
    </motion.section>
  )
}

function tooltipStyle() {
  return {
    backgroundColor: 'var(--bg-elevated)',
    border: '1px solid var(--border-subtle)',
    borderRadius: '8px',
    color: 'var(--text-primary)',
    fontSize: '12px',
    boxShadow: '0 10px 24px rgba(0,0,0,0.18)',
  }
}

function MetricTile({ label, value, hint, positive }: { label: string; value: string; hint?: string; positive?: boolean }) {
  return (
    <div className="rounded-lg border border-border-subtle px-3 py-2" style={{ backgroundColor: 'var(--bg-surface)' }}>
      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <div className="mt-1 font-data-md" style={{ color: positive == null ? 'var(--text-primary)' : positive ? 'var(--up-red)' : 'var(--down-green)' }}>{value}</div>
      {hint && <div className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{hint}</div>}
    </div>
  )
}

function statusColor(level: string, trend?: string) {
  if (level === '优秀' || level === '良好' || trend === '改善') return 'var(--up-red)'
  if (level === '风险' || trend === '恶化' || trend === '拐点') return 'var(--down-green)'
  if (trend === '放缓') return 'var(--warning)'
  return 'var(--text-secondary)'
}

function InsightPanel({ insight }: { insight: FinancialInsight }) {
  const color = statusColor(insight.level, insight.trend)
  return (
    <div className="mt-4 rounded-lg border border-border-subtle p-3" style={{ backgroundColor: 'var(--bg-surface)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded px-2 py-0.5 text-xs font-medium" style={{ color, backgroundColor: `${color}1f` }}>{insight.level}</span>
        <span className="rounded px-2 py-0.5 text-xs font-medium" style={{ color: statusColor('', insight.trend), backgroundColor: `${statusColor('', insight.trend)}1f` }}>趋势：{insight.trend}</span>
        {insight.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="rounded px-2 py-0.5 text-xs" style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-elevated)' }}>{tag}</span>
        ))}
      </div>

      <div className="mt-3 rounded-md border border-border-subtle p-3" style={{ backgroundColor: 'var(--bg-base)' }}>
        <div className="text-xs font-medium" style={{ color: 'var(--accent-primary)' }}>结论</div>
        <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>{insight.decision}</p>
        <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{insight.impact}</p>
      </div>

      <div className="mt-3">
        <div className="mb-1 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>实际依据</div>
        <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
          {insight.evidence.slice(0, 4).map((item) => (
            <div key={item} className="text-xs" style={{ color: 'var(--text-secondary)' }}>• {item}</div>
          ))}
        </div>
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium" style={{ color: 'var(--accent-primary)' }}>查看后续关注与计算公式</summary>
        <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
          <div className="rounded-md border border-border-subtle p-2" style={{ backgroundColor: 'var(--bg-base)' }}>
            <div className="mb-1 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>后续关注</div>
            {insight.watchList.map((item) => (
              <div key={item} className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>• {item}</div>
            ))}
          </div>
          <div className="rounded-md border border-border-subtle p-2" style={{ backgroundColor: 'var(--bg-base)' }}>
            <div className="mb-1 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>计算公式</div>
            {insight.formulas.map((formula) => (
              <div key={formula} className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>• {formula}</div>
            ))}
          </div>
        </div>
      </details>
    </div>
  )
}

function FinancialCommandCenter({ result }: { result: FinancialInsightResult }) {
  const riskColor = result.riskLevel === '高' ? 'var(--down-green)' : result.riskLevel === '中' ? 'var(--warning)' : 'var(--up-red)'
  const levelColor = statusColor(result.score.rating.startsWith('A') || result.score.rating.startsWith('B') ? '优秀' : result.score.rating.startsWith('D') || result.score.rating.startsWith('E') ? '风险' : '一般')
  return (
    <section className="rounded-xl border border-border-subtle p-5" style={{ backgroundColor: 'var(--bg-base)' }}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-4xl">
          <div className="mb-2 text-xs font-medium" style={{ color: 'var(--accent-secondary)' }}>本地规则引擎 · 决策驾驶舱 · 可复核</div>
          <h3 className="font-h3 text-xl leading-snug" style={{ color: 'var(--text-primary)' }}>{result.headline}</h3>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{result.conclusion}</p>
        </div>
        <div className="grid min-w-[320px] grid-cols-2 gap-3">
          <MetricTile label="综合评分" value={`${result.score.total || '—'}`} hint={result.score.rating} positive={result.score.total >= 75} />
          <MetricTile label="风险等级" value={result.riskLevel} hint={result.riskReasons.slice(0, 1).join('')} positive={result.riskLevel === '低'} />
          <MetricTile label="投资类型" value={result.investmentType} />
          <MetricTile label="生命周期" value={result.lifecycle} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="rounded-lg border border-border-subtle p-3 xl:col-span-2" style={{ backgroundColor: 'var(--bg-surface)' }}>
          <div className="mb-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>核心判断</div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {result.keyFindings.map((finding) => (
              <div key={finding} className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>• {finding}</div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-border-subtle p-3" style={{ backgroundColor: 'var(--bg-surface)' }}>
          <div className="mb-2 text-sm font-medium" style={{ color: riskColor }}>风险原因</div>
          {result.riskReasons.slice(0, 4).map((reason) => (
            <div key={reason} className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>• {reason}</div>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-border-subtle p-3" style={{ backgroundColor: 'var(--bg-surface)' }}>
          <div className="mb-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>跨模块推理</div>
          {result.crossFindings.map((finding) => (
            <div key={finding} className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>• {finding}</div>
          ))}
        </div>
        <div className="rounded-lg border border-border-subtle p-3" style={{ backgroundColor: 'var(--bg-surface)' }}>
          <div className="mb-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>接下来重点关注</div>
          {result.watchList.map((item) => (
            <div key={item} className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>• {item}</div>
          ))}
        </div>
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium" style={{ color: levelColor }}>查看评分公式与模块结论</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-border-subtle p-3" style={{ backgroundColor: 'var(--bg-surface)' }}>
            <div className="mb-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>评分公式</div>
            {result.score.formulas.map((formula) => (
              <div key={formula} className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>• {formula}</div>
            ))}
          </div>
          <div className="rounded-lg border border-border-subtle p-3" style={{ backgroundColor: 'var(--bg-surface)' }}>
            <div className="mb-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>模块结论</div>
            {result.score.reasons.map((reason) => (
              <div key={reason} className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>• {reason}</div>
            ))}
          </div>
        </div>
      </details>
    </section>
  )
}

function ScoreTrendChart({ result }: { result: FinancialInsightResult }) {
  if (result.score.points.length === 0) return <EmptyChart text="暂无评分趋势数据" />
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={result.score.points} margin={chartMargin}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} />
        <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={42} />
        <Tooltip contentStyle={tooltipStyle()} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="growth" name="成长" stackId="score" fill="var(--accent-primary)" />
        <Bar dataKey="profitability" name="盈利" stackId="score" fill="var(--up-red)" />
        <Bar dataKey="cashflow" name="现金流" stackId="score" fill="var(--accent-secondary)" />
        <Bar dataKey="safety" name="安全" stackId="score" fill="var(--warning)" />
        <Bar dataKey="efficiency" name="效率" stackId="score" fill="var(--chart-ma20)" />
        <Line type="monotone" dataKey="score" name="总分" stroke="var(--text-primary)" strokeWidth={2.5} dot />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function SectionTitle({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="font-h3 text-lg" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{desc}</p>
    </div>
  )
}

function hasChartData(rows: Array<Record<string, unknown>>, keys: string[]): boolean {
  return rows.some((row) => keys.some((key) => {
    const value = row[key]
    return typeof value === 'number' && Number.isFinite(value) && value !== 0
  }))
}

function useFinancialRows(summary: FinancialSummary | null, periods: FinancialPeriodMetrics[]) {
  return useMemo(() => {
    const annualSource = summary?.annual?.length ? summary.annual : periods.filter((item) => item.reportQuarter === 'FY')
    const quarterSource = summary?.quarterly?.length ? summary.quarterly : periods
    const annual = [...annualSource].sort((a, b) => a.reportDate.localeCompare(b.reportDate))
    const quarterly = [...quarterSource].sort((a, b) => a.reportDate.localeCompare(b.reportDate)).slice(-16)
    return { annual, quarterly }
  }, [periods, summary])
}

function financialChartRows(rows: FinancialPeriodMetrics[]) {
  return rows.map((row) => {
    const revenue = n(row.revenue)
    const sales = n(row.salesExpense)
    const manage = n(row.manageExpense)
    const rd = n(row.rdExpense)
    const finance = n(row.financeExpense)
    const equityMultiplier = n(row.equity) ? n(row.totalAssets) / n(row.equity) : 0
    return {
      period: `${row.reportYear}${row.reportQuarter}`,
      reportDate: row.reportDate,
      revenue: toYi(row.revenue),
      revenueYoY: pct(row.revenueYoY),
      grossProfit: toYi(row.grossProfit),
      operatingProfit: toYi(row.operatingProfit),
      netProfit: toYi(row.netProfit),
      netProfitYoY: pct(row.netProfitYoY),
      deductedNetProfit: toYi(row.deductedNetProfit),
      grossMargin: pct(row.grossMargin),
      netMargin: pct(row.netMargin),
      roe: pct(row.roe),
      roa: pct(row.roa),
      eps: n(row.eps),
      totalAssets: toYi(row.totalAssets),
      totalLiabilities: toYi(row.totalLiabilities),
      equity: toYi(row.equity),
      debtAssetRatio: pct(row.debtAssetRatio),
      cash: toYi(row.cash),
      accountsReceivable: toYi(row.accountsReceivable),
      inventory: toYi(row.inventory),
      contractLiability: toYi(row.contractLiability),
      goodwill: toYi(row.goodwill),
      currentRatio: n(row.currentRatio),
      quickRatio: n(row.quickRatio),
      operatingCashFlow: toYi(row.operatingCashFlow),
      operatingCashFlowYoY: pct(row.operatingCashFlowYoY),
      investingCashFlow: toYi(row.investingCashFlow),
      financingCashFlow: toYi(row.financingCashFlow),
      freeCashFlow: toYi(row.freeCashFlow),
      cfoToNetProfit: pct(row.cfoToNetProfit),
      capex: toYi(row.capex),
      salesExpense: toYi(row.salesExpense),
      manageExpense: toYi(row.manageExpense),
      rdExpense: toYi(row.rdExpense),
      financeExpense: toYi(row.financeExpense),
      salesExpenseRatio: revenue ? Number(((sales / revenue) * 100).toFixed(2)) : 0,
      manageExpenseRatio: revenue ? Number(((manage / revenue) * 100).toFixed(2)) : 0,
      rdExpenseRatio: revenue ? Number(((rd / revenue) * 100).toFixed(2)) : 0,
      financeExpenseRatio: revenue ? Number(((finance / revenue) * 100).toFixed(2)) : 0,
      assetTurnover: n(row.assetTurnover),
      receivableTurnover: n(row.receivableTurnover),
      inventoryTurnover: n(row.inventoryTurnover),
      equityMultiplier: Number(equityMultiplier.toFixed(2)),
    }
  })
}

function FinancialScoreCharts({ summary }: { summary: FinancialSummary | null }) {
  if (!summary) return <EmptyChart text="暂无财务评分数据" />
  const scoreRows = [
    { subject: '成长', score: n(summary.scores.growth) },
    { subject: '盈利', score: n(summary.scores.profitability) },
    { subject: '现金流', score: n(summary.scores.cashflow) },
    { subject: '偿债', score: n(summary.scores.solvency) },
    { subject: '效率', score: n(summary.scores.efficiency) },
    { subject: '回报', score: n(summary.scores.shareholderReturn) },
  ]
  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart data={scoreRows} outerRadius="72%">
        <PolarGrid stroke="var(--chart-grid)" />
        <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
        <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
        <Radar dataKey="score" name="评分" stroke="var(--accent-primary)" fill="var(--accent-primary)" fillOpacity={0.28} />
        <Tooltip contentStyle={tooltipStyle()} />
      </RadarChart>
    </ResponsiveContainer>
  )
}

function FinancialOverviewCards({ summary }: { summary: FinancialSummary | null }) {
  const latest = summary?.latestPeriod
  if (!latest) return null
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
      <MetricTile label="营业收入" value={formatMoney(latest.revenue)} hint={`YoY ${formatPercent(latest.revenueYoY)}`} positive={latest.revenueYoY >= 0} />
      <MetricTile label="归母净利润" value={formatMoney(latest.netProfit)} hint={`YoY ${formatPercent(latest.netProfitYoY)}`} positive={latest.netProfitYoY >= 0} />
      <MetricTile label="毛利率" value={formatPercent(latest.grossMargin)} />
      <MetricTile label="净利率" value={formatPercent(latest.netMargin)} />
      <MetricTile label="ROE" value={formatPercent(latest.roe)} />
      <MetricTile label="经营现金流" value={formatMoney(latest.operatingCashFlow)} positive={latest.operatingCashFlow >= 0} />
      <MetricTile label="资产负债率" value={formatPercent(latest.debtAssetRatio)} positive={latest.debtAssetRatio <= 65} />
      <MetricTile label="财务总分" value={String(summary?.scores.total || '—')} hint={latest.reportDate} />
    </div>
  )
}

function FinancialRiskPanel({ summary }: { summary: FinancialSummary | null }) {
  if (!summary) return null
  return (
    <div className="rounded-xl border border-border-subtle p-4" style={{ backgroundColor: 'var(--bg-base)' }}>
      <div className="mb-3 flex items-center gap-2 font-h3 text-base" style={{ color: 'var(--text-primary)' }}>
        <ShieldCheck className="h-4 w-4" style={{ color: 'var(--accent-secondary)' }} />
        风险与质量提示
      </div>
      {summary.alerts.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-border-subtle px-4 py-3 text-sm" style={{ color: 'var(--success)', backgroundColor: 'var(--bg-surface)' }}>
          <CheckCircle2 className="h-4 w-4" />
          暂未触发财务异常规则
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {summary.alerts.map((alert, index) => (
            <div key={`${alert.metric}-${index}`} className="flex gap-3 rounded-lg border border-border-subtle px-4 py-3" style={{ backgroundColor: 'var(--bg-surface)' }}>
              <AlertTriangle className="mt-0.5 h-4 w-4" style={{ color: alert.level === 'danger' ? 'var(--danger)' : 'var(--warning)' }} />
              <div>
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{alert.title}</div>
                <div className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{alert.message}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LegacyFinancialRows({ data }: { data: FinancialStatement[] }) {
  if (!data.length) return []
  return [...data]
    .sort((a, b) => a.year - b.year)
    .map((row) => ({
      period: String(row.year),
      revenue: toYi(row.revenue),
      operatingProfit: toYi(row.operatingProfit),
      netProfit: toYi(row.netProfit),
      grossMargin: pct(row.grossMargin),
      roe: pct(row.roe),
      eps: n(row.eps),
      operatingCashFlow: toYi(row.operatingCashFlow),
      investingCashFlow: toYi(row.investingCashFlow),
      financingCashFlow: toYi(row.financingCashFlow),
      totalAssets: toYi(row.totalAssets),
      totalLiabilities: toYi(row.totalLiabilities),
      equity: toYi(row.equity),
      rdExpense: toYi(row.rdExpense),
      financeExpense: toYi(row.financeExpense),
    }))
}

export function FinancialChartWorkspace({ data, periods, summary, dividends }: { data: FinancialStatement[]; periods: FinancialPeriodMetrics[]; summary: FinancialSummary | null; dividends: DividendRecord[] }) {
  const { annual, quarterly } = useFinancialRows(summary, periods)
  const [mode, setMode] = useState<'annual' | 'quarterly'>('annual')
  const selected = mode === 'annual' ? annual : quarterly
  const insightResult = useMemo(() => analyzeFinancialInsights(selected), [selected])
  const rows: Array<Record<string, number | string>> = selected.length ? financialChartRows(selected) : LegacyFinancialRows({ data })
  const dividendRows = useMemo(() => [...dividends].sort((a, b) => a.year - b.year), [dividends])
  const hasPeriodData = rows.length > 0

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionTitle title="图表化财务分析" desc="优先用图展示增长、盈利、现金流、资产负债、费用、效率、杜邦和分红，原始表格放在最下方。" />
        <div className="flex gap-2">
          {[
            { key: 'annual', label: '年度' },
            { key: 'quarterly', label: '季度' },
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => setMode(item.key as 'annual' | 'quarterly')}
              className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
              style={{ backgroundColor: mode === item.key ? 'var(--accent-primary)' : 'var(--bg-base)', color: mode === item.key ? '#fff' : 'var(--text-secondary)' }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <FinancialOverviewCards summary={summary} />
      <FinancialCommandCenter result={insightResult} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard title="财务健康雷达" subtitle="展示成长、盈利、现金流、偿债、效率、股东回报六个维度" icon={<PieChartIcon className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />}>
          <FinancialScoreCharts summary={summary} />
        </ChartCard>
        <ChartCard title="综合评分趋势" subtitle="按成长、盈利、现金流、安全、效率五项拆分，观察公司是变好还是变差" icon={<LineChartIcon className="h-4 w-4" style={{ color: 'var(--accent-secondary)' }} />}>
          <ScoreTrendChart result={insightResult} />
        </ChartCard>
      </div>

      <FinancialRiskPanel summary={summary} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard title="增长：营收与利润" subtitle="柱形看规模，折线看利润，适合判断成长是否兑现" icon={<BarChart3 className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />} insight={insightResult.insights.growth}>
          {!hasPeriodData || !hasChartData(rows, ['revenue', 'netProfit']) ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                <Tooltip contentStyle={tooltipStyle()} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="revenue" name="营收(亿)" fill="var(--accent-primary)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="netProfit" name="净利润(亿)" fill="var(--accent-secondary)" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="operatingProfit" name="经营利润(亿)" stroke="var(--chart-ma20)" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="增长：同比变化" subtitle="看营收和净利润是否同步改善，识别增收不增利" icon={<LineChartIcon className="h-4 w-4" style={{ color: 'var(--accent-secondary)' }} />} insight={insightResult.insights.growth}>
          {!hasPeriodData || !hasChartData(rows, ['revenueYoY', 'netProfitYoY']) ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={48} unit="%" />
                <Tooltip contentStyle={tooltipStyle()} formatter={(value) => `${Number(value).toFixed(1)}%`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={0} stroke="var(--border-subtle)" />
                <Line type="monotone" dataKey="revenueYoY" name="营收YoY" stroke="var(--accent-primary)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="netProfitYoY" name="净利YoY" stroke="var(--up-red)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="盈利能力" subtitle="毛利率、净利率、ROE、ROA一起看，判断利润质量" icon={<LineChartIcon className="h-4 w-4" style={{ color: 'var(--up-red)' }} />} insight={insightResult.insights.profitability}>
          {!hasPeriodData || !hasChartData(rows, ['grossMargin', 'netMargin', 'roe', 'roa']) ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={48} unit="%" />
                <Tooltip contentStyle={tooltipStyle()} formatter={(value) => `${Number(value).toFixed(1)}%`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="grossMargin" name="毛利率" stroke="var(--accent-primary)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="netMargin" name="净利率" stroke="var(--accent-secondary)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="roe" name="ROE" stroke="var(--up-red)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="roa" name="ROA" stroke="var(--chart-ma20)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="每股收益 EPS" subtitle="观察利润增长是否传导到每股收益" icon={<LineChartIcon className="h-4 w-4" style={{ color: 'var(--warning)' }} />} insight={insightResult.insights.profitability}>
          {!hasPeriodData || !hasChartData(rows, ['eps']) ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                <Tooltip contentStyle={tooltipStyle()} />
                <Area type="monotone" dataKey="eps" name="EPS" stroke="var(--warning)" fill="var(--warning)" fillOpacity={0.2} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="现金流质量" subtitle="经营现金流对比净利润，判断利润是否有现金支撑" icon={<BarChart3 className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />} insight={insightResult.insights.cashflow}>
          {!hasPeriodData || !hasChartData(rows, ['operatingCashFlow', 'netProfit']) ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                <Tooltip contentStyle={tooltipStyle()} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={0} stroke="var(--border-subtle)" />
                <Bar dataKey="operatingCashFlow" name="经营现金流(亿)" fill="var(--accent-primary)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="netProfit" name="净利润(亿)" fill="var(--up-red)" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="cfoToNetProfit" name="CFO/净利(%)" stroke="var(--warning)" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="三大现金流与 FCF" subtitle="经营、投资、筹资现金流和自由现金流，识别扩张或融资压力" icon={<BarChart3 className="h-4 w-4" style={{ color: 'var(--accent-secondary)' }} />} insight={insightResult.insights.cashflow}>
          {!hasPeriodData || !hasChartData(rows, ['operatingCashFlow', 'investingCashFlow', 'financingCashFlow', 'freeCashFlow']) ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                <Tooltip contentStyle={tooltipStyle()} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={0} stroke="var(--border-subtle)" />
                <Bar dataKey="operatingCashFlow" name="经营现金流(亿)" fill="var(--accent-primary)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="investingCashFlow" name="投资现金流(亿)" fill="var(--chart-ma20)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="financingCashFlow" name="筹资现金流(亿)" fill="var(--warning)" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="freeCashFlow" name="FCF(亿)" stroke="var(--up-red)" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="资产负债结构" subtitle="总资产、总负债、权益与负债率，判断杠杆变化" icon={<BarChart3 className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />} insight={insightResult.insights.safety}>
          {!hasPeriodData || !hasChartData(rows, ['totalAssets', 'totalLiabilities', 'equity']) ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} />
                <YAxis yAxisId="left" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={40} unit="%" />
                <Tooltip contentStyle={tooltipStyle()} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="left" dataKey="totalAssets" name="总资产(亿)" fill="var(--accent-primary)" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="left" dataKey="totalLiabilities" name="总负债(亿)" fill="var(--danger)" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="left" dataKey="equity" name="权益(亿)" fill="var(--accent-secondary)" radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="debtAssetRatio" name="资产负债率" stroke="var(--warning)" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="资产质量拆解" subtitle="现金、应收、存货、合同负债、商誉，识别占用和减值风险" icon={<BarChart3 className="h-4 w-4" style={{ color: 'var(--accent-secondary)' }} />} insight={insightResult.insights.safety}>
          {!hasPeriodData || !hasChartData(rows, ['cash', 'accountsReceivable', 'inventory', 'contractLiability', 'goodwill']) ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                <Tooltip contentStyle={tooltipStyle()} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="cash" name="货币资金(亿)" stackId="a" fill="var(--accent-primary)" />
                <Bar dataKey="accountsReceivable" name="应收(亿)" stackId="a" fill="var(--chart-ma20)" />
                <Bar dataKey="inventory" name="存货(亿)" stackId="a" fill="var(--warning)" />
                <Bar dataKey="contractLiability" name="合同负债(亿)" stackId="a" fill="var(--accent-secondary)" />
                <Bar dataKey="goodwill" name="商誉(亿)" stackId="a" fill="var(--danger)" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="费用投入" subtitle="销售、管理、研发、财务费用，用于观察投入结构" icon={<BarChart3 className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />} insight={insightResult.insights.expense}>
          {!hasPeriodData || !hasChartData(rows, ['salesExpense', 'manageExpense', 'rdExpense', 'financeExpense']) ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                <Tooltip contentStyle={tooltipStyle()} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="salesExpense" name="销售费用(亿)" fill="var(--accent-primary)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="manageExpense" name="管理费用(亿)" fill="var(--accent-secondary)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="rdExpense" name="研发费用(亿)" fill="var(--up-red)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="financeExpense" name="财务费用(亿)" fill="var(--warning)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="费用率" subtitle="费用除以营收，判断费用投放效率和研发强度" icon={<LineChartIcon className="h-4 w-4" style={{ color: 'var(--accent-secondary)' }} />} insight={insightResult.insights.expense}>
          {!hasPeriodData || !hasChartData(rows, ['salesExpenseRatio', 'manageExpenseRatio', 'rdExpenseRatio', 'financeExpenseRatio']) ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={48} unit="%" />
                <Tooltip contentStyle={tooltipStyle()} formatter={(value) => `${Number(value).toFixed(1)}%`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="salesExpenseRatio" name="销售费用率" stroke="var(--accent-primary)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="manageExpenseRatio" name="管理费用率" stroke="var(--accent-secondary)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="rdExpenseRatio" name="研发费用率" stroke="var(--up-red)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="financeExpenseRatio" name="财务费用率" stroke="var(--warning)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="运营效率" subtitle="资产、应收、存货周转率，观察资产使用效率" icon={<LineChartIcon className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />} insight={insightResult.insights.efficiency}>
          {!hasPeriodData || !hasChartData(rows, ['assetTurnover', 'receivableTurnover', 'inventoryTurnover']) ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                <Tooltip contentStyle={tooltipStyle()} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="assetTurnover" name="资产周转率" stroke="var(--accent-primary)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="receivableTurnover" name="应收周转率" stroke="var(--accent-secondary)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="inventoryTurnover" name="存货周转率" stroke="var(--warning)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="杜邦拆解" subtitle="ROE = 净利率 × 资产周转率 × 权益乘数，定位 ROE 来源" icon={<LineChartIcon className="h-4 w-4" style={{ color: 'var(--up-red)' }} />} insight={insightResult.insights.profitability}>
          {!hasPeriodData || !hasChartData(rows, ['roe', 'netMargin', 'assetTurnover', 'equityMultiplier']) ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                <Tooltip contentStyle={tooltipStyle()} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="roe" name="ROE(%)" fill="var(--up-red)" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="netMargin" name="净利率(%)" stroke="var(--accent-primary)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="assetTurnover" name="资产周转率" stroke="var(--accent-secondary)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="equityMultiplier" name="权益乘数" stroke="var(--warning)" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="分红配送" subtitle="每股派息、送股、转增，观察股东回报稳定性" icon={<BarChart3 className="h-4 w-4" style={{ color: 'var(--accent-secondary)' }} />}>
          {dividendRows.length === 0 ? <EmptyChart text="暂无分红配送数据" /> : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dividendRows} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="year" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                <Tooltip contentStyle={tooltipStyle()} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="dividendPerShare" name="每股派息" fill="var(--up-red)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="bonusShares" name="送股" fill="var(--accent-primary)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="reservePerShare" name="转增" fill="var(--accent-secondary)" radius={[4, 4, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="偿债能力" subtitle="流动比率、速动比率、资产负债率，观察短期偿债安全垫" icon={<LineChartIcon className="h-4 w-4" style={{ color: 'var(--warning)' }} />} insight={insightResult.insights.safety}>
          {!hasPeriodData || !hasChartData(rows, ['currentRatio', 'quickRatio', 'debtAssetRatio']) ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="period" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                <Tooltip contentStyle={tooltipStyle()} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="currentRatio" name="流动比率" stroke="var(--accent-primary)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="quickRatio" name="速动比率" stroke="var(--accent-secondary)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="debtAssetRatio" name="资产负债率(%)" stroke="var(--warning)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  )
}

function technicalSignalColor(signal: string) {
  if (signal.includes('多') || signal.includes('强')) return 'var(--up-red)'
  if (signal.includes('空') || signal.includes('弱')) return 'var(--down-green)'
  return 'var(--warning)'
}

export function MarketChartWorkspace({ klineData, stats, indicators }: { klineData: KLineData[]; stats: MarketStats | null; indicators: TechnicalIndicators | null }) {
  const priceRows = useMemo(() => klineData.slice(-180).map((row) => ({
    date: row.date,
    close: n(row.close),
    ma5: n(row.ma5),
    ma10: n(row.ma10),
    ma20: n(row.ma20),
    ma60: n(row.ma60),
    volume: toWan(row.volume),
  })), [klineData])
  const returnRows = stats ? [
    { label: '5日', value: pct(stats.change5d) },
    { label: '20日', value: pct(stats.change20d) },
    { label: '60日', value: pct(stats.change60d) },
    { label: '年初至今', value: pct(stats.changeYtd) },
    { label: '波动率', value: pct(stats.volatility) },
    { label: '最大回撤', value: pct(stats.maxDrawdown) },
  ] : []
  const techRows = indicators ? [
    { name: '均线系统', value: indicators.maSignal, desc: indicators.maDesc },
    { name: 'MACD', value: indicators.macdSignal, desc: indicators.macdDesc },
    { name: 'RSI(14)', value: `${indicators.rsiValue.toFixed(1)} · ${indicators.rsiSignal}`, desc: indicators.rsiDesc },
    { name: '布林带', value: indicators.bollingerSignal, desc: indicators.bollingerDesc },
  ] : []

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle title="图表化行情分析" desc="K线在页面上方保留，这里补充收益、成交量、均线和技术信号图表。" />
      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MetricTile label="近5日" value={formatPercent(stats.change5d)} positive={stats.change5d >= 0} />
          <MetricTile label="近20日" value={formatPercent(stats.change20d)} positive={stats.change20d >= 0} />
          <MetricTile label="近60日" value={formatPercent(stats.change60d)} positive={stats.change60d >= 0} />
          <MetricTile label="年初至今" value={formatPercent(stats.changeYtd)} positive={stats.changeYtd >= 0} />
          <MetricTile label="20日波动率" value={formatPercent(stats.volatility)} />
          <MetricTile label="最大回撤" value={formatPercent(stats.maxDrawdown)} positive={stats.maxDrawdown >= -15} />
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard title="区间表现" subtitle="收益、波动和回撤横向比较，快速判断强弱与风险" icon={<BarChart3 className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />}>
          {returnRows.length === 0 ? <EmptyChart text="暂无行情统计数据" /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={returnRows} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} unit="%" />
                <Tooltip contentStyle={tooltipStyle()} formatter={(value) => `${Number(value).toFixed(2)}%`} />
                <ReferenceLine y={0} stroke="var(--border-subtle)" />
                <Bar dataKey="value" name="涨跌/风险" radius={[4, 4, 0, 0]}>
                  {returnRows.map((item) => <Cell key={item.label} fill={item.value >= 0 ? 'var(--up-red)' : 'var(--down-green)'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="收盘价与均线" subtitle="最近180个交易日，观察趋势和均线支撑/压力" icon={<LineChartIcon className="h-4 w-4" style={{ color: 'var(--accent-secondary)' }} />}>
          {priceRows.length === 0 ? <EmptyChart text="暂无K线数据" /> : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={priceRows} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} minTickGap={28} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={48} domain={['dataMin', 'dataMax']} />
                <Tooltip contentStyle={tooltipStyle()} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="close" name="收盘" stroke="var(--accent-primary)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="ma5" name="MA5" stroke="var(--chart-ma5)" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="ma20" name="MA20" stroke="var(--chart-ma20)" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="ma60" name="MA60" stroke="var(--chart-ma60)" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="成交量" subtitle="最近180个交易日成交量，用于识别放量和缩量" icon={<BarChart3 className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />}>
          {priceRows.length === 0 ? <EmptyChart text="暂无成交量数据" /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={priceRows} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} minTickGap={28} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                <Tooltip contentStyle={tooltipStyle()} />
                <Bar dataKey="volume" name="成交量(万)" fill="var(--accent-secondary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <div className="rounded-xl border border-border-subtle p-4" style={{ backgroundColor: 'var(--bg-base)' }}>
          <div className="mb-3 flex items-center gap-2 font-h3 text-base" style={{ color: 'var(--text-primary)' }}>
            <ShieldCheck className="h-4 w-4" style={{ color: 'var(--accent-secondary)' }} />
            技术指标信号卡
          </div>
          {techRows.length === 0 ? <EmptyChart text="暂无技术指标数据" /> : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {techRows.map((row) => (
                <div key={row.name} className="rounded-lg border border-border-subtle p-3" style={{ backgroundColor: 'var(--bg-surface)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{row.name}</span>
                    <span className="rounded px-2 py-0.5 text-xs font-medium" style={{ color: technicalSignalColor(row.value), backgroundColor: `${technicalSignalColor(row.value)}22` }}>{row.value}</span>
                  </div>
                  <div className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{row.desc}</div>
                </div>
              ))}
              {indicators && (
                <div className="rounded-lg border border-border-subtle p-3 sm:col-span-2" style={{ backgroundColor: 'var(--bg-surface)' }}>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <MetricTile label="MA5 / MA20" value={`${formatRatio(indicators.ma5)} / ${formatRatio(indicators.ma20)}`} />
                    <MetricTile label="MACD DIF/DEA" value={`${formatRatio(indicators.macdDif)} / ${formatRatio(indicators.macdDea)}`} />
                    <MetricTile label="RSI" value={formatRatio(indicators.rsiValue)} positive={indicators.rsiValue <= 70 && indicators.rsiValue >= 30} />
                    <MetricTile label="布林位置" value={indicators.bollingerPosition || '—'} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function NewsChartWorkspace({ docs }: { docs: StockDocument[] }) {
  const { monthlyRows, typeRows, sentimentRows, sourceRows } = useMemo(() => {
    const monthly = new Map<string, number>()
    const typeMap = new Map<string, number>()
    const sentimentMap = new Map<string, number>()
    const sourceMap = new Map<string, number>()
    docs.forEach((doc) => {
      const month = (doc.publishTime || '').slice(0, 7) || '未知'
      monthly.set(month, (monthly.get(month) || 0) + 1)
      const typeLabel = doc.type === 'announcement' ? '公告' : doc.type === 'report' ? '研报' : '新闻'
      typeMap.set(typeLabel, (typeMap.get(typeLabel) || 0) + 1)
      const sentimentLabel = doc.sentiment === 'positive' ? '正面' : doc.sentiment === 'negative' ? '负面' : '中性'
      sentimentMap.set(sentimentLabel, (sentimentMap.get(sentimentLabel) || 0) + 1)
      const source = doc.source || '未知来源'
      sourceMap.set(source, (sourceMap.get(source) || 0) + 1)
    })
    return {
      monthlyRows: Array.from(monthly.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(-18).map(([month, count]) => ({ month, count })),
      typeRows: Array.from(typeMap.entries()).map(([name, value]) => ({ name, value })),
      sentimentRows: Array.from(sentimentMap.entries()).map(([name, value]) => ({ name, value })),
      sourceRows: Array.from(sourceMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([source, count]) => ({ source, count })),
    }
  }, [docs])

  return (
    <div className="mb-6 flex flex-col gap-6">
      <SectionTitle title="图表化资讯分析" desc="先看公告、新闻、研报的数量、情绪和来源分布，原文列表放在图表下方。" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard title="月度信息密度" subtitle="公告/新闻/研报数量变化，辅助识别事件密集期" icon={<BarChart3 className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />}>
          {monthlyRows.length === 0 ? <EmptyChart text="暂无新闻公告数据" /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyRows} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} minTickGap={18} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle()} />
                <Bar dataKey="count" name="数量" fill="var(--accent-primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
        <ChartCard title="类型分布" subtitle="公告、新闻、研报占比，判断信息来源结构" icon={<PieChartIcon className="h-4 w-4" style={{ color: 'var(--accent-secondary)' }} />}>
          {typeRows.length === 0 ? <EmptyChart text="暂无类型分布数据" /> : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={typeRows} dataKey="value" nameKey="name" outerRadius={92} label>
                  {typeRows.map((item, index) => <Cell key={item.name} fill={COLORS[index % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle()} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
        <ChartCard title="情绪分布" subtitle="基于本地文档情绪字段，快速识别正负面比例" icon={<PieChartIcon className="h-4 w-4" style={{ color: 'var(--warning)' }} />}>
          {sentimentRows.length === 0 ? <EmptyChart text="暂无情绪数据" /> : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={sentimentRows} dataKey="value" nameKey="name" innerRadius={54} outerRadius={92} label>
                  {sentimentRows.map((item) => <Cell key={item.name} fill={item.name === '正面' ? 'var(--up-red)' : item.name === '负面' ? 'var(--down-green)' : 'var(--warning)'} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle()} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
        <ChartCard title="主要来源" subtitle="统计来源出现次数，帮助判断信息覆盖来自哪里" icon={<BarChart3 className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />}>
          {sourceRows.length === 0 ? <EmptyChart text="暂无来源数据" /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sourceRows} layout="vertical" margin={{ top: 12, right: 16, bottom: 8, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
                <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis dataKey="source" type="category" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} width={78} />
                <Tooltip contentStyle={tooltipStyle()} />
                <Bar dataKey="count" name="数量" fill="var(--accent-secondary)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  )
}

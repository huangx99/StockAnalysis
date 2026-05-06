import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, BarChart3, Brain, Loader2, RefreshCw, SearchCheck, Target, TrendingUp } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { getIndustryList, runBacktestValidation } from '@/api/real/stockApi'
import type { BacktestResponse, BacktestStockRow, IndustrySummaryItem } from '@/types'

type ActiveTab = 'strategy' | 'industry' | 'factor' | 'mistake'
type ScoreMode = 'composite' | 'opportunity' | 'quality' | 'growth' | 'profitability' | 'cashflow' | 'safety' | 'efficiency' | 'valuation'

const SCORE_LABELS: Record<ScoreMode, string> = {
  composite: '综合分',
  opportunity: '投资机会分',
  quality: '长期质量分',
  growth: '成长分',
  profitability: '盈利分',
  cashflow: '现金流分',
  safety: '安全分',
  efficiency: '效率分',
  valuation: '估值分',
}

const FACTOR_LABELS: Record<string, string> = {
  composite: '综合',
  opportunity: '机会',
  quality: '质量',
  growth: '成长',
  profitability: '盈利',
  cashflow: '现金流',
  safety: '安全',
  efficiency: '效率',
  valuation: '估值',
}

const COLORS = ['var(--accent-primary)', 'var(--accent-secondary)', 'var(--warning)', 'var(--up-red)', 'var(--chart-ma20)']

function tooltipStyle() {
  return {
    backgroundColor: 'var(--bg-elevated)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 8,
    color: 'var(--text-primary)',
  }
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-border-subtle ${className}`} style={{ backgroundColor: 'var(--bg-surface)' }}>{children}</section>
}

function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border-subtle px-3 py-2" style={{ backgroundColor: 'var(--bg-base)' }}>
      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <div className="mt-1 font-data-md" style={{ color: tone || 'var(--text-primary)' }}>{value}</div>
      {hint && <div className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{hint}</div>}
    </div>
  )
}

function pct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

function toneForReturn(value: number) {
  if (value > 0) return 'var(--up-red)'
  if (value < 0) return 'var(--down-green)'
  return 'var(--text-primary)'
}

function rankIcLabel(value: number) {
  if (value >= 0.15) return '有效'
  if (value >= 0.05) return '弱有效'
  if (value > -0.05) return '不明显'
  return '反向'
}

function BacktestTable({ rows, showReasons = false }: { rows: BacktestStockRow[]; showReasons?: boolean }) {
  const navigate = useNavigate()
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1180px] text-left">
        <thead style={{ backgroundColor: 'var(--bg-surface-hover)' }}>
          <tr>
            {['排名', '股票', '评分', '收益', '超额', '最大回撤', '1月/3月/6月/12月', '验证区间', '依据期', showReasons ? '误判原因' : '分项'].map((item) => (
              <th key={item} className="px-4 py-3 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{item}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.symbol}-${index}`} className="border-b border-border-subtle hover:bg-bg-surface-hover transition-colors">
              <td className="px-4 py-3 font-data-sm">#{index + 1}</td>
              <td className="px-4 py-3">
                <button onClick={() => navigate(`/stock/${row.symbol}`)} className="text-left">
                  <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{row.name || row.symbol}</div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{row.symbol} · {row.industry}</div>
                </button>
              </td>
              <td className="px-4 py-3 font-data-sm" style={{ color: 'var(--accent-primary)' }}>{row.score.toFixed(1)}</td>
              <td className="px-4 py-3 font-data-sm" style={{ color: toneForReturn(row.returnPct) }}>{pct(row.returnPct)}</td>
              <td className="px-4 py-3 font-data-sm" style={{ color: toneForReturn(row.excessReturn) }}>{pct(row.excessReturn)}</td>
              <td className="px-4 py-3 font-data-sm" style={{ color: 'var(--down-green)' }}>{pct(row.maxDrawdown)}</td>
              <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                {pct(row.horizons.m1)} / {pct(row.horizons.m3)} / {pct(row.horizons.m6)} / {pct(row.horizons.m12)}
              </td>
              <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{row.startDate} → {row.endDate}</td>
              <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{row.latestPeriod}</td>
              <td className="px-4 py-3 text-xs max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                {showReasons ? (row.reasons.length ? row.reasons.join('；') : '需人工复核公告、行业景气或数据质量') : `成长${row.scoreBreakdown.growth?.toFixed(0)} / 盈利${row.scoreBreakdown.profitability?.toFixed(0)} / 现金流${row.scoreBreakdown.cashflow?.toFixed(0)} / 估值${row.scoreBreakdown.valuation?.toFixed(0)}`}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={10} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>暂无数据</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export default function BacktestValidation() {
  const [industries, setIndustries] = useState<IndustrySummaryItem[]>([])
  const [industry, setIndustry] = useState('医疗器械')
  const [asOfDate, setAsOfDate] = useState('2025-01-02')
  const [endDate, setEndDate] = useState('2025-12-31')
  const [topN, setTopN] = useState(10)
  const [scoreMode, setScoreMode] = useState<ScoreMode>('opportunity')
  const [formula, setFormula] = useState('')
  const [sortFormula, setSortFormula] = useState('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [rebalanceFrequency, setRebalanceFrequency] = useState<'none' | 'quarter'>('quarter')
  const [activeTab, setActiveTab] = useState<ActiveTab>('strategy')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<BacktestResponse | null>(null)

  useEffect(() => {
    getIndustryList()
      .then((res) => {
        setIndustries(res.items)
        if (!res.items.some((item) => item.industry === industry) && res.items.length) setIndustry(res.items[0].industry)
      })
      .catch(() => setIndustries([]))
  }, [])

  const run = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await runBacktestValidation({
        industry,
        asOfDate,
        endDate,
        topN,
        scoreMode,
        formula: formula.trim() || null,
        sortFormula: sortFormula.trim() || null,
        sortDir,
        rebalanceFrequency,
        benchmark: 'industry_equal',
        minPeriods: 2,
        maxSymbols: 3000,
      })
      setResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : '回测失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    run()
  }, [])

  const groupChartData = useMemo(() => result?.groups.summary.map((item) => ({ ...item, name: item.group.replace('组', '') })) ?? [], [result])
  const factorChartData = useMemo(() => result?.factorValidation.map((item) => ({ ...item, name: FACTOR_LABELS[item.factor] || item.factor })) ?? [], [result])
  const topChartData = useMemo(() => result?.topRows.slice(0, 15).map((row) => ({ name: row.name || row.symbol, 收益: row.returnPct, 超额: row.excessReturn, 评分: row.score })) ?? [], [result])
  const rollingChartData = useMemo(() => result?.rolling.map((row) => ({ ...row, label: row.asOfDate.slice(5) })) ?? [], [result])

  return (
    <div className="p-4 md:p-6 max-w-[1800px] mx-auto flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          <SearchCheck className="w-4 h-4" />
          模型校验系统
        </div>
        <h1 className="font-h1 text-2xl md:text-3xl" style={{ color: 'var(--text-primary)' }}>回测验证</h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>用历史可见数据选股，再验证未来走势：策略回测、行业模型分层、评分有效性、误判复盘一次完成。</p>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-8 xl:items-end">
          <label className="flex flex-col gap-1 xl:col-span-2">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>行业</span>
            <select value={industry} onChange={(event) => setIndustry(event.target.value)} className="rounded-lg border border-border-subtle px-3 py-2 outline-none" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>
              {industries.map((item) => <option key={item.industry} value={item.industry}>{item.industry}（{item.scorableCount}/{item.count}）</option>)}
              {!industries.length && <option value={industry}>{industry}</option>}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>选股日期</span>
            <input type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} className="rounded-lg border border-border-subtle px-3 py-2 outline-none" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>结束日期</span>
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="rounded-lg border border-border-subtle px-3 py-2 outline-none" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Top N</span>
            <select value={topN} onChange={(event) => setTopN(Number(event.target.value))} className="rounded-lg border border-border-subtle px-3 py-2 outline-none" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>
              {[10, 20, 30, 50].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>评分模型</span>
            <select value={scoreMode} onChange={(event) => setScoreMode(event.target.value as ScoreMode)} className="rounded-lg border border-border-subtle px-3 py-2 outline-none" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>
              {Object.entries(SCORE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>滚动调仓</span>
            <select value={rebalanceFrequency} onChange={(event) => setRebalanceFrequency(event.target.value as 'none' | 'quarter')} className="rounded-lg border border-border-subtle px-3 py-2 outline-none" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>
              <option value="none">单次验证</option>
              <option value="quarter">季度滚动</option>
            </select>
          </label>
          <button onClick={run} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50" style={{ backgroundColor: 'var(--accent-primary)' }}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            运行验证
          </button>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1fr_160px]">
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>策略筛选公式（可选，按历史可见字段执行）</span>
            <input value={formula} onChange={(event) => setFormula(event.target.value)} placeholder="例如：@医疗器械行业 AND @最新年度ROE > 10 AND @最新年度净利润同比 > 0" className="rounded-lg border border-border-subtle px-3 py-2 outline-none" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>排序公式（可选）</span>
            <input value={sortFormula} onChange={(event) => setSortFormula(event.target.value)} placeholder="例如：@最新年度ROE + @最新年度净利润同比" className="rounded-lg border border-border-subtle px-3 py-2 outline-none" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>排序方向</span>
            <select value={sortDir} onChange={(event) => setSortDir(event.target.value as 'asc' | 'desc')} className="rounded-lg border border-border-subtle px-3 py-2 outline-none" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}>
              <option value="desc">从高到低</option>
              <option value="asc">从低到高</option>
            </select>
          </label>
        </div>
      </Card>

      {error && <Card className="p-4 text-sm"><span style={{ color: 'var(--danger)' }}>{error}</span></Card>}

      {result && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Metric label="样本公司" value={`${result.universeCount}`} hint="历史可评分" />
            <Metric label="Top收益" value={pct(result.topPortfolio.avgReturn)} tone={toneForReturn(result.topPortfolio.avgReturn)} hint="等权平均" />
            <Metric label="行业基准" value={pct(result.benchmarkReturn)} tone={toneForReturn(result.benchmarkReturn)} />
            <Metric label="超额收益" value={pct(result.topPortfolio.avgExcess)} tone={toneForReturn(result.topPortfolio.avgExcess)} />
            <Metric label="胜率" value={`${result.topPortfolio.winRate.toFixed(1)}%`} hint="Top组合正收益" />
            <Metric label="最大回撤" value={pct(result.topPortfolio.maxDrawdown)} tone="var(--down-green)" />
            <Metric label="Rank IC" value={String(result.rankIc)} hint={rankIcLabel(result.rankIc)} tone={result.rankIc >= 0 ? 'var(--accent-primary)' : 'var(--warning)'} />
            <Metric label="误判样本" value={`${result.mistakes.length}`} hint="高分低收益" tone="var(--warning)" />
          </div>

          <Card className="p-4">
            <div className="flex items-start gap-3">
              <Brain className="mt-0.5 w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
              <div>
                <h2 className="font-h3 text-lg" style={{ color: 'var(--text-primary)' }}>验证结论</h2>
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                  {result.insights.map((item) => (
                    <div key={item} className="rounded-lg border border-border-subtle px-3 py-2 text-sm" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-secondary)' }}>{item}</div>
                  ))}
                </div>
                <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>回测只使用选股日期前已披露财务数据；显式公式字段也按历史可见数据解释，避免未来函数。</p>
              </div>
            </div>
          </Card>

          <div className="flex items-center gap-2 border-b border-border-subtle">
            {[
              { key: 'strategy', label: '策略回测', icon: Target },
              { key: 'industry', label: '行业模型验证', icon: BarChart3 },
              { key: 'factor', label: '评分有效性', icon: TrendingUp },
              { key: 'mistake', label: '误判复盘', icon: AlertTriangle },
            ].map((tab) => {
              const Icon = tab.icon
              return (
                <button key={tab.key} onClick={() => setActiveTab(tab.key as ActiveTab)} className="relative inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium" style={{ color: activeTab === tab.key ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>
                  <Icon className="w-4 h-4" />
                  {tab.label}
                  {activeTab === tab.key && <span className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ backgroundColor: 'var(--accent-primary)' }} />}
                </button>
              )
            })}
          </div>

          {activeTab === 'strategy' && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
              <Card className="p-4">
                <h2 className="font-h3 text-lg mb-2" style={{ color: 'var(--text-primary)' }}>Top组合收益</h2>
                <div className="h-[340px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} interval={0} angle={-18} height={58} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                      <Tooltip contentStyle={tooltipStyle()} />
                      <Legend />
                      <Bar dataKey="收益" radius={[4, 4, 0, 0]}>{topChartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Bar>
                      <Bar dataKey="超额" fill="var(--warning)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card className="overflow-hidden">
                <div className="px-4 py-3 border-b border-border-subtle">
                  <h2 className="font-h3 text-lg" style={{ color: 'var(--text-primary)' }}>策略持仓明细</h2>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>验证 {asOfDate} 当天按 {SCORE_LABELS[scoreMode]} / 公式选出的 Top {topN}</p>
                </div>
                <BacktestTable rows={result.topRows} />
              </Card>
            </div>
          )}

          {activeTab === 'industry' && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.85fr_1.15fr]">
              <Card className="p-4">
                <h2 className="font-h3 text-lg mb-2" style={{ color: 'var(--text-primary)' }}>高/中/低分组表现</h2>
                <div className="h-[340px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={groupChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                      <Tooltip contentStyle={tooltipStyle()} />
                      <Legend />
                      <Bar dataKey="avgReturn" name="平均收益" fill="var(--accent-primary)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="avgExcess" name="平均超额" fill="var(--warning)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card className="p-4">
                <h2 className="font-h3 text-lg mb-2" style={{ color: 'var(--text-primary)' }}>季度滚动验证</h2>
                <div className="h-[340px]">
                  {rollingChartData.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={rollingChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                        <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                        <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                        <Tooltip contentStyle={tooltipStyle()} />
                        <Legend />
                        <Line type="monotone" dataKey="avgReturn" name="Top收益" stroke="var(--accent-primary)" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="benchmarkReturn" name="基准" stroke="var(--warning)" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="avgExcess" name="超额" stroke="var(--up-red)" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : <div className="flex h-full items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>开启“季度滚动”后显示</div>}
                </div>
              </Card>
              <Card className="overflow-hidden xl:col-span-2">
                <div className="px-4 py-3 border-b border-border-subtle"><h2 className="font-h3 text-lg" style={{ color: 'var(--text-primary)' }}>全行业评分样本</h2></div>
                <BacktestTable rows={result.allRows.slice(0, 80)} />
              </Card>
            </div>
          )}

          {activeTab === 'factor' && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
              <Card className="p-4">
                <h2 className="font-h3 text-lg mb-2" style={{ color: 'var(--text-primary)' }}>因子Rank IC</h2>
                <div className="h-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={factorChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                      <Tooltip contentStyle={tooltipStyle()} />
                      <Bar dataKey="rankIc" name="Rank IC" fill="var(--accent-primary)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card className="overflow-hidden">
                <div className="px-4 py-3 border-b border-border-subtle"><h2 className="font-h3 text-lg" style={{ color: 'var(--text-primary)' }}>评分有效性明细</h2></div>
                <table className="w-full text-left">
                  <thead style={{ backgroundColor: 'var(--bg-surface-hover)' }}><tr>{['因子', 'Rank IC', '有效性', 'Top20%收益', 'Top20%胜率'].map((item) => <th key={item} className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{item}</th>)}</tr></thead>
                  <tbody>{result.factorValidation.map((item) => <tr key={item.factor} className="border-b border-border-subtle"><td className="px-4 py-3">{FACTOR_LABELS[item.factor] || item.factor}</td><td className="px-4 py-3 font-data-sm">{item.rankIc}</td><td className="px-4 py-3">{rankIcLabel(item.rankIc)}</td><td className="px-4 py-3 font-data-sm" style={{ color: toneForReturn(item.topAvgReturn) }}>{pct(item.topAvgReturn)}</td><td className="px-4 py-3 font-data-sm">{item.topWinRate.toFixed(1)}%</td></tr>)}</tbody>
                </table>
              </Card>
            </div>
          )}

          {activeTab === 'mistake' && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-border-subtle">
                <h2 className="font-h3 text-lg" style={{ color: 'var(--text-primary)' }}>高分低收益误判复盘</h2>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>自动识别 Top组合中明显跑输基准或大幅下跌的股票，并给出模型修正线索。</p>
              </div>
              <BacktestTable rows={result.mistakes} showReasons />
            </Card>
          )}
        </>
      )}
    </div>
  )
}

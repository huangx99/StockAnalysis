import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  BarChart3, CheckCircle, Download, Eye, Loader2, RefreshCw, Sparkles, Trash2, X, XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import MetricTooltip from '@/components/common/MetricTooltip'
import {
  analyzeMarketData,
  cancelMarketDataDownload,
  deleteMarketData,
  getMarketDataDetail,
  getMarketDataSnapshots,
  getMarketDataStatus,
  getMarketTradeDates,
  pauseMarketDataDownload,
  resetMarketDataStatus,
  resumeMarketDataDownload,
  startMarketDataDownload,
} from '@/api/real/stockApi'
import type { MarketAIAnalysis } from '@/api/real/stockApi'
import type { MarketDataSummary, MarketDownloadStatus } from '@/types'

const MARKET_DATA_TYPE_LABELS: Record<string, string> = {
  overview: '市场概览',
  market_indices: '核心指数',
  breadth: '市场宽度',
  style_rotation: '风格轮动',
  north_money: '北向资金',
  sector_rank: '行业涨幅',
  sector_fund_flow: '行业资金流',
  limit_up_pool: '涨停池',
  limit_down_pool: '跌停池',
  sentiment: '情绪指标',
  quality_report: '质量报告',
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i]
}

function formatMoney(value?: number | null): string {
  if (!value || Number.isNaN(value)) return '—'
  if (Math.abs(value) >= 1000000000000) return `${(value / 1000000000000).toFixed(2)}万亿`
  return `${(value / 100000000).toFixed(0)}亿`
}

function formatNumber(value?: number | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—'
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(/,/g, '').replace('%', ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function formatTableValue(column: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  const numeric = toNumber(value)
  if (numeric === null) return String(value)
  if (column.includes('时间') && /^\d{6}$/.test(String(value))) return String(value).replace(/(\d{2})(\d{2})(\d{2})/, '$1:$2:$3')
  if (column.includes('代码') || column.includes('序号') || column.includes('排名') || column.includes('连板') || column.includes('次数') || column.includes('家数') || column.includes('上涨数') || column.includes('下跌数') || column.includes('持平数')) {
    return numeric.toFixed(0)
  }
  if (column.includes('成交额') || column.includes('净流入') || column.includes('净额') || column.includes('资金') || column.includes('市值') || column.includes('余额')) {
    const abs = Math.abs(numeric)
    if (abs >= 100000000) return `${(numeric / 100000000).toFixed(2)}亿`
    if (abs >= 10000) return `${(numeric / 10000).toFixed(2)}万`
    return numeric.toFixed(2)
  }
  if (column.includes('涨跌幅') || column.includes('净占比') || column.includes('换手率') || column.includes('振幅') || column.includes('涨幅') || column.includes('跌幅')) {
    return `${numeric.toFixed(2)}%`
  }
  return numeric.toFixed(2)
}

function getValueTone(column: string, value: unknown): 'up' | 'down' | 'neutral' {
  const numeric = toNumber(value)
  if (numeric === null || numeric === 0) return 'neutral'
  const isDirectional = column.includes('涨跌') || column.includes('涨幅') || column.includes('跌幅') || column.includes('净流入') || column.includes('净额') || column.includes('净买') || column.includes('净占比')
  if (!isDirectional) return 'neutral'
  return numeric > 0 ? 'up' : 'down'
}

function toneColor(tone: 'up' | 'down' | 'neutral'): string {
  if (tone === 'up') return 'var(--up-red)'
  if (tone === 'down') return 'var(--down-green)'
  return 'var(--text-primary)'
}

function CompactMetric({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' | 'neutral' }) {
  const color = tone === 'up' ? 'var(--up-red)' : tone === 'down' ? 'var(--down-green)' : 'var(--text-primary)'
  const parts = value.includes('/') ? value.split('/').map((item) => item.trim()) : null
  return (
    <div className="rounded-lg border border-border-subtle px-4 py-3" style={{ backgroundColor: 'var(--bg-base)' }}>
      <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}><MetricTooltip label={label} /></div>
      {parts && parts.length === 2 ? (
        <div className="font-data-md">
          <span style={{ color: 'var(--up-red)' }}>{parts[0]}</span>
          <span style={{ color: 'var(--text-muted)' }}> / </span>
          <span style={{ color: 'var(--down-green)' }}>{parts[1]}</span>
        </div>
      ) : parts && parts.length === 3 ? (
        <div className="font-data-md">
          <span style={{ color: 'var(--up-red)' }}>{parts[0]}</span>
          <span style={{ color: 'var(--text-muted)' }}> / </span>
          <span style={{ color: 'var(--down-green)' }}>{parts[1]}</span>
          <span style={{ color: 'var(--text-muted)' }}> / {parts[2]}</span>
        </div>
      ) : (
        <div className="font-data-md" style={{ color }}>{value}</div>
      )}
    </div>
  )
}


type MetricTone = 'up' | 'down' | 'neutral'

type DecisionPoint = {
  label: string
  value: string
  passed: boolean
  warning?: boolean
}

type DecisionMetric = {
  label: string
  value: string
  delta: string
  tone: MetricTone
}

function formatCompactMoney(value?: number | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1000000000000) return `${(value / 1000000000000).toFixed(2)}万亿`
  if (abs >= 100000000) return `${(value / 100000000).toFixed(0)}亿`
  if (abs >= 10000) return `${(value / 10000).toFixed(0)}万`
  return value.toFixed(0)
}

function formatSignedNumber(value?: number | null, suffix = ''): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(0)}${suffix}`
}

function formatSignedDecimal(value?: number | null, suffix = ''): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}${suffix}`
}

function deltaTone(delta?: number | null, inverse = false): MetricTone {
  if (delta === undefined || delta === null || Number.isNaN(delta) || delta === 0) return 'neutral'
  const positive = inverse ? delta < 0 : delta > 0
  return positive ? 'up' : 'down'
}

function valueAsNumber(record: Record<string, unknown> | null | undefined, key: string): number | null {
  if (!record) return null
  return toNumber(record[key])
}

function valueAsString(record: Record<string, unknown> | null | undefined, key: string): string {
  const value = record?.[key]
  return value === undefined || value === null || value === '' ? '—' : String(value)
}

function qualityTone(level?: string): MetricTone {
  if (level === 'complete') return 'up'
  if (level === 'error') return 'down'
  return 'neutral'
}

function percentDelta(current?: number | null, previous?: number | null): string {
  if (!current || !previous) return '—'
  const delta = ((current - previous) / previous) * 100
  return formatSignedDecimal(delta, '%')
}

function normalizeDateRange(startDate: string, endDate: string): [string, string] {
  return startDate <= endDate ? [startDate, endDate] : [endDate, startDate]
}

function getStatusLabel(status: MarketDownloadStatus['status']): string {
  const labels: Record<MarketDownloadStatus['status'], string> = {
    idle: '空闲',
    running: '下载中',
    pausing: '暂停中',
    paused: '已暂停',
    cancelling: '取消中',
    cancelled: '已取消',
    completed: '已完成',
    error: '失败',
  }
  return labels[status]
}

function isActiveDownload(status?: MarketDownloadStatus | null): boolean {
  return status?.status === 'running' || status?.status === 'pausing' || status?.status === 'cancelling'
}

function buildDecisionMetrics(current: MarketDataSummary, previous: MarketDataSummary | null): DecisionMetric[] {
  const currentOverview = current.overview
  const currentSentiment = current.sentiment
  const previousOverview = previous?.overview
  const previousSentiment = previous?.sentiment

  const turnoverDelta = currentOverview && previousOverview ? currentOverview.totalTurnover - previousOverview.totalTurnover : null
  const limitUpDelta = currentSentiment && previousSentiment ? currentSentiment.limitUpCount - previousSentiment.limitUpCount : null
  const limitDownDelta = currentSentiment && previousSentiment ? currentSentiment.limitDownCount - previousSentiment.limitDownCount : null
  const highestBoardDelta = currentSentiment && previousSentiment ? currentSentiment.highestBoard - previousSentiment.highestBoard : null
  const breakRateDelta = currentSentiment && previousSentiment ? currentSentiment.breakRate - previousSentiment.breakRate : null
  const avgChangeDelta = currentOverview && previousOverview ? currentOverview.avgChangePercent - previousOverview.avgChangePercent : null

  return [
    {
      label: '两市成交额',
      value: formatCompactMoney(currentOverview?.totalTurnover),
      delta: turnoverDelta === null ? '较区间首日 —' : `${formatCompactMoney(turnoverDelta)} / ${percentDelta(currentOverview?.totalTurnover, previousOverview?.totalTurnover)}`,
      tone: deltaTone(turnoverDelta),
    },
    {
      label: '涨停家数',
      value: `${currentSentiment?.limitUpCount ?? currentOverview?.limitUpCount ?? 0}`,
      delta: `较区间首日 ${formatSignedNumber(limitUpDelta)}`,
      tone: deltaTone(limitUpDelta),
    },
    {
      label: '跌停家数',
      value: `${currentSentiment?.limitDownCount ?? currentOverview?.limitDownCount ?? 0}`,
      delta: `较区间首日 ${formatSignedNumber(limitDownDelta)}`,
      tone: deltaTone(limitDownDelta, true),
    },
    {
      label: '最高连板',
      value: `${currentSentiment?.highestBoard ?? 0}板`,
      delta: `较区间首日 ${formatSignedNumber(highestBoardDelta, '板')}`,
      tone: deltaTone(highestBoardDelta),
    },
    {
      label: '炸板率',
      value: `${(currentSentiment?.breakRate ?? 0).toFixed(2)}%`,
      delta: `较区间首日 ${formatSignedDecimal(breakRateDelta, 'pct')}`,
      tone: deltaTone(breakRateDelta, true),
    },
    {
      label: '平均涨幅',
      value: `${(currentOverview?.avgChangePercent ?? 0).toFixed(2)}%`,
      delta: `较区间首日 ${formatSignedDecimal(avgChangeDelta, 'pct')}`,
      tone: deltaTone(avgChangeDelta),
    },
  ]
}

function buildMarketDecision(current: MarketDataSummary, previous: MarketDataSummary | null) {
  const overview = current.overview
  const sentiment = current.sentiment
  const previousOverview = previous?.overview
  const previousSentiment = previous?.sentiment
  if (!overview && !sentiment) return null

  const limitUpCount = sentiment?.limitUpCount ?? overview?.limitUpCount ?? 0
  const limitDownCount = sentiment?.limitDownCount ?? overview?.limitDownCount ?? 0
  const highestBoard = sentiment?.highestBoard ?? 0
  const breakRate = sentiment?.breakRate ?? 0
  const upCount = overview?.upCount ?? 0
  const downCount = overview?.downCount ?? 0
  const turnover = overview?.totalTurnover ?? 0
  const previousTurnover = previousOverview?.totalTurnover ?? 0
  const limitUpDelta = previousSentiment ? limitUpCount - previousSentiment.limitUpCount : null
  const highestBoardDelta = previousSentiment ? highestBoard - previousSentiment.highestBoard : null
  const turnoverDeltaPercent = turnover && previousTurnover ? ((turnover - previousTurnover) / previousTurnover) * 100 : null

  let score = 0
  if (limitUpCount >= 80) score += 2
  else if (limitUpCount >= 50) score += 1
  else if (limitUpCount < 25) score -= 2

  if (limitDownCount <= 10) score += 1
  else if (limitDownCount >= 30) score -= 2
  else if (limitDownCount >= 15) score -= 1

  if (highestBoard >= 5) score += 2
  else if (highestBoard >= 3) score += 1
  else if (highestBoard <= 1) score -= 1

  if (breakRate >= 60) score -= 2
  else if (breakRate >= 45) score -= 1
  else if (breakRate <= 35) score += 1

  if (upCount > downCount) score += 1
  else if (downCount > upCount) score -= 1

  if (turnoverDeltaPercent !== null) {
    if (turnoverDeltaPercent >= 5) score += 1
    else if (turnoverDeltaPercent <= -5) score -= 1
  }
  if (limitUpDelta !== null) score += limitUpDelta > 0 ? 1 : limitUpDelta < 0 ? -1 : 0
  if (highestBoardDelta !== null) score += highestBoardDelta > 0 ? 1 : highestBoardDelta < 0 ? -1 : 0

  const hasHighBreakRate = breakRate >= 55
  let emotion = '情绪分歧'
  let phase = sentiment?.marketPhase || '震荡期'
  let advice = '控制仓位，优先观察主线持续性，少做后排追高。'
  let tone: MetricTone = 'neutral'

  if (score >= 5) {
    emotion = hasHighBreakRate ? '强势分歧' : '情绪强势'
    phase = hasHighBreakRate ? '主升期（分歧加大）' : '主升期'
    advice = hasHighBreakRate ? '只看前排核心，后排冲高容易回落。' : '可围绕主线核心参与，避免低辨识度跟风。'
    tone = 'up'
  } else if (score >= 2) {
    emotion = hasHighBreakRate ? '回暖但分歧大' : '情绪回暖'
    phase = '启动期'
    advice = hasHighBreakRate ? '低仓位试错，等分歧转一致再加仓。' : '可轻仓试错主线前排，确认放量后再提高仓位。'
    tone = 'up'
  } else if (score <= -3) {
    emotion = '情绪偏弱'
    phase = '退潮期'
    advice = '降低仓位，少追高，多等亏钱效应释放。'
    tone = 'down'
  } else if (score <= -1) {
    emotion = '分歧偏弱'
    phase = '震荡退潮'
    advice = '谨慎追高，只做确定性强的低吸或空仓等待。'
    tone = 'down'
  }

  const points: DecisionPoint[] = [
    { label: '涨停数', value: `${limitUpCount}家${limitUpDelta === null ? '' : `（${formatSignedNumber(limitUpDelta)}）`}`, passed: limitUpCount >= 50, warning: limitUpCount < 25 },
    { label: '连板高度', value: `${highestBoard}板${highestBoardDelta === null ? '' : `（${formatSignedNumber(highestBoardDelta, '板')}）`}`, passed: highestBoard >= 3, warning: highestBoard <= 1 },
    { label: '成交额', value: `${formatCompactMoney(turnover)}${turnoverDeltaPercent === null ? '' : `（${formatSignedDecimal(turnoverDeltaPercent, '%')}）`}`, passed: turnoverDeltaPercent === null ? turnover >= 1000000000000 : turnoverDeltaPercent >= 0, warning: turnoverDeltaPercent !== null && turnoverDeltaPercent <= -5 },
    { label: '炸板率', value: `${breakRate.toFixed(2)}%`, passed: breakRate <= 45, warning: breakRate >= 55 },
    { label: '涨跌家数', value: `${upCount}/${downCount}`, passed: upCount >= downCount, warning: downCount > upCount },
    { label: '质量分', value: `${current.qualityReport?.score ?? '—'}`, passed: (current.qualityReport?.score ?? 0) >= 90, warning: (current.qualityReport?.score ?? 100) < 80 },
  ]

  return {
    emotion,
    phase,
    advice,
    tone,
    score,
    summary: `${emotion}，${phase}；${advice}`,
    points,
  }
}

function buildTrendLines(periodSnapshots: MarketDataSummary[]): { label: string; values: string[]; tone: MetricTone }[] {
  const recent = [...periodSnapshots]
    .filter((item) => item.overview || item.sentiment)
    .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate))

  if (recent.length < 2) return []
  const first = recent[0]
  const last = recent[recent.length - 1]
  const limitUpDelta = (last.sentiment?.limitUpCount ?? 0) - (first.sentiment?.limitUpCount ?? 0)
  const breakRateDelta = (last.sentiment?.breakRate ?? 0) - (first.sentiment?.breakRate ?? 0)
  const turnoverDelta = (last.overview?.totalTurnover ?? 0) - (first.overview?.totalTurnover ?? 0)

  return [
    {
      label: '涨停数',
      values: recent.map((item) => `${item.sentiment?.limitUpCount ?? 0}`),
      tone: deltaTone(limitUpDelta),
    },
    {
      label: '炸板率',
      values: recent.map((item) => `${(item.sentiment?.breakRate ?? 0).toFixed(0)}%`),
      tone: deltaTone(breakRateDelta, true),
    },
    {
      label: '成交额',
      values: recent.map((item) => formatCompactMoney(item.overview?.totalTurnover)),
      tone: deltaTone(turnoverDelta),
    },
  ]
}

function DeltaMetric({ metric }: { metric: DecisionMetric }) {
  return (
    <div className="rounded-lg border border-border-subtle px-4 py-3" style={{ backgroundColor: 'var(--bg-base)' }}>
      <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{metric.label}</div>
      <div className="font-data-md" style={{ color: 'var(--text-primary)' }}>{metric.value}</div>
      <div className="text-xs mt-1" style={{ color: toneColor(metric.tone) }}>{metric.delta}</div>
    </div>
  )
}

function MarketAIAnalysisPanel({ analysis }: { analysis: MarketAIAnalysis }) {
  const summary = analysis.summary || { stage: '数据不足', emotion_score: 0, risk_level: '高' as const, confidence: 0 }
  const conclusion = analysis.conclusion || { one_line: '暂无结论', reasoning: [] }
  const strategy = analysis.strategy || { can_do: [], cannot_do: [], watch_signals: [] }
  const mainline = analysis.mainline || { sectors: [], status: '无明确主线' }
  const leaders = analysis.leaders || []
  const risk = analysis.risk || { warnings: [], anomalies: [] }
  const riskToneValue: MetricTone = summary.risk_level === '低' ? 'up' : summary.risk_level === '高' ? 'down' : 'neutral'
  const emotionToneValue: MetricTone = summary.emotion_score >= 70 ? 'up' : summary.emotion_score < 45 ? 'down' : 'neutral'
  const confidenceToneValue: MetricTone = summary.confidence >= 70 ? 'up' : summary.confidence < 45 ? 'down' : 'neutral'
  const trendLabel = (trend: 'up' | 'down' | 'flat') => trend === 'up' ? '走强' : trend === 'down' ? '走弱' : '横盘'
  const trendTone = (trend: 'up' | 'down' | 'flat'): MetricTone => trend === 'up' ? 'up' : trend === 'down' ? 'down' : 'neutral'

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border-subtle overflow-hidden" style={{ backgroundColor: 'var(--bg-surface)' }}>
      <div className="p-4 border-b border-border-subtle flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
            AI 区间交易辅助 · {analysis.range?.startDate || '—'} 至 {analysis.range?.endDate || '—'} · {analysis.range?.snapshotCount ?? 0} 个快照
          </div>
          <h2 className="text-lg md:text-xl font-semibold leading-snug" style={{ color: toneColor(riskToneValue) }}>{conclusion.one_line}</h2>
          <div className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
            生成时间：{analysis.generatedAt || '—'}{analysis.aiStatus?.message ? ` · ${analysis.aiStatus.message}` : ''}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm w-full xl:w-auto xl:min-w-[520px]">
          <CompactMetric label="市场阶段" value={summary.stage || '—'} />
          <CompactMetric label="情绪分" value={`${summary.emotion_score ?? 0}`} tone={emotionToneValue} />
          <CompactMetric label="风险等级" value={summary.risk_level || '—'} tone={riskToneValue} />
          <CompactMetric label="置信度" value={`${summary.confidence ?? 0}`} tone={confidenceToneValue} />
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          <div className="rounded-lg border border-border-subtle p-4 xl:col-span-2" style={{ backgroundColor: 'var(--bg-base)' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>核心逻辑</h3>
            <ul className="space-y-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
              {(conclusion.reasoning || []).map((item, index) => <li key={index}>• {item}</li>)}
              {(!conclusion.reasoning || conclusion.reasoning.length === 0) && <li>• 暂无结构化逻辑</li>}
            </ul>
          </div>
          <div className="rounded-lg border border-border-subtle p-4" style={{ backgroundColor: 'var(--bg-base)' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>主线状态</h3>
            <div className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>{mainline.status}</div>
            <div className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>主线必须由规则结合涨停、涨幅、资金流和连续性识别</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="rounded-lg border border-border-subtle p-4" style={{ backgroundColor: 'var(--bg-base)' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>可以做</h3>
            <ul className="space-y-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
              {(strategy.can_do || []).map((item, index) => <li key={index}>• {item}</li>)}
            </ul>
          </div>
          <div className="rounded-lg border border-border-subtle p-4" style={{ backgroundColor: 'var(--bg-base)' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>不可以做</h3>
            <ul className="space-y-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
              {(strategy.cannot_do || []).map((item, index) => <li key={index}>• {item}</li>)}
            </ul>
          </div>
        </div>

        {mainline.sectors?.length > 0 && (
          <div className="rounded-lg border border-border-subtle p-4" style={{ backgroundColor: 'var(--bg-base)' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>主线行业</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {mainline.sectors.map((sector) => (
                <div key={sector.name} className="rounded-lg border border-border-subtle p-3" style={{ backgroundColor: 'var(--bg-surface)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{sector.name}</div>
                    <span className="text-xs shrink-0" style={{ color: toneColor(trendTone(sector.trend)) }}>{trendLabel(sector.trend)}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="h-2 flex-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, sector.strength_score))}%`, backgroundColor: sector.is_mainline ? 'var(--up-red)' : 'var(--accent-primary)' }} />
                    </div>
                    <span className="font-data-sm" style={{ color: 'var(--text-primary)' }}>{sector.strength_score}</span>
                  </div>
                  <div className="mt-2 text-xs leading-5" style={{ color: 'var(--text-muted)' }}>{sector.is_mainline ? '已确认主线' : '主线候选'} · {sector.reason}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {leaders.length > 0 && (
          <div className="rounded-lg border border-border-subtle p-4" style={{ backgroundColor: 'var(--bg-base)' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>龙头股</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {leaders.slice(0, 9).map((leader) => (
                <div key={`${leader.code}-${leader.name}`} className="rounded-lg border border-border-subtle p-3" style={{ backgroundColor: 'var(--bg-surface)' }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{leader.name}</div>
                      <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{leader.code} · {leader.sector}</div>
                    </div>
                    <span className="text-xs px-2 py-1 rounded-full shrink-0" style={{ backgroundColor: 'var(--bg-elevated)', color: leader.role === '总龙头' ? 'var(--up-red)' : 'var(--text-secondary)' }}>{leader.role}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
                    <CompactMetric label="连板高度" value={`${leader.board_height}板`} tone={leader.board_height >= 4 ? 'up' : 'neutral'} />
                    <CompactMetric label="强度" value={`${leader.strength}`} tone={leader.strength >= 70 ? 'up' : leader.strength < 45 ? 'down' : 'neutral'} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="rounded-lg border border-border-subtle p-4" style={{ backgroundColor: 'var(--bg-base)' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>风险提示</h3>
            <ul className="space-y-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
              {(risk.warnings || []).map((item, index) => <li key={index}>• {item}</li>)}
            </ul>
          </div>
          <div className="rounded-lg border border-border-subtle p-4" style={{ backgroundColor: 'var(--bg-base)' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>数据异常</h3>
            <ul className="space-y-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
              {(risk.anomalies || []).slice(0, 6).map((item, index) => <li key={index}>• {item}</li>)}
              {(!risk.anomalies || risk.anomalies.length === 0) && <li>• 暂无明显数据异常</li>}
            </ul>
          </div>
        </div>

        <div className="rounded-lg border border-border-subtle p-4" style={{ backgroundColor: 'var(--bg-base)' }}>
          <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>观察信号</h3>
          <ul className="space-y-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
            {(strategy.watch_signals || []).map((item, index) => <li key={index}>• {item}</li>)}
          </ul>
        </div>
      </div>
    </motion.div>
  )
}

function DecisionPanel({
  periodSnapshots,
  rangeStart,
  rangeEnd,
  missingDates,
  downloading,
  onDownloadMissing,
}: {
  periodSnapshots: MarketDataSummary[]
  rangeStart: string
  rangeEnd: string
  missingDates: string[]
  downloading: boolean
  onDownloadMissing: () => void
}) {
  const orderedSnapshots = [...periodSnapshots]
    .filter((item) => item.overview || item.sentiment)
    .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate))

  if (orderedSnapshots.length === 0) {
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border-subtle p-5" style={{ backgroundColor: 'var(--bg-surface)' }}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-h3" style={{ color: 'var(--text-primary)' }}>该区间没有市场快照</h2>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>当前选择 {rangeStart} 至 {rangeEnd}，需要先下载对应区间的市场数据后才能判断。</p>
          </div>
          <Button variant="outline" onClick={onDownloadMissing} disabled={downloading}>
            <Download className="w-4 h-4 mr-1.5" /> 一键下载该区间
          </Button>
        </div>
      </motion.div>
    )
  }

  const current = orderedSnapshots[orderedSnapshots.length - 1]
  const previous = orderedSnapshots.length > 1 ? orderedSnapshots[0] : null
  const decision = buildMarketDecision(current, previous)
  if (!decision) return null
  const metrics = buildDecisionMetrics(current, previous)
  const trends = buildTrendLines(orderedSnapshots)

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border-subtle overflow-hidden" style={{ backgroundColor: 'var(--bg-surface)' }}>
      <div className="p-5 border-b border-border-subtle">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>区间市场结论 · {rangeStart} 至 {rangeEnd} · {orderedSnapshots.length} 个快照</div>
            <h2 className="text-xl font-semibold" style={{ color: toneColor(decision.tone) }}>{decision.summary}</h2>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm min-w-[260px]">
            <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--bg-base)' }}>
              <span style={{ color: 'var(--text-muted)' }}>情绪：</span><span style={{ color: toneColor(decision.tone) }}>{decision.emotion}</span>
            </div>
            <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--bg-base)' }}>
              <span style={{ color: 'var(--text-muted)' }}>阶段：</span><span style={{ color: 'var(--text-primary)' }}>{decision.phase}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="p-5 space-y-5">
        {missingDates.length > 0 && (
          <div className="rounded-lg border border-border-subtle p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between" style={{ backgroundColor: 'var(--bg-base)' }}>
            <div>
              <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>区间数据不完整</div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>缺少 {missingDates.length} 个工作日快照：{missingDates.slice(0, 8).join('、')}{missingDates.length > 8 ? '...' : ''}</div>
            </div>
            <Button variant="outline" onClick={onDownloadMissing} disabled={downloading}>
              <Download className="w-4 h-4 mr-1.5" /> 下载缺失区间
            </Button>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {metrics.map((metric) => <DeltaMetric key={metric.label} metric={metric} />)}
        </div>
        <details className="rounded-lg border border-border-subtle p-4" style={{ backgroundColor: 'var(--bg-base)' }}>
          <summary className="cursor-pointer text-sm font-medium" style={{ color: 'var(--text-primary)' }}>展开市场阶段推导依据</summary>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
            {decision.points.map((point) => (
              <div key={point.label} className="rounded-md px-3 py-2" style={{ backgroundColor: 'var(--bg-surface)' }}>
                <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{point.label}</div>
                <div className="text-sm font-medium" style={{ color: point.warning ? 'var(--down-green)' : point.passed ? 'var(--up-red)' : 'var(--text-secondary)' }}>
                  {point.passed ? '✔️ ' : point.warning ? '⚠️ ' : '— '}{point.value}
                </div>
              </div>
            ))}
          </div>
        </details>
        {trends.length > 0 && (
          <div className="rounded-lg border border-border-subtle p-4" style={{ backgroundColor: 'var(--bg-base)' }}>
            <div className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>区间快照趋势</div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {trends.map((trend) => (
                <div key={trend.label} className="rounded-md px-3 py-2" style={{ backgroundColor: 'var(--bg-surface)' }}>
                  <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{trend.label}</div>
                  <div className="text-sm font-mono whitespace-normal break-words" style={{ color: toneColor(trend.tone) }}>{trend.values.join(' → ')}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}

function DataPreview({ dataType, data }: { dataType: string; data: unknown }) {
  if (!data) {
    return <div className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>暂无明细数据</div>
  }

  if (typeof data === 'object' && !Array.isArray(data) && (data as { available?: boolean }).available === false) {
    const unavailable = data as { dataType?: string; error?: string; tradeDate?: string }
    return (
      <div className="rounded-lg border border-border-subtle p-5" style={{ backgroundColor: 'var(--bg-base)' }}>
        <div className="text-sm font-medium" style={{ color: 'var(--down-green)' }}>该数据源当前不可用</div>
        <div className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
          {unavailable.tradeDate || ''} {MARKET_DATA_TYPE_LABELS[unavailable.dataType || dataType] || dataType}: {unavailable.error || '接口未返回数据'}
        </div>
      </div>
    )
  }

  if (dataType === 'overview' && typeof data === 'object' && !Array.isArray(data)) {
    const overview = data as NonNullable<MarketDataSummary['overview']> & { meta?: { status?: string; warning?: string; sourceTradeDate?: string; historicalReplayable?: boolean } }
    return (
      <div className="space-y-4">
        {overview.meta?.warning && (
          <div className="rounded-lg border border-border-subtle p-3 text-xs" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--down-green)' }}>
            数据口径提示：{overview.meta.warning}
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <CompactMetric label="交易日" value={overview.tradeDate || '—'} />
          <CompactMetric label="源交易日" value={overview.meta?.sourceTradeDate || overview.tradeDate || '—'} />
          <CompactMetric label="两市成交额" value={formatMoney(overview.totalTurnover)} />
          <CompactMetric label="上涨 / 下跌 / 平盘" value={`${overview.upCount}/${overview.downCount}/${overview.flatCount}`} tone={overview.upCount >= overview.downCount ? 'up' : 'down'} />
          <CompactMetric label="平均 / 中位涨幅" value={`${overview.avgChangePercent}% / ${overview.medianChangePercent}%`} tone={overview.avgChangePercent >= 0 ? 'up' : 'down'} />
          <CompactMetric label="北向净买" value={formatNumber(overview.northNetBuy)} tone={(overview.northNetBuy ?? 0) >= 0 ? 'up' : 'down'} />
          <CompactMetric label="北向净流入" value={formatNumber(overview.northNetInflow)} tone={(overview.northNetInflow ?? 0) >= 0 ? 'up' : 'down'} />
          <CompactMetric label="涨停 / 跌停" value={`${overview.limitUpCount}/${overview.limitDownCount}`} tone={overview.limitUpCount >= overview.limitDownCount ? 'up' : 'down'} />
          <CompactMetric label="北向数据状态" value={overview.northDataStatus === 'exact' ? (overview.northDataDate || '当日有效') : '无当日有效数据'} />
          <CompactMetric label="更新时间" value={overview.updatedAt || '—'} />
        </div>
      </div>
    )
  }

  if (dataType === 'market_indices' && typeof data === 'object' && !Array.isArray(data)) {
    const indexData = data as { items?: Record<string, unknown>[]; leader?: Record<string, unknown> | null; laggard?: Record<string, unknown> | null; coverage?: { matched: number; total: number } }
    const items = indexData.items || []
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <CompactMetric label="覆盖度" value={`${indexData.coverage?.matched ?? 0}/${indexData.coverage?.total ?? items.length}`} />
          <CompactMetric label="领涨指数" value={`${valueAsString(indexData.leader, 'name')} ${formatSignedDecimal(valueAsNumber(indexData.leader, 'changePercent'), '%')}`} tone="up" />
          <CompactMetric label="领跌指数" value={`${valueAsString(indexData.laggard, 'name')} ${formatSignedDecimal(valueAsNumber(indexData.laggard, 'changePercent'), '%')}`} tone="down" />
          <CompactMetric label="指数数量" value={`${items.length}`} />
        </div>
        <DataPreview dataType="market_indices_table" data={items} />
      </div>
    )
  }

  if (dataType === 'breadth' && typeof data === 'object' && !Array.isArray(data)) {
    const breadth = data as { distribution?: { range: string; count: number }[]; newHighLow?: Record<string, unknown> | null; activityDate?: string; turnoverStats?: Record<string, unknown>; meta?: { warning?: string } }
    const highLow = breadth.newHighLow
    return (
      <div className="space-y-4">
        {breadth.meta?.warning && (
          <div className="rounded-lg border border-border-subtle p-3 text-xs" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--down-green)' }}>{breadth.meta.warning}</div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <CompactMetric label="20日新高/新低" value={`${valueAsNumber(highLow, 'high20') ?? '—'}/${valueAsNumber(highLow, 'low20') ?? '—'}`} tone={(valueAsNumber(highLow, 'high20') ?? 0) >= (valueAsNumber(highLow, 'low20') ?? 0) ? 'up' : 'down'} />
          <CompactMetric label="60日新高/新低" value={`${valueAsNumber(highLow, 'high60') ?? '—'}/${valueAsNumber(highLow, 'low60') ?? '—'}`} tone={(valueAsNumber(highLow, 'high60') ?? 0) >= (valueAsNumber(highLow, 'low60') ?? 0) ? 'up' : 'down'} />
          <CompactMetric label="活跃成交股" value={`${valueAsNumber(breadth.turnoverStats, 'activeCountOver100m') ?? '—'}`} />
          <CompactMetric label="活跃度日期" value={breadth.activityDate || '—'} />
        </div>
        <div className="rounded-lg border border-border-subtle p-4" style={{ backgroundColor: 'var(--bg-base)' }}>
          <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>涨跌幅分布</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {(breadth.distribution || []).map((item) => (
              <div key={item.range} className="rounded-md px-3 py-2" style={{ backgroundColor: 'var(--bg-surface)' }}>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.range}</div>
                <div className="font-data-md" style={{ color: item.range.includes('-') ? 'var(--down-green)' : 'var(--up-red)' }}>{item.count}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (dataType === 'style_rotation' && typeof data === 'object' && !Array.isArray(data)) {
    const rotation = data as { styles?: Record<string, unknown>[]; leader?: Record<string, unknown> | null; laggard?: Record<string, unknown> | null }
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <CompactMetric label="最强风格" value={`${valueAsString(rotation.leader, 'style')} ${formatSignedDecimal(valueAsNumber(rotation.leader, 'changePercent'), '%')}`} tone="up" />
          <CompactMetric label="最弱风格" value={`${valueAsString(rotation.laggard, 'style')} ${formatSignedDecimal(valueAsNumber(rotation.laggard, 'changePercent'), '%')}`} tone="down" />
          <CompactMetric label="风格数量" value={`${rotation.styles?.length ?? 0}`} />
          <CompactMetric label="评分口径" value="1日/5日/20日" />
        </div>
        <DataPreview dataType="style_rotation_table" data={rotation.styles || []} />
      </div>
    )
  }

  if (dataType === 'north_money' && typeof data === 'object' && !Array.isArray(data)) {
    const northMoney = data as { available?: boolean; error?: string; summary?: Record<string, unknown>[]; history?: Record<string, unknown>[]; historyNote?: string; latestValidDate?: string }
    const summary = northMoney.summary || []
    const history = northMoney.history || []
    return (
      <div className="space-y-4">
        {northMoney.available === false && (
          <div className="rounded-lg border border-border-subtle p-3 text-xs" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--down-green)' }}>
            北向资金接口不可用：{northMoney.error || '接口未返回数据'}
          </div>
        )}
        <div>
          <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>当日互联互通概览</h3>
          <DataPreview dataType="north_summary_inner" data={summary} />
        </div>
        <div>
          <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>北向资金近 60 条有效记录</h3>
          <div className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>{northMoney.historyNote || '仅显示有效资金记录'}{northMoney.latestValidDate ? `，最新有效日期 ${northMoney.latestValidDate}` : ''}</div>
          <DataPreview dataType="north_history_inner" data={history} />
        </div>
      </div>
    )
  }

  if (dataType === 'sentiment' && typeof data === 'object' && !Array.isArray(data)) {
    const sentiment = data as NonNullable<MarketDataSummary['sentiment']>
    const sourceErrors = sentiment.sourceErrors || {}
    return (
      <div className="space-y-4">
        {Object.keys(sourceErrors).length > 0 && (
          <div className="rounded-lg border border-border-subtle p-3 text-xs" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--down-green)' }}>
            情绪数据部分缺失：{Object.entries(sourceErrors).map(([key, value]) => `${MARKET_DATA_TYPE_LABELS[key] || key}: ${value}`).join('；')}
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <CompactMetric label="市场阶段" value={sentiment.marketPhase || '—'} />
          <CompactMetric label="涨停 / 跌停" value={`${sentiment.limitUpCount}/${sentiment.limitDownCount}`} tone={sentiment.limitUpCount >= sentiment.limitDownCount ? 'up' : 'down'} />
          <CompactMetric label="最高连板" value={`${sentiment.highestBoard}板`} tone="up" />
          <CompactMetric label="炸板率" value={`${sentiment.breakRate}%`} tone="down" />
          <CompactMetric label="炸板数" value={String(sentiment.breakCount)} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-lg border border-border-subtle p-4" style={{ backgroundColor: 'var(--bg-base)' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>热门行业</h3>
            <div className="space-y-2">
              {sentiment.hotIndustries?.map((item) => (
                <div key={item.industry} className="flex items-center justify-between text-sm">
                  <span style={{ color: 'var(--text-secondary)' }}>{item.industry}</span>
                  <span className="font-mono" style={{ color: 'var(--up-red)' }}>{item.limitUpCount} 家涨停</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-border-subtle p-4" style={{ backgroundColor: 'var(--bg-base)' }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>热门龙头</h3>
            <div className="space-y-2">
              {sentiment.leaders?.map((leader) => (
                <div key={String(leader.symbol)} className="flex items-center justify-between text-sm gap-3">
                  <div className="min-w-0">
                    <span className="font-mono mr-2" style={{ color: 'var(--accent-primary)' }}>{String(leader.symbol)}</span>
                    <span style={{ color: 'var(--text-primary)' }}>{String(leader.name)}</span>
                  </div>
                  <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>{String(leader.boardCount)}板 · {String(leader.industry)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (dataType === 'quality_report' && typeof data === 'object' && !Array.isArray(data)) {
    const quality = data as { level?: string; score?: number; summary?: string; checks?: Record<string, unknown>[]; updatedAt?: string }
    const checks = quality.checks || []
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <CompactMetric label="质量等级" value={quality.level === 'complete' ? '完整' : quality.level === 'error' ? '错误' : '有警告'} tone={qualityTone(quality.level)} />
          <CompactMetric label="质量分" value={`${quality.score ?? 0}`} tone={qualityTone(quality.level)} />
          <CompactMetric label="检查项" value={`${checks.length}`} />
          <CompactMetric label="更新时间" value={quality.updatedAt || '—'} />
        </div>
        <div className="rounded-lg border border-border-subtle p-4" style={{ backgroundColor: 'var(--bg-base)' }}>
          <div className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>{quality.summary || '暂无质量结论'}</div>
          <div className="space-y-2">
            {checks.map((check, index) => {
              const severity = String(check.severity || 'info')
              const color = severity === 'error' ? 'var(--down-green)' : severity === 'warning' ? 'var(--accent-primary)' : 'var(--text-secondary)'
              return (
                <div key={index} className="rounded-md px-3 py-2 text-sm" style={{ backgroundColor: 'var(--bg-surface)', color }}>
                  <span className="font-mono mr-2">{String(check.status || '')}</span>{String(check.message || '')}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  const rows = Array.isArray(data) ? data : [data]
  const columnSet = new Set<string>()
  rows.forEach((row) => {
    if (row && typeof row === 'object') {
      Object.keys(row as Record<string, unknown>).forEach((column) => columnSet.add(column))
    }
  })
  const columns = Array.from(columnSet)

  if (columns.length === 0) {
    return <pre className="text-xs overflow-auto p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-secondary)' }}>{JSON.stringify(data, null, 2)}</pre>
  }

  return (
    <div className="rounded-lg border border-border-subtle overflow-hidden">
      <div className="px-3 py-2 text-xs border-b border-border-subtle" style={{ color: 'var(--text-muted)' }}>
        共 {rows.length} 条，{columns.length} 列，已完整显示
      </div>
      <div className="overflow-auto max-h-[70vh]">
        <table className="w-full text-sm min-w-max">
          <thead className="sticky top-0 z-10">
            <tr style={{ backgroundColor: 'var(--bg-elevated)' }}>
              {columns.map((column) => (
                <th key={column} className="text-left px-3 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const record = row as Record<string, unknown>
              return (
                <tr key={index} className="border-t border-border-subtle hover:bg-bg-surface-hover transition-colors">
                  {columns.map((column) => {
                    const rawValue = record[column]
                    const tone = getValueTone(column, rawValue)
                    return (
                      <td key={column} className="px-3 py-2 whitespace-nowrap" style={{ color: toneColor(tone) }} title={String(rawValue ?? '')}>
                        {formatTableValue(column, rawValue)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function MarketDataPanel({
  embedded = false,
  showDownloader = true,
  showViewer = true,
  showSnapshotList = true,
}: {
  embedded?: boolean
  showDownloader?: boolean
  showViewer?: boolean
  showSnapshotList?: boolean
}) {
  const [status, setStatus] = useState<MarketDownloadStatus | null>(null)
  const [snapshots, setSnapshots] = useState<MarketDataSummary[]>([])
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0])
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])
  const [downloading, setDownloading] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [selectedType, setSelectedType] = useState('overview')
  const [detailData, setDetailData] = useState<unknown>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const [marketAiLoading, setMarketAiLoading] = useState(false)
  const [marketAiError, setMarketAiError] = useState('')
  const [marketAiAnalysis, setMarketAiAnalysis] = useState<MarketAIAnalysis | null>(null)
  const [tradeDatesInRange, setTradeDatesInRange] = useState<string[]>([])
  const logBoxRef = useRef<HTMLDivElement>(null)
  const initializedRangeRef = useRef(false)

  const fetchStatus = useCallback(async () => {
    try { setStatus(await getMarketDataStatus()) } catch {}
  }, [])

  const fetchSnapshots = useCallback(async () => {
    try {
      const res = await getMarketDataSnapshots()
      const items = res.items || []
      setSnapshots(items)
      setSelectedDate((current) => current || items[0]?.tradeDate || '')
      if (showViewer && !initializedRangeRef.current && items[0]?.tradeDate) {
        initializedRangeRef.current = true
        setStartDate(items[0].tradeDate)
        setEndDate(items[0].tradeDate)
      }
    } catch {}
  }, [showDownloader, showViewer])

  const fetchDetail = useCallback(async (date: string, dataType: string) => {
    if (!date) {
      setDetailData(null)
      return
    }
    setDetailLoading(true)
    try {
      const res = await getMarketDataDetail(date, dataType)
      setDetailData(res.data)
    } catch {
      setDetailData(null)
    }
    setDetailLoading(false)
  }, [])

  const [rangeStart, rangeEnd] = normalizeDateRange(startDate, endDate)
  const rangeSnapshots = snapshots
    .filter((item) => item.tradeDate >= rangeStart && item.tradeDate <= rangeEnd)
    .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate))
  const allSnapshotsAsc = [...snapshots].sort((left, right) => left.tradeDate.localeCompare(right.tradeDate))
  const snapshotDateSet = new Set(snapshots.map((item) => item.tradeDate))
  const missingDates = tradeDatesInRange.filter((date) => !snapshotDateSet.has(date))
  const latestSnapshot = allSnapshotsAsc[allSnapshotsAsc.length - 1]
  const selectedSnapshot = selectedDate ? allSnapshotsAsc.find((item) => item.tradeDate === selectedDate) : latestSnapshot
  const activeSelectedDate = selectedDate || selectedSnapshot?.tradeDate || ''
  const selectedMissingTypes = selectedSnapshot
    ? Object.keys(MARKET_DATA_TYPE_LABELS).filter((key) => !selectedSnapshot.dataTypes?.[key]?.exists)
    : []

  useEffect(() => {
    fetchStatus()
    fetchSnapshots()
  }, [fetchStatus, fetchSnapshots])
  useEffect(() => {
    let active = true
    getMarketTradeDates({ startDate: rangeStart, endDate: rangeEnd })
      .then((res) => { if (active) setTradeDatesInRange(res.items || []) })
      .catch(() => { if (active) setTradeDatesInRange([]) })
    return () => { active = false }
  }, [rangeStart, rangeEnd])


  useEffect(() => {
    if (!isActiveDownload(status)) return
    const timer = setInterval(() => {
      fetchStatus()
      fetchSnapshots()
    }, 2000)
    return () => clearInterval(timer)
  }, [status, fetchStatus, fetchSnapshots])

  useEffect(() => {
    if (status?.status === 'completed' || status?.status === 'error' || status?.status === 'paused' || status?.status === 'cancelled') fetchSnapshots()
  }, [status?.status, fetchSnapshots])

  useEffect(() => {
    if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight
  }, [status?.logs?.length])

  useEffect(() => {
    if (showViewer) fetchDetail(activeSelectedDate, selectedType)
  }, [activeSelectedDate, selectedType, showViewer, fetchDetail])

  useEffect(() => {
    if (!showViewer || selectedDate || allSnapshotsAsc.length === 0) return
    setSelectedDate(allSnapshotsAsc[allSnapshotsAsc.length - 1].tradeDate)
  }, [allSnapshotsAsc, selectedDate, showViewer])

  const handleDownload = async () => {
    setDownloading(true)
    setDownloadError('')
    const [rangeStart, rangeEnd] = normalizeDateRange(startDate, endDate)
    try {
      await startMarketDataDownload({ startDate: rangeStart, endDate: rangeEnd })
      await fetchStatus()
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : '市场数据下载请求失败')
    }
    setDownloading(false)
  }

  const handleDownloadMissing = async () => {
    if (missingDates.length === 0) return
    setDownloading(true)
    setDownloadError('')
    try {
      await startMarketDataDownload({ dates: missingDates })
      await fetchStatus()
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : '市场数据下载请求失败')
    }
    setDownloading(false)
  }

  const handleSelectSnapshotDate = (date: string) => {
    setSelectedDate(date)
    if (date && (date < rangeStart || date > rangeEnd || !snapshotDateSet.has(date))) {
      setStartDate(date)
      setEndDate(date)
    }
  }

  const handleDownloadSelectedDate = async () => {
    if (!activeSelectedDate) return
    setDownloading(true)
    setDownloadError('')
    try {
      await startMarketDataDownload({ tradeDate: activeSelectedDate })
      await fetchStatus()
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : '市场数据下载请求失败')
    }
    setDownloading(false)
  }

  const handleMarketAIAnalyze = async () => {
    setMarketAiLoading(true)
    setMarketAiError('')
    try {
      const result = await analyzeMarketData({
        startDate: rangeStart,
        endDate: rangeEnd,
        dataTypes: Object.keys(MARKET_DATA_TYPE_LABELS),
        maxDays: 30,
      })
      setMarketAiAnalysis(result)
    } catch (error) {
      setMarketAiError(error instanceof Error ? error.message : 'AI 市场分析失败')
    }
    setMarketAiLoading(false)
  }

  const handlePauseDownload = async () => {
    await pauseMarketDataDownload()
    await fetchStatus()
  }

  const handleResumeDownload = async () => {
    await resumeMarketDataDownload()
    await fetchStatus()
  }

  const handleCancelDownload = async () => {
    await cancelMarketDataDownload()
    await fetchStatus()
  }

  const handleDismissStatus = () => {
    setStatus(null)
    resetMarketDataStatus()
  }

  const handleDelete = async (date: string) => {
    if (!confirm(`确定删除 ${date} 的市场数据？`)) return
    await deleteMarketData(date)
    if (selectedDate === date) {
      setSelectedDate('')
      setDetailData(null)
    }
    fetchSnapshots()
  }

  const progress = status ? (status.total > 0 ? (status.completed / status.total) * 100 : 0) : 0
  const statusDateLabel = status?.tradeDates && status.tradeDates.length > 1
    ? `${status.tradeDates[0]} 至 ${status.tradeDates[status.tradeDates.length - 1]}`
    : status?.tradeDate || startDate

  const snapshotList = (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border-subtle overflow-hidden" style={{ backgroundColor: 'var(--bg-surface)' }}>
      <div className="p-4 border-b border-border-subtle flex items-center justify-between">
        <h2 className="font-h3" style={{ color: 'var(--text-primary)' }}><MetricTooltip label="历史快照" /></h2>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{snapshots.length} 个交易日</span>
      </div>
      <div className="max-h-[620px] overflow-y-auto">
        {snapshots.length === 0 ? (
          <div className="py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>暂无市场数据，先下载一个交易日</div>
        ) : snapshots.map((item) => (
          <div
            key={item.tradeDate}
            className="flex items-stretch border-b border-border-subtle hover:bg-bg-surface-hover transition-colors"
            style={{ backgroundColor: selectedDate === item.tradeDate ? 'var(--bg-surface-hover)' : 'transparent' }}
          >
            <button
              onClick={() => setSelectedDate(item.tradeDate)}
              className="flex-1 text-left px-4 py-3"
              title={`选择 ${item.tradeDate} 市场快照`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-sm" style={{ color: 'var(--accent-primary)' }}>{item.tradeDate}</span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatBytes(item.totalSize)}</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <span style={{ color: 'var(--text-secondary)' }}>成交 {formatMoney(item.overview?.totalTurnover)}</span>
                <span style={{ color: 'var(--text-secondary)' }}>涨跌 {item.overview ? `${item.overview.upCount}/${item.overview.downCount}` : '—'}</span>
                <span style={{ color: toneColor(qualityTone(item.qualityReport?.level)) }}>质量 {item.qualityReport?.score ?? '—'}</span>
              </div>
            </button>
            {showDownloader && (
              <button
                onClick={() => handleDelete(item.tradeDate)}
                className="px-4 transition-colors hover:bg-bg-elevated"
                title={`删除 ${item.tradeDate} 市场快照`}
                aria-label={`删除 ${item.tradeDate} 市场快照`}
              >
                <Trash2 className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              </button>
            )}
          </div>
        ))}
      </div>
    </motion.div>
  )

  const selectedDateIndex = allSnapshotsAsc.findIndex((item) => item.tradeDate === activeSelectedDate)
  const dailySnapshotSelector = showViewer && (allSnapshotsAsc.length > 0 || activeSelectedDate) ? (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border-subtle p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between" style={{ backgroundColor: 'var(--bg-surface)' }}>
      <div>
        <h2 className="font-h3" style={{ color: 'var(--text-primary)' }}><MetricTooltip label="单日数据" /></h2>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>下面的概览卡片和明细表只跟随这里的日期，不影响上方区间判断。</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => selectedDateIndex > 0 && handleSelectSnapshotDate(allSnapshotsAsc[selectedDateIndex - 1].tradeDate)}
          disabled={selectedDateIndex <= 0}
        >
          上一日
        </Button>
        <select
          value={activeSelectedDate}
          onChange={(e) => handleSelectSnapshotDate(e.target.value)}
          className="h-9 rounded-md border border-border-subtle px-3 text-sm"
          style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
        >
          {allSnapshotsAsc.map((item) => (
            <option key={item.tradeDate} value={item.tradeDate}>{item.tradeDate}</option>
          ))}
        </select>
        <Input
          type="date"
          value={activeSelectedDate}
          onChange={(e) => handleSelectSnapshotDate(e.target.value)}
          className="h-9 w-[150px]"
          style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-primary)' }}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => selectedDateIndex >= 0 && selectedDateIndex < allSnapshotsAsc.length - 1 && handleSelectSnapshotDate(allSnapshotsAsc[selectedDateIndex + 1].tradeDate)}
          disabled={selectedDateIndex < 0 || selectedDateIndex >= allSnapshotsAsc.length - 1}
        >
          下一日
        </Button>
      </div>
    </motion.div>
  ) : null

  const detailPanel = (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border-subtle overflow-hidden" style={{ backgroundColor: 'var(--bg-surface)' }}>
      <div className="p-4 border-b border-border-subtle flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="font-h3" style={{ color: 'var(--text-primary)' }}><MetricTooltip label="快照详情" /></h2>
          <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{activeSelectedDate || '未选择日期'}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(MARKET_DATA_TYPE_LABELS).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSelectedType(key)}
              className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
              style={{ backgroundColor: selectedType === key ? 'var(--accent-primary)' : 'var(--bg-base)', color: selectedType === key ? '#fff' : 'var(--text-secondary)' }}
            >
              {label}
            </button>
          ))}
          {showSnapshotList && selectedDate && (
            <button onClick={() => handleDelete(selectedDate)} className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors" style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-muted)' }}>
              <Trash2 className="w-3.5 h-3.5 inline mr-1" /> 删除
            </button>
          )}
        </div>
      </div>
      <div className="p-4">
        {detailLoading ? (
          <div className="flex items-center justify-center py-16" style={{ color: 'var(--text-muted)' }}>
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载明细...
          </div>
        ) : (
          <DataPreview dataType={selectedType} data={detailData} />
        )}
      </div>
    </motion.div>
  )

  return (
    <div className={embedded ? "space-y-6" : "max-w-7xl mx-auto px-4 py-8 space-y-6"}>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-7 h-7" style={{ color: 'var(--accent-primary)' }} />
          <div>
            <h1 className="font-h1" style={{ color: 'var(--text-primary)' }}>{showDownloader ? '市场数据下载器' : '市场总览'}</h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {showDownloader
                ? '下载市场快照、情绪指标与板块资金；文件保存到 server/data/market/YYYY-MM-DD/'
                : '查看已下载的市场状态、行业强弱、涨跌停池与情绪指标'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(showDownloader || showViewer) && (
            <>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 w-40" />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>至</span>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9 w-40" />
            </>
          )}
          {showDownloader && (
            <Button variant="outline" onClick={handleDownload} disabled={downloading || isActiveDownload(status)}>
              <Download className="w-4 h-4 mr-1.5" /> 下载市场数据
            </Button>
          )}
          {showViewer && missingDates.length > 0 && (
            <Button variant="outline" onClick={handleDownloadMissing} disabled={downloading || isActiveDownload(status)}>
              <Download className="w-4 h-4 mr-1.5" /> 下载缺失数据
            </Button>
          )}
          {showViewer && (
            <Button variant="outline" onClick={handleMarketAIAnalyze} disabled={marketAiLoading || isActiveDownload(status)}>
              {marketAiLoading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1.5" />} AI总结区间
            </Button>
          )}
          <Button variant="outline" onClick={() => { fetchStatus(); fetchSnapshots() }}>
            <RefreshCw className="w-4 h-4 mr-1.5" /> 刷新
          </Button>
        </div>
      </div>

      {(showDownloader || showViewer) && downloadError && (
        <div className="rounded-xl border border-border-subtle p-4" style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--down-green)' }}>
          <div className="flex items-start gap-2 text-sm">
            <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">市场数据下载请求失败</div>
              <div className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{downloadError}</div>
            </div>
          </div>
        </div>
      )}

      {(showDownloader || showViewer) && status && status.status !== 'idle' && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border-subtle p-4" style={{ backgroundColor: 'var(--bg-surface)' }}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between mb-2">
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {isActiveDownload(status) && <Loader2 className="w-3.5 h-3.5 inline animate-spin mr-1.5" />}
              {status.status === 'paused' && <Loader2 className="w-3.5 h-3.5 inline mr-1.5" style={{ color: 'var(--text-muted)' }} />}
              {status.status === 'completed' && <CheckCircle className="w-3.5 h-3.5 inline mr-1.5" style={{ color: 'var(--up-red)' }} />}
              {(status.status === 'error' || status.status === 'cancelled') && <XCircle className="w-3.5 h-3.5 inline mr-1.5" style={{ color: 'var(--down-green)' }} />}
              {statusDateLabel} 市场数据 {getStatusLabel(status.status)}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{status.completed}/{status.total} {progress.toFixed(1)}%</span>
              {(status.status === 'running' || status.status === 'pausing') && (
                <Button variant="outline" size="sm" onClick={handlePauseDownload} disabled={status.status === 'pausing'}>暂停</Button>
              )}
              {(status.status === 'paused' || status.status === 'pausing' || status.status === 'cancelled' || status.status === 'error') && status.completed < status.total && (
                <Button variant="outline" size="sm" onClick={handleResumeDownload}>继续</Button>
              )}
              {(status.status === 'running' || status.status === 'pausing' || status.status === 'paused') && (
                <Button variant="outline" size="sm" onClick={handleCancelDownload}>取消</Button>
              )}
              {!isActiveDownload(status) && (
                <button onClick={handleDismissStatus} className="p-0.5 rounded hover:bg-bg-elevated transition-colors">
                  <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                </button>
              )}
            </div>
          </div>
          <div className="h-3 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-elevated)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, backgroundColor: 'var(--accent-primary)' }} />
          </div>
          {status.logs.length > 0 && (
            <div ref={logBoxRef} className="mt-3 max-h-44 overflow-y-auto rounded-lg p-3 font-mono text-xs leading-relaxed" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
              {status.logs.map((entry, index) => (
                <div key={index} style={{ color: entry.includes('错误') ? 'var(--down-green)' : 'var(--text-secondary)' }}>{entry}</div>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {showViewer && (
        <DecisionPanel
          periodSnapshots={rangeSnapshots}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          missingDates={missingDates}
          downloading={downloading || isActiveDownload(status)}
          onDownloadMissing={handleDownloadMissing}
        />
      )}

      {showViewer && marketAiError && (
        <div className="rounded-xl border border-border-subtle p-4 text-sm" style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--down-green)' }}>
          AI 市场分析失败：{marketAiError}
        </div>
      )}

      {showViewer && marketAiAnalysis && <MarketAIAnalysisPanel analysis={marketAiAnalysis} />}

      {dailySnapshotSelector}

      {showViewer && activeSelectedDate && selectedMissingTypes.length > 0 && (
        <div className="rounded-xl border border-border-subtle p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between" style={{ backgroundColor: 'var(--bg-surface)' }}>
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>当前日期数据不完整</div>
            <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {activeSelectedDate} 缺少 {selectedMissingTypes.map((key) => MARKET_DATA_TYPE_LABELS[key] || key).join('、')}。老快照需要补齐后才会显示完整专业指标。
            </div>
          </div>
          <Button variant="outline" onClick={handleDownloadSelectedDate} disabled={downloading || isActiveDownload(status)}>
            <Download className="w-4 h-4 mr-1.5" /> 补齐当前日期
          </Button>
        </div>
      )}

      {showViewer && activeSelectedDate && !selectedSnapshot && (
        <div className="rounded-xl border border-border-subtle p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between" style={{ backgroundColor: 'var(--bg-surface)' }}>
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>该日期还没有快照</div>
            <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{activeSelectedDate} 尚未下载市场数据。</div>
          </div>
          <Button variant="outline" onClick={handleDownloadSelectedDate} disabled={downloading || isActiveDownload(status)}>
            <Download className="w-4 h-4 mr-1.5" /> 下载该日期
          </Button>
        </div>
      )}

      {showViewer && selectedSnapshot?.overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <CompactMetric label="两市成交额" value={formatMoney(selectedSnapshot.overview.totalTurnover)} />
          <CompactMetric label="上涨 / 下跌" value={`${selectedSnapshot.overview.upCount}/${selectedSnapshot.overview.downCount}`} tone={selectedSnapshot.overview.upCount >= selectedSnapshot.overview.downCount ? 'up' : 'down'} />
          <CompactMetric label="涨停 / 跌停" value={`${selectedSnapshot.sentiment?.limitUpCount ?? 0}/${selectedSnapshot.sentiment?.limitDownCount ?? 0}`} tone={(selectedSnapshot.sentiment?.limitUpCount ?? 0) >= (selectedSnapshot.sentiment?.limitDownCount ?? 0) ? 'up' : 'down'} />
          <CompactMetric label="市场阶段" value={selectedSnapshot.sentiment?.marketPhase || '—'} />
          <CompactMetric label="最高连板" value={`${selectedSnapshot.sentiment?.highestBoard ?? 0}板`} />
          <CompactMetric label="炸板率" value={`${selectedSnapshot.sentiment?.breakRate ?? 0}%`} tone="down" />
          <CompactMetric label="北向净买" value={formatNumber(selectedSnapshot.overview.northNetBuy)} tone={(selectedSnapshot.overview.northNetBuy ?? 0) >= 0 ? 'up' : 'down'} />
          <CompactMetric label="平均涨幅" value={`${selectedSnapshot.overview.avgChangePercent}%`} tone={selectedSnapshot.overview.avgChangePercent >= 0 ? 'up' : 'down'} />
        </div>
      )}

      {showViewer && selectedSnapshot && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="rounded-xl border border-border-subtle p-4" style={{ backgroundColor: 'var(--bg-surface)' }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-h3" style={{ color: 'var(--text-primary)' }}><MetricTooltip label="核心指数" /></h2>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{selectedSnapshot.marketIndices?.coverage?.matched ?? 0}/{selectedSnapshot.marketIndices?.coverage?.total ?? 0}</span>
            </div>
            <div className="space-y-2">
              {(selectedSnapshot.marketIndices?.items || []).slice(0, 6).map((item) => {
                const change = valueAsNumber(item, 'changePercent')
                return (
                  <div key={String(item.symbol)} className="flex items-center justify-between text-sm">
                    <span style={{ color: 'var(--text-secondary)' }}>{valueAsString(item, 'name')}</span>
                    <span className="font-mono" style={{ color: toneColor(deltaTone(change)) }}>{formatSignedDecimal(change, '%')}</span>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="rounded-xl border border-border-subtle p-4" style={{ backgroundColor: 'var(--bg-surface)' }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-h3" style={{ color: 'var(--text-primary)' }}><MetricTooltip label="市场宽度" /></h2>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{valueAsString(selectedSnapshot.breadth?.newHighLow, 'sourceDate')}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <CompactMetric label="20日高/低" value={`${valueAsNumber(selectedSnapshot.breadth?.newHighLow, 'high20') ?? '—'}/${valueAsNumber(selectedSnapshot.breadth?.newHighLow, 'low20') ?? '—'}`} />
              <CompactMetric label="60日高/低" value={`${valueAsNumber(selectedSnapshot.breadth?.newHighLow, 'high60') ?? '—'}/${valueAsNumber(selectedSnapshot.breadth?.newHighLow, 'low60') ?? '—'}`} />
            </div>
          </div>
          <div className="rounded-xl border border-border-subtle p-4" style={{ backgroundColor: 'var(--bg-surface)' }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-h3" style={{ color: 'var(--text-primary)' }}><MetricTooltip label="风格与质量" /></h2>
              <span className="text-xs" style={{ color: toneColor(qualityTone(selectedSnapshot.qualityReport?.level)) }}>质量 {selectedSnapshot.qualityReport?.score ?? '—'}</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--text-secondary)' }}>最强风格</span>
                <span style={{ color: 'var(--up-red)' }}>{valueAsString(selectedSnapshot.styleRotation?.leader, 'style')} {formatSignedDecimal(valueAsNumber(selectedSnapshot.styleRotation?.leader, 'changePercent'), '%')}</span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--text-secondary)' }}>最弱风格</span>
                <span style={{ color: 'var(--down-green)' }}>{valueAsString(selectedSnapshot.styleRotation?.laggard, 'style')} {formatSignedDecimal(valueAsNumber(selectedSnapshot.styleRotation?.laggard, 'changePercent'), '%')}</span>
              </div>
              <div className="text-xs pt-2" style={{ color: 'var(--text-muted)' }}>{selectedSnapshot.qualityReport?.summary || '暂无质量报告'}</div>
            </div>
          </div>
        </div>
      )}

      {showViewer ? (
        showSnapshotList ? (
          <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-6">
            {snapshotList}
            {detailPanel}
          </div>
        ) : (
          detailPanel
        )
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-6">
          {snapshotList}
          <div className="rounded-xl border border-border-subtle p-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between" style={{ backgroundColor: 'var(--bg-surface)' }}>
            <div>
              <h2 className="font-h3" style={{ color: 'var(--text-primary)' }}>查看市场数据</h2>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                下载完成后，点击右侧按钮前往“市场总览”页面查看快照明细。
              </p>
            </div>
            <Button variant="outline" onClick={() => { window.location.href = '/market' }}>
              <Eye className="w-4 h-4 mr-1.5" /> 查看市场数据
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function MarketDataManager() {
  return <MarketDataPanel showDownloader={false} showSnapshotList={false} />
}

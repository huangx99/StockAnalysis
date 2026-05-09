import { useState, useEffect, useCallback, useRef } from 'react'
import type { RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Filter, Search, Loader2, ChevronDown, ChevronUp, ArrowUpDown,
  BarChart3, Download, Save, Trash2, X, CheckSquare, Square,
  HelpCircle, Wand2, BookOpen, Braces,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { runScreener, getIndustries, getFormulaFields, validateFormula, generateFormula, generateScreenerAiInsight, getTemplates, createTemplate, deleteTemplate } from '@/api/real/stockApi'
import type { CalculationTemplate, ScreenedStock, ScreenerResponse, ScreenerDiagnosis, FormulaFieldMeta, FormulaGenerateResponse, ScreenerInsight } from '@/types'

type Preset = 'consecutive_growth' | 'recent_strength' | 'profit_growth_rank' | 'custom'
type ScreenerMode = 'all' | 'value' | 'trend'
type CustomMode = 'simple' | 'formula'
type FormulaTarget = 'filter' | 'sort'

interface AiStrategyPreview {
  loading: boolean
  total: number
  scannedCount: number
  items: ScreenedStock[]
  error: string
  insight?: ScreenerInsight | null
}

const SCREENER_MODES: { key: ScreenerMode; label: string; desc: string }[] = [
  { key: 'all', label: '全部', desc: '价值与趋势策略都显示' },
  { key: 'value', label: '价值', desc: '盈利质量、成长与估值' },
  { key: 'trend', label: '趋势', desc: '近期强弱与动量表现' },
]

const MODE_DEFAULT_PRESET: Record<ScreenerMode, Preset> = {
  all: 'consecutive_growth',
  value: 'consecutive_growth',
  trend: 'recent_strength',
}

const PRESETS: { key: Preset; label: string; desc: string; modes: ScreenerMode[] }[] = [
  { key: 'consecutive_growth', label: '连续3年增长', desc: '营收与净利润连续3年同比正增长', modes: ['all', 'value'] },
  { key: 'recent_strength', label: '近3月强势', desc: '近60个交易日涨幅 > 0', modes: ['all', 'trend'] },
  { key: 'profit_growth_rank', label: '利润增长排行', desc: '净利润增速 > 0，按增速降序', modes: ['all', 'value'] },
  { key: 'custom', label: '自定义筛选', desc: '自由组合财务、估值与趋势指标', modes: ['all', 'value', 'trend'] },
]

const SORT_OPTIONS = [
  { value: 'netProfitYoY', label: '净利润增速' },
  { value: 'revenueYoY', label: '营收增速' },
  { value: 'roe', label: 'ROE' },
  { value: 'grossMargin', label: '毛利率' },
  { value: 'netMargin', label: '净利率' },
  { value: 'pe', label: 'PE' },
  { value: 'pb', label: 'PB' },
  { value: 'marketCap', label: '市值' },
  { value: 'recentStrength', label: '近3月涨幅' },
  { value: 'consecutiveGrowthYears', label: '连续增长年数' },
]

interface FilterTemplate {
  name: string
  remoteId?: string
  category?: string
  mode?: CustomMode
  formula?: string
  sortFormula?: string
  formulaSortDir?: 'asc' | 'desc'
  aiStrategy?: FormulaGenerateResponse | null
  aiPreview?: AiStrategyPreview | null
  resultInsight?: ScreenerInsight | null
  filters: {
    minRoe: string; maxDebtRatio: string; minRevenueYoY: string
    minNetProfitYoY: string; maxPe: string; maxPb: string
    minMarketCap: string; maxMarketCap: string; industry: string
  }
}

const TEMPLATE_STORAGE_KEY = 'screener-templates'
const AI_INSIGHT_CACHE_KEY = 'screener-ai-insight-cache-v5'

function loadTemplates(): FilterTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveTemplates(ts: FilterTemplate[]) {
  localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(ts))
}

function templateFromRemote(template: CalculationTemplate): FilterTemplate | null {
  const content = template.content as Partial<FilterTemplate>
  if (!content || typeof content !== 'object' || !content.filters) return null
  return {
    name: template.name,
    category: template.category || content.category || '默认',
    mode: content.mode || (content.formula ? 'formula' : 'simple'),
    formula: content.formula || '',
    sortFormula: content.sortFormula || '',
    formulaSortDir: content.formulaSortDir || 'desc',
    aiStrategy: content.aiStrategy || null,
    aiPreview: content.aiPreview || null,
    resultInsight: content.resultInsight || null,
    filters: content.filters,
    remoteId: template.id,
  } as FilterTemplate
}

function normalizeForCache(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForCache)
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((acc, key) => {
      const item = (value as Record<string, unknown>)[key]
      if (item !== undefined && item !== null && item !== '') acc[key] = normalizeForCache(item)
      return acc
    }, {})
  }
  return value
}

function buildAiInsightCacheKey(req: unknown, dataDate: string, rows: ScreenedStock[]): string {
  const topRows = rows.slice(0, 10).map(row => ({
    symbol: row.symbol,
    sortValue: row.formulaSortValue,
    formulaValues: row.formulaValues,
  }))
  return JSON.stringify(normalizeForCache({ req, dataDate, topRows }))
}

function loadCachedAiInsight(cacheKey: string): ScreenerInsight | null {
  try {
    const raw = localStorage.getItem(AI_INSIGHT_CACHE_KEY)
    const cache = raw ? JSON.parse(raw) : {}
    const insight = cache[cacheKey]?.insight || null
    return insight?.generationMethod === 'AI生成' ? insight : null
  } catch { return null }
}

function saveCachedAiInsight(cacheKey: string, insight: ScreenerInsight) {
  try {
    const raw = localStorage.getItem(AI_INSIGHT_CACHE_KEY)
    const cache = raw ? JSON.parse(raw) : {}
    const entries = Object.entries({ ...cache, [cacheKey]: { savedAt: Date.now(), insight } })
      .sort((a, b) => Number((b[1] as any).savedAt || 0) - Number((a[1] as any).savedAt || 0))
      .slice(0, 30)
    localStorage.setItem(AI_INSIGHT_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch { /* ignore local cache errors */ }
}

function getInsightDisplayNotes(insight: ScreenerInsight): string[] {
  const rawNotes = [...(insight.warnings || []), ...(insight.limitations || [])]
  const hiddenPatterns = [
    '规则洞察由本地筛选结果',
    'AI 洞察失败时不会编造内容',
    '结果洞察基于本地已下载数据',
  ]
  const notes = rawNotes
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .filter(item => !hiddenPatterns.some(pattern => item.includes(pattern)))
  return Array.from(new Set(notes)).slice(0, 2)
}

// ---- formatting helpers ----
function formatMarketCap(val: number): string {
  if (!val || val <= 0) return '-'
  if (val >= 1e12) return (val / 1e12).toFixed(2) + ' 万亿'
  if (val >= 1e8) return (val / 1e8).toFixed(1) + ' 亿'
  return (val / 1e4).toFixed(0) + ' 万'
}

function formatPct(val: number): string {
  if (val == null) return '-'
  const v = Number(val)
  if (isNaN(v)) return '-'
  return v > 0 ? `+${v.toFixed(2)}%` : `${v.toFixed(2)}%`
}

function formatNum(val: number, digits = 2): string {
  if (val == null || isNaN(val)) return '-'
  return Number(val).toFixed(digits)
}

function formatFormulaValue(value: unknown): string {
  if (value == null) return '-'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(Math.abs(value) >= 100 ? 0 : 2) : '-'
  if (Array.isArray(value)) return value.map(formatFormulaValue).join(' / ')
  return String(value)
}


function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function exportCSV(stocks: ScreenedStock[]) {
  const headers = ['代码', '名称', '行业', '涨跌幅', 'PE', '市值', 'ROE', '净利增速', '营收增速', '连增年', '3月涨幅']
  const rows = stocks.map(s => [
    s.symbol, s.name, s.industry,
    formatPct(s.changePercent), formatNum(s.pe, 1), formatMarketCap(s.marketCap),
    formatPct(s.roe), formatPct(s.netProfitYoY), formatPct(s.revenueYoY),
    s.consecutiveGrowthYears > 0 ? String(s.consecutiveGrowthYears) : '-',
    formatPct(s.recentStrength),
  ].map(csvEscape).join(','))
  const csv = '﻿' + [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `screener-${new Date().toISOString().slice(0, 10)}.csv`
  a.click(); URL.revokeObjectURL(url)
}

function getStockDisplayName(stock: ScreenedStock): string {
  return stock.name?.trim() || stock.symbol
}

function getStockRouteSymbol(stock: ScreenedStock): string {
  const match = stock.symbol?.match(/\d{6}/)
  return match?.[0] || stock.symbol
}

// ---- Sub-components ----
function ThButton({ field, label, sortBy, sortDir, onClick }: {
  field: string; label: string; sortBy: string; sortDir: 'asc' | 'desc'; onClick: () => void
}) {
  return (
    <th
      className="text-right px-3 py-2.5 font-medium cursor-pointer select-none hover:bg-bg-elevated transition-colors"
      style={{ color: 'var(--text-secondary)' }}
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {sortBy === field
          ? (sortDir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)
          : <ArrowUpDown className="w-3 h-3" style={{ opacity: 0.4 }} />}
      </span>
    </th>
  )
}

function ResultInsightPanel({ insight, aiLoading, aiError, aiNote, onGenerateAi, onNavigateSymbol }: {
  insight: ScreenerInsight
  aiLoading: boolean
  aiError: string
  aiNote: string
  onGenerateAi: (forceRefresh?: boolean) => void
  onNavigateSymbol: (symbol: string) => void
}) {
  const hasMedia = insight.newsInsights.length > 0 || insight.reportInsights.length > 0
  return (
    <div className="rounded-xl border border-border-subtle p-4" style={{ backgroundColor: 'var(--bg-surface)' }}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            <BookOpen className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
            {insight.title || '结果洞察'}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span title={insight.generationMethod === 'AI生成' ? 'AI 基于当前筛选结果、本地新闻/研报摘要和成功抓取的新闻正文生成；链接失败不会假装读取。' : '当前洞察由本地筛选结果、排序值、新闻/研报摘要和标题统计规则生成，未调用 AI。'}>
              {insight.generationMethod || '规则生成'}
            </span>
            {insight.generatedAt && <span>· {insight.generatedAt}</span>}
            {insight.timeRange && <span>· {insight.timeRange}</span>}
          </div>
          {insight.summary && <div className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{insight.summary}</div>}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => onGenerateAi(false)} disabled={aiLoading}>
              {aiLoading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Wand2 className="w-3.5 h-3.5 mr-1" />}AI洞察
            </Button>
            {insight.generationMethod === 'AI生成' && (
              <Button size="sm" variant="outline" onClick={() => onGenerateAi(true)} disabled={aiLoading}>重新生成</Button>
            )}
          </div>
          <span className="text-[11px] text-right" style={{ color: 'var(--text-muted)' }}>
            同条件优先读缓存；PDF研报全文解析是第二版功能，当前暂未接入
          </span>
        </div>
      </div>
      {aiError && <div className="mb-3 rounded p-2 text-xs" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--up-red)' }}>{aiError}</div>}
      {aiNote && <div className="mb-3 rounded p-2 text-xs" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>{aiNote}</div>}

      {insight.generationMethod === 'AI生成' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--bg-elevated)' }}>
            <div className="mb-1 text-xs font-semibold" style={{ color: 'var(--accent-primary)' }}>内容</div>
            <div className="whitespace-pre-line text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {insight.summary || insight.conclusion || 'AI 暂未返回有效内容'}
            </div>
          </div>
          <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--bg-elevated)' }}>
            <div className="mb-1 text-xs font-semibold" style={{ color: 'var(--accent-primary)' }}>依据样本</div>
            <div className="space-y-1">
              {(insight.evidence.length ? insight.evidence.slice(0, 4) : []).map((item, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => item.symbol && onNavigateSymbol(item.symbol)}
                  className="block w-full truncate text-left text-xs hover:underline"
                  style={{ color: 'var(--text-secondary)' }}
                  title={item.title || ''}
                >
                  {item.name || item.symbol || '样本'} · {item.title || ''}
                </button>
              ))}
              {!insight.evidence.length && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>暂无依据样本</div>}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <div>
              <div className="mb-1 text-xs font-semibold" style={{ color: 'var(--accent-primary)' }}>为什么排前面</div>
              <ul className="space-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                {insight.rankingReasons.map((item, index) => <li key={index}>👉 {item}</li>)}
              </ul>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold" style={{ color: 'var(--accent-primary)' }}>结构特征</div>
              <ul className="space-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                {(insight.structureInsights.length ? insight.structureInsights : ['结果暂未显示明显结构特征，建议结合更多指标继续观察']).map((item, index) => <li key={index}>👉 {item}</li>)}
              </ul>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold" style={{ color: 'var(--accent-primary)' }}>结论</div>
              <div className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {insight.conclusion || '该结果适合作为初筛名单，仍需进一步验证基本面。'}
              </div>
            </div>
          </div>

          {hasMedia && (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {insight.newsInsights.length > 0 && (
                <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                  <div className="mb-1 text-xs font-semibold" style={{ color: 'var(--accent-primary)' }}>新闻线索</div>
                  <ul className="space-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {insight.newsInsights.map((item, index) => <li key={index}>👉 {item}</li>)}
                  </ul>
                </div>
              )}
              {insight.reportInsights.length > 0 && (
                <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                  <div className="mb-1 text-xs font-semibold" style={{ color: 'var(--accent-primary)' }}>研报线索</div>
                  <ul className="space-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {insight.reportInsights.map((item, index) => <li key={index}>👉 {item}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-semibold" style={{ color: 'var(--accent-primary)' }}>下一步看什么</div>
              <ul className="space-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                {insight.nextSteps.map((item, index) => <li key={index}>👉 {item}</li>)}
              </ul>
            </div>
            {insight.evidence.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold" style={{ color: 'var(--accent-primary)' }}>依据样本</div>
                <div className="space-y-1">
                  {insight.evidence.slice(0, 4).map((item, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => item.symbol && onNavigateSymbol(item.symbol)}
                      className="block w-full truncate text-left text-xs hover:underline"
                      style={{ color: 'var(--text-secondary)' }}
                      title={item.title || ''}
                    >
                      {item.type || '线索'} · {item.name || item.symbol || ''} · {item.title || ''}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {getInsightDisplayNotes(insight).length > 0 && (
        <div className="mt-3 rounded-lg p-2 text-xs" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
          {getInsightDisplayNotes(insight).map((item, index) => <div key={index}>提示：{item}</div>)}
        </div>
      )}
    </div>
  )
}

function RankingChart({ stocks, sortBy, sortDir, sortLabel, onNavigate }: {
  stocks: ScreenedStock[]
  sortBy: string
  sortDir: 'asc' | 'desc'
  sortLabel: string
  onNavigate: (stock: ScreenedStock) => void
}) {
  if (stocks.length === 0) return null
  const getValue = (stock: ScreenedStock) => {
    const raw = (stock as any)[sortBy]
    if (raw == null || raw === '') return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  }
  const top10 = [...stocks]
    .sort((a, b) => {
      const va = getValue(a)
      const vb = getValue(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      return sortDir === 'desc' ? vb - va : va - vb
    })
    .slice(0, 10)
  const maxVal = Math.max(...top10.map(s => Math.abs(getValue(s) ?? 0)), 1)

  return (
    <div className="rounded-xl border border-border-subtle p-4" style={{ backgroundColor: 'var(--bg-surface)' }}>
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Top 10 — {sortLabel}
        </span>
      </div>
      <div className="space-y-1.5">
        {top10.map((s, i) => {
          const val = getValue(s)
          const barW = val != null && maxVal > 0 ? (Math.abs(val) / maxVal) * 100 : 0
          const isPositive = (val ?? 0) >= 0
          const isPct = ['roe', 'netProfitYoY', 'revenueYoY', 'grossMargin', 'netMargin', 'recentStrength', 'changePercent'].includes(sortBy)
          const displayVal = val == null ? '-' : isPct ? formatPct(val) : sortBy === 'marketCap' ? formatMarketCap(val) : formatNum(val, 1)
          const displayName = getStockDisplayName(s)
          return (
            <div key={s.symbol} className="flex items-center gap-2 text-xs">
              <span className="w-5 text-right font-mono" style={{ color: 'var(--text-muted)' }}>{i + 1}</span>
              <button
                type="button"
                className="truncate cursor-pointer hover:underline w-28 text-left"
                style={{ color: 'var(--text-primary)' }}
                title={`${displayName} (${s.symbol})`}
                onClick={() => onNavigate(s)}
              >
                {displayName}
              </button>
              <div className="flex-1 h-4 rounded-sm relative overflow-hidden" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                <div
                  className="h-full rounded-sm transition-all"
                  style={{
                    width: `${barW}%`,
                    backgroundColor: isPositive || sortBy === 'pe' || sortBy === 'pb' ? 'var(--accent-primary)' : 'var(--down-green)',
                    opacity: 0.7,
                  }}
                />
              </div>
              <span className="w-20 text-right font-mono" style={{ color: 'var(--text-primary)' }}>
                {displayVal}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ComparisonPanel({ stocks, onClose, onNavigate }: { stocks: ScreenedStock[]; onClose: () => void; onNavigate: (stock: ScreenedStock) => void }) {
  const rows: { label: string; get: (s: ScreenedStock) => string }[] = [
    { label: '涨跌幅', get: s => formatPct(s.changePercent) },
    { label: 'PE', get: s => formatNum(s.pe, 1) },
    { label: 'PB', get: s => formatNum(s.pb, 1) },
    { label: '市值', get: s => formatMarketCap(s.marketCap) },
    { label: 'ROE', get: s => formatPct(s.roe) },
    { label: '毛利率', get: s => formatPct(s.grossMargin) },
    { label: '净利率', get: s => formatPct(s.netMargin) },
    { label: '净利增速', get: s => formatPct(s.netProfitYoY) },
    { label: '营收增速', get: s => formatPct(s.revenueYoY) },
    { label: '负债率', get: s => formatPct(s.debtAssetRatio) },
    { label: '连增年', get: s => s.consecutiveGrowthYears > 0 ? String(s.consecutiveGrowthYears) : '-' },
    { label: '3月涨幅', get: s => formatPct(s.recentStrength) },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, x: 300 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 300 }}
      className="fixed right-0 top-0 h-full w-full max-w-lg z-50 overflow-y-auto border-l shadow-2xl"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>股票对比 ({stocks.length})</span>
        <button onClick={onClose} className="p-1 rounded hover:bg-bg-surface-hover">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="overflow-x-auto p-4">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ backgroundColor: 'var(--bg-elevated)' }}>
              <th className="text-left px-2 py-2 font-medium sticky left-0" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>指标</th>
              {stocks.map(s => (
                <th key={s.symbol} className="text-right px-2 py-2 font-medium font-mono cursor-pointer hover:underline" style={{ color: 'var(--accent-primary)' }} onClick={() => onNavigate(s)}>
                  {s.symbol}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.label} className="border-t border-border-subtle">
                <td className="px-2 py-2 font-medium sticky left-0" style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>
                  {row.label}
                </td>
                {stocks.map(s => (
                  <td key={s.symbol} className="px-2 py-2 text-right font-mono" style={{ color: 'var(--text-primary)' }}>
                    {row.get(s)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  )
}

// ---- Main component ----
export default function Screener() {
  const navigate = useNavigate()
  const [screenerMode, setScreenerMode] = useState<ScreenerMode>('all')
  const [preset, setPreset] = useState<Preset>('consecutive_growth')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<ScreenedStock[]>([])
  const [total, setTotal] = useState(0)
  const [matchedCount, setMatchedCount] = useState(0)
  const [scannedCount, setScannedCount] = useState(0)
  const [page, setPage] = useState(1)
  const [sortBy, setSortBy] = useState('netProfitYoY')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [error, setError] = useState('')
  const [dataDate, setDataDate] = useState('')
  const [diagnosis, setDiagnosis] = useState<ScreenerDiagnosis | null>(null)
  const [resultInsight, setResultInsight] = useState<ScreenerInsight | null>(null)

  // Custom filter state
  const [minRoe, setMinRoe] = useState('')
  const [maxDebtRatio, setMaxDebtRatio] = useState('')
  const [minRevenueYoY, setMinRevenueYoY] = useState('')
  const [minNetProfitYoY, setMinNetProfitYoY] = useState('')
  const [maxPe, setMaxPe] = useState('')
  const [maxPb, setMaxPb] = useState('')
  const [minMarketCap, setMinMarketCap] = useState('')
  const [maxMarketCap, setMaxMarketCap] = useState('')
  const [industry, setIndustry] = useState('')
  const [industries, setIndustries] = useState<{ name: string; count: number }[]>([])
  const [showIndustryDropdown, setShowIndustryDropdown] = useState(false)
  const industryRef = useRef<HTMLDivElement>(null)

  // Formula mode state
  const [customMode, setCustomMode] = useState<CustomMode>('simple')
  const [formula, setFormula] = useState('@ROE > 12 AND @净利润同比 > 20')
  const [sortFormula, setSortFormula] = useState('')
  const [formulaSortDir, setFormulaSortDir] = useState<'asc' | 'desc'>('desc')
  const [formulaTarget, setFormulaTarget] = useState<FormulaTarget>('filter')
  const [formulaFields, setFormulaFields] = useState<FormulaFieldMeta[]>([])
  const [formulaMessage, setFormulaMessage] = useState('')
  const [showFormulaHelp, setShowFormulaHelp] = useState(false)
  const [formulaCategory, setFormulaCategory] = useState('默认')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiStrategy, setAiStrategy] = useState<FormulaGenerateResponse | null>(null)
  const [aiPreview, setAiPreview] = useState<AiStrategyPreview | null>(null)
  const [aiInsightLoading, setAiInsightLoading] = useState(false)
  const [aiInsightError, setAiInsightError] = useState('')
  const [aiInsightNote, setAiInsightNote] = useState('')

  // Feature states
  const [showChart, setShowChart] = useState(true)
  const [selectedStocks, setSelectedStocks] = useState<Set<string>>(new Set())
  const [showCompare, setShowCompare] = useState(false)
  const [savedTemplates, setSavedTemplates] = useState<FilterTemplate[]>(() => loadTemplates())
  const [templateSyncMessage, setTemplateSyncMessage] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [tableQuery, setTableQuery] = useState('')
  const [appliedTableQuery, setAppliedTableQuery] = useState('')

  const isRecentStrength = preset === 'recent_strength'

  // Load industries and formula fields
  useEffect(() => {
    getIndustries().then(res => { if (res.items) setIndustries(res.items) }).catch(() => {})
    getFormulaFields().then(res => { if (res.items) setFormulaFields(res.items) }).catch(() => {})
  }, [])

  useEffect(() => {
    getTemplates()
      .then(remote => {
        const mapped = remote
          .filter(item => item.category === 'screener' || item.category === '默认' || item.category === '简单条件')
          .map(templateFromRemote)
          .filter((item): item is FilterTemplate => Boolean(item))
        if (mapped.length > 0) {
          setSavedTemplates(mapped)
          saveTemplates(mapped)
          setTemplateSyncMessage('已同步账号模板')
        }
      })
      .catch(() => setTemplateSyncMessage('模板暂用本地缓存'))
  }, [])

  // Close industry dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (industryRef.current && !industryRef.current.contains(e.target as Node)) {
        setShowIndustryDropdown(false)
      }
    }
    if (showIndustryDropdown) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [showIndustryDropdown])

  const currentFilters = { minRoe, maxDebtRatio, minRevenueYoY, minNetProfitYoY, maxPe, maxPb, minMarketCap, maxMarketCap, industry }
  const visiblePresets = PRESETS.filter(item => item.modes.includes(screenerMode))
  const groupedFormulaFields = formulaFields.reduce<Record<string, FormulaFieldMeta[]>>((groups, field) => {
    const category = field.category || '其他'
    groups[category] = [...(groups[category] || []), field]
    return groups
  }, {})

  const navigateToStock = useCallback((stock: ScreenedStock) => {
    const routeSymbol = getStockRouteSymbol(stock)
    if (routeSymbol) navigate(`/stock/${routeSymbol}`)
  }, [navigate])

  const doSearch = useCallback(async (p: number, sBy: string, sDir: 'asc' | 'desc', query = appliedTableQuery) => {
    setLoading(true)
    setError('')
    try {
      const res: ScreenerResponse = await runScreener({
        preset,
        formula: preset === 'custom' && customMode === 'formula' ? formula.trim() || null : null,
        sortFormula: preset === 'custom' && customMode === 'formula' ? sortFormula.trim() || null : null,
        minRoe: customMode === 'simple' && minRoe ? parseFloat(minRoe) : null,
        maxDebtRatio: customMode === 'simple' && maxDebtRatio ? parseFloat(maxDebtRatio) : null,
        minRevenueYoY: customMode === 'simple' && minRevenueYoY ? parseFloat(minRevenueYoY) : null,
        minNetProfitYoY: customMode === 'simple' && minNetProfitYoY ? parseFloat(minNetProfitYoY) : null,
        maxPe: customMode === 'simple' && maxPe ? parseFloat(maxPe) : null,
        maxPb: customMode === 'simple' && maxPb ? parseFloat(maxPb) : null,
        minMarketCap: customMode === 'simple' && minMarketCap ? parseFloat(minMarketCap) : null,
        maxMarketCap: customMode === 'simple' && maxMarketCap ? parseFloat(maxMarketCap) : null,
        industry: industry || null,
        q: query.trim() || null,
        sortBy: sBy,
        sortDir: preset === 'custom' && customMode === 'formula' && sortFormula.trim() ? formulaSortDir : sDir,
        page: p,
        pageSize: 50,
      })
      setResults(res.items)
      setTotal(res.total)
      setMatchedCount(res.matchedCount)
      setScannedCount(res.scannedCount)
      setPage(res.page)
      setDataDate(res.dataDate || '')
      setDiagnosis(res.diagnosis || null)
      setResultInsight(res.insight || null)
      setSelectedStocks(new Set())
    } catch (e: any) {
      setError(e.message || '筛选失败')
      setResults([])
      setDiagnosis(null)
      setResultInsight(null)
    }
    setLoading(false)
  }, [preset, customMode, formula, sortFormula, formulaSortDir, minRoe, maxDebtRatio, minRevenueYoY, minNetProfitYoY, maxPe, maxPb, minMarketCap, maxMarketCap, industry, appliedTableQuery])

  // Search on preset change
  useEffect(() => {
    setPage(1)
    doSearch(1, sortBy, sortDir)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset])

  const handlePresetChange = (p: Preset) => {
    setPreset(p)
    setSortBy(p === 'recent_strength' ? 'recentStrength' : 'netProfitYoY')
    setSortDir('desc')
  }

  const handleModeChange = (mode: ScreenerMode) => {
    setScreenerMode(mode)
    const nextPresets = PRESETS.filter(item => item.modes.includes(mode))
    if (!nextPresets.some(item => item.key === preset)) {
      handlePresetChange(MODE_DEFAULT_PRESET[mode])
    }
  }

  const handleTableSearch = () => {
    const query = tableQuery.trim()
    setAppliedTableQuery(query)
    setPage(1)
    doSearch(1, sortBy, sortDir, query)
  }

  const handleClearTableSearch = () => {
    setTableQuery('')
    setAppliedTableQuery('')
    setPage(1)
    doSearch(1, sortBy, sortDir, '')
  }

  const handleSearch = () => {
    setPage(1)
    doSearch(1, sortBy, sortDir, appliedTableQuery)
  }

  const handleSort = (field: string) => {
    const newDir = field === sortBy ? (sortDir === 'desc' ? 'asc' : 'desc') : 'desc'
    setSortBy(field)
    setSortDir(newDir)
    setPage(1)
    doSearch(1, field, newDir, appliedTableQuery)
  }

  const handleSortChange = (field: string) => {
    setSortBy(field)
    setSortDir('desc')
    setPage(1)
    doSearch(1, field, 'desc', appliedTableQuery)
  }

  const handlePageChange = (newPage: number) => {
    doSearch(newPage, sortBy, sortDir, appliedTableQuery)
  }

  // Select / deselect
  const toggleSelect = (symbol: string) => {
    setSelectedStocks(prev => {
      const next = new Set(prev)
      if (next.has(symbol)) { next.delete(symbol) } else { next.add(symbol) }
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedStocks.size === results.length) {
      setSelectedStocks(new Set())
    } else {
      setSelectedStocks(new Set(results.map(s => s.symbol)))
    }
  }

  const compareStocks = results.filter(s => selectedStocks.has(s.symbol))

  // Templates
  const buildCurrentTemplate = (insightOverride: ScreenerInsight | null = resultInsight): FilterTemplate | null => {
    const name = templateName.trim()
    if (!name) return null
    const preview = customMode === 'formula' && aiPreview ? { ...aiPreview, loading: false, insight: insightOverride } : null
    return {
      name,
      category: customMode === 'formula' ? formulaCategory.trim() || '默认' : '简单条件',
      mode: customMode,
      formula: customMode === 'formula' ? formula : '',
      sortFormula: customMode === 'formula' ? sortFormula : '',
      formulaSortDir: customMode === 'formula' ? formulaSortDir : 'desc',
      aiStrategy: customMode === 'formula' ? aiStrategy : null,
      aiPreview: preview,
      resultInsight: customMode === 'formula' ? insightOverride : null,
      filters: currentFilters,
    }
  }

  const persistTemplate = (template: FilterTemplate) => {
    setSavedTemplates(prev => {
      const next = [...prev.filter(t => t.name !== template.name), template]
      saveTemplates(next)
      return next
    })
  }

  const handleSaveTemplate = async () => {
    const template = buildCurrentTemplate()
    if (!template) return
    persistTemplate(template)
    try {
      const remote = await createTemplate({
        name: template.name,
        description: '股票筛选计算模板',
        templateType: 'private',
        category: 'screener',
        content: template as unknown as Record<string, unknown>,
      })
      const next = { ...template, remoteId: remote.id }
      persistTemplate(next)
      setTemplateSyncMessage('模板已保存到当前账号')
    } catch {
      setTemplateSyncMessage('模板已保存到本地，账号同步失败')
    }
  }

  const handleLoadTemplate = (t: FilterTemplate) => {
    setTemplateName(t.name)
    setCustomMode(t.mode || (t.formula ? 'formula' : 'simple'))
    if (t.formula !== undefined) setFormula(t.formula)
    if (t.sortFormula !== undefined) setSortFormula(t.sortFormula)
    if (t.formulaSortDir) setFormulaSortDir(t.formulaSortDir)
    setAiStrategy(t.aiStrategy || null)
    setAiPreview(t.aiPreview || null)
    setResultInsight(t.resultInsight || t.aiPreview?.insight || null)
    if (t.category) setFormulaCategory(t.category)
    setMinRoe(t.filters.minRoe); setMaxDebtRatio(t.filters.maxDebtRatio)
    setMinRevenueYoY(t.filters.minRevenueYoY); setMinNetProfitYoY(t.filters.minNetProfitYoY)
    setMaxPe(t.filters.maxPe); setMaxPb(t.filters.maxPb)
    setMinMarketCap(t.filters.minMarketCap); setMaxMarketCap(t.filters.maxMarketCap)
    setIndustry(t.filters.industry)
  }

  const appendFormulaField = (prev: string, label: string) => {
    const needsSpace = prev.length > 0 && !/\s$/.test(prev) && !prev.endsWith('@')
    if (prev.endsWith('@')) return prev + label + ' '
    return prev + (needsSpace ? ' ' : '') + '@' + label + ' '
  }

  const insertFormulaField = (label: string) => {
    if (formulaTarget === 'sort') {
      setSortFormula(prev => appendFormulaField(prev, label))
    } else {
      setFormula(prev => appendFormulaField(prev, label))
    }
  }

  const handleValidateFormula = async () => {
    const checks: string[] = []
    if (formula.trim()) {
      const res = await validateFormula(formula)
      checks.push(`筛选公式：${res.message}`)
    }
    if (sortFormula.trim()) {
      const res = await validateFormula(sortFormula)
      checks.push(`排序公式：${res.message}`)
    }
    setFormulaMessage(checks.length ? checks.join('；') : '请至少填写筛选公式或排序公式')
  }

  const buildScreenerRequest = (p = 1, pageSize = 50): any => ({
    preset,
    formula: preset === 'custom' && customMode === 'formula' ? formula.trim() || null : null,
    sortFormula: preset === 'custom' && customMode === 'formula' ? sortFormula.trim() || null : null,
    minRoe: customMode === 'simple' && minRoe ? parseFloat(minRoe) : null,
    maxDebtRatio: customMode === 'simple' && maxDebtRatio ? parseFloat(maxDebtRatio) : null,
    minRevenueYoY: customMode === 'simple' && minRevenueYoY ? parseFloat(minRevenueYoY) : null,
    minNetProfitYoY: customMode === 'simple' && minNetProfitYoY ? parseFloat(minNetProfitYoY) : null,
    maxPe: customMode === 'simple' && maxPe ? parseFloat(maxPe) : null,
    maxPb: customMode === 'simple' && maxPb ? parseFloat(maxPb) : null,
    minMarketCap: customMode === 'simple' && minMarketCap ? parseFloat(minMarketCap) : null,
    maxMarketCap: customMode === 'simple' && maxMarketCap ? parseFloat(maxMarketCap) : null,
    industry: industry || null,
    q: appliedTableQuery.trim() || null,
    sortBy,
    sortDir: preset === 'custom' && customMode === 'formula' && sortFormula.trim() ? formulaSortDir : sortDir,
    page: p,
    pageSize,
  })

  const handleGenerateAiInsight = async (forceRefresh = false) => {
    const request = buildScreenerRequest(1, 5)
    const cacheKey = buildAiInsightCacheKey(request, dataDate, results)
    setAiInsightError('')
    setAiInsightNote('')
    if (!forceRefresh) {
      const cached = loadCachedAiInsight(cacheKey)
      if (cached) {
        setResultInsight(cached)
        setAiPreview(prev => prev ? { ...prev, insight: cached } : prev)
        setAiInsightNote('已读取本地保存的 AI 洞察，未重复调用 AI。需要最新结果可点击“重新生成”。')
        return
      }
    }
    setAiInsightLoading(true)
    try {
      const insight = await generateScreenerAiInsight(request, false, forceRefresh)
      setResultInsight(insight)
      setAiPreview(prev => prev ? { ...prev, insight } : prev)
      if (insight.generationMethod === 'AI生成') {
        saveCachedAiInsight(cacheKey, insight)
        const template = buildCurrentTemplate(insight)
        if (template) {
          persistTemplate(template)
          setAiInsightNote('AI 洞察已自动保存到当前模板和本地缓存。')
        } else {
          setAiInsightNote('AI 洞察已保存到本地缓存；填写模板名称后会自动写入模板。')
        }
      } else {
        setAiInsightNote('AI 服务本次未成功返回，已保留规则洞察。你可以稍后重新生成。')
      }
    } catch (e: any) {
      setAiInsightError(e.message || 'AI 洞察生成失败，当前保留规则洞察')
    }
    setAiInsightLoading(false)
  }

  const handleAiGenerateFormula = async () => {
    if (!aiPrompt.trim()) { setFormulaMessage('请先描述你想筛选什么股票'); return }
    setAiLoading(true)
    setFormulaMessage('')
    setAiStrategy(null)
    setAiPreview(null)
    try {
      const res = await generateFormula(aiPrompt.trim())
      if (res.ok && (res.filterFormula || res.formula || res.sortFormula)) {
        const nextFormula = res.filterFormula ?? res.formula ?? ''
        const nextSortFormula = res.sortFormula ?? ''
        const nextSortDir = res.sortDir === 'asc' ? 'asc' : 'desc'
        setFormula(nextFormula)
        setSortFormula(nextSortFormula)
        setFormulaSortDir(nextSortDir)
        setTemplateName(res.title || '')
        setAiStrategy(res)
        setFormulaMessage(res.explanation || 'AI 已生成筛选/排序公式')
        setAiPreview({ loading: true, total: 0, scannedCount: 0, items: [], error: '' })
        try {
          const preview = await runScreener({
            preset: 'custom',
            formula: nextFormula.trim() || null,
            sortFormula: nextSortFormula.trim() || null,
            sortDir: nextSortFormula.trim() ? nextSortDir : sortDir,
            sortBy,
            page: 1,
            pageSize: 5,
          })
          setAiPreview({ loading: false, total: preview.total, scannedCount: preview.scannedCount, items: preview.items, error: '', insight: preview.insight || null })
          setResultInsight(preview.insight || null)
        } catch (previewError: any) {
          setAiPreview({ loading: false, total: 0, scannedCount: 0, items: [], error: previewError.message || '预览验证失败' })
        }
      } else {
        setFormulaMessage(res.reason || 'AI 无法生成公式')
      }
    } catch (e: any) {
      setFormulaMessage(e.message || 'AI 生成失败')
    }
    setAiLoading(false)
  }

  const handleDeleteTemplate = async (template: FilterTemplate) => {
    const newTemplates = savedTemplates.filter(t => t.name !== template.name)
    setSavedTemplates(newTemplates)
    saveTemplates(newTemplates)
    if (template.remoteId) {
      try {
        await deleteTemplate(template.remoteId)
        setTemplateSyncMessage('账号模板已删除')
      } catch {
        setTemplateSyncMessage('本地模板已删除，远端删除失败')
      }
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / 50))
  const showCustom = preset === 'custom'
  const sortLabel = SORT_OPTIONS.find(o => o.value === sortBy)?.label || sortBy
  const hasFormulaSort = customMode === 'formula' && Boolean(sortFormula.trim())
  const chartSortBy = hasFormulaSort ? 'formulaSortValue' : sortBy
  const chartSortDir = hasFormulaSort ? formulaSortDir : sortDir
  const chartSortLabel = hasFormulaSort ? (templateName.trim() || '公式排序') : sortLabel

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Filter className="w-7 h-7" style={{ color: 'var(--accent-primary)' }} />
        <h1 className="font-h1" style={{ color: 'var(--text-primary)' }}>股票筛选</h1>
        {dataDate && (
          <span className="text-xs ml-auto px-2 py-1 rounded" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
            数据更新: {dataDate}
          </span>
        )}
      </div>

      {/* Mode Switch */}
      <div className="grid grid-cols-3 gap-3">
        {SCREENER_MODES.map(({ key, label, desc }) => (
          <button
            key={key}
            onClick={() => handleModeChange(key)}
            className="text-left px-4 py-3 rounded-xl border transition-all"
            style={{
              backgroundColor: screenerMode === key ? 'var(--accent-primary)' : 'var(--bg-surface)',
              borderColor: screenerMode === key ? 'var(--accent-primary)' : 'var(--border-subtle)',
              color: screenerMode === key ? '#fff' : 'var(--text-primary)',
            }}
          >
            <div className="text-sm font-semibold">{label}</div>
            <div className="text-xs mt-0.5" style={{ color: screenerMode === key ? 'rgba(255,255,255,0.75)' : 'var(--text-muted)' }}>
              {desc}
            </div>
          </button>
        ))}
      </div>

      {/* Preset Buttons */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {visiblePresets.map(({ key, label, desc }) => (
          <button
            key={key}
            onClick={() => handlePresetChange(key)}
            className="text-left px-4 py-3 rounded-xl border transition-all"
            style={{
              backgroundColor: preset === key ? 'var(--accent-primary)' : 'var(--bg-surface)',
              borderColor: preset === key ? 'var(--accent-primary)' : 'var(--border-subtle)',
              color: preset === key ? '#fff' : 'var(--text-primary)',
            }}
          >
            <div className="text-sm font-semibold">{label}</div>
            <div className="text-xs mt-0.5" style={{ color: preset === key ? 'rgba(255,255,255,0.75)' : 'var(--text-muted)' }}>
              {desc}
            </div>
          </button>
        ))}
      </div>

      {/* Custom Filter Panel */}
      {showCustom && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="rounded-xl border border-border-subtle p-5 space-y-4"
          style={{ backgroundColor: 'var(--bg-surface)' }}
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle pb-3">
            <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>自定义模式</span>
            <Button size="sm" variant={customMode === 'simple' ? 'default' : 'outline'} onClick={() => setCustomMode('simple')}>简单条件</Button>
            <Button size="sm" variant={customMode === 'formula' ? 'default' : 'outline'} onClick={() => setCustomMode('formula')}>
              <Braces className="w-3.5 h-3.5 mr-1" />公式模式
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowFormulaHelp(true)}>
              <HelpCircle className="w-3.5 h-3.5 mr-1" />公式教学
            </Button>
          </div>

          {customMode === 'simple' ? (
            <>
              {/* Section: 盈利能力 */}
              <div>
                <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--accent-primary)' }}>盈利能力</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <FilterField label="最低 ROE (%)" placeholder="如 15" value={minRoe} onChange={setMinRoe} />
                  <FilterField label="最低营收增速 (%)" placeholder="如 10" value={minRevenueYoY} onChange={setMinRevenueYoY} />
                  <FilterField label="最低净利增速 (%)" placeholder="如 20" value={minNetProfitYoY} onChange={setMinNetProfitYoY} />
                  <FilterField label="最高负债率 (%)" placeholder="如 60" value={maxDebtRatio} onChange={setMaxDebtRatio} />
                </div>
              </div>

              {/* Section: 估值 */}
              <div>
                <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--accent-primary)' }}>估值</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <FilterField label="最高 PE" placeholder="如 50" value={maxPe} onChange={setMaxPe} />
                  <FilterField label="最高 PB" placeholder="如 5" value={maxPb} onChange={setMaxPb} />
                </div>
              </div>

              {/* Section: 规模与行业 */}
              <div>
                <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--accent-primary)' }}>规模与行业</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <FilterField label="最低市值 (亿)" placeholder="如 100" value={minMarketCap} onChange={setMinMarketCap} />
                  <FilterField label="最高市值 (亿)" placeholder="如 10000" value={maxMarketCap} onChange={setMaxMarketCap} />
                  <IndustryPicker
                    industry={industry}
                    industries={industries}
                    showIndustryDropdown={showIndustryDropdown}
                    setShowIndustryDropdown={setShowIndustryDropdown}
                    setIndustry={setIndustry}
                    industryRef={industryRef}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                <div className="space-y-3">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--accent-primary)' }}>公式</label>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={handleValidateFormula}>校验</Button>
                        <Button size="sm" variant="outline" onClick={() => {
                          setFormula('EXISTS(@2026Q1净利润)')
                          setSortFormula('@2026Q1净利润')
                          setFormulaSortDir('desc')
                        }}>排行示例</Button>
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>筛选公式：决定哪些股票进入结果，可留空</span>
                        <button type="button" onClick={() => setFormulaTarget('filter')} className="text-xs hover:underline" style={{ color: formulaTarget === 'filter' ? 'var(--accent-primary)' : 'var(--text-muted)' }}>字段插入到这里</button>
                      </div>
                      <textarea
                        value={formula}
                        onFocus={() => setFormulaTarget('filter')}
                        onChange={e => setFormula(e.target.value)}
                        placeholder="例如：@ROE > 12 AND @净利润同比 > 20"
                        className="min-h-24 w-full rounded-lg border px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring/40"
                        style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                      />
                    </div>
                    <div>
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>排序公式：决定排行依据，例如 @2026Q1净利润</span>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => setFormulaTarget('sort')} className="text-xs hover:underline" style={{ color: formulaTarget === 'sort' ? 'var(--accent-primary)' : 'var(--text-muted)' }}>字段插入到这里</button>
                          <select
                            value={formulaSortDir}
                            onChange={e => setFormulaSortDir(e.target.value as 'asc' | 'desc')}
                            className="h-7 rounded border px-2 text-xs"
                            style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                          >
                            <option value="desc">降序：高到低</option>
                            <option value="asc">升序：低到高</option>
                          </select>
                        </div>
                      </div>
                      <textarea
                        value={sortFormula}
                        onFocus={() => setFormulaTarget('sort')}
                        onChange={e => setSortFormula(e.target.value)}
                        placeholder="例如：@2026Q1净利润；只想排行时，筛选公式可写 EXISTS(@2026Q1净利润)"
                        className="min-h-16 w-full rounded-lg border px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring/40"
                        style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                      />
                    </div>
                    <p className="text-xs" style={{ color: formulaMessage.includes('有效') || formulaMessage.includes('生成') ? 'var(--accent-primary)' : 'var(--text-muted)' }}>
                      {formulaMessage || '筛选公式负责过滤；排序公式负责排名。行业也能写成 @小金属行业 / @稀土行业。'}
                    </p>
                  </div>

                  <div className="rounded-lg border border-border-subtle p-3" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      <Wand2 className="w-4 h-4" /> AI 生成公式
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        value={aiPrompt}
                        onChange={e => setAiPrompt(e.target.value)}
                        placeholder="描述你的想法，例如：小金属行业 ROE 排行，或稀土行业 2026Q1净利润排行"
                        className="h-9 text-sm"
                      />
                      <Button size="sm" onClick={handleAiGenerateFormula} disabled={aiLoading}>
                        {aiLoading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Wand2 className="w-3.5 h-3.5 mr-1" />}
                        生成
                      </Button>
                    </div>
                  </div>

                  {aiStrategy && (
                    <div className="rounded-lg border border-border-subtle p-3" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{aiStrategy.title || 'AI 策略'}</div>
                          <div className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{aiStrategy.summary || aiStrategy.explanation || 'AI 已生成可编辑策略'}</div>
                        </div>
                        <Button size="sm" variant="outline" onClick={handleSearch}>应用并筛选</Button>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <div className="mb-1 text-xs font-semibold" style={{ color: 'var(--accent-primary)' }}>核心逻辑</div>
                          <ul className="space-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {(aiStrategy.investmentLogic?.length ? aiStrategy.investmentLogic : aiStrategy.steps?.length ? aiStrategy.steps : ['把用户描述转换成一套可执行的投资筛选策略']).map((step, index) => (
                              <li key={index}>👉 {step}</li>
                            ))}
                          </ul>

                          <div className="mb-1 mt-3 text-xs font-semibold" style={{ color: 'var(--accent-primary)' }}>适用场景</div>
                          <ul className="space-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {(aiStrategy.useCases?.length ? aiStrategy.useCases : ['生成初筛名单，作为后续人工研究入口']).map((item, index) => (
                              <li key={index}>👉 {item}</li>
                            ))}
                          </ul>
                        </div>

                        <div>
                          <div className="mb-1 text-xs font-semibold" style={{ color: 'var(--accent-primary)' }}>验证结果</div>
                          {aiPreview?.loading ? (
                            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />正在试运行预览...
                            </div>
                          ) : aiPreview?.error ? (
                            <div className="text-xs" style={{ color: 'var(--up-red)' }}>{aiPreview.error}</div>
                          ) : aiPreview ? (
                            <div className="space-y-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                              <div>扫描 {aiPreview.scannedCount} 只，匹配 <span style={{ color: 'var(--accent-primary)' }}>{aiPreview.total}</span> 只</div>
                              <div className="space-y-1">
                                {aiPreview.items.map(item => (
                                  <button key={item.symbol} type="button" onClick={() => navigateToStock(item)} className="block w-full truncate text-left hover:underline" style={{ color: 'var(--text-primary)' }}>
                                    {item.name || item.symbol} · {item.industry || '未知行业'}{item.formulaSortValue != null ? ` · 排序值 ${formatFormulaValue(item.formulaSortValue)}` : ''}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>生成后会自动校验并预览 Top 5。</div>
                          )}
                        </div>
                      </div>

                      {(aiStrategy.warnings?.length || aiStrategy.validationPlan?.length) ? (
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          {aiStrategy.warnings && aiStrategy.warnings.length > 0 && (
                            <div className="rounded p-2 text-xs" style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-muted)' }}>
                              <span style={{ color: 'var(--accent-primary)' }}>风险：</span>{aiStrategy.warnings.join('；')}
                            </div>
                          )}
                          {aiStrategy.validationPlan && aiStrategy.validationPlan.length > 0 && (
                            <div className="rounded p-2 text-xs" style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-muted)' }}>
                              <span style={{ color: 'var(--accent-primary)' }}>怎么验证：</span>{aiStrategy.validationPlan.join('；')}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-border-subtle p-3 max-h-96 overflow-y-auto" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>字段库（点击插入）</div>
                    <div className="flex rounded border p-0.5" style={{ borderColor: 'var(--border-subtle)' }}>
                      <button type="button" onClick={() => setFormulaTarget('filter')} className={`rounded px-2 py-0.5 text-xs ${formulaTarget === 'filter' ? 'bg-bg-surface-hover' : ''}`} style={{ color: formulaTarget === 'filter' ? 'var(--accent-primary)' : 'var(--text-muted)' }}>筛选</button>
                      <button type="button" onClick={() => setFormulaTarget('sort')} className={`rounded px-2 py-0.5 text-xs ${formulaTarget === 'sort' ? 'bg-bg-surface-hover' : ''}`} style={{ color: formulaTarget === 'sort' ? 'var(--accent-primary)' : 'var(--text-muted)' }}>排序</button>
                    </div>
                  </div>
                  {Object.entries(groupedFormulaFields).map(([category, fields]) => (
                    <div key={category} className="mb-3">
                      <div className="mb-1 text-xs" style={{ color: 'var(--accent-primary)' }}>{category}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {fields.map(field => (
                          <button
                            key={field.key}
                            type="button"
                            onClick={() => insertFormulaField(field.label)}
                            title={field.description}
                            className="rounded border px-2 py-1 text-xs hover:bg-bg-surface-hover"
                            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                          >@{field.label}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Template bar */}
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border-subtle">
            {customMode === 'formula' && (
              <Input
                placeholder="类别" value={formulaCategory} onChange={e => setFormulaCategory(e.target.value)}
                className="h-8 text-xs w-24"
              />
            )}
            <Input
              placeholder="模板名称" value={templateName} onChange={e => setTemplateName(e.target.value)}
              className="h-8 text-xs w-28"
            />
            <Button size="sm" variant="outline" onClick={() => void handleSaveTemplate()} disabled={!templateName.trim()}>
              <Save className="w-3 h-3 mr-1" />保存{customMode === 'formula' ? '公式' : ''}
            </Button>
            {templateSyncMessage && (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{templateSyncMessage}</span>
            )}
            {savedTemplates.map(t => (
              <div key={t.name} className="flex items-center gap-0.5 rounded border px-1" style={{ borderColor: 'var(--border-subtle)' }}>
                <button
                  onClick={() => handleLoadTemplate(t)}
                  className="text-xs px-1.5 py-1 rounded hover:bg-bg-surface-hover"
                  style={{ color: 'var(--text-secondary)' }}
                  title={[t.formula, t.sortFormula ? `排序：${t.sortFormula}` : ''].filter(Boolean).join('；') || undefined}
                >{t.category ? `${t.category} / ` : ''}{t.name}</button>
                <button
                  onClick={() => void handleDeleteTemplate(t)}
                  className="p-0.5 rounded hover:bg-bg-surface-hover"
                  style={{ color: 'var(--text-muted)' }}
                ><Trash2 className="w-3 h-3" /></button>
              </div>
            ))}
          </div>

          {/* Sort + Search */}
          <div className="flex items-center gap-3">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>排序:</span>
            <select
              value={sortBy}
              onChange={e => handleSortChange(e.target.value)}
              className="h-8 px-2 rounded border text-xs"
              style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
            >
              {SORT_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              onClick={() => {
                const newDir = sortDir === 'desc' ? 'asc' : 'desc'
                setSortDir(newDir); setPage(1); doSearch(1, sortBy, newDir, appliedTableQuery)
              }}
              className="p-1 rounded hover:bg-bg-surface-hover"
              title={sortDir === 'desc' ? '降序' : '升序'}
            >
              {sortDir === 'desc' ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
            <Button size="sm" onClick={handleSearch}>
              <Search className="w-3.5 h-3.5 mr-1.5" /> 筛选
            </Button>
            {hasFormulaSort && (
              <span className="text-xs" style={{ color: 'var(--accent-primary)' }}>当前按 {chartSortLabel} {formulaSortDir === 'desc' ? '降序' : '升序'}</span>
            )}
          </div>
        </motion.div>
      )}

      {/* Results header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {!loading && (matchedCount > 0 || total > 0) && (
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              已扫描 <span style={{ color: 'var(--text-primary)' }}>{scannedCount}</span> 只，
              匹配 <span style={{ color: 'var(--accent-primary)' }}>{matchedCount}</span> 只
              {appliedTableQuery && (
                <>，搜索 <span style={{ color: 'var(--accent-primary)' }}>{appliedTableQuery}</span></>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {results.length > 0 && (
            <>
              <Button
                size="sm" variant="outline"
                onClick={() => setShowChart(v => !v)}
                className={showChart ? 'border-accent-primary' : ''}
              >
                <BarChart3 className="w-3.5 h-3.5 mr-1" /> {showChart ? '隐藏图表' : '图表'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => exportCSV(results)}>
                <Download className="w-3.5 h-3.5 mr-1" /> 导出
              </Button>
              {selectedStocks.size >= 2 && (
                <Button size="sm" onClick={() => setShowCompare(true)}>
                  对比 ({selectedStocks.size})
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Result Search */}
      <div className="rounded-xl border border-border-subtle p-3" style={{ backgroundColor: 'var(--bg-surface)' }}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <Input
              value={tableQuery}
              onChange={e => setTableQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleTableSearch() }}
              placeholder="在当前筛选结果中搜索代码 / 名称 / 行业，例如 600519 或 贵州茅台"
              className="h-9 pl-9 pr-9 text-sm"
            />
            {tableQuery && (
              <button
                type="button"
                onClick={handleClearTableSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-bg-surface-hover"
                style={{ color: 'var(--text-muted)' }}
                title="清空搜索"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button size="sm" onClick={handleTableSearch}>
            <Search className="w-3.5 h-3.5 mr-1.5" /> 搜索表格
          </Button>
          {appliedTableQuery && (
            <Button size="sm" variant="outline" onClick={handleClearTableSearch}>
              清空
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          搜索会在当前策略和筛选条件的全部匹配结果中查找，不只查当前页。
        </p>
      </div>

      {/* Diagnosis */}
      {diagnosis && (
        <div className="rounded-xl border border-border-subtle p-4" style={{ backgroundColor: 'var(--bg-surface)' }}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                找到了 {diagnosis.stock.name || diagnosis.stock.symbol}，但未入选当前筛选
              </div>
              <div className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                {diagnosis.stock.symbol} · {diagnosis.stock.industry || '未知行业'} · 当前价 {formatNum(diagnosis.stock.currentPrice, 2)}
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => navigateToStock(diagnosis.stock)}>
              查看股票
            </Button>
          </div>
          <ul className="mt-3 space-y-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {diagnosis.reasons.map((reason, index) => (
              <li key={index}>• {reason}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
            你可以切换到“全部”模式、放宽自定义条件，或清空表格搜索后再试。
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg p-4 text-sm" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--up-red)' }}>
          {error}
        </div>
      )}

      {/* Result Insight */}
      {resultInsight && !loading && (
        <ResultInsightPanel
          insight={resultInsight}
          aiLoading={aiInsightLoading}
          aiError={aiInsightError}
          aiNote={aiInsightNote}
          onGenerateAi={handleGenerateAiInsight}
          onNavigateSymbol={(symbol) => navigate(`/stock/${symbol}`)}
        />
      )}

      {/* Ranking Chart */}
      {showChart && results.length > 0 && !loading && (
        <RankingChart stocks={results} sortBy={chartSortBy} sortDir={chartSortDir} sortLabel={chartSortLabel} onNavigate={navigateToStock} />
      )}

      {/* Table */}
      <div className="rounded-xl border border-border-subtle overflow-hidden" style={{ backgroundColor: 'var(--bg-surface)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-elevated)' }}>
                <th className="w-8 px-2 py-2.5">
                  <button onClick={toggleSelectAll} className="p-0.5">
                    {selectedStocks.size === results.length && results.length > 0
                      ? <CheckSquare className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                      : <Square className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
                  </button>
                </th>
                <ThButton field="symbol" label="代码" sortBy="" sortDir="desc" onClick={() => {}} />
                <th className="text-left px-3 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>名称</th>
                <th className="text-left px-3 py-2.5 font-medium hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>行业</th>
                <ThButton field="changePercent" label="涨跌幅" sortBy={sortBy} sortDir={sortDir} onClick={() => handleSort('changePercent')} />
                <ThButton field="pe" label="PE" sortBy={sortBy} sortDir={sortDir} onClick={() => handleSort('pe')} />
                <ThButton field="marketCap" label="市值" sortBy={sortBy} sortDir={sortDir} onClick={() => handleSort('marketCap')} />
                <ThButton field="roe" label="ROE" sortBy={sortBy} sortDir={sortDir} onClick={() => handleSort('roe')} />
                <ThButton field="netProfitYoY" label="净利增速" sortBy={sortBy} sortDir={sortDir} onClick={() => handleSort('netProfitYoY')} />
                <ThButton field="revenueYoY" label="营收增速" sortBy={sortBy} sortDir={sortDir} onClick={() => handleSort('revenueYoY')} />
                <ThButton field="consecutiveGrowthYears" label="连增年" sortBy={sortBy} sortDir={sortDir} onClick={() => handleSort('consecutiveGrowthYears')} />
                {isRecentStrength && (
                  <ThButton field="recentStrength" label="3月涨幅" sortBy={sortBy} sortDir={sortDir} onClick={() => handleSort('recentStrength')} />
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={13} className="text-center py-16">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" style={{ color: 'var(--accent-primary)' }} />
                    <span style={{ color: 'var(--text-muted)' }}>筛选中...</span>
                  </td>
                </tr>
              ) : results.length === 0 ? (
                <tr>
                  <td colSpan={13} className="text-center py-16" style={{ color: 'var(--text-muted)' }}>
                    <div className="space-y-2">
                      <p>{preset !== 'custom' ? '未找到匹配的股票' : '未找到匹配的股票，尝试放宽筛选条件'}</p>
                      <p className="text-xs">
                        请先在
                        <a href="/data" className="mx-1 underline" style={{ color: 'var(--accent-primary)' }}>数据中心</a>
                        下载股票财务数据与行情数据
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                results.map(stock => (
                  <tr
                    key={stock.symbol}
                    className="border-t border-border-subtle hover:bg-bg-surface-hover transition-colors cursor-pointer"
                  >
                    <td className="px-2 py-2.5" onClick={e => e.stopPropagation()}>
                      <button onClick={() => toggleSelect(stock.symbol)} className="p-0.5">
                        {selectedStocks.has(stock.symbol)
                          ? <CheckSquare className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                          : <Square className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
                      </button>
                    </td>
                    <td
                      className="px-3 py-2.5 font-mono text-xs"
                      style={{ color: 'var(--accent-primary)' }}
                      onClick={() => navigateToStock(stock)}
                    >{stock.symbol}</td>
                    <td className="px-3 py-2.5 font-medium" style={{ color: 'var(--text-primary)' }} onClick={() => navigateToStock(stock)}>
                      <div>{stock.name || '-'}</div>
                      {customMode === 'formula' && stock.formulaSortValue != null && (
                        <div className="mt-1 text-[11px] font-normal" style={{ color: 'var(--accent-primary)' }}>
                          排序值：{formatFormulaValue(stock.formulaSortValue)}
                        </div>
                      )}
                      {customMode === 'formula' && stock.formulaValues && Object.keys(stock.formulaValues).length > 0 && (
                        <div className="mt-1 max-w-xs truncate text-[11px] font-normal" style={{ color: 'var(--text-muted)' }}
                          title={Object.entries(stock.formulaValues).map(([k, v]) => `${k}: ${formatFormulaValue(v)}`).join('；')}>
                          {Object.entries(stock.formulaValues).slice(0, 3).map(([k, v]) => `${k}:${formatFormulaValue(v)}`).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 hidden md:table-cell" style={{ color: 'var(--text-secondary)' }} onClick={() => navigateToStock(stock)}>
                      {stock.industry || '-'}
                    </td>
                    <td className="px-3 py-2.5 text-right" style={{ color: stock.changePercent >= 0 ? 'var(--up-red)' : 'var(--down-green)' }} onClick={() => navigateToStock(stock)}>
                      {formatPct(stock.changePercent)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono" style={{ color: 'var(--text-secondary)' }} onClick={() => navigateToStock(stock)}>
                      {stock.pe > 0 ? formatNum(stock.pe, 1) : '-'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs" style={{ color: 'var(--text-secondary)' }} onClick={() => navigateToStock(stock)}>
                      {formatMarketCap(stock.marketCap)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono" style={{ color: 'var(--accent-primary)' }} onClick={() => navigateToStock(stock)}>
                      {stock.roe > 0 ? formatPct(stock.roe) : '-'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono" style={{ color: stock.netProfitYoY >= 0 ? 'var(--up-red)' : 'var(--down-green)' }} onClick={() => navigateToStock(stock)}>
                      {formatPct(stock.netProfitYoY)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono hidden xl:table-cell" style={{ color: stock.revenueYoY >= 0 ? 'var(--up-red)' : 'var(--down-green)' }} onClick={() => navigateToStock(stock)}>
                      {formatPct(stock.revenueYoY)}
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono" style={{ color: 'var(--text-primary)' }} onClick={() => navigateToStock(stock)}>
                      {stock.consecutiveGrowthYears > 0 ? stock.consecutiveGrowthYears : '-'}
                    </td>
                    {isRecentStrength && (
                      <td className="px-3 py-2.5 text-right font-mono" style={{ color: stock.recentStrength >= 0 ? 'var(--up-red)' : 'var(--down-green)' }} onClick={() => navigateToStock(stock)}>
                        {formatPct(stock.recentStrength)}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border-subtle">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              第 {page} 页，共 {totalPages} 页 ({total} 条)
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => handlePageChange(page - 1)}>上一页</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => handlePageChange(page + 1)}>下一页</Button>
            </div>
          </div>
        )}
      </div>

      {/* Formula Help */}
      {showFormulaHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowFormulaHelp(false)}>
          <div
            className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border-subtle p-5 shadow-xl"
            style={{ backgroundColor: 'var(--bg-surface)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
                <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>公式教学</h2>
              </div>
              <button onClick={() => setShowFormulaHelp(false)} className="rounded p-1 hover:bg-bg-surface-hover">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <section>
                <h3 className="mb-2 font-semibold" style={{ color: 'var(--text-primary)' }}>1. 筛选和排序分开写</h3>
                <p className="mb-2">筛选公式决定“留下谁”，排序公式决定“按什么排行”。行业也能当布尔字段，例如 <code>@小金属行业</code>、<code>@稀土行业</code>。</p>
                <code className="block whitespace-pre-line rounded p-3 text-xs" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>筛选：@小金属行业 AND EXISTS(@2026Q1净利润)
排序：@2026Q1净利润（降序）</code>
              </section>
              <section>
                <h3 className="mb-2 font-semibold" style={{ color: 'var(--text-primary)' }}>2. 支持比较、逻辑和四则运算</h3>
                <p>比较：<code>&gt; &gt;= &lt; &lt;= == !=</code>；逻辑：<code>AND OR NOT</code>，也可以写“且 / 或 / 非”。</p>
                <code className="mt-2 block rounded p-3 text-xs" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>@市盈率TTM / @净利润同比 &lt; 1.5 AND @资产负债率 &lt; 60</code>
              </section>
              <section>
                <h3 className="mb-2 font-semibold" style={{ color: 'var(--text-primary)' }}>3. 行业分类</h3>
                <p>字段库里会出现“行业分类”，也可以直接手写 <code>@行业名行业</code>。多个行业可以用 <code>OR</code>：</p>
                <code className="mt-2 block rounded p-3 text-xs" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>@稀土行业 OR @小金属行业</code>
              </section>
              <section>
                <h3 className="mb-2 font-semibold" style={{ color: 'var(--text-primary)' }}>4. 年度、季度、最近 N 期</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {['@2025Q1净利润同比 > 20', '@2024净利润 > 0', '@净利润[2025Q1] > @净利润[2024Q1]', 'MIN(@近3年净利润同比) > 0'].map(item => (
                    <button key={item} onClick={() => { setFormula(item); setShowFormulaHelp(false); setCustomMode('formula') }} className="rounded border p-2 text-left font-mono text-xs hover:bg-bg-surface-hover" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}>{item}</button>
                  ))}
                </div>
              </section>
              <section>
                <h3 className="mb-2 font-semibold" style={{ color: 'var(--text-primary)' }}>5. 常用函数</h3>
                <ul className="list-disc space-y-1 pl-5">
                  <li><code>AVG()</code> 平均值，例如 <code>AVG(@近3年ROE) &gt; 10</code></li>
                  <li><code>MIN()</code> 最小值，例如 <code>MIN(@近3年净利润同比) &gt; 0</code></li>
                  <li><code>CAGR()</code> 复合增速，例如 <code>CAGR(@近3年营业收入) &gt; 15</code></li>
                  <li><code>EXISTS()</code> 数据存在，例如 <code>EXISTS(@2026Q1净利润)</code></li>
                  <li><code>MISSING()</code> 数据缺失，例如 <code>MISSING(@2026Q1净利润)</code></li>
                </ul>
              </section>
              <section>
                <h3 className="mb-2 font-semibold" style={{ color: 'var(--text-primary)' }}>6. 模板建议</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    '@小金属行业 AND @ROE > 12',
                    '@稀土行业 AND EXISTS(@2026Q1净利润)',
                    '@ROE > 12 AND @净利润同比 > 20 AND @市盈率TTM < 30',
                    '@收盘价 > @MA60 AND @近20日涨跌幅 > 10',
                    'MIN(@近3年营收同比) > 0 AND MIN(@近3年净利润同比) > 0',
                    '@2025Q1净利润同比 > @2024FY净利润同比',
                  ].map(item => (
                    <button key={item} onClick={() => { setFormula(item); setShowFormulaHelp(false); setCustomMode('formula') }} className="rounded border p-2 text-left font-mono text-xs hover:bg-bg-surface-hover" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}>{item}</button>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* Comparison Panel */}
      {showCompare && compareStocks.length >= 2 && (
        <ComparisonPanel stocks={compareStocks} onClose={() => setShowCompare(false)} onNavigate={navigateToStock} />
      )}
    </div>
  )
}

function IndustryPicker({ industry, industries, showIndustryDropdown, setShowIndustryDropdown, setIndustry, industryRef }: {
  industry: string
  industries: { name: string; count: number }[]
  showIndustryDropdown: boolean
  setShowIndustryDropdown: (value: boolean) => void
  setIndustry: (value: string) => void
  industryRef: RefObject<HTMLDivElement | null>
}) {
  return (
    <div ref={industryRef} className="relative">
      <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>行业</label>
      <button
        onClick={() => setShowIndustryDropdown(!showIndustryDropdown)}
        className="flex items-center justify-between w-full h-9 px-3 rounded-lg border text-sm"
        style={{
          borderColor: 'var(--border-subtle)',
          backgroundColor: 'var(--bg-elevated)',
          color: industry ? 'var(--text-primary)' : 'var(--text-muted)',
        }}
      >
        {industry || '不限'}
        <ChevronDown className="w-4 h-4" />
      </button>
      {showIndustryDropdown && (
        <div
          className="absolute z-30 top-full mt-1 w-full max-h-48 overflow-y-auto rounded-lg border shadow-lg"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
        >
          <button
            onClick={() => { setIndustry(''); setShowIndustryDropdown(false) }}
            className="w-full text-left px-3 py-2 text-sm hover:bg-bg-surface-hover"
            style={{ color: 'var(--text-muted)' }}
          >不限</button>
          {industries.map(ind => (
            <button
              key={ind.name}
              onClick={() => { setIndustry(ind.name); setShowIndustryDropdown(false) }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-bg-surface-hover flex justify-between"
              style={{ color: 'var(--text-primary)' }}
            >
              <span>{ind.name}</span>
              <span style={{ color: 'var(--text-muted)' }}>{ind.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function FilterField({ label, placeholder, value, onChange }: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      <Input
        type="number" placeholder={placeholder} value={value}
        onChange={e => onChange(e.target.value)}
        className="h-9 text-sm"
      />
    </div>
  )
}

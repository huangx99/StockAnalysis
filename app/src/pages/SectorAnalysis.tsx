import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Loader2, RefreshCw, ChevronDown, ChevronRight, TrendingUp, TrendingDown,
  ArrowUpDown, Search, X, BarChart3,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getSectorOverview } from '@/api/real/stockApi'
import type { SectorOverviewItem } from '@/types'

type SortKey = 'mainNetInflow' | 'changePercent' | 'limitUpCount' | 'superNetInflow' | 'bigNetInflow'

function fmtAmount(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)}亿`
  if (abs >= 1e4) return `${(v / 1e4).toFixed(2)}万`
  return v.toFixed(2)
}

function fmtPrice(v: number): string {
  return v > 0 ? v.toFixed(2) : '-'
}

function fmtVolume(v: number): string {
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}万`
  return v.toFixed(0)
}

function AmountCell({ value }: { value: number }) {
  const color = value > 0 ? 'text-red-500' : value < 0 ? 'text-green-500' : 'text-gray-400'
  return <span className={color}>{fmtAmount(value)}</span>
}

function ChangeCell({ value }: { value: number }) {
  const color = value > 0 ? 'text-red-500' : value < 0 ? 'text-green-500' : 'text-gray-400'
  const icon = value > 0 ? <TrendingUp className="w-3 h-3 inline mr-0.5" /> : value < 0 ? <TrendingDown className="w-3 h-3 inline mr-0.5" /> : null
  return <span className={`${color} font-medium`}>{icon}{value > 0 ? '+' : ''}{value.toFixed(2)}%</span>
}

// ── Sector Row ──

function SectorRow({
  sector,
  index,
  isExpanded,
  onToggle,
}: {
  sector: SectorOverviewItem
  index: number
  isExpanded: boolean
  onToggle: () => void
}) {
  const navigate = useNavigate()

  return (
    <>
      <tr
        className="border-b border-border-subtle hover:bg-bg-surface-hover cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <td className="px-3 py-2.5 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          {index + 1}
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
            <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{sector.name}</span>
          </div>
        </td>
        <td className="px-3 py-2.5 text-right text-sm">
          <ChangeCell value={sector.changePercent} />
        </td>
        <td className="px-3 py-2.5 text-right text-sm">
          <AmountCell value={sector.mainNetInflow} />
        </td>
        <td className="px-3 py-2.5 text-right text-sm">
          <AmountCell value={sector.superNetInflow} />
        </td>
        <td className="px-3 py-2.5 text-right text-sm">
          <AmountCell value={sector.bigNetInflow} />
        </td>
        <td className="px-3 py-2.5 text-center text-sm">
          {sector.limitUpCount > 0 ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-500">
              {sector.limitUpCount}
            </span>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>0</span>
          )}
        </td>
        <td className="px-3 py-2.5 text-center">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
          >
            盘口
          </Button>
        </td>
      </tr>
      <AnimatePresence>
        {isExpanded && (
          <tr>
            <td colSpan={8} className="p-0">
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <SectorDetail
                  sector={sector}
                  onStockClick={(code) => navigate(`/stock/${code}`)}
                />
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  )
}

// ── Sector Detail (Bid/Ask or Profile fallback) ──

interface DetailItem {
  code: string
  name: string
  // bid/ask fields
  buyTotalAmount?: number
  sellTotalAmount?: number
  netAmount?: number
  buy1Price?: number
  buy1Volume?: number
  sell1Price?: number
  sell1Volume?: number
  // profile fields
  currentPrice?: number
  changePercent?: number
  turnoverAmount?: number
  volume?: number
  marketCap?: number
  turnoverRate?: number
  pe?: number
  pb?: number
}

interface DetailResponse {
  board: string
  source: string
  updatedAt: string
  total: number
  items: DetailItem[]
}

function SectorDetail({
  sector,
  onStockClick,
}: {
  sector: SectorOverviewItem
  onStockClick: (code: string) => void
}) {
  const [detailData, setDetailData] = useState<DetailResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searchQ, setSearchQ] = useState('')

  const isBidAsk = detailData?.source === 'bidask' || detailData?.source === 'pytdx'
  const [sortKey, setSortKey] = useState('turnoverAmount')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const loadDetail = useCallback(async () => {
    if (detailData || loading) return
    setLoading(true)
    setError('')
    try {
      const codes = sector.limitUpStocks.map(s => s.code).join(',')
      const url = `/api/sector/${encodeURIComponent(sector.name)}/bidask${codes ? `?codes=${codes}` : ''}`
      const res = await fetch(url)
      const data: DetailResponse = await res.json()
      setDetailData(data)
      setSortKey(data.source === 'profile' ? 'turnoverAmount' : 'buyTotalAmount')
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [sector.name, sector.limitUpStocks, detailData, loading])

  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const getNum = (item: DetailItem, key: string): number => {
    const v = item[key as keyof DetailItem]
    return typeof v === 'number' ? v : 0
  }

  let items = detailData?.items ?? []
  if (searchQ) {
    const q = searchQ.toLowerCase()
    items = items.filter(i => i.code.includes(q) || (i.name || '').toLowerCase().includes(q))
  }
  items = [...items].sort((a, b) => {
    const av = getNum(a, sortKey)
    const bv = getNum(b, sortKey)
    return sortDir === 'desc' ? bv - av : av - bv
  })

  const limitUpCodes = new Set(sector.limitUpStocks.map(s => s.code))

  const SortH = ({ label, k }: { label: string; k: string }) => (
    <button onClick={() => handleSort(k)} className="flex items-center gap-0.5 ml-auto hover:text-gray-200 font-medium">
      {label} <ArrowUpDown className="w-3 h-3" />
    </button>
  )

  return (
    <div className="px-4 py-3" style={{ backgroundColor: 'var(--bg-elevated)' }}>
      {/* Limit-up stocks bar */}
      {sector.limitUpStocks.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5 items-center">
          <span className="text-xs font-medium mr-1" style={{ color: 'var(--text-muted)' }}>涨停股:</span>
          {sector.limitUpStocks.map(s => (
            <button
              key={s.code}
              onClick={() => onStockClick(s.code)}
              className="text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors cursor-pointer"
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Search + info bar */}
      <div className="flex items-center gap-3 mb-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
          <Input
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            placeholder="搜索代码/名称..."
            className="h-7 pl-7 pr-7 text-xs"
          />
          {searchQ && (
            <button onClick={() => setSearchQ('')} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {detailData ? `${items.length} 只` : ''}
        </span>
        {detailData?.source === 'pytdx' && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/10 text-green-500">
            pytdx 实时盘口
          </span>
        )}
        {detailData?.source === 'profile' && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-500">
            行情数据（盘口暂不可用）
          </span>
        )}
        {detailData && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {detailData.updatedAt}
          </span>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin mr-2" style={{ color: 'var(--text-muted)' }} />
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>加载数据...</span>
        </div>
      )}
      {error && <div className="text-sm text-red-500 py-4 text-center">{error}</div>}

      {/* Bid/Ask mode */}
      {detailData && !loading && isBidAsk && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle" style={{ color: 'var(--text-muted)' }}>
                <th className="px-2 py-1.5 text-left font-medium">代码</th>
                <th className="px-2 py-1.5 text-left font-medium">名称</th>
                <th className="px-2 py-1.5 text-right"><SortH label="买盘金额" k="buyTotalAmount" /></th>
                <th className="px-2 py-1.5 text-right"><SortH label="卖盘金额" k="sellTotalAmount" /></th>
                <th className="px-2 py-1.5 text-right"><SortH label="净挂单" k="netAmount" /></th>
                <th className="px-2 py-1.5 text-right font-medium">买一价</th>
                <th className="px-2 py-1.5 text-right font-medium">买一量</th>
                <th className="px-2 py-1.5 text-right font-medium">卖一价</th>
                <th className="px-2 py-1.5 text-right font-medium">卖一量</th>
                <th className="px-2 py-1.5 text-center font-medium">涨停</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.code} className="border-b border-border-subtle/50 hover:bg-bg-surface-hover cursor-pointer" onClick={() => onStockClick(item.code)}>
                  <td className="px-2 py-1.5 font-mono text-xs" style={{ color: 'var(--text-primary)' }}>{item.code}</td>
                  <td className="px-2 py-1.5 text-xs" style={{ color: 'var(--text-primary)' }}>{item.name}</td>
                  <td className="px-2 py-1.5 text-right text-xs"><AmountCell value={item.buyTotalAmount ?? 0} /></td>
                  <td className="px-2 py-1.5 text-right text-xs"><AmountCell value={item.sellTotalAmount ?? 0} /></td>
                  <td className="px-2 py-1.5 text-right text-xs font-medium"><AmountCell value={item.netAmount ?? 0} /></td>
                  <td className="px-2 py-1.5 text-right text-xs font-mono">{fmtPrice(item.buy1Price ?? 0)}</td>
                  <td className="px-2 py-1.5 text-right text-xs">{fmtVolume(item.buy1Volume ?? 0)}</td>
                  <td className="px-2 py-1.5 text-right text-xs font-mono">{fmtPrice(item.sell1Price ?? 0)}</td>
                  <td className="px-2 py-1.5 text-right text-xs">{fmtVolume(item.sell1Volume ?? 0)}</td>
                  <td className="px-2 py-1.5 text-center">
                    {limitUpCodes.has(item.code) && <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 font-medium">涨停</span>}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={10} className="py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>{searchQ ? '无匹配结果' : '暂无数据'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Profile fallback mode */}
      {detailData && !loading && !isBidAsk && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle" style={{ color: 'var(--text-muted)' }}>
                <th className="px-2 py-1.5 text-left font-medium">代码</th>
                <th className="px-2 py-1.5 text-left font-medium">名称</th>
                <th className="px-2 py-1.5 text-right"><SortH label="现价" k="currentPrice" /></th>
                <th className="px-2 py-1.5 text-right"><SortH label="涨跌幅" k="changePercent" /></th>
                <th className="px-2 py-1.5 text-right"><SortH label="成交额" k="turnoverAmount" /></th>
                <th className="px-2 py-1.5 text-right"><SortH label="市值" k="marketCap" /></th>
                <th className="px-2 py-1.5 text-right font-medium">换手率</th>
                <th className="px-2 py-1.5 text-center font-medium">涨停</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.code} className="border-b border-border-subtle/50 hover:bg-bg-surface-hover cursor-pointer" onClick={() => onStockClick(item.code)}>
                  <td className="px-2 py-1.5 font-mono text-xs" style={{ color: 'var(--text-primary)' }}>{item.code}</td>
                  <td className="px-2 py-1.5 text-xs" style={{ color: 'var(--text-primary)' }}>{item.name}</td>
                  <td className="px-2 py-1.5 text-right text-xs font-mono">{item.currentPrice ? item.currentPrice.toFixed(2) : '-'}</td>
                  <td className="px-2 py-1.5 text-right text-xs"><ChangeCell value={item.changePercent ?? 0} /></td>
                  <td className="px-2 py-1.5 text-right text-xs">{item.turnoverAmount ? fmtAmount(item.turnoverAmount) : '-'}</td>
                  <td className="px-2 py-1.5 text-right text-xs">{item.marketCap ? fmtAmount(item.marketCap) : '-'}</td>
                  <td className="px-2 py-1.5 text-right text-xs">{item.turnoverRate ? `${item.turnoverRate.toFixed(2)}%` : '-'}</td>
                  <td className="px-2 py-1.5 text-center">
                    {limitUpCodes.has(item.code) && <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 font-medium">涨停</span>}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={8} className="py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>{searchQ ? '无匹配结果' : '暂无数据'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Main Page ──

export default function SectorAnalysis() {
  const [data, setData] = useState<SectorOverviewItem[]>([])
  const [updatedAt, setUpdatedAt] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedSector, setExpandedSector] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('mainNetInflow')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [searchQ, setSearchQ] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await getSectorOverview()
      setData(res.items)
      setUpdatedAt(res.updatedAt)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  let filtered = data
  if (searchQ) {
    const q = searchQ.toLowerCase()
    filtered = data.filter(s => s.name.toLowerCase().includes(q))
  }
  filtered = [...filtered].sort((a, b) => {
    const av = a[sortKey] ?? 0
    const bv = b[sortKey] ?? 0
    return sortDir === 'desc' ? bv - av : av - bv
  })

  // Summary stats
  const totalMainInflow = data.reduce((sum, s) => sum + s.mainNetInflow, 0)
  const totalLimitUp = data.reduce((sum, s) => sum + s.limitUpCount, 0)
  const upSectors = data.filter(s => s.changePercent > 0).length
  const downSectors = data.filter(s => s.changePercent < 0).length

  const SortHeader = ({ label, sortKeyName }: { label: string; sortKeyName: SortKey }) => (
    <button
      onClick={() => handleSort(sortKeyName)}
      className="flex items-center gap-0.5 hover:text-gray-200 font-medium"
    >
      {label}
      <ArrowUpDown className="w-3 h-3" />
    </button>
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-border-subtle" style={{ backgroundColor: 'var(--bg-surface)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BarChart3 className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
            <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>板块资金分析</h1>
            {updatedAt && (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>更新于 {updatedAt}</span>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>

        {/* Summary cards */}
        {!loading && data.length > 0 && (
          <div className="flex gap-4 mt-3">
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>主力净流入:</span>
              <AmountCell value={totalMainInflow} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>涨停数:</span>
              <span className="text-sm font-medium text-red-500">{totalLimitUp}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>上涨板块:</span>
              <span className="text-sm font-medium text-red-500">{upSectors}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>下跌板块:</span>
              <span className="text-sm font-medium text-green-500">{downSectors}</span>
            </div>
          </div>
        )}
      </div>

      {/* Search bar */}
      <div className="shrink-0 px-6 py-2 border-b border-border-subtle flex items-center gap-3" style={{ backgroundColor: 'var(--bg-surface)' }}>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          <Input
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            placeholder="搜索板块名称..."
            className="h-8 pl-8 pr-8 text-sm"
          />
          {searchQ && (
            <button onClick={() => setSearchQ('')} className="absolute right-2.5 top-1/2 -translate-y-1/2">
              <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{filtered.length} 个板块</span>
      </div>

      {/* Main table */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-6 h-6 animate-spin mr-2" style={{ color: 'var(--text-muted)' }} />
            <span style={{ color: 'var(--text-muted)' }}>加载板块数据...</span>
          </div>
        )}
        {error && (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <span className="text-red-500">{error}</span>
            <Button variant="outline" size="sm" onClick={loadData}>重试</Button>
          </div>
        )}
        {!loading && !error && (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--bg-surface)' }}>
              <tr className="border-b border-border-subtle" style={{ color: 'var(--text-muted)' }}>
                <th className="px-3 py-2.5 text-center font-medium w-12">#</th>
                <th className="px-3 py-2.5 text-left font-medium">板块</th>
                <th className="px-3 py-2.5 text-right font-medium">
                  <SortHeader label="涨跌幅" sortKeyName="changePercent" />
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  <SortHeader label="主力净流入" sortKeyName="mainNetInflow" />
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  <SortHeader label="超大单" sortKeyName="superNetInflow" />
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  <SortHeader label="大单" sortKeyName="bigNetInflow" />
                </th>
                <th className="px-3 py-2.5 text-center font-medium">
                  <SortHeader label="涨停" sortKeyName="limitUpCount" />
                </th>
                <th className="px-3 py-2.5 text-center font-medium w-16">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((sector, i) => (
                <SectorRow
                  key={sector.name}
                  sector={sector}
                  index={i}
                  isExpanded={expandedSector === sector.name}
                  onToggle={() => setExpandedSector(prev => prev === sector.name ? null : sector.name)}
                />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>
                    {searchQ ? '无匹配板块' : '暂无数据'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

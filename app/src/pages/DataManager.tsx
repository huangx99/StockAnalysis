import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Database, Download, RefreshCw, Trash2, Search,
  CheckCircle, XCircle, Loader2, ArrowRight,
  ListOrdered, Pause, X, Building2, ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent,
  AlertDialogHeader, AlertDialogFooter, AlertDialogTitle,
  AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { MarketDataPanel } from '@/pages/MarketDataManager'
import {
  getDataStatus, getDataStocks, rebuildDataStocks, searchStocks as apiSearch,
  downloadStockData, refreshStockData, refreshMissingStockData, refreshAllData, deleteStockData,
  startDataDownload, stopDataDownload, resetDataStatus,
  getIndustries, getIndustryStocks, getSingleDownloadStatus,
} from '@/api/real/stockApi'
import type { StockDataSummary, StockSearchResult, DownloadStatus, SingleDownloadProgress } from '@/types'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i]
}

const DATA_TYPE_LABELS: Record<string, string> = {
  profile: '基本信息',
  kline_day: '日K线',
  kline_week: '周K线',
  kline_month: '月K线',
  financials: '财务数据',
  news: '新闻公告',
  dividends: '分红',
  notices: '公告',
  reports: '研报',
}
const PAGE_SIZE = 50
const LOCAL_TABLE_COLS = Object.keys(DATA_TYPE_LABELS).length + 5

function formatMissingDataTypes(types: string[] = []): string {
  return types.map(type => DATA_TYPE_LABELS[type] || type).join('、')
}


interface QueueItem {
  id: string
  symbol: string
  name: string
  status: 'pending' | 'downloading' | 'done' | 'error'
  message?: string
  stats?: Record<string, number>
}

const QUEUE_KEY = 'data_download_queue'

function loadQueue(): QueueItem[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveQueue(q: QueueItem[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
}

export default function DataManager() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') === 'market' ? 'market' : 'stock'

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<StockSearchResult[]>([])
  const [searching, setSearching] = useState(false)

  // Download queue
  const [queue, setQueue] = useState<QueueItem[]>(loadQueue)
  const processingRef = useRef(false)

  // Batch download
  const [batchStatus, setBatchStatus] = useState<DownloadStatus | null>(null)
  const logBoxRef = useRef<HTMLDivElement>(null)

  // Single stock download progress
  const [singleProgress, setSingleProgress] = useState<SingleDownloadProgress | null>(null)

  // Industry download
  const [showIndustry, setShowIndustry] = useState(false)
  const [industries, setIndustries] = useState<{ name: string; code: string; count: number }[]>([])
  const [industriesLoading, setIndustriesLoading] = useState(false)
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null)
  const [industryStocks, setIndustryStocks] = useState<{ code: string; name: string }[]>([])
  const [industryStocksLoading, setIndustryStocksLoading] = useState(false)

  // Local data state
  const [stocks, setStocks] = useState<StockDataSummary[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [localQuery, setLocalQuery] = useState('')
  const [missingOnly, setMissingOnly] = useState(false)
  const [loading, setLoading] = useState(false)
  const [rebuildingLocal, setRebuildingLocal] = useState(false)
  const [refreshingSymbol, setRefreshingSymbol] = useState<string | null>(null)
  const [refreshingAll, setRefreshingAll] = useState(false)


  const fetchStocks = useCallback(async (p: number, q: string, onlyMissing: boolean) => {
    setLoading(true)
    try {
      const res = await getDataStocks(p, PAGE_SIZE, q, onlyMissing)
      setStocks(res.items)
      setTotal(res.total)
    } catch {}
    setLoading(false)
  }, [])

  const fetchBatchStatus = useCallback(async () => {
    try {
      const s = await getDataStatus()
      setBatchStatus(s)
    } catch {}
  }, [])


  useEffect(() => {
    fetchBatchStatus()
  }, [fetchBatchStatus])

  // Debounced local data fetch
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchStocks(page, localQuery, missingOnly)
    }, 250)
    return () => clearTimeout(timer)
  }, [page, localQuery, missingOnly, fetchStocks])

  // Poll batch status while running
  useEffect(() => {
    if (batchStatus?.status !== 'running') return
    const timer = setInterval(() => {
      fetchBatchStatus()
      fetchStocks(page, localQuery, missingOnly)
    }, 3000)
    return () => clearInterval(timer)
  }, [batchStatus?.status, fetchBatchStatus, fetchStocks, page, localQuery, missingOnly])


  // Auto-scroll log box to bottom
  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight
    }
  }, [batchStatus?.logs?.length])


  // Auto-dismiss completed status after 5 seconds. Keep paused state so downloads can resume.
  useEffect(() => {
    if (batchStatus?.status === 'completed') {
      const timer = setTimeout(() => {
        setBatchStatus(null)
        resetDataStatus()
      }, 5000)
      return () => clearTimeout(timer)
    }
  }, [batchStatus?.status])


  // Poll single stock download progress
  useEffect(() => {
    const downloading = queue.some(q => q.status === 'downloading')
    if (!downloading) {
      setSingleProgress(null)
      return
    }
    const timer = setInterval(async () => {
      try {
        const s = await getSingleDownloadStatus()
        setSingleProgress(s)
      } catch {}
    }, 1500)
    return () => clearInterval(timer)
  }, [queue])

  const dismissBatchStatus = () => {
    const shouldReset = batchStatus?.status !== 'paused'
    setBatchStatus(null)
    if (shouldReset) resetDataStatus()
  }


  // Debounced search
  useEffect(() => {
    const q = searchQuery.trim()
    if (!q) { setSearchResults([]); return }
    setSearching(true)
    const timer = setTimeout(async () => {
      try { setSearchResults(await apiSearch(q)) } catch {}
      setSearching(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Process queue
  const processQueue = useCallback(async (q: QueueItem[]) => {
    if (processingRef.current) return
    processingRef.current = true
    let current = [...q]

    for (let i = 0; i < current.length; i++) {
      if (current[i].status !== 'pending') continue
      current[i] = { ...current[i], status: 'downloading' }
      setQueue([...current])
      saveQueue(current)

      try {
        const res = await downloadStockData(current[i].symbol)
        if (res.status === 'ok') {
          const stats = (res as any).stats || {}
          const labelMap: Record<string, string> = {
            kline_day: '日K', kline_week: '周K', kline_month: '月K',
            financials: '财务', news: '新闻', dividends: '分红', profile: '基本信息',
            notices: '公告', reports: '研报',
          }
          const parts = Object.entries(stats as Record<string, number>)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `${labelMap[k] || k}:${v}`)
          current[i] = { ...current[i], status: 'done', message: parts.join(', ') || '完成', stats }
        } else {
          current[i] = { ...current[i], status: 'error', message: res.message || '失败' }
        }
      } catch (e: any) {
        current[i] = { ...current[i], status: 'error', message: e.message || '失败' }
      }
      setQueue([...current])
      saveQueue(current)
    }

    processingRef.current = false
    fetchStocks(page, localQuery, missingOnly)
  }, [page, localQuery, missingOnly, fetchStocks])

  // Auto-process queue when items are added
  useEffect(() => {
    if (queue.some(q => q.status === 'pending')) {
      processQueue(queue)
    }
  }, [queue.length])

  const addToQueue = (symbol: string, name: string) => {
    if (queue.some(q => q.symbol === symbol && (q.status === 'pending' || q.status === 'downloading'))) return
    // Remove old completed/error entries for same symbol
    const filtered = queue.filter(q => q.symbol !== symbol)
    const newQueue = [...filtered, { id: `${symbol}-${Date.now()}`, symbol, name, status: 'pending' as const }]
    setQueue(newQueue)
    saveQueue(newQueue)
  }

  const clearFinished = () => {
    const newQueue = queue.filter(q => q.status === 'pending' || q.status === 'downloading')
    setQueue(newQueue)
    saveQueue(newQueue)
  }

  const removeFromQueue = (id: string) => {
    const newQueue = queue.filter(q => q.id !== id)
    setQueue(newQueue)
    saveQueue(newQueue)
  }

  // Batch download handlers
  const handleBatchStart = async () => {
    await startDataDownload()
    fetchBatchStatus()
  }

  const handleBatchStop = async () => {
    await stopDataDownload()
    fetchBatchStatus()
  }

  // Industry handlers
  const loadIndustries = async () => {
    setIndustriesLoading(true)
    try {
      const res = await getIndustries()
      setIndustries(res.items || [])
    } catch {}
    setIndustriesLoading(false)
  }

  const loadIndustryStocks = async (name: string) => {
    setSelectedIndustry(name)
    setIndustryStocksLoading(true)
    try {
      const res = await getIndustryStocks(name)
      setIndustryStocks(res.items || [])
    } catch {}
    setIndustryStocksLoading(false)
  }

  const downloadIndustryStocks = () => {
    for (const s of industryStocks) {
      addToQueue(s.code, s.name)
    }
    setShowIndustry(false)
    setSelectedIndustry(null)
    setIndustryStocks([])
  }

  // Single stock handlers
  const handleRefreshSingle = async (stock: StockDataSummary) => {
    setRefreshingSymbol(stock.symbol)
    try {
      const res = (stock.missingCount || 0) > 0
        ? await refreshMissingStockData(stock.symbol)
        : await refreshStockData(stock.symbol)
      if (res.status !== 'ok') {
        alert(res.message || '更新未完全成功，请查看后端日志')
      }
      fetchStocks(page, localQuery, missingOnly)
    } catch (e: any) {
      alert(e?.message || '更新失败，请稍后重试')
    }
    setRefreshingSymbol(null)
  }

  const handleRefreshAll = async () => {
    setRefreshingAll(true)
    try { await refreshAllData() } catch {}
    setRefreshingAll(false)
  }

  const handleRebuildLocalList = async () => {
    setRebuildingLocal(true)
    setLoading(true)
    try {
      const res = await rebuildDataStocks(page, PAGE_SIZE, localQuery, missingOnly)
      setStocks(res.items)
      setTotal(res.total)
    } catch {}
    setLoading(false)
    setRebuildingLocal(false)
  }


  const handleDelete = async (symbol: string) => {
    if (!confirm(`确定删除 ${symbol} 的本地数据？`)) return
    await deleteStockData(symbol)
    fetchStocks(page, localQuery, missingOnly)
  }

  const activeQueue = queue.filter(q => q.status === 'pending' || q.status === 'downloading')
  const batchProgress = batchStatus ? (batchStatus.total > 0 ? (batchStatus.completed / batchStatus.total) * 100 : 0) : 0

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Database className="w-7 h-7" style={{ color: 'var(--accent-primary)' }} />
        <h1 className="font-h1" style={{ color: 'var(--text-primary)' }}>数据管理</h1>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-border-subtle p-2" style={{ backgroundColor: 'var(--bg-surface)' }}>
        {[
          { key: 'stock', label: '个股数据' },
          { key: 'market', label: '市场数据' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSearchParams(tab.key === 'market' ? { tab: 'market' } : {})}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              backgroundColor: activeTab === tab.key ? 'var(--accent-primary)' : 'transparent',
              color: activeTab === tab.key ? '#fff' : 'var(--text-secondary)',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'market' ? (
        <MarketDataPanel embedded showViewer={false} />
      ) : (
        <>
      {/* Action Buttons Row */}
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => { setShowIndustry(true); loadIndustries() }}>
          <Building2 className="w-4 h-4 mr-1.5" /> 按板块下载
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              disabled={batchStatus?.status === 'running'}
            >
              <Download className="w-4 h-4 mr-1.5" /> 全量下载
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认全量下载</AlertDialogTitle>
              <AlertDialogDescription>
                将下载所有股票的全部数据类型（基本信息、日K线、财务数据、新闻公告等），耗时较长且会消耗较多网络流量。确定开始吗？
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={handleBatchStart}>确认下载</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {batchStatus?.status === 'running' && (
          <Button variant="outline" onClick={handleBatchStop}>
            <Pause className="w-4 h-4 mr-1.5" /> 暂停全量下载
          </Button>
        )}
        <Button
          variant="outline"
          onClick={handleRefreshAll}
          disabled={refreshingAll || total === 0}
        >
          <RefreshCw className={`w-4 h-4 mr-1.5 ${refreshingAll ? 'animate-spin' : ''}`} /> 更新全部
        </Button>
      </div>

      {/* Batch Download Progress */}
      {batchStatus && batchStatus.status !== 'idle' && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-border-subtle p-4"
          style={{ backgroundColor: 'var(--bg-surface)' }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {batchStatus.status === 'running' && <Loader2 className="w-3.5 h-3.5 inline animate-spin mr-1.5" />}
              {batchStatus.status === 'completed' && <CheckCircle className="w-3.5 h-3.5 inline mr-1.5" style={{ color: 'var(--up-red)' }} />}
              {batchStatus.status === 'paused' && <Pause className="w-3.5 h-3.5 inline mr-1.5" />}
              全量下载 {batchStatus.status === 'running' ? '进行中' : batchStatus.status === 'completed' ? '已完成' : '已暂停'}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {batchStatus.completed}/{batchStatus.total} {batchProgress.toFixed(1)}%
              </span>
              {batchStatus.status !== 'running' && (
                <button
                  onClick={dismissBatchStatus}
                  className="p-0.5 rounded hover:bg-bg-elevated transition-colors"
                >
                  <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                </button>
              )}
            </div>
          </div>
          <div className="h-3 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-elevated)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${batchProgress}%`, backgroundColor: 'var(--accent-primary)' }} />
          </div>
          {batchStatus.status === 'running' && batchStatus.lastSymbol && (
            <div className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
              正在处理: {batchStatus.lastSymbol}
            </div>
          )}
          {batchStatus.logs && batchStatus.logs.length > 0 && (
            <div
              ref={logBoxRef}
              className="mt-3 max-h-48 overflow-y-auto rounded-lg p-3 font-mono text-xs leading-relaxed"
              style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
            >
              {batchStatus.logs.map((entry, i) => (
                <div key={i} style={{ color: entry.includes('✓') ? 'var(--text-secondary)' : 'var(--down-green)' }}>
                  {entry}
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* Download Queue */}
      {queue.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-border-subtle overflow-hidden"
          style={{ backgroundColor: 'var(--bg-surface)' }}
        >
          <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ListOrdered className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                下载队列
                {activeQueue.length > 0 && <span className="ml-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>({activeQueue.length} 进行中)</span>}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={clearFinished}>
              清除已完成
            </Button>
          </div>
          {/* Progress bar */}
          <div className="px-4 pt-3 pb-1">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {queue.filter(q => q.status === 'done').length}/{queue.length} 已完成
              </span>
              {activeQueue.length > 0 && (
                <span className="text-xs font-mono" style={{ color: 'var(--accent-primary)' }}>
                  {queue.find(q => q.status === 'downloading')?.symbol || ''}
                </span>
              )}
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-elevated)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${queue.length > 0 ? (queue.filter(q => q.status === 'done' || q.status === 'error').length / queue.length) * 100 : 0}%`,
                  backgroundColor: 'var(--accent-primary)',
                }}
              />
            </div>
          </div>
          {/* Log entries */}
          <div className="max-h-48 overflow-y-auto px-4 pb-2">
            {queue.filter(q => q.status === 'done' || q.status === 'error').map((item) => (
              <div key={item.id} className="flex items-start gap-2 py-1 border-b border-border-subtle last:border-b-0">
                {item.status === 'done' ? (
                  <CheckCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--up-red)' }} />
                ) : (
                  <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--down-green)' }} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{item.symbol}</span>
                    <span className="text-xs" style={{ color: 'var(--text-primary)' }}>{item.name}</span>
                  </div>
                  <span className="text-xs" style={{ color: item.status === 'done' ? 'var(--text-muted)' : 'var(--down-green)' }}>
                    {item.message}
                  </span>
                </div>
                <button onClick={() => removeFromQueue(item.id)} className="p-0.5 rounded hover:bg-bg-elevated shrink-0">
                  <X className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
                </button>
              </div>
            ))}
            {/* Pending items count */}
            {queue.filter(q => q.status === 'pending').length > 0 && (
              <div className="py-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                还有 {queue.filter(q => q.status === 'pending').length} 只等待下载...
              </div>
            )}
          </div>
          {/* Currently downloading item */}
          {activeQueue.length > 0 && (
            <div className="px-4 py-2 border-t border-border-subtle space-y-1.5">
              <div className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--accent-primary)' }} />
                <span className="font-mono text-xs" style={{ color: 'var(--accent-primary)' }}>
                  {activeQueue[0].symbol}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-primary)' }}>{activeQueue[0].name}</span>
                {singleProgress?.status === 'running' && singleProgress.dataTypes && (
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {singleProgress.completedTypes?.length ?? 0}/{singleProgress.dataTypes.length}
                  </span>
                )}
                {(!singleProgress || singleProgress.status === 'idle') && (
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>下载中...</span>
                )}
              </div>
              {singleProgress?.status === 'running' && singleProgress.dataTypes && (
                <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${((singleProgress.completedTypes?.length ?? 0) / singleProgress.dataTypes.length) * 100}%`,
                      backgroundColor: 'var(--accent-primary)',
                    }}
                  />
                </div>
              )}
              {singleProgress?.status === 'running' && singleProgress.currentIndex !== undefined && singleProgress.dataTypes && (
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  正在获取: {DATA_TYPE_LABELS[singleProgress.dataTypes[singleProgress.currentIndex]] || singleProgress.dataTypes[singleProgress.currentIndex]}
                </div>
              )}
              {singleProgress?.logs && singleProgress.logs.length > 0 && (
                <div className="max-h-20 overflow-y-auto font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {singleProgress.logs.slice(-5).map((entry, i) => (
                    <div key={i}>{entry}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </motion.div>
      )}

      {/* Search & Download Section */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-border-subtle p-6"
        style={{ backgroundColor: 'var(--bg-surface)' }}
      >
        <h2 className="font-h3 mb-4" style={{ color: 'var(--text-primary)' }}>搜索并下载</h2>
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          <Input
            placeholder="输入股票代码或名称，如 600519、茅台..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {searching && (
          <div className="flex items-center gap-2 py-4 text-sm" style={{ color: 'var(--text-muted)' }}>
            <Loader2 className="w-4 h-4 animate-spin" /> 搜索中...
          </div>
        )}
        {!searching && searchResults.length > 0 && (
          <div className="border border-border-subtle rounded-lg overflow-hidden">
            {searchResults.slice(0, 10).map((r) => {
              const inQueue = queue.some(q => q.symbol === r.symbol && (q.status === 'pending' || q.status === 'downloading'))
              return (
                <div
                  key={r.symbol}
                  className="flex items-center justify-between px-4 py-2.5 border-b border-border-subtle last:border-b-0 hover:bg-bg-surface-hover transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm" style={{ color: 'var(--accent-primary)' }}>{r.symbol}</span>
                    <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{r.name}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                      {r.market}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={inQueue}
                    onClick={() => addToQueue(r.symbol, r.name)}
                  >
                    {inQueue ? (
                      <><CheckCircle className="w-3.5 h-3.5 mr-1.5" /> 已加入</>
                    ) : (
                      <><Download className="w-3.5 h-3.5 mr-1.5" /> 下载</>
                    )}
                  </Button>
                </div>
              )
            })}
          </div>
        )}
        {!searching && searchQuery.trim() && searchResults.length === 0 && (
          <div className="py-4 text-sm text-center" style={{ color: 'var(--text-muted)' }}>未找到匹配的股票</div>
        )}
      </motion.div>

      {/* Local Data List */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="rounded-xl border border-border-subtle overflow-hidden"
        style={{ backgroundColor: 'var(--bg-surface)' }}
      >
        <div className="p-4 border-b border-border-subtle flex items-center justify-between gap-4">
          <h2 className="font-h3 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
            本地数据 <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>({total} 只)</span>
          </h2>
          <div className="flex items-center gap-2">
            <Button
              variant={missingOnly ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setMissingOnly(v => !v); setPage(1) }}
              title="只显示缺失部分本地数据的股票"
            >
              <XCircle className="w-3.5 h-3.5 mr-1.5" />
              只看缺失
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRebuildLocalList}
              disabled={rebuildingLocal}
              title="重新扫描本地数据目录"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${rebuildingLocal ? 'animate-spin' : ''}`} />
              刷新列表
            </Button>
            <div className="relative max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              <Input
                placeholder="按代码/名称筛选..."
                value={localQuery}
                onChange={(e) => { setLocalQuery(e.target.value); setPage(1) }}
                className="pl-9 h-8 text-sm"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-elevated)' }}>
                <th className="text-left px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>代码</th>
                <th className="text-left px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>名称</th>
                {Object.entries(DATA_TYPE_LABELS).map(([key, label]) => (
                  <th key={key} className="text-center px-2 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</th>
                ))}
                <th className="text-center px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>缺失</th>
                <th className="text-right px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>大小</th>
                <th className="text-center px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={LOCAL_TABLE_COLS} className="text-center py-12" style={{ color: 'var(--text-muted)' }}>加载中...</td></tr>
              ) : stocks.length === 0 ? (
                <tr><td colSpan={LOCAL_TABLE_COLS} className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
                  {localQuery ? '未找到匹配数据' : missingOnly ? '没有缺失数据，当前本地数据都完整' : '暂无本地数据，在上方搜索股票并下载'}
                </td></tr>
              ) : stocks.map((stock) => (
                <tr key={stock.symbol} className="border-t border-border-subtle hover:bg-bg-surface-hover transition-colors">
                  <td className="px-4 py-2.5">
                    <button onClick={() => navigate(`/stock/${stock.symbol}`)} className="font-mono text-xs hover:underline cursor-pointer" style={{ color: 'var(--accent-primary)' }}>
                      {stock.symbol}
                    </button>
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--text-primary)' }}>{stock.name || '-'}</td>
                  {Object.keys(DATA_TYPE_LABELS).map((key) => (
                    <td key={key} className="text-center px-2 py-2.5">
                      {stock.dataTypes[key]?.exists ? (
                        <CheckCircle className="w-4 h-4 inline" style={{ color: 'var(--up-red)' }} />
                      ) : (
                        <XCircle className="w-4 h-4 inline" style={{ color: 'var(--text-muted)' }} />
                      )}
                    </td>
                  ))}
                  <td className="text-center px-4 py-2.5 text-xs" style={{ color: (stock.missingCount || 0) > 0 ? 'var(--down-green)' : 'var(--text-muted)' }} title={formatMissingDataTypes(stock.missingDataTypes)}>
                    {(stock.missingCount || 0) > 0 ? `缺 ${stock.missingCount} 项` : '完整'}
                  </td>
                  <td className="text-right px-4 py-2.5 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                    {formatBytes(stock.totalSize)}
                  </td>
                  <td className="text-center px-4 py-2.5">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => navigate(`/stock/${stock.symbol}`)} className="p-1.5 rounded hover:bg-bg-elevated transition-colors" title="查看">
                        <ArrowRight className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
                      </button>
                      <button
                        onClick={() => handleRefreshSingle(stock)}
                        disabled={refreshingSymbol === stock.symbol}
                        className="p-1.5 rounded hover:bg-bg-elevated transition-colors"
                        title={(stock.missingCount || 0) > 0 ? `补齐缺失：${formatMissingDataTypes(stock.missingDataTypes)}` : '刷新全部'}
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${refreshingSymbol === stock.symbol ? 'animate-spin' : ''}`} style={{ color: (stock.missingCount || 0) > 0 ? 'var(--down-green)' : 'var(--text-secondary)' }} />
                      </button>
                      <button onClick={() => handleDelete(stock.symbol)} className="p-1.5 rounded hover:bg-bg-elevated transition-colors" title="删除">
                        <Trash2 className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border-subtle">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>第 {page} 页，共 {Math.ceil(total / PAGE_SIZE)} 页</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
              <Button variant="outline" size="sm" disabled={page >= Math.ceil(total / PAGE_SIZE)} onClick={() => setPage(p => p + 1)}>下一页</Button>
            </div>
          </div>
        )}
      </motion.div>

      {/* Industry Download Modal */}
      <AnimatePresence>
        {showIndustry && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
            onClick={() => { setShowIndustry(false); setSelectedIndustry(null); setIndustryStocks([]) }}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="w-full max-w-2xl max-h-[80vh] rounded-xl border border-border-subtle flex flex-col overflow-hidden"
              style={{ backgroundColor: 'var(--bg-surface)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-4 border-b border-border-subtle flex items-center justify-between">
                <h2 className="font-h3" style={{ color: 'var(--text-primary)' }}>
                  {selectedIndustry ? `板块: ${selectedIndustry}` : '按板块下载'}
                </h2>
                <button onClick={() => { setShowIndustry(false); setSelectedIndustry(null); setIndustryStocks([]) }} className="p-1.5 rounded hover:bg-bg-elevated">
                  <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {!selectedIndustry ? (
                  // Industry list
                  industriesLoading ? (
                    <div className="flex items-center justify-center py-12" style={{ color: 'var(--text-muted)' }}>
                      <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载板块列表...
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {industries.map((ind) => (
                        <button
                          key={ind.code}
                          onClick={() => loadIndustryStocks(ind.name)}
                          className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-border-subtle hover:border-accent-primary transition-colors text-left"
                          style={{ backgroundColor: 'var(--bg-elevated)' }}
                        >
                          <div>
                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{ind.name}</div>
                            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{ind.count} 只</div>
                          </div>
                          <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
                        </button>
                      ))}
                    </div>
                  )
                ) : (
                  // Stock list for selected industry
                  industryStocksLoading ? (
                    <div className="flex items-center justify-center py-12" style={{ color: 'var(--text-muted)' }}>
                      <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载股票列表...
                    </div>
                  ) : (
                    <>
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{industryStocks.length} 只股票</span>
                        <Button size="sm" onClick={downloadIndustryStocks}>
                          <Download className="w-3.5 h-3.5 mr-1.5" /> 全部加入下载
                        </Button>
                      </div>
                      <div className="border border-border-subtle rounded-lg overflow-hidden max-h-96 overflow-y-auto">
                        {industryStocks.map((s) => {
                          const inQueue = queue.some(q => q.symbol === s.code && (q.status === 'pending' || q.status === 'downloading'))
                          return (
                            <div key={s.code} className="flex items-center justify-between px-4 py-2 border-b border-border-subtle last:border-b-0">
                              <div className="flex items-center gap-3">
                                <span className="font-mono text-xs" style={{ color: 'var(--accent-primary)' }}>{s.code}</span>
                                <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{s.name}</span>
                              </div>
                              <Button size="sm" variant="outline" disabled={inQueue} onClick={() => addToQueue(s.code, s.name)}>
                                {inQueue ? <CheckCircle className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
        </>
      )}
    </div>
  )
}

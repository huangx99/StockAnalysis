import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Heart, Loader2, Pencil, Search, Trash2 } from 'lucide-react'
import { deleteWatchlistItem, getStockProfile, getWatchlists, updateWatchlistItem } from '@/api/real/stockApi'
import type { StockProfile, WatchlistItem } from '@/types'
import { formatPercent, formatPrice } from '@/lib/formatters'

interface Row extends WatchlistItem {
  profile?: StockProfile | null
}

export default function Watchlist() {
  const [items, setItems] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState('')
  const [draftNote, setDraftNote] = useState('')
  const [draftTags, setDraftTags] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const lists = await getWatchlists()
      const rows = lists.flatMap(list => list.items)
      setItems(rows)
      const profiles = await Promise.allSettled(rows.map(item => getStockProfile(item.stockCode)))
      setItems(rows.map((item, index) => ({ ...item, profile: profiles[index].status === 'fulfilled' ? profiles[index].value : null })))
    } catch (err) {
      setError(err instanceof Error ? err.message : '自选股加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase()
    if (!text) return items
    return items.filter(item => [item.stockCode, item.stockName, item.profile?.name, item.profile?.industry, item.note, ...(item.tags || [])].join(' ').toLowerCase().includes(text))
  }, [items, query])

  const startEdit = (item: Row) => {
    setEditingId(item.id)
    setDraftNote(item.note || '')
    setDraftTags((item.tags || []).join('，'))
  }

  const saveEdit = async (item: Row) => {
    const tags = draftTags.split(/[，,]/).map(tag => tag.trim()).filter(Boolean)
    const updated = await updateWatchlistItem(item.id, { note: draftNote, tags })
    setItems(prev => prev.map(row => row.id === item.id ? { ...row, ...updated } : row))
    setEditingId('')
  }

  const remove = async (item: Row) => {
    await deleteWatchlistItem(item.id)
    setItems(prev => prev.filter(row => row.id !== item.id))
  }

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Heart className="w-6 h-6" style={{ color: 'var(--accent-primary)' }} />
            <h1 className="font-h1" style={{ color: 'var(--text-primary)' }}>我的自选股</h1>
          </div>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>按账号保存股票关注、备注和标签，公共行情数据实时复用。</p>
        </div>
        <label className="flex items-center gap-2 h-10 rounded-lg border border-border-subtle px-3 min-w-[260px]" style={{ backgroundColor: 'var(--bg-surface)' }}>
          <Search className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索代码、名称、行业、标签" className="bg-transparent outline-none text-sm flex-1" style={{ color: 'var(--text-primary)' }} />
        </label>
      </div>

      {error && <div className="rounded-xl border p-4 mb-4" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>{error}</div>}
      {loading ? (
        <div className="h-48 rounded-xl border border-border-subtle flex items-center justify-center gap-2" style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>
          <Loader2 className="w-4 h-4 animate-spin" />加载自选股...
        </div>
      ) : filtered.length === 0 ? (
        <div className="h-64 rounded-xl border border-border-subtle flex flex-col items-center justify-center" style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>
          <Heart className="w-10 h-10 mb-3" style={{ color: 'var(--text-muted)' }} />
          <div className="font-medium" style={{ color: 'var(--text-primary)' }}>暂无自选股</div>
          <p className="text-sm mt-1">进入股票详情页点击“加入自选”。</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map(item => {
            const profile = item.profile
            const change = profile?.changePercent ?? 0
            const color = change >= 0 ? 'var(--up-red)' : 'var(--down-green)'
            return (
              <div key={item.id} className="rounded-xl border border-border-subtle p-4" style={{ backgroundColor: 'var(--bg-surface)' }}>
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                  <Link to={`/stock/${item.stockCode}`} className="min-w-[220px] hover:underline">
                    <div className="font-h3" style={{ color: 'var(--text-primary)' }}>{profile?.name || item.stockName || item.stockCode}</div>
                    <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{item.stockCode}.{profile?.market || item.market || '--'} · {profile?.industry || '未知行业'}</div>
                  </Link>
                  <div className="flex flex-wrap items-center gap-4 text-sm flex-1">
                    <span style={{ color: 'var(--text-secondary)' }}>现价 <b style={{ color: 'var(--text-primary)' }}>{profile ? formatPrice(profile.currentPrice) : '--'}</b></span>
                    <span style={{ color }}>涨跌幅 {profile ? formatPercent(change) : '--'}</span>
                    <span style={{ color: 'var(--text-muted)' }}>更新时间 {profile?.updateTime || item.updatedAt}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => startEdit(item)} className="p-2 rounded-lg hover:bg-bg-surface-hover" title="编辑"><Pencil className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} /></button>
                    <button onClick={() => void remove(item)} className="p-2 rounded-lg hover:bg-bg-surface-hover" title="移除"><Trash2 className="w-4 h-4" style={{ color: 'var(--danger)' }} /></button>
                  </div>
                </div>
                {editingId === item.id ? (
                  <div className="mt-3 grid gap-2">
                    <textarea value={draftNote} onChange={event => setDraftNote(event.target.value)} placeholder="观察备注" className="min-h-20 rounded-lg border border-border-subtle bg-transparent p-3 text-sm outline-none" style={{ color: 'var(--text-primary)' }} />
                    <input value={draftTags} onChange={event => setDraftTags(event.target.value)} placeholder="标签，用逗号分隔" className="h-9 rounded-lg border border-border-subtle bg-transparent px-3 text-sm outline-none" style={{ color: 'var(--text-primary)' }} />
                    <div className="flex gap-2">
                      <button onClick={() => void saveEdit(item)} className="px-3 py-1.5 rounded-lg text-sm text-white" style={{ backgroundColor: 'var(--accent-primary)' }}>保存</button>
                      <button onClick={() => setEditingId('')} className="px-3 py-1.5 rounded-lg text-sm border border-border-subtle" style={{ color: 'var(--text-secondary)' }}>取消</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2 text-sm">
                    {item.note && <span className="px-2 py-1 rounded" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>{item.note}</span>}
                    {(item.tags || []).map(tag => <span key={tag} className="px-2 py-1 rounded" style={{ backgroundColor: 'var(--accent-primary)1F', color: 'var(--accent-primary)' }}>{tag}</span>)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

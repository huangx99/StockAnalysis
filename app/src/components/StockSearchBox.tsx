import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { searchStocks } from '@/api/real/stockApi'
import type { StockSearchResult } from '@/types'

interface StockSearchBoxProps {
  size?: 'lg' | 'md'
  onFocusChange?: (focused: boolean) => void
}

export default function StockSearchBox({ size = 'lg', onFocusChange }: StockSearchBoxProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<StockSearchResult[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setShowDropdown(false)
      return
    }
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await searchStocks(query)
        setResults(res)
        setShowDropdown(true)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  const handleSelect = (symbol: string) => {
    setShowDropdown(false)
    setQuery('')
    navigate(`/stock/${symbol}`)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && results.length > 0) {
      handleSelect(results[0].symbol)
    }
  }

  const isLg = size === 'lg'

  return (
    <div className={`relative ${isLg ? 'max-w-[560px] w-full' : 'max-w-[320px] w-full'}`}>
      <div
        className={`flex items-center gap-2 border rounded-xl transition-all ${isLg ? 'h-14 px-4' : 'h-10 px-3'}`}
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: showDropdown ? 'var(--accent-primary)' : 'var(--border-subtle)',
          boxShadow: showDropdown ? '0 0 0 4px var(--accent-glow)' : 'none',
        }}
      >
        <Search className={`shrink-0 ${isLg ? 'w-5 h-5' : 'w-4 h-4'}`} style={{ color: 'var(--text-muted)' }} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { onFocusChange?.(true) }}
          onBlur={() => { onFocusChange?.(false) }}
          onKeyDown={handleKeyDown}
          placeholder="请输入股票代码 / 名称 / 拼音..."
          className="flex-1 bg-transparent outline-none text-sm"
          style={{ color: 'var(--text-primary)' }}
        />
        {query && (
          <button onClick={() => { setQuery(''); inputRef.current?.focus(); }}>
            <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          </button>
        )}
        {isLg && (
          <button
            onClick={() => results.length > 0 && handleSelect(results[0].symbol)}
            className="shrink-0 h-[44px] px-4 rounded-[10px] text-sm font-medium text-white transition-all hover:scale-[1.02]"
            style={{ backgroundColor: 'var(--accent-primary)' }}
          >
            开始分析
          </button>
        )}
      </div>

      <AnimatePresence>
        {showDropdown && (results.length > 0 || loading) && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute top-full left-0 right-0 mt-2 rounded-xl border border-border-subtle overflow-hidden shadow-xl z-50"
            style={{ backgroundColor: 'var(--bg-elevated)' }}
          >
            {loading ? (
              <div className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>搜索中...</div>
            ) : (
              results.map((r) => (
                <button
                  key={r.symbol}
                  onMouseDown={() => handleSelect(r.symbol)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-bg-surface-hover transition-colors"
                >
                  <span className="font-data-sm font-medium" style={{ color: 'var(--text-primary)' }}>{r.symbol}</span>
                  <span className="font-body text-sm" style={{ color: 'var(--text-secondary)' }}>{r.name}</span>
                  <span
                    className="ml-auto text-[11px] font-medium px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: 'rgba(59,130,246,0.15)', color: 'var(--accent-primary)' }}
                  >
                    {r.market}
                  </span>
                </button>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { LogOut, Search, Sun, Moon, User, X, Menu } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { searchStocks } from '@/api/real/stockApi'
import { useAuth } from '@/contexts/AuthContext'
import type { StockSearchResult } from '@/types'

interface NavbarProps {
  showMenuButton?: boolean
  onMenuClick?: () => void
}

export default function Navbar({ showMenuButton, onMenuClick }: NavbarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<StockSearchResult[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const { user, logout } = useAuth()

  useEffect(() => {
    const html = document.documentElement
    html.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }
    const timer = setTimeout(async () => {
      try {
        const res = await searchStocks(query)
        setResults(res)
        setShowDropdown(true)
      } catch {
        setResults([])
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    setShowDropdown(false)
    setQuery('')
    setResults([])
    setMobileSearchOpen(false)
  }, [location.pathname])

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  const handleSelect = (symbol: string) => {
    setShowDropdown(false)
    setQuery('')
    setMobileSearchOpen(false)
    navigate(`/stock/${symbol}`)
  }

  const isHome = location.pathname === '/'

  return (
    <>
      <nav
        className="sticky top-0 z-50 h-[56px] flex items-center px-4 border-b border-border-subtle"
        style={{ backgroundColor: 'var(--bg-surface)' }}
      >
        {/* Left: Menu + Logo */}
        <div className="flex items-center gap-2 shrink-0">
          {showMenuButton && (
            <button
              onClick={onMenuClick}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-bg-surface-hover transition-colors"
              aria-label="toggle sidebar"
            >
              <Menu className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
            </button>
          )}
          <Link to="/" className="flex items-center gap-2">
            <img src="/logo-mark.svg" alt="logo" className="w-5 h-5" />
            <span className="font-h3 text-text-primary hidden sm:inline">A-Stock AI</span>
          </Link>
        </div>

        {/* Center: Search (desktop) */}
        {!isHome && (
          <div className="relative mx-4 max-w-[320px] w-full hidden md:block">
            <div className="flex items-center h-10 rounded-lg border border-border-subtle px-3 gap-2"
              style={{ backgroundColor: 'var(--bg-base)' }}
            >
              <Search className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="输入股票代码 / 名称 / 拼音..."
                className="w-full bg-transparent text-sm outline-none"
                style={{ color: 'var(--text-primary)' }}
              />
              {query && (
                <button onClick={() => { setQuery(''); setResults([]); }}>
                  <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                </button>
              )}
            </div>
            <AnimatePresence>
              {showDropdown && results.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-border-subtle overflow-hidden shadow-lg"
                  style={{ backgroundColor: 'var(--bg-elevated)' }}
                >
                  {results.map((r) => (
                    <button
                      key={r.symbol}
                      onClick={() => handleSelect(r.symbol)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-bg-surface-hover transition-colors"
                    >
                      <span className="font-data-sm" style={{ color: 'var(--text-primary)' }}>{r.symbol}</span>
                      <span className="font-body text-sm" style={{ color: 'var(--text-secondary)' }}>{r.name}</span>
                      <span
                        className="ml-auto text-[11px] font-medium px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: 'var(--accent-primary)26', color: 'var(--accent-primary)' }}
                      >
                        {r.market}
                      </span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Right */}
        <div className="ml-auto flex items-center gap-2">
          {/* Mobile search icon */}
          {!isHome && (
            <button
              onClick={() => setMobileSearchOpen(true)}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-bg-surface-hover transition-colors md:hidden"
              aria-label="search"
            >
              <Search className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
            </button>
          )}

          <button
            onClick={toggleTheme}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-bg-surface-hover transition-colors"
            aria-label="toggle theme"
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
            ) : (
              <Moon className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
            )}
          </button>

          <div className="hidden sm:flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-success" />
            <span className="font-data-sm" style={{ color: 'var(--text-secondary)' }}>数据正常</span>
          </div>

          <Link to="/profile" className="hidden md:flex items-center gap-2 pl-2 rounded-lg hover:bg-bg-surface-hover transition-colors" title="个人中心">
            <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--bg-surface-hover)' }}>
              <User className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            </div>
            <div className="leading-tight hidden lg:block pr-2">
              <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{user?.username || '未登录'}</div>
              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{user?.role === 'admin' ? '管理员' : '普通用户'}</div>
            </div>
          </Link>
          <button
            onClick={logout}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-bg-surface-hover transition-colors"
            aria-label="logout"
            title="退出登录"
          >
            <LogOut className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>
      </nav>

      {/* Mobile search overlay */}
      <AnimatePresence>
        {mobileSearchOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex flex-col"
            style={{ backgroundColor: 'var(--bg-base)' }}
          >
            <div className="flex items-center h-[56px] px-4 gap-3 border-b border-border-subtle"
              style={{ backgroundColor: 'var(--bg-surface)' }}
            >
              <button onClick={() => setMobileSearchOpen(false)}>
                <X className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
              </button>
              <div className="flex-1 flex items-center h-10 rounded-lg border border-border-subtle px-3 gap-2"
                style={{ backgroundColor: 'var(--bg-base)' }}
              >
                <Search className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="输入股票代码 / 名称..."
                  className="w-full bg-transparent text-sm outline-none"
                  style={{ color: 'var(--text-primary)' }}
                  autoFocus
                />
                {query && (
                  <button onClick={() => { setQuery(''); setResults([]); }}>
                    <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {results.map((r) => (
                <button
                  key={r.symbol}
                  onClick={() => handleSelect(r.symbol)}
                  className="w-full flex items-center gap-3 px-6 py-3.5 text-left hover:bg-bg-surface-hover transition-colors border-b border-border-subtle"
                >
                  <span className="font-data-md" style={{ color: 'var(--text-primary)' }}>{r.symbol}</span>
                  <span className="font-body" style={{ color: 'var(--text-secondary)' }}>{r.name}</span>
                  <span
                    className="ml-auto text-[11px] font-medium px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: 'var(--accent-primary)26', color: 'var(--accent-primary)' }}
                  >
                    {r.market}
                  </span>
                </button>
              ))}
              {query && results.length === 0 && (
                <div className="px-6 py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                  未找到匹配的股票
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

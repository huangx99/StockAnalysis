import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { TrendingUp, BarChart3, Sparkles } from 'lucide-react'
import StockSearchBox from '@/components/StockSearchBox'

const EXAMPLE_CHIPS = [
  { symbol: '600519', label: '600519 贵州茅台' },
  { symbol: '000001', label: '000001 平安银行' },
  { symbol: '300750', label: '300750 宁德时代' },
]

const FEATURES = [
  {
    icon: TrendingUp,
    title: '行情分析',
    desc: '实时K线、均线、成交量、波动率分析',
  },
  {
    icon: BarChart3,
    title: '财务分析',
    desc: '利润表、资产负债表、现金流深度拆解',
  },
  {
    icon: Sparkles,
    title: 'AI 投研',
    desc: '智能评分、亮点提取、风险识别、报告生成',
  },
]

interface HistoryItem {
  symbol: string
  name: string
  price: number
  changePercent: number
  timeAgo: string
}

const RECENT_HISTORY: HistoryItem[] = [
  { symbol: '600519', name: '贵州茅台', price: 1688.88, changePercent: 0.74, timeAgo: '2小时前' },
  { symbol: '000001', name: '平安银行', price: 12.56, changePercent: -1.8, timeAgo: '5小时前' },
  { symbol: '300750', name: '宁德时代', price: 198.5, changePercent: 2.69, timeAgo: '1天前' },
]

export default function Home() {
  const navigate = useNavigate()
  const [searchFocused, setSearchFocused] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>([])

  useEffect(() => {
    const saved = localStorage.getItem('recent-stocks')
    if (saved) {
      try {
        setHistory(JSON.parse(saved))
      } catch {
        setHistory(RECENT_HISTORY)
      }
    } else {
      // For demo, show mock history after a brief delay
      const timer = setTimeout(() => setHistory(RECENT_HISTORY), 1200)
      return () => clearTimeout(timer)
    }
  }, [])

  const clearHistory = () => {
    setHistory([])
    localStorage.removeItem('recent-stocks')
  }

  const handleChipClick = (symbol: string) => {
    navigate(`/stock/${symbol}`)
  }

  return (
    <div className="relative min-h-[100dvh] flex flex-col">
      {/* Hero background */}
      <div
        className="absolute inset-0 bg-cover bg-center pointer-events-none transition-opacity duration-300"
        style={{
          backgroundImage: 'url(/hero-abstract-bg.png)',
          opacity: searchFocused ? 0.15 : 0.08,
        }}
      />

      {/* Hero Search Portal */}
      <section className="relative flex-1 flex flex-col items-center justify-center px-4 py-10">
        {/* Brand mark */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
          className="mb-6"
        >
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #3B82F6, #6366F1)',
              boxShadow: '0 0 40px rgba(59,130,246,0.2)',
              animation: 'logoPulse 3s ease-in-out infinite',
            }}
          >
            <span className="text-white font-bold text-lg">AI</span>
          </div>
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="font-display text-center"
          style={{ color: 'var(--text-primary)' }}
        >
          A股智能信息提取分析系统
        </motion.h1>

        {/* Subheadline */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.35 }}
          className="font-body text-center mt-4"
          style={{ color: 'var(--text-secondary)' }}
        >
          输入股票代码，一键生成单股深度分析报告
        </motion.p>

        {/* Search box */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="mt-8 w-full flex justify-center"
        >
          <StockSearchBox size="lg" onFocusChange={setSearchFocused} />
        </motion.div>

        {/* Example chips */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.7 }}
          className="mt-5 flex flex-wrap items-center justify-center gap-2"
        >
          <span className="font-body text-sm" style={{ color: 'var(--text-muted)' }}>示例：</span>
          {EXAMPLE_CHIPS.map((chip, i) => (
            <motion.button
              key={chip.symbol}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.7 + i * 0.08 }}
              onClick={() => handleChipClick(chip.symbol)}
              className="px-3 py-1.5 rounded-lg border text-sm font-body transition-all hover:scale-[1.02] cursor-pointer"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-subtle)',
                color: 'var(--text-secondary)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--accent-primary)'
                e.currentTarget.style.color = 'var(--accent-primary)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-subtle)'
                e.currentTarget.style.color = 'var(--text-secondary)'
              }}
            >
              {chip.label}
            </motion.button>
          ))}
        </motion.div>

        {/* Keyboard hint */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.9 }}
          className="mt-3 font-label"
          style={{ color: 'var(--text-muted)' }}
        >
          按 Enter 快速搜索
        </motion.p>

        {/* Recent Analysis History */}
        {history.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="mt-10 w-full max-w-[720px]"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-h3" style={{ color: 'var(--text-primary)' }}>最近分析</h3>
              <button
                onClick={clearHistory}
                className="font-body text-xs hover:underline"
                style={{ color: 'var(--text-muted)' }}
              >
                清除历史
              </button>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
              {history.map((item) => (
                <button
                  key={item.symbol}
                  onClick={() => navigate(`/stock/${item.symbol}`)}
                  className="shrink-0 w-[200px] h-[80px] rounded-[10px] border p-4 text-left transition-all hover:scale-[1.03] cursor-pointer"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: 'var(--border-subtle)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--accent-primary)'
                    e.currentTarget.style.boxShadow = '0 0 20px var(--accent-glow)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-subtle)'
                    e.currentTarget.style.boxShadow = 'none'
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-h3 text-sm" style={{ color: 'var(--text-primary)' }}>{item.name}</span>
                    <span className="font-data-sm" style={{ color: 'var(--text-secondary)' }}>{item.symbol}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span
                      className="font-data-md"
                      style={{ color: item.changePercent >= 0 ? 'var(--up-red)' : 'var(--down-green)' }}
                    >
                      {item.price.toFixed(2)}
                    </span>
                    <span className="font-label" style={{ color: 'var(--text-muted)' }}>{item.timeAgo}</span>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {/* Feature Preview Grid */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.8 }}
          className="mt-12 w-full max-w-[960px] pb-16"
        >
          <h2 className="font-h2 text-center" style={{ color: 'var(--text-primary)' }}>
            核心功能
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-8">
            {FEATURES.map((f, i) => {
              const Icon = f.icon
              return (
                <motion.div
                  key={f.title}
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.9 + i * 0.1 }}
                  className="rounded-xl border p-6 transition-all"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: 'var(--border-subtle)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--accent-primary)'
                    e.currentTarget.style.boxShadow = '0 0 20px var(--accent-glow)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-subtle)'
                    e.currentTarget.style.boxShadow = 'none'
                  }}
                >
                  <div className="w-8 h-8 flex items-center justify-center mb-4 transition-transform hover:scale-110">
                    <Icon className="w-8 h-8" style={{ color: 'var(--accent-primary)' }} />
                  </div>
                  <h3 className="font-h3 text-base mb-2" style={{ color: 'var(--text-primary)' }}>
                    {f.title}
                  </h3>
                  <p className="font-body text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {f.desc}
                  </p>
                </motion.div>
              )
            })}
          </div>
        </motion.div>
      </section>

      {/* System Status Bar */}
      <motion.div
        initial={{ opacity: 0, y: 48 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.9 }}
        className="relative h-[48px] flex items-center px-6 border-t border-border-subtle"
        style={{ backgroundColor: 'var(--bg-surface)' }}
      >
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--success)' }} />
            <span className="font-data-sm" style={{ color: 'var(--text-secondary)' }}>数据引擎</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--success)' }} />
            <span className="font-data-sm" style={{ color: 'var(--text-secondary)' }}>AI 服务</span>
          </div>
          <span className="font-data-sm hidden sm:inline" style={{ color: 'var(--text-muted)' }}>
            数据更新：2026-05-03 15:00
          </span>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <span className="font-data-sm" style={{ color: 'var(--text-muted)' }}>v1.0.0</span>
          <a
            href="#"
            className="font-data-sm hover:underline"
            style={{ color: 'var(--accent-primary)' }}
          >
            使用文档
          </a>
        </div>
      </motion.div>

      {/* Logo pulse keyframes */}
      <style>{`
        @keyframes logoPulse {
          0%, 100% { box-shadow: 0 0 30px rgba(59,130,246,0.2); }
          50% { box-shadow: 0 0 50px rgba(59,130,246,0.35); }
        }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  )
}

import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronLeft, BarChart3, Newspaper, FileText, Settings, Heart, Database, Filter, Network, SearchCheck, Users, PieChart } from 'lucide-react'
import { motion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

interface NavItem {
  icon: LucideIcon
  label: string
  to: string
  active?: boolean
  disabled?: boolean
  badge?: string
  adminOnly?: boolean
}

const navItems: NavItem[] = [
  { icon: BarChart3, label: '单股分析', to: '/', active: false },
  { icon: Filter, label: '股票筛选', to: '/screener', active: false },
  { icon: Network, label: '行业对比', to: '/industry', active: false },
  { icon: PieChart, label: '板块资金', to: '/sector', active: false },
  { icon: SearchCheck, label: '回测验证', to: '/backtest', active: false },
  { icon: Heart, label: '自选股', to: '/watchlist', active: false },
  { icon: BarChart3, label: '财务分析', to: '#', disabled: true },
  { icon: Newspaper, label: '新闻监控', to: '/news', active: false },
  { icon: FileText, label: 'AI 研究报告', to: '#', disabled: true },
  { icon: Database, label: '数据管理', to: '/data', active: false, adminOnly: true },
  { icon: BarChart3, label: '市场总览', to: '/market', active: false, adminOnly: true },
  { icon: Users, label: '用户管理', to: '/users', active: false, adminOnly: true },
  { icon: Settings, label: '系统设置', to: '/settings', active: false, adminOnly: true },
]

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const location = useLocation()
  const { isAdmin } = useAuth()
  const visibleNavItems = navItems.filter(item => !item.adminOnly || isAdmin)

  return (
    <motion.aside
      animate={{ width: collapsed ? 64 : 240 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] }}
      className="shrink-0 border-r border-border-subtle flex flex-col overflow-hidden"
      style={{ backgroundColor: 'var(--bg-surface)' }}
    >
      <nav className="flex-1 py-3">
        {visibleNavItems.map((item) => {
          const isActive = !item.disabled && (item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to.replace('/:symbol', '')))
          const Icon = item.icon
          return (
            <Link
              key={item.label}
              to={item.disabled ? '#' : item.to}
              onClick={(e) => item.disabled && e.preventDefault()}
              className={`relative flex items-center gap-3 px-4 py-2.5 mx-2 rounded-md transition-colors select-none ${
                isActive
                  ? 'bg-bg-surface-hover'
                  : 'hover:bg-bg-surface-hover'
              } ${item.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {isActive && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r"
                  style={{ backgroundColor: 'var(--accent-primary)' }}
                />
              )}
              <Icon className="w-5 h-5 shrink-0" style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }} />
              {!collapsed && (
                <span className="text-sm font-medium truncate" style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                  {item.label}
                </span>
              )}
              {!collapsed && item.badge && (
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                  {item.badge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center justify-center h-10 border-t border-border-subtle hover:bg-bg-surface-hover transition-colors"
      >
        <motion.div animate={{ rotate: collapsed ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronLeft className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
        </motion.div>
      </button>
    </motion.aside>
  )
}

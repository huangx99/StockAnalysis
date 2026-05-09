import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, Bell } from 'lucide-react'
import NewsSearch from './NewsSearch'
import NewsMonitor from './NewsMonitor'

const tabs = [
  { id: 'search', label: '实时搜索', icon: Search },
  { id: 'monitor', label: '新闻监听', icon: Bell },
]

export default function NewsHub() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab = searchParams.get('tab') === 'monitor' ? 'monitor' : 'search'
  const [activeTab, setActiveTab] = useState<'search' | 'monitor'>(initialTab)

  useEffect(() => {
    setSearchParams({ tab: activeTab }, { replace: true })
  }, [activeTab, setSearchParams])

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">
      {/* Tab header */}
      <div className="flex items-center gap-1 rounded-lg p-1" style={{ backgroundColor: 'var(--bg-elevated)' }}>
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as 'search' | 'monitor')}
              className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all flex-1 justify-center"
              style={{
                backgroundColor: isActive ? 'var(--bg-surface)' : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'search' ? <NewsSearch /> : <NewsMonitor />}
    </div>
  )
}

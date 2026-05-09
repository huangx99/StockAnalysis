import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Loader2, Search, X, ExternalLink, Download, Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import ConditionEditor from '@/components/ConditionEditor'
import { searchNewsFiltered, getMonitorRules, generateMonitorRule } from '@/api/real/stockApi'
import type { NewsSentimentItem, ConditionNode, MonitorRule } from '@/types'

const sentimentBadge: Record<string, { label: string; color: string; bg: string }> = {
  positive: { label: '利好', color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
  neutral: { label: '中性', color: '#eab308', bg: 'rgba(234,179,8,0.15)' },
  negative: { label: '利空', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
}

function fmtTime(t: string) {
  if (!t) return ''
  try {
    const d = new Date(t.replace(' ', 'T'))
    if (isNaN(d.getTime())) return t
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
    return t.slice(5, 16)
  } catch {
    return t
  }
}

export default function NewsSearch() {
  const [searchInput, setSearchInput] = useState('')
  const [searchResults, setSearchResults] = useState<NewsSentimentItem[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showFilter, setShowFilter] = useState(false)
  const [conditionTree, setConditionTree] = useState<ConditionNode | null>(null)
  const [totalRaw, setTotalRaw] = useState(0)

  // Import from monitor rule
  const [monitorRules, setMonitorRules] = useState<MonitorRule[]>([])
  const [showImportRule, setShowImportRule] = useState(false)
  const [loadingRules, setLoadingRules] = useState(false)

  // AI generate
  const [aiInput, setAiInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')

  const handleSearch = async () => {
    const q = searchInput.trim()
    if (!q) return
    setSearching(true)
    setSearchQuery(q)
    try {
      const hasFilter = conditionTree && conditionTree.conditions && conditionTree.conditions.length > 0
      const result = await searchNewsFiltered(q, hasFilter ? conditionTree : null, 30)
      setTotalRaw(result.total)
      setSearchResults(result.items || [])
    } catch (e) {
      console.error('Search failed:', e)
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  const clearSearch = () => {
    setSearchInput('')
    setSearchQuery('')
    setSearchResults(null)
    setTotalRaw(0)
  }

  const loadMonitorRules = async () => {
    setLoadingRules(true)
    try {
      const rules = await getMonitorRules()
      setMonitorRules(rules)
      setShowImportRule(true)
    } catch (e) {
      console.error('Failed to load rules:', e)
    } finally {
      setLoadingRules(false)
    }
  }

  const importFromRule = (rule: MonitorRule) => {
    setSearchInput((rule.searchKeywords || rule.keywords || []).join(' '))
    if (rule.conditionTree) {
      setConditionTree(rule.conditionTree as ConditionNode)
      setShowFilter(true)
    }
    setShowImportRule(false)
  }

  const handleAiGenerate = async () => {
    const desc = aiInput.trim()
    if (!desc) return
    setAiLoading(true)
    setAiError('')
    try {
      const result = await generateMonitorRule(desc)
      if (result.ok && result.conditionTree) {
        if (result.searchKeywords && result.searchKeywords.length > 0 && !searchInput.trim()) {
          setSearchInput(result.searchKeywords.join(' '))
        }
        setConditionTree(result.conditionTree)
        setShowFilter(true)
        setAiInput('')
      } else {
        setAiError(result.error || 'AI 未能生成有效条件')
      }
    } catch (e: any) {
      setAiError(e?.message || 'AI 生成失败，请检查 AI 配置')
    } finally {
      setAiLoading(false)
    }
  }

  const activeFilterCount = conditionTree?.conditions?.length || 0

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="搜索新闻关键词..."
            className="w-full pl-9 pr-3 py-2.5 rounded-lg text-sm border outline-none focus:ring-1"
            style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' } as React.CSSProperties}
          />
        </div>
        <Button onClick={handleSearch} disabled={searching || !searchInput.trim()} size="sm">
          {searching ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Search className="w-4 h-4 mr-1.5" />}
          搜索
        </Button>
        {searchQuery && (
          <Button onClick={clearSearch} variant="outline" size="sm">
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* AI Generate */}
      <div className="rounded-lg border p-3" style={{ borderColor: 'rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.03)' }}>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#a855f7' }} />
            <input value={aiInput} onChange={(e) => setAiInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !aiLoading) { e.preventDefault(); handleAiGenerate() } }}
              placeholder="用自然语言描述过滤条件，如：利好半导体、重要度大于70、最近24小时政策"
              className="w-full pl-9 pr-3 py-2 rounded-lg text-sm border outline-none"
              style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }} />
          </div>
          <Button onClick={handleAiGenerate} disabled={aiLoading || !aiInput.trim()} size="sm"
            className="shrink-0" style={{ backgroundColor: '#a855f7', color: '#fff' }}>
            {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          </Button>
        </div>
        {aiError && <p className="text-[11px] mt-1.5" style={{ color: '#ef4444' }}>{aiError}</p>}
      </div>

      {/* Filter toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          onClick={() => setShowFilter(!showFilter)}
          variant={showFilter ? 'default' : 'outline'}
          size="sm"
          className="text-xs"
        >
          <Sparkles className="w-3.5 h-3.5 mr-1" />
          条件过滤
          {activeFilterCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded text-[10px]"
              style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: '#fff' }}>
              {activeFilterCount}
            </span>
          )}
        </Button>
        <Button onClick={loadMonitorRules} variant="outline" size="sm" className="text-xs"
          disabled={loadingRules}>
          {loadingRules ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Download className="w-3.5 h-3.5 mr-1" />}
          从监听规则导入
        </Button>
        {activeFilterCount > 0 && (
          <button onClick={() => setConditionTree(null)} className="text-xs underline" style={{ color: 'var(--text-muted)' }}>
            清除过滤条件
          </button>
        )}
      </div>

      {/* Condition editor */}
      {showFilter && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="rounded-lg border p-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              过滤条件 <span style={{ color: 'var(--text-muted)' }}>(搜索结果将按以下条件过滤)</span>
            </span>
          </div>
          <ConditionEditor value={conditionTree} onChange={setConditionTree} />
        </motion.div>
      )}

      {/* Results */}
      {searchQuery && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              搜索: {searchQuery}
            </span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {searchResults?.length || 0} 条结果
              {activeFilterCount > 0 && totalRaw > (searchResults?.length || 0) &&
                ` (过滤前 ${totalRaw} 条)`}
            </span>
          </div>

          {searchResults && searchResults.length > 0 && (
            <div className="space-y-2">
              {searchResults.map((item) => (
                <SearchResultCard key={item.id} item={item} />
              ))}
            </div>
          )}

          {searchResults && searchResults.length === 0 && (
            <div className="text-center py-8">
              <Search className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {activeFilterCount > 0 ? '没有符合过滤条件的结果，试试调整条件或关键词' : '无搜索结果'}
              </p>
            </div>
          )}
        </div>
      )}

      {!searchQuery && (
        <div className="text-center py-12">
          <Search className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>输入关键词搜索全网新闻</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            支持 11 个搜索源，可添加条件过滤精确筛选
          </p>
        </div>
      )}

      {/* Import from monitor rule modal */}
      {showImportRule && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => setShowImportRule(false)}
        >
          <motion.div
            initial={{ scale: 0.95, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            className="w-full max-w-md rounded-xl border shadow-xl overflow-hidden"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
              <h3 className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>
                从监听规则导入
              </h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                选择一条监听规则，将其关键词和条件导入到搜索
              </p>
            </div>
            <div className="p-4 max-h-[60vh] overflow-y-auto space-y-2">
              {monitorRules.length === 0 && (
                <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>
                  暂无监听规则
                </p>
              )}
              {monitorRules.map((rule) => {
                const keywords = rule.searchKeywords || rule.keywords || []
                return (
                  <button
                    key={rule.id}
                    onClick={() => importFromRule(rule)}
                    className="w-full text-left rounded-lg border p-3 transition-colors hover:bg-bg-surface-hover"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                      {rule.name}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {keywords.map((kw) => (
                        <span key={kw} className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                          {kw}
                        </span>
                      ))}
                    </div>
                    {rule.conditionTree && rule.conditionTree.conditions && rule.conditionTree.conditions.length > 0 && (
                      <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                        含 {rule.conditionTree.conditions.length} 个过滤条件
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
            <div className="p-4 border-t flex justify-end" style={{ borderColor: 'var(--border-subtle)' }}>
              <Button onClick={() => setShowImportRule(false)} variant="outline" size="sm">关闭</Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </div>
  )
}


function isValidUrl(url: string | undefined): boolean {
  return !!url && (url.startsWith('http://') || url.startsWith('https://'))
}

function SearchResultCard({ item }: { item: NewsSentimentItem }) {
  const badge = sentimentBadge[item.sentiment] || sentimentBadge.neutral
  const validUrl = isValidUrl(item.url)

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border transition-colors hover:bg-bg-surface-hover"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 mt-0.5"
        style={{ backgroundColor: badge.bg, color: badge.color }}>
        {badge.label}
      </span>
      <div className="flex-1 min-w-0">
        {validUrl ? (
          <a href={item.url} target="_blank" rel="noopener noreferrer"
            className="text-sm font-medium hover:underline" style={{ color: 'var(--text-primary)' }}>
            {item.title}
          </a>
        ) : (
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{item.title}</span>
        )}
        {item.content && item.content !== item.title && (
          <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
            {item.content}
          </p>
        )}
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{item.source}</span>
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{fmtTime(item.publishTime)}</span>
          {item.sentimentScore !== undefined && (
            <span className="text-[10px] px-1 py-0.5 rounded"
              style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
              情绪: {item.sentimentScore}
            </span>
          )}
          {item.importance > 0 && (
            <span className="text-[10px] px-1 py-0.5 rounded"
              style={{ backgroundColor: 'var(--bg-elevated)', color: item.importance >= 80 ? '#ef4444' : 'var(--text-muted)' }}>
              重要度: {item.importance}
            </span>
          )}
          {item.topics && item.topics.length > 0 && item.topics.slice(0, 3).map((t) => (
            <span key={t} className="text-[10px] px-1 py-0.5 rounded"
              style={{ backgroundColor: 'rgba(59,130,246,0.1)', color: '#3b82f6' }}>
              {t}
            </span>
          ))}
        </div>
      </div>
      {validUrl ? (
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="shrink-0 mt-0.5">
          <ExternalLink className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
        </a>
      ) : (
        <span className="text-[10px] px-1 py-0.5 rounded shrink-0" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>无法跳转</span>
      )}
    </div>
  )
}

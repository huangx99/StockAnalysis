import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Loader2, Plus, Pencil, Trash2, Play, X, Mail, MailX,
  Bell, ChevronDown, ChevronRight, ChevronUp, ExternalLink, ToggleLeft, ToggleRight, Sparkles,
  Share2, Import,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import ConditionEditor from '@/components/ConditionEditor'
import {
  getMonitorRules, createMonitorRule, updateMonitorRule, deleteMonitorRule,
  getMonitorHits, testMonitorRule, getMonitorStats, generateMonitorRule,
} from '@/api/real/stockApi'
import type { MonitorRule, MonitorHit, MonitorStats, ConditionNode } from '@/types'

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

export default function NewsMonitor() {
  const navigate = useNavigate()
  const [rules, setRules] = useState<MonitorRule[]>([])
  const [hits, setHits] = useState<MonitorHit[]>([])
  const [stats, setStats] = useState<MonitorStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingRule, setEditingRule] = useState<Partial<MonitorRule> | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [filterRule, setFilterRule] = useState<string>('')
  const [expandedHit, setExpandedHit] = useState<string | null>(null)
  const [showHits, setShowHits] = useState(false)

  // Import state
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState('')

  const encodeRule = (rule: MonitorRule) => {
    const exportData = {
      name: rule.name,
      searchKeywords: rule.searchKeywords || rule.keywords || [],
      conditionTree: rule.conditionTree,
      emailEnabled: rule.emailEnabled,
      emailOnMatch: rule.emailOnMatch,
      intervalMinutes: rule.intervalMinutes,
    }
    return btoa(unescape(encodeURIComponent(JSON.stringify(exportData))))
  }

  const handleShareRule = (rule: MonitorRule) => {
    const code = encodeRule(rule)
    try {
      const ta = document.createElement('textarea')
      ta.value = code
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      alert('规则分享码已复制到剪贴板')
    } catch {
      prompt('复制以下分享码:', code)
    }
  }

  const handleImportRule = async () => {
    const text = importText.trim()
    if (!text) return
    setImportError('')
    try {
      const json = decodeURIComponent(escape(atob(text)))
      const data = JSON.parse(json)
      if (!data.name || !data.searchKeywords) {
        setImportError('无效的规则分享码')
        return
      }
      await createMonitorRule({
        name: data.name,
        searchKeywords: data.searchKeywords,
        conditionTree: data.conditionTree || null,
        emailEnabled: data.emailEnabled || false,
        emailOnMatch: data.emailOnMatch ?? true,
        intervalMinutes: data.intervalMinutes || 10,
      })
      setShowImport(false)
      setImportText('')
      await fetchData()
    } catch {
      setImportError('分享码解析失败，请检查是否完整')
    }
  }

  const fetchData = useCallback(async () => {
    try {
      const [r, h, s] = await Promise.all([
        getMonitorRules(),
        getMonitorHits(filterRule || undefined, 100),
        getMonitorStats(),
      ])
      setRules(r)
      setHits(h)
      setStats(s)
    } catch (e) {
      console.error('Failed to fetch monitor data:', e)
    } finally {
      setLoading(false)
    }
  }, [filterRule])

  useEffect(() => { fetchData() }, [fetchData])

  const handleSaveRule = async () => {
    if (!editingRule) return
    console.log('[handleSaveRule] editingRule:', JSON.parse(JSON.stringify(editingRule)))
    try {
      if (editingRule.id) {
        await updateMonitorRule(editingRule.id, editingRule)
      } else {
        await createMonitorRule(editingRule)
      }
      setShowEditor(false)
      setEditingRule(null)
      await fetchData()
    } catch (e) {
      console.error('Failed to save rule:', e)
    }
  }

  const handleDeleteRule = async (id: string) => {
    if (!confirm('确定删除此规则？相关告警记录也会被删除。')) return
    try {
      await deleteMonitorRule(id)
      await fetchData()
    } catch (e) {
      console.error('Failed to delete rule:', e)
    }
  }

  const handleToggleRule = async (rule: MonitorRule) => {
    try {
      await updateMonitorRule(rule.id, { enabled: !rule.enabled })
      await fetchData()
    } catch (e) {
      console.error('Failed to toggle rule:', e)
    }
  }

  const handleTestRule = async (id: string) => {
    setTesting(id)
    try {
      const result = await testMonitorRule(id)
      const emailMsg = result.emailSent ? '，已发送邮件通知' : ''
      alert(`测试完成：找到 ${result.total} 条匹配结果${emailMsg}`)
    } catch (e) {
      console.error('Test failed:', e)
    } finally {
      setTesting(null)
    }
  }

  const openNewRule = () => {
    setEditingRule({
      name: '',
      searchKeywords: [],
      conditionTree: { type: 'group', logic: 'AND', conditions: [] },
      emailEnabled: false,
      emailOnMatch: true,
      intervalMinutes: 10,
      enabled: true,
    })
    setShowEditor(true)
  }

  const openEditRule = (rule: MonitorRule) => {
    console.log('[openEditRule] rule:', JSON.parse(JSON.stringify(rule)))
    setEditingRule({ ...rule })
    setShowEditor(true)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--text-muted)' }} />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {stats ? `${stats.ruleCount} 条规则 · ${stats.todayHits} 条今日命中 · ${stats.alertedCount} 条告警` : '加载中...'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowImport(true)} variant="outline" size="sm">
            <Import className="w-4 h-4 mr-1.5" /> 导入规则
          </Button>
          <Button onClick={openNewRule} size="sm">
            <Plus className="w-4 h-4 mr-1.5" /> 新建规则
          </Button>
        </div>
      </div>

      {/* Rules */}
      {rules.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onEdit={() => openEditRule(rule)}
              onDelete={() => handleDeleteRule(rule.id)}
              onToggle={() => handleToggleRule(rule)}
              onTest={() => handleTestRule(rule.id)}
              onShare={() => handleShareRule(rule)}
              onFilter={() => setFilterRule(filterRule === rule.id ? '' : rule.id)}
              isActive={filterRule === rule.id}
              testing={testing === rule.id}
            />
          ))}
        </div>
      )}

      {rules.length === 0 && (
        <div className="rounded-lg border p-8 text-center" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <Bell className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>还没有监控规则</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>创建规则后，系统会自动搜索并推送匹配的新闻</p>
          <Button onClick={openNewRule} size="sm" className="mt-4">
            <Plus className="w-4 h-4 mr-1.5" /> 创建第一条规则
          </Button>
        </div>
      )}

      {/* Hits Timeline */}
      {hits.length > 0 && (
        <div className="rounded-lg border" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <button
            onClick={() => setShowHits(!showHits)}
            className="flex items-center justify-between w-full px-4 py-3 transition-colors hover:bg-bg-surface-hover"
          >
            <div className="flex items-center gap-2">
              {showHits
                ? <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                : <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
              <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                命中记录
              </h3>
              <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(59,130,246,0.1)', color: '#3b82f6' }}>
                {hits.length}
              </span>
              {filterRule && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>筛选中</span>}
            </div>
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              {filterRule && (
                <button onClick={() => setFilterRule('')} className="text-xs" style={{ color: 'var(--accent-primary)' }}>
                  清除筛选
                </button>
              )}
            </div>
          </button>
          {showHits && (
            <div className="px-4 pb-3 space-y-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="pt-2" />
              {hits.map((hit) => (
                <HitCard
                  key={hit.newsId + hit.ruleId}
                  hit={hit}
                  ruleName={rules.find((r) => r.id === hit.ruleId)?.name || ''}
                  expanded={expandedHit === hit.newsId + hit.ruleId}
                  onToggle={() => setExpandedHit(expandedHit === hit.newsId + hit.ruleId ? null : hit.newsId + hit.ruleId)}
                  onStockClick={(s) => navigate(`/stock/${s}`)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Rule Editor Modal */}
      <AnimatePresence>
        {showEditor && editingRule && (
          <RuleEditorModal
            rule={editingRule}
            onChange={setEditingRule}
            onSave={handleSaveRule}
            onClose={() => { setShowEditor(false); setEditingRule(null) }}
          />
        )}
      </AnimatePresence>

      {/* Import Modal */}
      <AnimatePresence>
        {showImport && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
            onClick={() => { setShowImport(false); setImportText(''); setImportError('') }}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="w-full max-w-md rounded-xl border shadow-xl overflow-hidden"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                <h3 className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>导入规则</h3>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  粘贴他人分享的规则码，一键导入为自己的监控规则。
                </p>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="粘贴规则分享码..."
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg text-sm border outline-none resize-none"
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                />
                {importError && <p className="text-xs" style={{ color: '#ef4444' }}>{importError}</p>}
              </div>
              <div className="p-4 border-t flex justify-end gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
                <Button onClick={() => { setShowImport(false); setImportText(''); setImportError('') }} variant="outline" size="sm">取消</Button>
                <Button onClick={handleImportRule} size="sm" disabled={!importText.trim()}>导入</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}


function summarizeConditionTree(node: ConditionNode | null | undefined): string {
  if (!node || !node.conditions || node.conditions.length === 0) return ''
  const parts: string[] = []
  for (const c of node.conditions) {
    if (c.type === 'condition' && c.field && c.operator) {
      const fieldLabels: Record<string, string> = {
        title: '标题', content: '正文', source: '来源', sentiment: '情绪',
        importance: '重要度', sentimentScore: '情绪分', topic: '话题',
        matchedKeyword: '关键词', publishTime: '发布时间',
      }
      const opLabels: Record<string, string> = {
        contains: '包含', not_contains: '不包含', eq: '=', neq: '≠',
        gt: '>', gte: '≥', lt: '<', lte: '≤', regex: '正则', in: '在列表中',
        within_hours: '最近N小时', within_days: '最近N天', today: '今天',
        after: '晚于', before: '早于',
      }
      const fl = fieldLabels[c.field] || c.field
      const ol = opLabels[c.operator] || c.operator
      const vl = c.operator === 'today' ? '' : String(c.value ?? '')
      parts.push(`${fl} ${ol} ${vl}`.trim())
    } else if (c.type === 'group') {
      const sub = summarizeConditionTree(c)
      if (sub) parts.push(`(${sub})`)
    }
  }
  const logic = node.logic || 'AND'
  return parts.join(` ${logic} `)
}

function RuleCard({ rule, onEdit, onDelete, onToggle, onTest, onShare, onFilter, isActive, testing }: {
  rule: MonitorRule; onEdit: () => void; onDelete: () => void; onToggle: () => void;
  onTest: () => void; onShare: () => void; onFilter: () => void; isActive: boolean; testing: boolean
}) {
  const keywords = rule.searchKeywords || rule.keywords || []
  const condSummary = summarizeConditionTree(rule.conditionTree)

  return (
    <div
      className="rounded-lg border p-3 transition-colors cursor-pointer"
      style={{
        backgroundColor: isActive ? 'rgba(59,130,246,0.08)' : 'var(--bg-surface)',
        borderColor: isActive ? 'rgba(59,130,246,0.3)' : 'var(--border-subtle)',
      }}
      onClick={onFilter}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{rule.name}</span>
          {rule.emailEnabled && <Mail className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />}
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button onClick={onToggle} className="p-1 rounded hover:bg-bg-surface-hover" title={rule.enabled ? '禁用' : '启用'}>
            {rule.enabled
              ? <ToggleRight className="w-4 h-4" style={{ color: '#22c55e' }} />
              : <ToggleLeft className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
          </button>
          <button onClick={onEdit} className="p-1 rounded hover:bg-bg-surface-hover" title="编辑">
            <Pencil className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
          </button>
          <button onClick={onShare} className="p-1 rounded hover:bg-bg-surface-hover" title="分享">
            <Share2 className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
          </button>
          <button onClick={onDelete} className="p-1 rounded hover:bg-bg-surface-hover" title="删除">
            <Trash2 className="w-3.5 h-3.5" style={{ color: '#ef4444' }} />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 mb-2">
        {keywords.map((kw) => (
          <span key={kw} className="text-[11px] px-1.5 py-0.5 rounded"
            style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
            {kw}
          </span>
        ))}
      </div>
      {condSummary && (
        <div className="text-[11px] mb-1.5 line-clamp-2" style={{ color: 'var(--text-muted)' }}>
          {condSummary}
        </div>
      )}
      <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        <span>每{rule.intervalMinutes}分钟</span>
        {rule.lastRunAt && <span>上次: {fmtTime(rule.lastRunAt)}</span>}
      </div>
      <div className="mt-2 flex gap-1" onClick={(e) => e.stopPropagation()}>
        <Button onClick={onTest} disabled={testing} variant="outline" size="sm" className="h-6 text-[11px] px-2">
          {testing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Play className="w-3 h-3 mr-1" />}
          测试
        </Button>
      </div>
    </div>
  )
}


function HitCard({ hit, ruleName, expanded, onToggle }: {
  hit: MonitorHit; ruleName: string; expanded: boolean; onToggle: () => void; onStockClick: (s: string) => void
}) {
  const badge = sentimentBadge[hit.sentiment] || sentimentBadge.neutral
  const isHigh = hit.importance >= 80 || hit.sentiment === 'negative'

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="rounded border p-2.5 cursor-pointer transition-colors"
      style={{
        backgroundColor: isHigh ? 'rgba(239,68,68,0.04)' : 'var(--bg-elevated)',
        borderColor: isHigh ? 'rgba(239,68,68,0.15)' : 'var(--border-subtle)',
      }}
      onClick={onToggle}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {ruleName && (
              <span className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ backgroundColor: 'rgba(59,130,246,0.1)', color: '#3b82f6' }}>
                {ruleName}
              </span>
            )}
            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
              style={{ backgroundColor: badge.bg, color: badge.color }}>
              {badge.label}
            </span>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{hit.source}</span>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{fmtTime(hit.seenAt)}</span>
            {hit.matchedKeyword && (
              <span className="text-[10px] px-1 py-0.5 rounded"
                style={{ backgroundColor: 'rgba(168,85,247,0.1)', color: '#a855f7' }}>
                {hit.matchedKeyword}
              </span>
            )}
          </div>
          {hit.url ? (
            <a href={hit.url} target="_blank" rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-sm hover:underline" style={{ color: 'var(--text-primary)' }}>
              {hit.title}
            </a>
          ) : (
            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{hit.title}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs font-medium" style={{
            color: hit.importance >= 80 ? '#ef4444' : hit.importance >= 60 ? '#eab308' : 'var(--text-muted)',
          }}>{hit.importance}</span>
          {hit.url ? (
            <a href={hit.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
              className="p-0.5 rounded hover:bg-bg-surface-hover" title="打开原文">
              <ExternalLink className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
            </a>
          ) : (
            <span className="text-[10px] px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>无法跳转</span>
          )}
          {expanded ? <ChevronUp className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />}
        </div>
      </div>
      {expanded && hit.content && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mt-2 pt-2 text-xs leading-relaxed"
          style={{ color: 'var(--text-secondary)', borderTop: '1px solid var(--border-subtle)' }}
        >
          {hit.content}
          {hit.topics.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {hit.topics.map((t) => (
                <span key={t} className="text-[10px] px-1 py-0.5 rounded"
                  style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                  {t}
                </span>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  )
}


function RuleEditorModal({ rule, onChange, onSave, onClose }: {
  rule: Partial<MonitorRule>; onChange: (r: Partial<MonitorRule>) => void; onSave: () => void; onClose: () => void
}) {
  const [keywordInput, setKeywordInput] = useState('')
  const [aiInput, setAiInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const keywords = rule.searchKeywords || rule.keywords || []

  const addKeyword = () => {
    const v = keywordInput.trim()
    if (!v) return
    if (!keywords.includes(v)) {
      onChange({ ...rule, searchKeywords: [...keywords, v] })
    }
    setKeywordInput('')
  }

  const removeKeyword = (kw: string) => {
    onChange({ ...rule, searchKeywords: keywords.filter((k) => k !== kw) })
  }

  const handleAiGenerate = async () => {
    const desc = aiInput.trim()
    if (!desc) return
    setAiLoading(true)
    setAiError('')
    try {
      const result = await generateMonitorRule(desc)
      if (result.ok && result.conditionTree) {
        onChange({
          ...rule,
          name: rule.name || desc.slice(0, 20),
          searchKeywords: result.searchKeywords || rule.searchKeywords,
          conditionTree: result.conditionTree,
        })
      } else {
        setAiError(result.error || 'AI 未能生成有效规则')
      }
    } catch (e: any) {
      setAiError(e?.message || 'AI 生成失败，请检查 AI 配置')
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        className="w-full max-w-xl rounded-xl border shadow-xl overflow-hidden"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <h3 className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>
            {rule.id ? '编辑规则' : '新建规则'}
          </h3>
        </div>

        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Name */}
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>规则名称</label>
            <input value={rule.name || ''} onChange={(e) => onChange({ ...rule, name: e.target.value })}
              placeholder="如：半导体政策利空监控"
              className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
              style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }} />
          </div>

          {/* AI Generate */}
          <div className="rounded-lg border p-3" style={{ borderColor: 'rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.03)' }}>
            <label className="text-xs font-medium block mb-1.5 flex items-center gap-1.5" style={{ color: '#a855f7' }}>
              <Sparkles className="w-3.5 h-3.5" /> AI 自动生成规则
            </label>
            <div className="flex gap-2">
              <input value={aiInput} onChange={(e) => setAiInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !aiLoading) { e.preventDefault(); handleAiGenerate() } }}
                placeholder="用自然语言描述，如：监控半导体行业利空新闻，重要度≥70"
                className="flex-1 px-3 py-2 rounded-lg text-sm border outline-none"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }} />
              <Button onClick={handleAiGenerate} disabled={aiLoading || !aiInput.trim()} size="sm"
                className="shrink-0" style={{ backgroundColor: '#a855f7', color: '#fff' }}>
                {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              </Button>
            </div>
            {aiError && <p className="text-[11px] mt-1.5" style={{ color: '#ef4444' }}>{aiError}</p>}
            <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
              描述你想监控的内容，AI 会自动生成搜索关键词和过滤条件。生成后可手动微调。
            </p>
          </div>

          {/* Search Keywords */}
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>
              搜索关键词 <span style={{ color: 'var(--text-muted)' }}>(用于触发搜索，命中后由条件树过滤)</span>
            </label>
            <div className="flex flex-wrap gap-1 mb-1.5">
              {keywords.map((kw) => (
                <span key={kw} className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1"
                  style={{ backgroundColor: 'var(--accent-primary)', color: '#fff' }}>
                  {kw}
                  <button onClick={() => removeKeyword(kw)}><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
            <input value={keywordInput} onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword() } }}
              placeholder="输入关键词后回车"
              className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
              style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }} />
          </div>

          {/* Condition Tree */}
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>
              过滤条件 <span style={{ color: 'var(--text-muted)' }}>(命中关键词后再按以下条件过滤)</span>
            </label>
            <ConditionEditor
              value={rule.conditionTree}
              onChange={(node) => onChange({ ...rule, conditionTree: node })}
            />
          </div>

          {/* Interval */}
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>搜索间隔（分钟）</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={1440}
                value={rule.intervalMinutes ?? 10}
                onChange={(e) => onChange({ ...rule, intervalMinutes: Math.max(1, Number(e.target.value) || 1) })}
                className="w-20 px-2 py-1.5 rounded-lg text-sm border outline-none text-center"
                style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              />
              <div className="flex gap-1">
                {[5, 10, 30, 60].map((v) => (
                  <button key={v} onClick={() => onChange({ ...rule, intervalMinutes: v })}
                    className="px-2 py-1 rounded text-[11px] transition-colors"
                    style={{
                      backgroundColor: rule.intervalMinutes === v ? 'var(--accent-primary)' : 'var(--bg-elevated)',
                      color: rule.intervalMinutes === v ? '#fff' : 'var(--text-muted)',
                    }}>
                    {v >= 60 ? `${v / 60}h` : `${v}m`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Email */}
          <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {rule.emailEnabled ? <Mail className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} /> : <MailX className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>邮件告警</span>
              </div>
              <button onClick={() => onChange({ ...rule, emailEnabled: !rule.emailEnabled })}>
                {rule.emailEnabled
                  ? <ToggleRight className="w-5 h-5" style={{ color: '#22c55e' }} />
                  : <ToggleLeft className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />}
              </button>
            </div>
            {rule.emailEnabled && (
              <>
                <label className="flex items-center gap-2 text-xs cursor-pointer ml-6" style={{ color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={rule.emailOnMatch ?? true}
                    onChange={(e) => onChange({ ...rule, emailOnMatch: e.target.checked })} />
                  命中条件时发送邮件
                </label>
                <div className="ml-6 flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <span className="shrink-0">勿扰时段</span>
                  <input
                    type="time"
                    value={rule.dndStart || ''}
                    onChange={(e) => onChange({ ...rule, dndStart: e.target.value })}
                    className="px-1.5 py-1 rounded border outline-none text-xs"
                    style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                  />
                  <span style={{ color: 'var(--text-muted)' }}>至</span>
                  <input
                    type="time"
                    value={rule.dndEnd || ''}
                    onChange={(e) => onChange({ ...rule, dndEnd: e.target.value })}
                    className="px-1.5 py-1 rounded border outline-none text-xs"
                    style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                  />
                  <span style={{ color: 'var(--text-muted)' }}>不发邮件</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="p-4 border-t flex justify-end gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <Button onClick={onClose} variant="outline" size="sm">取消</Button>
          <Button onClick={onSave} size="sm" disabled={!rule.name?.trim()}>
            {rule.id ? '保存' : '创建'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}

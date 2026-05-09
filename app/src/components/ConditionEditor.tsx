import { useState } from 'react'
import { Plus, Trash2, HelpCircle, ChevronDown, ChevronRight } from 'lucide-react'
import type { ConditionNode } from '@/types'

interface Props {
  value: ConditionNode | null | undefined;
  onChange: (node: ConditionNode | null) => void;
}

const FIELDS = [
  { value: 'title', label: '标题', type: 'string' },
  { value: 'content', label: '正文', type: 'string' },
  { value: 'source', label: '来源', type: 'string' },
  { value: 'sentiment', label: '情绪', type: 'enum', options: [
    { value: 'positive', label: '利好' },
    { value: 'neutral', label: '中性' },
    { value: 'negative', label: '利空' },
  ]},
  { value: 'importance', label: '重要度', type: 'number' },
  { value: 'sentimentScore', label: '情绪分数', type: 'number' },
  { value: 'topic', label: '话题', type: 'string' },
  { value: 'matchedKeyword', label: '命中关键词', type: 'string' },
  { value: 'publishTime', label: '发布时间', type: 'date' },
]

const OPERATORS: Record<string, { value: string; label: string }[]> = {
  string: [
    { value: 'contains', label: '包含' },
    { value: 'not_contains', label: '不包含' },
    { value: 'eq', label: '等于' },
    { value: 'neq', label: '不等于' },
    { value: 'regex', label: '正则' },
    { value: 'in', label: '在列表中' },
  ],
  number: [
    { value: 'gte', label: '>=' },
    { value: 'gt', label: '>' },
    { value: 'lte', label: '<=' },
    { value: 'lt', label: '<' },
    { value: 'eq', label: '=' },
  ],
  enum: [
    { value: 'eq', label: '等于' },
    { value: 'neq', label: '不等于' },
  ],
  date: [
    { value: 'within_hours', label: '最近N小时' },
    { value: 'within_days', label: '最近N天' },
    { value: 'today', label: '今天' },
    { value: 'after', label: '晚于' },
    { value: 'before', label: '早于' },
  ],
}

function defaultCondition(): ConditionNode {
  return { type: 'condition', field: 'title', operator: 'contains', value: '' }
}

function defaultGroup(): ConditionNode {
  return { type: 'group', logic: 'AND', conditions: [defaultCondition()] }
}

function getFieldDef(field: string) {
  return FIELDS.find((f) => f.value === field)
}

function getOperatorsForField(field: string) {
  const def = getFieldDef(field)
  return OPERATORS[def?.type || 'string'] || OPERATORS.string
}

export default function ConditionEditor({ value, onChange }: Props) {
  const [showHelp, setShowHelp] = useState(false)
  const root = value || defaultGroup()

  const updateNode = (path: number[], updater: (node: ConditionNode) => ConditionNode | null) => {
    const clone = JSON.parse(JSON.stringify(root)) as ConditionNode
    if (path.length === 0) {
      const result = updater(clone)
      onChange(result)
      return
    }
    let current: ConditionNode = clone
    for (let i = 0; i < path.length - 1; i++) {
      current = current.conditions![path[i]]
    }
    const idx = path[path.length - 1]
    const result = updater(current.conditions![idx])
    if (result === null) {
      current.conditions!.splice(idx, 1)
    } else {
      current.conditions![idx] = result
    }
    onChange(clone)
  }

  return (
    <div className="rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
      {/* Help toggle */}
      <button
        onClick={() => setShowHelp(!showHelp)}
        className="flex items-center gap-1.5 px-3 py-1.5 w-full text-left transition-colors hover:bg-bg-surface-hover"
        style={{ borderBottom: showHelp ? '1px solid var(--border-subtle)' : 'none' }}
      >
        {showHelp
          ? <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
          : <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />}
        <HelpCircle className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>条件编辑器使用说明</span>
      </button>

      {showHelp && (
        <div className="px-3 py-2.5 text-[11px] leading-5 space-y-2"
          style={{ backgroundColor: 'rgba(59,130,246,0.03)', color: 'var(--text-secondary)' }}>
          <div>
            <strong style={{ color: 'var(--text-primary)' }}>基本概念：</strong>
            每条规则由「条件」和「条件组」组成。条件是最小判断单元（如：标题 包含 政策），
            条件组把多个条件用 AND（全部满足）或 OR（任一满足）组合起来。
          </div>
          <div>
            <strong style={{ color: 'var(--text-primary)' }}>操作方法：</strong>
            <span className="inline-block ml-1">
              选择字段 → 选择运算符 → 输入值 → 点击下方「+条件」或「+条件组」添加更多。
              点击 <span style={{ color: '#3b82f6' }}>AND</span>/<span style={{ color: '#a855f7' }}>OR</span> 标签可切换逻辑关系。
            </span>
          </div>
          <div>
            <strong style={{ color: 'var(--text-primary)' }}>示例：</strong>
            <span className="inline-block ml-1">监控「利空且重要度≥70」的半导体新闻：</span>
            <div className="mt-1 ml-3 font-mono text-[10px] leading-4 p-2 rounded"
              style={{ backgroundColor: 'var(--bg-elevated)' }}>
              <div style={{ color: '#3b82f6' }}>AND 全部满足</div>
              <div className="ml-3">├ 情绪 <span style={{ color: 'var(--text-muted)' }}>=</span> 利空</div>
              <div className="ml-3">{'├ 重要度 '}<span style={{ color: 'var(--text-muted)' }}>{'>='}</span>{' 70'}</div>
              <div className="ml-3">└ <span style={{ color: '#a855f7' }}>OR 任一满足</span></div>
              <div className="ml-6">├ 标题 <span style={{ color: 'var(--text-muted)' }}>包含</span> 半导体</div>
              <div className="ml-6">└ 话题 <span style={{ color: 'var(--text-muted)' }}>包含</span> 半导体</div>
            </div>
          </div>
          <div>
            <strong style={{ color: 'var(--text-primary)' }}>时间过滤：</strong>
            <span className="inline-block ml-1">
              选择「发布时间」字段后可用「最近N小时」「今天」等时间运算符，适合做时效性监控。
            </span>
          </div>
        </div>
      )}

      <GroupNode
        node={root}
        path={[]}
        depth={0}
        onUpdate={updateNode}
        onRootChange={onChange}
      />
    </div>
  )
}

function GroupNode({ node, path, depth, onUpdate, onRootChange }: {
  node: ConditionNode; path: number[]; depth: number;
  onUpdate: (path: number[], updater: (n: ConditionNode) => ConditionNode | null) => void;
  onRootChange: (n: ConditionNode | null) => void;
}) {
  const isRoot = path.length === 0
  const conditions = node.conditions || []

  const toggleLogic = () => {
    if (isRoot) {
      onRootChange({ ...node, logic: node.logic === 'AND' ? 'OR' : 'AND' })
    } else {
      onUpdate(path, (n) => ({ ...n, logic: n.logic === 'AND' ? 'OR' : 'AND' }))
    }
  }

  const addCondition = () => {
    const newConds = [...conditions, defaultCondition()]
    if (isRoot) {
      onRootChange({ ...node, conditions: newConds })
    } else {
      onUpdate(path, (n) => ({ ...n, conditions: [...(n.conditions || []), defaultCondition()] }))
    }
  }

  const addGroup = () => {
    const newConds = [...conditions, defaultGroup()]
    if (isRoot) {
      onRootChange({ ...node, conditions: newConds })
    } else {
      onUpdate(path, (n) => ({ ...n, conditions: [...(n.conditions || []), defaultGroup()] }))
    }
  }

  const removeSelf = () => {
    if (isRoot) onRootChange(null)
    else onUpdate(path, () => null)
  }

  return (
    <div style={{ marginLeft: depth > 0 ? 16 : 0 }}>
      {/* Group header */}
      <div className="flex items-center gap-2 px-3 py-2"
        style={{ backgroundColor: depth === 0 ? 'transparent' : 'rgba(59,130,246,0.04)' }}>
        <button onClick={toggleLogic}
          className="px-2 py-0.5 rounded text-xs font-bold transition-colors"
          style={{
            backgroundColor: node.logic === 'AND' ? 'rgba(59,130,246,0.15)' : 'rgba(168,85,247,0.15)',
            color: node.logic === 'AND' ? '#3b82f6' : '#a855f7',
          }}>
          {node.logic || 'AND'}
        </button>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {node.logic === 'AND' ? '全部满足' : '任一满足'}
        </span>
        {!isRoot && (
          <button onClick={removeSelf} className="ml-auto p-1 rounded hover:bg-bg-surface-hover">
            <Trash2 className="w-3.5 h-3.5" style={{ color: '#ef4444' }} />
          </button>
        )}
      </div>

      {/* Children */}
      <div className="space-y-0">
        {conditions.map((child, i) => (
          <div key={i}>
            {child.type === 'condition' ? (
              <ConditionRow
                node={child}
                path={[...path, i]}
                onUpdate={onUpdate}
              />
            ) : (
              <GroupNode
                node={child}
                path={[...path, i]}
                depth={depth + 1}
                onUpdate={onUpdate}
                onRootChange={onRootChange}
              />
            )}
          </div>
        ))}
      </div>

      {/* Add buttons */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={addCondition}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors hover:bg-bg-surface-hover"
          style={{ color: 'var(--accent-primary)' }}>
          <Plus className="w-3 h-3" /> 条件
        </button>
        <button onClick={addGroup}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors hover:bg-bg-surface-hover"
          style={{ color: '#a855f7' }}>
          <Plus className="w-3 h-3" /> 条件组
        </button>
      </div>
    </div>
  )
}

function ConditionRow({ node, path, onUpdate }: {
  node: ConditionNode; path: number[];
  onUpdate: (path: number[], updater: (n: ConditionNode) => ConditionNode | null) => void;
}) {
  const fieldDef = getFieldDef(node.field || 'title')
  const operators = getOperatorsForField(node.field || 'title')
  const isDate = fieldDef?.type === 'date'
  const isEnum = fieldDef?.type === 'enum'
  const isToday = node.operator === 'today'

  const update = (changes: Partial<ConditionNode>) => {
    onUpdate(path, (n) => ({ ...n, ...changes }))
  }

  const remove = () => {
    onUpdate(path, () => null)
  }

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 flex-wrap">
      {/* Field select */}
      <select
        value={node.field || 'title'}
        onChange={(e) => {
          const newField = e.target.value
          const ops = getOperatorsForField(newField)
          update({ field: newField, operator: ops[0]?.value || 'contains', value: '' })
        }}
        className="px-2 py-1 rounded text-xs border outline-none"
        style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)', minWidth: 70 }}
      >
        {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
      </select>

      {/* Operator select */}
      <select
        value={node.operator || 'contains'}
        onChange={(e) => update({ operator: e.target.value, value: isToday ? '' : node.value })}
        className="px-2 py-1 rounded text-xs border outline-none"
        style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)', minWidth: 70 }}
      >
        {operators.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      {/* Value input */}
      {!isToday && (
        <>
          {isEnum ? (
            <select
              value={String(node.value || '')}
              onChange={(e) => update({ value: e.target.value })}
              className="px-2 py-1 rounded text-xs border outline-none"
              style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            >
              <option value="">选择...</option>
              {fieldDef?.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input
              type={fieldDef?.type === 'number' ? 'number' : 'text'}
              value={String(node.value ?? '')}
              onChange={(e) => update({ value: fieldDef?.type === 'number' ? Number(e.target.value) : e.target.value })}
              placeholder={isDate ? (node.operator === 'within_hours' ? '小时数' : node.operator === 'within_days' ? '天数' : 'YYYY-MM-DD') : '值'}
              className="px-2 py-1 rounded text-xs border outline-none"
              style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)', minWidth: 80, maxWidth: 160 }}
            />
          )}
        </>
      )}

      {/* Remove */}
      <button onClick={remove} className="p-1 rounded hover:bg-bg-surface-hover shrink-0">
        <Trash2 className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
      </button>
    </div>
  )
}

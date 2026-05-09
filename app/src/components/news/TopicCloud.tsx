import type { TopicCluster } from '@/types'

interface TopicCloudProps {
  topics: TopicCluster[]
  onTopicClick?: (topic: string) => void
}

const sentimentColors: Record<string, { bg: string; text: string }> = {
  positive: { bg: 'rgba(34,197,94,0.15)', text: '#22c55e' },
  neutral: { bg: 'rgba(234,179,8,0.15)', text: '#eab308' },
  negative: { bg: 'rgba(239,68,68,0.15)', text: '#ef4444' },
}

const trendIcons: Record<string, string> = {
  up: '↑',
  down: '↓',
  flat: '→',
}

export default function TopicCloud({ topics, onTopicClick }: TopicCloudProps) {
  if (topics.length === 0) {
    return (
      <div className="text-center py-6" style={{ color: 'var(--text-muted)' }}>
        暂无热点话题
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      {topics.map((topic) => {
        const colors = sentimentColors[topic.sentiment] || sentimentColors.neutral
        const trend = trendIcons[topic.trend] || ''
        return (
          <button
            key={topic.topic}
            onClick={() => onTopicClick?.(topic.topic)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all hover:scale-105 cursor-pointer"
            style={{
              backgroundColor: colors.bg,
              color: colors.text,
              border: `1px solid ${colors.text}30`,
            }}
          >
            <span>{topic.topic}</span>
            <span className="text-xs opacity-70">{topic.count}</span>
            {topic.trend !== 'flat' && (
              <span className="text-xs">{trend}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

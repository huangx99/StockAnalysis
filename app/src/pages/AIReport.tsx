import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import AIReportViewer from '@/components/ai/AIReportViewer'
import { getStockProfile, streamAIAnalysis } from '@/api/real/stockApi'
import type { StockProfile, AIAnalysis } from '@/types'

export default function AIReportPage() {
  const { symbol } = useParams<{ symbol: string }>()
  const [profile, setProfile] = useState<StockProfile | null>(null)
  const [analysis, setAnalysis] = useState<Partial<AIAnalysis> | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [aiStreaming, setAiStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startAnalysis = useCallback(() => {
    if (!symbol) return
    setAnalysis(null)
    setAiStreaming(true)
    streamAIAnalysis(
      symbol,
      (field, value) => {
        setAnalysis((prev) => ({ ...prev, [field]: value }))
      },
      () => setAiStreaming(false),
      () => setAiStreaming(false),
    )
  }, [symbol])

  useEffect(() => {
    if (!symbol) return

    let cancelled = false
    setProfileLoading(true)
    setError(null)

    getStockProfile(symbol)
      .then((p) => {
        if (!cancelled) {
          setProfile(p)
          setProfileLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载失败')
          setProfileLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [symbol])

  // Start AI analysis once profile is loaded
  useEffect(() => {
    if (profile && !analysis && !aiStreaming) {
      startAnalysis()
    }
  }, [profile, analysis, aiStreaming, startAnalysis])

  if (profileLoading) {
    return (
      <div className="p-6 max-w-[1200px] mx-auto">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-xl border p-8 animate-pulse"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
        >
          <div className="h-8 w-64 rounded mb-4" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
          <div className="h-4 w-96 rounded mb-2" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
          <div className="h-4 w-72 rounded" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
        </motion.div>
        <div className="mt-6 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border p-6 animate-pulse"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
            >
              <div className="h-6 w-48 rounded mb-4" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
              <div className="h-4 w-full rounded mb-2" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
              <div className="h-4 w-3/4 rounded" style={{ backgroundColor: 'var(--bg-surface-hover)' }} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="p-6 max-w-[1200px] mx-auto">
        <div
          className="rounded-xl border p-8 text-center"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
        >
          <p className="font-body" style={{ color: 'var(--danger)' }}>
            {error || '数据加载失败，请稍后重试'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <AIReportViewer
      symbol={symbol!}
      profile={profile}
      analysis={analysis}
      streaming={aiStreaming}
      onRegenerate={startAnalysis}
    />
  )
}

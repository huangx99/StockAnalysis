import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { RotateCw, Star, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react'
import type { StockProfile } from '@/types'
import { formatPrice, formatPercent, formatMarketCap } from '@/lib/formatters'
import MetricTooltip from '@/components/common/MetricTooltip'

interface StockHeaderProps {
  profile: StockProfile
  onRefresh: () => void
  isRefreshing?: boolean
  refreshMessage?: string
  isFavorite: boolean
  onToggleFavorite: () => void
}

interface DataFreshness {
  stale: boolean
  reason: string
}

function parseUpdateTime(updateTime: string) {
  const match = updateTime.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (!match) return null
  const [, year, month, day, hour = '0', minute = '0', second = '0'] = match
  const parsed = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function getDataFreshness(updateTime: string): DataFreshness {
  const updatedAt = parseUpdateTime(updateTime)
  if (!updatedAt) return { stale: true, reason: '缺少有效更新时间，请刷新数据' }

  const now = new Date()
  const sameDate = updatedAt.getFullYear() === now.getFullYear()
    && updatedAt.getMonth() === now.getMonth()
    && updatedAt.getDate() === now.getDate()
  const ageMinutes = (now.getTime() - updatedAt.getTime()) / 60000
  const weekday = now.getDay()
  const minutesOfDay = now.getHours() * 60 + now.getMinutes()
  const duringTrading = weekday >= 1 && weekday <= 5 && minutesOfDay >= 9 * 60 + 30 && minutesOfDay <= 15 * 60 + 30

  if (!sameDate) {
    return { stale: true, reason: `数据时间 ${updateTime}，不是当前日期，请刷新数据` }
  }
  if (duringTrading && ageMinutes > 30) {
    return { stale: true, reason: `数据已 ${Math.floor(ageMinutes)} 分钟未更新，请刷新数据` }
  }
  return { stale: false, reason: '' }
}

export default function StockHeader({ profile, onRefresh, isRefreshing = false, refreshMessage = '', isFavorite, onToggleFavorite }: StockHeaderProps) {
  const isUp = profile.change >= 0
  const colorVar = isUp ? 'var(--up-red)' : 'var(--down-green)'

  const marketTag = useMemo(() => {
    if (profile.market === 'SH') return '沪市主板'
    if (profile.market === 'SZ') return '深市主板'
    return profile.market
  }, [profile.market])
  const dataFreshness = useMemo(() => getDataFreshness(profile.updateTime), [profile.updateTime])

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] }}
      className="w-full rounded-xl border border-border-subtle px-5 py-5 md:px-6"
      style={{ backgroundColor: 'var(--bg-surface)' }}
    >
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        {/* Left column */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-h1" style={{ color: 'var(--text-primary)' }}>
              {profile.name}
            </h1>
            {dataFreshness.stale && (
              <button
                type="button"
                onClick={onRefresh}
                disabled={isRefreshing}
                title={dataFreshness.reason}
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium transition-all hover:scale-[1.02] disabled:opacity-70"
                style={{ backgroundColor: 'var(--warning)26', color: 'var(--warning)' }}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                数据需更新
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-1">
            <span
              className="font-data-md px-2 py-0.5 rounded"
              style={{ backgroundColor: 'var(--bg-surface-hover)', color: 'var(--text-secondary)' }}
            >
              {profile.symbol}.{profile.market}
            </span>
            <span
              className="font-label px-1.5 py-0.5 rounded"
              style={{ backgroundColor: 'var(--accent-primary)26', color: 'var(--accent-primary)' }}
            >
              {marketTag}
            </span>
            <span
              className="font-label px-1.5 py-0.5 rounded"
              style={{ backgroundColor: 'var(--text-secondary)1F', color: 'var(--text-secondary)' }}
            >
              {profile.industry}
            </span>
            <span className="hidden sm:inline" style={{ color: 'var(--border-subtle)' }}>|</span>
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              <span className="font-data-sm" style={{ color: 'var(--text-secondary)' }}>交易中</span>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="flex flex-col items-start md:items-end gap-1 shrink-0">
          <div className="flex items-baseline gap-3">
            <span className="font-data-lg tabular-nums" style={{ color: colorVar }}>
              {formatPrice(profile.currentPrice)}
            </span>
            <div className="flex items-center gap-1">
              {isUp ? (
                <TrendingUp className="w-4 h-4" style={{ color: colorVar }} />
              ) : (
                <TrendingDown className="w-4 h-4" style={{ color: colorVar }} />
              )}
              <span className="font-data-md tabular-nums" style={{ color: colorVar }}>
                {profile.change >= 0 ? '+' : ''}{formatPrice(profile.change)}
              </span>
              <span className="font-data-md tabular-nums" style={{ color: colorVar }}>
                ({formatPercent(profile.changePercent)})
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-data-sm" style={{ color: 'var(--text-muted)' }}>
              <MetricTooltip label="总市值" />: {formatMarketCap(profile.marketCap)}
            </span>
            {profile.open > 0 && (
              <span className="font-data-sm" style={{ color: 'var(--text-muted)' }}>
                <MetricTooltip label="今开" />: {formatPrice(profile.open)} <MetricTooltip label="最高" />: {formatPrice(profile.high)} <MetricTooltip label="最低" />: {formatPrice(profile.low)}
              </span>
            )}
            {profile.change60d !== 0 && (
              <span className="font-label px-1.5 py-0.5 rounded" style={{
                backgroundColor: profile.change60d >= 0 ? 'var(--up-red)26' : 'var(--down-green)26',
                color: profile.change60d >= 0 ? 'var(--up-red)' : 'var(--down-green)',
              }}>
                <MetricTooltip label="60日涨跌幅" /> {profile.change60d >= 0 ? '+' : ''}{profile.change60d.toFixed(2)}%
              </span>
            )}
            {profile.changeYtd !== 0 && (
              <span className="font-label px-1.5 py-0.5 rounded" style={{
                backgroundColor: profile.changeYtd >= 0 ? 'var(--up-red)26' : 'var(--down-green)26',
                color: profile.changeYtd >= 0 ? 'var(--up-red)' : 'var(--down-green)',
              }}>
                <MetricTooltip label="年初至今" /> {profile.changeYtd >= 0 ? '+' : ''}{profile.changeYtd.toFixed(2)}%
              </span>
            )}
            <span className="font-label" style={{ color: 'var(--text-muted)' }}>
              更新时间: {profile.updateTime}
            </span>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-border-subtle">
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all hover:scale-[1.02]"
          style={{ color: 'var(--text-secondary)', backgroundColor: 'transparent', opacity: isRefreshing ? 0.65 : 1 }}
        >
          <RotateCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? '更新中' : '刷新数据'}
        </button>
        {refreshMessage && (
          <span className="text-xs" style={{ color: 'var(--accent-primary)' }}>{refreshMessage}</span>
        )}
        <button
          onClick={onToggleFavorite}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all hover:scale-[1.02]"
          style={{ color: isFavorite ? '#F59E0B' : 'var(--text-secondary)', backgroundColor: 'transparent' }}
        >
          <Star className="w-4 h-4" fill={isFavorite ? '#F59E0B' : 'none'} />
          {isFavorite ? '已加自选' : '加入自选'}
        </button>
      </div>
    </motion.div>
  )
}

import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown } from 'lucide-react'
import type { StockProfile } from '@/types'
import { formatPrice, formatPercent, formatMarketCap, formatTurnover } from '@/lib/formatters'
import MetricTooltip from '@/components/common/MetricTooltip'

interface MetricCardProps {
  label: React.ReactNode
  value: string
  context: string
  isPositive?: boolean | null
  delay: number
}

function MetricCard({ label, value, context, isPositive, delay }: MetricCardProps) {
  const contextColor = isPositive === null
    ? 'var(--text-muted)'
    : isPositive
      ? 'var(--up-red)'
      : 'var(--down-green)'

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] }}
      whileHover={{ scale: 1.02, borderColor: 'var(--accent-primary)' }}
      className="rounded-xl border border-border-subtle px-4 py-4 transition-shadow hover:shadow-glow"
      style={{ backgroundColor: 'var(--bg-surface)' }}
    >
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <span className="font-label" style={{ color: 'var(--text-muted)' }}>{label}</span>
          <span className="font-data-lg tabular-nums" style={{ color: 'var(--text-primary)', fontSize: '24px' }}>
            {value}
          </span>
        </div>
        {isPositive !== null && (
          <span className="mt-1">
            {isPositive ? (
              <TrendingUp className="w-3 h-3" style={{ color: 'var(--up-red)' }} />
            ) : (
              <TrendingDown className="w-3 h-3" style={{ color: 'var(--down-green)' }} />
            )}
          </span>
        )}
      </div>
      <span className="font-data-sm mt-1 block" style={{ color: contextColor }}>
        {context}
      </span>
    </motion.div>
  )
}

interface StockMetricCardsProps {
  profile: StockProfile
}

export default function StockMetricCards({ profile }: StockMetricCardsProps) {
  const isUp = profile.change >= 0
  const vsYesterday = profile.previousClose > 0
    ? ((profile.currentPrice - profile.previousClose) / profile.previousClose * 100).toFixed(2)
    : null

  const cards = [
    { key: 'price', label: <MetricTooltip label="当前价" />, value: formatPrice(profile.currentPrice), context: formatPercent(profile.changePercent), isPositive: isUp },
    { key: 'change', label: <MetricTooltip label="涨跌幅" />, value: formatPercent(profile.changePercent), context: '今日', isPositive: isUp },
    { key: 'turnover', label: <MetricTooltip label="成交额" />, value: formatTurnover(profile.turnoverAmount || profile.volume), context: vsYesterday ? `${Number(vsYesterday) >= 0 ? '+' : ''}${vsYesterday}% vs 昨收` : '—', isPositive: vsYesterday ? Number(vsYesterday) >= 0 : null },
    { key: 'turnoverRate', label: <MetricTooltip label="换手率" />, value: `${profile.turnoverRate.toFixed(2)}%`, context: profile.amplitude > 0 ? `振幅 ${profile.amplitude.toFixed(2)}%` : '—', isPositive: null },
    { key: 'volumeRatio', label: <MetricTooltip label="量比" />, value: profile.volumeRatio.toFixed(2), context: profile.volumeRatio >= 1 ? '放量' : '缩量', isPositive: null },
    { key: 'marketCap', label: <MetricTooltip label="总市值" />, value: formatMarketCap(profile.marketCap), context: profile.freeFloatMarketCap > 0 ? `流通 ${formatMarketCap(profile.freeFloatMarketCap)}` : '—', isPositive: null },
    { key: 'pe', label: <MetricTooltip label="市盈率(PE)" />, value: profile.pe.toFixed(1), context: profile.industry ? `${profile.industry}` : '—', isPositive: null },
    { key: 'pb', label: <MetricTooltip label="市净率(PB)" />, value: profile.pb.toFixed(1), context: profile.change60d !== 0 ? `60日 ${formatPercent(profile.change60d)}` : '—', isPositive: profile.change60d !== 0 ? profile.change60d >= 0 : null },
    { key: 'dividend', label: <MetricTooltip label="股息率" />, value: `${profile.dividendYield.toFixed(2)}%`, context: profile.changeYtd !== 0 ? `年初至今 ${formatPercent(profile.changeYtd)}` : '—', isPositive: profile.changeYtd !== 0 ? profile.changeYtd >= 0 : null },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
      {cards.map((card, i) => (
        <MetricCard
          key={card.key}
          label={card.label}
          value={card.value}
          context={card.context}
          isPositive={card.isPositive}
          delay={0.2 + i * 0.05}
        />
      ))}
    </div>
  )
}

import { useState, useMemo } from 'react'
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import type { KLineData } from '@/types'

interface StockKLineChartProps {
  data: KLineData[]
  loading: boolean
  period: 'day' | 'week' | 'month'
  onPeriodChange: (p: 'day' | 'week' | 'month') => void
}

/* ── Candlestick bar shape ─────────────────────────────── */
function CandlestickShape(props: any) {
  const { x, y, width, height, payload } = props
  if (!payload) return null
  const { open, high, low, close } = payload
  const isUp = close >= open
  const color = isUp ? '#EF4444' : '#22C55E'
  const bodyTop = Math.min(open, close)
  Math.max(open, close)
  const scaleY = height / (props.max - props.min || 1)
  const baseY = y

  const wickX = x + width / 2
  const wickWidth = 1

  const bodyH = Math.max(Math.abs(close - open) * scaleY, 1)
  const bodyY = baseY + (props.max - bodyTop) * scaleY
  const wickTopY = baseY + (props.max - high) * scaleY
  const wickBottomY = baseY + (props.max - low) * scaleY

  return (
    <g>
      {/* Wick */}
      <rect x={wickX - wickWidth / 2} y={wickTopY} width={wickWidth} height={wickBottomY - wickTopY} fill={color} />
      {/* Body */}
      <rect x={x + 1} y={bodyY} width={width - 2} height={bodyH} fill={color} rx={1} />
    </g>
  )
}

/* ── Custom Tooltip ──────────────────────────────────── */
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null
  const d = payload[0]?.payload as KLineData
  if (!d) return null
  const isUp = d.close >= d.open
  return (
    <div
      className="rounded-lg border border-border-subtle px-3 py-2 shadow-lg"
      style={{ backgroundColor: 'var(--bg-elevated)' }}
    >
      <div className="font-data-sm mb-1" style={{ color: 'var(--text-primary)' }}>{label}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-data-sm" style={{ color: 'var(--text-secondary)' }}>
        <span>开: <span style={{ color: 'var(--text-primary)' }}>{d.open}</span></span>
        <span>高: <span style={{ color: 'var(--text-primary)' }}>{d.high}</span></span>
        <span>低: <span style={{ color: 'var(--text-primary)' }}>{d.low}</span></span>
        <span>
          收:{' '}
          <span style={{ color: isUp ? 'var(--up-red)' : 'var(--down-green)' }}>
            {d.close}
          </span>
        </span>
        <span>量: <span style={{ color: 'var(--text-primary)' }}>{(d.volume / 10000).toFixed(0)}万</span></span>
        {d.ma5 && <span style={{ color: 'var(--chart-ma5)' }}>MA5: {d.ma5}</span>}
        {d.ma10 && <span style={{ color: 'var(--chart-ma10)' }}>MA10: {d.ma10}</span>}
        {d.ma20 && <span style={{ color: 'var(--chart-ma20)' }}>MA20: {d.ma20}</span>}
        {d.ma60 && <span style={{ color: 'var(--chart-ma60)' }}>MA60: {d.ma60}</span>}
      </div>
    </div>
  )
}

export default function StockKLineChart({ data, loading, period, onPeriodChange }: StockKLineChartProps) {
  const [showMA, setShowMA] = useState({ ma5: true, ma10: true, ma20: true, ma60: true })

  const chartData = useMemo(() => {
    if (!data.length) return []
    return data.map((d) => ({
      ...d,
      isUp: d.close >= d.open,
      volumeColor: d.close >= d.open ? 'var(--up-red)' : 'var(--down-green)',
    }))
  }, [data])

  const priceRange = useMemo(() => {
    if (!chartData.length) return { min: 0, max: 100 }
    const prices = chartData.flatMap((d) => [d.high, d.low])
    const min = Math.min(...prices)
    const max = Math.max(...prices)
    const pad = (max - min) * 0.1
    return { min: min - pad, max: max + pad }
  }, [chartData])

  const volumeMax = useMemo(() => {
    if (!chartData.length) return 100
    return Math.max(...chartData.map((d) => d.volume)) * 4
  }, [chartData])

  const periods: { key: 'day' | 'week' | 'month'; label: string }[] = [
    { key: 'day', label: '日K' },
    { key: 'week', label: '周K' },
    { key: 'month', label: '月K' },
  ]

  const maButtons = [
    { key: 'ma5' as const, label: 'MA5', color: 'var(--chart-ma5)' },
    { key: 'ma10' as const, label: 'MA10', color: 'var(--chart-ma10)' },
    { key: 'ma20' as const, label: 'MA20', color: 'var(--chart-ma20)' },
    { key: 'ma60' as const, label: 'MA60', color: 'var(--chart-ma60)' },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] }}
      className="rounded-xl border border-border-subtle p-5 flex flex-col"
      style={{ backgroundColor: 'var(--bg-surface)', minHeight: '460px' }}
    >
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1">
          {periods.map((p) => (
            <button
              key={p.key}
              onClick={() => onPeriodChange(p.key)}
              className="px-3 py-1 rounded-md text-sm font-medium transition-all"
              style={{
                backgroundColor: period === p.key ? 'var(--accent-primary)' : 'transparent',
                color: period === p.key ? '#fff' : 'var(--text-secondary)',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {maButtons.map((ma) => (
            <button
              key={ma.key}
              onClick={() => setShowMA((s) => ({ ...s, [ma.key]: !s[ma.key] }))}
              className="px-2 py-1 rounded text-xs font-medium border transition-all"
              style={{
                borderColor: showMA[ma.key] ? ma.color : 'var(--border-subtle)',
                color: showMA[ma.key] ? ma.color : 'var(--text-muted)',
                backgroundColor: showMA[ma.key] ? `${ma.color}15` : 'transparent',
              }}
            >
              {ma.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart area */}
      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col items-center justify-center min-h-[380px]"
          >
            <Loader2 className="w-5 h-5 animate-spin-slow mb-2" style={{ color: 'var(--accent-primary)' }} />
            <span className="font-body text-sm" style={{ color: 'var(--text-muted)' }}>行情数据加载中...</span>
          </motion.div>
        ) : chartData.length === 0 ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex items-center justify-center min-h-[380px]"
          >
            <span className="font-body text-sm" style={{ color: 'var(--text-muted)' }}>暂无数据</span>
          </motion.div>
        ) : (
          <motion.div
            key="chart"
            initial={{ opacity: 0, clipPath: 'inset(0 100% 0 0)' }}
            animate={{ opacity: 1, clipPath: 'inset(0 0% 0 0)' }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="flex-1 min-h-[380px]"
          >
            <ResponsiveContainer width="100%" height={400}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'JetBrains Mono' }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border-subtle)' }}
                  minTickGap={30}
                />
                <YAxis
                  yAxisId="price"
                  domain={[priceRange.min, priceRange.max]}
                  tick={{ fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'JetBrains Mono' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => v.toFixed(1)}
                  width={50}
                />
                <YAxis
                  yAxisId="volume"
                  orientation="right"
                  domain={[0, volumeMax]}
                  tick={false}
                  axisLine={false}
                  tickLine={false}
                  width={0}
                />
                <Tooltip content={<CustomTooltip />} />

                {/* Volume bars */}
                <Bar
                  yAxisId="volume"
                  dataKey="volume"
                  barSize={chartData.length > 40 ? 2 : 4}
                  opacity={0.4}
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.isUp ? 'var(--up-red)' : 'var(--down-green)'} />
                  ))}
                </Bar>

                {/* Candlestick body via Bar with custom shape */}
                <Bar
                  yAxisId="price"
                  dataKey="close"
                  barSize={chartData.length > 40 ? 3 : 6}
                  shape={(props: any) => (
                    <CandlestickShape {...props} max={priceRange.max} min={priceRange.min} />
                  )}
                >
                  {chartData.map((_entry, index) => (
                    <Cell key={`candle-${index}`} fill="transparent" />
                  ))}
                </Bar>

                {/* MA Lines */}
                {showMA.ma5 && (
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="ma5"
                    stroke="var(--chart-ma5)"
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                    animationDuration={600}
                  />
                )}
                {showMA.ma10 && (
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="ma10"
                    stroke="var(--chart-ma10)"
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                    animationDuration={600}
                    animationBegin={200}
                  />
                )}
                {showMA.ma20 && (
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="ma20"
                    stroke="var(--chart-ma20)"
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                    animationDuration={600}
                    animationBegin={400}
                  />
                )}
                {showMA.ma60 && (
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="ma60"
                    stroke="var(--chart-ma60)"
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                    animationDuration={600}
                    animationBegin={600}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

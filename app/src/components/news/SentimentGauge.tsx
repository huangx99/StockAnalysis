import { useEffect, useRef } from 'react'

interface SentimentGaugeProps {
  score: number
  size?: number
  label?: string
}

export default function SentimentGauge({ score, size = 140, label }: SentimentGaugeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.scale(dpr, dpr)

    const cx = size / 2
    const cy = size / 2 + 10
    const radius = size / 2 - 20
    const startAngle = Math.PI * 0.8
    const endAngle = Math.PI * 2.2
    const lineWidth = 10

    ctx.clearRect(0, 0, size, size)

    // Background arc
    ctx.beginPath()
    ctx.arc(cx, cy, radius, startAngle, endAngle)
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = lineWidth
    ctx.lineCap = 'round'
    ctx.stroke()

    // Gradient arc
    const clamped = Math.max(0, Math.min(100, score))
    const angle = startAngle + (endAngle - startAngle) * (clamped / 100)
    const gradient = ctx.createLinearGradient(0, cy - radius, size, cy + radius)
    gradient.addColorStop(0, '#ef4444')
    gradient.addColorStop(0.5, '#eab308')
    gradient.addColorStop(1, '#22c55e')

    ctx.beginPath()
    ctx.arc(cx, cy, radius, startAngle, angle)
    ctx.strokeStyle = gradient
    ctx.lineWidth = lineWidth
    ctx.lineCap = 'round'
    ctx.stroke()

    // Score text
    ctx.fillStyle = 'var(--text-primary, #fff)'
    ctx.font = `bold ${size * 0.25}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(clamped), cx, cy - 5)

    // Label
    if (label) {
      ctx.fillStyle = 'var(--text-secondary, #aaa)'
      ctx.font = `${size * 0.09}px system-ui, sans-serif`
      ctx.fillText(label, cx, cy + size * 0.15)
    }
  }, [score, size, label])

  return (
    <div className="flex flex-col items-center">
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size }}
        className="select-none"
      />
    </div>
  )
}

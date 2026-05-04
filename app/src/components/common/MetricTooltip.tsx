import { useState } from 'react'
import type React from 'react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import metricDescriptions from '@/lib/metricDescriptions'

interface MetricTooltipProps {
  label: string
  children?: React.ReactNode
  className?: string
}

function isTouchLikeDevice(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(hover: none), (pointer: coarse), (max-width: 768px)').matches
}

export default function MetricTooltip({ label, children, className }: MetricTooltipProps) {
  const desc = metricDescriptions[label]
  const [mobileOpen, setMobileOpen] = useState(false)

  if (!desc) {
    return <span className={className}>{children ?? label}</span>
  }

  const content = children ?? label

  const handleClick = (event: React.MouseEvent<HTMLSpanElement>) => {
    if (!isTouchLikeDevice()) return
    event.preventDefault()
    event.stopPropagation()
    setMobileOpen(true)
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={className}
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={(event) => {
              if ((event.key === 'Enter' || event.key === ' ') && isTouchLikeDevice()) {
                event.preventDefault()
                setMobileOpen(true)
              }
            }}
            style={{ cursor: 'help', borderBottom: '1px dashed var(--text-muted)' }}
          >
            {content}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px] text-left hidden md:block">
          <div className="flex flex-col gap-1">
            <span className="font-semibold">{desc.name}</span>
            <span className="text-xs opacity-90 leading-relaxed">{desc.description}</span>
          </div>
        </TooltipContent>
      </Tooltip>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/45 px-3 pb-3 md:hidden"
          onClick={() => setMobileOpen(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border-subtle p-4 shadow-xl"
            style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>术语解释</div>
                <div className="text-base font-semibold">{desc.name}</div>
              </div>
              <button
                type="button"
                className="rounded-full px-3 py-1 text-sm"
                style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-secondary)' }}
                onClick={() => setMobileOpen(false)}
              >
                关闭
              </button>
            </div>
            <div className="text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{desc.description}</div>
          </div>
        </div>
      )}
    </>
  )
}

import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import metricDescriptions from '@/lib/metricDescriptions'

interface MetricTooltipProps {
  label: string
  children?: React.ReactNode
  className?: string
}

export default function MetricTooltip({ label, children, className }: MetricTooltipProps) {
  const desc = metricDescriptions[label]

  if (!desc) {
    return <span className={className}>{children ?? label}</span>
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={className} style={{ cursor: 'help', borderBottom: '1px dashed var(--text-muted)' }}>
          {children ?? label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[280px] text-left">
        <div className="flex flex-col gap-1">
          <span className="font-semibold">{desc.name}</span>
          <span className="text-xs opacity-90 leading-relaxed">{desc.description}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

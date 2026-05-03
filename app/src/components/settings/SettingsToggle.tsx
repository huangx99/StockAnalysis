import { Switch } from '@/components/ui/switch'

interface SettingsToggleProps {
  label: string
  description?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}

export default function SettingsToggle({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: SettingsToggleProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <label className="font-body font-medium block" style={{ color: 'var(--text-primary)' }}>
          {label}
        </label>
        {description && (
          <p className="font-body mt-1" style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5 }}>
            {description}
          </p>
        )}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="shrink-0"
      />
    </div>
  )
}

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface SettingsSelectProps {
  label: string
  description?: string
  value: string
  options: { value: string; label: string }[]
  onValueChange: (value: string) => void
  placeholder?: string
}

export default function SettingsSelect({
  label,
  description,
  value,
  options,
  onValueChange,
  placeholder,
}: SettingsSelectProps) {
  return (
    <div>
      <label className="font-body font-medium block mb-2" style={{ color: 'var(--text-primary)' }}>
        {label}
      </label>
      {description && (
        <p className="font-body mb-3" style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5 }}>
          {description}
        </p>
      )}
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger
          className="w-full max-w-[480px] h-10"
          style={{
            backgroundColor: 'var(--bg-base)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-primary)',
          }}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent
          style={{
            backgroundColor: 'var(--bg-elevated)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          {options.map((opt) => (
            <SelectItem
              key={opt.value}
              value={opt.value}
              className="cursor-pointer focus:bg-bg-surface-hover"
              style={{ color: 'var(--text-primary)' }}
            >
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

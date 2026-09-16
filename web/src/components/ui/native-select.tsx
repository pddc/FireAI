import * as React from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface NativeSelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface Props extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  value: string
  onValueChange: (value: string) => void
  options: NativeSelectOption[]
  placeholder?: string
}

/**
 * Styled native <select>. Uses the OS picker on phones and never needs
 * positioning logic, so it is the default select control in FireAI.
 */
export function NativeSelect({ value, onValueChange, options, placeholder, className, ...props }: Props) {
  return (
    <div className={cn('relative', className)}>
      <select
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className="h-8 w-full appearance-none rounded-lg border border-input bg-transparent py-1 pr-8 pl-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50"
        {...props}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
}

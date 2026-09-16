import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import type { Units } from '@/types/state'
import { unitLabel } from '@/lib/format'

interface Props {
  value: number
  onChange: (v: number) => void
  units: Units
  min: number
  max: number
  step?: number
  label?: string
}

/** Big tappable temperature picker: +/- buttons plus a slider. */
export function TempStepper({ value, onChange, units, min, max, step, label }: Props) {
  const s = step ?? (units === 'C' ? 1 : 5)
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  return (
    <div className="space-y-3">
      {label && <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>}
      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="outline" size="icon-lg" className="size-12 rounded-full" onClick={() => onChange(clamp(value - s))} aria-label="Decrease">
          <Minus className="size-5" />
        </Button>
        <div className="text-center">
          <span className="text-5xl font-semibold tabular leading-none">{units === 'C' ? value.toFixed(0) : value}</span>
          <span className="ml-1 text-lg text-muted-foreground">{unitLabel(units)}</span>
        </div>
        <Button type="button" variant="outline" size="icon-lg" className="size-12 rounded-full" onClick={() => onChange(clamp(value + s))} aria-label="Increase">
          <Plus className="size-5" />
        </Button>
      </div>
      <Slider min={min} max={max} step={s} value={[value]} onValueChange={(v) => onChange(clamp(Array.isArray(v) ? v[0] : (v as number)))} />
    </div>
  )
}

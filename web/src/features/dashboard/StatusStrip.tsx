import { Fan, Flame, Cog, Zap, Package } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { useNow } from '@/hooks/useNow'
import { fmtClock } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { GrillState } from '@/types/state'

function OutputChip({ icon: Icon, label, on, extra }: { icon: React.ElementType; label: string; on?: boolean; extra?: string }) {
  return (
    <div className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', on ? 'bg-ember-soft text-ember' : 'bg-muted text-muted-foreground')}>
      <Icon className={cn('size-3.5', on && label === 'Fan' && 'animate-spin [animation-duration:1.5s]')} />
      {label}
      {extra && <span className="opacity-70">{extra}</span>}
    </div>
  )
}

/** Phase countdown (startup / shutdown / prime / lid pause), output indicators, hopper level. */
export function StatusStrip({ state }: { state: GrillState }) {
  const now = useNow(1000)
  const o = state.outputs
  let phase: { label: string; remaining: number; total: number } | null = null
  if ((state.mode === 'Startup' || state.mode === 'Reignite') && state.startup.start_time) {
    const total = state.startup.duration
    phase = { label: state.mode === 'Reignite' ? 'Re-igniting' : 'Starting up', remaining: state.startup.start_time + total - now, total }
  } else if (state.mode === 'Shutdown' && state.startup.start_time) {
    const total = state.shutdown_duration
    phase = { label: 'Burning off', remaining: state.startup.start_time + total - now, total }
  } else if (state.mode === 'Prime' && state.prime.duration) {
    phase = { label: `Priming ${state.prime.amount} g`, remaining: state.startup.start_time + state.prime.duration - now, total: state.prime.duration }
  } else if (state.lid_open.detected && state.lid_open.end_time) {
    phase = { label: 'Lid open · paused', remaining: state.lid_open.end_time - now, total: 0 }
  }
  const pct = phase && phase.total > 0 ? Math.min(100, Math.max(0, (1 - phase.remaining / phase.total) * 100)) : null

  return (
    <Card>
      <CardContent className="space-y-3 p-3">
        {phase && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{phase.label}</span>
              <span className="tabular text-muted-foreground">{fmtClock(Math.max(0, phase.remaining))}</span>
            </div>
            {pct !== null && (
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-ember transition-[width] duration-1000" style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <OutputChip icon={Fan} label="Fan" on={o.fan} extra={o.pwm != null && o.fan ? `${Math.round(o.pwm)}%` : undefined} />
          <OutputChip icon={Cog} label="Auger" on={o.auger} />
          <OutputChip icon={Flame} label="Igniter" on={o.igniter} />
          <OutputChip icon={Zap} label="Power" on={o.power} />
          {state.p_mode != null && (state.mode === 'Smoke' || state.mode === 'Startup') && (
            <span className="ml-auto text-xs text-muted-foreground">P-Mode {state.p_mode}</span>
          )}
          {state.hopper.enabled && state.hopper.level != null && (
            <span className={cn('ml-auto flex items-center gap-1 text-xs', state.hopper.level < 20 ? 'text-warn' : 'text-muted-foreground')}>
              <Package className="size-3.5" /> {state.hopper.level}% {state.hopper.pellets && <span className="hidden sm:inline">· {state.hopper.pellets}</span>}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

import { useState } from 'react'
import { Bell, BellOff, BatteryLow, Unplug } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { TempGauge } from '@/components/gauge/TempGauge'
import { fmtTemp, fmtRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { GrillState, NotifyEntry, ProbeMeta } from '@/types/state'
import { NotifySheet } from './NotifySheet'

interface Props {
  state: GrillState
  probe: ProbeMeta
  size?: 'lg' | 'md'
}

const FOOD_COLORS = ['var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']

export function probeColor(state: GrillState, probe: ProbeMeta) {
  if (probe.color) return probe.color
  if (probe.type === 'Primary') return 'var(--ember)'
  const foods = state.probes.filter((p) => p.type === 'Food')
  return FOOD_COLORS[foods.findIndex((p) => p.label === probe.label) % FOOD_COLORS.length]
}

export function ProbeCard({ state, probe, size = 'md' }: Props) {
  const [open, setOpen] = useState(false)
  const isPrimary = probe.type === 'Primary'
  const temp = isPrimary ? state.temps.primary[probe.label] : state.temps.food[probe.label]
  const notify = state.notify.find((n): n is NotifyEntry => n.label === probe.label && n.type === 'probe')
  const target = isPrimary && state.mode === 'Hold' ? state.setpoint : notify?.req ? notify.target : null
  const max = isPrimary ? state.dashboard?.max_primary_temp ?? (state.units === 'F' ? 600 : 315) : state.dashboard?.max_food_temp ?? (state.units === 'F' ? 300 : 150)
  const min = state.units === 'F' ? 0 : -20
  const statusBucket = isPrimary ? state.probe_status.P : state.probe_status.F
  const devStatus = (statusBucket?.[probe.label]?.status ?? {}) as { connected?: boolean; battery_percentage?: number | null; last_report?: number }
  const disconnected = devStatus.connected === false
  const battery = devStatus.battery_percentage
  const eta = notify?.req && notify.eta ? notify.eta : null
  // Like PiFire's dashboard: dashes while stopped, so a stale 0 is never mistaken for a reading.
  const stopped = state.mode === 'Stop' || state.mode === 'Error'
  const shown = stopped ? null : temp
  const color = probeColor(state, probe)
  const gaugeSize = size === 'lg' ? 200 : 150

  return (
    <>
      <Card
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => e.key === 'Enter' && setOpen(true)}
        className={cn(
          'relative flex cursor-pointer flex-col items-center gap-1 p-4 transition-colors hover:bg-card/80 focus-visible:ring-2 focus-visible:ring-ring outline-none',
          isPrimary && 'sm:col-span-2 lg:col-span-1',
        )}
      >
        <div className="flex w-full items-center justify-between">
          <span className="truncate text-sm font-medium">{probe.name}</span>
          <span className="flex items-center gap-1 text-muted-foreground">
            {battery != null && battery < 20 && <BatteryLow className="size-4 text-warn" />}
            {disconnected && <Unplug className="size-4 text-destructive" />}
            {notify?.req ? <Bell className="size-4 text-ember" /> : <BellOff className="size-4 opacity-40" />}
          </span>
        </div>
        <TempGauge value={shown ?? null} min={min} max={max} target={target} color={color} size={gaugeSize}>
          <div className={cn('font-semibold tabular leading-none', size === 'lg' ? 'text-5xl' : 'text-4xl')}>
            {shown == null ? '---' : fmtTemp(shown, state.units, { unit: false })}
            <span className="ml-0.5 align-top text-lg text-muted-foreground">°</span>
          </div>
          {target ? (
            <div className="mt-1 text-xs text-muted-foreground">
              {isPrimary && state.mode === 'Hold' ? 'set ' : 'target '}
              <span className="font-medium text-foreground">{fmtTemp(target, state.units)}</span>
            </div>
          ) : (
            <div className="mt-1 text-xs text-muted-foreground">{isPrimary ? 'pit' : 'no target'}</div>
          )}
        </TempGauge>
        <div className="h-4 text-xs text-muted-foreground">
          {eta ? `ETA ${fmtRelative(eta * 1 + Date.now() / 1000).replace(' ago', '')}` : disconnected && devStatus.last_report ? `last ${fmtRelative(devStatus.last_report)}` : ''}
        </div>
      </Card>
      <NotifySheet open={open} onOpenChange={setOpen} state={state} probe={probe} />
    </>
  )
}

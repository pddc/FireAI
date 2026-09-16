import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useCommand } from '@/hooks/useCommand'
import type { GrillState, NotifyEntry, ProbeMeta } from '@/types/state'
import { TempStepper } from './TempStepper'
import { fmtTemp } from '@/lib/format'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  state: GrillState
  probe: ProbeMeta
}

function find(state: GrillState, label: string, type: NotifyEntry['type']) {
  return state.notify.find((n) => n.label === label && n.type === type)
}

/** Per-probe notification target + on-target actions, plus high/low limits. */
export function NotifySheet({ open, onOpenChange, state, probe }: Props) {
  const { run, busy } = useCommand()
  const isPrimary = probe.type === 'Primary'
  const notify = find(state, probe.label, 'probe')
  const high = find(state, probe.label, 'probe_limit_high')
  const low = find(state, probe.label, 'probe_limit_low')
  const units = state.units
  const max = units === 'F' ? (isPrimary ? 600 : 300) : isPrimary ? 315 : 150
  const defaultTarget = units === 'F' ? (isPrimary ? 225 : 165) : isPrimary ? 107 : 74

  const [target, setTarget] = useState(notify?.target || defaultTarget)
  const [shutdown, setShutdown] = useState(!!notify?.shutdown)
  const [keepWarm, setKeepWarm] = useState(!!notify?.keep_warm)
  const [highT, setHighT] = useState(high?.target || max)
  const [lowT, setLowT] = useState(low?.target || 0)

  useEffect(() => {
    if (open) {
      setTarget(notify?.target || defaultTarget)
      setShutdown(!!notify?.shutdown)
      setKeepWarm(!!notify?.keep_warm)
      setHighT(high?.target || max)
      setLowT(low?.target || 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const arm = async () => {
    await run('notify.set', { label: probe.label, kind: 'probe', req: true, target, shutdown, keep_warm: keepWarm }, { success: `Alert set at ${fmtTemp(target, units)}` })
    onOpenChange(false)
  }
  const disarm = async () => {
    await run('notify.set', { label: probe.label, kind: 'probe', req: false })
    onOpenChange(false)
  }
  const setLimit = async (kind: 'probe_limit_high' | 'probe_limit_low', req: boolean, t: number) => {
    await run('notify.set', { label: probe.label, kind, req, target: t > 0 ? t : undefined })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[90dvh] overflow-y-auto rounded-t-2xl sm:max-w-md pb-safe">
        <SheetHeader>
          <SheetTitle>{probe.name}</SheetTitle>
          <SheetDescription>
            Now {fmtTemp(isPrimary ? state.temps.primary[probe.label] : state.temps.food[probe.label], units)} · notify when the probe reaches the target.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-4">
          <TempStepper value={target} onChange={setTarget} units={units} min={units === 'F' ? 32 : 0} max={max} label="Target" />

          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="nshutdown" className="text-sm">Shutdown on target</Label>
              <Switch id="nshutdown" checked={shutdown} onCheckedChange={(c) => { setShutdown(c); if (c) setKeepWarm(false) }} />
            </label>
            <label className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="nkeep" className="text-sm">Keep warm</Label>
              <Switch id="nkeep" checked={keepWarm} onCheckedChange={(c) => { setKeepWarm(c); if (c) setShutdown(false) }} />
            </label>
          </div>

          <div className="flex gap-2">
            <Button className="flex-1" size="lg" onClick={arm} disabled={!!busy}>
              {busy === 'notify.set' && <Loader2 className="size-4 animate-spin" />} {notify?.req ? 'Update alert' : 'Set alert'}
            </Button>
            {notify?.req && (
              <Button variant="outline" size="lg" onClick={disarm} disabled={!!busy}>
                Clear
              </Button>
            )}
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Limits</div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <div className="text-sm">High limit</div>
                <div className="text-xs text-muted-foreground">Alert above {fmtTemp(highT, units)}</div>
              </div>
              <input
                type="number"
                className="w-20 rounded-md border bg-background px-2 py-1 text-right text-sm tabular"
                value={highT}
                onChange={(e) => setHighT(Number(e.target.value))}
                onBlur={() => high?.req && setLimit('probe_limit_high', true, highT)}
              />
              <Switch checked={!!high?.req} onCheckedChange={(c) => setLimit('probe_limit_high', c, highT)} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <div className="text-sm">Low limit</div>
                <div className="text-xs text-muted-foreground">Alert below {fmtTemp(lowT, units)}</div>
              </div>
              <input
                type="number"
                className="w-20 rounded-md border bg-background px-2 py-1 text-right text-sm tabular"
                value={lowT}
                onChange={(e) => setLowT(Number(e.target.value))}
                onBlur={() => low?.req && setLimit('probe_limit_low', true, lowT)}
              />
              <Switch checked={!!low?.req} onCheckedChange={(c) => setLimit('probe_limit_low', c, lowT)} />
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

import { useState } from 'react'
import { Flame, Cloud, Thermometer, Power, Eye, Wrench, Loader2, Square, RotateCcw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useCommand } from '@/hooks/useCommand'
import { cn } from '@/lib/utils'
import { fmtTemp } from '@/lib/format'
import type { GrillState } from '@/types/state'
import { TempStepper } from './TempStepper'

interface Props {
  state: GrillState
}

function ModeButton({ icon: Icon, label, active, onClick, disabled, tone = 'default' }: { icon: React.ElementType; label: string; active?: boolean; onClick: () => void; disabled?: boolean; tone?: 'default' | 'danger' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-xs font-medium transition-all active:scale-[0.98] disabled:opacity-40',
        active ? 'border-ember bg-ember-soft text-ember' : 'border-border bg-card hover:bg-muted',
        tone === 'danger' && !active && 'hover:border-destructive/50 hover:text-destructive',
      )}
    >
      <Icon className="size-5" />
      {label}
    </button>
  )
}

export function ModeControls({ state }: Props) {
  const { run, busy } = useCommand()
  const [holdOpen, setHoldOpen] = useState(false)
  const [primeOpen, setPrimeOpen] = useState(false)
  const [confirm, setConfirm] = useState<null | 'stop' | 'shutdown'>(null)
  const units = state.units
  const [holdTemp, setHoldTemp] = useState(state.setpoint || (units === 'F' ? 225 : 107))
  const [primeAmount, setPrimeAmount] = useState(10)
  const [primeStart, setPrimeStart] = useState(true)

  const mode = state.mode
  const stopped = mode === 'Stop' || mode === 'Error'
  const cooking = ['Startup', 'Reignite', 'Smoke', 'Hold'].includes(mode)
  const isBusy = !!busy

  const openHold = () => {
    setHoldTemp(state.setpoint || (units === 'F' ? 225 : 107))
    setHoldOpen(true)
  }
  const applyHold = async () => {
    await run('mode.hold', { setpoint: holdTemp }, { success: `Holding at ${fmtTemp(holdTemp, units)}` })
    setHoldOpen(false)
  }
  const applyPrime = async () => {
    await run('mode.prime', { amount: primeAmount, next_mode: primeStart ? 'Startup' : 'Stop' })
    setPrimeOpen(false)
  }
  const doConfirm = async () => {
    if (confirm === 'stop') await run('mode.stop')
    if (confirm === 'shutdown') await run('mode.shutdown')
    setConfirm(null)
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-3">
        <div className="grid grid-cols-4 gap-2">
          {stopped ? (
            <>
              <ModeButton icon={Flame} label="Start" onClick={() => run('mode.startup')} disabled={isBusy} />
              <ModeButton icon={Sparkles} label="Prime" onClick={() => setPrimeOpen(true)} disabled={isBusy} />
              <ModeButton icon={Eye} label="Monitor" onClick={() => run('mode.monitor')} disabled={isBusy} />
              <ModeButton icon={Wrench} label="Manual" onClick={() => run('mode.manual')} disabled={isBusy} />
            </>
          ) : (
            <>
              <ModeButton icon={Cloud} label="Smoke" active={mode === 'Smoke'} onClick={() => run('mode.smoke')} disabled={isBusy || !cooking} />
              <ModeButton icon={Thermometer} label={mode === 'Hold' ? fmtTemp(state.setpoint, units) : 'Hold'} active={mode === 'Hold'} onClick={openHold} disabled={isBusy || !cooking} />
              <ModeButton icon={Power} label="Shutdown" active={mode === 'Shutdown'} onClick={() => setConfirm('shutdown')} disabled={isBusy || mode === 'Shutdown'} />
              <ModeButton icon={Square} label="Stop" tone="danger" onClick={() => setConfirm('stop')} disabled={isBusy} />
            </>
          )}
        </div>

        {(mode === 'Smoke' || mode === 'Hold') && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <label className="flex items-center gap-2">
              <Switch checked={state.smoke_plus} onCheckedChange={(c) => run('smoke_plus', { enabled: c })} />
              <Label className="text-sm">Smoke+</Label>
            </label>
            {mode === 'Hold' && (
              <Button variant={state.lid_open.detected ? 'default' : 'outline'} size="sm" onClick={() => run('lid_open.toggle')} disabled={isBusy}>
                {state.lid_open.detected ? 'Resume' : 'Lid open'}
              </Button>
            )}
            {mode === 'Hold' && (
              <Button variant="ghost" size="sm" onClick={openHold} disabled={isBusy}>
                <Thermometer className="size-4" /> Change setpoint
              </Button>
            )}
          </div>
        )}
        {mode === 'Error' && (
          <div className="flex items-center gap-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <span className="flex-1">The controller stopped on a safety error.</span>
            <Button variant="outline" size="sm" onClick={() => run('mode.reignite')} disabled={isBusy}>
              <RotateCcw className="size-4" /> Re-ignite
            </Button>
            <Button variant="outline" size="sm" onClick={() => run('mode.stop')} disabled={isBusy}>
              Clear
            </Button>
          </div>
        )}
        {isBusy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> sending…
          </div>
        )}
      </CardContent>

      {/* Hold setpoint sheet */}
      <Sheet open={holdOpen} onOpenChange={setHoldOpen}>
        <SheetContent side="bottom" className="mx-auto rounded-t-2xl sm:max-w-md pb-safe">
          <SheetHeader>
            <SheetTitle>Hold temperature</SheetTitle>
            <SheetDescription>The controller will hold the pit at this setpoint.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-4">
            <TempStepper value={holdTemp} onChange={setHoldTemp} units={units} min={units === 'F' ? 100 : 40} max={units === 'F' ? 550 : 290} />
            <div className="grid grid-cols-4 gap-2">
              {(units === 'F' ? [180, 225, 250, 275] : [80, 107, 120, 135]).map((t) => (
                <Button key={t} variant="outline" size="sm" onClick={() => setHoldTemp(t)}>
                  {fmtTemp(t, units)}
                </Button>
              ))}
            </div>
            <Button size="lg" className="w-full" onClick={applyHold} disabled={isBusy}>
              {busy === 'mode.hold' && <Loader2 className="size-4 animate-spin" />} Hold at {fmtTemp(holdTemp, units)}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Prime sheet */}
      <Sheet open={primeOpen} onOpenChange={setPrimeOpen}>
        <SheetContent side="bottom" className="mx-auto rounded-t-2xl sm:max-w-md pb-safe">
          <SheetHeader>
            <SheetTitle>Prime the firepot</SheetTitle>
            <SheetDescription>Feeds pellets into the firepot before ignition.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-4">
            <div className="grid grid-cols-4 gap-2">
              {[10, 20, 30, 50].map((g) => (
                <Button key={g} variant={primeAmount === g ? 'default' : 'outline'} onClick={() => setPrimeAmount(g)}>
                  {g} g
                </Button>
              ))}
            </div>
            <label className="flex items-center justify-between rounded-lg border p-3">
              <Label className="text-sm">Start up after priming</Label>
              <Switch checked={primeStart} onCheckedChange={setPrimeStart} />
            </label>
            <Button size="lg" className="w-full" onClick={applyPrime} disabled={isBusy}>
              Prime {primeAmount} g{primeStart ? ' & start' : ''}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Confirm stop / shutdown */}
      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm === 'stop' ? 'Stop the grill?' : 'Shut down?'}</DialogTitle>
            <DialogDescription>
              {confirm === 'stop'
                ? 'All outputs turn off immediately. Pellets left in the firepot will not be burned off.'
                : `The auger stops and the fan runs for ${Math.round(state.shutdown_duration / 60) || 4} minutes to burn off remaining pellets.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant={confirm === 'stop' ? 'destructive' : 'default'} onClick={doConfirm}>
              {confirm === 'stop' ? 'Stop now' : 'Shut down'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

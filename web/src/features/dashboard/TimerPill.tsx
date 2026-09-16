import { useState } from 'react'
import { Timer, Pause, Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useGrillState } from '@/stores/grill'
import { useCommand } from '@/hooks/useCommand'
import { useNow } from '@/hooks/useNow'
import { fmtClock } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Top-bar cook timer: shows remaining time, opens a sheet to start/pause/stop. */
export function TimerPill() {
  const state = useGrillState()
  const now = useNow(1000)
  const { run, busy } = useCommand()
  const [open, setOpen] = useState(false)
  const [h, setH] = useState(0)
  const [m, setM] = useState(30)
  const [shutdown, setShutdown] = useState(false)
  const [keepWarm, setKeepWarm] = useState(false)

  if (!state) return null
  const t = state.timer
  const running = t.start > 0 && t.paused === 0
  const paused = t.paused > 0
  const remaining = paused ? t.end - t.paused : running ? t.end - now : 0

  const start = async () => {
    const seconds = h * 3600 + m * 60
    if (seconds <= 0) return
    await run('timer.start', { seconds, shutdown, keep_warm: keepWarm })
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm tabular transition-colors',
          running ? 'border-ember/40 bg-ember-soft text-ember' : paused ? 'border-warn/40 text-warn' : 'border-border text-muted-foreground hover:bg-muted',
        )}
        aria-label="Cook timer"
      >
        <Timer className="size-4" />
        {running || paused ? fmtClock(remaining) : <span className="hidden sm:inline">Timer</span>}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="mx-auto rounded-t-2xl sm:max-w-md pb-safe">
          <SheetHeader>
            <SheetTitle>Cook timer</SheetTitle>
            <SheetDescription>{running ? 'Running' : paused ? 'Paused' : 'Set a countdown and optional action when it ends.'}</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-4">
            {running || paused ? (
              <div className="space-y-4">
                <div className="text-center text-6xl font-semibold tabular">{fmtClock(remaining)}</div>
                <div className="grid grid-cols-2 gap-2">
                  {running ? (
                    <Button size="lg" variant="outline" onClick={() => run('timer.pause')} disabled={!!busy}>
                      <Pause className="size-4" /> Pause
                    </Button>
                  ) : (
                    <Button size="lg" onClick={() => run('timer.resume')} disabled={!!busy}>
                      <Play className="size-4" /> Resume
                    </Button>
                  )}
                  <Button size="lg" variant="destructive" onClick={() => run('timer.stop').then(() => setOpen(false))} disabled={!!busy}>
                    <Square className="size-4" /> Stop
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">Hours</span>
                    <input type="number" min={0} max={23} value={h} onChange={(e) => setH(Math.max(0, Number(e.target.value)))} className="w-full rounded-lg border bg-background px-3 py-3 text-center text-3xl tabular" />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">Minutes</span>
                    <input type="number" min={0} max={59} value={m} onChange={(e) => setM(Math.min(59, Math.max(0, Number(e.target.value))))} className="w-full rounded-lg border bg-background px-3 py-3 text-center text-3xl tabular" />
                  </label>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[15, 30, 60, 120].map((mins) => (
                    <Button key={mins} variant="outline" size="sm" onClick={() => { setH(Math.floor(mins / 60)); setM(mins % 60) }}>
                      {mins < 60 ? `${mins}m` : `${mins / 60}h`}
                    </Button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex items-center justify-between rounded-lg border p-3">
                    <Label className="text-sm">Shutdown when done</Label>
                    <Switch checked={shutdown} onCheckedChange={(c) => { setShutdown(c); if (c) setKeepWarm(false) }} />
                  </label>
                  <label className="flex items-center justify-between rounded-lg border p-3">
                    <Label className="text-sm">Keep warm</Label>
                    <Switch checked={keepWarm} onCheckedChange={(c) => { setKeepWarm(c); if (c) setShutdown(false) }} />
                  </label>
                </div>
                <Button size="lg" className="w-full" onClick={start} disabled={!!busy || h * 60 + m === 0}>
                  Start timer
                </Button>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Check, Flame, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { post } from '@/lib/api'
import { useCommand } from '@/hooks/useCommand'
import { cn } from '@/lib/utils'
import { ModuleSection, useHardwareForm, type Kind } from './HardwarePage'

const STEPS = [
  { id: 'welcome', title: 'Welcome' },
  { id: 'grillplatform', title: 'Board' },
  { id: 'display', title: 'Display' },
  { id: 'distance', title: 'Pellet sensor' },
  { id: 'probes', title: 'Units & probes' },
  { id: 'finish', title: 'Finish' },
] as const
type StepId = (typeof STEPS)[number]['id']

/** Guided first-run configuration (PiFire's wizard): the same hardware form, one section per step. */
export function SetupWizardPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { run } = useCommand()
  const form = useHardwareForm({ boardMapDefault: true })
  const [step, setStep] = useState<StepId>('welcome')
  const [showPins, setShowPins] = useState(false)
  const idx = STEPS.findIndex((s) => s.id === step)
  const skip = useMutation({
    mutationFn: () => post('/api/v1/hardware/wizard/dismiss'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hardware'] }); navigate('/', { replace: true }) },
  })

  if (!form.ready) return <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
  const cat = form.cat.data!
  const board = cat.boards[form.sel.grillplatform]
  const saved = !!form.result
  const go = (d: 1 | -1) => setStep(STEPS[Math.min(STEPS.length - 1, Math.max(0, idx + d))].id)

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <div className="flex items-center gap-2">
        <Flame className="size-6 text-ember" />
        <h1 className="text-xl font-semibold tracking-tight">Set up FireAI</h1>
      </div>
      <ol className="flex flex-wrap gap-1 text-xs" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.id} className={cn('rounded-full px-2.5 py-1', i === idx ? 'bg-ember text-white' : i < idx ? 'bg-ember-soft text-ember' : 'bg-muted text-muted-foreground')}>
            {i + 1}. {s.title}
          </li>
        ))}
      </ol>

      {step === 'welcome' && (
        <Card>
          <CardHeader>
            <CardTitle>Tell FireAI about your grill</CardTitle>
            <CardDescription>Four short steps: the controller board, the display, the pellet sensor and your probes. Everything can be changed later under Settings → Hardware and Settings → Probes.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button onClick={() => go(1)}>Get started <ArrowRight className="size-4" /></Button>
            <Button variant="ghost" onClick={() => skip.mutate()} disabled={skip.isPending}>Skip, I'll configure it myself</Button>
          </CardContent>
        </Card>
      )}

      {(step === 'grillplatform' || step === 'display' || step === 'distance') && (
        <>
          <ModuleSection {...form.sectionProps(step as Kind, showPins)} />
          {step === 'grillplatform' && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Show pin assignments <Switch checked={showPins} onCheckedChange={setShowPins} />
            </label>
          )}
        </>
      )}

      {step === 'probes' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Units &amp; probes</CardTitle>
            <CardDescription>Probe devices and profiles are edited in detail under Settings → Probes after setup.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Temperature units</Label>
              <NativeSelect className="w-40" value={form.units} onValueChange={form.setUnits} options={[{ value: 'F', label: 'Fahrenheit' }, { value: 'C', label: 'Celsius' }]} />
            </div>
            {board && (
              <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div>
                  <Label className="text-sm">Start from the {board.name} default probe map</Label>
                  <p className="text-xs text-muted-foreground">{board.probe_devices.join(', ')}. Bluetooth and cloud thermometers are added afterwards.</p>
                </div>
                <Switch checked={form.useBoardMap} onCheckedChange={form.setUseBoardMap} />
              </label>
            )}
          </CardContent>
        </Card>
      )}

      {step === 'finish' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{saved ? 'Saved' : 'Review'}</CardTitle>
            <CardDescription>
              {saved
                ? form.result!.reboot_required
                  ? 'This board needs a reboot to enable its interfaces (SPI / I²C / PWM).'
                  : 'Restart the control process to load the new hardware modules.'
                : 'Apply the configuration to the grill.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              {(['grillplatform', 'display', 'distance'] as Kind[]).map((k) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k === 'grillplatform' ? 'Board' : k === 'display' ? 'Display' : 'Pellet sensor'}</dt>
                  <dd>{cat.modules[k][form.sel[k]]?.friendly_name ?? form.sel[k]}</dd>
                </div>
              ))}
              <dt className="text-muted-foreground">Units</dt>
              <dd>{form.units === 'F' ? 'Fahrenheit' : 'Celsius'}</dd>
            </dl>
            {!saved ? (
              <Button size="lg" onClick={() => form.save.mutate()} disabled={form.save.isPending}>
                {form.save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save & apply
              </Button>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => run(form.result!.reboot_required ? 'system.reboot' : 'system.restart_control', undefined, { success: form.result!.reboot_required ? 'Rebooting' : 'Restarting control' })}>
                  {form.result!.reboot_required ? 'Reboot now' : 'Restart control now'}
                </Button>
                <Button variant="outline" onClick={() => navigate('/settings/probes', { replace: true })}>Configure probes</Button>
                <Button variant="ghost" onClick={() => navigate('/', { replace: true })}>Go to the dashboard</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {step !== 'welcome' && !saved && (
        <div className="flex justify-between">
          <Button variant="outline" onClick={() => go(-1)}><ArrowLeft className="size-4" /> Back</Button>
          {step !== 'finish' && <Button onClick={() => go(1)}>Next <ArrowRight className="size-4" /></Button>}
        </div>
      )}
    </div>
  )
}

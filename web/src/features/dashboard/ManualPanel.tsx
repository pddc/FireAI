import { useState } from 'react'
import { Fan, Flame, Cog, Zap } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { useCommand } from '@/hooks/useCommand'
import type { GrillState } from '@/types/state'

const OUTPUTS = [
  { key: 'power', label: 'Power', icon: Zap },
  { key: 'fan', label: 'Fan', icon: Fan },
  { key: 'auger', label: 'Auger', icon: Cog },
  { key: 'igniter', label: 'Igniter', icon: Flame },
] as const

/** Manual mode: direct output switches and PWM slider. */
export function ManualPanel({ state }: { state: GrillState }) {
  const { run, busy } = useCommand()
  const [pwm, setPwm] = useState(state.outputs.pwm ?? 100)
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Manual outputs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {OUTPUTS.map(({ key, label, icon: Icon }) => (
            <label key={key} className="flex items-center justify-between rounded-lg border p-3">
              <span className="flex items-center gap-2 text-sm">
                <Icon className="size-4" /> {label}
              </span>
              <Switch checked={!!state.outputs[key]} onCheckedChange={(on) => run('manual.output', { output: key, on })} disabled={!!busy} />
            </label>
          ))}
        </div>
        {state.outputs.pwm != null && (
          <div className="flex items-center gap-3 rounded-lg border p-3">
            <span className="text-sm">Fan PWM</span>
            <Slider className="flex-1" min={0} max={100} step={5} value={[pwm]} onValueChange={(v) => setPwm(Array.isArray(v) ? v[0] : (v as number))} />
            <span className="w-10 text-right text-sm tabular">{pwm}%</span>
            <Button size="sm" variant="outline" onClick={() => run('manual.pwm', { duty_cycle: pwm })} disabled={!!busy}>
              Set
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

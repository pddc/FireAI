import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { BluetoothDiagnostics } from './Bluetooth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { NativeSelect } from '@/components/ui/native-select'
import { api, get } from '@/lib/api'
import { useCommand } from '@/hooks/useCommand'

export interface DepView {
  label: string
  help: string
  options: { value: string; label: string }[] | null
  path: string
  value: string
  hidden: boolean
}
export interface ModuleView {
  id: string
  friendly_name: string
  description: string
  filename: string
  reboot_required: boolean
  settings: Record<string, DepView>
  config?: { option_name: string; option_friendly_name: string; option_description: string; option_type: string; list_values?: unknown[]; list_labels?: string[]; default: unknown; value: unknown; hidden?: boolean }[]
}
export interface Catalogue {
  modules: { grillplatform: Record<string, ModuleView>; display: Record<string, ModuleView>; distance: Record<string, ModuleView> }
  boards: Record<string, { id: string; name: string; description: string; probe_devices: string[] }>
  current: { grillplatform: string; display: string; distance: string; units: string; real_hw: boolean; first_time_setup: boolean }
}

export type Kind = 'grillplatform' | 'display' | 'distance'
export const KIND_LABEL: Record<Kind, { title: string; desc: string }> = {
  grillplatform: { title: 'Controller board', desc: 'Which PiFire board (or custom wiring) drives the relays and fan.' },
  display: { title: 'Display', desc: 'Screen and input hardware attached to the Pi.' },
  distance: { title: 'Pellet level sensor', desc: 'Distance sensor in the hopper lid, if any.' },
}

export function ModuleSection({ kind, cat, selected, onSelect, values, onValue, config, onConfig, showAdvanced }: {
  kind: Kind
  cat: Catalogue
  selected: string
  onSelect: (id: string) => void
  values: Record<string, string>
  onValue: (name: string, v: string) => void
  config: Record<string, unknown>
  onConfig: (name: string, v: unknown) => void
  showAdvanced: boolean
}) {
  const mods = cat.modules[kind]
  const mod = mods[selected]
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{KIND_LABEL[kind].title}</CardTitle>
        <CardDescription>{KIND_LABEL[kind].desc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <NativeSelect className="w-full" value={selected} onValueChange={onSelect} options={Object.values(mods).map((m) => ({ value: m.id, label: m.friendly_name }))} />
        {mod && <p className="text-xs text-muted-foreground">{mod.description}</p>}
        {mod &&
          Object.entries(mod.settings)
            .filter(([, d]) => showAdvanced || !d.hidden)
            .map(([name, d]) => (
              <div key={name} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                <div className="sm:max-w-md">
                  <Label className="text-sm">{d.label}</Label>
                  {d.help && <p className="text-xs text-muted-foreground">{d.help}</p>}
                </div>
                {d.options ? (
                  <NativeSelect className="w-full sm:w-56" value={values[name] ?? d.value} onValueChange={(v) => onValue(name, v)} options={d.options} />
                ) : (
                  <Input className="w-full sm:w-56" value={values[name] ?? d.value} onChange={(e) => onValue(name, e.target.value)} />
                )}
              </div>
            ))}
        {mod?.config?.filter((o) => showAdvanced || !o.hidden).map((o) => (
          <div key={o.option_name} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div className="sm:max-w-md">
              <Label className="text-sm">{o.option_friendly_name}</Label>
              {o.option_description && <p className="text-xs text-muted-foreground">{o.option_description}</p>}
            </div>
            {o.option_type === 'list' && o.list_values ? (
              <NativeSelect className="w-full sm:w-56" value={String(config[o.option_name] ?? o.value ?? o.default ?? '')} onValueChange={(v) => onConfig(o.option_name, v)} options={o.list_values.map((v, i) => ({ value: String(v), label: o.list_labels?.[i] ?? String(v) }))} />
            ) : o.option_type === 'bool' ? (
              <Switch checked={String(config[o.option_name] ?? o.value) === 'true' || (config[o.option_name] ?? o.value) === true} onCheckedChange={(c) => onConfig(o.option_name, c)} />
            ) : (
              <Input className="w-full sm:w-56" value={String(config[o.option_name] ?? o.value ?? '')} onChange={(e) => onConfig(o.option_name, e.target.value)} />
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/** Catalogue + draft selections + save, shared by Settings → Hardware and the first-run wizard. */
export function useHardwareForm(opts: { boardMapDefault?: boolean } = {}) {
  const qc = useQueryClient()
  const cat = useQuery({ queryKey: ['hardware'], queryFn: () => get<Catalogue>('/api/v1/hardware') })
  const [sel, setSel] = useState<Record<Kind, string>>({ grillplatform: '', display: '', distance: '' })
  const [vals, setVals] = useState<Record<Kind, Record<string, string>>>({ grillplatform: {}, display: {}, distance: {} })
  const [cfg, setCfg] = useState<Record<string, unknown>>({})
  const [units, setUnits] = useState('F')
  const [useBoardMap, setUseBoardMap] = useState(!!opts.boardMapDefault)
  const [result, setResult] = useState<{ reboot_required: boolean } | null>(null)

  useEffect(() => {
    if (cat.data && !sel.grillplatform) {
      setSel({ grillplatform: cat.data.current.grillplatform, display: cat.data.current.display, distance: cat.data.current.distance })
      setUnits(cat.data.current.units)
    }
  }, [cat.data, sel.grillplatform])

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        grillplatform: { id: sel.grillplatform, settings: vals.grillplatform },
        display: { id: sel.display, settings: vals.display, config: Object.keys(cfg).length ? cfg : undefined },
        distance: { id: sel.distance, settings: vals.distance },
        units,
      }
      if (useBoardMap && cat.data?.boards[sel.grillplatform]) body.board_probe_map = sel.grillplatform
      return api<{ restart_required: boolean; reboot_required: boolean }>('/api/v1/hardware', { method: 'PUT', body: JSON.stringify(body) })
    },
    onSuccess: (r) => {
      toast.success('Hardware configuration saved')
      setResult(r)
      setVals({ grillplatform: {}, display: {}, distance: {} })
      setCfg({})
      qc.invalidateQueries({ queryKey: ['hardware'] })
      qc.invalidateQueries({ queryKey: ['settings'] })
      qc.invalidateQueries({ queryKey: ['probes-config'] })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const sectionProps = (kind: Kind, showAdvanced: boolean) => ({
    kind,
    cat: cat.data!,
    selected: sel[kind],
    onSelect: (id: string) => { setSel({ ...sel, [kind]: id }); setVals({ ...vals, [kind]: {} }); if (kind === 'display') setCfg({}) },
    values: vals[kind],
    onValue: (name: string, v: string) => setVals({ ...vals, [kind]: { ...vals[kind], [name]: v } }),
    config: cfg,
    onConfig: (name: string, v: unknown) => setCfg({ ...cfg, [name]: v }),
    showAdvanced,
  })

  return { cat, sel, units, setUnits, useBoardMap, setUseBoardMap, result, save, sectionProps, ready: !!cat.data && !!sel.grillplatform }
}

/** Local-only hardware setup, replacing the legacy configuration wizard. */
export function HardwarePage() {
  const { run } = useCommand()
  const { cat, sel, units, setUnits, useBoardMap, setUseBoardMap, result, save, sectionProps, ready } = useHardwareForm()
  const [advanced, setAdvanced] = useState(false)

  if (!ready) return <Loader2 className="size-5 animate-spin text-muted-foreground" />
  const board = cat.data!.boards[sel.grillplatform]

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Hardware</h1>
          <p className="text-sm text-muted-foreground">Board, display and sensors. Changes take effect after the control process restarts.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Show pins <Switch checked={advanced} onCheckedChange={setAdvanced} />
        </label>
      </div>

      {result && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{result.reboot_required ? 'This hardware needs a reboot to enable its interfaces (SPI/I²C/PWM).' : 'Restart the control process to load the new hardware modules.'}</span>
            <Button size="sm" variant="outline" onClick={() => run(result.reboot_required ? 'system.reboot' : 'system.restart_control', undefined, { success: result.reboot_required ? 'Rebooting' : 'Restarting control' })}>
              {result.reboot_required ? 'Reboot now' : 'Restart now'}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {(['grillplatform', 'display', 'distance'] as Kind[]).map((kind) => (
        <ModuleSection key={kind} {...sectionProps(kind, advanced)} />
      ))}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Units &amp; probes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Temperature units</Label>
            <NativeSelect className="w-40" value={units} onValueChange={setUnits} options={[{ value: 'F', label: 'Fahrenheit' }, { value: 'C', label: 'Celsius' }]} />
          </div>
          {board && (
            <label className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label className="text-sm">Use the {board.name} default probe map</Label>
                <p className="text-xs text-muted-foreground">Replaces your probe devices and probes with the board defaults ({board.probe_devices.join(', ')}). Fine-tune under Settings → Probes afterwards.</p>
              </div>
              <Switch checked={useBoardMap} onCheckedChange={setUseBoardMap} />
            </label>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="lg" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save hardware configuration
        </Button>
      </div>

      <BluetoothDiagnostics />
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Trash2, Pencil, RotateCcw, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { NativeSelect } from '@/components/ui/native-select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { api, get, post } from '@/lib/api'
import { useGrill } from '@/stores/grill'

interface ModuleOpt {
  label: string
  friendly_name: string
  description: string
  type: string
  default: unknown
  hidden?: boolean
  list_labels?: string[]
  list_values?: unknown[]
  min?: number
  max?: number
  step?: number
}
interface ModuleMeta {
  friendly_name: string
  description: string
  type: string
  ports: string[]
  config: ModuleOpt[]
}
interface Device {
  device: string
  module: string
  module_filename: string
  ports: string[]
  config: Record<string, unknown>
}
interface Profile {
  id: string
  name: string
  A: number
  B: number
  C: number
}
interface Probe {
  type: 'Primary' | 'Food' | 'Aux'
  label: string
  name: string
  device: string
  port: string
  enabled: boolean
  profile: Profile
}
interface Config {
  probe_map: { probe_devices: Device[]; probe_info: Probe[] }
  profiles: Record<string, Profile>
  modules: Record<string, ModuleMeta>
  units: string
}

const toLabel = (s: string) => s.replace(/[^A-Za-z0-9]/g, '')

function DeviceConfigFields({ meta, config, onChange, probeLabels }: { meta: ModuleMeta; config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void; probeLabels: string[] }) {
  return (
    <div className="space-y-3">
      {meta.config
        .filter((o) => !o.hidden || o.label === 'transient')
        .map((o) => {
          const v = config[o.label]
          const set = (nv: unknown) => onChange({ ...config, [o.label]: nv })
          const id = `dev-${o.label}`
          let control: React.ReactNode
          if (o.label === 'probes_list') {
            const selected = Array.isArray(v) ? (v as string[]) : []
            control = (
              <div className="flex flex-wrap gap-2">
                {probeLabels.map((l) => (
                  <label key={l} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
                    <input type="checkbox" checked={selected.includes(l)} onChange={(e) => set(e.target.checked ? [...selected, l] : selected.filter((x) => x !== l))} /> {l}
                  </label>
                ))}
              </div>
            )
          } else if (o.type === 'list' && o.list_values) {
            control = (
              <NativeSelect id={id} className="w-full sm:w-64" value={String(v ?? '')} onValueChange={(nv) => set(nv)} options={o.list_values.map((val, i) => ({ value: String(val), label: o.list_labels?.[i] ?? String(val) }))} />
            )
          } else if (o.type === 'int' || o.type === 'float') {
            control = <Input id={id} type="number" min={o.min} max={o.max} step={o.step ?? (o.type === 'int' ? 1 : 'any')} value={String(v ?? '')} onChange={(e) => set(o.type === 'int' ? parseInt(e.target.value || '0', 10) : parseFloat(e.target.value || '0'))} className="w-full sm:w-40" />
          } else if (o.type === 'password') {
            control = <Input id={id} type="password" value={String(v ?? '')} onChange={(e) => set(e.target.value)} placeholder={v === '***' ? 'saved' : ''} className="w-full sm:w-64" />
          } else if (o.type === 'bool') {
            control = <Switch id={id} checked={v === true || v === 'True'} onCheckedChange={(c) => set(c)} />
          } else {
            control = <Input id={id} value={String(v ?? '')} onChange={(e) => set(e.target.value)} className="w-full sm:w-64" />
          }
          return (
            <div key={o.label} className="space-y-1">
              <Label htmlFor={id} className="text-sm">{o.friendly_name}</Label>
              {control}
              {o.description && <p className="text-xs text-muted-foreground">{o.description}</p>}
            </div>
          )
        })}
    </div>
  )
}

export function ProbesPage() {
  const qc = useQueryClient()
  const command = useGrill((s) => s.command)
  const cfg = useQuery({ queryKey: ['probes-config'], queryFn: () => get<Config>('/api/v1/probes/config') })
  const [draft, setDraft] = useState<Config['probe_map'] | null>(null)
  const [deviceSheet, setDeviceSheet] = useState<{ mode: 'add' | 'edit'; device: Device; module?: string } | null>(null)
  const [probeSheet, setProbeSheet] = useState<{ index: number | null; probe: Probe } | null>(null)
  const [profileSheet, setProfileSheet] = useState<Profile | null>(null)
  const [restartNeeded, setRestartNeeded] = useState(false)
  const [modulePicker, setModulePicker] = useState(false)

  useEffect(() => {
    if (cfg.data && !draft) setDraft(structuredClone(cfg.data.probe_map))
  }, [cfg.data, draft])

  const save = useMutation({
    mutationFn: async (pm: Config['probe_map']) => api<{ restart_required: boolean }>('/api/v1/probes/config', { method: 'PUT', body: JSON.stringify({ probe_map: pm }) }),
    onSuccess: (r) => {
      toast.success('Probe configuration saved')
      setRestartNeeded(r.restart_required)
      setDraft(null)
      qc.invalidateQueries({ queryKey: ['probes-config'] })
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const saveProfile = useMutation({
    mutationFn: (p: Profile | Omit<Profile, 'id'>) => api<Profile>('/api/v1/probes/profiles', { method: 'PUT', body: JSON.stringify(p) }),
    onSuccess: () => {
      toast.success('Profile saved')
      setProfileSheet(null)
      setDraft(null)
      qc.invalidateQueries({ queryKey: ['probes-config'] })
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const deleteProfile = useMutation({
    mutationFn: (id: string) => api(`/api/v1/probes/profiles/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDraft(null)
      qc.invalidateQueries({ queryKey: ['probes-config'] })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  if (!cfg.data || !draft) return <Loader2 className="size-5 animate-spin text-muted-foreground" />
  const { modules, profiles } = cfg.data
  const dirty = JSON.stringify(draft) !== JSON.stringify(cfg.data.probe_map)
  const probeLabels = draft.probe_info.map((p) => p.label)

  const addDevice = async (module: string) => {
    const tmpl = await post<Device>('/api/v1/probes/devices/template', { module })
    setDeviceSheet({ mode: 'add', device: tmpl, module })
  }
  const commitDevice = () => {
    if (!deviceSheet) return
    const d = { ...deviceSheet.device, device: toLabel(deviceSheet.device.device) }
    if (!d.device) return toast.error('Device name is required')
    if (deviceSheet.mode === 'add' && draft.probe_devices.some((x) => x.device === d.device)) return toast.error('Device name already exists')
    setDraft({
      ...draft,
      probe_devices: deviceSheet.mode === 'add' ? [...draft.probe_devices, d] : draft.probe_devices.map((x) => (x.device === deviceSheet.device.device ? d : x)),
    })
    setDeviceSheet(null)
  }
  const removeDevice = (name: string) => {
    setDraft({ probe_devices: draft.probe_devices.filter((d) => d.device !== name), probe_info: draft.probe_info.filter((p) => p.device !== name) })
  }
  const commitProbe = () => {
    if (!probeSheet) return
    const p = { ...probeSheet.probe, label: toLabel(probeSheet.probe.name) }
    if (!p.label) return toast.error('Probe name is required')
    const info = [...draft.probe_info]
    if (probeSheet.index === null) info.push(p)
    else info[probeSheet.index] = p
    setDraft({ ...draft, probe_info: info })
    setProbeSheet(null)
  }
  const usedPorts = new Set(draft.probe_info.map((p) => `${p.device}/${p.port}`))
  const firstProfile = Object.values(profiles)[0]

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Probes</h1>
          <p className="text-sm text-muted-foreground">Devices provide ports; probes map a port to a name, type and profile.</p>
        </div>
        {dirty && (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDraft(structuredClone(cfg.data!.probe_map))}><RotateCcw className="size-4" /> Discard</Button>
            <Button size="sm" onClick={() => save.mutate(draft)} disabled={save.isPending}>{save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save</Button>
          </div>
        )}
      </div>

      {restartNeeded && (
        <Alert>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>Device changes take effect after the control process restarts. Restart only when the grill is stopped.</span>
            <Button size="sm" variant="outline" onClick={() => command('system.restart_control').then(() => { setRestartNeeded(false); toast.success('Restarting control') }).catch((e) => toast.error((e as Error).message))}>Restart now</Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Devices */}
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Devices</CardTitle>
            <CardDescription>ADCs, RTD boards, Bluetooth and cloud thermometers, virtual probes.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setModulePicker(true)}>
            <Plus className="size-4" /> Add device
          </Button>
        </CardHeader>
        <CardContent className="divide-y">
          {draft.probe_devices.map((d) => (
            <div key={d.device} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{d.device}</div>
                <div className="truncate text-xs text-muted-foreground">{modules[d.module]?.friendly_name ?? d.module} · {d.ports.length} ports</div>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label="Edit device" onClick={() => setDeviceSheet({ mode: 'edit', device: structuredClone(d) })}><Pencil className="size-4" /></Button>
              <Button variant="ghost" size="icon-sm" aria-label="Remove device" onClick={() => removeDevice(d.device)}><Trash2 className="size-4 text-destructive" /></Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Probes */}
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Probes</CardTitle>
            <CardDescription>Exactly one Primary (pit) probe; any number of Food and Aux probes.</CardDescription>
          </div>
          <Button size="sm" variant="outline" disabled={!draft.probe_devices.length} onClick={() => setProbeSheet({ index: null, probe: { type: 'Food', label: '', name: '', device: draft.probe_devices[0].device, port: draft.probe_devices[0].ports[0], enabled: true, profile: firstProfile } })}>
            <Plus className="size-4" /> Add probe
          </Button>
        </CardHeader>
        <CardContent className="divide-y">
          {draft.probe_info.map((p, i) => (
            <div key={p.label + i} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {p.name} <Badge variant={p.type === 'Primary' ? 'default' : 'secondary'}>{p.type}</Badge> {!p.enabled && <Badge variant="outline">disabled</Badge>}
                </div>
                <div className="truncate text-xs text-muted-foreground">{p.device} / {p.port} · {p.profile?.name}</div>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label="Edit probe" onClick={() => setProbeSheet({ index: i, probe: structuredClone(p) })}><Pencil className="size-4" /></Button>
              <Button variant="ghost" size="icon-sm" aria-label="Remove probe" onClick={() => setDraft({ ...draft, probe_info: draft.probe_info.filter((_, j) => j !== i) })}><Trash2 className="size-4 text-destructive" /></Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Profiles */}
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Probe profiles</CardTitle>
            <CardDescription>Steinhart–Hart coefficients for thermistor probes. Use the tuner to derive new ones.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setProfileSheet({ id: '', name: '', A: 0, B: 0, C: 0 })}><Plus className="size-4" /> New profile</Button>
        </CardHeader>
        <CardContent className="divide-y">
          {Object.values(profiles).map((pr) => (
            <div key={pr.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm">{pr.name}</div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">A={pr.A} B={pr.B} C={pr.C}</div>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label="Edit profile" onClick={() => setProfileSheet({ ...pr })}><Pencil className="size-4" /></Button>
              <Button variant="ghost" size="icon-sm" aria-label="Delete profile" onClick={() => deleteProfile.mutate(pr.id)}><Trash2 className="size-4 text-destructive" /></Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Device sheet */}
      <Sheet open={!!deviceSheet} onOpenChange={(o) => !o && setDeviceSheet(null)}>
        <SheetContent side="bottom" className="mx-auto max-h-[90dvh] overflow-y-auto rounded-t-2xl sm:max-w-lg pb-safe">
          {deviceSheet && (
            <>
              <SheetHeader>
                <SheetTitle>{deviceSheet.mode === 'add' ? 'Add device' : 'Edit device'}</SheetTitle>
                <SheetDescription>{modules[deviceSheet.device.module]?.description}</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-4">
                <div className="space-y-1">
                  <Label htmlFor="devname">Device name</Label>
                  <Input id="devname" value={deviceSheet.device.device} disabled={deviceSheet.mode === 'edit'} onChange={(e) => setDeviceSheet({ ...deviceSheet, device: { ...deviceSheet.device, device: e.target.value } })} />
                </div>
                <DeviceConfigFields meta={modules[deviceSheet.device.module]} config={deviceSheet.device.config} probeLabels={probeLabels} onChange={(c) => setDeviceSheet({ ...deviceSheet, device: { ...deviceSheet.device, config: c } })} />
                <Button className="w-full" size="lg" onClick={commitDevice}>{deviceSheet.mode === 'add' ? 'Add' : 'Apply'}</Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Probe sheet */}
      <Sheet open={!!probeSheet} onOpenChange={(o) => !o && setProbeSheet(null)}>
        <SheetContent side="bottom" className="mx-auto max-h-[90dvh] overflow-y-auto rounded-t-2xl sm:max-w-lg pb-safe">
          {probeSheet && (
            <>
              <SheetHeader>
                <SheetTitle>{probeSheet.index === null ? 'Add probe' : 'Edit probe'}</SheetTitle>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-4">
                <div className="space-y-1">
                  <Label htmlFor="pname">Name</Label>
                  <Input id="pname" value={probeSheet.probe.name} onChange={(e) => setProbeSheet({ ...probeSheet, probe: { ...probeSheet.probe, name: e.target.value } })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="ptype">Type</Label>
                    <NativeSelect id="ptype" value={probeSheet.probe.type} onValueChange={(v) => setProbeSheet({ ...probeSheet, probe: { ...probeSheet.probe, type: v as Probe['type'] } })} options={[{ value: 'Primary', label: 'Primary (pit)' }, { value: 'Food', label: 'Food' }, { value: 'Aux', label: 'Aux' }]} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pprofile">Profile</Label>
                    <NativeSelect id="pprofile" value={probeSheet.probe.profile?.id ?? ''} onValueChange={(v) => setProbeSheet({ ...probeSheet, probe: { ...probeSheet.probe, profile: profiles[v] } })} options={Object.values(profiles).map((pr) => ({ value: pr.id, label: pr.name }))} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pport">Device &amp; port</Label>
                  <NativeSelect
                    id="pport"
                    value={`${probeSheet.probe.device}/${probeSheet.probe.port}`}
                    onValueChange={(v) => {
                      const [device, port] = v.split('/')
                      setProbeSheet({ ...probeSheet, probe: { ...probeSheet.probe, device, port } })
                    }}
                    options={draft.probe_devices.flatMap((d) =>
                      d.ports.map((port) => {
                        const key = `${d.device}/${port}`
                        const taken = usedPorts.has(key) && key !== `${probeSheet.probe.device}/${probeSheet.probe.port}`
                        return { value: key, label: `${d.device} / ${port}${taken ? ' (in use)' : ''}`, disabled: taken }
                      }),
                    )}
                  />
                </div>
                <label className="flex items-center justify-between rounded-lg border p-3">
                  <Label className="text-sm">Enabled</Label>
                  <Switch checked={probeSheet.probe.enabled} onCheckedChange={(c) => setProbeSheet({ ...probeSheet, probe: { ...probeSheet.probe, enabled: c } })} />
                </label>
                <Button className="w-full" size="lg" onClick={commitProbe}>{probeSheet.index === null ? 'Add' : 'Apply'}</Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Module picker */}
      <Sheet open={modulePicker} onOpenChange={setModulePicker}>
        <SheetContent side="bottom" className="mx-auto max-h-[85dvh] overflow-y-auto rounded-t-2xl sm:max-w-lg pb-safe">
          <SheetHeader>
            <SheetTitle>Add a device</SheetTitle>
            <SheetDescription>Pick the hardware or service that provides probe readings.</SheetDescription>
          </SheetHeader>
          <div className="divide-y px-4 pb-4">
            {Object.entries(modules).map(([k, m]) => (
              <button key={k} type="button" className="flex w-full flex-col items-start gap-0.5 py-3 text-left hover:text-ember" onClick={() => { setModulePicker(false); addDevice(k) }}>
                <span className="text-sm font-medium">{m.friendly_name}</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{m.description}</span>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Profile sheet */}
      <Sheet open={!!profileSheet} onOpenChange={(o) => !o && setProfileSheet(null)}>
        <SheetContent side="bottom" className="mx-auto rounded-t-2xl sm:max-w-md pb-safe">
          {profileSheet && (
            <>
              <SheetHeader>
                <SheetTitle>{profileSheet.id ? 'Edit profile' : 'New profile'}</SheetTitle>
                <SheetDescription>Coefficients from a Steinhart–Hart fit (use the tuner to compute them).</SheetDescription>
              </SheetHeader>
              <div className="space-y-3 px-4 pb-4">
                <div className="space-y-1">
                  <Label htmlFor="prname">Name</Label>
                  <Input id="prname" value={profileSheet.name} onChange={(e) => setProfileSheet({ ...profileSheet, name: e.target.value })} />
                </div>
                {(['A', 'B', 'C'] as const).map((k) => (
                  <div key={k} className="space-y-1">
                    <Label htmlFor={`pr${k}`}>{k}</Label>
                    <Input id={`pr${k}`} type="text" inputMode="decimal" value={String(profileSheet[k])} onChange={(e) => setProfileSheet({ ...profileSheet, [k]: e.target.value as unknown as number })} className="font-mono" />
                  </div>
                ))}
                <Button className="w-full" size="lg" disabled={saveProfile.isPending || !profileSheet.name} onClick={() => saveProfile.mutate({ ...(profileSheet.id ? { id: profileSheet.id } : {}), name: profileSheet.name, A: Number(profileSheet.A), B: Number(profileSheet.B), C: Number(profileSheet.C) })}>
                  Save profile
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

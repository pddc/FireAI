import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Play, Square, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { NativeSelect } from '@/components/ui/native-select'
import { api, get, post } from '@/lib/api'
import { useGrillState } from '@/stores/grill'
import { fmtTemp } from '@/lib/format'

interface Fit {
  a: number
  b: number
  c: number
  curve: { temp: number; tr: number }[]
}
interface AutoStatus {
  current_tr: number
  current_temp: number
  samples: number
  ready: boolean
  low: { temp: number; tr: number } | null
  medium: { temp: number; tr: number } | null
  high: { temp: number; tr: number } | null
}

function Coeffs({ fit, onSave }: { fit: Fit; onSave: (name: string) => void }) {
  const [name, setName] = useState('')
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="grid grid-cols-3 gap-2 font-mono text-xs">
        <div><span className="text-muted-foreground">A</span> {fit.a.toExponential(6)}</div>
        <div><span className="text-muted-foreground">B</span> {fit.b.toExponential(6)}</div>
        <div><span className="text-muted-foreground">C</span> {fit.c.toExponential(6)}</div>
      </div>
      <div className="flex gap-2">
        <Input placeholder="Profile name (e.g. My meat probe)" value={name} onChange={(e) => setName(e.target.value)} />
        <Button onClick={() => onSave(name)} disabled={!name.trim()}><Save className="size-4" /> Save as profile</Button>
      </div>
    </div>
  )
}

export function TunerPage() {
  const qc = useQueryClient()
  const state = useGrillState()
  const units = state?.units ?? 'F'
  const probes = state?.probes.filter((p) => p.enabled) ?? []
  const [manual, setManual] = useState({ t1: '', t2: '', t3: '', r1: '', r2: '', r3: '' })
  const [fit, setFit] = useState<Fit | null>(null)
  const [probe, setProbe] = useState('')
  const [reference, setReference] = useState('')
  const [running, setRunning] = useState(false)
  const [auto, setAuto] = useState<AutoStatus | null>(null)

  useEffect(() => {
    if (probes.length && !probe) {
      setProbe(probes.find((p) => p.type === 'Food')?.label ?? probes[0].label)
      setReference(probes.find((p) => p.type === 'Primary')?.label ?? probes[0].label)
    }
  }, [probes, probe])

  const trQuery = useQuery({ queryKey: ['tuner-tr'], queryFn: () => get<{ tr: Record<string, number>; tuning_mode: boolean }>('/api/v1/tuner/tr'), refetchInterval: 3000 })

  const doFit = useMutation({
    mutationFn: () => post<Fit>('/api/v1/tuner/fit', Object.fromEntries(Object.entries(manual).map(([k, v]) => [k, Number(v)]))),
    onSuccess: setFit,
    onError: (e) => toast.error((e as Error).message),
  })
  const saveProfile = useMutation({
    mutationFn: (p: { name: string; A: number; B: number; C: number }) => api('/api/v1/probes/profiles', { method: 'PUT', body: JSON.stringify(p) }),
    onSuccess: () => {
      toast.success('Profile saved — assign it under Settings → Probes')
      qc.invalidateQueries({ queryKey: ['probes-config'] })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  // Auto-tune sampling loop
  useEffect(() => {
    if (!running) return
    let cancelled = false
    const tick = async () => {
      try {
        const st = await post<AutoStatus>('/api/v1/tuner/auto/sample', { probe, reference })
        if (!cancelled) setAuto(st)
      } catch (e) {
        if (!cancelled) toast.error((e as Error).message)
      }
    }
    tick()
    const id = window.setInterval(tick, 3000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [running, probe, reference])

  const startAuto = async () => {
    await post('/api/v1/tuner/auto/start')
    setAuto(null)
    setRunning(true)
  }
  const stopAuto = async () => {
    setRunning(false)
    await post('/api/v1/tuner/auto/stop')
  }
  const fitAuto = () => {
    if (!auto?.ready || !auto.low || !auto.medium || !auto.high) return
    setManual({ t1: String(auto.high.temp), t2: String(auto.medium.temp), t3: String(auto.low.temp), r1: String(auto.high.tr), r2: String(auto.medium.tr), r3: String(auto.low.tr) })
    doFit.mutate()
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Probe tuner</h1>
        <p className="text-sm text-muted-foreground">Fit Steinhart–Hart coefficients for a thermistor probe from three known points, or automatically against a trusted reference probe.</p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Live resistance</CardTitle>
          <CardDescription>Tr values are only reported while tuning mode is on.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-sm">
          {Object.entries(trQuery.data?.tr ?? {}).map(([k, v]) => (
            <span key={k} className="rounded-full bg-muted px-3 py-1 tabular">{k}: {v ? `${v} Ω` : '—'}</span>
          ))}
          {!trQuery.data?.tuning_mode && <span className="text-xs text-muted-foreground">Tuning mode off — start auto-tune or manual sampling to see values.</span>}
        </CardContent>
      </Card>

      <Tabs defaultValue="auto">
        <TabsList>
          <TabsTrigger value="auto">Auto-tune</TabsTrigger>
          <TabsTrigger value="manual">Manual</TabsTrigger>
        </TabsList>

        <TabsContent value="auto">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Against a reference probe</CardTitle>
              <CardDescription>Put both probes in the same water bath, heat it slowly, and let this run until it has a wide enough spread.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Probe to tune</Label>
                  <NativeSelect value={probe} onValueChange={setProbe} options={probes.map((p) => ({ value: p.label, label: p.name }))} />
                </div>
                <div className="space-y-1">
                  <Label>Trusted reference</Label>
                  <NativeSelect value={reference} onValueChange={setReference} options={probes.map((p) => ({ value: p.label, label: p.name }))} />
                </div>
              </div>
              <div className="flex gap-2">
                {!running ? (
                  <Button onClick={startAuto} disabled={!probe || !reference || probe === reference}><Play className="size-4" /> Start</Button>
                ) : (
                  <Button variant="outline" onClick={stopAuto}><Square className="size-4" /> Stop</Button>
                )}
                <Button variant="default" onClick={fitAuto} disabled={!auto?.ready || doFit.isPending}>Fit from samples</Button>
              </div>
              {auto && (
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <div className="rounded-lg bg-muted/50 p-2"><div className="text-xs text-muted-foreground">Now</div>{fmtTemp(auto.current_temp, units)} · {auto.current_tr} Ω</div>
                  <div className="rounded-lg bg-muted/50 p-2"><div className="text-xs text-muted-foreground">Samples</div>{auto.samples}</div>
                  <div className="rounded-lg bg-muted/50 p-2"><div className="text-xs text-muted-foreground">Low</div>{auto.low ? `${fmtTemp(auto.low.temp, units)} · ${auto.low.tr} Ω` : '—'}</div>
                  <div className="rounded-lg bg-muted/50 p-2"><div className="text-xs text-muted-foreground">High</div>{auto.high ? `${fmtTemp(auto.high.temp, units)} · ${auto.high.tr} Ω` : '—'}</div>
                </div>
              )}
              {auto && !auto.ready && running && <p className="text-xs text-muted-foreground">Keep heating: need at least {units === 'F' ? '50°F' : '25°C'} between the lowest and highest sample.</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manual">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Three known points</CardTitle>
              <CardDescription>Temperature ({units === 'F' ? '°F' : '°C'}) and measured resistance (Ω) at ice water, warm water and boiling water work well.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(['1', '2', '3'] as const).map((i) => (
                <div key={i} className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor={`t${i}`}>Temperature {i}</Label>
                    <Input id={`t${i}`} type="number" inputMode="decimal" value={manual[`t${i}`]} onChange={(e) => setManual({ ...manual, [`t${i}`]: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`r${i}`}>Resistance {i} (Ω)</Label>
                    <Input id={`r${i}`} type="number" inputMode="decimal" value={manual[`r${i}`]} onChange={(e) => setManual({ ...manual, [`r${i}`]: e.target.value })} />
                  </div>
                </div>
              ))}
              <Button onClick={() => doFit.mutate()} disabled={doFit.isPending || Object.values(manual).some((v) => v === '')}>
                {doFit.isPending && <Loader2 className="size-4 animate-spin" />} Calculate
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {fit && <Coeffs fit={fit} onSave={(name) => saveProfile.mutate({ name, A: fit.a, B: fit.b, C: fit.c })} />}
    </div>
  )
}

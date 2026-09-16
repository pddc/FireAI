import { useQuery } from '@tanstack/react-query'
import { Download, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { downloadUrl, get } from '@/lib/api'
import { fmtDuration, fmtTemp } from '@/lib/format'
import { useGrillState } from '@/stores/grill'

export interface MetricRow {
  mode: string
  starttime: number
  endtime: number | null
  duration_s: number | null
  augerontime: number
  auger_pct: number | null
  est_usage_g: number
  fanontime: number
  smokeplus?: boolean
  primary_setpoint?: number
  p_mode?: number
  auger_cycle_time?: number
  smart_start_profile?: number | string
  startup_temp?: number
  pellet_level_start?: number
  pellet_level_end?: number
  pellet_brand_type?: string
}

const time = (ms: number | null) => (ms ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—')
const grams = (g: number) => (g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${g} g`)

/** Per-mode statistics the control loop records for the current cook (PiFire's Metrics page). */
export function MetricsPage() {
  const state = useGrillState()
  const units = state?.units ?? 'F'
  const q = useQuery({ queryKey: ['metrics'], queryFn: () => get<{ metrics: MetricRow[] }>('/api/v1/metrics'), refetchInterval: 30_000 })
  const rows = q.data?.metrics ?? []
  const totals = rows.reduce(
    (t, r) => ({ auger: t.auger + r.augerontime, pellets: t.pellets + r.est_usage_g, duration: t.duration + (r.duration_s ?? 0) }),
    { auger: 0, pellets: 0, duration: 0 },
  )

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <h1 className="text-xl font-semibold tracking-tight">Cook metrics</h1>
          <p className="text-sm text-muted-foreground">What the controller did in each mode of the current cook: auger and fan run time, estimated pellets, P-Mode and Smart Start choices.</p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Refresh" onClick={() => q.refetch()}><RefreshCw className="size-4" /></Button>
        <Button variant="outline" size="sm" nativeButton={false} render={<a href={downloadUrl('/api/v1/metrics.csv')} download />}><Download className="size-4" /> CSV</Button>
      </div>

      {rows.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Time in modes" value={fmtDuration(totals.duration)} />
          <Stat label="Auger on" value={fmtDuration(totals.auger)} />
          <Stat label="Pellets (est.)" value={grams(totals.pellets)} />
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {q.isLoading ? (
            <div className="p-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No metrics yet. They are recorded from the moment the grill starts up and reset on the next startup.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    {['Mode', 'Start', 'End', 'Duration', 'Auger on', 'Auger %', 'Pellets', 'Fan on', 'Setpoint', 'P-Mode', 'Smoke+', 'Smart Start', 'Hopper', 'Pellets loaded'].map((h) => (
                      <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r, i) => (
                    <tr key={i} className="whitespace-nowrap">
                      <td className="px-3 py-2 font-medium">{r.mode}</td>
                      <td className="px-3 py-2">{time(r.starttime)}</td>
                      <td className="px-3 py-2">{r.endtime ? time(r.endtime) : <span className="text-ember">active</span>}</td>
                      <td className="px-3 py-2 tabular">{r.duration_s != null ? fmtDuration(r.duration_s) : '—'}</td>
                      <td className="px-3 py-2 tabular">{fmtDuration(r.augerontime)}</td>
                      <td className="px-3 py-2 tabular">{r.auger_pct != null ? `${r.auger_pct}%` : '—'}</td>
                      <td className="px-3 py-2 tabular">{grams(r.est_usage_g)}</td>
                      <td className="px-3 py-2 tabular">{fmtDuration(r.fanontime)}</td>
                      <td className="px-3 py-2 tabular">{r.mode === 'Hold' && r.primary_setpoint ? fmtTemp(r.primary_setpoint, units) : '—'}</td>
                      <td className="px-3 py-2 tabular">{r.p_mode ?? '—'}</td>
                      <td className="px-3 py-2">{r.smokeplus ? 'on' : 'off'}</td>
                      <td className="px-3 py-2">{r.mode === 'Startup' && r.startup_temp ? `#${r.smart_start_profile} @ ${fmtTemp(r.startup_temp, units)}` : '—'}</td>
                      <td className="px-3 py-2 tabular">{r.pellet_level_start != null ? `${r.pellet_level_start}% → ${r.pellet_level_end ?? '…'}%` : '—'}</td>
                      <td className="px-3 py-2">{r.pellet_brand_type || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular">{value}</div>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Flag, Loader2, Palette, Pause, Play } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { TempChart, annotationsFromEvents, seriesForProbes } from '@/components/chart/TempChart'
import { useCommand } from '@/hooks/useCommand'
import { useGrill, useGrillState } from '@/stores/grill'
import { cn } from '@/lib/utils'
import type { GrillState, HistoryRow } from '@/types/state'

const RANGES = [
  { label: '15m', s: 15 * 60 },
  { label: '1h', s: 3600 },
  { label: '4h', s: 4 * 3600 },
  { label: 'All', s: 0 },
]

/** History rows → CSV the way PiFire's export does: one column per probe, setpoint and targets. */
export function historyToCsv(rows: HistoryRow[], state: GrillState): string {
  const primary = state.probes.filter((p) => p.type === 'Primary').map((p) => p.label)
  const food = state.probes.filter((p) => p.type === 'Food').map((p) => p.label)
  const name = (l: string) => state.probes.find((p) => p.label === l)?.name ?? l
  const header = ['Time', ...primary.map(name), 'Setpoint', ...food.map(name), ...food.map((l) => `${name(l)} target`)]
  const lines = rows.map((r) => [
    new Date(r.T).toISOString(),
    ...primary.map((l) => r.P?.[l] ?? ''),
    r.PSP ?? '',
    ...food.map((l) => r.F?.[l] ?? ''),
    ...food.map((l) => r.NT?.[l] ?? ''),
  ])
  return [header, ...lines].map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n') + '\n'
}

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Per-probe line colour, stored in the grill's settings (history_page.probe_config) like PiFire. */
function ColorsSheet({ open, onOpenChange, state }: { open: boolean; onOpenChange: (o: boolean) => void; state: GrillState }) {
  const { run, busy } = useCommand()
  const probes = state.probes.filter((p) => p.enabled && p.type !== 'Aux')
  const fallback = (i: number, type: string) => (type === 'Primary' ? '#f97316' : ['#38bdf8', '#a3e635', '#f472b6', '#facc15'][i % 4])
  const save = (label: string, color: string) =>
    run('settings.patch', { patch: { history_page: { probe_config: { [label]: { line_color: color } } } } }, { success: 'Colour saved' })
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto rounded-t-2xl sm:max-w-md pb-safe">
        <SheetHeader>
          <SheetTitle>Probe colours</SheetTitle>
          <SheetDescription>Used on the graph, the dashboard cards and cook files.</SheetDescription>
        </SheetHeader>
        <div className="space-y-2 px-4 pb-4">
          {probes.map((p, i) => (
            <label key={p.label} className="flex items-center justify-between rounded-lg border px-3 py-2">
              <Label className="text-sm">{p.name}</Label>
              <input
                type="color"
                aria-label={`${p.name} colour`}
                className="h-8 w-12 cursor-pointer rounded border bg-transparent"
                defaultValue={p.color ?? fallback(i, p.type)}
                disabled={!!busy}
                onChange={(e) => save(p.label, e.target.value)}
              />
            </label>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function GraphPage() {
  const state = useGrillState()
  const source = useGrill((s) => s.source)
  const [range, setRange] = useState(RANGES[1])
  const [live, setLive] = useState(true)
  const [showAnnotations, setShowAnnotations] = useState(true)
  const [colorsOpen, setColorsOpen] = useState(false)

  const history = useQuery({
    queryKey: ['history', source?.kind],
    queryFn: () => source!.getHistory(0),
    enabled: !!source,
    refetchInterval: live ? 5000 : false,
  })
  const events = useQuery({
    queryKey: ['events', source?.kind],
    queryFn: () => source!.getEvents(300),
    enabled: !!source && showAnnotations,
    refetchInterval: live ? 30_000 : false,
  })
  const series = useMemo(() => (state ? seriesForProbes(state.probes) : []), [state])
  const annotations = useMemo(() => (showAnnotations && events.data ? annotationsFromEvents(events.data) : undefined), [showAnnotations, events.data])

  const exportCsv = () => {
    if (!history.data?.length || !state) return toast.error('Nothing to export yet')
    downloadText(`fireai-history-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`, historyToCsv(history.data, state))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Live graph</h1>
        <div className="flex flex-wrap gap-1">
          {RANGES.map((r) => (
            <Button key={r.label} size="sm" variant={r.label === range.label ? 'default' : 'outline'} onClick={() => setRange(r)}>
              {r.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" className={cn(live && 'text-ember')} onClick={() => setLive((v) => !v)} aria-pressed={live}>
          {live ? <Pause className="size-4" /> : <Play className="size-4" />} {live ? 'Live' : 'Paused'}
        </Button>
        <Button size="sm" variant="ghost" className={cn(showAnnotations && 'text-ember')} onClick={() => setShowAnnotations((v) => !v)} aria-pressed={showAnnotations}>
          <Flag className="size-4" /> Annotations
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setColorsOpen(true)}><Palette className="size-4" /> Colours</Button>
        <Button size="sm" variant="ghost" onClick={exportCsv}><Download className="size-4" /> CSV</Button>
        {history.isFetching && <Loader2 className="ml-1 size-4 animate-spin self-center text-muted-foreground" />}
      </div>
      <Card>
        <CardContent className="p-2 sm:p-4">
          {!history.data || !state ? (
            <Skeleton className="h-64 w-full" />
          ) : history.data.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">No history yet — start a cook to see the graph.</div>
          ) : (
            <TempChart rows={history.data} series={series} windowS={range.s} annotations={annotations} />
          )}
        </CardContent>
      </Card>
      {state && <ColorsSheet open={colorsOpen} onOpenChange={setColorsOpen} state={state} />}
    </div>
  )
}

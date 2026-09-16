import { useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useGrill, useGrillState } from '@/stores/grill'
import { probeColor } from '@/features/dashboard/ProbeCard'
import type { GrillState, HistoryRow } from '@/types/state'

const RANGES = [
  { label: '15m', s: 15 * 60 },
  { label: '1h', s: 3600 },
  { label: '4h', s: 4 * 3600 },
  { label: 'All', s: 0 },
]

function cssColor(varName: string) {
  const m = varName.match(/var\((--[\w-]+)\)/)
  if (!m) return varName
  return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || '#f80'
}

/** Build uPlot series/data from history rows + probe metadata. */
function buildData(rows: HistoryRow[], state: GrillState) {
  const probes = state.probes.filter((p) => p.enabled && p.type !== 'Aux')
  const x = rows.map((r) => r.T / 1000)
  const series = probes.map((p) => rows.map((r) => (p.type === 'Primary' ? r.P[p.label] : r.F[p.label]) ?? null))
  const setpoint = rows.map((r) => (r.PSP > 0 ? r.PSP : null))
  return { probes, data: [x, ...series, setpoint] as uPlot.AlignedData }
}

export function GraphPage() {
  const state = useGrillState()
  const source = useGrill((s) => s.source)
  const [range, setRange] = useState(RANGES[1])
  const ref = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)

  const history = useQuery({
    queryKey: ['history'],
    queryFn: () => source!.getHistory(0),
    enabled: !!source,
    refetchInterval: 5000,
  })

  const built = useMemo(() => (history.data && state ? buildData(history.data, state) : null), [history.data, state])

  useEffect(() => {
    if (!built || !ref.current || !state) return
    const { probes, data } = built
    const xs = data[0] as number[]
    const now = xs.length ? xs[xs.length - 1] : Date.now() / 1000
    const opts: uPlot.Options = {
      width: ref.current.clientWidth,
      height: Math.max(260, Math.min(420, window.innerHeight * 0.5)),
      cursor: { drag: { x: true, y: false } },
      scales: {
        x: { time: true, range: range.s ? [now - range.s, now] : undefined },
        y: { range: (_u, min, max) => [Math.max(0, Math.floor((min - 10) / 25) * 25), Math.ceil((max + 10) / 25) * 25] },
      },
      axes: [
        { stroke: cssColor('var(--muted-foreground)'), grid: { stroke: 'rgba(128,128,128,0.15)' }, ticks: { stroke: 'rgba(128,128,128,0.3)' } },
        { stroke: cssColor('var(--muted-foreground)'), grid: { stroke: 'rgba(128,128,128,0.15)' }, ticks: { stroke: 'rgba(128,128,128,0.3)' }, size: 44 },
      ],
      series: [
        {},
        ...probes.map((p) => ({ label: p.name, stroke: cssColor(probeColor(state, p)), width: p.type === 'Primary' ? 2.5 : 1.5, spanGaps: false })),
        { label: 'Setpoint', stroke: cssColor('var(--foreground)'), width: 1, dash: [6, 4], spanGaps: false },
      ],
      legend: { show: true },
    }
    plotRef.current?.destroy()
    plotRef.current = new uPlot(opts, data, ref.current)
    const onResize = () => plotRef.current?.setSize({ width: ref.current!.clientWidth, height: opts.height })
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      plotRef.current?.destroy()
      plotRef.current = null
    }
    // Rebuild when probes/range change; data updates go through setData below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built?.probes.map((p) => p.label).join(','), range, !!state])

  useEffect(() => {
    if (built && plotRef.current) {
      plotRef.current.setData(built.data)
      if (range.s) {
        const xs = built.data[0] as number[]
        const now = xs.length ? xs[xs.length - 1] : Date.now() / 1000
        plotRef.current.setScale('x', { min: now - range.s, max: now })
      }
    }
  }, [built, range])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Live graph</h1>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <Button key={r.label} size="sm" variant={r.label === range.label ? 'default' : 'outline'} onClick={() => setRange(r)}>
              {r.label}
            </Button>
          ))}
        </div>
      </div>
      <Card>
        <CardContent className="p-2 sm:p-4">
          {!built ? (
            <Skeleton className="h-64 w-full" />
          ) : built.data[0].length === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">No history yet — start a cook to see the graph.</div>
          ) : (
            <div ref={ref} className="w-full" />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

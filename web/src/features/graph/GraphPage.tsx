import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TempChart, seriesForProbes } from '@/components/chart/TempChart'
import { useGrill, useGrillState } from '@/stores/grill'

const RANGES = [
  { label: '15m', s: 15 * 60 },
  { label: '1h', s: 3600 },
  { label: '4h', s: 4 * 3600 },
  { label: 'All', s: 0 },
]

export function GraphPage() {
  const state = useGrillState()
  const source = useGrill((s) => s.source)
  const [range, setRange] = useState(RANGES[1])

  const history = useQuery({
    queryKey: ['history', source?.kind],
    queryFn: () => source!.getHistory(0),
    enabled: !!source,
    refetchInterval: 5000,
  })
  const series = useMemo(() => (state ? seriesForProbes(state.probes) : []), [state])

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
          {!history.data || !state ? (
            <Skeleton className="h-64 w-full" />
          ) : history.data.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">No history yet — start a cook to see the graph.</div>
          ) : (
            <TempChart rows={history.data} series={series} windowS={range.s} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

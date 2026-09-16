import { useEffect, useMemo, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { HistoryRow, ProbeMeta } from '@/types/state'

export interface ChartSeries {
  label: string
  key: string
  group: 'P' | 'F'
  color: string
  width?: number
}

function cssColor(varName: string) {
  const m = varName.match(/var\((--[\w-]+)\)/)
  if (!m) return varName
  return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || '#f80'
}

const FOOD_COLORS = ['var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']

/** Series list for a probe set: primary in ember, food probes in the chart palette. */
export function seriesForProbes(probes: ProbeMeta[]): ChartSeries[] {
  const foods = probes.filter((p) => p.type === 'Food' && p.enabled)
  return [
    ...probes.filter((p) => p.type === 'Primary' && p.enabled).map((p) => ({ label: p.name, key: p.label, group: 'P' as const, color: 'var(--ember)', width: 2.5 })),
    ...foods.map((p, i) => ({ label: p.name, key: p.label, group: 'F' as const, color: FOOD_COLORS[i % FOOD_COLORS.length], width: 1.5 })),
  ]
}

/** Series list from a cook file's graph_labels + first row (when probe metadata is unavailable). */
export function seriesFromRows(rows: HistoryRow[], labels?: { probes?: Record<string, string> }): ChartSeries[] {
  const first = rows[0]
  if (!first) return []
  const name = (k: string) => labels?.probes?.[k] ?? k
  return [
    ...Object.keys(first.P ?? {}).map((k) => ({ label: name(k), key: k, group: 'P' as const, color: 'var(--ember)', width: 2.5 })),
    ...Object.keys(first.F ?? {}).map((k, i) => ({ label: name(k), key: k, group: 'F' as const, color: FOOD_COLORS[i % FOOD_COLORS.length], width: 1.5 })),
  ]
}

export function buildAligned(rows: HistoryRow[], series: ChartSeries[]): uPlot.AlignedData {
  const x = rows.map((r) => r.T / 1000)
  const ys = series.map((s) => rows.map((r) => (s.group === 'P' ? r.P?.[s.key] : r.F?.[s.key]) ?? null))
  const sp = rows.map((r) => (r.PSP > 0 ? r.PSP : null))
  return [x, ...ys, sp] as uPlot.AlignedData
}

interface Props {
  rows: HistoryRow[]
  series: ChartSeries[]
  /** Seconds of x-range to show, anchored to the last sample. 0 = all. */
  windowS?: number
  height?: number
  className?: string
}

/** uPlot temperature chart: probes + dashed setpoint, dark/light aware. */
export function TempChart({ rows, series, windowS = 0, height, className }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const plot = useRef<uPlot | null>(null)
  const data = useMemo(() => buildAligned(rows, series), [rows, series])
  const seriesKey = series.map((s) => s.key).join(',')

  useEffect(() => {
    if (!ref.current) return
    const xs = data[0] as number[]
    const last = xs.length ? xs[xs.length - 1] : Date.now() / 1000
    const h = height ?? Math.max(240, Math.min(420, window.innerHeight * 0.45))
    const muted = cssColor('var(--muted-foreground)')
    const opts: uPlot.Options = {
      width: ref.current.clientWidth,
      height: h,
      cursor: { drag: { x: true, y: false } },
      scales: {
        x: { time: true, range: windowS ? [last - windowS, last] : undefined },
        y: { range: (_u, min, max) => [Math.max(0, Math.floor((min - 10) / 25) * 25), Math.ceil((max + 10) / 25) * 25] },
      },
      axes: [
        { stroke: muted, grid: { stroke: 'rgba(128,128,128,0.15)' }, ticks: { stroke: 'rgba(128,128,128,0.3)' } },
        { stroke: muted, grid: { stroke: 'rgba(128,128,128,0.15)' }, ticks: { stroke: 'rgba(128,128,128,0.3)' }, size: 44 },
      ],
      series: [
        {},
        ...series.map((s) => ({ label: s.label, stroke: cssColor(s.color), width: s.width ?? 1.5, spanGaps: false })),
        { label: 'Setpoint', stroke: cssColor('var(--foreground)'), width: 1, dash: [6, 4], spanGaps: false },
      ],
      legend: { show: true },
    }
    plot.current?.destroy()
    plot.current = new uPlot(opts, data, ref.current)
    const onResize = () => plot.current?.setSize({ width: ref.current!.clientWidth, height: h })
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      plot.current?.destroy()
      plot.current = null
    }
    // Recreate only when the series set or window changes; data updates go through setData.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesKey, windowS, height])

  useEffect(() => {
    if (!plot.current) return
    plot.current.setData(data)
    if (windowS) {
      const xs = data[0] as number[]
      const last = xs.length ? xs[xs.length - 1] : Date.now() / 1000
      plot.current.setScale('x', { min: last - windowS, max: last })
    }
  }, [data, windowS])

  return <div ref={ref} className={className ?? 'w-full'} />
}

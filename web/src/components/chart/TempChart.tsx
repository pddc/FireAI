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
    ...probes.filter((p) => p.type === 'Primary' && p.enabled).map((p) => ({ label: p.name, key: p.label, group: 'P' as const, color: p.color || 'var(--ember)', width: 2.5 })),
    ...foods.map((p, i) => ({ label: p.name, key: p.label, group: 'F' as const, color: p.color || FOOD_COLORS[i % FOOD_COLORS.length], width: 1.5 })),
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

export interface Annotation {
  /** epoch seconds */
  t: number
  label: string
}

interface Props {
  rows: HistoryRow[]
  series: ChartSeries[]
  /** Seconds of x-range to show, anchored to the last sample. 0 = all. */
  windowS?: number
  /** Mode changes drawn as labelled vertical markers (PiFire's graph annotations). */
  annotations?: Annotation[]
  height?: number
  className?: string
}

/** Mode-change markers from the events log ("Hold Mode started.") for the annotations overlay. */
export function annotationsFromEvents(events: { date: string; time: string; message: string }[]): Annotation[] {
  const out: Annotation[] = []
  for (const e of events) {
    const m = /^(\w+) Mode started/i.exec(e.message)
    if (!m) continue
    const t = Date.parse(`${e.date}T${e.time}`) / 1000
    if (Number.isFinite(t)) out.push({ t, label: m[1] })
  }
  return out
}

function drawAnnotations(u: uPlot, annotations: Annotation[], color: string) {
  const { ctx } = u
  const { left, top, width, height } = u.bbox
  ctx.save()
  ctx.beginPath()
  ctx.rect(left, top, width, height)
  ctx.clip()
  ctx.font = `${11 * devicePixelRatio}px system-ui, sans-serif`
  ctx.textBaseline = 'top'
  for (const a of annotations) {
    const x = u.valToPos(a.t, 'x', true)
    if (x < left || x > left + width) continue
    ctx.strokeStyle = color
    ctx.setLineDash([4 * devicePixelRatio, 4 * devicePixelRatio])
    ctx.lineWidth = devicePixelRatio
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x, top + height)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = color
    ctx.fillText(a.label, x + 3 * devicePixelRatio, top + 2 * devicePixelRatio)
  }
  ctx.restore()
}

/** uPlot temperature chart: probes + dashed setpoint, dark/light aware. */
export function TempChart({ rows, series, windowS = 0, annotations, height, className }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const plot = useRef<uPlot | null>(null)
  const annRef = useRef<Annotation[] | undefined>(annotations)
  annRef.current = annotations
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
      hooks: { draw: [(u) => annRef.current?.length && drawAnnotations(u, annRef.current, muted)] },
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
    plot.current?.redraw(false, false)
  }, [annotations])

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

import type { Units } from '@/types/state'

export function fmtTemp(value: number | null | undefined, units: Units, opts: { unit?: boolean; digits?: number } = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--'
  const digits = opts.digits ?? (units === 'C' ? 1 : 0)
  const s = Number(value).toFixed(digits)
  return opts.unit === false ? s : `${s}°`
}

export function unitLabel(units: Units) {
  return units === 'C' ? '°C' : '°F'
}

/** "1h 05m" / "12m 03s" / "45s" */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}

/** "01:05:09" */
export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function fmtTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function fmtRelative(epochS: number, nowS = Date.now() / 1000): string {
  const d = Math.round(nowS - epochS)
  if (d < 60) return `${d}s ago`
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  return `${Math.floor(d / 3600)}h ${Math.floor((d % 3600) / 60)}m ago`
}

export const MODE_LABEL: Record<string, string> = {
  Stop: 'Stopped',
  Startup: 'Starting up',
  Reignite: 'Re-igniting',
  Smoke: 'Smoking',
  Hold: 'Holding',
  Shutdown: 'Shutting down',
  Monitor: 'Monitoring',
  Manual: 'Manual',
  Prime: 'Priming',
  Recipe: 'Recipe',
  Error: 'Error',
}

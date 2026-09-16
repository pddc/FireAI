import { useId } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  value: number | null
  min: number
  max: number
  /** Setpoint or notify target, drawn as a tick on the arc. */
  target?: number | null
  /** Arc colour token (CSS colour). */
  color?: string
  size?: number
  className?: string
  children?: React.ReactNode
}

const START = 135 // degrees, gauge opens at the bottom
const SWEEP = 270

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number) {
  const a = polar(cx, cy, r, from)
  const b = polar(cx, cy, r, to)
  const large = to - from > 180 ? 1 : 0
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`
}

/** 270° arc gauge. Children render in the centre (value, label, etc.). */
export function TempGauge({ value, min, max, target, color = 'var(--ember)', size = 160, className, children }: Props) {
  const id = useId()
  const cx = size / 2
  const cy = size / 2
  const stroke = Math.max(8, size * 0.07)
  const r = cx - stroke / 2 - 2
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  const frac = value === null ? 0 : (clamp(value) - min) / (max - min)
  const end = START + SWEEP * frac
  const tFrac = target != null && target > 0 ? (clamp(target) - min) / (max - min) : null
  const tick = tFrac == null ? null : polar(cx, cy, r, START + SWEEP * tFrac)
  const tickIn = tFrac == null ? null : polar(cx, cy, r - stroke * 0.9, START + SWEEP * tFrac)

  return (
    <div className={cn('relative', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
        <defs>
          <linearGradient id={`${id}-g`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor={color} stopOpacity="0.55" />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
        </defs>
        <path d={arcPath(cx, cy, r, START, START + SWEEP)} stroke="var(--muted)" strokeWidth={stroke} fill="none" strokeLinecap="round" />
        {frac > 0 && (
          <path
            d={arcPath(cx, cy, r, START, Math.max(START + 0.5, end))}
            stroke={`url(#${id}-g)`}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            style={{ transition: 'd 600ms ease' }}
          />
        )}
        {tick && tickIn && (
          <line x1={tickIn.x} y1={tickIn.y} x2={tick.x} y2={tick.y} stroke="var(--foreground)" strokeWidth={2.5} strokeLinecap="round" opacity={0.9} />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  )
}

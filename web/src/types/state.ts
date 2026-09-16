// Mirrors core/state.py::snapshot(). Keep in sync when the snapshot grows.

export type Units = 'F' | 'C'

export type Mode =
  | 'Stop'
  | 'Startup'
  | 'Reignite'
  | 'Smoke'
  | 'Hold'
  | 'Shutdown'
  | 'Monitor'
  | 'Manual'
  | 'Prime'
  | 'Recipe'
  | 'Error'

export type ProbeType = 'Primary' | 'Food' | 'Aux'

export interface ProbeMeta {
  label: string
  name: string
  type: ProbeType
  device: string
  port: string
  enabled: boolean
}

export interface NotifyEntry {
  label: string
  name?: string
  type: 'probe' | 'probe_limit_high' | 'probe_limit_low' | 'timer' | 'hopper' | 'test'
  req: boolean
  target?: number
  eta?: number | null
  shutdown?: boolean
  keep_warm?: boolean
  reignite?: boolean
  condition?: string
  triggered?: boolean
  last_check?: number
}

export interface Timer {
  start: number
  paused: number
  end: number
  shutdown: boolean
}

export interface Outputs {
  auger?: boolean
  fan?: boolean
  igniter?: boolean
  power?: boolean
  pwm?: number
}

export interface ProbeStatusEntry {
  status?: Record<string, unknown>
  config?: Record<string, unknown>
  enabled?: boolean
  device?: string
  port?: string
  type?: string
  label?: string
  name?: string
}

export interface GrillState {
  ts: number
  name: string
  units: Units
  mode: Mode
  next_mode: string | null
  status: string | null
  display_mode: string | null
  critical_error: boolean
  temps: {
    primary: Record<string, number | null>
    food: Record<string, number | null>
    aux: Record<string, number | null>
  }
  setpoint: number
  notify_targets: Record<string, number>
  smoke_plus: boolean
  pwm_control: boolean
  duty_cycle: number | null
  p_mode: number | null
  dashboard: { hidden_cards: string[]; max_primary_temp: number; max_food_temp: number }
  outputs: Outputs
  timer: Timer
  lid_open: { detected: boolean; end_time: number }
  startup: { timestamp: number; start_time: number; duration: number }
  shutdown_duration: number
  prime: { duration: number; amount: number }
  recipe: { active: boolean; paused: boolean }
  hopper: { level: number | null; enabled: boolean; pellets: string; est_usage_g: number }
  notify: NotifyEntry[]
  probes: ProbeMeta[]
  probe_status: { P: Record<string, ProbeStatusEntry>; F: Record<string, ProbeStatusEntry>; AUX: Record<string, ProbeStatusEntry> }
  manual: { change?: string | null; output?: boolean | null; pwm?: number }
  errors: string[]
  warnings: string[]
  /** Cloud mode only: whether the grill currently accepts remote commands (from presence). */
  cloud_control?: boolean
}

export interface CommandResult {
  result: 'OK' | 'ERROR'
  message: string
  data: Record<string, unknown>
}

export interface CommandInfo {
  name: string
  description: string
  cloud_allowed: boolean
  role: 'viewer' | 'operator' | 'admin'
  args: Record<string, unknown>
}

export interface HistoryRow {
  T: number
  P: Record<string, number | null>
  F: Record<string, number | null>
  AUX: Record<string, number | null>
  PSP: number
  NT: Record<string, number>
  EXD?: Record<string, unknown>
}

export interface EventRow {
  date: string
  time: string
  message: string
}

export type ConnectionStatus = 'connecting' | 'live' | 'offline'

export interface CookSummary {
  id: string
  /** Local: .pifire filename. Cloud: Firestore doc id. */
  filename?: string
  title: string
  starttime: number | null
  endtime: number | null
  units?: Units
  thumbnail?: string
  status?: string
  size?: number
  error?: string
}

export interface CookAsset {
  id: string
  filename: string
  type: string
}

export interface CookComment {
  id: string
  text: string
  date: string
  time: string
  edited?: string
  assets?: string[]
}

export interface CookDoc {
  id: string
  filename?: string
  metadata: { title?: string; starttime?: number; endtime?: number; units?: Units; thumbnail?: string; id?: string; version?: string; notes?: string }
  rows: HistoryRow[]
  labels?: { probes?: Record<string, string>; primarysp?: Record<string, string> }
  events: unknown[]
  comments: CookComment[]
  assets: CookAsset[]
}

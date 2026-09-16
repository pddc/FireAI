// Cloud-side command allowlist. Mirrors core/commands.py: only names listed here
// with cloud_allowed=True on the Pi can be sent from the cloud, and each gets a
// light argument shape check so obviously malformed commands never reach the
// bridge (the bridge re-validates with the full Pydantic schema).

export type Role = 'owner' | 'operator' | 'viewer'

type ArgSpec = Record<string, { type: 'number' | 'boolean' | 'string' | 'object'; required?: boolean; min?: number; max?: number; enum?: string[] }>

export const CLOUD_COMMANDS: Record<string, { minRole: Role; args: ArgSpec }> = {
  'mode.startup': { minRole: 'operator', args: {} },
  'mode.smoke': { minRole: 'operator', args: {} },
  'mode.shutdown': { minRole: 'operator', args: {} },
  'mode.stop': { minRole: 'operator', args: {} },
  'mode.monitor': { minRole: 'operator', args: {} },
  'mode.manual': { minRole: 'operator', args: {} },
  'mode.reignite': { minRole: 'operator', args: {} },
  'mode.hold': { minRole: 'operator', args: { setpoint: { type: 'number', required: true, min: 1, max: 700 } } },
  'mode.prime': { minRole: 'operator', args: { amount: { type: 'number', required: true, min: 1, max: 100 }, next_mode: { type: 'string', enum: ['Stop', 'Startup', 'Monitor'] } } },
  setpoint: { minRole: 'operator', args: { setpoint: { type: 'number', required: true, min: 1, max: 700 } } },
  smoke_plus: { minRole: 'operator', args: { enabled: { type: 'boolean', required: true } } },
  pwm_control: { minRole: 'operator', args: { enabled: { type: 'boolean', required: true } } },
  duty_cycle: { minRole: 'operator', args: { duty_cycle: { type: 'number', required: true, min: 0, max: 100 } } },
  pmode: { minRole: 'operator', args: { pmode: { type: 'number', required: true, min: 0, max: 9 } } },
  units: { minRole: 'owner', args: { units: { type: 'string', required: true, enum: ['C', 'F'] } } },
  'lid_open.toggle': { minRole: 'operator', args: {} },
  tuning_mode: { minRole: 'operator', args: { enabled: { type: 'boolean', required: true } } },
  'timer.start': { minRole: 'operator', args: { seconds: { type: 'number', required: true, min: 1, max: 86400 }, shutdown: { type: 'boolean' }, keep_warm: { type: 'boolean' } } },
  'timer.pause': { minRole: 'operator', args: {} },
  'timer.resume': { minRole: 'operator', args: {} },
  'timer.stop': { minRole: 'operator', args: {} },
  'notify.set': {
    minRole: 'operator',
    args: {
      label: { type: 'string', required: true },
      kind: { type: 'string', enum: ['probe', 'probe_limit_high', 'probe_limit_low', 'timer', 'hopper'] },
      req: { type: 'boolean' },
      target: { type: 'number', min: 0, max: 700 },
      shutdown: { type: 'boolean' },
      keep_warm: { type: 'boolean' },
      reignite: { type: 'boolean' },
    },
  },
  'manual.output': { minRole: 'operator', args: { output: { type: 'string', required: true, enum: ['power', 'igniter', 'fan', 'auger'] }, on: { type: 'boolean', required: true } } },
  'manual.pwm': { minRole: 'operator', args: { duty_cycle: { type: 'number', required: true, min: 0, max: 100 } } },
  'settings.patch': { minRole: 'owner', args: { patch: { type: 'object', required: true } } },
  'hopper.check': { minRole: 'operator', args: {} },
  'system.restart_control': { minRole: 'owner', args: {} },
}

const ROLE_RANK: Record<Role, number> = { viewer: 0, operator: 1, owner: 2 }

export function roleAllows(role: Role | undefined, min: Role): boolean {
  return role !== undefined && ROLE_RANK[role] >= ROLE_RANK[min]
}

export type Validation = { ok: true; args: Record<string, unknown> } | { ok: false; error: string }

export function validateCommand(name: string, args: unknown, role: Role | undefined): Validation {
  const spec = CLOUD_COMMANDS[name]
  if (!spec) return { ok: false, error: `Command ${name} is not available from the cloud` }
  if (!roleAllows(role, spec.minRole)) return { ok: false, error: `Role ${role ?? 'none'} may not run ${name}` }
  const a = (args && typeof args === 'object' && !Array.isArray(args) ? args : {}) as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, s] of Object.entries(spec.args)) {
    const v = a[key]
    if (v === undefined || v === null) {
      if (s.required) return { ok: false, error: `Missing argument ${key}` }
      continue
    }
    if (s.type === 'object') {
      if (typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: `${key} must be an object` }
      if (JSON.stringify(v).length > 64 * 1024) return { ok: false, error: `${key} too large` }
    } else if (typeof v !== s.type) {
      return { ok: false, error: `${key} must be a ${s.type}` }
    }
    if (s.type === 'number') {
      const n = v as number
      if (!Number.isFinite(n)) return { ok: false, error: `${key} must be finite` }
      if (s.min !== undefined && n < s.min) return { ok: false, error: `${key} below ${s.min}` }
      if (s.max !== undefined && n > s.max) return { ok: false, error: `${key} above ${s.max}` }
    }
    if (s.enum && !s.enum.includes(v as string)) return { ok: false, error: `${key} must be one of ${s.enum.join(', ')}` }
    if (s.type === 'string' && (v as string).length > 200) return { ok: false, error: `${key} too long` }
    out[key] = v
  }
  for (const key of Object.keys(a)) {
    if (!(key in spec.args)) return { ok: false, error: `Unknown argument ${key}` }
  }
  return { ok: true, args: out }
}

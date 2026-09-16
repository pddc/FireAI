import { describe, expect, it } from 'vitest'
import { checkPending, hashSecret, secretMatches, validateRequest, PAIRING_TTL_MS, bridgeUid, newGrillId } from '../src/lib/pairing.js'
import { validateCommand, roleAllows, CLOUD_COMMANDS } from '../src/lib/commands.js'

const SECRET = 'a'.repeat(40)

describe('pairing helpers', () => {
  it('hashes and compares secrets in constant time', () => {
    const h = hashSecret(SECRET)
    expect(h).toHaveLength(64)
    expect(secretMatches(SECRET, h)).toBe(true)
    expect(secretMatches('b'.repeat(40), h)).toBe(false)
    expect(secretMatches(SECRET, 'short')).toBe(false)
  })

  it('validates pairing requests', () => {
    expect(validateRequest(null)).toBeNull()
    expect(validateRequest({ code: '12345', secret: SECRET })).toBeNull()
    expect(validateRequest({ code: '123456', secret: 'short' })).toBeNull()
    const ok = validateRequest({ code: '123456', secret: SECRET, grillInfo: { name: 'Pit', board: 'pcb_4.x.x', evil: 'x', version: 'y'.repeat(200) } })
    expect(ok).not.toBeNull()
    expect(ok!.grillInfo).toEqual({ name: 'Pit', board: 'pcb_4.x.x', version: 'y'.repeat(80) })
  })

  it('checkPending covers every state', () => {
    const now = 1_000_000
    const base = { secretHash: 'x', createdAt: now, expiresAt: now + PAIRING_TTL_MS, status: 'pending' as const, grillInfo: {} }
    expect(checkPending(undefined, now)).toEqual({ ok: false, reason: 'not_found' })
    expect(checkPending({ ...base, status: 'claimed' }, now).ok).toBe(false)
    expect(checkPending(base, now + PAIRING_TTL_MS + 1)).toEqual({ ok: false, reason: 'expired' })
    expect(checkPending(base, now + 5).ok).toBe(true)
  })

  it('ids', () => {
    expect(newGrillId()).toMatch(/^g_[A-Za-z0-9_-]{12}$/)
    expect(bridgeUid('g_abc')).toBe('grill_g_abc')
  })
})

describe('command validation', () => {
  it('roles are ordered', () => {
    expect(roleAllows('owner', 'operator')).toBe(true)
    expect(roleAllows('viewer', 'operator')).toBe(false)
    expect(roleAllows(undefined, 'viewer')).toBe(false)
  })

  it('rejects commands not on the allowlist', () => {
    expect(validateCommand('system.reboot', {}, 'owner')).toMatchObject({ ok: false })
    expect(validateCommand('nope', {}, 'owner')).toMatchObject({ ok: false })
  })

  it('checks required args, types, bounds and enums', () => {
    expect(validateCommand('mode.hold', {}, 'operator')).toMatchObject({ ok: false, error: 'Missing argument setpoint' })
    expect(validateCommand('mode.hold', { setpoint: 'hot' }, 'operator')).toMatchObject({ ok: false })
    expect(validateCommand('mode.hold', { setpoint: 999 }, 'operator')).toMatchObject({ ok: false })
    expect(validateCommand('mode.hold', { setpoint: 225 }, 'operator')).toEqual({ ok: true, args: { setpoint: 225 } })
    expect(validateCommand('units', { units: 'K' }, 'owner')).toMatchObject({ ok: false })
    expect(validateCommand('units', { units: 'C' }, 'operator')).toMatchObject({ ok: false }) // owner only
    expect(validateCommand('mode.prime', { amount: 20, next_mode: 'Startup' }, 'operator').ok).toBe(true)
  })

  it('rejects unknown args and oversized patches', () => {
    expect(validateCommand('mode.smoke', { bogus: 1 }, 'operator')).toMatchObject({ ok: false, error: 'Unknown argument bogus' })
    expect(validateCommand('settings.patch', { patch: { a: 'x'.repeat(70000) } }, 'owner')).toMatchObject({ ok: false })
    expect(validateCommand('settings.patch', { patch: { globals: { grill_name: 'x' } } }, 'owner').ok).toBe(true)
  })

  it('every allowlisted command has a role', () => {
    for (const spec of Object.values(CLOUD_COMMANDS)) expect(['owner', 'operator', 'viewer']).toContain(spec.minRole)
  })
})

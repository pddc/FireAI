// Pure helpers for the pairing handshake. No Firebase imports so they unit-test instantly.
//
// Flow:
//   1. Pi  -> requestPairing  {code, secret, grillInfo}      (unauthenticated HTTPS)
//   2. App -> pairGrill       {code, name}                   (callable, signed-in user)
//   3. Pi  -> claimPairing    {code, secret}                 (HTTPS) -> {grillId, customToken, ...}
// The secret never leaves the Pi except hashed; the app never sees it.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const PAIRING_TTL_MS = 10 * 60 * 1000
export const CODE_RE = /^[0-9]{6}$/
export const SECRET_RE = /^[A-Za-z0-9_-]{32,128}$/

export interface PairingDoc {
  secretHash: string
  createdAt: number
  expiresAt: number
  status: 'pending' | 'claimed'
  grillInfo: { name?: string; board?: string; version?: string }
  grillId?: string
  ownerUid?: string
  customToken?: string
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

export function secretMatches(secret: string, hash: string): boolean {
  const a = Buffer.from(hashSecret(secret))
  const b = Buffer.from(hash)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function newGrillId(): string {
  return 'g_' + randomBytes(9).toString('base64url')
}

export function bridgeUid(grillId: string): string {
  return `grill_${grillId}`
}

export type PairingCheck = { ok: true; doc: PairingDoc } | { ok: false; reason: 'not_found' | 'expired' | 'claimed' | 'invalid' }

export function checkPending(doc: PairingDoc | undefined, now: number): PairingCheck {
  if (!doc) return { ok: false, reason: 'not_found' }
  if (doc.status !== 'pending') return { ok: false, reason: 'claimed' }
  if (now > doc.expiresAt) return { ok: false, reason: 'expired' }
  return { ok: true, doc }
}

export function validateRequest(body: unknown): { code: string; secret: string; grillInfo: PairingDoc['grillInfo'] } | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (typeof b.code !== 'string' || !CODE_RE.test(b.code)) return null
  if (typeof b.secret !== 'string' || !SECRET_RE.test(b.secret)) return null
  const info = (b.grillInfo && typeof b.grillInfo === 'object' ? b.grillInfo : {}) as Record<string, unknown>
  const grillInfo: PairingDoc['grillInfo'] = {}
  for (const k of ['name', 'board', 'version'] as const) {
    if (typeof info[k] === 'string') grillInfo[k] = (info[k] as string).slice(0, 80)
  }
  return { code: b.code, secret: b.secret, grillInfo }
}

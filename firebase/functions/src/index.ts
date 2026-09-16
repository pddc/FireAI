// FireAI Cloud Functions (v2).
//
//   requestPairing   HTTPS  Pi announces a pairing code + secret hash
//   pairGrill        call   signed-in user claims a code -> grill doc + bridge custom token
//   claimPairing     HTTPS  Pi collects the custom token with its secret
//   sendCommand      call   member issues a command -> RTDB with server timestamp + nonce
//   onNotification   RTDB   bridge-written notification -> FCM push to members
//   cleanupStaleCommands  schedule  hourly sweep
//
// Membership is mirrored into user custom claims (`grills: {id: role}`) so RTDB
// and Storage rules can check it without reading Firestore. Clients must
// refresh their ID token after pairing/membership changes.

import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getDatabase, ServerValue } from 'firebase-admin/database'
import { getMessaging } from 'firebase-admin/messaging'
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https'
import { onValueCreated } from 'firebase-functions/v2/database'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { logger } from 'firebase-functions'
import { defineString } from 'firebase-functions/params'
import { randomBytes } from 'node:crypto'
import { bridgeUid, checkPending, hashSecret, newGrillId, PAIRING_TTL_MS, secretMatches, validateRequest, type PairingDoc } from './lib/pairing.js'
import { validateCommand, type Role } from './lib/commands.js'

initializeApp()
const db = getFirestore()
const rtdb = getDatabase()

const REGION = 'us-central1'
// Public web API key of the project, handed to the bridge so it can exchange its custom token.
const WEB_API_KEY = defineString('FIREAI_WEB_API_KEY')
const DATABASE_URL = defineString('FIREAI_DATABASE_URL', { default: '' })
const COMMAND_TTL_MS = 60 * 60 * 1000

function json(res: { status: (n: number) => { json: (b: unknown) => void } }, code: number, body: unknown) {
  res.status(code).json(body)
}

// --------------------------------------------------------------------------
// Pairing
// --------------------------------------------------------------------------

export const requestPairing = onRequest({ region: REGION, cors: false }, async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' })
  const parsed = validateRequest(req.body)
  if (!parsed) return json(res, 400, { error: 'invalid' })
  const ref = db.collection('pairing').doc(parsed.code)
  const now = Date.now()
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      const existing = snap.data() as PairingDoc | undefined
      if (existing && existing.status === 'pending' && now <= existing.expiresAt) throw new HttpsError('already-exists', 'code in use')
      const doc: PairingDoc = {
        secretHash: hashSecret(parsed.secret),
        createdAt: now,
        expiresAt: now + PAIRING_TTL_MS,
        status: 'pending',
        grillInfo: parsed.grillInfo,
      }
      tx.set(ref, doc)
    })
  } catch (e) {
    if (e instanceof HttpsError && e.code === 'already-exists') return json(res, 409, { error: 'code_in_use' })
    logger.error('requestPairing failed', e)
    return json(res, 500, { error: 'internal' })
  }
  return json(res, 200, { ok: true, expiresAt: now + PAIRING_TTL_MS })
})

export const pairGrill = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first')
  const code = String(request.data?.code ?? '')
  const name = String(request.data?.name ?? '').slice(0, 60)
  if (!/^[0-9]{6}$/.test(code)) throw new HttpsError('invalid-argument', 'Enter the 6-digit code shown on the grill')
  const ref = db.collection('pairing').doc(code)
  const now = Date.now()

  const grillId = newGrillId()
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const check = checkPending(snap.data() as PairingDoc | undefined, now)
    if (!check.ok) {
      const msg = { not_found: 'No grill is waiting with that code', expired: 'That code has expired - start pairing again on the grill', claimed: 'That code was already used', invalid: 'Invalid code' }[check.reason]
      throw new HttpsError('failed-precondition', msg)
    }
    const grillRef = db.collection('grills').doc(grillId)
    tx.set(grillRef, {
      name: name || check.doc.grillInfo.name || 'My grill',
      ownerUid: uid,
      members: { [uid]: 'owner' },
      board: check.doc.grillInfo.board ?? null,
      firmware: check.doc.grillInfo.version ?? null,
      pairedAt: FieldValue.serverTimestamp(),
    })
    tx.set(db.collection('users').doc(uid), { grillIds: FieldValue.arrayUnion(grillId) }, { merge: true })
    tx.update(ref, { status: 'claimed', grillId, ownerUid: uid })
    return { grillId }
  })

  // Bridge identity + user claim.
  const customToken = await getAuth().createCustomToken(bridgeUid(grillId), { bridge: true, grill: grillId })
  await ref.update({ customToken })
  const user = await getAuth().getUser(uid)
  const grills = { ...((user.customClaims?.grills as Record<string, Role>) ?? {}), [grillId]: 'owner' as Role }
  await getAuth().setCustomUserClaims(uid, { ...user.customClaims, grills })
  return result
})

export const claimPairing = onRequest({ region: REGION, cors: false }, async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' })
  const code = String(req.body?.code ?? '')
  const secret = String(req.body?.secret ?? '')
  if (!/^[0-9]{6}$/.test(code) || !secret) return json(res, 400, { error: 'invalid' })
  const ref = db.collection('pairing').doc(code)
  const snap = await ref.get()
  const doc = snap.data() as PairingDoc | undefined
  if (!doc || !secretMatches(secret, doc.secretHash)) return json(res, 404, { error: 'not_found' })
  if (doc.status !== 'claimed' || !doc.customToken || !doc.grillId) {
    if (Date.now() > doc.expiresAt) {
      await ref.delete()
      return json(res, 410, { error: 'expired' })
    }
    return json(res, 202, { status: 'pending' })
  }
  await ref.delete()
  return json(res, 200, {
    grillId: doc.grillId,
    customToken: doc.customToken,
    projectId: process.env.GCLOUD_PROJECT,
    apiKey: WEB_API_KEY.value(),
    databaseURL: DATABASE_URL.value() || rtdb.ref().toString().replace(/\/$/, ''),
  })
})

// --------------------------------------------------------------------------
// Members
// --------------------------------------------------------------------------

/** Owner adds/changes/removes a member by email. Keeps Firestore members and custom claims in sync. */
export const setMember = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first')
  const grillId = String(request.data?.grillId ?? '')
  const email = String(request.data?.email ?? '').trim().toLowerCase()
  const role = request.data?.role as Role | 'remove'
  if (!grillId || !email || !['owner', 'operator', 'viewer', 'remove'].includes(role)) throw new HttpsError('invalid-argument', 'grillId, email and role are required')
  const grillRef = db.collection('grills').doc(grillId)
  const grill = await grillRef.get()
  if (!grill.exists) throw new HttpsError('not-found', 'Unknown grill')
  const members = (grill.data()?.members ?? {}) as Record<string, Role>
  if (members[uid] !== 'owner') throw new HttpsError('permission-denied', 'Only the owner can manage members')
  let target
  try {
    target = await getAuth().getUserByEmail(email)
  } catch {
    throw new HttpsError('not-found', 'No FireAI account with that email. Ask them to sign in to the app once first.')
  }
  if (target.uid === uid && role !== 'owner') throw new HttpsError('failed-precondition', 'The owner cannot demote themselves')
  if (role === 'owner' && target.uid !== uid) throw new HttpsError('failed-precondition', 'Ownership transfer is not supported yet')
  const next = { ...members }
  if (role === 'remove') delete next[target.uid]
  else next[target.uid] = role
  await grillRef.update({ members: next })
  const claims = { ...(target.customClaims ?? {}) }
  const grills = { ...((claims.grills as Record<string, Role>) ?? {}) }
  if (role === 'remove') delete grills[grillId]
  else grills[grillId] = role
  await getAuth().setCustomUserClaims(target.uid, { ...claims, grills })
  await db.collection('users').doc(target.uid).set({ grillIds: role === 'remove' ? FieldValue.arrayRemove(grillId) : FieldValue.arrayUnion(grillId) }, { merge: true })
  return { members: Object.fromEntries(Object.entries(next).map(([k, v]) => [k, v])) }
})

/** Resolve member uids to display names/emails for the members page (owner or member). */
export const listMembers = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first')
  const grillId = String(request.data?.grillId ?? '')
  const grill = await db.collection('grills').doc(grillId).get()
  const members = (grill.data()?.members ?? {}) as Record<string, Role>
  if (!members[uid]) throw new HttpsError('permission-denied', 'Not a member')
  const users = await getAuth().getUsers(Object.keys(members).map((u) => ({ uid: u })))
  return {
    members: users.users.map((u) => ({ uid: u.uid, email: u.email ?? '', displayName: u.displayName ?? '', role: members[u.uid] })),
    ownerUid: grill.data()?.ownerUid,
  }
})

// --------------------------------------------------------------------------
// Commands
// --------------------------------------------------------------------------

export const sendCommand = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first')
  const grillId = String(request.data?.grillId ?? '')
  const name = String(request.data?.name ?? '')
  if (!grillId || !name) throw new HttpsError('invalid-argument', 'grillId and name are required')
  const grill = await db.collection('grills').doc(grillId).get()
  if (!grill.exists) throw new HttpsError('not-found', 'Unknown grill')
  const role = (grill.data()?.members ?? {})[uid] as Role | undefined
  const v = validateCommand(name, request.data?.args, role)
  if (!v.ok) throw new HttpsError('permission-denied', v.error)
  // The Pi mirrors its local cloud settings; the bridge enforces the same flag itself.
  const settings = await db.collection('grills').doc(grillId).collection('settings').doc('current').get()
  const cloud = (settings.data()?.cloud ?? {}) as { control_enabled?: boolean }
  if (!cloud.control_enabled) {
    throw new HttpsError('failed-precondition', 'Cloud control is switched off on this grill')
  }
  const cmdRef = rtdb.ref(`grills/${grillId}/commands`).push()
  await cmdRef.set({ name, args: v.args, uid, createdAt: ServerValue.TIMESTAMP, nonce: randomBytes(12).toString('base64url'), status: 'pending' })
  return { commandId: cmdRef.key }
})

export const cleanupStaleCommands = onSchedule({ region: REGION, schedule: 'every 60 minutes' }, async () => {
  const cutoff = Date.now() - COMMAND_TTL_MS
  const grills = await rtdb.ref('grills').get()
  const removals: Promise<void>[] = []
  grills.forEach((g) => {
    g.child('commands').forEach((c) => {
      if ((c.val()?.createdAt ?? 0) < cutoff) removals.push(c.ref.remove())
      return false
    })
    return false
  })
  await Promise.all(removals)
  logger.info(`cleanupStaleCommands removed ${removals.length}`)
})

// --------------------------------------------------------------------------
// Notifications -> FCM
// --------------------------------------------------------------------------

export const onNotification = onValueCreated({ region: REGION, ref: '/grills/{grillId}/notifications/{id}' }, async (event) => {
  const grillId = event.params.grillId
  const n = event.data.val() as { title?: string; body?: string; event?: string; ts?: number } | null
  if (!n) return
  const grill = await db.collection('grills').doc(grillId).get()
  const members = Object.keys((grill.data()?.members ?? {}) as Record<string, string>)
  if (!members.length) return
  const users = await db.getAll(...members.map((m) => db.collection('users').doc(m)))
  const tokens = users.flatMap((u) => Object.keys((u.data()?.fcmTokens ?? {}) as Record<string, unknown>))
  if (!tokens.length) return
  const grillName = (grill.data()?.name as string) ?? 'FireAI'
  const resp = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title: n.title ?? grillName, body: n.body ?? n.event ?? '' },
    data: { grillId, event: n.event ?? '', url: `/g/${grillId}` },
    webpush: { fcmOptions: { link: `/g/${grillId}` }, notification: { icon: '/icons/icon-192.png', badge: '/icons/icon-192.png' } },
  })
  // Prune dead tokens.
  const dead: string[] = []
  resp.responses.forEach((r, i) => {
    if (!r.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(r.error?.code ?? '')) dead.push(tokens[i])
  })
  if (dead.length) {
    await Promise.all(
      users.map((u) => {
        const mine = dead.filter((t) => t in ((u.data()?.fcmTokens ?? {}) as Record<string, unknown>))
        if (!mine.length) return Promise.resolve()
        const patch: Record<string, unknown> = {}
        for (const t of mine) patch[`fcmTokens.${t}`] = FieldValue.delete()
        return u.ref.update(patch)
      }),
    )
  }
  // Keep the notification ring short.
  const ring = await rtdb.ref(`grills/${grillId}/notifications`).orderByKey().get()
  const keys: string[] = []
  ring.forEach((c) => {
    keys.push(c.key!)
    return false
  })
  if (keys.length > 100) await Promise.all(keys.slice(0, keys.length - 100).map((k) => rtdb.ref(`grills/${grillId}/notifications/${k}`).remove()))
})

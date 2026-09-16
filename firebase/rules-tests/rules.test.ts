// Security rules tests. Run with the emulators:
//   cd firebase && firebase emulators:exec --only database,firestore --project fireai-dev "cd rules-tests && npx vitest run"
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { ref as rtdbRef, get as rtdbGet, set as rtdbSet, update as rtdbUpdate } from 'firebase/database'

const PROJECT = 'fireai-dev'
const GRILL = 'g_test'
const OWNER = 'owner1'
const MEMBER = 'member1'
const STRANGER = 'stranger1'
const BRIDGE = { uid: `grill_${GRILL}`, bridge: true, grill: GRILL }

let env: RulesTestEnvironment

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync('../firestore.rules', 'utf8'), host: '127.0.0.1', port: 8081 },
    database: { rules: readFileSync('../database.rules.json', 'utf8'), host: '127.0.0.1', port: 9000 },
  })
})

afterAll(async () => {
  await env.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
  await env.clearDatabase()
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'grills', GRILL), { name: 'Pit', ownerUid: OWNER, members: { [OWNER]: 'owner', [MEMBER]: 'operator' }, cloudControl: true })
    await setDoc(doc(ctx.firestore(), 'grills', GRILL, 'cooks', 'c1'), { title: 'Brisket', notes: '', startedAt: 1 })
    await rtdbSet(rtdbRef(ctx.database(), `grills/${GRILL}/commands/cmd1`), { name: 'mode.stop', args: {}, uid: OWNER, createdAt: 1, nonce: 'n', status: 'pending' })
  })
})

const user = (uid: string, grills: Record<string, string> = {}) => env.authenticatedContext(uid, { grills })
const bridge = () => env.authenticatedContext(BRIDGE.uid, { bridge: true, grill: GRILL })
const anon = () => env.unauthenticatedContext()

describe('Firestore: grills', () => {
  it('members and bridge can read, strangers cannot', async () => {
    await assertSucceeds(getDoc(doc(user(OWNER).firestore(), 'grills', GRILL)))
    await assertSucceeds(getDoc(doc(user(MEMBER).firestore(), 'grills', GRILL)))
    await assertSucceeds(getDoc(doc(bridge().firestore(), 'grills', GRILL)))
    await assertFails(getDoc(doc(user(STRANGER).firestore(), 'grills', GRILL)))
    await assertFails(getDoc(doc(anon().firestore(), 'grills', GRILL)))
  })

  it('only the owner can rename; ownership cannot be transferred by update', async () => {
    await assertSucceeds(updateDoc(doc(user(OWNER).firestore(), 'grills', GRILL), { name: 'New' }))
    await assertFails(updateDoc(doc(user(MEMBER).firestore(), 'grills', GRILL), { name: 'Nope' }))
    await assertFails(updateDoc(doc(user(OWNER).firestore(), 'grills', GRILL), { ownerUid: MEMBER }))
    await assertFails(updateDoc(doc(user(OWNER).firestore(), 'grills', GRILL), { members: { [MEMBER]: 'owner' } }))
  })

  it('nobody can create grills directly', async () => {
    await assertFails(setDoc(doc(user(OWNER).firestore(), 'grills', 'g_new'), { ownerUid: OWNER, members: { [OWNER]: 'owner' } }))
  })

  it('settings mirror is bridge-write only', async () => {
    await assertSucceeds(setDoc(doc(bridge().firestore(), 'grills', GRILL, 'settings', 'current'), { globals: {} }))
    await assertFails(setDoc(doc(user(OWNER).firestore(), 'grills', GRILL, 'settings', 'current'), { globals: {} }))
    await assertSucceeds(getDoc(doc(user(MEMBER).firestore(), 'grills', GRILL, 'settings', 'current')))
  })

  it('cooks: bridge creates, members edit notes only, owner deletes', async () => {
    await assertSucceeds(setDoc(doc(bridge().firestore(), 'grills', GRILL, 'cooks', 'c2'), { title: 'x', startedAt: 2 }))
    await assertFails(setDoc(doc(user(MEMBER).firestore(), 'grills', GRILL, 'cooks', 'c3'), { title: 'x' }))
    await assertSucceeds(updateDoc(doc(user(MEMBER).firestore(), 'grills', GRILL, 'cooks', 'c1'), { notes: 'great bark', title: 'Brisket #1' }))
    await assertFails(updateDoc(doc(user(MEMBER).firestore(), 'grills', GRILL, 'cooks', 'c1'), { startedAt: 99 }))
    await assertSucceeds(setDoc(doc(bridge().firestore(), 'grills', GRILL, 'cooks', 'c1', 'samples', 'k0'), { t: [1], p: [2] }))
    await assertFails(setDoc(doc(user(MEMBER).firestore(), 'grills', GRILL, 'cooks', 'c1', 'samples', 'k1'), { t: [1] }))
  })

  it('pairing docs are never client-accessible', async () => {
    await assertFails(getDoc(doc(user(OWNER).firestore(), 'pairing', '123456')))
    await assertFails(setDoc(doc(anon().firestore(), 'pairing', '123456'), { secretHash: 'x' }))
  })

  it('users can only touch their own profile', async () => {
    await assertSucceeds(setDoc(doc(user(OWNER).firestore(), 'users', OWNER), { fcmTokens: { t1: 1 } }))
    await assertFails(setDoc(doc(user(OWNER).firestore(), 'users', MEMBER), { fcmTokens: { t1: 1 } }))
  })
})

describe('RTDB', () => {
  it('state: bridge writes, members read, strangers denied', async () => {
    await assertSucceeds(rtdbSet(rtdbRef(bridge().database(), `grills/${GRILL}/state`), { mode: 'Hold' }))
    await assertSucceeds(rtdbGet(rtdbRef(user(MEMBER, { [GRILL]: 'operator' }).database(), `grills/${GRILL}/state`)))
    await assertFails(rtdbGet(rtdbRef(user(STRANGER).database(), `grills/${GRILL}/state`)))
    await assertFails(rtdbSet(rtdbRef(user(OWNER, { [GRILL]: 'owner' }).database(), `grills/${GRILL}/state`), { mode: 'Hold' }))
    await assertFails(rtdbGet(rtdbRef(anon().database(), `grills/${GRILL}/state`)))
  })

  it('bridge for another grill cannot write here', async () => {
    const other = env.authenticatedContext('grill_other', { bridge: true, grill: 'g_other' })
    await assertFails(rtdbSet(rtdbRef(other.database(), `grills/${GRILL}/state`), { mode: 'x' }))
  })

  it('commands: nobody creates via client, bridge can only update status fields', async () => {
    await assertFails(rtdbSet(rtdbRef(user(OWNER, { [GRILL]: 'owner' }).database(), `grills/${GRILL}/commands/new`), { name: 'mode.startup', args: {}, uid: OWNER, createdAt: 1, nonce: 'x', status: 'pending' }))
    await assertFails(rtdbSet(rtdbRef(bridge().database(), `grills/${GRILL}/commands/new`), { name: 'mode.startup', args: {}, uid: OWNER, createdAt: 1, nonce: 'x', status: 'pending' }))
    await assertSucceeds(rtdbUpdate(rtdbRef(bridge().database(), `grills/${GRILL}/commands/cmd1`), { status: 'acked', ackedAt: 2 }))
    await assertFails(rtdbUpdate(rtdbRef(bridge().database(), `grills/${GRILL}/commands/cmd1`), { name: 'mode.startup' }))
    await assertFails(rtdbUpdate(rtdbRef(bridge().database(), `grills/${GRILL}/commands/cmd1`), { status: 'weird' }))
    await assertFails(rtdbUpdate(rtdbRef(bridge().database(), `grills/${GRILL}/commands/cmd1`), { createdAt: 999 }))
    await assertSucceeds(rtdbGet(rtdbRef(user(MEMBER, { [GRILL]: 'operator' }).database(), `grills/${GRILL}/commands/cmd1`)))
  })

  it('notifications and presence are bridge-write, member-read', async () => {
    await assertSucceeds(rtdbSet(rtdbRef(bridge().database(), `grills/${GRILL}/notifications/n1`), { title: 'Done', body: 'Probe1 hit 165' }))
    await assertFails(rtdbSet(rtdbRef(user(OWNER, { [GRILL]: 'owner' }).database(), `grills/${GRILL}/notifications/n2`), { title: 'x' }))
    await assertSucceeds(rtdbSet(rtdbRef(bridge().database(), `grills/${GRILL}/presence`), { lastSeen: 1 }))
    await assertSucceeds(rtdbGet(rtdbRef(user(OWNER, { [GRILL]: 'owner' }).database(), `grills/${GRILL}/presence`)))
  })
})

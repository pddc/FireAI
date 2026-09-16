import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeState } from '@/test/fixtures'

// ---- Firebase mocks -------------------------------------------------------
type Listener = (snap: { val: () => unknown; forEach?: (cb: (c: { key: string; val: () => unknown }) => boolean | void) => void }) => void
const listeners = new Map<string, Set<Listener>>()
const values = new Map<string, unknown>()

function emit(path: string) {
  listeners.get(path)?.forEach((l) => l({ val: () => values.get(path) ?? null }))
}

vi.mock('firebase/database', () => ({
  ref: (_db: unknown, path: string) => ({ path }),
  onValue: (r: { path: string }, cb: Listener) => {
    if (!listeners.has(r.path)) listeners.set(r.path, new Set())
    listeners.get(r.path)!.add(cb)
    cb({ val: () => values.get(r.path) ?? null })
    return () => listeners.get(r.path)!.delete(cb)
  },
  off: () => {},
  get: async (r: { path: string }) => ({ val: () => values.get(r.path) ?? null, forEach: () => {} }),
}))
const callable = vi.fn()
vi.mock('firebase/functions', () => ({ httpsCallable: () => callable }))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), doc: vi.fn(), getDoc: vi.fn(async () => ({ data: () => ({ cloud: { control_enabled: true } }) })),
  getDocs: vi.fn(), orderBy: vi.fn(), query: vi.fn(), limit: vi.fn(), where: vi.fn(),
}))
vi.mock('@/lib/firebase', () => ({ firebaseRtdb: () => ({}), firebaseFirestore: () => ({}), firebaseFunctions: () => ({}), IS_CLOUD: true }))

import { CloudSource, PRESENCE_STALE_MS } from './CloudSource'

beforeEach(() => {
  listeners.clear()
  values.clear()
  callable.mockReset()
  vi.useFakeTimers()
  vi.setSystemTime(1_700_000_000_000)
})

describe('CloudSource', () => {
  it('connects on first state snapshot and tracks presence freshness', async () => {
    values.set('grills/g1/state', makeState({ mode: 'Smoke' }))
    values.set('grills/g1/presence', { lastSeen: Date.now() - 1000 })
    const src = new CloudSource('g1')
    const statuses: string[] = []
    src.onStatus((s) => statuses.push(s))
    await src.connect()
    expect(src.current()?.mode).toBe('Smoke')
    expect(statuses.at(-1)).toBe('live')
    // heartbeat goes stale
    vi.setSystemTime(Date.now() + PRESENCE_STALE_MS + 1000)
    vi.advanceTimersByTime(5000)
    expect(statuses.at(-1)).toBe('offline')
    // bridge comes back
    values.set('grills/g1/presence', { lastSeen: Date.now() })
    emit('grills/g1/presence')
    expect(statuses.at(-1)).toBe('live')
  })

  it('pushes new state snapshots to listeners', async () => {
    values.set('grills/g1/state', makeState({ mode: 'Stop' }))
    const src = new CloudSource('g1')
    const modes: string[] = []
    src.onState((s) => modes.push(s.mode))
    await src.connect()
    values.set('grills/g1/state', makeState({ mode: 'Hold' }))
    emit('grills/g1/state')
    expect(modes).toEqual(['Stop', 'Hold'])
  })

  it('command resolves when the bridge marks it done', async () => {
    values.set('grills/g1/state', makeState())
    const src = new CloudSource('g1')
    await src.connect()
    callable.mockResolvedValue({ data: { commandId: 'c1' } })
    const p = src.command('mode.hold', { setpoint: 225 })
    values.set('grills/g1/commands/c1', { status: 'pending' })
    emit('grills/g1/commands/c1')
    values.set('grills/g1/commands/c1', { status: 'done', result: { setpoint: 225 } })
    emit('grills/g1/commands/c1')
    await expect(p).resolves.toMatchObject({ result: 'OK', data: { setpoint: 225 } })
    expect(callable).toHaveBeenCalledWith({ grillId: 'g1', name: 'mode.hold', args: { setpoint: 225 } })
  })

  it('command rejects with the bridge error', async () => {
    values.set('grills/g1/state', makeState())
    const src = new CloudSource('g1')
    await src.connect()
    callable.mockResolvedValue({ data: { commandId: 'c2' } })
    const p = src.command('mode.stop')
    values.set('grills/g1/commands/c2', { status: 'rejected', error: 'cloud control is disabled on this grill' })
    emit('grills/g1/commands/c2')
    await expect(p).rejects.toThrow('cloud control is disabled')
  })

  it('command times out when the grill never answers', async () => {
    values.set('grills/g1/state', makeState())
    const src = new CloudSource('g1')
    await src.connect()
    callable.mockResolvedValue({ data: { commandId: 'c3' } })
    const p = src.command('mode.stop')
    const assertion = expect(p).rejects.toThrow('did not respond')
    await vi.advanceTimersByTimeAsync(46_000)
    await assertion
  })
})

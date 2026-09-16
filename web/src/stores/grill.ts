import { create } from 'zustand'
import type { GrillSource } from '@/lib/source/GrillSource'
import type { CommandResult, ConnectionStatus, GrillState } from '@/types/state'

const LAST_STATE_KEY = 'fireai.lastState'

function readLastState(): { state: GrillState; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(LAST_STATE_KEY)
    return raw ? (JSON.parse(raw) as { state: GrillState; savedAt: number }) : null
  } catch {
    return null
  }
}

let lastSaved = 0
function saveLastState(state: GrillState) {
  const now = Date.now()
  if (now - lastSaved < 10_000) return // at most every 10 s
  lastSaved = now
  try {
    localStorage.setItem(LAST_STATE_KEY, JSON.stringify({ state, savedAt: now }))
  } catch {
    /* quota / private mode */
  }
}

interface GrillStore {
  source: GrillSource | null
  state: GrillState | null
  status: ConnectionStatus
  lastError: string | null
  /** When the shown state is a cached copy from a previous session (offline start). */
  staleSince: number | null
  attach: (source: GrillSource) => Promise<void>
  detach: () => void
  command: (name: string, args?: Record<string, unknown>) => Promise<CommandResult>
}

export const useGrill = create<GrillStore>((set, getState) => ({
  source: null,
  state: null,
  status: 'connecting',
  lastError: null,
  staleSince: null,
  async attach(source) {
    getState().detach()
    const cached = readLastState()
    set({ source, status: 'connecting', lastError: null, state: cached?.state ?? null, staleSince: cached ? cached.savedAt : null })
    source.onState((state) => {
      saveLastState(state)
      set({ state, staleSince: null })
    })
    source.onStatus((status) => set({ status }))
    try {
      await source.connect()
    } catch (e) {
      set({ lastError: (e as Error).message, status: 'offline' })
      throw e
    }
  },
  detach() {
    getState().source?.disconnect()
    set({ source: null })
  },
  command(name, args) {
    const src = getState().source
    if (!src) return Promise.reject(new Error('Not connected'))
    return src.command(name, args)
  },
}))

/** Convenience selectors */
export const useGrillState = () => useGrill((s) => s.state)
export const useConnection = () => useGrill((s) => s.status)

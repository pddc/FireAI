import { create } from 'zustand'
import type { GrillSource } from '@/lib/source/GrillSource'
import type { CommandResult, ConnectionStatus, GrillState } from '@/types/state'

interface GrillStore {
  source: GrillSource | null
  state: GrillState | null
  status: ConnectionStatus
  lastError: string | null
  attach: (source: GrillSource) => Promise<void>
  detach: () => void
  command: (name: string, args?: Record<string, unknown>) => Promise<CommandResult>
}

export const useGrill = create<GrillStore>((set, getState) => ({
  source: null,
  state: null,
  status: 'connecting',
  lastError: null,
  async attach(source) {
    getState().detach()
    set({ source, status: 'connecting', lastError: null })
    source.onState((state) => set({ state }))
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

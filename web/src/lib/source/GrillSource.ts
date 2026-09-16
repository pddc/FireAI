// The one interface the UI talks to. Two implementations:
//   LocalSource  - REST + WebSocket against the Pi's FastAPI (this slice)
//   CloudSource  - Firebase RTDB/Firestore + callable commands (slice C/D)
// The UI never knows which one it has.

import type { CommandInfo, CommandResult, ConnectionStatus, CookDoc, CookSummary, EventRow, GrillState, HistoryRow } from '@/types/state'

export type StateListener = (state: GrillState) => void
export type StatusListener = (status: ConnectionStatus) => void
export type Unsubscribe = () => void

export interface GrillSource {
  readonly kind: 'local' | 'cloud'
  /** Start streaming state. Resolves once the first snapshot arrived (or fails). */
  connect(): Promise<void>
  disconnect(): void
  onState(listener: StateListener): Unsubscribe
  onStatus(listener: StatusListener): Unsubscribe
  /** Latest snapshot, if any. */
  current(): GrillState | null

  command(name: string, args?: Record<string, unknown>): Promise<CommandResult>
  listCommands(): Promise<CommandInfo[]>

  getSettings(): Promise<Record<string, unknown>>
  patchSettings(patch: Record<string, unknown>): Promise<{ changed: string[]; settings: Record<string, unknown> }>

  getHistory(limit?: number): Promise<HistoryRow[]>
  getEvents(limit?: number): Promise<EventRow[]>
  getPellets(): Promise<Record<string, unknown>>

  listCooks(): Promise<CookSummary[]>
  getCook(id: string): Promise<CookDoc>
  updateCook(id: string, patch: { title?: string; notes?: string }): Promise<void>
  addCookComment(id: string, text: string): Promise<void>
  deleteCook(id: string): Promise<void>
  /** URL for an image inside a cook (local streams from the API; cloud from Storage). */
  cookAssetUrl(id: string, assetId: string, thumb?: boolean): string
}

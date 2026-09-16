import { API_BASE, api, get, patch, post, wsUrl } from '@/lib/api'
import type { CommandInfo, CommandResult, ConnectionStatus, CookDoc, CookSummary, EventRow, GrillState, HistoryRow } from '@/types/state'
import type { GrillSource, StateListener, StatusListener, Unsubscribe } from './GrillSource'

const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 15000
const PING_MS = 20000

export class LocalSource implements GrillSource {
  readonly kind = 'local' as const
  private ws: WebSocket | null = null
  private state: GrillState | null = null
  private status: ConnectionStatus = 'connecting'
  private stateListeners = new Set<StateListener>()
  private statusListeners = new Set<StatusListener>()
  private reconnectDelay = RECONNECT_MIN_MS
  private reconnectTimer: number | null = null
  private pingTimer: number | null = null
  private closedByUser = false

  private getToken: () => string | null

  constructor(getToken: () => string | null) {
    this.getToken = getToken
  }

  async connect(): Promise<void> {
    this.closedByUser = false
    // Prime with a REST snapshot so the UI has data even if the socket is slow.
    this.state = await get<GrillState>('/api/v1/state')
    this.emitState()
    this.openSocket()
  }

  disconnect(): void {
    this.closedByUser = true
    this.clearTimers()
    this.ws?.close()
    this.ws = null
    this.setStatus('offline')
  }

  onState(listener: StateListener): Unsubscribe {
    this.stateListeners.add(listener)
    if (this.state) listener(this.state)
    return () => this.stateListeners.delete(listener)
  }

  onStatus(listener: StatusListener): Unsubscribe {
    this.statusListeners.add(listener)
    listener(this.status)
    return () => this.statusListeners.delete(listener)
  }

  current(): GrillState | null {
    return this.state
  }

  // ----- commands / data ---------------------------------------------------
  command(name: string, args: Record<string, unknown> = {}): Promise<CommandResult> {
    return post<CommandResult>(`/api/v1/commands/${name}`, { args })
  }

  listCommands(): Promise<CommandInfo[]> {
    return get<CommandInfo[]>('/api/v1/commands')
  }

  getSettings(): Promise<Record<string, unknown>> {
    return get('/api/v1/settings')
  }

  patchSettings(p: Record<string, unknown>) {
    return patch<{ changed: string[]; settings: Record<string, unknown> }>('/api/v1/settings', { patch: p })
  }

  async getHistory(limit = 0): Promise<HistoryRow[]> {
    const r = await get<{ rows: HistoryRow[] }>(`/api/v1/history?limit=${limit}`)
    return r.rows
  }

  async getEvents(limit = 200): Promise<EventRow[]> {
    const r = await get<{ events: EventRow[] }>(`/api/v1/events?limit=${limit}`)
    return r.events
  }

  getPellets(): Promise<Record<string, unknown>> {
    return get('/api/v1/pellets')
  }

  async listCooks(): Promise<CookSummary[]> {
    const r = await get<{ cooks: (CookSummary & { filename: string })[] }>('/api/v1/cooks')
    return r.cooks.map((c) => ({ ...c, id: c.filename }))
  }

  async getCook(id: string): Promise<CookDoc> {
    type Raw = { filename: string; metadata: CookDoc['metadata']; graph_labels: CookDoc['labels']; raw_data: HistoryRow[]; events: unknown[]; comments: CookDoc['comments']; assets: CookDoc['assets'] }
    const d = await get<Raw>(`/api/v1/cooks/${encodeURIComponent(id)}`)
    return { id, filename: d.filename, metadata: d.metadata, rows: d.raw_data ?? [], labels: d.graph_labels, events: d.events ?? [], comments: d.comments ?? [], assets: d.assets ?? [] }
  }

  async updateCook(id: string, p: { title?: string }): Promise<void> {
    await patch(`/api/v1/cooks/${encodeURIComponent(id)}`, p)
  }

  async addCookComment(id: string, text: string): Promise<void> {
    await post(`/api/v1/cooks/${encodeURIComponent(id)}/comments`, { text })
  }

  async deleteCook(id: string): Promise<void> {
    await api(`/api/v1/cooks/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  cookAssetUrl(id: string, assetId: string, thumb = false): string {
    const token = this.getToken()
    return `${API_BASE}/api/v1/cooks/${encodeURIComponent(id)}/assets/${assetId}?thumb=${thumb}${token ? `&token=${token}` : ''}`
  }

  // ----- socket ------------------------------------------------------------
  private openSocket() {
    if (this.closedByUser) return
    this.setStatus('connecting')
    const ws = new WebSocket(wsUrl('/ws/state', this.getToken()))
    this.ws = ws
    ws.onopen = () => {
      this.reconnectDelay = RECONNECT_MIN_MS
      this.setStatus('live')
      this.pingTimer = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), PING_MS)
    }
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { type: string; data?: GrillState }
        if (msg.type === 'state' && msg.data) {
          this.state = msg.data
          this.emitState()
        }
      } catch {
        /* ignore malformed frames */
      }
    }
    ws.onclose = () => {
      this.clearTimers()
      if (this.closedByUser) return
      this.setStatus('offline')
      this.reconnectTimer = window.setTimeout(() => this.openSocket(), this.reconnectDelay)
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS)
    }
    ws.onerror = () => ws.close()
  }

  private clearTimers() {
    if (this.pingTimer) window.clearInterval(this.pingTimer)
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer)
    this.pingTimer = null
    this.reconnectTimer = null
  }

  private setStatus(s: ConnectionStatus) {
    if (s === this.status) return
    this.status = s
    this.statusListeners.forEach((l) => l(s))
  }

  private emitState() {
    if (!this.state) return
    this.stateListeners.forEach((l) => l(this.state!))
  }
}

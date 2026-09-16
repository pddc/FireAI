// GrillSource backed by Firebase: RTDB for live state/presence/commands,
// Firestore for settings mirror and cook archives, callable for commands.
import { get as rtdbGet, off, onValue, ref, type Unsubscribe as RtdbUnsub } from 'firebase/database'
import { arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, limit as fsLimit, updateDoc, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { firebaseFirestore, firebaseFunctions, firebaseRtdb } from '@/lib/firebase'
import type { CommandInfo, CommandResult, ConnectionStatus, CookDoc, CookSummary, EventRow, GrillState, HistoryRow } from '@/types/state'
import type { GrillSource, StateListener, StatusListener, Unsubscribe } from './GrillSource'

/** Presence older than this is reported as offline. Bridge heartbeats every 15 s. */
export const PRESENCE_STALE_MS = 45_000
const COMMAND_TIMEOUT_MS = 45_000

export class CloudSource implements GrillSource {
  readonly kind = 'cloud' as const
  private state: GrillState | null = null
  private status: ConnectionStatus = 'connecting'
  private stateListeners = new Set<StateListener>()
  private statusListeners = new Set<StatusListener>()
  private unsubs: RtdbUnsub[] = []
  private lastSeen = 0
  private controlEnabled = false
  private presenceTimer: number | null = null
  private serverOffset = 0
  readonly grillId: string

  constructor(grillId: string) {
    this.grillId = grillId
  }

  async connect(): Promise<void> {
    const db = firebaseRtdb()
    // Clock skew between this device and Firebase, for presence staleness.
    onValue(ref(db, '.info/serverTimeOffset'), (s) => (this.serverOffset = (s.val() as number) ?? 0))
    const stateRef = ref(db, `grills/${this.grillId}/state`)
    const presenceRef = ref(db, `grills/${this.grillId}/presence`)
    await new Promise<void>((resolve, reject) => {
      let first = true
      const u = onValue(
        stateRef,
        (snap) => {
          const v = snap.val() as GrillState | null
          if (v) {
            this.state = { ...v, cloud_control: this.controlEnabled }
            this.emitState()
          }
          if (first) {
            first = false
            resolve()
          }
        },
        (err) => {
          if (first) reject(err)
          this.setStatus('offline')
        },
      )
      this.unsubs.push(u)
    })
    const p = onValue(presenceRef, (snap) => {
      const v = snap.val() as { lastSeen?: number; controlEnabled?: boolean } | null
      this.lastSeen = v?.lastSeen ?? 0
      const enabled = !!v?.controlEnabled
      if (this.state && this.state.cloud_control !== enabled) {
        this.state = { ...this.state, cloud_control: enabled }
        this.emitState()
      }
      this.controlEnabled = enabled
      this.evaluatePresence()
    })
    this.unsubs.push(p)
    this.presenceTimer = window.setInterval(() => this.evaluatePresence(), 5000)
  }

  disconnect(): void {
    this.unsubs.forEach((u) => u())
    this.unsubs = []
    off(ref(firebaseRtdb(), '.info/serverTimeOffset'))
    if (this.presenceTimer) window.clearInterval(this.presenceTimer)
    this.presenceTimer = null
    this.setStatus('offline')
  }

  private evaluatePresence() {
    const now = Date.now() + this.serverOffset
    this.setStatus(this.lastSeen && now - this.lastSeen < PRESENCE_STALE_MS ? 'live' : 'offline')
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

  // ----- commands: callable creates it, we watch the doc for the bridge's verdict
  async command(name: string, args: Record<string, unknown> = {}): Promise<CommandResult> {
    const send = httpsCallable<{ grillId: string; name: string; args: Record<string, unknown> }, { commandId: string }>(firebaseFunctions(), 'sendCommand')
    const { data } = await send({ grillId: this.grillId, name, args })
    const cmdRef = ref(firebaseRtdb(), `grills/${this.grillId}/commands/${data.commandId}`)
    return new Promise<CommandResult>((resolve, reject) => {
      // onValue may fire synchronously with the current value, so the unsubscribe
      // handle is looked up lazily instead of captured before it exists.
      let unsub: (() => void) | null = null
      let settled = false
      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        queueMicrotask(() => unsub?.())
        fn()
      }
      const timer = window.setTimeout(() => finish(() => reject(new Error('The grill did not respond. It may be offline.'))), COMMAND_TIMEOUT_MS)
      unsub = onValue(cmdRef, (snap) => {
        const v = snap.val() as { status: string; error?: string; result?: Record<string, unknown> } | null
        if (!v) return
        if (v.status === 'done') {
          finish(() => resolve({ result: 'OK', message: `${name} done`, data: v.result ?? {} }))
        } else if (v.status === 'failed' || v.status === 'rejected') {
          finish(() => reject(new Error(v.error ?? `Command ${v.status}`)))
        }
      })
    })
  }

  async listCommands(): Promise<CommandInfo[]> {
    return []
  }

  async getSettings(): Promise<Record<string, unknown>> {
    const snap = await getDoc(doc(firebaseFirestore(), 'grills', this.grillId, 'settings', 'current'))
    return (snap.data() as Record<string, unknown>) ?? {}
  }

  async patchSettings(patch: Record<string, unknown>) {
    const r = await this.command('settings.patch', { patch })
    return { changed: (r.data.changed as string[]) ?? [], settings: await this.getSettings() }
  }

  /** History = samples of the most recent cook, flattened into HistoryRow shape. */
  async getHistory(): Promise<HistoryRow[]> {
    const fs = firebaseFirestore()
    const cooks = await getDocs(query(collection(fs, 'grills', this.grillId, 'cooks'), orderBy('startedAt', 'desc'), fsLimit(1)))
    if (cooks.empty) return []
    return this.cookRows(cooks.docs[0].id, (cooks.docs[0].data().probeLabels as string[]) ?? [])
  }

  private async cookRows(cookId: string, labels: string[]): Promise<HistoryRow[]> {
    const fs = firebaseFirestore()
    const chunks = await getDocs(query(collection(fs, 'grills', this.grillId, 'cooks', cookId, 'samples'), orderBy('index')))
    const rows: HistoryRow[] = []
    chunks.forEach((c) => {
      for (const r of (c.data().rows as { t: number; p: number | null; f: (number | null)[]; sp: number }[]) ?? []) {
        const F: Record<string, number | null> = {}
        labels.slice(1).forEach((l, i) => (F[l] = r.f?.[i] ?? null))
        rows.push({ T: r.t, P: { [labels[0] ?? 'Grill']: r.p }, F, AUX: {}, PSP: r.sp, NT: {} })
      }
    })
    return rows
  }

  async listCooks(): Promise<CookSummary[]> {
    const fs = firebaseFirestore()
    const snap = await getDocs(query(collection(fs, 'grills', this.grillId, 'cooks'), orderBy('startedAt', 'desc'), fsLimit(100)))
    return snap.docs.map((d) => {
      const v = d.data()
      return { id: d.id, title: (v.title as string) || new Date(v.startedAt as number).toLocaleString(), starttime: (v.startedAt as number) ?? null, endtime: (v.endedAt as number) ?? null, units: v.units as 'F' | 'C', status: v.status as string }
    })
  }

  async getCook(id: string): Promise<CookDoc> {
    const fs = firebaseFirestore()
    const snap = await getDoc(doc(fs, 'grills', this.grillId, 'cooks', id))
    if (!snap.exists()) throw new Error('Cook not found')
    const v = snap.data()
    const labels = (v.probeLabels as string[]) ?? []
    const rows = await this.cookRows(id, labels)
    return {
      id,
      metadata: { title: v.title as string, starttime: v.startedAt as number, endtime: v.endedAt as number, units: v.units as 'F' | 'C', notes: v.notes as string },
      rows,
      labels: { probes: Object.fromEntries(labels.map((l) => [l, l])) },
      events: [],
      comments: ((v.comments as CookDoc['comments']) ?? []).map((c) => ({ ...c })),
      assets: ((v.photos as { id: string; url: string }[]) ?? []).map((p) => ({ id: p.id, filename: p.url, type: 'jpg' })),
    }
  }

  async updateCook(id: string, p: { title?: string; notes?: string }): Promise<void> {
    await updateDoc(doc(firebaseFirestore(), 'grills', this.grillId, 'cooks', id), { ...p, updatedAt: Date.now() })
  }

  async addCookComment(id: string, text: string): Promise<void> {
    const now = new Date()
    await updateDoc(doc(firebaseFirestore(), 'grills', this.grillId, 'cooks', id), {
      comments: arrayUnion({ id: `${Date.now()}`, text, date: now.toISOString().slice(0, 10), time: now.toTimeString().slice(0, 5) }),
      updatedAt: Date.now(),
    })
  }

  async deleteCook(id: string): Promise<void> {
    await deleteDoc(doc(firebaseFirestore(), 'grills', this.grillId, 'cooks', id))
  }

  cookAssetUrl(_id: string, assetId: string): string {
    return assetId // cloud photos carry their download URL as the asset filename
  }

  async getEvents(limit = 100): Promise<EventRow[]> {
    const snap = await rtdbGet(ref(firebaseRtdb(), `grills/${this.grillId}/notifications`))
    const out: EventRow[] = []
    snap.forEach((c) => {
      const v = c.val() as { ts?: number; title?: string; body?: string }
      const d = new Date(v.ts ?? 0)
      out.push({ date: d.toLocaleDateString(), time: d.toLocaleTimeString(), message: `${v.title ?? ''}: ${v.body ?? ''}` })
      return false
    })
    return out.slice(-limit)
  }

  async getPellets(): Promise<Record<string, unknown>> {
    const snap = await getDoc(doc(firebaseFirestore(), 'grills', this.grillId, 'pellets', 'current'))
    return (snap.data() as Record<string, unknown>) ?? {}
  }

  static async listGrillsForUser(uid: string): Promise<{ id: string; name: string; role: string }[]> {
    const fs = firebaseFirestore()
    const q = query(collection(fs, 'grills'), where(`members.${uid}`, 'in', ['owner', 'operator', 'viewer']))
    const snap = await getDocs(q)
    return snap.docs.map((d) => ({ id: d.id, name: (d.data().name as string) ?? 'Grill', role: (d.data().members as Record<string, string>)[uid] }))
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

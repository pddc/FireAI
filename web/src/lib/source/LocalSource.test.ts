import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalSource } from './LocalSource'
import { makeState } from '@/test/fixtures'
import { configureApi } from '@/lib/api'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  url: string
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  send(s: string) {
    this.sent.push(s)
  }
  close() {
    this.readyState = 3
    this.onclose?.()
  }
  // test helpers
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  push(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}

describe('LocalSource', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    configureApi({ getToken: () => 't' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(makeState()) })),
    )
    vi.useFakeTimers()
  })

  it('primes with REST then streams from the socket', async () => {
    const src = new LocalSource(() => 't')
    const states: string[] = []
    const statuses: string[] = []
    src.onState((s) => states.push(s.mode))
    src.onStatus((s) => statuses.push(s))
    await src.connect()
    expect(states).toEqual(['Stop'])
    const ws = FakeWebSocket.instances[0]
    expect(ws.url).toContain('token=t')
    ws.open()
    expect(statuses.at(-1)).toBe('live')
    ws.push({ type: 'state', data: makeState({ mode: 'Hold' }) })
    expect(states).toEqual(['Stop', 'Hold'])
    expect(src.current()?.mode).toBe('Hold')
  })

  it('reconnects with backoff after close', async () => {
    const src = new LocalSource(() => 't')
    const statuses: string[] = []
    src.onStatus((s) => statuses.push(s))
    await src.connect()
    const ws = FakeWebSocket.instances[0]
    ws.open()
    ws.close()
    expect(statuses.at(-1)).toBe('offline')
    vi.advanceTimersByTime(1000)
    expect(FakeWebSocket.instances.length).toBe(2)
  })

  it('does not reconnect after disconnect()', async () => {
    const src = new LocalSource(() => 't')
    await src.connect()
    FakeWebSocket.instances[0].open()
    src.disconnect()
    vi.advanceTimersByTime(20000)
    expect(FakeWebSocket.instances.length).toBe(1)
  })

  it('sends pings while open', async () => {
    const src = new LocalSource(() => 't')
    await src.connect()
    const ws = FakeWebSocket.instances[0]
    ws.open()
    vi.advanceTimersByTime(20000)
    expect(ws.sent).toContain('ping')
  })
})

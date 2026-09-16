import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, configureApi, post, wsUrl } from './api'

function mockFetch(status: number, body: unknown) {
  const res = {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as Response
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => res)
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('api()', () => {
  beforeEach(() => configureApi({ getToken: () => 'tok' }))

  it('attaches the bearer token and parses JSON', async () => {
    const f = mockFetch(200, { a: 1 })
    const out = await api<{ a: number }>('/api/v1/state')
    expect(out).toEqual({ a: 1 })
    const headers = f.mock.calls[0][1]!.headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer tok')
  })

  it('turns structured FastAPI errors into ApiError', async () => {
    mockFetch(400, { detail: { code: 'state', message: 'Timer is not running', data: { x: 1 } } })
    await expect(post('/api/v1/commands/timer.pause')).rejects.toMatchObject({ status: 400, code: 'state', message: 'Timer is not running' })
  })

  it('handles validation error arrays', async () => {
    mockFetch(422, { detail: [{ msg: 'field required' }] })
    await expect(api('/x')).rejects.toMatchObject({ code: 'validation', message: 'field required' })
  })

  it('calls onUnauthorized on 401', async () => {
    const spy = vi.fn()
    configureApi({ getToken: () => null, onUnauthorized: spy })
    mockFetch(401, { detail: { code: 'unauthorized', message: 'nope' } })
    await expect(api('/x')).rejects.toBeInstanceOf(ApiError)
    expect(spy).toHaveBeenCalled()
  })

  it('network failures become ApiError status 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('boom')
      }),
    )
    await expect(api('/x')).rejects.toMatchObject({ status: 0, code: 'network' })
  })
})

describe('wsUrl', () => {
  it('switches scheme and adds token', () => {
    const u = wsUrl('/ws/state', 'abc')
    expect(u.startsWith('ws://')).toBe(true)
    expect(u).toContain('token=abc')
  })
})

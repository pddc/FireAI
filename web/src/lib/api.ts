// Thin fetch wrapper for the local FireAI API. Attaches the bearer token,
// normalises errors into ApiError, and exposes typed helpers.

export class ApiError extends Error {
  status: number
  code: string
  data?: unknown
  constructor(status: number, code: string, message: string, data?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.data = data
  }
}

let tokenProvider: () => string | null = () => null
let onUnauthorized: () => void = () => {}

export function configureApi(opts: { getToken: () => string | null; onUnauthorized?: () => void }) {
  tokenProvider = opts.getToken
  if (opts.onUnauthorized) onUnauthorized = opts.onUnauthorized
}

export const API_BASE = import.meta.env.VITE_API_BASE ?? ''

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type') && init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const token = tokenProvider()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  } catch (e) {
    throw new ApiError(0, 'network', (e as Error).message)
  }
  if (res.status === 204) return undefined as T
  let body: unknown = null
  const text = await res.text()
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) {
    const detail = (body as { detail?: unknown })?.detail
    let code = `http_${res.status}`
    let message = res.statusText
    let data: unknown
    if (Array.isArray(detail)) {
      message = (detail[0] as { msg?: string })?.msg ?? 'Validation error'
      code = 'validation'
    } else if (detail && typeof detail === 'object') {
      const d = detail as { code?: string; message?: string; data?: unknown }
      code = d.code ?? code
      message = d.message ?? message
      data = d.data
    } else if (typeof detail === 'string') {
      message = detail
    }
    if (res.status === 401) onUnauthorized()
    throw new ApiError(res.status, code, message, data)
  }
  return body as T
}

export const get = <T>(path: string) => api<T>(path)
export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body: JSON.stringify(body) })
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' })
/** Multipart upload of one file (photos, imported archives). */
export const upload = <T>(path: string, file: File | Blob, field = 'file') => {
  const fd = new FormData()
  fd.append(field, file)
  return api<T>(path, { method: 'POST', body: fd })
}
/** URL for a download link: the API accepts the session token as a query parameter for browser navigations. */
export function downloadUrl(path: string): string {
  const token = tokenProvider()
  return `${API_BASE}${path}${token ? `${path.includes('?') ? '&' : '?'}token=${token}` : ''}`
}

export function wsUrl(path: string, token: string | null): string {
  const base = API_BASE || window.location.origin
  const url = new URL(path, base)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  if (token) url.searchParams.set('token', token)
  return url.toString()
}

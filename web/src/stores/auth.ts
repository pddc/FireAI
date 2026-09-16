import { create } from 'zustand'
import { get, post } from '@/lib/api'

const TOKEN_KEY = 'fireai.token'

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

interface AuthState {
  token: string | null
  setupRequired: boolean | null
  authDisabled: boolean
  role: string | null
  checking: boolean
  /** Ask the server whether setup is needed and whether our token still works. */
  bootstrap: () => Promise<void>
  setup: (password: string) => Promise<void>
  login: (password: string) => Promise<void>
  logout: () => void
}

export const useAuth = create<AuthState>((set, getState) => ({
  token: readToken(),
  setupRequired: null,
  authDisabled: false,
  role: null,
  checking: true,
  async bootstrap() {
    set({ checking: true })
    try {
      const status = await get<{ setup_required: boolean; auth_disabled: boolean }>('/api/v1/auth/status')
      let role: string | null = null
      if (!status.setup_required && (getState().token || status.auth_disabled)) {
        try {
          const me = await get<{ role: string }>('/api/v1/auth/me')
          role = me.role
        } catch {
          role = null
          if (!status.auth_disabled) getState().logout()
        }
      }
      set({ setupRequired: status.setup_required, authDisabled: status.auth_disabled, role, checking: false })
    } catch {
      set({ checking: false })
    }
  },
  async setup(password) {
    const r = await post<{ token: string; role: string }>('/api/v1/auth/setup', { password })
    try {
      localStorage.setItem(TOKEN_KEY, r.token)
    } catch {
      /* private mode */
    }
    set({ token: r.token, role: r.role, setupRequired: false })
  },
  async login(password) {
    const r = await post<{ token: string; role: string }>('/api/v1/auth/login', { password })
    try {
      localStorage.setItem(TOKEN_KEY, r.token)
    } catch {
      /* private mode */
    }
    set({ token: r.token, role: r.role })
  },
  logout() {
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {
      /* ignore */
    }
    set({ token: null, role: null })
  },
}))

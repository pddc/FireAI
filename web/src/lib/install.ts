// "Add to home screen" helpers. Android/desktop Chrome fire beforeinstallprompt;
// iOS Safari never does, so we detect it and show instructions instead.
import { create } from 'zustand'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface InstallState {
  deferred: BeforeInstallPromptEvent | null
  installed: boolean
  promptInstall: () => Promise<boolean>
}

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream

export const useInstall = create<InstallState>((set, get) => ({
  deferred: null,
  installed: typeof window !== 'undefined' && isStandalone(),
  async promptInstall() {
    const ev = get().deferred
    if (!ev) return false
    await ev.prompt()
    const { outcome } = await ev.userChoice
    set({ deferred: null, installed: outcome === 'accepted' })
    return outcome === 'accepted'
  },
}))

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    useInstall.setState({ deferred: e as BeforeInstallPromptEvent })
  })
  window.addEventListener('appinstalled', () => useInstall.setState({ installed: true, deferred: null }))
}

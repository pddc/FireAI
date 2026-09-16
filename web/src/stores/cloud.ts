import { create } from 'zustand'
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { firebaseAuth, firebaseFunctions } from '@/lib/firebase'
import { CloudSource } from '@/lib/source/CloudSource'

export interface GrillSummary {
  id: string
  name: string
  role: string
}

interface CloudState {
  user: User | null
  ready: boolean
  grills: GrillSummary[]
  grillsLoading: boolean
  init: () => void
  signInWithGoogle: () => Promise<void>
  signInWithEmail: (email: string, password: string) => Promise<void>
  signUpWithEmail: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshGrills: () => Promise<void>
  pair: (code: string, name: string) => Promise<string>
}

let initialised = false

export const useCloud = create<CloudState>((set, get) => ({
  user: null,
  ready: false,
  grills: [],
  grillsLoading: false,
  init() {
    if (initialised) return
    initialised = true
    onAuthStateChanged(firebaseAuth(), async (user) => {
      set({ user, ready: true })
      if (user) await get().refreshGrills()
      else set({ grills: [] })
    })
  },
  async signInWithGoogle() {
    await signInWithPopup(firebaseAuth(), new GoogleAuthProvider())
  },
  async signInWithEmail(email, password) {
    await signInWithEmailAndPassword(firebaseAuth(), email, password)
  },
  async signUpWithEmail(email, password) {
    await createUserWithEmailAndPassword(firebaseAuth(), email, password)
  },
  async signOut() {
    await fbSignOut(firebaseAuth())
  },
  async refreshGrills() {
    const user = get().user
    if (!user) return
    set({ grillsLoading: true })
    try {
      const grills = await CloudSource.listGrillsForUser(user.uid)
      set({ grills })
    } finally {
      set({ grillsLoading: false })
    }
  },
  async pair(code, name) {
    const fn = httpsCallable<{ code: string; name: string }, { grillId: string }>(firebaseFunctions(), 'pairGrill')
    const { data } = await fn({ code, name })
    // Membership lives in custom claims: force a token refresh so rules see it.
    await get().user?.getIdToken(true)
    await get().refreshGrills()
    return data.grillId
  },
}))

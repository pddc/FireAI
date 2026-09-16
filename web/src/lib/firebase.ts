// Firebase SDK initialisation for cloud mode. Everything is lazy so the local
// build never pulls Firebase into its bundle path at runtime.
import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth'
import { getDatabase, connectDatabaseEmulator, type Database } from 'firebase/database'
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator, type Functions } from 'firebase/functions'

export { IS_CLOUD } from '@/lib/mode'

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL as string,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
}

let app: FirebaseApp | null = null
let auth: Auth | null = null
let rtdb: Database | null = null
let fs: Firestore | null = null
let fns: Functions | null = null

function useEmulators() {
  return import.meta.env.VITE_FIREBASE_EMULATORS === '1'
}

export function firebaseApp(): FirebaseApp {
  if (!app) app = initializeApp(firebaseConfig)
  return app
}

export function firebaseAuth(): Auth {
  if (!auth) {
    auth = getAuth(firebaseApp())
    if (useEmulators()) connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  }
  return auth
}

export function firebaseRtdb(): Database {
  if (!rtdb) {
    rtdb = getDatabase(firebaseApp())
    if (useEmulators()) connectDatabaseEmulator(rtdb, '127.0.0.1', 9000)
  }
  return rtdb
}

export function firebaseFirestore(): Firestore {
  if (!fs) {
    fs = getFirestore(firebaseApp())
    if (useEmulators()) connectFirestoreEmulator(fs, '127.0.0.1', 8081)
  }
  return fs
}

export function firebaseFunctions(): Functions {
  if (!fns) {
    fns = getFunctions(firebaseApp(), (import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION as string) || 'us-central1')
    if (useEmulators()) connectFunctionsEmulator(fns, '127.0.0.1', 5001)
  }
  return fns
}

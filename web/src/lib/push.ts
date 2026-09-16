// Web push registration for cloud mode. Tokens are stored under
// users/{uid}.fcmTokens.{token} = timestamp; Functions fan out to them.
import { getMessaging, getToken, isSupported } from 'firebase/messaging'
import { doc, setDoc, deleteField } from 'firebase/firestore'
import { firebaseApp, firebaseFirestore } from '@/lib/firebase'

const TOKEN_KEY = 'fireai.fcmToken'

export async function pushSupported(): Promise<boolean> {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && (await isSupported())
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

/** Ask for permission, obtain an FCM token bound to our service worker, and store it on the user. */
export async function enablePush(uid: string): Promise<string> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications were not allowed')
  const reg = await navigator.serviceWorker.ready
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined
  const token = await getToken(getMessaging(firebaseApp()), { vapidKey, serviceWorkerRegistration: reg })
  if (!token) throw new Error('Could not get a push token')
  await setDoc(doc(firebaseFirestore(), 'users', uid), { fcmTokens: { [token]: Date.now() } }, { merge: true })
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* ignore */
  }
  return token
}

export async function disablePush(uid: string): Promise<void> {
  let token: string | null = null
  try {
    token = localStorage.getItem(TOKEN_KEY)
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
  if (token) await setDoc(doc(firebaseFirestore(), 'users', uid), { fcmTokens: { [token]: deleteField() } }, { merge: true })
}

export function pushEnabled(): boolean {
  try {
    return !!localStorage.getItem(TOKEN_KEY) && pushPermission() === 'granted'
  } catch {
    return false
  }
}

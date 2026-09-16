/// <reference lib="webworker" />
// FireAI service worker: workbox precache (app shell) + Firebase Cloud Messaging background handler.
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { clientsClaim } from 'workbox-core'

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> }

self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// SPA navigation fallback, but never for API/docs paths.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//, /^\/ws\//, /^\/docs/, /^\/openapi\.json/, /^\/health/] }))

// Background push (FCM data/notification messages). The Firebase SDK is only
// initialised when the page passed us config via postMessage, so the local
// (no-cloud) build never contacts Firebase.
self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload: { notification?: { title?: string; body?: string }; data?: Record<string, string> } = {}
  try {
    payload = event.data.json()
  } catch {
    payload = { notification: { title: 'FireAI', body: event.data.text() } }
  }
  const n = payload.notification ?? {}
  const title = n.title ?? payload.data?.title ?? 'FireAI'
  const body = n.body ?? payload.data?.body ?? ''
  const url = payload.data?.url ?? '/'
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: payload.data?.event ?? 'fireai',
      data: { url },
      // vibrate is not in the TS lib for NotificationOptions but is honoured by Android Chrome
      ...({ vibrate: [100, 50, 100] } as Record<string, unknown>),
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string })?.url ?? '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.navigate?.(url)
          return c.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})

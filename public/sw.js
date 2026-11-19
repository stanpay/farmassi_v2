// 빌드 시 git 커밋 해시로 치환됩니다. 값이 바뀌면 설치된 PWA가 새 서비스 워커를 받습니다.
const SW_VERSION = '__GIT_COMMIT__'

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request, { cache: 'no-store' }))
    return
  }

  const url = new URL(event.request.url)
  if (url.origin === self.location.origin && (url.pathname === '/index.html' || url.pathname === '/sw.js')) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }))
  }
})

self.addEventListener('push', (event) => {
  let data = { title: '팜어시', body: '새 알림이 있습니다.', url: '/' }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch {
    // keep defaults
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
      data: { url: data.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate?.(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})

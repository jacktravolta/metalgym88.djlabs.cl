/* metalgym88 service worker (openGym-derived) — runtime caching (works with Vite's hashed asset names).
   Media (img/gif) cache-first; everything else network-first with offline fallback. */
const CACHE = 'metalgym88-rt-v1'

// The app root: the directory this worker was served from. The app is
// published under a path prefix on some hosts (GitHub Pages), so every path
// below is resolved against that directory and never against the site root.
const APP_DIR = new URL('./', self.location.href)
const APP_PATH = APP_DIR.pathname
const INDEX_URL = new URL('index.html', APP_DIR).href

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()))
})
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {}
  e.waitUntil(self.registration.showNotification(data.title || 'metalgym88', {
    body: data.body || '',
    icon: 'icon-512.png',
    badge: 'icon-180.png',
    tag: data.tag || 'metalgym88',
    renotify: true
  }))
})
self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(clients => {
    const c = clients.find(c => 'focus' in c)
    return c ? c.focus() : self.clients.openWindow('./')
  }))
})

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return

  // The path relative to the app root: '/api/x' and '/<prefix>/api/x' are
  // the same request for the app.
  const rel = (url.pathname.startsWith(APP_PATH) ? url.pathname.slice(APP_PATH.length) : url.pathname).replace(/^\/+/, '')
  if (rel.startsWith('api/')) return    // never cache auth/data

  const isMedia = rel.startsWith('img/') || rel.startsWith('gif/')
  if (isMedia) {
    e.respondWith(caches.open(CACHE).then(c => c.match(e.request).then(hit =>
      hit || fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res })
    )))
  } else {
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()))
      return res
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match(INDEX_URL))))
  }
})

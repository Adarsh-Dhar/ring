self.addEventListener('push', (event) => {
  const d = event.data ? event.data.json() : {}
  event.waitUntil(
    self.registration.showNotification(d.title || 'Doorbell', {
      body: d.body || '',
      tag: d.tag || 'doorbell',
      renotify: true,
      requireInteraction: true,
      data: { url: d.url || '/helper' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/helper'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('navigate' in c) return c.navigate(url).then((w) => (w || c).focus())
      }
      return clients.openWindow(url)
    })
  )
})

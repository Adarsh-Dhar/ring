'use client'

import { useEffect, useState } from 'react'

const b64ToU8 = (s: string) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

type St = 'unknown' | 'off' | 'on' | 'blocked' | 'unsupported'

export default function EnableAlerts({ helperId }: { helperId: string }) {
  const [st, setSt] = useState<St>('unknown')

  const send = (sub: PushSubscription) =>
    fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ helperId, subscription: sub.toJSON() }),
    })

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setSt('unsupported')
      return
    }
    if (Notification.permission === 'denied') {
      setSt('blocked')
      return
    }
    navigator.serviceWorker.register('/sw.js').then(async (reg) => {
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await send(sub) // re-register: the server may have restarted
        setSt('on')
      } else setSt('off')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [helperId])

  const enable = async () => {
    if ((await Notification.requestPermission()) !== 'granted') return setSt('blocked')
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToU8(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
    })
    await send(sub)
    setSt('on')
  }

  if (st === 'unknown') return null
  if (st === 'on') return <p className="mb-4 text-sm text-emerald-300">🔔 Phone alerts are on</p>
  if (st === 'blocked') return <p className="mb-4 text-sm text-amber-300">Alerts are blocked. Allow notifications for this site in the browser settings.</p>
  if (st === 'unsupported')
    return <p className="mb-4 text-sm text-amber-300">This browser cannot get alerts. On iPhone: Share, Add to Home Screen, then open the app from the home screen.</p>
  return (
    <button onClick={enable} className="mb-4 w-full rounded-2xl bg-cyan-500 py-4 text-lg font-bold text-black">
      🔔 Turn on phone alerts
    </button>
  )
}

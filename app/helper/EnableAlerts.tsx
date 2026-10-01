'use client'

import { useEffect, useState } from 'react'

const b64ToU8 = (s: string) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

type St = 'unknown' | 'off' | 'on' | 'blocked' | 'unsupported' | 'error'

export default function EnableAlerts() {
  const [st, setSt] = useState<St>('unknown')
  const [errMsg, setErrMsg] = useState('')
  const [detailedErr, setDetailedErr] = useState('')

  const send = async (sub: PushSubscription) => {
    try {
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: 'Server error' }))
        throw new Error(error.error || 'Failed to register with server')
      }
    } catch (e) {
      throw e
    }
  }

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setSt('unsupported')
      return
    }
    if (Notification.permission === 'denied') {
      setSt('blocked')
      return
    }
    
    // Check for secure context
    if (!window.isSecureContext) {
      console.warn('Push notifications require HTTPS or localhost. Current context is not secure.')
      setSt('error')
      setErrMsg('Push needs a secure page. Open the https:// link of your tunnel (not the http:// one), or use localhost.')
      return
    }
    
    navigator.serviceWorker.register('/sw.js')
      .then(async (reg) => {
        try {
          const sub = await reg.pushManager.getSubscription()
          if (sub) {
            await send(sub) // re-register: the server may have restarted
            setSt('on')
          } else setSt('off')
        } catch (e) {
          console.error('Push subscription check failed:', e)
          setSt('off') // Allow user to try again
        }
      })
      .catch((e) => {
        console.error('Service worker registration failed:', e)
        setSt('error')
        setErrMsg(e.message || 'Service worker registration failed')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const enable = async () => {
    setErrMsg('')
    setDetailedErr('')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setSt('blocked')
        return
      }

      const reg = await navigator.serviceWorker.ready
      console.log('Service worker ready, attempting push subscription...')
      console.log('VAPID key:', process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)
      console.log('Current URL:', window.location.href)
      console.log('Is HTTPS:', window.location.protocol === 'https:')
      console.log('isSecureContext:', window.isSecureContext)
      
      try {
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: b64ToU8(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
        })
        console.log('Push subscription successful:', sub)
        await send(sub)
        setSt('on')
      } catch (pushError: any) {
        console.error('Push subscription error:', pushError)
        const errorDetails = JSON.stringify({
          name: pushError.name,
          message: pushError.message,
          stack: pushError.stack,
          isSecureContext: window.isSecureContext,
          protocol: window.location.protocol,
          userAgent: navigator.userAgent,
          hostname: window.location.hostname
        })
        setDetailedErr(errorDetails)
        
        // Provide more specific error messages
        if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
          throw new Error('The VAPID public key is missing. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY in .env and restart the server.')
        }
        if (pushError.name === 'InvalidStateError') {
          throw new Error('Service worker is not active. Please refresh the page and try again.')
        } else if (pushError.name === 'SecurityError') {
          throw new Error('Invalid VAPID key or insecure context. Push requires HTTPS.')
        } else if (pushError.name === 'AbortError') {
          if (!window.isSecureContext) {
            throw new Error('Push notifications require HTTPS. Make sure you are accessing via https:// not http://')
          }
          throw new Error('The browser could not reach its push service. Use Chrome or Edge (in Brave, turn on "Use Google Services for Push Messaging"), and make sure the phone/computer is online. SMS alerts will still work.')
        } else {
          throw new Error(`Push service error: ${pushError.message || pushError.name}`)
        }
      }
    } catch (e: any) {
      console.error('Push enable failed:', e)
      setSt('error')
      setErrMsg(e.message || 'Failed to enable notifications')
    }
  }

  if (st === 'unknown') return null
  if (st === 'on') return <p className="mb-4 text-sm text-emerald-300">🔔 Phone alerts are on</p>
  if (st === 'blocked') return <p className="mb-4 text-sm text-amber-300">Alerts are blocked. Allow notifications for this site in the browser settings.</p>
  if (st === 'unsupported')
    return <p className="mb-4 text-sm text-amber-300">This browser cannot get alerts. On iPhone: Share, Add to Home Screen, then open the app from the home screen.</p>
  if (st === 'error')
    return (
      <div className="mb-4">
        <p className="mb-2 text-sm text-red-300">❌ {errMsg || 'Failed to enable notifications'}</p>
        {detailedErr && (
          <details className="mb-2 text-xs text-slate-400">
            <summary>Technical details</summary>
            <pre className="mt-1 p-2 bg-slate-800 rounded overflow-auto max-h-32">
              {detailedErr}
            </pre>
          </details>
        )}
        <button onClick={enable} className="w-full rounded-2xl bg-cyan-500 py-4 text-lg font-bold text-black">
          🔔 Try again
        </button>
      </div>
    )
  return (
    <button onClick={enable} className="mb-4 w-full rounded-2xl bg-cyan-500 py-4 text-lg font-bold text-black">
      🔔 Turn on phone alerts
    </button>
  )
}
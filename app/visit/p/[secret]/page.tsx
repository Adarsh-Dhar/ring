'use client'

import { useEffect, useState } from 'react'

type State = { kind: 'working' } | { kind: 'ok'; firstUse: boolean } | { kind: 'error'; message: string }

/**
 * Landing page for a visitor pass link. Opening it registers this browser as the pass's device.
 * The first browser to open the link owns the pass; any other browser is refused.
 */
export default function VisitorPassPage({ params }: { params: Promise<{ secret: string }> }) {
  const [state, setState] = useState<State>({ kind: 'working' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { secret } = await params
      try {
        const res = await fetch('/api/visitor/arrival', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ secret }),
        })
        const body = await res.json().catch(() => ({}))
        if (cancelled) return
        if (res.ok) setState({ kind: 'ok', firstUse: !!body.firstUse })
        else setState({ kind: 'error', message: body.error || 'Something went wrong.' })
      } catch {
        if (!cancelled) setState({ kind: 'error', message: 'Could not reach the server. Check your connection and try again.' })
      }
    })()
    return () => { cancelled = true }
  }, [params])

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-sm text-center space-y-3">
        {state.kind === 'working' && <p className="text-lg">Checking your pass…</p>}
        {state.kind === 'ok' && (
          <>
            <p className="text-2xl font-semibold">Your pass is ready ✅</p>
            <p className="text-gray-600">
              {state.firstUse ? 'This pass is now tied to this phone. ' : ''}
              Keep this phone with you and ring the bell when you arrive.
            </p>
          </>
        )}
        {state.kind === 'error' && (
          <>
            <p className="text-2xl font-semibold">Pass not accepted</p>
            <p className="text-gray-600">{state.message}</p>
          </>
        )}
      </div>
    </main>
  )
}

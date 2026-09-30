'use client'

import { useEffect, useState } from 'react'

/** Personal sign-in link target: /enter?t=<token>. Swaps the token for a cookie, then removes it from the URL. */
export default function Enter() {
  const [msg, setMsg] = useState('Signing in…')

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('t')
    window.history.replaceState(null, '', '/enter')
    if (!token) return setMsg('This link is missing its code. Ask for a new link.')
    fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      .then(async (r) => {
        if (!r.ok) return setMsg((await r.json()).error || 'This link does not work.')
        const { role } = await r.json()
        window.location.replace(role === 'resident' ? '/resident' : '/helper')
      })
      .catch(() => setMsg('Could not reach the server. Try again.'))
  }, [])

  return <main className="p-8 text-center text-xl text-white">{msg}</main>
}

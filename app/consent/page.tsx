'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Helper } from '@/lib/doorbell/config'
import { usePin } from '../hooks/usePin'

export default function ConsentPage() {
  const { pin, setPin } = usePin()
  const [pinInput, setPinInput] = useState('')
  const [needPin, setNeedPin] = useState(false)
  const [id, setId] = useState('')
  const [helper, setHelper] = useState<Helper | null>(null)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get('id') || '')
  }, [])

  const load = useCallback(async () => {
    const r = await fetch('/api/setup', { headers: { 'x-setup-pin': pin }, cache: 'no-store' })
    if (r.status === 401) return setNeedPin(true)
    setNeedPin(false)
    const d: { helpers: Helper[] } = await r.json()
    setHelper(d.helpers.find((h) => h.id === id) ?? null)
  }, [pin, id])

  useEffect(() => {
    if (id) load()
  }, [id, load])

  const decide = async (consent: 'approved' | 'declined') => {
    const r = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-setup-pin': pin },
      body: JSON.stringify({ action: 'consent', id, consent }),
    })
    if (r.ok) setMsg(consent === 'approved' ? 'Allowed. You can remove them at any time in Setup.' : 'Not allowed. They get no alerts and see no video.')
    else setMsg((await r.json()).error || 'Something went wrong')
    load()
  }

  if (needPin) {
    return (
      <main className="mx-auto max-w-sm p-6 text-white">
        <h1 className="mb-4 text-xl font-bold">Guardian PIN</h1>
        <input type="password" value={pinInput} onChange={(e) => setPinInput(e.target.value)} className="mb-3 w-full rounded-lg bg-slate-700 p-2" />
        <button onClick={() => setPin(pinInput)} className="w-full rounded-lg bg-cyan-500 py-3 font-bold text-black">Unlock</button>
      </main>
    )
  }
  if (!helper) return <main className="p-6 text-slate-400">{id ? 'Loading…' : 'No helper chosen.'}</main>

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-6 text-center text-white">
      <div className="text-8xl">{helper.emoji}</div>
      <h1 className="text-3xl font-bold">{helper.name}</h1>
      <p className="text-xl">
        wants to get an alert when someone is at the door, and to see the video. Do you allow this?
      </p>
      <p className="text-sm text-slate-400">Now: {helper.consent}</p>
      <div className="grid w-full grid-cols-2 gap-4">
        <button onClick={() => decide('approved')} className="rounded-3xl bg-emerald-600 py-6 text-2xl font-bold">✅ Allow</button>
        <button onClick={() => decide('declined')} className="rounded-3xl bg-red-700 py-6 text-2xl font-bold">✋ No</button>
      </div>
      {msg && <p className="text-lg">{msg}</p>}
    </main>
  )
}

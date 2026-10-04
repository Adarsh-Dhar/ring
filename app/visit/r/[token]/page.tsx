'use client'

import { useEffect, useState } from 'react'
import { PURPOSES } from '@/lib/doorbell/purposes'

interface View { status: string; name: string; purpose: string; resident: string }

const COPY: Record<string, { icon: string; title: (v: View) => string; sub: (v: View) => string }> = {
  pending:   { icon: '⏳', title: () => 'Waiting for approval', sub: v => `A helper or ${v.resident} will check your photo. We will message you.` },
  approved:  { icon: '✅', title: v => `You are a regular visitor of ${v.resident}`, sub: () => 'The door camera can now recognise you. A helper still confirms at the door.' },
  declined:  { icon: '🚫', title: () => 'Not approved', sub: () => 'Your photo has been deleted.' },
  expired:   { icon: '⌛', title: () => 'Nobody answered in time', sub: () => 'Your photo has been deleted. You can register again.' },
  cancelled: { icon: '↩️', title: () => 'Cancelled', sub: () => 'Your photo has been deleted.' },
  removed:   { icon: '🗑️', title: () => 'Your face has been removed', sub: () => 'Nothing is saved any more.' },
}

export default function RegularStatusPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState('')
  const [v, setV] = useState<View | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => { params.then(p => setToken(p.token)) }, [params])

  const load = (t: string) =>
    fetch(`/api/regular-visitors/status/${t}`).then(r => (r.ok ? r.json() : null)).then(d => { setV(d); setLoading(false) }).catch(() => setLoading(false))

  useEffect(() => {
    if (!token) return
    load(token)
    const i = setInterval(() => load(token), 5_000)
    return () => clearInterval(i)
  }, [token])

  const withdraw = async () => {
    const msg = v?.status === 'approved' ? 'Remove your face and stop being a regular visitor?' : 'Cancel your registration?'
    if (!confirm(msg)) return
    setErr('')
    const r = await fetch(`/api/regular-visitors/status/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'withdraw' }) })
    if (!r.ok) setErr((await r.json().catch(() => ({}))).error || 'Could not do that.')
    load(token)
  }

  if (loading) return <main className="min-h-screen bg-slate-900 text-white flex items-center justify-center"><p>Loading…</p></main>
  if (!v) return (
    <main className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center gap-4 p-6">
      <div className="text-6xl">🔗</div><h1 className="text-2xl font-bold">Link not found</h1>
    </main>
  )

  const c = COPY[v.status] ?? COPY.pending
  const p = (PURPOSES as any)[v.purpose] ?? PURPOSES.other
  return (
    <main className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="text-7xl">{c.icon}</div>
      <h1 className="text-2xl font-bold">{c.title(v)}</h1>
      <p className="text-slate-300 max-w-sm">{c.sub(v)}</p>
      <p className="text-sm text-slate-500">{p.icon} {v.name}</p>
      {err && <p role="alert" className="rounded-xl bg-red-900 p-3 text-sm">{err}</p>}
      {(v.status === 'pending' || v.status === 'approved') && (
        <button onClick={withdraw} className="mt-2 rounded-xl bg-slate-700 px-5 py-3 text-sm hover:bg-slate-600">
          {v.status === 'approved' ? 'Remove my face' : 'Cancel'}
        </button>
      )}
    </main>
  )
}

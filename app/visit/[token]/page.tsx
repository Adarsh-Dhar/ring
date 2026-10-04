'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PURPOSES, PURPOSE_KEYS, type Purpose } from '@/lib/doorbell/purposes'

type PageState = 'loading' | 'ready' | 'gone' | 'submitting' | 'done' | 'error'

export default function VisitRequestPage({ params }: { params: Promise<{ token: string }> }) {
  const router = useRouter()
  const [token, setToken] = useState('')
  const [resident, setResident] = useState('')
  const [pageState, setPageState] = useState<PageState>('loading')
  const [purpose, setPurpose] = useState<Purpose | null>(null)
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [date, setDate] = useState('')
  const [fromTime, setFromTime] = useState('')
  const [toTime, setToTime] = useState('')
  const [note, setNote] = useState('')
  const [errMsg, setErrMsg] = useState('')

  useEffect(() => {
    params.then(p => {
      setToken(p.token)
      fetch(`/api/visit-requests/public/${p.token}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!d) { setPageState('gone'); return }
          setResident(d.resident)
          setPageState('ready')
        })
        .catch(() => setPageState('gone'))
    })
  }, [params])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!purpose) { setErrMsg('Please choose a visit type.'); return }
    setErrMsg('')
    setPageState('submitting')

    const startsAt = new Date(`${date}T${fromTime}`).getTime()
    const endsAt   = new Date(`${date}T${toTime}`).getTime()

    const r = await fetch(`/api/visit-requests/public/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, purpose, note: note || undefined, contact, startsAt, endsAt, website: '' }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) {
      setErrMsg(j.error || 'Something went wrong. Please try again.')
      setPageState('ready')
      return
    }
    router.push(`/visit/s/${j.statusToken}`)
  }

  if (pageState === 'loading') {
    return <main className="min-h-screen bg-slate-900 text-white flex items-center justify-center"><p>Loading…</p></main>
  }
  if (pageState === 'gone') {
    return (
      <main className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center gap-4 p-6">
        <div className="text-6xl">🔗</div>
        <h1 className="text-2xl font-bold">This link is no longer active</h1>
        <p className="text-slate-400 text-center">The family may have created a new link. Ask them for the latest one.</p>
      </main>
    )
  }

  const input = 'w-full rounded-xl bg-slate-700 px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500'

  return (
    <main className="min-h-screen bg-slate-900 text-white p-6 max-w-lg mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Ask to visit {resident}</h1>
        <p className="text-slate-400 mt-1">Fill in the details below. A helper will review and let you know.</p>
        <a href={`/visit/${token}/register`} className="mt-3 inline-block text-sm text-cyan-400">
          Visit often? Register your face as a regular visitor →
        </a>
      </header>

      <form onSubmit={submit} className="space-y-5">
        {/* Honeypot — hidden from real users */}
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}
          aria-hidden="true"
        />

        <div>
          <label className="block text-sm text-slate-400 mb-2">Type of visit</label>
          <div className="grid grid-cols-5 gap-2">
            {PURPOSE_KEYS.map(k => (
              <button
                key={k}
                type="button"
                onClick={() => setPurpose(k)}
                className={`flex flex-col items-center gap-1 rounded-xl py-3 text-2xl transition-colors ${
                  purpose === k ? 'bg-cyan-600 ring-2 ring-cyan-400' : 'bg-slate-700 hover:bg-slate-600'
                }`}
                aria-pressed={purpose === k}
                aria-label={PURPOSES[k].label}
              >
                <span>{PURPOSES[k].icon}</span>
                <span className="text-xs text-white">{PURPOSES[k].label}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="vr-name" className="block text-sm text-slate-400 mb-1">Your name</label>
          <input id="vr-name" required maxLength={40} value={name} onChange={e => setName(e.target.value)} className={input} placeholder="Full name" />
        </div>

        <div>
          <label htmlFor="vr-contact" className="block text-sm text-slate-400 mb-1">Phone or email</label>
          <input id="vr-contact" required maxLength={80} value={contact} onChange={e => setContact(e.target.value)} className={input} placeholder="+91… or name@example.com" />
          <p className="text-xs text-slate-500 mt-1">We will send your approval link here. Not shared with anyone.</p>
        </div>

        <div>
          <label htmlFor="vr-date" className="block text-sm text-slate-400 mb-1">Date</label>
          <input id="vr-date" type="date" required value={date} onChange={e => setDate(e.target.value)} className={input} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="vr-from" className="block text-sm text-slate-400 mb-1">From</label>
            <input id="vr-from" type="time" required value={fromTime} onChange={e => setFromTime(e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor="vr-to" className="block text-sm text-slate-400 mb-1">To</label>
            <input id="vr-to" type="time" required value={toTime} onChange={e => setToTime(e.target.value)} className={input} />
          </div>
        </div>

        <div>
          <label htmlFor="vr-note" className="block text-sm text-slate-400 mb-1">Note <span className="text-slate-500">(optional)</span></label>
          <textarea id="vr-note" maxLength={120} value={note} onChange={e => setNote(e.target.value)} rows={2} className={input} placeholder="Anything useful for the family to know" />
          <p className="text-xs text-slate-500 mt-1">{note.length}/120</p>
        </div>

        {errMsg && <p role="alert" className="rounded-xl bg-red-900 p-3 text-sm">{errMsg}</p>}

        <button
          type="submit"
          disabled={pageState === 'submitting'}
          className="w-full rounded-xl bg-cyan-600 py-4 text-lg font-bold text-white disabled:opacity-50 hover:bg-cyan-500 transition-colors"
        >
          {pageState === 'submitting' ? 'Sending…' : 'Send visit request'}
        </button>
      </form>
    </main>
  )
}

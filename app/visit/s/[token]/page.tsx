'use client'

import { useEffect, useRef, useState } from 'react'

type VisitState = 'gone' | 'used' | 'early' | 'late' | 'ok' | null
type DeviceState = 'n/a' | 'unbound' | 'mine' | 'other'

interface StatusData {
  status:      string
  name:        string
  purpose:     string
  startsAt:    number
  endsAt:      number
  resident:    string
  plannedMode: string
  device:      DeviceState
  visit:       VisitState
  code:        { value: string; endsAt: number } | null
}

const fmt = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

export default function VisitorStatusPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken]     = useState('')
  const [data, setData]       = useState<StatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [errMsg, setErrMsg]   = useState('')
  const [acting, setActing]   = useState(false)
  const [secsLeft, setSecsLeft] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => { params.then(p => setToken(p.token)) }, [params])

  const load = (tok: string) => {
    fetch(`/api/visit-requests/status/${tok}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: StatusData | null) => {
        setData(d)
        setLoading(false)
        if (d?.code) setSecsLeft(Math.max(0, Math.ceil((d.code.endsAt - Date.now()) / 1000)))
      })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    if (!token) return
    load(token)
    const fast = () => { if (intervalRef.current) clearInterval(intervalRef.current); intervalRef.current = setInterval(() => load(token), 3_000) }
    const slow = () => { if (intervalRef.current) clearInterval(intervalRef.current); intervalRef.current = setInterval(() => load(token), 5_000) }
    slow()
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [token])

  // Switch to fast polling while code is shown
  useEffect(() => {
    if (!token) return
    if (data?.code) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = setInterval(() => load(token), 3_000)
    }
  }, [data?.code, token])

  // Countdown for the code
  useEffect(() => {
    if (!data?.code) return
    const t = setInterval(() => {
      setSecsLeft(s => {
        const next = Math.max(0, Math.ceil((data.code!.endsAt - Date.now()) / 1000))
        return next
      })
    }, 1_000)
    return () => clearInterval(t)
  }, [data?.code?.endsAt])

  const act = async (action: 'bind' | 'resend' | 'cancel') => {
    setErrMsg('')
    setActing(true)
    const r = await fetch(`/api/visit-requests/status/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    setActing(false)
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      setErrMsg(j.error || 'Something went wrong.')
      return
    }
    load(token)
  }

  if (loading) {
    return <main className="min-h-screen bg-slate-900 text-white flex items-center justify-center"><p>Loading…</p></main>
  }
  if (!data) {
    return (
      <main className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center gap-4 p-6">
        <div className="text-6xl">🔍</div>
        <h1 className="text-2xl font-bold">Request not found</h1>
        <p className="text-slate-400 text-center">This link may have expired. Ask the family for a new one.</p>
      </main>
    )
  }

  const { status, name, resident, startsAt, endsAt, plannedMode, device, visit, code } = data

  const bg =
    status === 'approved'  ? 'bg-emerald-900' :
    status === 'declined'  ? 'bg-red-900' :
    status === 'expired' || status === 'cancelled' ? 'bg-slate-800' :
    'bg-sky-900'

  return (
    <main className={`min-h-screen ${bg} text-white p-6 max-w-lg mx-auto flex flex-col gap-6`}>
      <header>
        <p className="text-slate-300 text-sm">Visit request for {resident}</p>
        <h1 className="text-2xl font-bold mt-1">{name}</h1>
        <p className="text-slate-300 text-sm mt-1">{fmtDate(startsAt)} · {fmt(startsAt)} – {fmt(endsAt)}</p>
      </header>

      {errMsg && <p role="alert" className="rounded-xl bg-red-800 p-3 text-sm">{errMsg}</p>}

      {/* ── pending ── */}
      {status === 'pending' && (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl bg-black/20 p-5 text-center">
            <div className="text-5xl mb-3">⏳</div>
            <p className="text-xl font-semibold">Waiting for approval</p>
            <p className="text-slate-300 mt-2">We will message you when a decision is made.</p>
          </div>
          <button
            onClick={() => act('cancel')}
            disabled={acting}
            className="rounded-xl bg-black/30 py-3 text-sm text-slate-300 hover:bg-black/50 disabled:opacity-50"
          >
            Cancel this request
          </button>
        </div>
      )}

      {/* ── approved, helper mode ── */}
      {status === 'approved' && plannedMode !== 'resident' && (
        <div className="rounded-2xl bg-black/20 p-5 text-center">
          <div className="text-5xl mb-3">✅</div>
          <p className="text-xl font-semibold">Approved!</p>
          <p className="text-slate-200 mt-2">
            Ring the bell between {fmt(startsAt)} and {fmt(endsAt)}.<br />
            A family helper will confirm.
          </p>
        </div>
      )}

      {/* ── approved, resident mode, device unbound ── */}
      {status === 'approved' && plannedMode === 'resident' && device === 'unbound' && (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl bg-black/20 p-5 text-center">
            <div className="text-5xl mb-3">📱</div>
            <p className="text-xl font-semibold">Open this on your phone</p>
            <p className="text-slate-300 mt-2">Tap the button below on the phone you will have at the door to activate your entry code.</p>
          </div>
          <button
            onClick={() => act('bind')}
            disabled={acting}
            className="rounded-xl bg-cyan-600 py-4 text-lg font-bold hover:bg-cyan-500 disabled:opacity-50"
          >
            📱 This is my phone
          </button>
        </div>
      )}

      {/* ── approved, resident mode, this device, code shown ── */}
      {status === 'approved' && plannedMode === 'resident' && device === 'mine' && code && (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl bg-black/20 p-5 text-center">
            <p className="text-slate-300 mb-2">Your entry code</p>
            <div
              className="text-8xl font-mono font-bold tracking-widest"
              aria-label={`Entry code ${code.value.split('').join(' ')}`}
            >
              {code.value}
            </div>
            <p className="text-slate-400 text-sm mt-3">Read this number out when asked.</p>
            <div className="mt-3 h-2 bg-black/30 rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-400 transition-all duration-1000 ease-linear"
                style={{ width: `${Math.round((secsLeft / 60) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-slate-500 mt-1">Changes in {secsLeft}s</p>
          </div>
        </div>
      )}

      {/* ── approved, resident mode, this device, visit states ── */}
      {status === 'approved' && plannedMode === 'resident' && device === 'mine' && !code && (
        <div className="rounded-2xl bg-black/20 p-5 text-center">
          {visit === 'early' && (
            <>
              <div className="text-5xl mb-3">⏰</div>
              <p className="text-xl font-semibold">Too early</p>
              <p className="text-slate-300 mt-2">The code appears 15 minutes before your visit time.</p>
            </>
          )}
          {visit === 'used' && (
            <>
              <div className="text-5xl mb-3">✅</div>
              <p className="text-xl font-semibold">This visit is complete</p>
            </>
          )}
          {(visit === 'late' || visit === 'gone') && (
            <>
              <div className="text-5xl mb-3">🕐</div>
              <p className="text-xl font-semibold">This visit is over</p>
            </>
          )}
        </div>
      )}

      {/* ── approved, resident mode, another device ── */}
      {status === 'approved' && plannedMode === 'resident' && device === 'other' && (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl bg-black/20 p-5 text-center">
            <div className="text-5xl mb-3">🔗</div>
            <p className="text-xl font-semibold">This link is in use on another phone</p>
            <p className="text-slate-300 mt-2">If you lost the other phone or need to switch, ask for a new link below.</p>
          </div>
          <button
            onClick={() => act('resend')}
            disabled={acting}
            className="rounded-xl bg-cyan-600 py-4 text-lg font-bold hover:bg-cyan-500 disabled:opacity-50"
          >
            Send me a new link
          </button>
        </div>
      )}

      {/* ── declined ── */}
      {status === 'declined' && (
        <div className="rounded-2xl bg-black/20 p-5 text-center">
          <div className="text-5xl mb-3">❌</div>
          <p className="text-xl font-semibold">Not approved</p>
          <p className="text-slate-300 mt-2">Your visit request to {resident} was not approved. Please contact the family directly.</p>
        </div>
      )}

      {/* ── expired ── */}
      {status === 'expired' && (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl bg-black/20 p-5 text-center">
            <div className="text-5xl mb-3">⌛</div>
            <p className="text-xl font-semibold">Request expired</p>
            <p className="text-slate-300 mt-2">The request was not answered in time. You can send a new one.</p>
          </div>
          <a
            href={`/visit/${token.replace(/\/s\/.*/, '')}`}
            className="rounded-xl bg-cyan-600 py-3 text-center font-semibold hover:bg-cyan-500"
          >
            Send a new request
          </a>
        </div>
      )}

      {/* ── cancelled ── */}
      {status === 'cancelled' && (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl bg-black/20 p-5 text-center">
            <div className="text-5xl mb-3">🚫</div>
            <p className="text-xl font-semibold">Cancelled</p>
            <p className="text-slate-300 mt-2">This visit was cancelled. You can send a new request if needed.</p>
          </div>
        </div>
      )}
    </main>
  )
}

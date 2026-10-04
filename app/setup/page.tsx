'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

interface Member {
  id: string
  name: string
  phone?: string
  email?: string
  emoji: string
  consent: string
  role: string
  position: number
}

interface RingConnection {
  id: string
  ringAccountId: string
  status: string
  linkedByUserId: string | null
  expiresAt: string | null
}

interface HouseholdData {
  members: Member[]
  quiet: { enabled: boolean; startHour: number; endHour: number }
  timeoutSec: number
  ready: boolean
  timeZone: string
  recurring: any[]
  plannedMode?: 'helper' | 'resident' | 'all-helper'
  requireResidentOk?: boolean
  visitLink?: { active: boolean; createdAt: number | null }
}

const BADGE: Record<string, string> = {
  approved: 'bg-emerald-600',
  pending:  'bg-amber-600',
  declined: 'bg-red-700',
}
const input = 'rounded-lg bg-slate-700 p-2 text-white'
const btn   = 'rounded-lg bg-slate-700 px-3 py-1'

// Human-readable messages for error codes Ring redirects back with
const RING_ERRORS: Record<string, string> = {
  missing_params:             'Ring returned an incomplete callback — please try again.',
  server_misconfigured:       'Server is missing RING_HMAC_KEY. Contact the administrator.',
  invalid_signature:          'Ring callback signature was invalid — possible replay or wrong RING_HMAC_KEY.',
  expired:                    'Ring callback expired (> 5 min). Please start the linking process again.',
  replay:                     'This Ring link was already used. Please start the linking process again.',
  connection_not_found:       'Ring sent a callback but no pending token was found. Please try again.',
  connection_already_claimed: 'This Ring account is already linked to a different household.',
  server_error:               'A server error occurred during Ring linking.',
}

export default function SetupPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const [data,               setData]               = useState<HouseholdData | null>(null)
  const [ring,               setRing]               = useState<{ configured: boolean; connection: RingConnection | null } | null>(null)
  const [ringLoading,        setRingLoading]        = useState(false)
  const [err,                setErr]                = useState('')
  const [note,               setNote]               = useState('')
  const [form,               setForm]               = useState({ name: '', phone: '', email: '', emoji: '🙂' })
  const [secs,               setSecs]               = useState(30)
  const [quiet,              setQuietForm]          = useState({ enabled: false, startHour: 22, endHour: 6 })
  const [plannedMode,        setPlannedModeLocal]   = useState<'helper' | 'resident' | 'all-helper'>('helper')
  const [requireResidentOk,  setRequireResidentOk]  = useState(false)
  const [visitLinkUrl,       setVisitLinkUrl]       = useState('')
  const [visitLinkActive,    setVisitLinkActive]    = useState(false)
  const [visitLinkCreatedAt, setVisitLinkCreatedAt] = useState<number | null>(null)
  const [pairingCode,        setPairingCode]        = useState('')
  const [loading,            setLoading]            = useState(false)
  const [faceName,           setFaceName]           = useState('')
  const [faceImage,          setFaceImage]          = useState<File | null>(null)
  const [enrolledFaces,      setEnrolledFaces]      = useState<any[]>([])
  const [faceStatus,         setFaceStatus]         = useState<{ enabled: boolean; modelsLoaded: boolean } | null>(null)
  const [sightings,          setSightings]          = useState<any[]>([])

  // ── Handle Ring OAuth callback result from URL params ──────────────────────
  useEffect(() => {
    const ringLinked  = searchParams.get('ring_linked')
    const errorCode   = searchParams.get('error')
    const errorDetail = searchParams.get('error_detail')

    if (ringLinked === 'true') {
      setNote('✅ Ring account linked successfully!')
      window.history.replaceState({}, '', '/setup')
    } else if (errorCode) {
      const msg = RING_ERRORS[errorCode] ?? errorDetail ?? `Ring linking failed (${errorCode}).`
      setErr(`Ring linking error: ${msg}`)
      window.history.replaceState({}, '', '/setup')
    }
  }, [searchParams])

  const loadRing = useCallback(async () => {
    try {
      const r = await fetch('/api/household/ring', { cache: 'no-store' })
      if (r.ok) {
        const d = await r.json()
        setRing({ configured: d.configured, connection: d.connection })
      }
    } catch {
      // Non-fatal — Ring section shows as unconfigured
    }
  }, [])

  const load = useCallback(async () => {
    const r = await fetch('/api/household', { cache: 'no-store' })
    if (r.status === 401) { router.push('/login'); return }
    if (!r.ok) { setErr('Failed to load household data'); return }
    const d: HouseholdData = await r.json()
    setData(d)
    setSecs(d.timeoutSec)
    setQuietForm(d.quiet)
    setPlannedModeLocal(d.plannedMode ?? 'helper')
    setRequireResidentOk(d.requireResidentOk ?? false)
    setVisitLinkActive(d.visitLink?.active ?? false)
    setVisitLinkCreatedAt(d.visitLink?.createdAt ?? null)

    // Load face recognition status and enrolled faces
    try {
      const fr = await fetch('/api/face', { cache: 'no-store' })
      if (fr.ok) {
        const fd = await fr.json()
        setFaceStatus({ enabled: fd.enabled, modelsLoaded: fd.modelsLoaded })
        setEnrolledFaces(fd.faces ?? [])
      }
    } catch {
      // Face recognition may be disabled
    }

    // Load recent sightings
    try {
      const sr = await fetch('/api/face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sightings', limit: 10 }),
      })
      if (sr.ok) {
        const sd = await sr.json()
        setSightings(sd.sightings ?? [])
      }
    } catch {
      // Sightings may fail
    }
  }, [router])

  useEffect(() => { load(); loadRing() }, [load, loadRing])

  const act = async (url: string, body: object) => {
    setErr('')
    setLoading(true)
    const r = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    const j = await r.json().catch(() => ({}))
    setLoading(false)
    if (!r.ok) setErr(j.error || 'Something went wrong')
    load()
    return j
  }

  // ── Ring helpers ──────────────────────────────────────────────────────────
  const connectRing = () => {
    // Ring Partner API uses a Ring-driven one-way linking flow.
    // The user must install/link the app from the Ring AppStore or Developer Portal.
    // Linking is initiated by Ring, not by a browser redirect to oauth.ring.com.
    const portalUrl = 'https://developer.amazon.com/ring/console/apps'
    window.open(portalUrl, '_blank', 'noopener')
  }

  const disconnectRing = async () => {
    if (!confirm('Disconnect Ring? Doorbell events will stop until you reconnect.')) return
    setRingLoading(true)
    setErr('')
    try {
      const r = await fetch('/api/household/ring', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'disconnect' }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || 'Failed to disconnect Ring'); return }
      setNote('Ring account disconnected.')
      await loadRing()
    } finally {
      setRingLoading(false)
    }
  }

  // ── Member helpers ────────────────────────────────────────────────────────
  const inviteMember = async () => {
    if (!form.name || (!form.phone && !form.email)) {
      setErr('Name and either phone or email are required')
      return
    }
    await act('/api/household/members', { action: 'invite', ...form, role: 'helper' })
    setForm({ name: '', phone: '', email: '', emoji: '🙂' })
    setNote('Invitation sent. Ask them to log in and accept.')
  }

  const setConsent   = (id: string, consent: string) => act('/api/household/members', { action: 'consent', id, consent })
  const removeMember = async (id: string) => { if (!confirm('Remove this member?')) return; await act('/api/household/members', { action: 'remove', id }) }
  const moveMember   = (id: string, dir: -1 | 1) => act('/api/household/members', { action: 'move', id, dir })

  const createDevice = async () => {
    const j = await act('/api/household', { action: 'createDevice' })
    if (j.code) { setPairingCode(j.code); setNote(`Pairing code: ${j.code}. Enter this on the resident device.`) }
  }

  const createVisitLink = async () => {
    const r = await fetch('/api/visit-requests/link', { method: 'POST' })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setErr(j.error || 'Could not create link'); return }
    setVisitLinkUrl(j.url)
    setVisitLinkActive(true)
    load()
  }

  const revokeVisitLink = async () => {
    if (!confirm('Revoke the link? Pending visit requests will be cancelled.')) return
    const r = await fetch('/api/visit-requests/link', { method: 'DELETE' })
    if (r.ok) { setVisitLinkActive(false); setVisitLinkUrl(''); setVisitLinkCreatedAt(null); load() }
  }

  const toggleResidentOk = async (v: boolean) => {
    setRequireResidentOk(v)
    await act('/api/household', { action: 'requireResidentOk', value: v })
  }

  const enrollFace = async () => {
    if (!faceName || !faceImage) {
      setErr('Name and photo are required')
      return
    }
    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = reader.result as string
      const r = await fetch('/api/face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'enroll', name: faceName, image: dataUrl, consent: true }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErr(j.error || 'Failed to enroll face')
      } else {
        setNote(`✅ Face enrolled: ${faceName}`)
        setFaceName('')
        setFaceImage(null)
        load()
      }
    }
    reader.readAsDataURL(faceImage)
  }

  const loadSightings = async () => {
    try {
      const sr = await fetch('/api/face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sightings', limit: 10 }),
      })
      if (sr.ok) {
        const sd = await sr.json()
        setSightings(sd.sightings ?? [])
      }
    } catch {
      setErr('Failed to load sightings')
    }
  }

  const deleteFace = async (id: string) => {
    if (!confirm('Delete this face?')) return
    const r = await fetch('/api/face', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id }),
    })
    if (r.ok) {
      setNote('Face deleted')
      load()
    } else {
      setErr('Failed to delete face')
    }
  }

  if (!data) return <main className="p-6 text-slate-400">Loading…</main>

  return (
    <main className="mx-auto min-h-screen max-w-2xl p-4 text-white">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Setup</h1>
        <div className="flex items-center gap-3">
          {process.env.NEXT_PUBLIC_DEMO_MODE === '1' && (
            <a href="/sim" className="text-sm text-amber-400 hover:text-amber-300">
              🎮 Simulator
            </a>
          )}
          <button onClick={() => router.push('/login')} className="text-sm text-cyan-400">Logout</button>
        </div>
      </header>

      {err  && <p className="mb-3 rounded-lg bg-red-900 p-3 text-sm">{err}</p>}
      {note && <p className="mb-3 rounded-lg bg-emerald-900 p-3 text-sm">{note}</p>}

      {!data.ready && (
        <p className="mb-3 rounded-lg bg-amber-700 p-3 text-sm font-semibold">
          Not ready: no approved member with a real phone number. Nobody will be alerted. Add a member and approve them.
        </p>
      )}

      {/* ── Ring doorbell ──────────────────────────────────────────────── */}
      <h2 className="mb-2 text-sm uppercase tracking-wide text-slate-400">Ring doorbell</h2>
      <div className="mb-6 rounded-2xl bg-slate-800 p-4 space-y-3">
        {ring === null ? (
          <p className="text-sm text-slate-400">Loading Ring status…</p>
        ) : ring.configured && ring.connection ? (
          <>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-semibold text-emerald-400">✅ Connected</span>
                <p className="text-xs text-slate-400 mt-1">
                  Ring account: <span className="font-mono">{ring.connection.ringAccountId}</span>
                </p>
                {ring.connection.expiresAt && (
                  <p className="text-xs text-slate-400">
                    Token expires: {new Date(ring.connection.expiresAt).toLocaleDateString()}
                  </p>
                )}
              </div>
              <button
                onClick={disconnectRing}
                disabled={ringLoading || loading}
                className={`${btn} text-red-300`}
              >
                {ringLoading ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Doorbell presses will create alerts. To reconnect with a different account, disconnect first.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-400">
              No Ring account connected. Link your Ring account to receive doorbell alerts and live video.
            </p>
            <button
              onClick={connectRing}
              disabled={ringLoading || loading}
              className="rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-black disabled:opacity-50"
            >
              Open Ring Developer Portal →
            </button>
          </>
        )}
      </div>

      {/* ── Members ───────────────────────────────────────────────────── */}
      <h2 className="mb-1 text-sm uppercase tracking-wide text-slate-400">Members</h2>
      <p className="mb-2 text-sm text-slate-400">Asked in this order, top first. Only approved members are asked.</p>
      <ul className="mb-6 space-y-3">
        {data.members.map((m) => (
          <li key={m.id} className="rounded-2xl bg-slate-800 p-4">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold">
                {m.emoji} {m.name}{' '}
                {m.role === 'guardian' && (
                  <span className="text-xs bg-purple-600 px-2 py-1 rounded ml-2">Guardian</span>
                )}
                <span className="text-sm text-slate-400 ml-1">{m.phone || m.email}</span>
              </span>
              <span className={`rounded-full px-3 py-1 text-xs ${BADGE[m.consent]}`}>{m.consent}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <button className={btn} onClick={() => moveMember(m.id, -1)} disabled={loading}>↑</button>
              <button className={btn} onClick={() => moveMember(m.id,  1)} disabled={loading}>↓</button>
              {m.consent !== 'approved' && (
                <button className={btn} onClick={() => setConsent(m.id, 'approved')} disabled={loading}>Approve</button>
              )}
              {m.consent === 'approved' && (
                <button className={btn} onClick={() => setConsent(m.id, 'pending')} disabled={loading}>Revoke</button>
              )}
              <button className={`${btn} text-red-300`} onClick={() => removeMember(m.id)} disabled={loading}>Remove</button>
            </div>
          </li>
        ))}
      </ul>

      {/* ── Add member ────────────────────────────────────────────────── */}
      <h2 className="mb-2 text-sm uppercase tracking-wide text-slate-400">Add a member</h2>
      <div className="mb-2 flex flex-wrap gap-2">
        <input placeholder="Name"              value={form.name}  onChange={(e) => setForm({ ...form, name:  e.target.value })} className={input} />
        <input placeholder="+919876543210"     value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={input} />
        <input placeholder="email@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={input} />
        <input value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} className={`${input} w-16`} />
        <button onClick={inviteMember} disabled={loading} className="rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-black">
          Invite
        </button>
      </div>
      <p className="mb-6 text-sm text-slate-400">A new member gets no alerts until approved.</p>

      {/* ── Resident device ───────────────────────────────────────────── */}
      <h2 className="mb-2 text-sm uppercase tracking-wide text-slate-400">Resident device</h2>
      <div className="mb-2 flex flex-wrap gap-2">
        <button onClick={createDevice} disabled={loading} className={btn}>Generate pairing code</button>
        {pairingCode && <span className="text-2xl font-mono bg-slate-800 px-4 py-2 rounded">{pairingCode}</span>}
      </div>
      <p className="mb-6 text-sm text-slate-400">Enter the code on the resident device to pair it. The device stays signed in.</p>

      {/* ── Timeout ───────────────────────────────────────────────────── */}
      <h2 className="mb-2 text-sm uppercase tracking-wide text-slate-400">Time each member has to answer</h2>
      <div className="mb-6 flex items-center gap-2">
        <input type="number" min={3} max={600} value={secs} onChange={(e) => setSecs(Number(e.target.value))} className={`${input} w-24`} />
        <span>seconds</span>
        <button onClick={() => act('/api/household', { action: 'timeout', value: secs })} disabled={loading} className={btn}>Save</button>
      </div>

      {/* ── Quiet hours ───────────────────────────────────────────────── */}
      <h2 className="mb-2 text-sm uppercase tracking-wide text-slate-400">Quiet hours (night lock)</h2>
      <p className="mb-2 text-sm text-slate-400">At night the resident screen always says do not open, even if a member says safe.</p>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={quiet.enabled} onChange={(e) => setQuietForm({ ...quiet, enabled: e.target.checked })} /> On
        </label>
        <span>from</span>
        <input type="number" min={0} max={23} value={quiet.startHour} onChange={(e) => setQuietForm({ ...quiet, startHour: Number(e.target.value) })} className={`${input} w-20`} />
        <span>to</span>
        <input type="number" min={0} max={23} value={quiet.endHour}   onChange={(e) => setQuietForm({ ...quiet, endHour:   Number(e.target.value) })} className={`${input} w-20`} />
        <span>o'clock</span>
        <button onClick={() => act('/api/household', { action: 'quiet', ...quiet })} disabled={loading} className={btn}>Save</button>
      </div>

      {/* ── Planned visits ────────────────────────────────────────────── */}
      <h2 className="mb-2 text-sm uppercase tracking-wide text-slate-400">Planned visits</h2>
      <p className="mb-2 text-sm text-slate-400">How the resident screen handles a doorbell ring during a planned visit window.</p>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <select value={plannedMode} onChange={e => setPlannedModeLocal(e.target.value as typeof plannedMode)} className={input}>
          <option value="helper">A helper confirms (recommended)</option>
          <option value="resident">The resident checks a pass-word, helper is told</option>
          <option value="all-helper">No shortcut: every visitor goes to a helper</option>
        </select>
        <button onClick={() => act('/api/household', { action: 'plannedMode', mode: plannedMode })} disabled={loading} className={btn}>Save</button>
      </div>
      {plannedMode === 'resident' && (
        <p className="mb-6 text-sm rounded-lg bg-amber-800 p-2">
          ⚠️ Only visits with a pass-word will be checked by the resident. Visits without a pass-word still go to a helper.
        </p>
      )}

      {/* ── Visit requests ────────────────────────────────────────────── */}
      <h2 className="mt-8 mb-2 text-sm uppercase tracking-wide text-slate-400">Visit requests</h2>
      <p className="mb-2 text-sm text-slate-400">Share a link so visitors can ask to visit without a helper needing to be online.</p>
      <div className="mb-4 rounded-2xl bg-slate-800 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm">
            {visitLinkActive
              ? `Link active since ${visitLinkCreatedAt ? new Date(visitLinkCreatedAt).toLocaleDateString() : '—'}`
              : 'No active link'}
          </span>
          <div className="flex gap-2">
            <button onClick={createVisitLink} disabled={loading} className={`${btn} bg-cyan-700`}>
              {visitLinkActive ? 'Rotate link' : 'Create link'}
            </button>
            {visitLinkActive && (
              <button onClick={revokeVisitLink} disabled={loading} className={`${btn} text-red-300`}>Revoke</button>
            )}
          </div>
        </div>
        {visitLinkUrl && (
          <div className="flex items-center gap-2 bg-slate-700 rounded-lg px-3 py-2">
            <code className="text-xs text-cyan-300 break-all flex-1">{visitLinkUrl}</code>
            <button
              onClick={() => { navigator.clipboard?.writeText(visitLinkUrl).catch(() => {}); setNote('Link copied!') }}
              className="shrink-0 text-sm text-slate-400 hover:text-white"
              aria-label="Copy link"
            >
              📋 Copy
            </button>
          </div>
        )}
        {visitLinkUrl && <p className="text-xs text-amber-400">⚠️ Copy this link now — it is only shown once.</p>}
      </div>
      <div className="mb-8 flex items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={requireResidentOk} onChange={e => toggleResidentOk(e.target.checked)} disabled={loading} />
          <span className="text-sm">Resident must also approve visit requests</span>
        </label>
      </div>
      {requireResidentOk && (
        <p className="text-xs text-slate-400 mb-4">The resident only sees requests a helper has already approved.</p>
      )}

      {/* ── Face Recognition ───────────────────────────────────────────── */}
      <h2 className="mt-8 mb-2 text-sm uppercase tracking-wide text-slate-400">Face Recognition</h2>
      <div className="mb-6 rounded-2xl bg-slate-800 p-4 space-y-3">
        {faceStatus === null ? (
          <p className="text-sm text-slate-400">Loading face recognition status…</p>
        ) : !faceStatus.enabled ? (
          <p className="text-sm text-slate-400">Face recognition is disabled. Set FACE_ENABLED=1 in .env to enable it.</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm">
                {faceStatus.modelsLoaded ? '✅ Models loaded' : '⏳ Models loading…'}
              </span>
            </div>

            {/* Enroll new face */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Enroll a face</h3>
              <div className="flex flex-wrap gap-2">
                <input
                  placeholder="Name (e.g., Adarsh)"
                  value={faceName}
                  onChange={(e) => setFaceName(e.target.value)}
                  className={input}
                />
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setFaceImage(e.target.files?.[0] ?? null)}
                  className="text-xs text-slate-400"
                />
                <button
                  onClick={enrollFace}
                  disabled={loading || !faceName || !faceImage}
                  className="rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-black disabled:opacity-50"
                >
                  Enroll
                </button>
              </div>
              <p className="text-xs text-slate-400">Use a clear, front-facing photo of one person. Only the face descriptor is stored, not the photo.</p>
            </div>

            {/* Enrolled faces list */}
            {enrolledFaces.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Enrolled faces ({enrolledFaces.length})</h3>
                <ul className="space-y-2">
                  {enrolledFaces.map((f) => (
                    <li key={f.id} className="flex items-center justify-between rounded-lg bg-slate-700 px-3 py-2">
                      <span className="text-sm">
                        {f.name} {f.ref && <span className="text-slate-400 text-xs ml-1">(ref: {f.ref})</span>}
                      </span>
                      <button
                        onClick={() => deleteFace(f.id)}
                        className="text-xs text-red-300 hover:text-red-200"
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Recent sightings */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Recent camera sightings</h3>
                <button onClick={loadSightings} className="text-xs text-cyan-400 hover:text-cyan-300">Refresh</button>
              </div>
              {sightings.length === 0 ? (
                <p className="text-xs text-slate-400">No sightings yet. Trigger a doorbell event or use the simulator to test.</p>
              ) : (
                <ul className="space-y-2 max-h-48 overflow-y-auto">
                  {sightings.map((s) => (
                    <li key={s.id} className="rounded-lg bg-slate-700 px-3 py-2 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-slate-400">{new Date(s.capturedAt).toLocaleString()}</span>
                        <span className="text-slate-400">{s.source}</span>
                      </div>
                      <div className="space-y-0.5">
                        {s.faces.map((f: any, i: number) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className={f.status === 'known' ? 'text-emerald-400' : f.status === 'ambiguous' ? 'text-amber-400' : 'text-slate-400'}>
                              {f.status === 'known' ? '✓' : f.status === 'ambiguous' ? '?' : '?'} {f.name || 'Unknown'}
                            </span>
                            {f.distance && <span className="text-slate-500">({f.distance})</span>}
                          </div>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  )
}

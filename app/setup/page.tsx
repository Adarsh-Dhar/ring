'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

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
  pending: 'bg-amber-600',
  declined: 'bg-red-700',
}
const input = 'rounded-lg bg-slate-700 p-2 text-white'
const btn = 'rounded-lg bg-slate-700 px-3 py-1'

export default function SetupPage() {
  const router = useRouter()
  const [data, setData] = useState<HouseholdData | null>(null)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [form, setForm] = useState({ name: '', phone: '', email: '', emoji: '🙂' })
  const [secs, setSecs] = useState(30)
  const [quiet, setQuietForm] = useState({ enabled: false, startHour: 22, endHour: 6 })
  const [plannedMode, setPlannedModeLocal] = useState<'helper' | 'resident' | 'all-helper'>('helper')
  const [requireResidentOk, setRequireResidentOk] = useState(false)
  const [visitLinkUrl, setVisitLinkUrl] = useState('')
  const [visitLinkActive, setVisitLinkActive] = useState(false)
  const [visitLinkCreatedAt, setVisitLinkCreatedAt] = useState<number | null>(null)
  const [pairingCode, setPairingCode] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    const r = await fetch('/api/household', { cache: 'no-store' })
    if (r.status === 401) {
      router.push('/login')
      return
    }
    if (r.ok === false) {
      setErr('Failed to load household data')
      return
    }
    const d: HouseholdData = await r.json()
    setData(d)
    setSecs(d.timeoutSec)
    setQuietForm(d.quiet)
    setPlannedModeLocal(d.plannedMode ?? 'helper')
    setRequireResidentOk(d.requireResidentOk ?? false)
    setVisitLinkActive(d.visitLink?.active ?? false)
    setVisitLinkCreatedAt(d.visitLink?.createdAt ?? null)
  }, [router])

  useEffect(() => {
    load()
  }, [load])

  const act = async (url: string, body: object) => {
    setErr('')
    setLoading(true)
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const j = await r.json().catch(() => ({}))
    setLoading(false)
    if (r.ok === false) setErr(j.error || 'Something went wrong')
    load()
    return j
  }

  const inviteMember = async () => {
    if (!form.name || (!form.phone && !form.email)) {
      setErr('Name and either phone or email are required')
      return
    }
    await act('/api/household/members', {
      action: 'invite',
      ...form,
      role: 'helper',
    })
    setForm({ name: '', phone: '', email: '', emoji: '🙂' })
    setNote('Invitation sent. Ask them to log in and accept.')
  }

  const setConsent = async (id: string, consent: string) => {
    await act('/api/household/members', { action: 'consent', id, consent })
  }

  const removeMember = async (id: string) => {
    if (!confirm('Remove this member?')) return
    await act('/api/household/members', { action: 'remove', id })
  }

  const moveMember = async (id: string, dir: -1 | 1) => {
    await act('/api/household/members', { action: 'move', id, dir })
  }

  const createDevice = async () => {
    const j = await act('/api/household', { action: 'createDevice' })
    if (j.code) {
      setPairingCode(j.code)
      setNote(`Pairing code: ${j.code}. Enter this on the resident device.`)
    }
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

  if (!data) return <main className="p-6 text-slate-400">Loading…</main>

  return (
    <main className="mx-auto min-h-screen max-w-2xl p-4 text-white">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Setup</h1>
        <button onClick={() => router.push('/login')} className="text-sm text-cyan-400">Logout</button>
      </header>
      {err && <p className="mb-3 rounded-lg bg-red-900 p-3 text-sm">{err}</p>}
      {note && <p className="mb-3 rounded-lg bg-emerald-900 p-3 text-sm">{note}</p>}
      {!data.ready && (
        <p className="mb-3 rounded-lg bg-amber-700 p-3 text-sm font-semibold">
          Not ready: no approved member with a real phone number. Nobody will be alerted. Add a member and approve them.
        </p>
      )}

      <h2 className="mb-1 text-sm uppercase tracking-wide text-slate-400">Members</h2>
      <p className="mb-2 text-sm text-slate-400">Asked in this order, top first. Only approved members are asked.</p>
      <ul className="mb-6 space-y-3">
        {data.members.map((m) => (
          <li key={m.id} className="rounded-2xl bg-slate-800 p-4">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold">
                {m.emoji} {m.name} {m.role === 'guardian' && <span className="text-xs bg-purple-600 px-2 py-1 rounded ml-2">Guardian</span>}
                <span className="text-sm text-slate-400">{m.phone || m.email}</span>
              </span>
              <span className={`rounded-full px-3 py-1 text-xs ${BADGE[m.consent]}`}>{m.consent}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <button className={btn} onClick={() => moveMember(m.id, -1)} disabled={loading}>↑</button>
              <button className={btn} onClick={() => moveMember(m.id, 1)} disabled={loading}>↓</button>
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

      <h2 className="mb-2 text-sm uppercase tracking-wide text-slate-400">Add a member</h2>
      <div className="mb-6 flex flex-wrap gap-2">
        <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
        <input placeholder="+919876543210" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={input} />
        <input placeholder="email@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={input} />
        <input value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} className={`${input} w-16`} />
        <button onClick={inviteMember} disabled={loading} className="rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-black">
          Invite
        </button>
      </div>
      <p className="mb-6 text-sm text-slate-400">A new member gets no alerts until approved. Guardians can invite helpers.</p>

      <h2 className="mb-2 text-sm uppercase tracking-wide text-slate-400">Resident device</h2>
      <div className="mb-6 flex flex-wrap gap-2">
        <button onClick={createDevice} disabled={loading} className={btn}>Generate pairing code</button>
        {pairingCode && <span className="text-2xl font-mono bg-slate-800 px-4 py-2 rounded">{pairingCode}</span>}
      </div>
      <p className="mb-6 text-sm text-slate-400">Enter the code on the resident device to pair it. The device stays signed in.</p>

      <h2 className="mb-2 text-sm uppercase tracking-wide text-slate-400">Time each member has to answer</h2>
      <div className="mb-6 flex items-center gap-2">
        <input type="number" min={3} max={600} value={secs} onChange={(e) => setSecs(Number(e.target.value))} className={`${input} w-24`} />
        <span>seconds</span>
        <button onClick={() => act('/api/household', { action: 'timeout', value: secs })} disabled={loading} className={btn}>Save</button>
      </div>

      <h2 className="mb-2 text-sm uppercase tracking-wide text-slate-400">Quiet hours (night lock)</h2>
      <p className="mb-2 text-sm text-slate-400">At night the resident screen always says do not open, even if a member says safe. Members are still alerted.</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={quiet.enabled} onChange={(e) => setQuietForm({ ...quiet, enabled: e.target.checked }) } /> On
        </label>
        <span>from</span>
        <input type="number" min={0} max={23} value={quiet.startHour} onChange={(e) => setQuietForm({ ...quiet, startHour: Number(e.target.value) })} className={`${input} w-20`} />
        <span>to</span>
        <input type="number" min={0} max={23} value={quiet.endHour} onChange={(e) => setQuietForm({ ...quiet, endHour: Number(e.target.value) })} className={`${input} w-20`} />
        <span>o'clock</span>
        <button onClick={() => act('/api/household', { action: 'quiet', ...quiet })} disabled={loading} className={btn}>Save</button>
      </div>

      <h2 className="mt-8 mb-2 text-sm uppercase tracking-wide text-slate-400">Planned visits</h2>
      <p className="mb-2 text-sm text-slate-400">How the resident screen handles a doorbell ring during a planned visit window.</p>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <select
          value={plannedMode}
          onChange={e => setPlannedModeLocal(e.target.value as typeof plannedMode)}
          className={input}
        >
          <option value="helper">A helper confirms (recommended)</option>
          <option value="resident">The resident checks a pass-word, helper is told</option>
          <option value="all-helper">No shortcut: every visitor goes to a helper</option>
        </select>
        <button onClick={() => act('/api/household', { action: 'plannedMode', mode: plannedMode })} disabled={loading} className={btn}>Save</button>
      </div>
      {plannedMode === 'resident' && (
        <p className="text-sm rounded-lg bg-amber-800 p-2">
          ⚠️ Only visits with a pass-word will be checked by the resident. Visits without a pass-word still go to a helper.
        </p>
      )}

      <h2 className="mt-8 mb-2 text-sm uppercase tracking-wide text-slate-400">Visit requests</h2>
      <p className="mb-2 text-sm text-slate-400">Share a link so visitors can ask to visit without a helper needing to be online.</p>

      <div className="mb-4 rounded-2xl bg-slate-800 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm">
            {visitLinkActive
              ? `Link active since ${visitLinkCreatedAt ? new Date(visitLinkCreatedAt).toLocaleDateString() : '—'}`
              : 'No link'}
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

      <div className="mb-2 flex items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={requireResidentOk}
            onChange={e => toggleResidentOk(e.target.checked)}
            disabled={loading}
          />
          <span className="text-sm">Resident must also approve visit requests</span>
        </label>
      </div>
      {requireResidentOk && (
        <p className="text-xs text-slate-400 mb-4">The resident only sees requests a helper has already approved.</p>
      )}
    </main>
  )
}

'use client'

import { useEffect, useState } from 'react'
import type { NoticeSettings as Settings } from '@/lib/doorstep/noticePolicy'

const input = 'rounded-lg bg-slate-700 p-2 text-white'
const btn = 'rounded-lg bg-slate-700 px-3 py-1'

export default function NoticeSettings() {
  const [s, setS] = useState<Settings | null>(null)
  const [hours, setHours] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/household/notice').then(r => (r.ok ? r.json() : Promise.reject())).then((d: Settings) => {
      setS(d); setHours(d.minNoticeHours ? String(d.minNoticeHours) : '')
    }).catch(() => setMsg('Could not load notice settings'))
  }, [])

  async function save() {
    if (!s) return
    const h = hours.trim() === '' ? null : Number(hours)
    setBusy(true); setMsg('')
    try {
      const res = await fetch('/api/household/notice', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { ...s, minNoticeHours: h } }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setMsg(d.error || 'Could not save'); return }
      setS(d); setMsg('Saved')
    } catch { setMsg('Could not save') } finally { setBusy(false) }
  }

  if (!s) return <p className="text-sm text-slate-400">{msg || 'Loading notice settings…'}</p>
  return (
    <div className="mb-6 rounded-2xl bg-slate-800 p-4 space-y-3">
      <h2 className="text-sm uppercase tracking-wide text-slate-400">Visit notice rules</h2>
      <p className="text-xs text-slate-400">Short notice or no notice is never a danger sign by itself. It only changes who approves or who makes first contact.</p>
      <label className="block text-sm">Minimum notice (hours, empty = off)
        <input className={`${input} ml-2 w-24`} inputMode="numeric" value={hours} onChange={e => setHours(e.target.value)} />
      </label>
      <label className="block text-sm">Short-notice visits
        <select className={`${input} ml-2`} value={s.shortNoticePolicy} onChange={e => setS({ ...s, shortNoticePolicy: e.target.value as Settings['shortNoticePolicy'] })}>
          <option value="helper_approval">Helper must approve</option>
          <option value="resident_approval">I approve</option>
          <option value="ai_handles">AI handles</option>
        </select>
      </label>
      <label className="block text-sm">Unexpected visitors
        <select className={`${input} ml-2`} value={s.unknownVisitorPolicy} onChange={e => setS({ ...s, unknownVisitorPolicy: e.target.value as Settings['unknownVisitorPolicy'] })}>
          <option value="ai_first_contact">AI handles first contact</option>
          <option value="helper_first">Helper first</option>
        </select>
      </label>
      <label className="block text-sm">Approval timer (seconds, 15 to 900)
        <input className={`${input} ml-2 w-24`} inputMode="numeric" value={s.approvalTimerSec} onChange={e => setS({ ...s, approvalTimerSec: Number(e.target.value) })} />
      </label>
      <label className="block text-sm">Retry an unanswered approval every (seconds, 30 to 3600)
        <input className={`${input} ml-2 w-24`} inputMode="numeric" value={s.approvalRetrySec} onChange={e => setS({ ...s, approvalRetrySec: Number(e.target.value) })} />
      </label>
      <button className={btn} disabled={busy} onClick={save}>Save</button>
      {msg && <p className="text-sm text-slate-300">{msg}</p>}
    </div>
  )
}

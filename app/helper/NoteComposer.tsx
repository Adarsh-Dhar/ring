'use client'

import { useState, useEffect } from 'react'
import { PURPOSES } from '@/lib/doorbell/purposes'

export default function NoteComposer() {
  const [raw, setRaw] = useState('')
  const [draft, setDraft] = useState<{ id: string; text: string; icon: string; fallback: boolean } | null>(null)
  const [approved, setApproved] = useState<{ text: string; icon_char: string; id: string } | null>(null)
  const [text, setText] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const loadState = async () => {
    try {
      const r = await fetch('/api/ai/notes', { cache: 'no-store' })
      if (r.ok) {
        const j = await r.json()
        setDraft(j.draft)
        setApproved(j.approved)
      }
    } catch { /* optional */ }
  }

  useEffect(() => {
    loadState()
    const t = setInterval(loadState, 30_000)
    return () => clearInterval(t)
  }, [])

  const make = async () => {
    setBusy(true); setMsg('')
    const r = await fetch('/api/ai/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: raw }) })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) { setMsg(j.error || 'Could not make a draft.'); return }
    setDraft(j.draft); setText(j.draft.text)
  }

  const decide = async (action: 'approve' | 'reject') => {
    if (!draft) return
    const r = await fetch(`/api/ai/notes/${draft.id}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...(action === 'approve' ? { text } : {}) }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setMsg(j.error || 'Could not save.'); return }
    setMsg(action === 'approve' ? 'Now showing on the resident screen.' : 'Discarded.')
    setDraft(null); setRaw('')
    loadState()
  }

  const retract = async () => {
    if (!approved) return
    const r = await fetch(`/api/ai/notes/${approved.id}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'retract' }) })
    if (r.ok) {
      setMsg('Note retracted from resident screen.')
      setApproved(null)
      loadState()
    }
  }

  return (
    <section className="mb-6">
      <h2 className="text-sm uppercase tracking-wide text-slate-400 mb-3">Message for the resident</h2>
      <div className="rounded-2xl bg-slate-800 p-4 space-y-3">
        {approved && (
          <div className="rounded-xl bg-emerald-900/30 p-3 space-y-2">
            <p className="text-xs text-slate-400">Resident currently sees:</p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-3xl">{approved.icon_char}</span>
                <span className="text-lg">{approved.text}</span>
              </div>
              <button onClick={retract} className="text-xs text-red-300 hover:text-red-200">Remove</button>
            </div>
          </div>
        )}
        <textarea value={raw} onChange={e => setRaw(e.target.value)} maxLength={400} rows={2}
          placeholder="e.g. Dr Rao can't come, her colleague Mark is coming at 3 instead."
          className="w-full rounded-xl bg-slate-700 px-3 py-2 text-white" />
        <button onClick={make} disabled={busy || raw.trim().length < 2} className="w-full rounded-xl bg-cyan-600 py-3 font-semibold disabled:opacity-40">
          {busy ? 'Writing…' : 'Make it short and simple'}
        </button>
        {draft && (
          <div className="rounded-xl bg-slate-900 p-3 space-y-2">
            <p className="text-xs text-slate-400">Draft{draft.fallback ? ' (AI unavailable: check the wording)' : ''}. The resident cannot see it yet.</p>
            <div className="flex items-center gap-2">
              <span className="text-3xl">{(PURPOSES as any)[draft.icon]?.icon ?? '👤'}</span>
              <input value={text} onChange={e => setText(e.target.value)} className="flex-1 rounded-lg bg-slate-700 px-3 py-2 text-lg" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => decide('approve')} className="rounded-xl bg-emerald-700 py-2 font-semibold">Show to resident</button>
              <button onClick={() => decide('reject')} className="rounded-xl bg-slate-700 py-2">Discard</button>
            </div>
          </div>
        )}
        {msg && <p className="text-sm text-slate-300">{msg}</p>}
      </div>
    </section>
  )
}

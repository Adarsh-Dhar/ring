'use client'

import { useEffect, useState, useCallback } from 'react'
import { useDoorbell } from '../hooks/useDoorbell'

const nice = (f: string) => f.replace(/^level-\d+-/, '').replace(/\.\w+$/, '').replace(/-/g, ' ')
const btn = 'px-3 py-2 rounded-xl text-left text-sm bg-slate-700 hover:bg-slate-600'

export default function SimPage() {
  const { snap, refresh } = useDoorbell()
  const [d, setD] = useState<any>(null)
  const [msg, setMsg] = useState('')
  const [pinInput, setPinInput] = useState('')
  const [needPin, setNeedPin] = useState(false)
  const [timeout, setTimeoutSec] = useState(30)
  const [chaos, setChaos] = useState({ dropPct: 0, duplicatePct: 0, lateMs: 0, badSigPct: 0, appDownPct: 0 })
  const [mode, setMode] = useState('normal')

  const load = useCallback(async () => {
    const r = await fetch('/api/sim', { headers: { 'x-setup-pin': sessionStorage.getItem('setupPin') || '' } })
    if (r.status === 401) { setNeedPin(true); return }
    setNeedPin(false)
    if (!r.ok) { setMsg('Simulator is off. Set ENABLE_SIM=1 (development only).'); return }
    const j = await r.json(); setD(j); setTimeoutSec(j.timeoutSec)
  }, [])
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t) }, [load])

  const post = async (body: object, note?: string) => {
    const r = await fetch('/api/sim', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-setup-pin': sessionStorage.getItem('setupPin') || '' }, body: JSON.stringify(body) })
    if (r.status === 401) { setNeedPin(true); return }
    const j = await r.json().catch(() => ({}))
    setMsg(`${note ?? 'Done'}${j.webhookStatus !== undefined ? ` → app answered ${j.webhookStatus} ${j.webhookBody ?? ''}`: ''}${j.error ?` ✗ ${j.error}` : ''}`)
    refresh(); load()
  }

  if (needPin) return (
    <main className="mx-auto max-w-sm p-6 text-white">
      <h1 className="mb-4 text-xl font-bold">Guardian PIN</h1>
      <input type="password" value={pinInput} onChange={(e) => setPinInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (sessionStorage.setItem('setupPin', pinInput), setPinInput(''), load())} className="mb-3 w-full rounded-lg bg-slate-700 p-2" autoFocus />
    </main>
  )

  const clips: string[] = d?.clips ?? [], recurring: any[] = d?.recurring ?? [], fr = d?.fakeRing
  const simTime = d ? new Date(d.simNow).toLocaleString('en-IN', { timeZone: snap?.timeZone || 'Asia/Kolkata' }) : ''
  const ev = (clip: string | null, recurringId?: string) => post({ action: 'trigger', eventType: 'button_press', clip, recurringId, mode }, `Sent button_press (${mode})`)

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-slate-900 p-6 text-white">
      <h1 className="mb-1 text-2xl font-bold">Ring simulator</h1>
      <p className="mb-6 text-sm text-slate-400">
        Delivery mode: <b className="text-cyan-300">{d?.mode ?? '…'}</b> {d?.mode === 'direct' && '(signed webhooks sent straight to /api/webhook; set FAKE_RING_URL and run npm run sim:ring for retries, chaos and device API)'}
      </p>
      {msg && <p className="mb-4 rounded bg-slate-800 p-2 text-xs text-amber-300">{msg}</p>}

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">1. Delivery type for the next event</h2>
        <div className="flex flex-wrap gap-2">
          {[['normal', 'Normal'], ['duplicate', 'Duplicate (retry)'], ['late', 'Late (+20 s)'], ['badsig', 'Bad signature'], ['nosig', 'No signature']].map(([k, l]) => (
            <button key={k} onClick={() => setMode(k)} className={`${btn} ${mode === k ? '!bg-cyan-600' : ''}`}>{l}</button>
          ))}
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">2. Ring a visitor</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {recurring.map((v) => <button key={v.id} onClick={() => ev(null, v.id)} className={`${btn} !bg-sky-800`}>{v.icon} {v.label}</button>)}
          {clips.map((f) => <button key={f} onClick={() => ev(f)} className={btn}>{nice(f)}</button>)}
          <button onClick={() => ev(null)} className={btn}>doorbell (random video)</button>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">3. Doorbell health (real device_offline / device_online webhooks)</h2>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => post({ action: 'device', online: false }, 'Sent device_offline')} className={`${btn} !bg-amber-700`}>Doorbell goes offline</button>
          <button onClick={() => post({ action: 'device', online: true }, 'Sent device_online')} className={btn}>Doorbell back online</button>
          <button onClick={() => post({ action: 'swallow', value: !d?.offline }, d?.offline ? 'Events accepted again' : 'Ring now delivers NOTHING')} className={`${btn} ${d?.offline ? '!bg-amber-700' : ''}`}>{d?.offline ? 'Ring is silent (click to restore)' : 'Ring silently stops delivering'}</button>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">4. Chaos {d?.mode !== 'fake-ring' && <span className="text-xs text-slate-500">(needs fake Ring server)</span>}</h2>
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          {(Object.keys(chaos) as (keyof typeof chaos)[]).map((k) => (
            <label key={k} className="flex items-center gap-2">{k}
              <input type="number" min={0} value={chaos[k]} onChange={(e) => setChaos({ ...chaos, [k]: Number(e.target.value) })} className="w-20 rounded border border-slate-600 bg-slate-800 px-2 py-1" />
            </label>
          ))}
        </div>
        <button onClick={() => post({ action: 'chaos', ...chaos }, 'Chaos updated')} className={`${btn} mt-2`}>Apply chaos</button>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">5. Clock <span className="text-xs text-slate-400">simulated time: {simTime}</span></h2>
        <div className="flex flex-wrap gap-2">
          {[['+1 min', 60_000], ['+10 min', 600_000], ['+1 hour', 3_600_000], ['+1 day', 86_400_000]].map(([l, ms]) => <button key={l as string} onClick={() => post({ action: 'clock', op: 'advance', ms }, `Clock ${l}`)} className={btn}>{l}</button>)}
          <button onClick={() => post({ action: 'clock', op: 'to', hour: 11, minute: 5 }, 'Jumped to 11:05 (check-in overdue)')} className={btn}>Jump to 11:05</button>
          <button onClick={() => post({ action: 'clock', op: 'to', hour: 23, minute: 0 }, 'Jumped to 23:00 (quiet hours)')} className={btn}>Jump to 23:00</button>
          <button onClick={() => post({ action: 'clock', op: 'reset' }, 'Clock back to real time')} className={btn}>Real time</button>
        </div>
      </section>

      <section className="mb-6 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">Escalation seconds
          <input type="number" min={3} value={timeout} onChange={(e) => setTimeoutSec(Number(e.target.value))} onBlur={() => post({ action: 'timeout', value: timeout }, `Timeout ${timeout}s`)} className="w-20 rounded border border-slate-600 bg-slate-800 px-2 py-1" />
        </label>
        <button onClick={() => post({ action: 'reset' }, 'Reset')} className={`${btn} !bg-red-800`}>Reset everything</button>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">6. Outbox: every push and SMS ({d?.outbox?.length ?? 0})</h2>
        <div className="max-h-56 overflow-auto rounded-xl bg-slate-800 p-3 text-xs">
          {(d?.outbox ?? []).map((o: any, i: number) => (
            <p key={i} className="mb-1"><span className={o.live ? 'text-green-400' : 'text-slate-500'}>{o.live ? 'REAL' : 'mock'}</span> {o.kind} → {o.to}: {o.text}</p>
          ))}
        </div>
      </section>

      {fr && (
        <section className="mb-6">
          <h2 className="mb-2 font-semibold">7. Fake Ring server log</h2>
          <pre className="max-h-56 overflow-auto rounded-xl bg-slate-800 p-3 text-xs text-cyan-300">{fr.error ?? (fr.log ?? []).map((l: any) => `${new Date(l.t).toLocaleTimeString()}  ${l.msg}`).join('\n')}</pre>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-semibold">Live case</h2>
        <pre className="max-h-72 overflow-auto rounded-xl bg-slate-800 p-3 text-xs text-cyan-300">
          {JSON.stringify({ offline: snap?.offline, current: snap?.current && { status: snap.current.status, helperIndex: snap.current.helperIndex, answer: snap.current.answer, log: snap.current.log.map((l: any) => l.msg) } }, null, 2)}
        </pre>
      </section>
    </main>
  )
}

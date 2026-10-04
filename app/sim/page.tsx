'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// ── Types ──────────────────────────────────────────────────────────────────────

type SimState = 'loading' | 'off' | 'on'

interface LogEntry { time: string; text: string; ok: boolean }

interface LiveState {
  current: {
    id: string
    kind: string
    status: string
    answer?: string
    lane?: string
    visitIcon?: string
    visitLabel?: string
    checkMode?: string
    checkWho?: string
    helperIndex: number
    chain: string[]
    log: { t: number; msg: string }[]
    deadlineAt: number
    ackedAt?: number
  } | null
  helpers:     { id: string; name: string; emoji: string }[]
  devices:     Record<string, { online: boolean; since: number }>
  todayVisits: { id: string; icon: string; label: string; done: boolean }[]
  timeoutSec:  number
  plannedMode: string
  quietNow:    boolean
}

// ── Preset scenarios ──────────────────────────────────────────────────────────

type Step = Record<string, unknown> & { action: string }

interface Preset {
  id:    string
  label: string
  hint:  string
  steps: Step[]
}

const PRESETS: Preset[] = [
  {
    id:    'delivery-pass',
    label: '📦 Planned delivery — pass-word passes',
    hint:  'Sets timeout to 10 s, adds a delivery visit with pass-word "hello", rings, resident confirms Yes',
    steps: [
      { action: 'timeout', value: 10 },
      { action: 'plannedMode', mode: 'resident' },
      { action: 'expected', label: 'Delivery', icon: '📦', passphrase: 'hello', minutes: 10 },
      { action: 'event', event: 'button_press' },
    ],
  },
  {
    id:    'delivery-fail',
    label: '📦 Planned delivery — pass-word fails',
    hint:  'Same setup but resident says No, escalates to helper',
    steps: [
      { action: 'timeout', value: 10 },
      { action: 'plannedMode', mode: 'resident' },
      { action: 'expected', label: 'Delivery', icon: '📦', passphrase: 'hello', minutes: 10 },
      { action: 'event', event: 'button_press' },
    ],
  },
  {
    id:    'no-answer',
    label: '⏱️ Nobody answers — escalates',
    hint:  'Sets timeout to 5 s, rings, lets the timer expire through all helpers',
    steps: [
      { action: 'timeout', value: 5 },
      { action: 'plannedMode', mode: 'all-helper' },
      { action: 'event', event: 'button_press' },
    ],
  },
  {
    id:    'offline-then-ring',
    label: '📴 Doorbell offline → visitor arrives',
    hint:  'Takes doorbell offline then back online, then rings',
    steps: [
      { action: 'event', event: 'device_offline' },
      { action: 'event', event: 'device_online' },
      { action: 'event', event: 'button_press' },
    ],
  },
  {
    id:    'sos-quiet',
    label: '🆘 SOS during quiet hours',
    hint:  'Enables quiet hours then fires SOS',
    steps: [
      { action: 'quiet', enabled: true },
      { action: 'sos' },
    ],
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

const SECTION = 'mb-4'
const H2      = 'mb-2 text-xs uppercase tracking-widest text-slate-400 font-semibold'
const BTN     = 'rounded-xl bg-slate-700 px-3 py-2 text-sm text-left hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
const BTN_CY  = 'rounded-xl bg-cyan-600 px-3 py-2 text-sm font-semibold hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
const BTN_RED = 'rounded-xl bg-red-700 px-3 py-2 text-sm hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
const INPUT   = 'rounded-lg bg-slate-700 px-2 py-1.5 text-sm w-full'

// ── Component ─────────────────────────────────────────────────────────────────

export default function SimPage() {
  const router = useRouter()

  const [simState,    setSimState]    = useState<SimState>('loading')
  const [liveState,   setLiveState]   = useState<LiveState | null>(null)
  const [log,         setLog]         = useState<LogEntry[]>([])
  const [busy,        setBusy]        = useState(false)
  const [presetBusy,  setPresetBusy]  = useState<string | null>(null)

  // Form state
  const [device,      setDevice]      = useState('sim-front-door')
  const [visitLabel,  setVisitLabel]  = useState('Demo visitor')
  const [visitIcon,   setVisitIcon]   = useState('👤')
  const [visitWho,    setVisitWho]    = useState('')
  const [passphrase,  setPassphrase]  = useState('')
  const [visitMins,   setVisitMins]   = useState(10)
  const [timeoutVal,  setTimeoutVal]  = useState(10)
  const [faceImage,   setFaceImage]   = useState<File | null>(null)

  const logRef = useRef<HTMLUListElement>(null)

  // ── Init check ──────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/dev/simulate')
      .then(async r => {
        if (r.status === 401 || r.status === 403) { router.push('/login'); return }
        const d = await r.json().catch(() => ({}))
        setSimState(d.enabled ? 'on' : 'off')
      })
      .catch(() => setSimState('off'))
  }, [router])

  // ── State polling ───────────────────────────────────────────────────────────
  const refreshState = useCallback(async () => {
    const r = await fetch('/api/dev/simulate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'state' }),
    }).catch(() => null)
    if (!r?.ok) return
    const d = await r.json().catch(() => null)
    if (d?.state) setLiveState(d.state as LiveState)
  }, [])

  useEffect(() => {
    if (simState !== 'on') return
    refreshState()
    const t = setInterval(refreshState, 2000)
    return () => clearInterval(t)
  }, [simState, refreshState])

  // ── Log helper ──────────────────────────────────────────────────────────────
  function add(text: string, ok: boolean) {
    setLog(l => [{ time: new Date().toLocaleTimeString(), text, ok }, ...l].slice(0, 50))
  }

  // ── Post helper ─────────────────────────────────────────────────────────────
  async function post(body: Step, label?: string): Promise<Record<string, unknown>> {
    const r = await fetch('/api/dev/simulate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null)

    if (!r) { add(`${label ?? body.action}: network error`, false); return {} }
    const d = await r.json().catch(() => ({}))

    if (!r.ok) {
      add(`${label ?? body.action}: ${d.error ?? 'failed'}`, false)
    } else if (d.result === 'ignored') {
      add(`${label ?? body.action}: ignored — ${d.reason}`, false)
    } else {
      const extra = d.caseId ? ` (case …${String(d.caseId).slice(-6)})` : d.by ? ` by ${d.by}` : ''
      add(`${label ?? body.action}${extra}`, true)
    }

    await refreshState()
    return d
  }

  // ── Preset runner ────────────────────────────────────────────────────────────
  async function runPreset(preset: Preset) {
    setPresetBusy(preset.id)
    add(`▶ Running preset: ${preset.label}`, true)
    for (const step of preset.steps) {
      await post(step, `  ${step.action}`)
      await new Promise(r => setTimeout(r, 600))
    }
    setPresetBusy(null)
  }

  // ── Current caseId from live state ──────────────────────────────────────────
  const caseId = liveState?.current?.id ?? ''

  // ── Screens ──────────────────────────────────────────────────────────────────
  if (simState === 'loading') return <main className="p-6 text-slate-400">Loading…</main>

  if (simState === 'off') return (
    <main className="mx-auto max-w-lg p-6 text-slate-300">
      <h1 className="mb-2 text-xl font-semibold">Simulator is off</h1>
      <p className="text-slate-400">Set <code className="rounded bg-slate-700 px-1">DEMO_MODE=1</code> in <code className="rounded bg-slate-700 px-1">.env.local</code> and restart the server.</p>
    </main>
  )

  const cur = liveState?.current
  const helpers = liveState?.helpers ?? []
  const onCallHelper = cur ? helpers[cur.helperIndex] : null

  return (
    <main className="mx-auto max-w-5xl p-4 space-y-2">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">🎮 Doorbell Simulator</h1>
        <a href="/setup" className="text-sm text-cyan-400 hover:text-cyan-300">← Setup</a>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

        {/* ── LEFT COLUMN ──────────────────────────────────────────────────── */}
        <div className="space-y-5">

          {/* A. Ring events */}
          <section className={SECTION}>
            <h2 className={H2}>A. Ring events</h2>
            <div className="mb-2 flex items-center gap-2">
              <label className="text-xs text-slate-400 shrink-0">Device:</label>
              <select value={device} onChange={e => setDevice(e.target.value)} className={`${INPUT} w-auto`}>
                <option value="sim-front-door">sim-front-door</option>
                <option value="sim-back-door">sim-back-door</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {([
                ['button_press',    '🔔 Doorbell press'],
                ['motion_detected', '🚶 Motion detected'],
                ['device_offline',  '📴 Go offline'],
                ['device_online',   '📶 Come online'],
              ] as const).map(([ev, label]) => (
                <button key={ev} disabled={busy} onClick={async () => { setBusy(true); await post({ action: 'event', event: ev, device }, label); setBusy(false) }}
                  className={BTN}>
                  {label}
                </button>
              ))}
            </div>
          </section>

          {/* B. Helper actions */}
          <section className={SECTION}>
            <h2 className={H2}>B. Helper actions {onCallHelper && <span className="normal-case font-normal text-slate-400">(on call: {onCallHelper.emoji} {onCallHelper.name})</span>}</h2>
            <div className="grid grid-cols-2 gap-2">
              <button disabled={busy || !caseId} onClick={async () => { setBusy(true); await post({ action: 'ack', caseId }, '👀 Acknowledge'); setBusy(false) }} className={BTN}>
                👀 Acknowledge
              </button>
              <button disabled={busy || !caseId} onClick={async () => { setBusy(true); await post({ action: 'answer', caseId, answer: 'safe', visitor: 'known' }, '✅ Answer safe'); setBusy(false) }} className={BTN}>
                ✅ Safe (known)
              </button>
              <button disabled={busy || !caseId} onClick={async () => { setBusy(true); await post({ action: 'answer', caseId, answer: 'safe', visitor: 'delivery' }, '📦 Safe (delivery)'); setBusy(false) }} className={BTN}>
                📦 Safe (delivery)
              </button>
              <button disabled={busy || !caseId} onClick={async () => { setBusy(true); await post({ action: 'answer', caseId, answer: 'not_safe' }, '⛔ Not safe'); setBusy(false) }} className={BTN}>
                ⛔ Not safe
              </button>
              <button disabled={busy || !caseId} onClick={async () => { setBusy(true); await post({ action: 'answer', caseId, answer: 'call_me' }, '📞 Call me'); setBusy(false) }} className={BTN}>
                📞 Call me
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              "Helper doesn't answer": do nothing and watch the escalation timer count down.
            </p>
          </section>

          {/* C. Resident actions */}
          <section className={SECTION}>
            <h2 className={H2}>C. Resident actions</h2>
            <div className="grid grid-cols-2 gap-2">
              <button disabled={busy} onClick={async () => { setBusy(true); await post({ action: 'sos' }, '🆘 SOS'); setBusy(false) }} className={`${BTN} col-span-2`}>
                🆘 Press SOS
              </button>
              <button disabled={busy || !caseId} onClick={async () => { setBusy(true); await post({ action: 'confirm', caseId, ok: true }, '✅ Confirm open'); setBusy(false) }} className={BTN}>
                ✅ Open the door
              </button>
              <button disabled={busy || !caseId} onClick={async () => { setBusy(true); await post({ action: 'confirm', caseId, ok: false }, '✋ Decline open'); setBusy(false) }} className={BTN}>
                ✋ Keep closed
              </button>
              <button disabled={busy || !caseId} onClick={async () => { setBusy(true); await post({ action: 'verify', caseId, ok: true }, '✅ Pass-word yes'); setBusy(false) }} className={BTN}>
                ✅ Pass-word: Yes
              </button>
              <button disabled={busy || !caseId} onClick={async () => { setBusy(true); await post({ action: 'verify', caseId, ok: false }, '✋ Pass-word no'); setBusy(false) }} className={BTN}>
                ✋ Pass-word: No
              </button>
              <button disabled={busy} onClick={async () => { setBusy(true); await post({ action: 'checkin' }, '👍 Check in'); setBusy(false) }} className={BTN}>
                👍 Daily check-in
              </button>
            </div>
          </section>

          {/* D. Planned visits */}
          <section className={SECTION}>
            <h2 className={H2}>D. Add expected visit</h2>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-xs text-slate-400">Label</label>
                <input value={visitLabel} onChange={e => setVisitLabel(e.target.value)} className={INPUT} placeholder="Demo visitor" />
              </div>
              <div>
                <label className="text-xs text-slate-400">Icon</label>
                <input value={visitIcon} onChange={e => setVisitIcon(e.target.value)} className={INPUT} placeholder="👤" maxLength={4} />
              </div>
              <div>
                <label className="text-xs text-slate-400">Who (shown to resident)</label>
                <input value={visitWho} onChange={e => setVisitWho(e.target.value)} className={INPUT} placeholder="e.g. the delivery person" />
              </div>
              <div>
                <label className="text-xs text-slate-400">Pass-word (optional)</label>
                <input value={passphrase} onChange={e => setPassphrase(e.target.value)} className={INPUT} placeholder="e.g. hello" />
              </div>
              <div>
                <label className="text-xs text-slate-400">Window (minutes)</label>
                <input type="number" min={1} max={120} value={visitMins} onChange={e => setVisitMins(Number(e.target.value))} className={INPUT} />
              </div>
            </div>
            <button disabled={busy} onClick={async () => {
              setBusy(true)
              await post({
                action: 'expected', label: visitLabel || 'Demo visitor',
                icon: visitIcon || '👤', who: visitWho || undefined,
                passphrase: passphrase || undefined, minutes: visitMins,
              }, `📅 Add expected: ${visitLabel}`)
              setBusy(false)
            }} className={`${BTN_CY} w-full`}>
              📅 Add expected visit (starts now)
            </button>
          </section>

          {/* E. Settings */}
          <section className={SECTION}>
            <h2 className={H2}>E. Settings</h2>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <button disabled={busy} onClick={async () => { setBusy(true); await post({ action: 'quiet', enabled: true },  '🌙 Quiet on');  setBusy(false) }} className={BTN}>🌙 Quiet on</button>
              <button disabled={busy} onClick={async () => { setBusy(true); await post({ action: 'quiet', enabled: false }, '☀️ Quiet off'); setBusy(false) }} className={BTN}>☀️ Quiet off</button>
              {(['helper', 'resident', 'all-helper'] as const).map(m => (
                <button key={m} disabled={busy} onClick={async () => { setBusy(true); await post({ action: 'plannedMode', mode: m }, `🔀 Mode: ${m}`); setBusy(false) }}
                  className={`${BTN} ${liveState?.plannedMode === m ? 'ring-1 ring-cyan-400' : ''}`}>
                  {m === 'helper' ? '👤 Helper mode' : m === 'resident' ? '🏠 Resident mode' : '👥 All-helper mode'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400 shrink-0">Timeout (s):</label>
              <input type="number" min={5} max={600} value={timeoutVal} onChange={e => setTimeoutVal(Number(e.target.value))} className={`${INPUT} w-20`} />
              <button disabled={busy} onClick={async () => { setBusy(true); await post({ action: 'timeout', value: timeoutVal }, `⏱ Timeout ${timeoutVal}s`); setBusy(false) }} className={BTN}>
                Set
              </button>
            </div>
          </section>

          {/* F. Face recognition (sim doorbell upload) */}
          <section className={SECTION}>
            <h2 className={H2}>F. Face recognition (sim upload)</h2>
            <div className="mb-2">
              <input
                type="file"
                accept="image/*"
                onChange={e => setFaceImage(e.target.files?.[0] ?? null)}
                className="text-xs text-slate-400"
              />
            </div>
            <button
              disabled={busy || !faceImage || !caseId}
              onClick={async () => {
                if (!faceImage) return
                setBusy(true)
                const reader = new FileReader()
                reader.onload = async () => {
                  const dataUrl = reader.result as string
                  const r = await fetch('/api/face', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'sighting', image: dataUrl, caseId, deviceId: 'sim-doorbell' }),
                  }).catch(() => null)
                  if (r?.ok) {
                    const d = await r.json().catch(() => ({}))
                    const faces = d.sighting?.faces ?? []
                    const faceInfo = faces.map((f: any) => f.status === 'known' ? f.name : 'unknown').join(', ')
                    add(`Face sighting: ${faceInfo || 'no faces'}`, true)
                  } else {
                    add('Face sighting failed', false)
                  }
                  setBusy(false)
                }
                reader.readAsDataURL(faceImage)
              }}
              className={BTN}>
              📷 Upload for face check
            </button>
          </section>

          {/* G. Scenario presets */}
          <section className={SECTION}>
            <h2 className={H2}>F. Scenario presets</h2>
            <div className="space-y-2">
              {PRESETS.map(p => (
                <button key={p.id} disabled={!!presetBusy || busy}
                  onClick={() => runPreset(p)}
                  className="w-full rounded-xl bg-slate-800 p-3 text-left hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  <div className="text-sm font-medium">{p.label}</div>
                  <div className="text-xs text-slate-400">{p.hint}</div>
                  {presetBusy === p.id && <div className="mt-1 text-xs text-cyan-400 animate-pulse">Running…</div>}
                </button>
              ))}
            </div>
          </section>

          {/* Reset */}
          <section className={SECTION}>
            <button disabled={busy} onClick={async () => {
              if (!confirm('Reset all cases and state for this household?')) return
              setBusy(true); await post({ action: 'reset' }, '🗑 Reset demo'); setBusy(false)
            }} className={`${BTN_RED} w-full`}>
              🗑 Reset demo (clear all cases)
            </button>
          </section>
        </div>

        {/* ── RIGHT COLUMN — live state panel ──────────────────────────────── */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">

          {/* H. Current case */}
          <section>
            <h2 className={H2}>G. Live state <span className="normal-case font-normal text-slate-500">(auto-refreshes every 2 s)</span></h2>
            {!liveState ? (
              <p className="text-slate-500 text-sm">Waiting…</p>
            ) : !cur ? (
              <div className="rounded-2xl bg-slate-800 p-4 text-center text-slate-400">
                <div className="text-3xl mb-1">😌</div>
                <p className="text-sm">No active case</p>
                {liveState.todayVisits.length > 0 && (
                  <ul className="mt-2 text-xs space-y-0.5 text-left">
                    {liveState.todayVisits.map(v => (
                      <li key={v.id} className={v.done ? 'text-slate-600' : 'text-slate-300'}>
                        {v.icon} {v.label} {v.done ? '✓' : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className={`rounded-2xl p-4 space-y-3 ${cur.kind === 'sos' ? 'bg-rose-900' : cur.lane === 'expected' ? 'bg-sky-900' : 'bg-slate-800'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-sm">
                      {cur.kind === 'sos' ? '🆘 SOS' : cur.lane === 'expected' ? `${cur.visitIcon} ${cur.visitLabel}` : '🚪 Visitor'}
                    </p>
                    <p className="text-xs text-slate-400 font-mono">…{cur.id.slice(-8)}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                    cur.status === 'waiting'     ? 'bg-amber-600' :
                    cur.status === 'answered'    ? 'bg-emerald-700' :
                    cur.status === 'no_response' ? 'bg-red-700' : 'bg-slate-600'
                  }`}>
                    {cur.status}
                    {cur.answer ? ` · ${cur.answer}` : ''}
                  </span>
                </div>

                {cur.status === 'waiting' && (
                  <div>
                    <p className="text-xs text-slate-400">
                      On-call: {helpers[cur.helperIndex]?.emoji} {helpers[cur.helperIndex]?.name ?? '—'}
                      {' '}({cur.helperIndex + 1}/{cur.chain.length})
                    </p>
                    <p className="text-xs text-slate-400">
                      Deadline: {new Date(cur.deadlineAt).toLocaleTimeString()}
                    </p>
                    {cur.ackedAt && <p className="text-xs text-emerald-400">Acked ✓</p>}
                  </div>
                )}

                {cur.checkMode && (
                  <p className="text-xs bg-sky-800 rounded px-2 py-1">
                    Check mode: <strong>{cur.checkMode}</strong>
                    {cur.checkWho ? ` · who: ${cur.checkWho}` : ''}
                  </p>
                )}

                {/* Case log */}
                <div>
                  <p className="text-xs text-slate-500 mb-1">Case log:</p>
                  <ul className="space-y-0.5 max-h-36 overflow-y-auto">
                    {[...cur.log].reverse().map((l, i) => (
                      <li key={i} className="text-xs text-slate-300 leading-relaxed">
                        <span className="text-slate-500">{new Date(l.t).toLocaleTimeString()}</span>{' '}{l.msg}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </section>

          {/* Helpers */}
          <section>
            <h2 className={H2}>I. Helpers</h2>
            <ul className="space-y-1">
              {(liveState?.helpers ?? []).map((h, i) => (
                <li key={h.id} className="flex items-center gap-2 text-sm">
                  <span>{h.emoji} {h.name}</span>
                  {cur?.chain.includes(h.id) && cur.helperIndex === i && cur.status === 'waiting' && (
                    <span className="text-xs bg-amber-600 rounded px-1">on-call</span>
                  )}
                </li>
              ))}
              {(liveState?.helpers.length ?? 0) === 0 && <li className="text-slate-500 text-sm">No approved helpers</li>}
            </ul>
          </section>

          {/* Devices */}
          <section>
            <h2 className={H2}>J. Devices</h2>
            {Object.keys(liveState?.devices ?? {}).length === 0
              ? <p className="text-slate-500 text-sm">No devices seen yet</p>
              : (
                <ul className="space-y-1">
                  {Object.entries(liveState?.devices ?? {}).map(([id, d]) => (
                    <li key={id} className="flex items-center gap-2 text-sm">
                      <span className={d.online ? 'text-emerald-400' : 'text-red-400'}>{d.online ? '📶' : '📴'}</span>
                      <span className="font-mono text-xs">{id}</span>
                    </li>
                  ))}
                </ul>
              )
            }
          </section>

          {/* Settings summary */}
          {liveState && (
            <section>
              <h2 className={H2}>K. Current settings</h2>
              <ul className="text-xs text-slate-400 space-y-0.5">
                <li>Timeout: <strong className="text-slate-200">{liveState.timeoutSec}s</strong></li>
                <li>Planned mode: <strong className="text-slate-200">{liveState.plannedMode}</strong></li>
                <li>Quiet now: <strong className={liveState.quietNow ? 'text-amber-300' : 'text-slate-200'}>{liveState.quietNow ? 'yes 🌙' : 'no'}</strong></li>
              </ul>
            </section>
          )}

          {/* Action log */}
          <section>
            <h2 className={H2}>L. Action log</h2>
            <ul ref={logRef} className="space-y-0.5 max-h-52 overflow-y-auto text-xs">
              {log.length === 0 && <li className="text-slate-500">Nothing sent yet.</li>}
              {log.map((entry, i) => (
                <li key={i} className="flex gap-2 leading-relaxed">
                  <span className="shrink-0 text-slate-500">{entry.time}</span>
                  <span className={entry.ok ? 'text-emerald-400' : 'text-amber-400'}>{entry.text}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </main>
  )
}

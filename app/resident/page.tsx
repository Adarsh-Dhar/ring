'use client'

import { useEffect, useRef, useState } from 'react'
import { useDoorbell } from '../hooks/useDoorbell'
import LiveView from '../helper/LiveView'

type Screen = { icon: string; title: string; sub?: string; bg: string; alarm?: boolean; calm?: boolean }

const VIBRATE_KEY = 'resident.vibrate'

export default function ResidentPage() {
  const { snap, error, stale, unauthorized, refresh, secondsLeft } = useDoorbell()
  const [, force]     = useState(0)
  const [sound,     setSound]     = useState(false)
  const [vibrate,   setVibrate]   = useState(() => {
    if (typeof localStorage === 'undefined') return true
    return localStorage.getItem(VIBRATE_KEY) !== 'false'
  })
  const [showVideo, setShowVideo] = useState(false)
  const audio = useRef<AudioContext | null>(null)

  useEffect(() => { localStorage.setItem(VIBRATE_KEY, String(vibrate)) }, [vibrate])

  useEffect(() => {
    const t = setInterval(() => force(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    const ask = async () => { try { lock = (await (navigator as any).wakeLock?.request('screen')) ?? null } catch {} }
    ask()
    const onVis = () => document.visibilityState === 'visible' && ask()
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); lock?.release().catch(() => {}) }
  }, [])

  const helpers       = snap?.helpers ?? []
  const c             = snap?.current ?? null
  const emergency     = snap?.emergencyNumber ?? '112'
  const first         = helpers[0]
  const currentHelper = (c ? helpers.find(h => h.id === c.chain[c.helperIndex]) : undefined) ?? first
  const answeredBy    = c?.answeredBy ? helpers.find(h => h.id === c.answeredBy) : undefined
  const ackedBy       = c?.ackedBy    ? helpers.find(h => h.id === c.ackedBy)    : undefined
  const callTarget    = answeredBy ?? first
  const callName      = first?.name ?? 'your helper'

  const waiting = c?.status === 'waiting'
  const visitor = c?.kind   === 'visitor'

  // ── Screen selection ──────────────────────────────────────────────────────
  let screen: Screen

  if (unauthorized) {
    if (typeof window !== 'undefined') window.location.href = '/pair'
    screen = { icon: '🔒', title: 'Not paired', sub: 'Enter the pairing code to connect your device.', bg: 'bg-amber-700', alarm: true }
  } else if (stale || (error && !snap)) {
    screen = { icon: '⚠️', title: 'Connection lost', sub: `Keep the door closed. Call ${callName}.`, bg: 'bg-amber-700', alarm: true }
  } else if (snap && !snap.ready) {
    screen = { icon: '🛠️', title: 'Not ready yet', sub: 'Nobody can be alerted. Keep the door closed and call for help.', bg: 'bg-amber-700', alarm: true }
  } else if (snap?.offline) {
    screen = { icon: '⚠️', title: 'Doorbell may not work', sub: `Do not open the door. Call ${callName}.`, bg: 'bg-amber-700', alarm: true }
  } else if (!c && (snap?.expectedNow?.length || snap?.recurringNow?.length)) {
    const e = snap!.recurringNow[0] ?? snap!.expectedNow[0]
    screen = { icon: e.icon, title: `${e.label} expected`, sub: `Until ${new Date(e.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Wait for the bell.`, bg: 'bg-sky-800', calm: true }
  } else if (!c) {
    screen = { icon: '🏠', title: 'All quiet', sub: 'Nobody at the door', bg: 'bg-emerald-800', calm: true }
  } else if (c.kind === 'sos') {
    if (c.status === 'no_response') {
      screen = { icon: '🚨', title: 'Call for help now', sub: `Nobody has answered. Call ${emergency}.`, bg: 'bg-red-800', alarm: true }
    } else if (c.status === 'answered') {
      if (c.answer === 'safe') {
        screen = { icon: '✅', title: `${answeredBy?.name ?? 'Your helper'} says it is safe`, sub: 'You can relax now. Stay where you are.', bg: 'bg-emerald-800' }
      } else if (c.answer === 'not_safe') {
        screen = { icon: '⛔', title: `${answeredBy?.name ?? 'Your helper'} says stay inside`, sub: 'Do not open the door. They are helping you.', bg: 'bg-red-800', alarm: true }
      } else {
        screen = { icon: '📞', title: `${answeredBy?.name ?? 'Your helper'} is calling you`, sub: 'Pick up the phone. They are helping you.', bg: 'bg-indigo-800' }
      }
    } else if (c.ackedAt) {
      screen = { icon: '🤝', title: `${ackedBy?.name ?? 'A helper'} knows`, sub: `${ackedBy?.name ?? 'They'} is helping you. Stay here.`, bg: 'bg-rose-800' }
    } else {
      screen = { icon: '🆘', title: `Telling ${currentHelper?.name ?? 'a helper'}…`, sub: `Stay here. If you are in danger call ${emergency}.`, bg: 'bg-rose-800', alarm: true }
    }
  } else if (snap?.quietNow && (waiting || (c.status === 'answered' && c.answer === 'safe'))) {
    screen = { icon: '🌙', title: 'Night lock is on', sub: 'Do not open the door', bg: 'bg-indigo-900' }
  } else if (c.lane === 'expected' && waiting && c.checkWord) {
    // Resident pass-word check
    screen = { icon: c.visitIcon ?? '👤', title: `${c.checkWho ?? c.visitLabel ?? 'A visitor'} may be here`, sub: `Ask them to say a word. Did they say "${c.checkWord}"?`, bg: 'bg-amber-700', calm: true }
  } else if (c.status === 'answered' && (c as any).selfVerifiedAt && !c.declinedAt) {
    screen = { icon: '✅', title: 'OK to open the door', sub: `${c.visitLabel ? c.visitIcon + ' ' + c.visitLabel : 'Visitor'} confirmed.`, bg: 'bg-emerald-800', calm: true }
  } else if (c.lane === 'expected' && waiting) {
    screen = { icon: c.visitIcon ?? '👤', title: `${c.visitLabel ?? 'A visitor'} may be here`, sub: `Wait. ${currentHelper?.name ?? 'Your helper'} is checking.`, bg: 'bg-sky-800', calm: true }
  } else if (waiting) {
    screen = { icon: '🚪', title: 'Someone is here', sub: `Keep the door closed. ${currentHelper?.name ?? 'Your helper'} is checking.`, bg: 'bg-sky-800', calm: true }
  } else if (c.status === 'no_response') {
    screen = { icon: '⚠️', title: "Don't open the door", sub: `Nobody answered. Call ${callName}`, bg: 'bg-amber-700', alarm: true }
  } else if (c.answer === 'safe') {
    if (c.declinedAt) {
      screen = { icon: '🚪', title: 'Door stays closed', sub: 'You chose not to open', bg: 'bg-slate-700' }
    } else if (!c.confirmedAt) {
      screen = {
        icon: '🙋', bg: 'bg-teal-800',
        title: `${answeredBy?.name ?? 'Your helper'} says it is OK`,
        sub:   c.lane === 'expected' && c.visitLabel
                 ? `${c.visitIcon} ${c.visitLabel}. Open the door?`
                 : c.visitor === 'delivery' ? '📦 A delivery. Open the door?' : '👤 Someone you know. Open the door?',
      }
    } else {
      screen = { icon: '✅', title: 'OK to open the door', sub: `${answeredBy?.name ?? 'Your helper'} says it is safe`, bg: 'bg-emerald-800' }
    }
  } else if (c.answer === 'not_safe') {
    screen = { icon: '⛔', title: "Don't open the door", sub: `${answeredBy?.name ?? 'Your helper'} says stay inside`, bg: 'bg-red-800' }
  } else {
    screen = { icon: '📞', title: `${answeredBy?.name ?? 'Your helper'} is calling you`, sub: 'Pick up the phone', bg: 'bg-indigo-800' }
  }

  // ── Sound + vibration ─────────────────────────────────────────────────────
  const prev = useRef('')
  useEffect(() => {
    const key = `${screen.title}|${screen.sub}`
    if (prev.current && prev.current !== key) {
      if (vibrate && !screen.calm) {
        try { navigator.vibrate?.(screen.alarm ? [400, 150, 400, 150, 400] : [200]) } catch {}
      }
      if (sound && !screen.calm) {
        try {
          const ctx = (audio.current ||= new AudioContext())
          const o = ctx.createOscillator(); const g = ctx.createGain()
          o.frequency.value = screen.alarm ? 660 : 880; g.gain.value = 0.25
          o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + (screen.alarm ? 0.6 : 0.25))
        } catch {}
        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel()
          const u = new SpeechSynthesisUtterance(`${screen.title}. ${screen.sub ?? ''}`)
          u.lang = process.env.NEXT_PUBLIC_SPEECH_LANG || 'en-IN'
          window.speechSynthesis.speak(u)
        }
      }
    }
    prev.current = key
  }, [screen.title, screen.sub, screen.calm, screen.alarm, sound, vibrate])

  const post = async (url: string, body?: object) => {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).catch(() => {})
    refresh()
  }

  const trusted         = !unauthorized && !stale && !!snap
  const awaitingConfirm = trusted && visitor && c.status === 'answered' && c.answer === 'safe' && !c.confirmedAt && !c.declinedAt && !snap?.quietNow && !(c as any).selfVerifiedAt
  const showBar         = false   // per spec: showBar = false
  const pct             = showBar ? Math.max(0, Math.min(100, (secondsLeft(c!.deadlineAt) / snap!.timeoutSec) * 100)) : 0
  const sosNeedsEmergency = c?.kind === 'sos' && !c.ackedAt && c.status !== 'answered'

  // Pass-word check buttons
  const showCheck = trusted && visitor && waiting && c.lane === 'expected' && !!c.checkWord && !snap?.quietNow

  // Today's visits on idle screen
  const idleVisits = trusted && !c && (snap!.todayVisits ?? [])

  return (
    <main aria-live="polite" className={`min-h-screen ${screen.bg} text-white flex flex-col items-center justify-between p-6 transition-colors duration-700 motion-reduce:transition-none`}>
      <div className="w-full max-w-md flex justify-between text-sm">
        <span>Resident screen</span>
        <div className="flex gap-2">
          <button onClick={() => setShowVideo(s => !s)} className="px-3 py-1 rounded-full bg-black/30" aria-label="Toggle video feed">
            {showVideo ? '📹 On' : '📹 Off'}
          </button>
          <button onClick={() => setSound(s => !s)} className="px-3 py-1 rounded-full bg-black/30" aria-label="Sound and read aloud">
            {sound ? '🔊 On' : '🔈 Off'}
          </button>
          <button onClick={() => setVibrate(v => !v)} className="px-3 py-1 rounded-full bg-black/30" aria-label="Vibration">
            📳 {vibrate ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      <div className="flex flex-col items-center text-center gap-4" role="status" aria-live="assertive">
        <div className="text-[9rem] leading-none">{screen.icon}</div>
        <h1 className="text-4xl font-bold">{screen.title}</h1>
        {screen.sub && <p className="text-2xl max-w-sm">{screen.sub}</p>}
        {showVideo && c && c.deviceId && (
          <div className="w-full max-w-md mt-4">
            <LiveView caseId={c.id} />
          </div>
        )}
      </div>

      <div className="w-full max-w-md flex flex-col gap-4">
        {/* Pass-word verification buttons */}
        {showCheck && (
          <div className="grid grid-cols-2 gap-4">
            <button onClick={() => post('/api/doorbell/verify', { caseId: c!.id, ok: true  })} className="rounded-3xl bg-emerald-500 py-6 text-2xl font-bold text-white">✅ Yes</button>
            <button onClick={() => post('/api/doorbell/verify', { caseId: c!.id, ok: false })} className="rounded-3xl bg-red-600   py-6 text-2xl font-bold text-white">❌ No</button>
          </div>
        )}

        {/* Helper-answered confirm/deny */}
        {awaitingConfirm && (
          <div className="grid grid-cols-2 gap-4">
            <button onClick={() => post('/api/doorbell/confirm', { caseId: c!.id, ok: true  })} className="rounded-3xl bg-white py-6 text-2xl font-bold text-emerald-900">✅ Yes, open</button>
            <button onClick={() => post('/api/doorbell/confirm', { caseId: c!.id, ok: false })} className="rounded-3xl border-4 border-white bg-black/40 py-6 text-2xl font-bold">✋ No</button>
          </div>
        )}

        {trusted && !snap!.checkin.doneToday && c?.status !== 'waiting' && (
          <button onClick={() => post('/api/doorbell/checkin')} aria-label="I am OK today" className="w-full rounded-3xl bg-emerald-500 py-6 text-center text-3xl font-bold text-white shadow-lg">
            👍 I'm OK today
          </button>
        )}

        {(sosNeedsEmergency || c?.kind === 'sos' && c.status === 'no_response') && (
          <a href={`tel:${emergency}`} className="w-full text-center text-3xl font-bold py-6 rounded-3xl bg-white text-red-800 shadow-lg">
            🚨 Call {emergency}
          </a>
        )}
        {callTarget?.phone && (
          <a href={`tel:${callTarget.phone}`} className="w-full text-center text-3xl font-bold py-6 rounded-3xl bg-white text-slate-900 shadow-lg">
            📞 Call {callTarget.name}
          </a>
        )}
        {trusted && (
          <button onClick={() => post('/api/doorbell/sos')} aria-label="I need help. Alert my helpers" className="w-full text-3xl font-bold py-6 rounded-3xl bg-black/40 border-4 border-white">
            😨 I need help
          </button>
        )}
        {!trusted && !unauthorized && (
          <a href={`tel:${emergency}`} className="w-full text-center text-xl font-bold py-4 rounded-3xl bg-black/40 border-4 border-white">
            🚨 Emergency {emergency}
          </a>
        )}

        {/* Today's visit schedule on idle screen */}
        {idleVisits && idleVisits.length > 0 && (
          <div className="rounded-2xl bg-black/20 p-4">
            <p className="mb-2 text-sm uppercase tracking-wide text-white/60">Today</p>
            <ul className="space-y-1 text-lg">
              {idleVisits.map(v => (
                <li key={v.id} className="flex items-center gap-3">
                  <span>{v.icon}</span>
                  <span className={v.done ? 'line-through opacity-50' : ''}>{v.label}</span>
                  <span className="ml-auto text-sm opacity-70">
                    {new Date(v.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: snap!.timeZone })}
                  </span>
                  {v.done && <span>✓</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  )
}

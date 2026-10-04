'use client'

import { useEffect, useRef, useState } from 'react'
import { useDoorbell } from '../hooks/useDoorbell'
import { useRealtime } from '../hooks/useRealtime'
import LiveView from '../helper/LiveView'
import RegularApprovals from './RegularApprovals'

// calm = no vibration and no beep. Used while a helper is checking, so a visitor never startles the resident.
type Screen = { icon: string; title: string; sub?: string; bg: string; alarm?: boolean; calm?: boolean }

export default function ResidentPage() {
  // Try SSE for realtime updates, fall back to polling
  const [householdId, setHouseholdId] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)

  // Extract householdId from session on mount
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const res = await fetch('/api/session')
        if (res.ok) {
          const data = await res.json()
          if (data.kind === 'resident') {
            setHouseholdId(data.householdId)
            // Use the device cookie as token for SSE
            const cookies = document.cookie.split(';')
            const deviceCookie = cookies.find(c => c.trim().startsWith('device='))
            if (deviceCookie) {
              setToken(deviceCookie.split('=')[1])
            }
          }
        }
      } catch (e) {
        console.warn('[RESIDENT] Failed to get session for SSE:', e)
      }
    }
    fetchSession()
  }, [])

  // SSE connection (if householdId is available)
  const { state: realtimeState, connected: sseConnected, error: sseError } = useRealtime({
    householdId: householdId || '',
    token: token || '',
    onHeartbeatLost: () => {
      console.warn('[RESIDENT] SSE heartbeat lost, showing fail-closed state')
      setSseLost(true)
      refresh()
    },
    onStateChange: (state) => {
      console.log('[RESIDENT] SSE state update received:', state?.state)
      // Could integrate SSE state with polling state here
    },
  })

  // Clear sseLost when SSE reconnects
  useEffect(() => {
    if (sseConnected) {
      setSseLost(false)
    }
  }, [sseConnected])

  // Primary polling (always running, used when SSE is down or unavailable)
  const { snap, error, stale, unauthorized, refresh, secondsLeft } = useDoorbell()
  const [, force] = useState(0)
  const [sound, setSound] = useState(false) // read aloud + beeps. Turning it on is also the tap browsers need for audio.
  const [showVideo, setShowVideo] = useState(false) // toggle to show/hide video feed
  const [vibrate, setVibrate] = useState(true) // the person can turn buzzing off; remembered on this device
  const [sseLost, setSseLost] = useState(false) // SSE connection lost
  useEffect(() => { try { if (localStorage.getItem('resident.vibrate') === '0') setVibrate(false) } catch {} }, [])
  const toggleVibrate = () => setVibrate((v) => { try { localStorage.setItem('resident.vibrate', v ? '0' : '1') } catch {} return !v })
  const audio = useRef<AudioContext | null>(null)

  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // Keep the screen awake: a sleeping tab cannot show a visitor.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    const ask = async () => { try { lock = (await (navigator as any).wakeLock?.request('screen')) ?? null } catch {} }
    ask()
    const onVis = () => document.visibilityState === 'visible' && ask()
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); lock?.release().catch(() => {}) }
  }, [])

  const helpers = snap?.helpers ?? []
  const c = snap?.current ?? null
  const emergency = snap?.emergencyNumber ?? '112'
  const first = helpers[0]
  const currentHelper = (c ? helpers.find((h) => h.id === c.chain[c.helperIndex]) : undefined) ?? first
  const answeredBy = c?.answeredBy ? helpers.find((h) => h.id === c.answeredBy) : undefined
  const ackedBy = c?.ackedBy ? helpers.find((h) => h.id === c.ackedBy) : undefined
  // For emergencies and general calls, always prefer the first helper (primary contact)
  // unless someone has already answered this specific case
  const callTarget = answeredBy ?? first
  const callName = first?.name ?? 'your helper'

  // Order matters: anything that means "we can't be sure" comes BEFORE any "all quiet" or "OK to open" screen.
  let screen: Screen
  if (unauthorized) {
    // Redirect to pair page
    if (typeof window !== 'undefined') {
      window.location.href = '/pair'
    }
    screen = { icon: '🔒', title: 'Not paired', sub: 'Enter the pairing code to connect your device.', bg: 'bg-amber-700', alarm: true }
  } else if (stale || (error && !snap)) {
    screen = { icon: '⚠️', title: 'Connection lost', sub: `Keep the door closed. Call ${callName}.`, bg: 'bg-amber-700', alarm: true }
  } else if (sseLost || (realtimeState?.state === 'CLOSED_KEEP_SHUT' && realtimeState?.canOpen === false)) {
    screen = { icon: '⚠️', title: 'Keep the door closed', sub: `Call ${callName}.`, bg: 'bg-amber-700', alarm: true }
  } else if (snap && !snap.dbHealthy) {
    screen = { icon: '⚠️', title: "Can't be sure", sub: 'Keep the door closed. Call for help.', bg: 'bg-amber-700', alarm: true }
  } else if (snap && !snap.ready) {
    screen = { icon: '🛠️', title: 'Not ready yet', sub: 'Nobody can be alerted. Keep the door closed and call for help.', bg: 'bg-amber-700', alarm: true }
  } else if (snap?.offline) {
    screen = { icon: '⚠️', title: "Doorbell may not work", sub: `Do not open the door. Call ${callName}.`, bg: 'bg-amber-700', alarm: true }
  } else if (!c && (snap?.expectedNow?.length || snap?.recurringNow?.length)) {
    const e = snap!.recurringNow[0] ?? snap!.expectedNow[0]
    screen = { icon: e.icon, title: `${e.label} expected`, sub: `Until ${new Date(e.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Wait for the bell.`, bg: 'bg-sky-800' }
  } else if (!c) {
    screen = { icon: '🏠', title: 'All quiet', sub: 'Nobody at the door', bg: 'bg-emerald-800' }
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
      // "Help is coming" is NOT shown until a helper has really seen it.
      screen = { icon: '🆘', title: `Telling ${currentHelper?.name ?? 'a helper'}…`, sub: `Stay here. If you are in danger call ${emergency}.`, bg: 'bg-rose-800', alarm: true }
    }
  } else if (snap?.quietNow && (c.status === 'waiting' || (c.status === 'answered' && c.answer === 'safe'))) {
    screen = { icon: '🌙', title: 'Night lock is on', sub: 'Do not open the door', bg: 'bg-indigo-900' }
  } else if (c.lane === 'expected' && c.status === 'waiting' && (c.checkMode === 'code' || c.checkWord)) {
    const isCode = c.checkMode === 'code'
    screen = {
      icon: c.visitIcon ?? '👤',
      title: `${c.checkWho ?? c.visitLabel ?? 'A visitor'} may be here`,
      sub: isCode
        ? (c.checkAttempts ? 'Ask them to read the number again. Is it the same?' : 'Ask them to read the number on their phone. Is it the same?')
        : `Ask them to say a word. Did they say "${c.checkWord}"?`,
      bg: 'bg-sky-800', calm: true,
    }
  } else if (c.lane === 'expected' && c.status === 'waiting') {
    screen = { icon: c.visitIcon ?? '👤', title: `${c.visitLabel ?? 'A visitor'} may be here`, sub: `Wait. ${currentHelper?.name ?? 'Your helper'} is checking.`, bg: 'bg-sky-800', calm: true }
  } else if (c.status === 'waiting') {
    screen = { icon: '🚪', title: 'Someone is here', sub: `Keep the door closed. ${currentHelper?.name ?? 'A helper'} is checking.`, bg: 'bg-sky-800', calm: true }
  } else if (c.status === 'no_response') {
    screen = { icon: '⚠️', title: "Don't open the door", sub: `Nobody answered. Call ${callName}`, bg: 'bg-amber-700', alarm: true }
  } else if (c.answer === 'safe' && (c as any).selfVerifiedAt && !c.declinedAt) {
    screen = { icon: '✅', title: 'OK to open the door', sub: `You checked the word. ${currentHelper?.name ?? 'Your helper'} knows.`, bg: 'bg-emerald-800' }
  } else if (c.answer === 'safe') {
    if (c.declinedAt) screen = { icon: '🚪', title: 'Door stays closed', sub: 'You chose not to open', bg: 'bg-slate-700' }
    else if (!c.confirmedAt) {
      screen = { icon: '🙋', title: `${answeredBy?.name ?? 'Your helper'} says it is OK`, sub: c.lane === 'expected' && c.visitLabel ? `${c.visitIcon} ${c.visitLabel}. Open the door?` : c.visitor === 'delivery' ? '📦 A delivery. Open the door?' : '👤 Someone you know. Open the door?', bg: 'bg-teal-800' }
    } else screen = { icon: '✅', title: 'OK to open the door', sub: `${answeredBy?.name ?? 'Your helper'} says it is safe`, bg: 'bg-emerald-800' }
  } else if (c.answer === 'not_safe') {
    screen = { icon: '⛔', title: "Don't open the door", sub: `${answeredBy?.name ?? 'Your helper'} says stay inside`, bg: 'bg-red-800' }
  } else {
    screen = { icon: '📞', title: `${answeredBy?.name ?? 'Your helper'} is calling you`, sub: 'Pick up the phone', bg: 'bg-indigo-800' }
  }

  // Sound + vibration on every change, so the screen gets attention on its own.
  const prev = useRef('')
  useEffect(() => {
    const key = `${screen.title}|${screen.sub}`
    if (prev.current && prev.current !== key) {
      try { if (vibrate && !screen.calm) navigator.vibrate?.(screen.alarm ? [400, 150, 400, 150, 400] : [200]) } catch {}
      if (sound) {
        if (!screen.calm) try {
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
  }, [screen.title, screen.sub, screen.alarm, screen.calm, sound, vibrate])

  const post = async (url: string, body?: object) => {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).catch(() => {})
    refresh()
  }

  const trusted = !unauthorized && !stale && !!snap
  const awaitingConfirm = trusted && c?.kind === 'visitor' && c.status === 'answered' && c.answer === 'safe' && !c.confirmedAt && !c.declinedAt && !snap?.quietNow
  const showBar = false // a shrinking timer is pressure the resident does not need; helpers see the countdown
  const showCheck = trusted && c?.kind === 'visitor' && c.status === 'waiting' && c.lane === 'expected' && (c.checkMode === 'code' || !!c.checkWord) && !snap?.quietNow
  const pct = showBar ? Math.max(0, Math.min(100, (secondsLeft(c!.deadlineAt) / snap!.timeoutSec) * 100)) : 0
  const sosNeedsEmergency = c?.kind === 'sos' && !c.ackedAt && c.status !== 'answered'

  return (
    <main aria-live="polite" className={`min-h-screen ${screen.bg} text-white flex flex-col items-center justify-between p-6 transition-colors duration-700 motion-reduce:transition-none`}>
      <div className="w-full max-w-md flex justify-between text-sm">
        <span>Resident screen</span>
        <div className="flex gap-2">
          <button onClick={() => setShowVideo((s) => !s)} className="px-3 py-1 rounded-full bg-black/30" aria-label="Toggle video feed">
            {showVideo ? '📹 On' : '📹 Off'}
          </button>
          <button onClick={toggleVibrate} className="px-3 py-1 rounded-full bg-black/30" aria-label="Vibration">
            {vibrate ? '📳 On' : '📳 Off'}
          </button>
          <button onClick={() => setSound((s) => !s)} className="px-3 py-1 rounded-full bg-black/30" aria-label="Sound and read aloud">
            {sound ? '🔊 On' : '🔈 Off'}
          </button>
        </div>
      </div>

      <div className="flex flex-col items-center text-center gap-4" role="status" aria-live="assertive">
        <div className="text-[9rem] leading-none">{screen.icon}</div>
        <h1 className="text-4xl font-bold">{screen.title}</h1>
        {screen.sub && <p className="text-2xl max-w-sm">{screen.sub}</p>}
        {/* Live rotating code shown to resident for code-mode check */}
        {showCheck && c?.checkMode === 'code' && (c as any).checkCode && (
          <div
            className="text-[7rem] font-mono font-bold tracking-widest leading-none mt-2"
            aria-label={`Code ${String((c as any).checkCode).split('').join(' ')}`}
          >
            {(c as any).checkCode}
          </div>
        )}
        {!c && trusted && snap!.todayVisits?.length > 0 && !snap!.expectedNow?.length && !snap!.recurringNow?.length && (
          <div className="mt-4 w-full max-w-sm rounded-3xl bg-black/25 p-4 text-left" aria-label="Planned today">
            <p className="mb-2 text-xl font-bold">Today</p>
            <ul className="space-y-2 text-xl">
              {snap!.todayVisits.map((v) => (
                <li key={v.id} className={v.done ? 'opacity-60' : ''}>
                  {v.icon} {v.label} · {new Date(v.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: snap!.timeZone })}{v.done ? ' ✓' : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
        {showBar && (
          <div className="w-64 h-3 bg-black/30 rounded-full overflow-hidden mt-2">
            <div className="h-full bg-white/90 transition-all duration-1000 ease-linear" style={{ width: `${pct}%` }} />
          </div>
        )}
        {showVideo && c && c.deviceId && (
          <div className="w-full max-w-md mt-4">
            <LiveView caseId={c.id} deviceId={c.deviceId} />
          </div>
        )}
      </div>

      <div className="w-full max-w-md flex flex-col gap-4">
        {trusted && !c && <RegularApprovals />}
        {showCheck && (
          <div className="grid grid-cols-2 gap-4">
            <button onClick={() => post('/api/doorbell/verify', { caseId: c!.id, ok: true })} className="rounded-3xl bg-white py-6 text-2xl font-bold text-emerald-900">
              {c?.checkMode === 'code' ? '✅ Same number' : '✅ Yes'}
            </button>
            <button onClick={() => post('/api/doorbell/verify', { caseId: c!.id, ok: false })} className="rounded-3xl border-4 border-white bg-black/40 py-6 text-2xl font-bold">
              {c?.checkMode === 'code' ? '❌ Different' : '✋ No'}
            </button>
          </div>
        )}
        {awaitingConfirm && (
          <div className="grid grid-cols-2 gap-4">
            <button onClick={() => post('/api/doorbell/confirm', { caseId: c!.id, ok: true })} className="rounded-3xl bg-white py-6 text-2xl font-bold text-emerald-900">✅ Yes, open</button>
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
      </div>
    </main>
  )
}

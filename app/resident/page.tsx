'use client'

import { useEffect, useState } from 'react'
import { useDoorbell } from '../hooks/useDoorbell'

type Screen = { icon: string; title: string; sub?: string; bg: string }

export default function ResidentPage() {
  const { snap, error, refresh, secondsLeft } = useDoorbell()
  const [, force] = useState(0)
  const [speak, setSpeak] = useState(false)

  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const helpers = snap?.helpers ?? []
  const c = snap?.current ?? null
  const currentHelper = c ? helpers[Math.min(c.helperIndex, helpers.length - 1)] : helpers[0]
  const answeredBy = c?.answeredBy ? helpers.find((h) => h.id === c.answeredBy) : undefined
  const callTarget = answeredBy ?? helpers[0]

  let screen: Screen
  if (error && !snap) {
    screen = { icon: '⚠️', title: 'Keep the door closed', sub: `Call ${helpers[0]?.name ?? 'your helper'}`, bg: 'bg-amber-600' }
  } else if (snap?.offline) {
    screen = { icon: '⚠️', title: "Don't open the door", sub: `Call ${helpers[0]?.name}`, bg: 'bg-amber-600' }
  } else if (!c) {
    screen = { icon: '🏠', title: 'All quiet', sub: 'Nobody at the door', bg: 'bg-emerald-700' }
  } else if (c.status === 'waiting') {
    screen =
      c.kind === 'sos'
        ? { icon: '🆘', title: 'Help is coming', sub: `We told ${currentHelper?.name}. Stay here.`, bg: 'bg-rose-700' }
        : { icon: '🚪', title: 'Someone is at the door', sub: `Wait. Do not open yet. Asking ${currentHelper?.name}`, bg: 'bg-sky-700' }
  } else if (c.status === 'no_response') {
    screen = { icon: '⚠️', title: "Don't open the door", sub: `Nobody answered. Call ${helpers[0]?.name}`, bg: 'bg-amber-600' }
  } else if (c.answer === 'safe') {
    screen = { icon: '✅', title: 'OK to open the door', sub: `${answeredBy?.name} says it is safe`, bg: 'bg-emerald-700' }
  } else if (c.answer === 'not_safe') {
    screen = { icon: '⛔', title: "Don't open the door", sub: `${answeredBy?.name} says stay inside`, bg: 'bg-red-700' }
  } else {
    screen = { icon: '📞', title: `${answeredBy?.name} is calling you`, sub: 'Pick up the phone', bg: 'bg-indigo-700' }
  }

  useEffect(() => {
    if (!speak || typeof window === 'undefined' || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(`${screen.title}. ${screen.sub ?? ''}`))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen.title, speak])

  const sos = async () => {
    await fetch('/api/doorbell/sos', { method: 'POST' })
    refresh()
  }

  const showBar = c?.status === 'waiting' && snap
  const pct = showBar ? Math.max(0, Math.min(100, (secondsLeft(c!.deadlineAt) / snap!.timeoutSec) * 100)) : 0

  return (
    <main className={`min-h-screen ${screen.bg} text-white flex flex-col items-center justify-between p-6 transition-colors duration-700`}>
      <div className="w-full max-w-md flex justify-between text-sm opacity-80">
        <span>Resident screen</span>
        <button onClick={() => setSpeak((s) => !s)} className="px-3 py-1 rounded-full bg-black/25" aria-label="Read aloud">
          {speak ? '🔊 On' : '🔈 Off'}
        </button>
      </div>

      <div className="flex flex-col items-center text-center gap-4">
        <div className="text-[9rem] leading-none">{screen.icon}</div>
        <h1 className="text-4xl font-bold">{screen.title}</h1>
        {screen.sub && <p className="text-2xl opacity-90 max-w-sm">{screen.sub}</p>}
        {showBar && (
          <div className="w-64 h-3 bg-black/25 rounded-full overflow-hidden mt-2">
            <div className="h-full bg-white/80 transition-all duration-1000 ease-linear" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      <div className="w-full max-w-md flex flex-col gap-4">
        {callTarget && (
          <a
            href={`tel:${callTarget.phone}`}
            className="w-full text-center text-3xl font-bold py-6 rounded-3xl bg-white text-slate-900 shadow-lg"
          >
            📞 Call {callTarget.name}
          </a>
        )}
        <button onClick={sos} className="w-full text-3xl font-bold py-6 rounded-3xl bg-black/35 border-4 border-white/70">
          😨 I need help
        </button>
      </div>
    </main>
  )
}

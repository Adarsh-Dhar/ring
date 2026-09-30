'use client'

import Link from 'next/link'

interface HeaderProps {
  connected: boolean
  enabledCount: number
  simpleMode?: boolean
}

export function Header({ connected, enabledCount, simpleMode }: HeaderProps) {
  return (
    <header className="bg-dash-panel border-b border-slate-700 px-4 py-2 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-3">
        <span className="text-xl">📡</span>
        <h1 className="text-lg font-bold text-white">Live Detection Dashboard</h1>
        <Link href="/clips" className="text-sm text-dash-cyan hover:underline">🎞️ Clips</Link>
        <Link href="/sim" className="text-sm text-dash-cyan hover:underline">🧪 Simulator</Link>
        <Link href="/resident" className="text-sm text-dash-cyan hover:underline">🏠 Resident</Link>
        <Link href="/helper" className="text-sm text-dash-cyan hover:underline">🧑‍🤝‍🧑 Helper</Link>
      </div>
      {!simpleMode && (
        <div className="flex items-center gap-3">
          <span className={`text-xs px-2 py-1 rounded-full ${connected ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
            {connected ? '● Connected' : '○ Disconnected'}
          </span>
          {enabledCount > 0 && (
            <span className="text-xs px-2 py-1 rounded-full bg-purple-900 text-purple-300">
              {enabledCount} processor{enabledCount > 1 ? 's' : ''} active
            </span>
          )}
        </div>
      )}
    </header>
  )
}

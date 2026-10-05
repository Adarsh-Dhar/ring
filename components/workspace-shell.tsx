'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

const residentLinks = [
  { href: '/workspace/resident', label: 'Overview' },
  { href: '/workspace/resident/create', label: 'Workspace settings' },
  { href: '/workspace/resident#helpers', label: 'Helpers' },
  { href: '/workspace/resident#visits', label: 'Planned visits' },
]

const helperLinks = [
  { href: '/workspace/helper', label: 'Overview' },
  { href: '/workspace/helper#visits', label: 'Visitor requests' },
  { href: '/workspace/helper/waiting', label: 'Pending access' },
]

export default function WorkspaceShell({ role, children }: { role: 'resident' | 'helper'; children: ReactNode }) {
  const pathname = usePathname()
  const links = role === 'resident' ? residentLinks : helperLinks
  const accent = role === 'resident' ? 'text-cyan-300' : 'text-violet-300'
  const accentSurface = role === 'resident' ? 'bg-cyan-400/10 ring-cyan-400/20' : 'bg-violet-400/10 ring-violet-400/20'

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/90 px-4 py-3 backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <Link href="/" className="flex shrink-0 items-center gap-3 text-white" aria-label="Ring Safe home">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-cyan-400 font-black text-slate-950 shadow-lg shadow-cyan-400/10">R</span>
            <span className="hidden text-sm font-semibold tracking-tight sm:block">Ring Safe</span>
          </Link>
          <div className="hidden h-6 w-px bg-white/10 sm:block" aria-hidden="true" />
          <div className="hidden min-w-0 sm:block">
            <p className="truncate text-sm font-medium">{role === 'resident' ? 'Resident workspace' : 'Helper workspace'}</p>
            <p className="text-[11px] text-slate-500">Safe access, shared clearly</p>
          </div>
          <nav aria-label={`${role} workspace`} className="order-3 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto sm:order-none sm:ml-auto sm:flex-none">
            {links.map((link) => {
              const isActive = link.href.includes('#') ? pathname === link.href.split('#')[0] : pathname === link.href
              return (
                <Link key={link.href} href={link.href} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs transition hover:bg-white/10 ${isActive ? `${accentSurface} ${accent} ring-1` : 'text-slate-400'}`}>
                  {link.label}
                </Link>
              )
            })}
          </nav>
          <button type="button" aria-label="Notifications" className="relative ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 text-slate-400 transition hover:bg-white/10 hover:text-white sm:ml-2">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-300 ring-2 ring-slate-950" aria-label="Unread notification" />
          </button>
          <Link href="/select-role" className="hidden items-center gap-1 whitespace-nowrap rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/10 sm:flex">
            Switch view <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3 fill-none stroke-current" strokeWidth="1.5"><path d="m3 4.5 3 3 3-3" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </Link>
        </div>
      </header>
      {children}
    </div>
  )
}

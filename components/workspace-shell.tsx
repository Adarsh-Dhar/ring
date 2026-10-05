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

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/90 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3 text-white">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-cyan-400 font-black text-slate-950">R</span>
            <span className="hidden text-sm font-semibold sm:block">Ring Safe</span>
          </Link>
          <nav aria-label={`${role} workspace`} className="flex items-center gap-1 overflow-x-auto">
            {links.map((link) => (
              <Link key={link.href} href={link.href} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs transition hover:bg-white/10 ${pathname === link.href ? `bg-white/10 ${accent}` : 'text-slate-400'}`}>
                {link.label}
              </Link>
            ))}
          </nav>
          <Link href="/select-role" className="hidden whitespace-nowrap rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/10 sm:block">Switch view</Link>
        </div>
      </header>
      {children}
    </div>
  )
}

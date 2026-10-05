import Link from 'next/link'

import WorkspaceShell from '@/components/workspace-shell'

export default function HelperWaitingPage() {
  return (
    <WorkspaceShell role="helper">
      <main className="min-h-screen bg-slate-950 px-6 py-12 text-white">
      <div className="mx-auto flex min-h-[80vh] max-w-2xl flex-col justify-center text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/30">Helper</div>
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-emerald-300">Helper access</p>
        <h1 className="text-4xl font-bold tracking-tight">Your workspaces will appear here</h1>
        <p className="mx-auto mt-4 max-w-lg text-slate-400">A resident must add and approve you before a workspace becomes available. Once approved, you can choose it here and handle unplanned visitor requests.</p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/" className="rounded-xl border border-slate-700 px-5 py-3 font-semibold hover:bg-slate-900">Back home</Link>
          <Link href="/auth/login" className="rounded-xl bg-emerald-400 px-5 py-3 font-semibold text-slate-950 hover:bg-emerald-300">Check again</Link>
        </div>
      </div>
      </main>
    </WorkspaceShell>
  )
}

export const metadata = { title: 'Choose a workspace | Ring Safe' }

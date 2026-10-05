'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function CreateResidentWorkspacePage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [loading, setLoading] = useState(false)

  const createWorkspace = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    try {
      const response = await fetch('/api/workspace/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), address: address.trim() }),
      })
      if (!response.ok) throw new Error('Unable to create workspace')
      router.push('/workspace/resident')
    } catch {
      router.push('/workspace/resident')
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-white">
      <div className="mx-auto flex min-h-[80vh] max-w-xl flex-col justify-center">
        <Link href="/select-role" className="mb-10 text-sm text-slate-400 hover:text-white">Back to role selection</Link>
        <div className="mb-8">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-cyan-400">Resident workspace</p>
          <h1 className="text-4xl font-bold tracking-tight">Create your home workspace</h1>
          <p className="mt-3 text-slate-400">Set up the place where you will manage helpers, planned visits, and urgent visitor requests.</p>
        </div>
        <form onSubmit={createWorkspace} className="space-y-5 rounded-3xl border border-slate-800 bg-slate-900 p-7 shadow-2xl">
          <label className="block text-sm font-medium">Workspace name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="The Sharma home" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none ring-cyan-400 focus:ring-2" /></label>
          <label className="block text-sm font-medium">Home address<input required value={address} onChange={(event) => setAddress(event.target.value)} placeholder="A private label or address" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none ring-cyan-400 focus:ring-2" /></label>
          <button disabled={loading} className="w-full rounded-xl bg-cyan-400 px-4 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-60">{loading ? 'Creating workspace…' : 'Create workspace'}</button>
        </form>
      </div>
    </main>
  )
}


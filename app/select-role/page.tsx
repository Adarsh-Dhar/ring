'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function SelectRolePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const selectRole = async (role: 'resident' | 'helper') => {
    setLoading(true)
    setMessage(null)

    try {
      const res = await fetch('/api/auth/select-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })

      if (!res.ok) {
        const data = await res.json()
        setMessage(data.error || 'Failed to select role')
        setLoading(false)
        return
      }

      if (role === 'resident') {
        router.push('/workspace/resident/create')
      } else {
        router.push('/workspace/helper/waiting')
      }
    } catch {
      setMessage('Network error. Please try again.')
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 text-white p-4">
      <div className="max-w-4xl mx-auto flex flex-col justify-center min-h-screen">
        <div className="mb-12 text-center">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-lg">
              🔔
            </div>
            <span className="text-2xl font-bold">Ring Safe</span>
          </div>
          <h1 className="text-4xl font-bold mb-3">Welcome! What&apos;s your role?</h1>
          <p className="text-xl text-slate-400">Choose how you want to use Ring Safe</p>
        </div>

        {message && (
          <div className="mb-6 p-4 bg-red-900/20 border border-red-700 text-red-200 rounded-lg text-center">
            {message}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-8 mb-8">
          {/* Resident Card */}
          <button
            onClick={() => selectRole('resident')}
            disabled={loading}
            className="group bg-slate-800/50 border-2 border-slate-700 rounded-2xl p-8 hover:border-cyan-500 hover:bg-slate-800 transition disabled:opacity-50"
          >
            <div className="text-6xl mb-4">🏠</div>
            <h2 className="text-2xl font-bold mb-3">Resident</h2>
            <p className="text-slate-300 mb-6 text-left">
              You live at the home and need help managing who comes to your door. Create a workspace and invite helpers to keep you safe.
            </p>
            <ul className="space-y-2 text-left text-sm text-slate-400 mb-8">
              <li>✓ Get instant doorbell alerts</li>
              <li>✓ Verify visitors with helpers</li>
              <li>✓ Schedule planned visits</li>
              <li>✓ Control who can help</li>
            </ul>
            <div className="inline-block px-6 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-lg font-semibold group-hover:from-cyan-600 group-hover:to-blue-700 transition">
              {loading ? 'Loading...' : 'Create Workspace'}
            </div>
          </button>

          {/* Helper Card */}
          <button
            onClick={() => selectRole('helper')}
            disabled={loading}
            className="group bg-slate-800/50 border-2 border-slate-700 rounded-2xl p-8 hover:border-emerald-500 hover:bg-slate-800 transition disabled:opacity-50"
          >
            <div className="text-6xl mb-4">👥</div>
            <h2 className="text-2xl font-bold mb-3">Helper</h2>
            <p className="text-slate-300 mb-6 text-left">
              You help a resident by verifying visitors at their door. A resident must invite and approve you before you can help.
            </p>
            <ul className="space-y-2 text-left text-sm text-slate-400 mb-8">
              <li>✓ Receive doorbell alerts</li>
              <li>✓ Verify visitors in real-time</li>
              <li>✓ See visitor history</li>
              <li>✓ Manage planned visits</li>
            </ul>
            <div className="inline-block px-6 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 rounded-lg font-semibold group-hover:from-emerald-600 group-hover:to-teal-700 transition">
              {loading ? 'Loading...' : 'Waiting for Invite'}
            </div>
          </button>
        </div>

        <div className="text-center">
          <p className="text-slate-400 mb-4">You can change your role later in your account settings.</p>
          <Link href="/" className="text-sm text-slate-400 hover:text-white transition">
            Back to home
          </Link>
        </div>
      </div>
    </main>
  )
}

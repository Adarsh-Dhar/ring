'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function PairPage() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const handlePair = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairingCode: code })
      })
      const data = await res.json()

      if (!res.ok) {
        setMessage(data.error || 'Failed to pair device')
        return
      }

      // Redirect to resident page
      router.push('/resident')
    } catch (err) {
      setMessage('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8">
        <h1 className="text-2xl font-bold text-center mb-6">Pair Your Device</h1>

        {message && (
          <div className={`mb-4 p-3 rounded text-sm ${message.includes('error') ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
            {message}
          </div>
        )}

        <form onSubmit={handlePair} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Enter the 6-digit code from your guardian
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={6}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-center text-2xl tracking-widest uppercase"
              placeholder="ABC123"
            />
          </div>
          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {loading ? 'Pairing...' : 'Pair Device'}
          </button>
        </form>

        <p className="mt-4 text-sm text-gray-500 text-center">
          Ask your guardian to show you a pairing code from the setup page.
        </p>
      </div>
    </div>
  )
}

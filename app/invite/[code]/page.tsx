'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'

export default function InvitePage() {
  const router = useRouter()
  const params = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [household, setHousehold] = useState<any>(null)
  const [consented, setConsented] = useState(false)

  useEffect(() => {
    loadInvite()
  }, [params.code])

  const loadInvite = async () => {
    try {
      const res = await fetch(`/api/invites/${params.code}`)
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Invalid or expired invite')
        setLoading(false)
        return
      }

      setHousehold(data)
      setLoading(false)
    } catch (err) {
      setError('Network error')
      setLoading(false)
    }
  }

  const handleAccept = async () => {
    setLoading(true)
    setError('')

    try {
      const res = await fetch(`/api/invites/${params.code}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept' }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to accept invite')
        setLoading(false)
        return
      }

      setConsented(true)

      // Auto-create passkey after consent
      setTimeout(() => {
        router.push('/helper')
      }, 2000)
    } catch (err) {
      setError('Network error')
      setLoading(false)
    }
  }

  const handleDecline = async () => {
    if (!confirm('Are you sure you want to decline this invitation?')) return

    setLoading(true)
    try {
      const res = await fetch(`/api/invites/${params.code}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'decline' }),
      })

      if (res.ok) {
        router.push('/')
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to decline invite')
        setLoading(false)
      }
    } catch (err) {
      setError('Network error')
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-gray-500">Loading...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8">
          <h1 className="text-2xl font-bold text-center mb-6 text-red-600">Invite Invalid</h1>
          <p className="text-gray-600 text-center mb-4">{error}</p>
          <button
            onClick={() => router.push('/login')}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700"
          >
            Go to Login
          </button>
        </div>
      </div>
    )
  }

  if (consented) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8 text-center">
          <div className="text-6xl mb-4">✅</div>
          <h1 className="text-2xl font-bold mb-4">You're In!</h1>
          <p className="text-gray-600 mb-6">
            You've been added as a helper for {household.residentName}.
          </p>
          <p className="text-sm text-gray-500">Setting up your session...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8">
        <h1 className="text-2xl font-bold text-center mb-2">You're Invited!</h1>
        <p className="text-gray-600 text-center mb-6">
          {household.createdBy} has invited you to help watch over {household.residentName}.
        </p>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <h3 className="font-semibold text-blue-900 mb-2">What you'll do:</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• Get notified when someone rings the doorbell</li>
            <li>• See live video and decide if it's safe</li>
            <li>• Help the resident stay safe</li>
          </ul>
        </div>

        <div className="space-y-3">
          <button
            onClick={handleAccept}
            disabled={loading}
            className="w-full bg-blue-600 text-white py-3 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-semibold"
          >
            {loading ? 'Accepting...' : 'I Accept - Add Me as Helper'}
          </button>
          <button
            onClick={handleDecline}
            disabled={loading}
            className="w-full text-gray-500 py-2 px-4 hover:text-gray-700 text-sm transition-colors"
          >
            Decline invitation
          </button>
        </div>

        <p className="mt-6 text-xs text-gray-400 text-center">
          By accepting, you agree to help keep the resident safe.
        </p>
      </div>
    </div>
  )
}

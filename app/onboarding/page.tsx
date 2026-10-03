'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const steps = ['create-household', 'connect-ring', 'invite-helpers', 'pair-device'] as const

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<(typeof steps)[number]>('create-household')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [householdName, setHouseholdName] = useState('')
  const [memberName, setMemberName] = useState('')
  const [memberPhone, setMemberPhone] = useState('')
  const [memberEmail, setMemberEmail] = useState('')

  const createHousehold = async () => {
    if (!householdName || !memberName) {
      setError('Please fill in all fields')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/household', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          residentName: householdName,
          guardianName: memberName,
          guardianPhone: memberPhone,
          guardianEmail: memberEmail,
        }),
      })
      if (res.ok === false) {
        const data = await res.json()
        setError(data.error || 'Failed to create household')
        return
      }
      setStep('connect-ring')
    } catch (err) {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  const connectRing = async () => {
    // Redirect to Ring OAuth flow
    const nonce = Math.random().toString(36).substring(7)
    const time = Date.now()
    const url = `https://oauth.ring.com/oauth/authorize?client_id=${process.env.NEXT_PUBLIC_RING_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(process.env.NEXT_PUBLIC_APP_URL + '/api/ring/link')}&state=${nonce}&time=${time}`
    window.location.href = url
  }

  const skipRing = () => {
    setStep('invite-helpers')
  }

  const inviteHelper = async () => {
    if (!memberName || (!memberPhone && !memberEmail)) {
      setError('Name and either phone or email are required')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/household/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'invite',
          name: memberName,
          phone: memberPhone,
          email: memberEmail,
          role: 'helper',
        }),
      })
      if (res.ok === false) {
        const data = await res.json()
        setError(data.error || 'Failed to invite helper')
        return
      }
      setMemberName('')
      setMemberPhone('')
      setMemberEmail('')
      setError('Invitation sent')
    } catch (err) {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  const finishOnboarding = () => {
    router.push('/setup')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8">
        <h1 className="text-2xl font-bold text-center mb-6">Welcome to Doorbell Helper</h1>

        {error && (
          <div className="mb-4 p-3 rounded bg-red-50 text-red-700 text-sm">
            {error}
          </div>
        )}

        {step === 'create-household' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Create your household</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Resident name
              </label>
              <input
                type="text"
                value={householdName}
                onChange={(e) => setHouseholdName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Who lives here?"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Your name (guardian)
              </label>
              <input
                type="text"
                value={memberName}
                onChange={(e) => setMemberName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Your name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Your phone (optional)
              </label>
              <input
                type="tel"
                value={memberPhone}
                onChange={(e) => setMemberPhone(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="+919876543210"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Your email (optional)
              </label>
              <input
                type="email"
                value={memberEmail}
                onChange={(e) => setMemberEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="you@example.com"
              />
            </div>
            <button
              onClick={createHousehold}
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400"
            >
              {loading ? 'Creating...' : 'Continue'}
            </button>
          </div>
        )}

        {step === 'connect-ring' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Connect your Ring doorbell</h2>
            <p className="text-sm text-gray-600">
              Connect your Ring account to receive doorbell events and view live video.
            </p>
            <button
              onClick={connectRing}
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400"
            >
              Connect Ring Account
            </button>
            <button
              onClick={skipRing}
              disabled={loading}
              className="w-full bg-gray-200 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-300"
            >
              Skip for now
            </button>
          </div>
        )}

        {step === 'invite-helpers' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Invite helpers</h2>
            <p className="text-sm text-gray-600">
              Add trusted friends or family who can help when someone is at the door.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Helper name
              </label>
              <input
                type="text"
                value={memberName}
                onChange={(e) => setMemberName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Helper's name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone or email
              </label>
              <input
                type="text"
                value={memberPhone || memberEmail}
                onChange={(e) => {
                  if (e.target.value.includes('@')) {
                    setMemberEmail(e.target.value)
                    setMemberPhone('')
                  } else {
                    setMemberPhone(e.target.value)
                    setMemberEmail('')
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="+919876543210 or email@example.com"
              />
            </div>
            <button
              onClick={inviteHelper}
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400"
            >
              {loading ? 'Inviting...' : 'Invite Helper'}
            </button>
            <button
              onClick={finishOnboarding}
              disabled={loading}
              className="w-full bg-gray-200 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-300"
            >
              Skip for now
            </button>
          </div>
        )}

        {step === 'pair-device' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Pair resident device</h2>
            <p className="text-sm text-gray-600">
              On the resident's phone or tablet, open this app and enter the pairing code shown on the setup page.
            </p>
            <button
              onClick={() => router.push('/pair')}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700"
            >
              Go to Pairing Page
            </button>
            <button
              onClick={finishOnboarding}
              className="w-full bg-gray-200 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-300"
            >
              Skip for now
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

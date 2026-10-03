'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState<'input' | 'otp' | 'select'>('input')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [userId, setUserId] = useState('')
  const [memberships, setMemberships] = useState<any[]>([])

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email || undefined, phone: phone || undefined })
      })
      const data = await res.json()

      if (res.ok === false) {
        setMessage(data.error || 'Failed to send OTP')
        return
      }

      setUserId(data.userId)
      setStep('otp')
      if (data.otp) {
        setMessage(`Development mode: Your OTP is ${data.otp}`)
      }
    } catch (err) {
      setMessage('Network error')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, otp })
      })
      const data = await res.json()

      if (res.ok === false) {
        setMessage(data.error || 'Failed to verify OTP')
        return
      }

      if (data.memberships.length === 0) {
        setMessage('No households found. Contact a guardian to add you.')
        return
      }

      if (data.memberships.length === 1) {
        // Auto-select the only household
        await selectHousehold(data.memberships[0].id)
      } else {
        setMemberships(data.memberships)
        setStep('select')
      }
    } catch (err) {
      setMessage('Network error')
    } finally {
      setLoading(false)
    }
  }

  const selectHousehold = async (membershipId: string) => {
    setLoading(true)
    try {
      const res = await fetch('/api/auth/select-household', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ membershipId })
      })
      const data = await res.json()

      if (res.ok === false) {
        setMessage(data.error || 'Failed to select household')
        setLoading(false)
        return
      }

      // Redirect based on role
      if (data.role === 'guardian') {
        router.push('/setup')
      } else {
        router.push('/helper')
      }
    } catch (err) {
      setMessage('Network error')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8">
        <h1 className="text-2xl font-bold text-center mb-6">Doorbell Helper</h1>

        {message && (
          <div className={`mb-4 p-3 rounded text-sm ${message.includes('error') ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
            {message}
          </div>
        )}

        {step === 'input' && (
          <form onSubmit={handleSendOtp} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="you@example.com"
              />
            </div>
            <div className="text-center text-gray-500">or</div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="+15550001111"
              />
            </div>
            <button
              type="submit"
              disabled={loading || (!email && !phone)}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {loading ? 'Sending...' : 'Send OTP'}
            </button>
          </form>
        )}

        {step === 'otp' && (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Enter OTP</label>
              <input
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                maxLength={6}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-center text-2xl tracking-widest"
                placeholder="000000"
              />
            </div>
            <button
              type="submit"
              disabled={loading || otp.length !== 6}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {loading ? 'Verifying...' : 'Verify'}
            </button>
            <button
              type="button"
              onClick={() => setStep('input')}
              className="w-full text-gray-600 py-2 px-4 hover:text-gray-800"
            >
              Back
            </button>
          </form>
        )}

        {step === 'select' && (
          <div className="space-y-4">
            <p className="text-gray-700">Select a household:</p>
            {memberships.map((m) => (
              <button
                key={m.id}
                onClick={() => selectHousehold(m.id)}
                disabled={loading}
                className="w-full text-left p-4 border border-gray-300 rounded-md hover:bg-gray-50 disabled:bg-gray-100 disabled:cursor-not-allowed"
              >
                <div className="font-medium">{m.residentName}</div>
                <div className="text-sm text-gray-500 capitalize">{m.role}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

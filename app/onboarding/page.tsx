'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

const steps = ['create-household', 'connect-ring', 'invite-helpers', 'pair-device'] as const

type MessageKind = 'error' | 'info' | 'success'
interface Message { text: string; kind: MessageKind }

function Alert({ message }: { message: Message }) {
  const styles: Record<MessageKind, string> = {
    error:   'bg-red-50 border border-red-200 text-red-700',
    info:    'bg-blue-50 border border-blue-200 text-blue-700',
    success: 'bg-green-50 border border-green-200 text-green-700',
  }
  return (
    <div className={`mb-4 p-3 rounded text-sm ${styles[message.kind]}`} role="alert">
      {message.text}
    </div>
  )
}

async function apiError(res: Response): Promise<string> {
  try {
    const data = await res.json()
    if (typeof data?.error === 'string' && data.error.length > 0) return data.error
  } catch {}
  switch (res.status) {
    case 400: return 'Bad request — please check your input and try again.'
    case 401: return 'You are not signed in. Please sign in and try again.'
    case 403: return 'Access denied.'
    case 409: return 'Conflict — this action cannot be completed.'
    case 500: return 'Server error — please try again later.'
    case 503: return 'Service unavailable — please try again shortly.'
    default:  return `Unexpected error (HTTP ${res.status}) — please try again.`
  }
}

export default function OnboardingPage() {
  const router   = useRouter()
  const inFlight = useRef(false)

  const [step,        setStep]        = useState<(typeof steps)[number]>('create-household')
  const [loading,     setLoading]     = useState(false)
  const [message,     setMessage]     = useState<Message | null>(null)
  const [residentName, setResidentName] = useState('')
  const [guardianName, setGuardianName] = useState('')
  const [guardianPhone, setGuardianPhone] = useState('')
  const [guardianEmail, setGuardianEmail] = useState('')
  const [helperName,   setHelperName]   = useState('')
  const [helperContact, setHelperContact] = useState('')

  const createHousehold = async () => {
    if (!residentName.trim()) {
      setMessage({ text: 'Please enter the resident\'s name.', kind: 'error' })
      return
    }
    if (!guardianName.trim()) {
      setMessage({ text: 'Please enter your name.', kind: 'error' })
      return
    }
    if (!guardianPhone.trim() && !guardianEmail.trim()) {
      setMessage({ text: 'Please enter either your phone number or email address.', kind: 'error' })
      return
    }

    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setMessage(null)

    try {
      const res = await fetch('/api/household', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:        'create',
          residentName:  residentName.trim(),
          guardianName:  guardianName.trim(),
          // Only send fields that were actually filled in — empty string would fail validation
          guardianPhone: guardianPhone.trim() || undefined,
          guardianEmail: guardianEmail.trim() || undefined,
        }),
      })

      if (!res.ok) {
        setMessage({ text: await apiError(res), kind: 'error' })
        return
      }

      setMessage({ text: 'Household created successfully!', kind: 'success' })
      setStep('connect-ring')
    } catch {
      setMessage({ text: 'Network error — please check your connection and try again.', kind: 'error' })
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }

  const connectRing = () => {
    // Ring Partner API uses a Ring-driven one-way linking flow.
    // Linking is initiated from the Ring AppStore/portal, not from a browser redirect.
    window.open('https://developer.amazon.com/ring/console/apps', '_blank', 'noopener')
  }

  const inviteHelper = async () => {
    if (!helperName.trim()) {
      setMessage({ text: 'Please enter the helper\'s name.', kind: 'error' })
      return
    }
    if (!helperContact.trim()) {
      setMessage({ text: 'Please enter the helper\'s phone number or email address.', kind: 'error' })
      return
    }

    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setMessage(null)

    const isEmail = helperContact.includes('@')

    try {
      const res = await fetch('/api/household/members', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'invite',
          name:   helperName.trim(),
          role:   'helper',
          ...(isEmail
            ? { email: helperContact.trim() }
            : { phone: helperContact.trim() }),
        }),
      })

      if (!res.ok) {
        setMessage({ text: await apiError(res), kind: 'error' })
        return
      }

      setHelperName('')
      setHelperContact('')
      setMessage({ text: `${helperName.trim()} has been invited as a helper.`, kind: 'success' })
    } catch {
      setMessage({ text: 'Network error — please check your connection and try again.', kind: 'error' })
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8">
        <h1 className="text-2xl font-bold text-center mb-2">Welcome to Doorbell Helper</h1>

        {/* Step indicator */}
        <div className="flex justify-center gap-2 mb-6">
          {steps.map((s, i) => (
            <div
              key={s}
              className={`h-1.5 rounded-full flex-1 transition-colors ${
                steps.indexOf(step) >= i ? 'bg-blue-500' : 'bg-gray-200'
              }`}
            />
          ))}
        </div>

        {message && <Alert message={message} />}

        {/* ── Step 1: Create household ─────────────────────────────────── */}
        {step === 'create-household' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Create your household</h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Resident name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={residentName}
                onChange={e => setResidentName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Who lives here? e.g. Grandma Rita"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Your name (guardian) <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={guardianName}
                onChange={e => setGuardianName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Your full name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Your phone
              </label>
              <input
                type="tel"
                value={guardianPhone}
                onChange={e => setGuardianPhone(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="+919876543210"
                autoComplete="tel"
              />
              <p className="mt-1 text-xs text-gray-400">Include country code, e.g. +91 for India, +1 for US</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Your email
              </label>
              <input
                type="email"
                value={guardianEmail}
                onChange={e => setGuardianEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>

            <p className="text-xs text-gray-400">* Phone or email is required (at least one).</p>

            <button
              onClick={createHousehold}
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Creating…' : 'Continue'}
            </button>
          </div>
        )}

        {/* ── Step 2: Connect Ring ─────────────────────────────────────── */}
        {step === 'connect-ring' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Connect your Ring doorbell</h2>
            <p className="text-sm text-gray-600">
              Connect your Ring account to receive doorbell events and live video.
              Linking is done from the Ring AppStore — click below to open the portal.
            </p>
            <button
              onClick={connectRing}
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
            >
              Open Ring Developer Portal →
            </button>
            <button
              onClick={() => { setMessage(null); setStep('invite-helpers') }}
              disabled={loading}
              className="w-full bg-gray-100 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-200 transition-colors"
            >
              Skip for now
            </button>
          </div>
        )}

        {/* ── Step 3: Invite helpers ───────────────────────────────────── */}
        {step === 'invite-helpers' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Invite helpers</h2>
            <p className="text-sm text-gray-600">
              Add trusted friends or family who can respond when someone rings. You can add more from the settings page.
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Helper's name</label>
              <input
                type="text"
                value={helperName}
                onChange={e => setHelperName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Raj"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone or email
              </label>
              <input
                type="text"
                value={helperContact}
                onChange={e => setHelperContact(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="+919876543210 or raj@example.com"
              />
            </div>

            <button
              onClick={inviteHelper}
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Inviting…' : 'Send Invite'}
            </button>

            <button
              onClick={() => { setMessage(null); router.push('/setup') }}
              disabled={loading}
              className="w-full bg-gray-100 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-200 transition-colors"
            >
              Skip — go to settings
            </button>
          </div>
        )}

        {/* ── Step 4: Pair device ──────────────────────────────────────── */}
        {step === 'pair-device' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Pair the resident's device</h2>
            <p className="text-sm text-gray-600">
              On the resident's phone or tablet, open this app and enter the pairing code shown on the settings page.
            </p>
            <button
              onClick={() => router.push('/pair')}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition-colors"
            >
              Go to pairing page
            </button>
            <button
              onClick={() => router.push('/setup')}
              className="w-full bg-gray-100 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-200 transition-colors"
            >
              Skip — go to settings
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

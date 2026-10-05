'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'

type MessageKind = 'error' | 'info' | 'success'

interface Message {
  text: string
  kind: MessageKind
}

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

export default function LoginPage() {
  const router = useRouter()
  const [email,       setEmail]       = useState('')
  const [phone,       setPhone]       = useState('')
  const [otp,         setOtp]         = useState('')
  const [step,        setStep]        = useState<'input' | 'otp' | 'select' | 'no-household'>('input')
  const [loading,     setLoading]     = useState(false)
  const [message,     setMessage]     = useState<Message | null>(null)
  const [memberships, setMemberships] = useState<any[]>([])
  const [authMethod,  setAuthMethod]  = useState<'otp' | 'passkey' | 'magic'>('otp')

  // Synchronous in-flight guard — prevents double-submit before React re-renders
  const inFlight = useRef(false)

  /** Extract the error string from any API response shape */
  async function apiError(res: Response): Promise<string> {
    try {
      const data = await res.json()
      // Our API always returns { error: string }
      if (typeof data?.error === 'string' && data.error.length > 0) return data.error
    } catch {
      // Response body wasn't JSON — fall through to status-based message
    }
    switch (res.status) {
      case 400: return 'Bad request — please check your input and try again.'
      case 401: return 'Authentication failed — please check your details and try again.'
      case 403: return 'Access denied.'
      case 404: return 'Not found — please check your details and try again.'
      case 409: return 'Conflict — this action cannot be completed.'
      case 429: return 'Too many attempts — please wait a moment before trying again.'
      case 500: return 'Server error — please try again later.'
      case 502: return 'Upstream service error — please try again later.'
      case 503: return 'Service unavailable — please try again shortly.'
      default:  return `Unexpected error (HTTP ${res.status}) — please try again.`
    }
  }

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setMessage(null)

    try {
      const res = await fetch('/api/auth/send-otp', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          email: email || undefined,
          phone: phone || undefined,
        }),
      })

      if (!res.ok) {
        setMessage({ text: await apiError(res), kind: 'error' })
        return
      }

      setStep('otp')
      setMessage({
        text: `A sign-in code has been sent to ${email || phone}. Check your inbox or messages.`,
        kind: 'info',
      })
    } catch {
      setMessage({ text: 'Network error — please check your connection and try again.', kind: 'error' })
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }

  const handleSendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setMessage(null)

    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      if (!res.ok) {
        setMessage({ text: await apiError(res), kind: 'error' })
        inFlight.current = false
        setLoading(false)
        return
      }

      setMessage({ text: 'Magic link sent! Check your email to sign in.', kind: 'success' })
    } catch (error) {
      setMessage({ text: 'Failed to send magic link. Try again.', kind: 'error' })
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }

  const handlePasskeyLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setMessage(null)

    try {
      // Get authentication options from server
      const optionsRes = await fetch('/api/auth/passkey/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      if (!optionsRes.ok) {
        const errorText = await apiError(optionsRes)
        if (optionsRes.status === 404) {
          // User not found - they need to sign up first
          setMessage({
            text: 'No account found with this email. Please sign up first using a code or magic link, then you can register a passkey in settings.',
            kind: 'error',
          })
        } else {
          setMessage({ text: errorText, kind: 'error' })
        }
        inFlight.current = false
        setLoading(false)
        return
      }

      const { options, userId } = await optionsRes.json()

      // Use WebAuthn to authenticate
      const authResp = await startAuthentication(options)

      // Verify with server
      const verifyRes = await fetch('/api/auth/passkey/login/verify', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response: authResp,
          expectedChallenge: options.challenge,
        }),
      })

      if (!verifyRes.ok) {
        setMessage({ text: await apiError(verifyRes), kind: 'error' })
        inFlight.current = false
        setLoading(false)
        return
      }

      const data = await verifyRes.json()

      // Redirect based on role
      if (data.role === 'guardian') {
        router.push('/setup')
      } else {
        router.push('/helper')
      }
    } catch (error) {
      setMessage({ text: 'Passkey authentication failed. Try code or magic link instead.', kind: 'error' })
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setMessage(null)

    try {
      const res = await fetch('/api/auth/verify-otp', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          email: email || undefined,
          phone: phone || undefined,
          otp,
        }),
      })

      if (!res.ok) {
        setMessage({ text: await apiError(res), kind: 'error' })
        return
      }

      const data = await res.json()

      if (!data.memberships || data.memberships.length === 0) {
        setStep('no-household' as any)
        return
      }

      if (data.memberships.length === 1) {
        await selectHousehold(data.memberships[0].id)
      } else {
        setMemberships(data.memberships)
        setStep('select')
        setMessage(null)
      }
    } catch {
      setMessage({ text: 'Network error — please check your connection and try again.', kind: 'error' })
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }

  const selectHousehold = async (membershipId: string) => {
    setLoading(true)
    setMessage(null)
    try {
      const res = await fetch('/api/auth/select-household', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ membershipId }),
      })

      if (!res.ok) {
        setMessage({ text: await apiError(res), kind: 'error' })
        setLoading(false)
        return
      }

      const data = await res.json()
      if (data.role === 'guardian') {
        router.push('/setup')
      } else {
        router.push('/helper')
      }
    } catch {
      setMessage({ text: 'Network error — please check your connection and try again.', kind: 'error' })
      setLoading(false)
    }
  }

  const handleBack = () => {
    setStep('input')
    setOtp('')
    setMessage(null)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8">
        <h1 className="text-2xl font-bold text-center mb-6">Doorbell Helper</h1>

        {message && <Alert message={message} />}

        {step === 'input' && (
          <div className="space-y-4">
            {/* Auth method selector */}
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => setAuthMethod('otp')}
                className={`flex-1 py-2 px-4 rounded-md transition-colors ${
                  authMethod === 'otp' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
                }`}
              >
                Code
              </button>
              <button
                type="button"
                onClick={() => setAuthMethod('passkey')}
                className={`flex-1 py-2 px-4 rounded-md transition-colors ${
                  authMethod === 'passkey' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
                }`}
              >
                Passkey
              </button>
              <button
                type="button"
                onClick={() => setAuthMethod('magic')}
                className={`flex-1 py-2 px-4 rounded-md transition-colors ${
                  authMethod === 'magic' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
                }`}
              >
                Magic Link
              </button>
            </div>

            {authMethod === 'otp' && (
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => { setEmail(e.target.value); if (e.target.value) setPhone('') }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </div>
                <div className="text-center text-gray-400 text-sm">or</div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => { setPhone(e.target.value); if (e.target.value) setEmail('') }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="+919876543210"
                    autoComplete="tel"
                  />
                  <p className="mt-1 text-xs text-gray-400">Include country code, e.g. +1 for US, +91 for India</p>
                </div>
                <button
                  type="submit"
                  disabled={loading || (!email && !phone)}
                  className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'Sending…' : 'Send sign-in code'}
                </button>
              </form>
            )}

            {authMethod === 'magic' && (
              <form onSubmit={handleSendMagicLink} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !email}
                  className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'Sending…' : 'Send magic link'}
                </button>
              </form>
            )}

            {authMethod === 'passkey' && (
              <form onSubmit={handlePasskeyLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </div>
                <p className="text-sm text-gray-600">
                  Use your device's biometric (Face ID, fingerprint) or security key to sign in.
                </p>
                <p className="text-xs text-gray-400">
                  New to Doorbell Helper? Sign up with a code or magic link first, then register a passkey in settings.
                </p>
                <button
                  type="submit"
                  disabled={loading || !email}
                  className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'Authenticating…' : 'Sign in with Passkey'}
                </button>
              </form>
            )}
          </div>
        )}

        {step === 'otp' && (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Enter sign-in code
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-center text-2xl tracking-widest font-mono"
                placeholder="000000"
                autoComplete="one-time-code"
                autoFocus
              />
              <p className="mt-1 text-xs text-gray-400">
                6-digit code sent to {email || phone}. Valid for 10 minutes.
              </p>
            </div>
            <button
              type="submit"
              disabled={loading || otp.length !== 6}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              onClick={handleBack}
              className="w-full text-gray-500 py-2 px-4 hover:text-gray-700 text-sm transition-colors"
            >
              ← Use a different email or phone
            </button>
          </form>
        )}

        {step === 'select' && (
          <div className="space-y-4">
            <p className="text-gray-700 text-sm">You belong to multiple households. Select one to continue:</p>
            {memberships.map(m => (
              <button
                key={m.id}
                onClick={() => selectHousehold(m.id)}
                disabled={loading}
                className="w-full text-left p-4 border border-gray-300 rounded-md hover:bg-gray-50 disabled:bg-gray-100 disabled:cursor-not-allowed transition-colors"
              >
                <div className="font-medium">{m.residentName}</div>
                <div className="text-sm text-gray-500 capitalize">{m.role}</div>
              </button>
            ))}
            <button
              type="button"
              onClick={handleBack}
              disabled={loading}
              className="w-full text-gray-500 py-2 px-4 hover:text-gray-700 text-sm transition-colors"
            >
              ← Back
            </button>
          </div>
        )}

        {step === 'no-household' && (
          <div className="space-y-4">
            <p className="text-gray-700">
              You're signed in, but you're not a member of any household yet.
            </p>
            <p className="text-sm text-gray-500">
              You can create a new household (you'll become the guardian), or ask a guardian to share their invite link with you.
            </p>

            <a
              href="/onboarding"
              className="block w-full text-center bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition-colors"
            >
              Set up a new household
            </a>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white px-2 text-gray-400">or</span>
              </div>
            </div>

            <p className="text-sm text-center text-gray-500">
              Have an invite link? Open it in your browser — it will add you to the household automatically.
            </p>

            <button
              type="button"
              onClick={handleBack}
              className="w-full text-gray-500 py-2 px-4 hover:text-gray-700 text-sm transition-colors"
            >
              ← Sign in with a different account
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

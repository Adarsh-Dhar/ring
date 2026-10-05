'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type MessageKind = 'error' | 'info' | 'success'

interface Message {
  text: string
  kind: MessageKind
}

function Alert({ message }: { message: Message }) {
  const styles: Record<MessageKind, string> = {
    error: 'bg-red-900/20 border border-red-700 text-red-200',
    info: 'bg-blue-900/20 border border-blue-700 text-blue-200',
    success: 'bg-emerald-900/20 border border-emerald-700 text-emerald-200',
  }
  return (
    <div className={`mb-4 p-3 rounded-lg text-sm ${styles[message.kind]}`} role="alert">
      {message.text}
    </div>
  )
}

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState<'details' | 'verify'>('details')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)

  const inFlight = useRef(false)

  async function apiError(res: Response): Promise<string> {
    try {
      const data = await res.json()
      if (typeof data?.error === 'string' && data.error.length > 0) return data.error
    } catch {}
    switch (res.status) {
      case 400: return 'Bad request — please check your input and try again.'
      case 409: return 'This email or phone is already registered.'
      case 429: return 'Too many attempts — please wait a moment before trying again.'
      case 500: return 'Server error — please try again later.'
      default: return `Unexpected error (HTTP ${res.status}) — please try again.`
    }
  }

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email && !phone) {
      setMessage({ text: 'Please enter an email or phone number.', kind: 'error' })
      return
    }
    if (!name.trim()) {
      setMessage({ text: 'Please enter your name.', kind: 'error' })
      return
    }
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setMessage(null)

    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email || undefined,
          phone: phone || undefined,
        }),
      })

      if (!res.ok) {
        setMessage({ text: await apiError(res), kind: 'error' })
        return
      }

      setStep('verify')
      setMessage({
        text: `A verification code has been sent to ${email || phone}.`,
        kind: 'info',
      })
    } catch {
      setMessage({ text: 'Network error — please check your connection and try again.', kind: 'error' })
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email || undefined,
          phone: phone || undefined,
          otp,
          name: name.trim(),
        }),
      })

      if (!res.ok) {
        setMessage({ text: await apiError(res), kind: 'error' })
        return
      }

      router.push('/select-role')
    } catch {
      setMessage({ text: 'Network error — please check your connection and try again.', kind: 'error' })
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 text-white p-4">
      <div className="max-w-md mx-auto flex flex-col justify-center min-h-screen">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-lg">
              🔔
            </div>
            <span className="text-2xl font-bold">Ring Safe</span>
          </div>
          <h1 className="text-3xl font-bold mb-2">Create Account</h1>
          <p className="text-slate-400">Join Ring Safe to keep your loved ones safe</p>
        </div>

        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 backdrop-blur-sm">
          {message && <Alert message={message} />}

          {step === 'details' && (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Your Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Email or Phone</label>
                <input
                  type="text"
                  value={email || phone}
                  onChange={(e) => {
                    const val = e.target.value
                    if (val.includes('@')) {
                      setEmail(val)
                      setPhone('')
                    } else {
                      setPhone(val)
                      setEmail('')
                    }
                  }}
                  placeholder="your@email.com or +919876543210"
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                  required
                />
                <p className="text-xs text-slate-500 mt-1">We&apos;ll never share your contact info.</p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-lg font-semibold hover:from-cyan-600 hover:to-blue-700 disabled:opacity-50 transition"
              >
                {loading ? 'Sending Code...' : 'Send Verification Code'}
              </button>
            </form>
          )}

          {step === 'verify' && (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Verification Code</label>
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="000000"
                  maxLength={6}
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-center text-2xl tracking-widest"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-lg font-semibold hover:from-cyan-600 hover:to-blue-700 disabled:opacity-50 transition"
              >
                {loading ? 'Creating Account...' : 'Create Account'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep('details')
                  setOtp('')
                }}
                className="w-full text-sm text-slate-400 hover:text-white transition"
              >
                Use different email/phone
              </button>
            </form>
          )}

          <div className="mt-6 pt-6 border-t border-slate-700">
            <p className="text-sm text-slate-400 text-center">
              Already have an account?{' '}
              <Link href="/auth/login" className="text-cyan-400 hover:text-cyan-300 font-semibold transition">
                Sign in
              </Link>
            </p>
          </div>
        </div>

        <div className="mt-8 text-center">
          <Link href="/" className="text-sm text-slate-400 hover:text-white transition">
            Back to home
          </Link>
        </div>
      </div>
    </main>
  )
}

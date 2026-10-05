'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function LandingPage() {
  const router = useRouter()
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/session')
        if (res.ok) {
          setIsAuthenticated(true)
          const data = await res.json()
          if (data.kind === 'resident') {
            router.push('/workspace/resident')
          } else if (data.kind === 'helper') {
            router.push('/workspace/helper')
          }
        }
      } catch {}
      setIsLoading(false)
    }
    checkAuth()
  }, [router])

  if (isLoading) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400 mx-auto mb-4" />
          <p className="text-slate-400">Loading...</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Navigation */}
      <nav className="border-b border-slate-800 sticky top-0 z-50 bg-slate-950/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center font-bold">
              🔔
            </div>
            <span className="text-lg font-bold">Ring Safe</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/auth/login" className="text-slate-300 hover:text-white transition">
              Sign In
            </Link>
            <Link
              href="/auth/signup"
              className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-lg font-semibold hover:from-cyan-600 hover:to-blue-700 transition"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-6 py-20 md:py-32">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h1 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
              Safe at home,
              <br />
              <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
                peace of mind
              </span>
            </h1>
            <p className="text-xl text-slate-300 mb-8 leading-relaxed">
              Ring Safe keeps your loved ones secure. Residents get instant alerts and verification. Helpers review visitors in real-time. Together, you control who enters.
            </p>
            <div className="flex gap-4">
              <Link
                href="/auth/signup"
                className="px-8 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-lg font-semibold hover:from-cyan-600 hover:to-blue-700 transition"
              >
                Start Free
              </Link>
              <Link
                href="/setup"
                className="px-8 py-3 border border-slate-600 rounded-lg font-semibold hover:bg-slate-800 transition"
              >
                Demo
              </Link>
            </div>
          </div>

          {/* Feature Visual */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-4">
              <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 backdrop-blur-sm">
                <div className="text-4xl mb-2">🏠</div>
                <h3 className="font-semibold mb-2">For Residents</h3>
                <p className="text-sm text-slate-400">Instant alerts when someone rings. Verify visitors with your helper.</p>
              </div>
              <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 backdrop-blur-sm">
                <div className="text-4xl mb-2">🔔</div>
                <h3 className="font-semibold mb-2">Planned Visits</h3>
                <p className="text-sm text-slate-400">Schedule recurring visits or one-time appointments easily.</p>
              </div>
            </div>
            <div className="space-y-4 mt-8">
              <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 backdrop-blur-sm">
                <div className="text-4xl mb-2">👥</div>
                <h3 className="font-semibold mb-2">For Helpers</h3>
                <p className="text-sm text-slate-400">Verify visitors, confirm their identity, and protect your workspace.</p>
              </div>
              <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 backdrop-blur-sm">
                <div className="text-4xl mb-2">✅</div>
                <h3 className="font-semibold mb-2">Approval System</h3>
                <p className="text-sm text-slate-400">All new helpers are approved by the resident for safety.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="bg-slate-800/30 border-y border-slate-800 py-20">
        <div className="max-w-7xl mx-auto px-6">
          <h2 className="text-3xl font-bold mb-12 text-center">How it works</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div>
              <div className="text-5xl mb-4">1️⃣</div>
              <h3 className="text-lg font-semibold mb-3">Create Workspace</h3>
              <p className="text-slate-400">Residents set up their workspace and choose their role as either the resident or a helper.</p>
            </div>
            <div>
              <div className="text-5xl mb-4">2️⃣</div>
              <h3 className="text-lg font-semibold mb-3">Invite Helpers</h3>
              <p className="text-slate-400">Residents invite helpers and approve them. Helpers can only access after approval.</p>
            </div>
            <div>
              <div className="text-5xl mb-4">3️⃣</div>
              <h3 className="text-lg font-semibold mb-3">Plan & Verify</h3>
              <p className="text-slate-400">Schedule visits, add visitors, and get real-time notifications with instant verification.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Key Features */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-bold mb-12 text-center">Powerful features for safety</h2>
        <div className="grid md:grid-cols-2 gap-8">
          <div className="border border-slate-700 rounded-xl p-8 hover:border-cyan-500/50 transition">
            <h3 className="text-xl font-semibold mb-3 flex items-center gap-3">
              <span className="text-2xl">🔔</span> Real-time Doorbell Alerts
            </h3>
            <p className="text-slate-300">Instant notifications when the doorbell rings. Helpers review in real-time.</p>
          </div>
          <div className="border border-slate-700 rounded-xl p-8 hover:border-cyan-500/50 transition">
            <h3 className="text-xl font-semibold mb-3 flex items-center gap-3">
              <span className="text-2xl">📹</span> Live Video Feed
            </h3>
            <p className="text-slate-300">See who is at the door instantly. Only shown during emergencies.</p>
          </div>
          <div className="border border-slate-700 rounded-xl p-8 hover:border-cyan-500/50 transition">
            <h3 className="text-xl font-semibold mb-3 flex items-center gap-3">
              <span className="text-2xl">✋</span> Visitor Verification
            </h3>
            <p className="text-slate-300">Visitors use codes or voice verification to confirm their identity.</p>
          </div>
          <div className="border border-slate-700 rounded-xl p-8 hover:border-cyan-500/50 transition">
            <h3 className="text-xl font-semibold mb-3 flex items-center gap-3">
              <span className="text-2xl">📅</span> Scheduled Visits
            </h3>
            <p className="text-slate-300">Plan recurring visits or one-time appointments without alerts needed.</p>
          </div>
          <div className="border border-slate-700 rounded-xl p-8 hover:border-cyan-500/50 transition">
            <h3 className="text-xl font-semibold mb-3 flex items-center gap-3">
              <span className="text-2xl">🚨</span> Emergency SOS
            </h3>
            <p className="text-slate-300">Residents can trigger emergency alerts. Helpers respond immediately.</p>
          </div>
          <div className="border border-slate-700 rounded-xl p-8 hover:border-cyan-500/50 transition">
            <h3 className="text-xl font-semibold mb-3 flex items-center gap-3">
              <span className="text-2xl">🔐</span> Helper Management
            </h3>
            <p className="text-slate-300">Control who helps. Only approved helpers can join your workspace.</p>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="border-t border-slate-800 py-20 bg-slate-800/30">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-4xl font-bold mb-6">Ready to stay safe?</h2>
          <p className="text-xl text-slate-300 mb-8">Get started with Ring Safe in minutes. Your workspace, your rules.</p>
          <div className="flex gap-4 justify-center flex-wrap">
            <Link
              href="/auth/signup"
              className="px-8 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-lg font-semibold hover:from-cyan-600 hover:to-blue-700 transition"
            >
              Create Account
            </Link>
            <Link
              href="/auth/login"
              className="px-8 py-3 border border-slate-600 rounded-lg font-semibold hover:bg-slate-800 transition"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-12 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8 pb-8 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-xs font-bold">
                🔔
              </div>
              <span className="font-bold">Ring Safe</span>
            </div>
            <div className="flex gap-8">
              <Link href="/setup" className="text-sm text-slate-400 hover:text-white transition">
                Demo
              </Link>
              <a href="#" className="text-sm text-slate-400 hover:text-white transition">
                Privacy
              </a>
              <a href="#" className="text-sm text-slate-400 hover:text-white transition">
                Terms
              </a>
            </div>
          </div>
          <p className="text-sm text-slate-500 mt-8">© 2025 Ring Safe. All rights reserved. Keeping families safe, together.</p>
        </div>
      </footer>
    </main>
  )
}

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function CreateWorkspacePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [residentName, setResidentName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')

  const createHousehold = async () => {
    setError('')

    if (!residentName.trim()) {
      setError('Please enter your name')
      return
    }
    if (!phone.trim() && !email.trim()) {
      setError('Please enter either your phone number or email address')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/household', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          residentName: residentName.trim(),
          guardianName: residentName.trim(), // Resident is their own guardian
          guardianPhone: phone.trim() || undefined,
          guardianEmail: email.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to create household')
        return
      }

      const data = await res.json()
      if (data.householdId) {
        router.push(`/workspace/${data.householdId}`)
      } else {
        router.push('/workspaces')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Create Your Workspace</h1>
          <p className="text-gray-600 mt-2">Set up your household to get started</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Your name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={residentName}
              onChange={(e) => setResidentName(e.target.value)}
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
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="+919876543210"
            />
            <p className="mt-1 text-xs text-gray-500">Include country code, e.g. +91 for India</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Your email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="you@example.com"
            />
          </div>

          <p className="text-xs text-gray-500">* Phone or email is required (at least one)</p>

          <button
            onClick={createHousehold}
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Creating...' : 'Create Workspace'}
          </button>
        </div>
      </div>
    </div>
  )
}

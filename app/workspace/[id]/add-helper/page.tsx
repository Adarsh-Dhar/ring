'use client'

import { useState } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'

export default function AddHelperPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const workspaceId = params.id as string
  const role = searchParams.get('role') || 'resident'
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [helperName, setHelperName] = useState('')
  const [helperContact, setHelperContact] = useState('')

  const addHelper = async () => {
    setError('')

    if (!helperName.trim()) {
      setError('Please enter the helper\'s name')
      return
    }
    if (!helperContact.trim()) {
      setError('Please enter the helper\'s phone number or email address')
      return
    }

    setLoading(true)

    try {
      const isEmail = helperContact.includes('@')
      const res = await fetch('/api/household/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'invite',
          name: helperName.trim(),
          role: 'helper',
          ...(isEmail ? { email: helperContact.trim() } : { phone: helperContact.trim() }),
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to add helper')
        return
      }

      router.push(`/workspace/${workspaceId}?role=${role}`)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <Link href={`/workspace/${workspaceId}?role=${role}`} className="text-gray-700 hover:text-gray-900">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <h1 className="text-xl font-bold text-gray-900">Add Helper</h1>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-md mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-md p-8">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Helper's name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={helperName}
                onChange={(e) => setHelperName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Raj"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone or email <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={helperContact}
                onChange={(e) => setHelperContact(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="+919876543210 or raj@example.com"
              />
            </div>

            <button
              onClick={addHelper}
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Adding...' : 'Send Invite'}
            </button>

            <Link
              href={`/workspace/${workspaceId}?role=${role}`}
              className="block text-center text-gray-600 py-2 hover:text-gray-900"
            >
              Cancel
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}

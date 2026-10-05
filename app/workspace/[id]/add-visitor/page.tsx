'use client'

import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

export default function AddVisitorPage() {
  const router = useRouter()
  const params = useParams()
  const workspaceId = params.id as string
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [visitorName, setVisitorName] = useState('')
  const [visitType, setVisitType] = useState<'one-time' | 'recurring'>('one-time')
  const [visitDate, setVisitDate] = useState('')
  const [visitTime, setVisitTime] = useState('')
  const [purpose, setPurpose] = useState('')

  const addVisitor = async () => {
    setError('')

    if (!visitorName.trim()) {
      setError('Please enter the visitor\'s name')
      return
    }
    if (visitType === 'one-time' && (!visitDate || !visitTime)) {
      setError('Please select the visit date and time')
      return
    }

    setLoading(true)

    try {
      // This will create a visitor pass that needs resident approval
      const res = await fetch('/api/visitor/passes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorName: visitorName.trim(),
          windowStart: visitType === 'one-time' ? new Date(`${visitDate}T${visitTime}`).toISOString() : null,
          windowEnd: visitType === 'one-time' ? new Date(`${visitDate}T${visitTime}`).toISOString() : null,
          recurrence: visitType === 'recurring' ? { type: 'recurring' } : null,
          purpose: purpose.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to create visitor pass')
        return
      }

      router.push(`/workspace/${workspaceId}`)
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
              <Link href={`/workspace/${workspaceId}`} className="text-gray-700 hover:text-gray-900">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <h1 className="text-xl font-bold text-gray-900">Add Visitor Pass</h1>
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
                Visitor's name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={visitorName}
                onChange={(e) => setVisitorName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Dr. Smith"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Visit type <span className="text-red-500">*</span>
              </label>
              <div className="flex space-x-4">
                <button
                  type="button"
                  onClick={() => setVisitType('one-time')}
                  className={`flex-1 py-2 px-4 rounded-md border ${
                    visitType === 'one-time'
                      ? 'border-blue-600 bg-blue-50 text-blue-600'
                      : 'border-gray-300 text-gray-700'
                  }`}
                >
                  One-time
                </button>
                <button
                  type="button"
                  onClick={() => setVisitType('recurring')}
                  className={`flex-1 py-2 px-4 rounded-md border ${
                    visitType === 'recurring'
                      ? 'border-blue-600 bg-blue-50 text-blue-600'
                      : 'border-gray-300 text-gray-700'
                  }`}
                >
                  Recurring
                </button>
              </div>
            </div>

            {visitType === 'one-time' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={visitDate}
                    onChange={(e) => setVisitDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Time <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="time"
                    value={visitTime}
                    onChange={(e) => setVisitTime(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Purpose (optional)
              </label>
              <input
                type="text"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Doctor appointment"
              />
            </div>

            <button
              onClick={addVisitor}
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Creating...' : 'Create Pass'}
            </button>

            <Link
              href={`/workspace/${workspaceId}`}
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

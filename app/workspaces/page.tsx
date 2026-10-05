'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Household {
  id: string
  residentName: string
  role: string
}

export default function WorkspacesPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [households, setHouseholds] = useState<Household[]>([])

  useEffect(() => {
    loadHouseholds()
  }, [])

  const loadHouseholds = async () => {
    try {
      const res = await fetch('/api/user/households')
      if (!res.ok) {
        router.push('/login')
        return
      }

      const data = await res.json()
      if (data.memberships && data.memberships.length > 0) {
        setHouseholds(data.memberships)
      }
    } catch {
      router.push('/login')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="text-2xl font-bold text-gray-900">
              Doorbell Helper
            </Link>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.push('/notifications')}
                className="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
              >
                Notifications
              </button>
              <button
                onClick={() => {
                  document.cookie = 'db_session=; path=/; max-age=0'
                  router.push('/')
                }}
                className="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Your Workspaces</h1>
          <p className="text-gray-600 mt-2">
            Select a workspace to manage
          </p>
        </div>

        {households.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">No Workspaces Yet</h2>
            <p className="text-gray-600 mb-4">
              You haven't joined any households yet. Create one to get started.
            </p>
            <Link
              href="/create-workspace"
              className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors"
            >
              Create Workspace
            </Link>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {households.map((household) => (
              <Link
                key={household.id}
                href={`/workspace/${household.id}`}
                className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow cursor-pointer"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                    </svg>
                  </div>
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 capitalize">
                    {household.role}
                  </span>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  {household.residentName}'s Home
                </h3>
                <p className="text-gray-600 text-sm">
                  {household.role === 'guardian' ? 'You are the guardian' : 'You are a helper'}
                </p>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

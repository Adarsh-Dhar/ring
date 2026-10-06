'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AccountPage() {
  const router = useRouter()
  const [user, setUser] = useState<{ id: string; name: string | null; email: string | null; phone: string | null; createdAt: string } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadUser()
  }, [])

  const loadUser = async () => {
    try {
      const res = await fetch('/api/auth/me')
      if (res.ok) {
        const data = await res.json()
        setUser(data.user)
      } else {
        router.push('/login')
      }
    } catch (e) {
      console.error('Failed to load user', e)
    } finally {
      setLoading(false)
    }
  }

  const handleSignOut = async () => {
    try {
      await fetch('/api/session', { method: 'DELETE' })
    } catch (e) {
      console.error('Failed to sign out', e)
    }
    router.push('/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">User not found</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <button
            onClick={() => router.back()}
            className="text-gray-600 hover:text-gray-900 flex items-center"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
        </div>

        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
            <h3 className="text-lg leading-6 font-medium text-gray-900">Account Settings</h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              Manage your account information and preferences.
            </p>
          </div>

          <div className="px-4 py-5 sm:px-6">
            {/* Profile Section */}
            <div className="flex items-center space-x-6 mb-8">
              <div className="w-24 h-24 rounded-full bg-blue-600 text-white flex items-center justify-center font-semibold text-4xl">
                {user.name?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div>
                <h4 className="text-xl font-semibold text-gray-900">{user.name || 'User'}</h4>
                <p className="text-gray-500">{user.email || ''}</p>
              </div>
            </div>

            {/* Account Details */}
            <div className="space-y-6">
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-3">Account Information</h4>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Name</dt>
                    <dd className="mt-1 text-sm text-gray-900">{user.name || 'Not set'}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Email</dt>
                    <dd className="mt-1 text-sm text-gray-900">{user.email || 'Not set'}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Phone</dt>
                    <dd className="mt-1 text-sm text-gray-900">{user.phone || 'Not set'}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-gray-500">Account Created</dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="border-t border-gray-200 pt-6">
                <h4 className="text-sm font-medium text-gray-900 mb-3">Authentication</h4>
                <div className="flex items-center space-x-2">
                  <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm text-gray-700">Signed in with Google</span>
                </div>
              </div>
            </div>
          </div>

          <div className="px-4 py-5 sm:px-6 border-t border-gray-200 bg-gray-50">
            <button
              onClick={handleSignOut}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

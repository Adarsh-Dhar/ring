'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

interface WorkspaceData {
  id: string
  residentName: string
  role: string
  requireResidentOk: boolean
  plannedMode: string
}

export default function WorkspacePage() {
  const router = useRouter()
  const params = useParams()
  const workspaceId = params.id as string
  const [loading, setLoading] = useState(true)
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null)
  const [activeTab, setActiveTab] = useState<'dashboard' | 'helpers' | 'visitors'>('dashboard')

  useEffect(() => {
    loadWorkspace()
  }, [workspaceId])

  const loadWorkspace = async () => {
    try {
      const res = await fetch(`/api/workspace/${workspaceId}`)
      if (!res.ok) {
        router.push('/workspaces')
        return
      }

      const data = await res.json()
      setWorkspace(data)
    } catch {
      router.push('/workspaces')
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

  if (!workspace) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Workspace not found</div>
      </div>
    )
  }

  const isResident = workspace.role === 'guardian'

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <Link href="/workspaces" className="text-gray-700 hover:text-gray-900">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <h1 className="text-xl font-bold text-gray-900">
                {workspace.residentName}'s Home
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.push('/notifications')}
                className="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
              >
                Notifications
              </button>
              <button
                onClick={() => router.push('/workspaces')}
                className="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
              >
                Workspaces
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

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'dashboard'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Dashboard
            </button>
            {isResident && (
              <button
                onClick={() => setActiveTab('helpers')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'helpers'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Helpers
              </button>
            )}
            <button
              onClick={() => setActiveTab('visitors')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'visitors'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Visitors
            </button>
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'dashboard' && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Dashboard</h2>
            <div className="grid md:grid-cols-3 gap-6">
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="text-3xl font-bold text-blue-600 mb-2">Active</div>
                <div className="text-gray-600">Ring Doorbell Status</div>
              </div>
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="text-3xl font-bold text-green-600 mb-2">0</div>
                <div className="text-gray-600">Pending Alerts</div>
              </div>
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="text-3xl font-bold text-purple-600 mb-2">0</div>
                <div className="text-gray-600">Scheduled Visits Today</div>
              </div>
            </div>

            {isResident && (
              <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-blue-900 mb-2">
                  Connect Your Ring Doorbell
                </h3>
                <p className="text-blue-800 mb-4">
                  Link your Ring account to start receiving doorbell events.
                </p>
                <a
                  href="https://developer.amazon.com/ring/console/apps"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
                >
                  Open Ring Developer Portal
                </a>
              </div>
            )}
          </div>
        )}

        {activeTab === 'helpers' && isResident && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Manage Helpers</h2>
            <div className="bg-white rounded-lg shadow-md p-6">
              <p className="text-gray-600 mb-4">
                Add trusted family and friends as helpers who can respond to doorbell alerts.
              </p>
              <Link
                href={`/workspace/${workspaceId}/add-helper`}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
              >
                Add Helper
              </Link>
            </div>
          </div>
        )}

        {activeTab === 'visitors' && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Visitor Management</h2>
            <div className="bg-white rounded-lg shadow-md p-6">
              <p className="text-gray-600 mb-4">
                {isResident
                  ? 'Review and approve visitor passes created by helpers.'
                  : 'Create visitor passes for one-time or recurring visits. The resident will need to approve them.'}
              </p>
              <Link
                href={`/workspace/${workspaceId}/add-visitor`}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
              >
                Add Visitor Pass
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

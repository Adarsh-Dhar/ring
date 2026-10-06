'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Household {
  id: string
  householdId: string
  role: string
  residentName: string
}

interface Notification {
  id: string
  type: string
  title: string
  message: string
  status: string
  read: boolean
  createdAt: string
  fromUser?: {
    name: string | null
    email: string | null
  }
}

export default function SelectWorkspacePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [households, setHouseholds] = useState<Household[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [showAccountMenu, setShowAccountMenu] = useState(false)
  const [user, setUser] = useState<{ name: string | null; email: string | null } | null>(null)
  const notificationRef = useRef<HTMLDivElement>(null)
  const accountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadHouseholds()
    loadNotifications()
    loadUser()
  }, [])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) {
        setShowNotifications(false)
      }
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) {
        setShowAccountMenu(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
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

  const loadNotifications = async () => {
    try {
      const res = await fetch('/api/notifications')
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.notifications || [])
      }
    } catch (e) {
      console.error('Failed to load notifications', e)
    }
  }

  const loadUser = async () => {
    try {
      const res = await fetch('/api/auth/me')
      if (res.ok) {
        const data = await res.json()
        setUser(data.user)
      }
    } catch (e) {
      console.error('Failed to load user', e)
    }
  }

  const respondToNotification = async (notificationId: string, action: 'accept' | 'reject') => {
    try {
      const res = await fetch(`/api/notifications/${notificationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (res.ok) {
        loadNotifications()
        loadHouseholds() // Reload households in case acceptance changed their access
      }
    } catch (e) {
      console.error('Failed to respond to notification', e)
    }
  }

  const selectWorkspace = (householdId: string) => {
    router.push(`/workspace/${householdId}?role=helper`)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    )
  }

  const unreadCount = notifications.filter(n => !n.read).length

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
              {/* Notification Bell */}
              <div className="relative" ref={notificationRef}>
                <button
                  onClick={() => {
                    setShowNotifications(!showNotifications)
                    if (!showNotifications) loadNotifications()
                  }}
                  className="text-gray-700 hover:text-gray-900 p-2 rounded-md relative"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {/* Notification Dropdown */}
                {showNotifications && (
                  <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50 max-h-96 overflow-y-auto">
                    <div className="p-4 border-b border-gray-200">
                      <h3 className="font-semibold text-gray-900">Notifications</h3>
                    </div>
                    {notifications.length === 0 ? (
                      <div className="p-4 text-center text-gray-500">
                        No notifications
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-200">
                        {notifications.map((notification) => (
                          <div
                            key={notification.id}
                            className={`p-4 ${!notification.read ? 'bg-blue-50' : ''}`}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <p className="font-medium text-gray-900 text-sm">{notification.title}</p>
                                <p className="text-gray-600 text-sm mt-1">{notification.message}</p>
                                <p className="text-gray-400 text-xs mt-2">
                                  {new Date(notification.createdAt).toLocaleString()}
                                </p>
                              </div>
                            </div>
                            {notification.type === 'helper_invite' && notification.status === 'pending' && (
                              <div className="flex space-x-2 mt-3">
                                <button
                                  onClick={() => respondToNotification(notification.id, 'accept')}
                                  className="flex-1 bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700"
                                >
                                  Accept
                                </button>
                                <button
                                  onClick={() => respondToNotification(notification.id, 'reject')}
                                  className="flex-1 bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700"
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                            {(notification.status !== 'pending' || notification.type === 'helper_invite_accepted' || notification.type === 'helper_invite_rejected') && (
                              <div className="mt-2">
                                <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                                  notification.status === 'accepted' || notification.type === 'helper_invite_accepted' ? 'bg-green-100 text-green-800' :
                                  notification.status === 'rejected' || notification.type === 'helper_invite_rejected' ? 'bg-red-100 text-red-800' :
                                  'bg-gray-100 text-gray-800'
                                }`}>
                                  {notification.status === 'pending' ? 'PENDING' : notification.status.toUpperCase()}
                                </span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Account Menu */}
              <div className="relative" ref={accountRef}>
                <button
                  onClick={() => setShowAccountMenu(!showAccountMenu)}
                  className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700"
                >
                  {user?.name?.charAt(0).toUpperCase() || 'U'}
                </button>

                {showAccountMenu && (
                  <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
                    <div className="p-4 border-b border-gray-200">
                      <div className="flex items-center space-x-3">
                        <div className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center font-semibold text-lg">
                          {user?.name?.charAt(0).toUpperCase() || 'U'}
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">{user?.name || 'User'}</p>
                          <p className="text-sm text-gray-500">{user?.email || ''}</p>
                        </div>
                      </div>
                    </div>
                    <div className="p-2">
                      <Link
                        href="/account"
                        className="block px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md text-sm"
                      >
                        Account Settings
                      </Link>
                      <button
                        onClick={async () => {
                          try {
                            await fetch('/api/session', { method: 'DELETE' })
                          } catch (e) {
                            console.error('Failed to sign out', e)
                          }
                          router.push('/login')
                        }}
                        className="w-full text-left px-4 py-2 text-red-600 hover:bg-red-50 rounded-md text-sm"
                      >
                        Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={() => router.push('/select-role')}
                className="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
              >
                Change Role
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Select a Workspace</h1>
          <p className="text-gray-600 mt-2">
            Choose a household to help
          </p>
        </div>

        {households.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">No Workspaces Yet</h2>
            <p className="text-gray-600 mb-4">
              You haven't been added to any households yet. Ask a resident to add you as a helper.
            </p>
            {notifications.length > 0 && (
              <p className="text-blue-600 mb-4">
                You have {unreadCount} pending notification{unreadCount !== 1 ? 's' : ''}. Check the bell icon above to accept or reject helper invites.
              </p>
            )}
            <button
              onClick={() => router.push('/select-role')}
              className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors"
            >
              Change Role
            </button>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {households.map((household) => (
              <button
                key={household.id}
                onClick={() => selectWorkspace(household.householdId)}
                className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow cursor-pointer text-left"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 capitalize">
                    {household.role}
                  </span>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  {household.residentName}'s Home
                </h3>
                <p className="text-gray-600 text-sm">
                  Click to open this workspace
                </p>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

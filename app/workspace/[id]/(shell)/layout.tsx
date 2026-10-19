'use client'
import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useParams, useSearchParams, usePathname } from 'next/navigation'
import Link from 'next/link'
import { WorkspaceProvider, useWorkspace } from './WorkspaceContext'
import type { WorkspaceData } from './WorkspaceContext'

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

function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const workspaceId = params.id as string
  const roleParam = searchParams.get('role') || 'resident'
  const [loading, setLoading] = useState(true)
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null)
  const [showNotifications, setShowNotifications] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const notificationRef = useRef<HTMLDivElement>(null)
  const [showAccountMenu, setShowAccountMenu] = useState(false)
  const accountRef = useRef<HTMLDivElement>(null)

  // Set household cookie on page load
  useEffect(() => {
    fetch('/api/session/household', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ householdId: workspaceId }),
    }).catch((e) => {
      console.error('Failed to set household cookie', e)
    })
  }, [workspaceId])

  const loadNotifications = async () => {
    try {
      const res = await fetch('/api/notifications')
      if (res.ok) {
        const data = await res.json()
        console.log('Loaded notifications:', data.notifications)
        const unread = data.notifications?.filter((n: Notification) => !n.read).length || 0
        console.log('Unread count:', unread)
        setNotifications(data.notifications || [])
        setUnreadCount(unread)
      }
    } catch (e) {
      console.error('Failed to load notifications', e)
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
      }
    } catch (e) {
      console.error('Failed to respond to notification', e)
    }
  }

  const markAsRead = async (notificationId: string) => {
    try {
      console.log('Marking notification as read:', notificationId)
      const res = await fetch(`/api/notifications/${notificationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_read' }),
      })
      console.log('Mark as read response:', res.status, await res.text())
      loadNotifications()
    } catch (e) {
      console.error('Failed to mark notification as read', e)
    }
  }

  const leaveWorkspace = async () => {
    if (!confirm('Are you sure you want to leave this workspace?')) {
      return
    }
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/leave`, {
        method: 'POST',
      })
      if (res.ok) {
        router.push('/select-workspace')
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data.error || 'Failed to leave workspace')
      }
    } catch (e) {
      console.error('Failed to leave workspace', e)
      alert('Failed to leave workspace. Please try again.')
    }
  }

  const loadWorkspace = async () => {
    try {
      const res = await fetch(`/api/workspace/${workspaceId}`)
      if (!res.ok) {
        // User doesn't have access to this workspace
        // Check if they have other households
        const householdsRes = await fetch('/api/user/households')
        if (householdsRes.ok) {
          const householdsData = await householdsRes.json()
          if (householdsData.memberships && householdsData.memberships.length > 0) {
            // User has other households, go to workspace selection
            router.push('/select-workspace')
          } else {
            // User has no households, go to role selection
            router.push('/select-role')
          }
        } else {
          router.push('/select-role')
        }
        return
      }
      const data = await res.json()
      setWorkspace(data)
    } catch {
      router.push('/select-role')
    } finally {
      setLoading(false)
    }
  }

  const switchRole = (newRole: 'resident' | 'helper') => {
    if (newRole === 'resident') {
      // If user is guardian of this household, go to resident view
      router.push(`/workspace/${workspaceId}/dashboard?role=resident`)
    } else {
      // Go to workspace selection for helper view
      router.push('/select-workspace')
    }
  }

  // Close dropdown when clicking outside
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

  useEffect(() => {
    loadWorkspace()
    loadNotifications()
  }, [workspaceId])

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-slate-400">Loading...</div>
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

  const isResidentView = roleParam !== 'helper'
  const userIsGuardian = workspace.role === 'guardian'

  // Build href function that preserves role
  const href = (subPath?: string) => {
    const base = `/workspace/${workspaceId}${subPath || ''}`
    const role = searchParams.get('role')
    return role ? `${base}?role=${role}` : base
  }

  // Determine active tab from pathname
  const getActiveTab = () => {
    if (pathname.endsWith('/dashboard')) return 'dashboard'
    if (pathname.endsWith('/helpers')) return 'helpers'
    if (pathname.endsWith('/visitors')) return 'visitors'
    if (pathname.endsWith('/calendar')) return 'calendar'
    if (pathname.endsWith('/simulation')) return 'simulation'
    return 'dashboard'
  }

  const activeTab = getActiveTab()

  const contextValue: {
    workspaceId: string
    workspace: WorkspaceData
    role: 'resident' | 'helper'
    isResidentView: boolean
    userIsGuardian: boolean
    href: (subPath?: string) => string
  } = {
    workspaceId,
    workspace,
    role: isResidentView ? 'resident' : 'helper',
    isResidentView,
    userIsGuardian,
    href,
  }

  return (
    <WorkspaceProvider value={contextValue}>
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-4">
                <button
                  onClick={() => isResidentView ? router.push('/select-role') : router.push('/select-workspace')}
                  className="text-gray-700 hover:text-gray-900"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <h1 className="text-xl font-bold text-gray-900">
                  {workspace.residentName}'s Home
                </h1>
                <span className={`px-2 py-1 rounded text-xs font-medium ${isResidentView ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}`}>
                  {isResidentView ? 'Resident View' : 'Helper View'}
                </span>
              </div>
              <div className="flex items-center space-x-4">
                {/* Role Switcher */}
                {userIsGuardian && (
                  <button
                    onClick={() => switchRole(isResidentView ? 'helper' : 'resident')}
                    className="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium border border-gray-300 hover:border-gray-400"
                  >
                    Switch to {isResidentView ? 'Helper' : 'Resident'}
                  </button>
                )}
                {/* Leave Workspace button for helpers only */}
                {!isResidentView && workspace.hasHelperMembership && (
                  <button
                    onClick={leaveWorkspace}
                    className="text-red-600 hover:text-red-700 px-3 py-2 rounded-md text-sm font-medium border border-red-300 hover:border-red-400"
                  >
                    Leave Workspace
                  </button>
                )}
                {/* Notification Bell */}
                <div className="relative">
                  <button
                    onClick={async () => {
                      setShowNotifications(!showNotifications)
                      if (!showNotifications) {
                        await loadNotifications()
                        // Mark all unread notifications as read when opening the dropdown
                        const unreadIds = notifications.filter(n => !n.read).map(n => n.id)
                        for (const id of unreadIds) {
                          await markAsRead(id)
                        }
                      }
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
                    <div ref={notificationRef} className="absolute right-0 mt-2 w-80 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-gray-200 dark:border-slate-700 z-50 max-h-96 overflow-y-auto">
                      <div className="p-4 border-b border-gray-200 dark:border-slate-700">
                        <h3 className="font-semibold text-gray-900 dark:text-white">Notifications</h3>
                      </div>
                      {notifications.length === 0 ? (
                        <div className="p-4 text-center text-gray-500 dark:text-gray-400">
                          No notifications
                        </div>
                      ) : (
                        <div className="divide-y divide-gray-200 dark:divide-slate-700">
                          {notifications.map((notification) => (
                            <div
                              key={notification.id}
                              className={`p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 ${!notification.read ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                              onClick={() => !notification.read && markAsRead(notification.id)}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <p className="font-medium text-gray-900 dark:text-white text-sm">{notification.title}</p>
                                  <p className="text-gray-600 dark:text-gray-300 text-sm mt-1">{notification.message}</p>
                                  <p className="text-gray-400 dark:text-gray-500 text-xs mt-2">
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
                                    notification.status === 'accepted' || notification.type === 'helper_invite_accepted' ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' :
                                    notification.status === 'rejected' || notification.type === 'helper_invite_rejected' ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300' :
                                    'bg-gray-100 dark:bg-slate-700 text-gray-800 dark:text-gray-300'
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
                    {workspace.user?.name?.charAt(0).toUpperCase() || 'U'}
                  </button>
                  {showAccountMenu && (
                    <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-gray-200 dark:border-slate-700 z-50">
                      <div className="p-4 border-b border-gray-200 dark:border-slate-700">
                        <div className="flex items-center space-x-3">
                          <div className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center font-semibold text-lg">
                            {workspace.user?.name?.charAt(0).toUpperCase() || 'U'}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900 dark:text-white">{workspace.user?.name || 'User'}</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">{workspace.user?.email || ''}</p>
                          </div>
                        </div>
                      </div>
                      <div className="p-2">
                        <Link
                          href="/account"
                          className="block px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-md text-sm"
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
                          className="w-full text-left px-4 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md text-sm"
                        >
                          Sign Out
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </header>
        {/* Tabs */}
        <div className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <nav className="flex space-x-8">
              <Link
                href={href('/dashboard')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'dashboard'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Dashboard
              </Link>
              {isResidentView && (
                <Link
                  href={href('/helpers')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'helpers'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Helpers
                </Link>
              )}
              <Link
                href={href('/visitors')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'visitors'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Visitors
              </Link>
              <Link
                href={href('/calendar')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'calendar'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Calendar
              </Link>
              {userIsGuardian && (
                <Link
                  href={href('/simulation')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'simulation'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Simulation
                </Link>
              )}
            </nav>
          </div>
        </div>
        {/* Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </div>
    </WorkspaceProvider>
  )
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-900 flex items-center justify-center"><div className="text-slate-400">Loading...</div></div>}>
      <WorkspaceShell>{children}</WorkspaceShell>
    </Suspense>
  )
}

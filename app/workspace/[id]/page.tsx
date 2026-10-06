'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'

interface WorkspaceData {
  id: string
  residentName: string
  role: string
  requireResidentOk: boolean
  plannedMode: string
  hasHelperMembership: boolean
  user: {
    name: string | null
    email: string | null
  } | null
}

interface DashboardData {
  ringStatus: string
  pendingAlerts: number
  scheduledVisits: number
  activePasses: number
  googleCalendarConnected: boolean
}

interface CalendarEvent {
  id: string
  summary: string
  description?: string
  start: { dateTime?: string; date?: string }
  end: { dateTime?: string; date?: string }
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

// Also update the select-workspace page to include the new notification types

export default function WorkspacePage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const workspaceId = params.id as string
  const roleParam = searchParams.get('role') || 'resident'
  const [loading, setLoading] = useState(true)
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null)
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([])
  const [loadingCalendar, setLoadingCalendar] = useState(false)
  const [activeTab, setActiveTab] = useState<'dashboard' | 'helpers' | 'visitors'>('dashboard')
  const [showNotifications, setShowNotifications] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const notificationRef = useRef<HTMLDivElement>(null)
  const [deviceAuth, setDeviceAuth] = useState<{ userCode: string; verificationUrl: string; deviceCode: string } | null>(null)
  const [pollingTokens, setPollingTokens] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showAccountMenu, setShowAccountMenu] = useState(false)
  const accountRef = useRef<HTMLDivElement>(null)

  const loadDashboardData = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/dashboard`)
      if (res.ok) {
        const data = await res.json()
        setDashboardData(data)

        // Load calendar events if connected
        if (data.googleCalendarConnected) {
          setLoadingCalendar(true)
          const now = new Date()
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
          const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)

          const calRes = await fetch(
            `/api/google-calendar/events?timeMin=${startOfMonth.toISOString()}&timeMax=${endOfMonth.toISOString()}`
          )
          if (calRes.ok) {
            const calData = await calRes.json()
            setCalendarEvents(calData.events || [])
          }
          setLoadingCalendar(false)
        }
      }
    } catch (e) {
      console.error('Failed to load dashboard data', e)
    }
  }, [workspaceId])

  const connectGoogleCalendar = async () => {
    try {
      const res = await fetch('/api/google-calendar/device-auth', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setDeviceAuth({
          userCode: data.userCode,
          verificationUrl: data.verificationUrl,
          deviceCode: data.deviceCode,
        })
        startPollingTokens(data.deviceCode, data.interval || 5)
      }
    } catch (e) {
      console.error('Failed to get device code', e)
    }
  }

  const copyUserCode = () => {
    if (deviceAuth) {
      navigator.clipboard.writeText(deviceAuth.userCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const startPollingTokens = async (deviceCode: string, interval: number) => {
    setPollingTokens(true)
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch('/api/google-calendar/poll-tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceCode }),
        })
        const data = await res.json()

        if (data.success) {
          clearInterval(pollInterval)
          setPollingTokens(false)
          setDeviceAuth(null)
          loadDashboardData()
        } else if (data.error === 'expired_token') {
          clearInterval(pollInterval)
          setPollingTokens(false)
          setDeviceAuth(null)
          alert('Authorization expired. Please try again.')
        }
        // For 'authorization_pending' or 'slow_down', just continue polling
      } catch (e) {
        console.error('Error polling for tokens', e)
      }
    }, interval * 1000)
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

  useEffect(() => {
    if (activeTab === 'dashboard') {
      loadDashboardData()
    }
  }, [activeTab, loadDashboardData]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadNotifications = async () => {
    try {
      const res = await fetch('/api/notifications')
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.notifications || [])
        setUnreadCount(data.notifications?.filter((n: Notification) => !n.read).length || 0)
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
      await fetch(`/api/notifications/${notificationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_read' }),
      })
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
      router.push(`/workspace/${workspaceId}?role=resident`)
    } else {
      // Go to workspace selection for helper view
      router.push('/select-workspace')
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

  const isResidentView = roleParam === 'resident'
  const userIsGuardian = workspace.role === 'guardian'

  return (
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
                  <div ref={notificationRef} className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50 max-h-96 overflow-y-auto">
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
                  {workspace.user?.name?.charAt(0).toUpperCase() || 'U'}
                </button>

                {showAccountMenu && (
                  <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
                    <div className="p-4 border-b border-gray-200">
                      <div className="flex items-center space-x-3">
                        <div className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center font-semibold text-lg">
                          {workspace.user?.name?.charAt(0).toUpperCase() || 'U'}
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">{workspace.user?.name || 'User'}</p>
                          <p className="text-sm text-gray-500">{workspace.user?.email || ''}</p>
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
            {isResidentView && (
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
            <div className="grid md:grid-cols-4 gap-6 mb-8">
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className={`text-3xl font-bold mb-2 ${dashboardData?.ringStatus === 'connected' ? 'text-green-600' : 'text-gray-400'}`}>
                  {dashboardData?.ringStatus === 'connected' ? 'Connected' : 'Not Connected'}
                </div>
                <div className="text-gray-600">Ring Doorbell Status</div>
              </div>
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="text-3xl font-bold text-green-600 mb-2">
                  {dashboardData?.pendingAlerts ?? 0}
                </div>
                <div className="text-gray-600">Pending Alerts</div>
              </div>
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="text-3xl font-bold text-purple-600 mb-2">
                  {dashboardData?.scheduledVisits ?? 0}
                </div>
                <div className="text-gray-600">Scheduled Visits Today</div>
              </div>
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="text-3xl font-bold text-orange-600 mb-2">
                  {dashboardData?.activePasses ?? 0}
                </div>
                <div className="text-gray-600">Active Visitor Passes</div>
              </div>
            </div>

            {/* Google Calendar */}
            <div className="bg-white rounded-lg shadow-md p-6 mb-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Google Calendar</h3>
                {!dashboardData?.googleCalendarConnected && !deviceAuth && (
                  <button
                    onClick={connectGoogleCalendar}
                    className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors text-sm"
                  >
                    Connect Calendar
                  </button>
                )}
              </div>

              {deviceAuth ? (
                <div className="text-center py-8">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-4">
                    <h4 className="text-lg font-semibold text-blue-900 mb-2">Connect Your Google Calendar</h4>
                    <p className="text-blue-800 mb-4">
                      Visit <a href={deviceAuth.verificationUrl} target="_blank" rel="noopener noreferrer" className="underline font-medium">{deviceAuth.verificationUrl}</a>
                      {' '}and enter this code:
                    </p>
                    <div className="bg-white border-2 border-blue-300 rounded-lg p-4 mb-4 flex items-center justify-between">
                      <span className="text-3xl font-mono font-bold tracking-widest text-blue-900">
                        {deviceAuth.userCode}
                      </span>
                      <button
                        onClick={copyUserCode}
                        className="ml-4 p-2 text-blue-600 hover:text-blue-700 hover:bg-blue-100 rounded-md transition-colors"
                        title="Copy code"
                      >
                        {copied ? (
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        )}
                      </button>
                    </div>
                    {pollingTokens && (
                      <p className="text-sm text-blue-700">Waiting for authorization...</p>
                    )}
                  </div>
                </div>
              ) : !dashboardData?.googleCalendarConnected ? (
                <div className="text-center py-8 text-gray-500">
                  <svg className="w-12 h-12 mx-auto mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p>Connect your Google Calendar to view and manage events</p>
                </div>
              ) : loadingCalendar ? (
                <div className="text-center py-8 text-gray-500">
                  <p>Loading calendar events...</p>
                </div>
              ) : calendarEvents.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>No upcoming events this month</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {calendarEvents.map((event) => (
                    <div key={event.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
                      <h4 className="font-medium text-gray-900">{event.summary || 'No title'}</h4>
                      {event.description && (
                        <p className="text-sm text-gray-600 mt-1">{event.description}</p>
                      )}
                      <p className="text-sm text-gray-500 mt-2">
                        {event.start.dateTime
                          ? new Date(event.start.dateTime).toLocaleString()
                          : new Date(event.start.date || '').toLocaleDateString()}
                        {' - '}
                        {event.end.dateTime
                          ? new Date(event.end.dateTime).toLocaleString()
                          : new Date(event.end.date || '').toLocaleDateString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {isResidentView && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
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

        {activeTab === 'helpers' && isResidentView && (
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
                {isResidentView
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

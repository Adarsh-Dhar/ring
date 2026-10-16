'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type NotificationType = 'helper_invite' | 'helper_invite_accepted' | 'helper_invite_rejected' | 'visitor_request' | 'alert'

interface Notification {
  id: string
  type: NotificationType | string
  title: string
  message: string
  createdAt: string
  read: boolean
}

export default function NotificationsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadNotifications()
  }, [])

  const loadNotifications = async () => {
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' })
      if (!res.ok) throw new Error(`Unable to load notifications (${res.status})`)
      const data = await res.json()
      setNotifications(data.notifications ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load notifications')
    } finally {
      setLoading(false)
    }
  }

  const getNotificationColor = (type: string) => {
    switch (type) {
      case 'helper_invite':
        return 'bg-blue-50 border-blue-200 text-blue-800'
      case 'helper_invite_accepted':
        return 'bg-green-50 border-green-200 text-green-800'
      case 'helper_invite_rejected':
        return 'bg-gray-50 border-gray-200 text-gray-800'
      case 'visitor_request':
        return 'bg-yellow-50 border-yellow-200 text-yellow-800'
      case 'alert':
        return 'bg-red-50 border-red-200 text-red-800'
      default:
        return 'bg-gray-50 border-gray-200 text-gray-800'
    }
  }

  const getNotificationDot = (type: string) => {
    switch (type) {
      case 'helper_invite':
        return 'bg-blue-500'
      case 'helper_invite_accepted':
        return 'bg-green-500'
      case 'helper_invite_rejected':
        return 'bg-gray-500'
      case 'visitor_request':
        return 'bg-yellow-500'
      case 'alert':
        return 'bg-red-500'
      default:
        return 'bg-gray-500'
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-slate-400">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <Link href="/select-role" className="text-gray-700 hover:text-gray-900">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <h1 className="text-xl font-bold text-gray-900">Notifications</h1>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Your Notifications</h2>
          <p className="text-gray-600 mt-1">
            {notifications.filter((n) => !n.read).length} unread
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
        )}

        {notifications.length === 0 && !error ? (
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No Notifications</h3>
            <p className="text-gray-600">You're all caught up!</p>
          </div>
        ) : (
          <div className="space-y-4">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={`border rounded-lg p-4 ${
                  notification.read ? 'bg-white' : 'bg-blue-50 border-blue-200'
                }`}
              >
                <div className="flex items-start space-x-3">
                  <div className={`w-3 h-3 rounded-full mt-1.5 ${getNotificationDot(notification.type)}`} />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-gray-900">{notification.title}</h3>
                      <span className="text-xs text-gray-500">
                        {new Date(notification.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-gray-600 mt-1">{notification.message}</p>
                    <div className="mt-2">
                      <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${getNotificationColor(notification.type)}`}>
                        {notification.type.replace(/_/g, ' ').toUpperCase()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

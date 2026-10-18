'use client'
import { useState, useEffect } from 'react'
import { getDaysInMonth, isToday } from '@/lib/calendarDateUtils'
import { useWorkspace } from '../WorkspaceContext'
import { useDashboardData } from '../useDashboardData'

interface CalendarEvent {
  id: string
  summary: string
  description?: string
  start: { dateTime?: string; date?: string }
  end: { dateTime?: string; date?: string }
}

export default function CalendarPage() {
  const { workspaceId } = useWorkspace()
  const { data: dashboardData } = useDashboardData(workspaceId)
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([])
  const [loadingCalendar, setLoadingCalendar] = useState(false)
  const [currentMonth, setCurrentMonth] = useState(new Date())

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentMonth(prev => {
      const newDate = new Date(prev)
      if (direction === 'prev') {
        newDate.setMonth(newDate.getMonth() - 1)
      } else {
        newDate.setMonth(newDate.getMonth() + 1)
      }
      return newDate
    })
  }

  const getEventsForDate = (date: Date): CalendarEvent[] => {
    const targetYear = date.getFullYear()
    const targetMonth = date.getMonth()
    const targetDay = date.getDate()

    return calendarEvents.filter(e => {
      let eventDate: Date | undefined
      if (e.start?.date) {
        // All-day event - parse the date string directly
        const [year, month, day] = e.start.date.split('-').map(Number)
        eventDate = new Date(year, month - 1, day) // month is 0-indexed in JS
      } else if (e.start?.dateTime) {
        // Time-based event - parse the datetime
        eventDate = new Date(e.start.dateTime)
      }

      if (!eventDate) return false

      return eventDate.getFullYear() === targetYear &&
             eventDate.getMonth() === targetMonth &&
             eventDate.getDate() === targetDay
    })
  }

  // Load events when calendar is connected and month changes
  useEffect(() => {
    if (!dashboardData?.googleCalendarConnected) return

    const loadEvents = async () => {
      setLoadingCalendar(true)
      try {
        const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1)
        const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0)
        const calRes = await fetch(
          `/api/google-calendar/events?timeMin=${startOfMonth.toISOString()}&timeMax=${endOfMonth.toISOString()}`
        )
        if (calRes.ok) {
          const calData = await calRes.json()
          setCalendarEvents(calData.events || [])
        }
      } catch (e) {
        console.error('Failed to load calendar events', e)
      } finally {
        setLoadingCalendar(false)
      }
    }

    loadEvents()
  }, [dashboardData?.googleCalendarConnected, currentMonth])

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-4">Calendar</h2>
      <div className="bg-white rounded-lg shadow-md p-6">
        {dashboardData?.googleCalendarConnected ? (
          <div>
            {/* Calendar Header with Navigation */}
            <div className="mb-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => navigateMonth('prev')}
                className="p-2 rounded-lg text-gray-600 hover:bg-gray-100"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h2 className="text-lg font-bold text-gray-900">
                {currentMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
              </h2>
              <button
                type="button"
                onClick={() => navigateMonth('next')}
                className="p-2 rounded-lg text-gray-600 hover:bg-gray-100"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            {/* Weekday Headers */}
            <div className="mb-2 grid grid-cols-7 gap-1">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="text-center text-xs font-semibold text-gray-500">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar Grid */}
            {loadingCalendar ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-gray-500">Loading calendar...</div>
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-1">
                {getDaysInMonth(currentMonth).map((date, index) => {
                  if (!date) {
                    return <div key={`empty-${index}`} className="h-20" />
                  }

                  const events = getEventsForDate(date)
                  const today = isToday(date)

                  return (
                    <div
                      key={date.toISOString()}
                      className={`min-h-20 rounded-lg border p-1 transition-colors ${
                        today
                          ? 'bg-blue-50 border-blue-300'
                          : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      <div className={`text-center text-xs font-medium ${
                        today ? 'text-blue-600' : 'text-gray-700'
                      }`}>
                        {date.getDate()}
                      </div>
                      <div className="mt-1 space-y-0.5">
                        {events.slice(0, 3).map((event, i) => (
                          <div
                            key={i}
                            className="truncate rounded px-1 py-0.5 text-[8px] font-medium bg-blue-100 text-blue-700"
                            title={event.summary}
                          >
                            {event.summary}
                          </div>
                        ))}
                        {events.length > 3 && (
                          <div className="text-[8px] text-gray-500">
                            +{events.length - 3} more
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <svg className="w-12 h-12 mx-auto mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p>No Google Calendar connected. Sign in with Google to view your calendar events.</p>
          </div>
        )}
      </div>
    </div>
  )
}

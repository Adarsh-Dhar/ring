import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail } from '@/lib/guard'
import { listCalendarEvents } from '@/lib/google-calendar/eventsApi'
import { getAuthedClientOrReason } from '@/lib/google-calendar/authClient'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const a = await authorize(req, 'user')
  if (a.ok === false) return a.res

  const userId = a.session!.userId
  const { searchParams } = new URL(req.url)
  const timeMin = searchParams.get('timeMin')
  const timeMax = searchParams.get('timeMax')

  console.log('[CALENDAR EVENTS] Fetching events for user:', userId, 'timeMin:', timeMin, 'timeMax:', timeMax)

  // Check if user has Google Calendar connected
  const authResult = await getAuthedClientOrReason(userId)
  if (authResult.ok === false) {
    console.log('[CALENDAR EVENTS] User does not have Google Calendar connected, returning empty events')
    return NextResponse.json({ events: [], connected: false })
  }

  const events = await listCalendarEvents(
    userId,
    timeMin ? new Date(timeMin) : undefined,
    timeMax ? new Date(timeMax) : undefined
  )

  console.log('[CALENDAR EVENTS] Result:', events)

  if (events === null) {
    return fail('Unable to fetch calendar events. Please try again.', 503)
  }

  return NextResponse.json({ events, connected: true })
}

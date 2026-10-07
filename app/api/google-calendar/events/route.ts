import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail } from '@/lib/guard'
import { listCalendarEvents } from '@/lib/google-calendar/eventsApi'

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

  const events = await listCalendarEvents(
    userId,
    timeMin ? new Date(timeMin) : undefined,
    timeMax ? new Date(timeMax) : undefined
  )

  console.log('[CALENDAR EVENTS] Result:', events)

  if (events === null) {
    return fail('Unable to fetch calendar events. Please connect your Google Calendar.', 503)
  }

  return NextResponse.json({ events })
}

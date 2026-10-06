import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail } from '@/lib/guard'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await authorize(req, 'any')
  if (a.ok === false) return a.res

  const userId = a.session!.userId
  const { id: householdId } = await params

  try {
    const db = getDb()

    // Check if user is a member of this household
    let membership = await db.membership.findFirst({
      where: {
        userId,
        householdId,
        consent: 'approved',
      },
    })

    // If not a member, check if user's name matches resident name and auto-create membership
    if (!membership) {
      const household = await db.household.findUnique({
        where: { id: householdId },
        select: { residentName: true },
      })

      const user = await db.user.findUnique({
        where: { id: userId },
        select: { name: true },
      })

      // Auto-create membership if user's name matches resident name (for the resident themselves)
      if (household && user && user.name === household.residentName) {
        const memberCount = await db.membership.count({ where: { householdId } })
        membership = await db.membership.create({
          data: {
            userId,
            householdId,
            role: 'guardian', // Give resident guardian-level access
            consent: 'approved',
            consentAt: new Date(),
            position: memberCount,
            tokenEpoch: 1,
            emoji: '👤',
          },
        })
      } else {
        return fail('You are not a member of this household.', 403)
      }
    }

    // Get Ring connection status
    const ringConnection = await db.ringConnection.findFirst({
      where: { householdId },
    })

    // Get pending cases (doorbell alerts that need response)
    const pendingCases = await db.case.count({
      where: {
        householdId,
        status: 'waiting',
      },
    })

    // Get scheduled visits for today
    const today = new Date()
    const startOfDay = new Date(today.setHours(0, 0, 0, 0))
    const endOfDay = new Date(today.setHours(23, 59, 59, 999))

    const scheduledVisits = await db.expectedVisit.count({
      where: {
        householdId,
        startsAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
    })

    // Get active visitor passes for today
    const activePasses = await db.pass.count({
      where: {
        householdId,
        windowStart: {
          lte: endOfDay,
        },
        windowEnd: {
          gte: startOfDay,
        },
        revokedAt: null,
      },
    })

    // Check if user has Google Calendar connected
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { googleRefreshToken: true },
    })

    return NextResponse.json({
      ringStatus: ringConnection ? 'connected' : 'not_connected',
      pendingAlerts: pendingCases,
      scheduledVisits: scheduledVisits,
      activePasses: activePasses,
      googleCalendarConnected: !!user?.googleRefreshToken,
    })
  } catch (e) {
    console.error('[DASHBOARD GET] Failed to load dashboard data', e)
    return fail('Unable to load dashboard data. Please try again.', 503)
  }
}

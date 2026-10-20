import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import { effectiveScore, compareForDashboard } from '@/lib/doorstep/collaborationController'
import { modeRank, type ControlMode } from '@/lib/doorstep/riskRules'

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
    const now = new Date()

    // Close expired cases before counting/displaying
    const expiredCases = await db.case.findMany({
      where: {
        householdId,
        status: 'waiting',
        closedAt: null,
        deadlineAt: { lte: now }, // Deadline has passed
      },
      select: { id: true },
    })

    for (const c of expiredCases) {
      await db.case.update({
        where: { id: c.id },
        data: {
          lifecycle: 'closed',
          closedAt: now,
          closedBy: 'system',
          closeReason: 'deadline_expired',
        },
      })
    }

    const pendingCasesCount = await db.case.count({
      where: {
        householdId,
        status: 'waiting',
        closedAt: null,
        deadlineAt: { gt: now }, // Only count cases that haven't expired yet
      },
    })

    // Get detailed pending cases for display
    const pendingCases = await db.case.findMany({
      where: {
        householdId,
        status: 'waiting',
        closedAt: null,
        deadlineAt: { gt: now }, // Only show cases that haven't expired yet
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        createdAt: true,
        eventType: true,
        kind: true,
        deadlineAt: true,
        helperIndex: true,
        riskLevel: true,
        riskScore: true,
        controlMode: true,
        lastEventAt: true,
        interrogationState: true,
      },
    })
    // Spec 5.2: order by S_eff, then event severity, then the most recent event.
    const ranked = pendingCases
      .map(c => ({ ...c, effectiveScore: effectiveScore(c.riskScore ?? 0, c.controlMode as ControlMode | null), eventSeverity: modeRank((c.controlMode as ControlMode | null) ?? 'ai_leads'), lastEventAt: (c.lastEventAt ?? c.createdAt).getTime() }))
      .sort(compareForDashboard)

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
      select: { googleRefreshToken: true, googleAccessToken: true },
    })

    return NextResponse.json({
      ringStatus: ringConnection ? 'connected' : 'not_connected',
      pendingAlerts: pendingCasesCount,
      pendingCases: ranked,
      scheduledVisits: scheduledVisits,
      activePasses: activePasses,
      googleCalendarConnected: !!(user?.googleRefreshToken || user?.googleAccessToken),
    })
  } catch (e) {
    console.error('[DASHBOARD GET] Failed to load dashboard data', e)
    return fail('Unable to load dashboard data. Please try again.', 503)
  }
}

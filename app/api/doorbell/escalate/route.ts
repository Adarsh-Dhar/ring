/**
 * POST /api/doorbell/escalate
 *
 * Escalate to the next helper in the chain (Section 7).
 * Advances the chain through the same claim path and creates a new request.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { claimEscalationStep } from '@/lib/db/cases'
import { createHelperRequest, type HelperRequestKind } from '@/lib/doorstep/helperRequests'
import { writeAudit, audit } from '@/lib/doorstep/audit'
import { getApprovedMemberships } from '@/lib/db/memberships'
import { buildHelperRequest, formatPushNotification, formatSms } from '@/lib/doorstep/requestContent'
import { contactHelper } from '@/lib/doorstep/contactLog'
import { getPreferences } from '@/lib/db/preferences'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { caseId } = body

    if (!caseId) {
      return NextResponse.json({ error: 'Missing caseId' }, { status: 400 })
    }

    const db = getDb()
    const c = await db.case.findUnique({
      where: { id: caseId },
      select: { householdId: true, status: true, helperIndex: true, chain: true, riskScore: true, controlMode: true },
    })

    if (!c) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }

    if (c.status !== 'waiting') {
      return NextResponse.json({ error: 'Case is not waiting' }, { status: 400 })
    }

    const userId = req.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Claim the escalation step
    const claimed = await claimEscalationStep(caseId, c.helperIndex)
    if (!claimed) {
      return NextResponse.json({ error: 'Escalation step already claimed' }, { status: 409 })
    }

    // Get the next helper in the chain
    const chain = (c.chain as string[]) || []
    const nextIndex = c.helperIndex + 1
    if (nextIndex >= chain.length) {
      return NextResponse.json({ error: 'No more helpers in chain' }, { status: 400 })
    }

    const nextMembershipId = chain[nextIndex]
    const memberships = await getApprovedMemberships(c.householdId)
    const nextMembership = memberships.find(m => m.id === nextMembershipId)

    if (!nextMembership) {
      return NextResponse.json({ error: 'Next helper not found' }, { status: 404 })
    }

    // Create a new request
    const kind: HelperRequestKind = 'takeover'
    const requestId = await createHelperRequest({
      caseId,
      membershipId: nextMembershipId,
      kind,
      round: Math.floor(c.helperIndex / chain.length) + 1,
    })

    // Build and send notification
    const prefs = await getPreferences(c.householdId)
    const riskObservations = (c as any).riskObservations || []
    const observations = (riskObservations as any).observations || []

    const content = buildHelperRequest(
      observations,
      (c.controlMode as any) || 'ai_leads',
      c.riskScore || 0,
      undefined,
      prefs
    )
    const pushNotif = formatPushNotification(content)
    const smsBody = formatSms(content)

    await contactHelper(caseId, nextMembershipId, { push: pushNotif, sms: smsBody }, requestId)

    await writeAudit(caseId, audit.escalate(userId, nextMembershipId))

    return NextResponse.json({ success: true, nextMembershipId })
  } catch (e) {
    console.error('[ESCALATE API]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

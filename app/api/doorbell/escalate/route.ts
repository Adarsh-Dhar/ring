/**
 * POST /api/doorbell/escalate
 *
 * Escalate to the next helper in the chain (Section 7).
 * Advances the chain through the same claim path and creates a new request.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { claimEscalationStep } from '@/lib/db/cases'
import { createHelperRequest, type HelperRequestKind } from '@/lib/doorstep/helperRequests'
import { writeAudit, audit } from '@/lib/doorstep/audit'
import { getApprovedMemberships } from '@/lib/db/memberships'
import { buildHelperRequest, formatPushNotification, formatSms } from '@/lib/doorstep/requestContent'
import { contactHelper } from '@/lib/doorstep/contactLog'
import { getPreferences } from '@/lib/db/preferences'
import { authorize, fail, parse } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Body = z.object({
  caseId: z.string().min(1).max(80),
})

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'helper')
  if (a.ok === false) return a.res

  const p = await parse(req, Body)
  if (p.ok === false) return p.res

  const { caseId } = p.data

  const householdId = a.session!.householdId
  const membershipId = a.session!.membershipId!

  const db = getDb()
  const c = await db.case.findUnique({
    where: { id: caseId, householdId },
    select: { householdId: true, status: true, helperIndex: true, chain: true, riskScore: true, controlMode: true },
  })

  if (!c) {
    return fail('Case not found', 404)
  }

  if (c.status !== 'waiting') {
    return fail('Case is not waiting', 400)
  }

  // Claim the escalation step
  const claimed = await claimEscalationStep(caseId, c.helperIndex)
  if (!claimed) {
    return fail('Escalation step already claimed', 409)
  }

  // Get the next helper in the chain
  const chain = (c.chain as string[]) || []
  const nextIndex = c.helperIndex + 1
  if (nextIndex >= chain.length) {
    return fail('No more helpers in chain', 400)
  }

  const nextMembershipId = chain[nextIndex]
  const memberships = await getApprovedMemberships(c.householdId)
  const nextMembership = memberships.find(m => m.id === nextMembershipId)

  if (!nextMembership) {
    return fail('Next helper not found', 404)
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

  await contactHelper(caseId, nextMembershipId, { push: pushNotif, sms: smsBody }, requestId.id)

  await writeAudit(caseId, audit.escalate(membershipId, nextMembershipId))

  return NextResponse.json({ success: true, nextMembershipId })
}

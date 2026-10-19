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
import { DEFAULT_ESCALATION_SECONDS } from '@/lib/doorbell/config'
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
  const c = await db.case.findFirst({
    where: { id: caseId, householdId },
    select: { id: true, householdId: true, status: true, helperIndex: true, chain: true, deadlineAt: true, lane: true, log: true, riskScore: true, controlMode: true, riskObservations: true },
  })

  if (!c) {
    return fail('Case not found', 404)
  }

  if (c.status !== 'waiting') {
    return fail('Case is not waiting', 400)
  }

  const chain = ((c.chain as unknown) as string[] | null) ?? []
  if (!chain.includes(membershipId)) {
    return fail('You are not a helper on this case', 403)
  }

  // Work out the next helper BEFORE claiming, so a failed lookup never leaves the case advanced with nobody asked.
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

  // Claim the escalation step (compare-and-set), so two helpers pressing the button cannot both advance the case.
  const household = await db.household.findUnique({ where: { id: c.householdId }, select: { timeoutSec: true } })
  const timeoutSec = household?.timeoutSec || DEFAULT_ESCALATION_SECONDS
  const now = Date.now()
  const log = [...(((c.log as unknown) as { t: number; msg: string }[] | null) ?? []), { t: now, msg: `Escalated to the next helper by a helper.` }]
  const claimed = await claimEscalationStep(
    caseId,
    { helperIndex: c.helperIndex, deadlineAt: c.deadlineAt.getTime(), lane: c.lane },
    { helperIndex: nextIndex, deadlineAt: now + timeoutSec * 1000, status: 'waiting', lane: c.lane },
    log,
  )
  if (!claimed) {
    return fail('Escalation step already claimed', 409)
  }

  // Create a new request
  const kind: HelperRequestKind = 'takeover'
  const created = await createHelperRequest({
    caseId,
    membershipId: nextMembershipId,
    kind,
    round: Math.floor(c.helperIndex / chain.length) + 1,
  })
  if (!created) {
    return fail('A takeover request is already open for the next helper', 409)
  }

  // Build and send notification
  const prefs = await getPreferences(c.householdId)
  const observations = (((c.riskObservations as any)?.observations) as any[]) || []

  const content = buildHelperRequest(
    observations,
    (c.controlMode as any) || 'ai_leads',
    c.riskScore || 0,
    undefined,
    prefs,
    undefined,
    caseId
  )
  const pushNotif = formatPushNotification(content)
  const smsBody = formatSms(content)

  await contactHelper(caseId, nextMembershipId, { push: pushNotif, sms: smsBody }, created.id)

  await writeAudit(caseId, audit.escalate(membershipId, nextMembershipId))

  return NextResponse.json({ success: true, nextMembershipId })
}

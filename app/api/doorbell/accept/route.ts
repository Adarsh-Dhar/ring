/**
 * POST /api/doorbell/accept
 *
 * Accept a helper request (Section 7).
 * This is the helper's response to the request, not a verdict on the visitor.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { getLatestRequest, markAcked, markAccepted, markDeclined } from '@/lib/doorstep/helperRequests'
import { writeAudit, audit } from '@/lib/doorstep/audit'
import { authorize, fail, parse } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Body = z.object({
  caseId: z.string().min(1).max(80),
  membershipId: z.string().min(1).max(80),
  accept: z.boolean(),
})

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'helper')
  if (a.ok === false) return a.res

  const p = await parse(req, Body)
  if (p.ok === false) return p.res

  const { caseId, membershipId, accept } = p.data

  const householdId = a.session!.householdId
  const callerMembershipId = a.session!.membershipId!

  // Ownership check: caller must be the membershipId in the request
  if (membershipId !== callerMembershipId) {
    return fail('Cannot accept/decline on behalf of another helper', 403)
  }

  const db = getDb()
  const c = await db.case.findFirst({
    where: { id: caseId, householdId },
    select: { householdId: true, status: true },
  })

  if (!c) {
    return fail('Case not found', 404)
  }

  // 'no_response' cases can still be picked up: that is exactly when a late helper steps in.
  if (c.status !== 'waiting' && c.status !== 'no_response') {
    return fail('Case is closed', 400)
  }

  // Get the latest request for this membership
  const request = await getLatestRequest(caseId, membershipId, 'approval')
  if (!request) {
    return fail('No pending request', 404)
  }

  // Mark as accepted or declined
  // Answering a request implies the helper has seen it. markAcked is compare-and-set and a no-op if already acked.
  await markAcked(request.id)

  let success = false
  if (accept) {
    success = await markAccepted(request.id)
    if (success) await writeAudit(caseId, audit.helperResponse(membershipId, request.id, 'accepted'))
  } else {
    success = await markDeclined(request.id)
    if (success) await writeAudit(caseId, audit.helperResponse(membershipId, request.id, 'declined'))
  }

  if (!success) {
    return fail('Request not in acked state', 400)
  }

  return NextResponse.json({ success: true })
}

/**
 * POST /api/doorbell/takeover
 *
 * Take over or release control of a conversation (Section 7).
 * While a helper owns the conversation, the AI stays silent.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { writeAudit, audit } from '@/lib/doorstep/audit'
import { authorize, fail, parse } from '@/lib/guard'
import { claimConversation, releaseConversation } from '@/lib/doorstep/conversationOwner'
import { getRequestsForCase, markAcked, markAccepted, OPEN_REQUEST_STATES } from '@/lib/doorstep/helperRequests'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Body = z.object({
  caseId: z.string().min(1).max(80),
  action: z.enum(['takeover', 'release']),
})

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'helper')
  if (a.ok === false) return a.res

  const p = await parse(req, Body)
  if (p.ok === false) return p.res

  const { caseId, action } = p.data

  const householdId = a.session!.householdId
  const membershipId = a.session!.membershipId!

  const db = getDb()
  const c = await db.case.findUnique({
    where: { id: caseId, householdId },
    select: { householdId: true, status: true, conversationOwner: true },
  })

  if (!c) {
    return fail('Case not found', 404)
  }

  if (c.status !== 'waiting') {
    return fail('Case is not waiting', 400)
  }

  if (action === 'takeover') {
    const r = await claimConversation(caseId, householdId, membershipId)
    if (!r.ok) return fail('Conversation already owned', 409)
    await writeAudit(caseId, audit.takeover(membershipId))
    // Taking over is the helper accepting responsibility: record it on their open request (never inferred from a visitor answer).
    const open = (await getRequestsForCase(caseId)).filter((q) => q.membershipId === membershipId && (q.kind === 'takeover' || q.kind === 'risk_decision') && OPEN_REQUEST_STATES.includes(q.state))
    for (const q of open) { await markAcked(q.id); await markAccepted(q.id) }
  } else {
    if (!(await releaseConversation(caseId, householdId, membershipId))) {
      return fail('Not the conversation owner', 403)
    }
    await writeAudit(caseId, audit.release(membershipId))
  }

  return NextResponse.json({ success: true })
}

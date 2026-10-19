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
    if (c.conversationOwner) {
      return fail('Conversation already owned', 400)
    }
    await db.case.update({
      where: { id: caseId },
      data: { conversationOwner: membershipId },
    })
    await writeAudit(caseId, audit.takeover(membershipId, c.conversationOwner || undefined))
  } else {
    if (c.conversationOwner !== membershipId) {
      return fail('Not the conversation owner', 400)
    }
    await db.case.update({
      where: { id: caseId },
      data: { conversationOwner: null },
    })
    await writeAudit(caseId, audit.release(membershipId))
  }

  return NextResponse.json({ success: true })
}

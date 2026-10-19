/**
 * POST /api/doorbell/accept
 *
 * Accept a helper request (Section 7).
 * This is the helper's response to the request, not a verdict on the visitor.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { getLatestRequest, markAccepted, markDeclined } from '@/lib/doorstep/helperRequests'
import { writeAudit, audit } from '@/lib/doorstep/audit'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { caseId, membershipId, accept } = body

    if (!caseId || !membershipId || accept === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const db = getDb()
    const c = await db.case.findUnique({
      where: { id: caseId },
      select: { householdId: true, status: true },
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

    // Get the latest request for this membership
    const request = await getLatestRequest(caseId, membershipId, 'approval')
    if (!request) {
      return NextResponse.json({ error: 'No pending request' }, { status: 404 })
    }

    // Mark as accepted or declined
    let success = false
    if (accept) {
      success = await markAccepted(request.id)
      if (success) {
        await writeAudit(caseId, audit.contactAttempt('accept', membershipId, 'sent'))
      }
    } else {
      success = await markDeclined(request.id)
      if (success) {
        await writeAudit(caseId, audit.contactAttempt('decline', membershipId, 'sent'))
      }
    }

    if (!success) {
      return NextResponse.json({ error: 'Request not in acked state' }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('[ACCEPT API]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

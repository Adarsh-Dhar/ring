/**
 * POST /api/doorbell/takeover
 *
 * Take over or release control of a conversation (Section 7).
 * While a helper owns the conversation, the AI stays silent.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { writeAudit, audit } from '@/lib/doorstep/audit'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { caseId, action } = body // action: 'takeover' or 'release'

    if (!caseId || !action) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (action !== 'takeover' && action !== 'release') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const db = getDb()
    const c = await db.case.findUnique({
      where: { id: caseId },
      select: { householdId: true, status: true, conversationOwner: true },
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

    if (action === 'takeover') {
      if (c.conversationOwner) {
        return NextResponse.json({ error: 'Conversation already owned' }, { status: 400 })
      }
      await db.case.update({
        where: { id: caseId },
        data: { conversationOwner: userId },
      })
      await writeAudit(caseId, audit.takeover(userId, c.conversationOwner || undefined))
    } else {
      if (c.conversationOwner !== userId) {
        return NextResponse.json({ error: 'Not the conversation owner' }, { status: 400 })
      }
      await db.case.update({
        where: { id: caseId },
        data: { conversationOwner: null },
      })
      await writeAudit(caseId, audit.release(userId))
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('[TAKEOVER API]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

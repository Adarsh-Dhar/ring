import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail } from '@/lib/guard'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await authorize(req, 'user')
  if (a.ok === false) return a.res

  const userId = a.session!.userId
  const { id: workspaceId } = await params

  try {
    const db = getDb()

    const membership = await db.membership.findFirst({
      where: { userId, householdId: workspaceId },
    })

    if (!membership) {
      return fail('You are not a helper in this workspace', 404)
    }

    // A workspace must always keep at least one approved helper.
    if (membership.consent === 'approved') {
      const approved = await db.membership.count({ where: { householdId: workspaceId, consent: 'approved' } })
      if (approved <= 1) {
        return fail('You are the only helper in this workspace. Add another helper first, or delete the workspace.', 400)
      }
    }

    await db.membership.delete({ where: { id: membership.id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[LEAVE WORKSPACE] Failed to leave workspace', e)
    return fail('Unable to leave workspace. Please try again.', 503)
  }
}

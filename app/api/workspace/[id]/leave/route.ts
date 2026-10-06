import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail } from '@/lib/guard'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await authorize(req, 'any')
  if (a.ok === false) return a.res

  const userId = a.session!.userId
  const { id: workspaceId } = await params

  try {
    const db = getDb()

    // Find all memberships for this user in this household
    const memberships = await db.membership.findMany({
      where: {
        userId,
        householdId: workspaceId,
      },
    })

    if (memberships.length === 0) {
      return fail('You are not a member of this workspace', 404)
    }

    // If user has a helper membership, delete it (keep guardian membership if exists)
    const helperMembership = memberships.find(m => m.role === 'helper')
    if (helperMembership) {
      await db.membership.delete({
        where: { id: helperMembership.id },
      })
      return NextResponse.json({ ok: true })
    }

    // If user only has a guardian membership, don't allow leaving
    if (memberships.length === 1 && memberships[0].role === 'guardian') {
      return fail('Guardians cannot leave their own household. Please delete the household instead.', 400)
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[LEAVE WORKSPACE] Failed to leave workspace', e)
    return fail('Unable to leave workspace. Please try again.', 503)
  }
}

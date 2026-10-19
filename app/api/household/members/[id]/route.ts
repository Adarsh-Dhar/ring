/**
 * PATCH /api/household/members/[id]
 *
 * Update membership settings including tier (Section 7).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { getMembership } from '@/lib/db/memberships'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json()
    const { tier } = body

    if (!tier) {
      return NextResponse.json({ error: 'Missing tier' }, { status: 400 })
    }

    if (!['primary', 'backup', 'third'].includes(tier)) {
      return NextResponse.json({ error: 'Invalid tier' }, { status: 400 })
    }

    const membership = await getMembership(params.id)
    if (!membership) {
      return NextResponse.json({ error: 'Membership not found' }, { status: 404 })
    }

    const db = getDb()
    await db.membership.update({
      where: { id: params.id },
      data: { tier },
    })

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('[MEMBERSHIP UPDATE]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

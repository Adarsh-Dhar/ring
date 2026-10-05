import { NextRequest, NextResponse } from 'next/server'
import { authorize, isAuthOk } from '@/lib/guard'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/auth/me - Get current user info
 */
export async function GET(request: NextRequest) {
  const a = await authorize(request, 'guardian')
  if (!isAuthOk(a)) return a.res

  try {
    const db = getDb()
    const membership = await db.membership.findUnique({
      where: { id: a.session.membershipId },
      include: { user: true },
    })

    if (!membership) {
      return NextResponse.json({ error: 'Membership not found' }, { status: 404 })
    }

    return NextResponse.json({
      userId: membership.userId,
      membershipId: membership.id,
      name: membership.user.name,
      email: membership.user.email,
      phone: membership.user.phone,
    })
  } catch (error: any) {
    console.error('[AUTH ME] Failed to get user info:', error)
    return NextResponse.json({ error: error?.message || 'Failed to get user info' }, { status: 500 })
  }
}

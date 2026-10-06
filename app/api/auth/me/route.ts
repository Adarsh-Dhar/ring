import { NextRequest, NextResponse } from 'next/server'
import { authorize, isAuthOk } from '@/lib/guard'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/auth/me - Get current user info
 */
export async function GET(request: NextRequest) {
  const a = await authorize(request, 'any')
  if (!isAuthOk(a)) return a.res

  try {
    const db = getDb()
    const user = await db.user.findUnique({
      where: { id: a.session.userId },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        createdAt: user.createdAt.toISOString(),
      },
    })
  } catch (error: any) {
    console.error('[AUTH ME] Failed to get user info:', error)
    return NextResponse.json({ error: error?.message || 'Failed to get user info' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail } from '@/lib/guard'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const a = await authorize(req, 'any')
  if (a.ok === false) return a.res

  const userId = a.session!.userId

  try {
    const db = getDb()
    const memberships = await db.membership.findMany({
      where: {
        userId,
        consent: 'approved',
      },
      include: {
        household: {
          select: {
            residentName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    })

    return NextResponse.json({
      memberships: memberships.map((m) => ({
        id: m.id,
        householdId: m.householdId,
        role: m.role,
        residentName: m.household.residentName,
      })),
    })
  } catch (e) {
    console.error('[USER HOUSEHOLDS] Failed to load households', e)
    return fail('Unable to load your households. Please try again.', 503)
  }
}

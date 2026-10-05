import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail } from '@/lib/guard'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await authorize(req, 'user')
  if (a.ok === false) return a.res

  const userId = a.session!.userId
  const { id: householdId } = await params

  try {
    const db = getDb()

    // Check if user is a member of this household
    const membership = await db.membership.findFirst({
      where: {
        userId,
        householdId,
        consent: 'approved',
      },
      include: {
        household: {
          select: {
            residentName: true,
            requireResidentOk: true,
            plannedMode: true,
          },
        },
      },
    })

    if (!membership) {
      return fail('You are not a member of this household.', 403)
    }

    return NextResponse.json({
      id: householdId,
      residentName: membership.household.residentName,
      role: membership.role,
      requireResidentOk: membership.household.requireResidentOk,
      plannedMode: membership.household.plannedMode,
    })
  } catch (e) {
    console.error('[WORKSPACE GET] Failed to load workspace', e)
    return fail('Unable to load workspace. Please try again.', 503)
  }
}

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

    // Get user info
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
      },
    })

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
      return fail('You are not a member of this household. Please accept an invite to join.', 403)
    }

    // Check if user has a helper membership (they might also be a guardian)
    const helperMembership = await db.membership.findFirst({
      where: {
        userId,
        householdId,
        role: 'helper',
        consent: 'approved',
      },
    })

    return NextResponse.json({
      id: householdId,
      residentName: membership.household.residentName,
      role: membership.role,
      requireResidentOk: membership.household.requireResidentOk,
      plannedMode: membership.household.plannedMode,
      hasHelperMembership: !!helperMembership,
      user: user ? { name: user.name, email: user.email } : null,
    })
  } catch (e) {
    console.error('[WORKSPACE GET] Failed to load workspace', e)
    return fail('Unable to load workspace. Please try again.', 503)
  }
}

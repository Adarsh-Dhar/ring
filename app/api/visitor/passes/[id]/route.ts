import { NextRequest, NextResponse } from 'next/server'
import { authorize, isAuthOk } from '@/lib/guard'
import { getPassById, revokePass } from '@/lib/visitor/pass'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/visitor/passes/[id] - Get a specific pass
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await authorize(request, 'guardian')
  if (!isAuthOk(a)) return a.res
  try {
    const { id } = await params
    const pass = await getPassById(id, a.session.householdId)

    if (!pass) {
      return NextResponse.json({ error: 'Pass not found' }, { status: 404 })
    }

    return NextResponse.json({ pass })
  } catch (error) {
    console.error('[PASSES] Error getting pass:', error)
    return NextResponse.json({ error: 'Failed to get pass' }, { status: 500 })
  }
}

/**
 * DELETE /api/visitor/passes/[id] - Revoke a pass
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await authorize(request, 'guardian')
  if (!isAuthOk(a)) return a.res
  try {
    const { id } = await params
    const pass = await revokePass(id, a.session.householdId)

    if (!pass) {
      return NextResponse.json({ error: 'Pass not found' }, { status: 404 })
    }

    return NextResponse.json({ pass })
  } catch (error) {
    console.error('[PASSES] Error revoking pass:', error)
    return NextResponse.json({ error: 'Failed to revoke pass' }, { status: 500 })
  }
}

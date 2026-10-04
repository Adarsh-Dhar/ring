import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
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
  try {
    const { id } = await params

    // Verify session
    const session = request.cookies.get('session')?.value
    const token = verifyToken(session)

    if (!token.ok || !token.data.householdId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const pass = await getPassById(id, token.data.householdId)

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
  try {
    const { id } = await params

    // Verify session
    const session = request.cookies.get('session')?.value
    const token = verifyToken(session)

    if (!token.ok || !token.data.householdId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const pass = await revokePass(id, token.data.householdId)

    if (!pass) {
      return NextResponse.json({ error: 'Pass not found' }, { status: 404 })
    }

    return NextResponse.json({ pass })
  } catch (error) {
    console.error('[PASSES] Error revoking pass:', error)
    return NextResponse.json({ error: 'Failed to revoke pass' }, { status: 500 })
  }
}

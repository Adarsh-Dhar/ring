import { NextRequest, NextResponse } from 'next/server'
import { authorize, isAuthOk } from '@/lib/guard'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/auth/passkey - List passkeys for the current user
 */
export async function GET(request: NextRequest) {
  const a = await authorize(request, 'guardian')
  if (!isAuthOk(a)) return a.res

  try {
    const db = getDb()
    const passkeys = await db.passkey.findMany({
      where: { memberId: a.session.membershipId },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ passkeys })
  } catch (error: any) {
    console.error('[PASSKEY] Failed to list passkeys:', error)
    return NextResponse.json({ error: error?.message || 'Failed to list passkeys' }, { status: 500 })
  }
}

/**
 * DELETE /api/auth/passkey - Delete a passkey
 */
export async function DELETE(request: NextRequest) {
  const a = await authorize(request, 'guardian')
  if (!isAuthOk(a)) return a.res

  try {
    const body = await request.json()
    const { id } = body

    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 })
    }

    const db = getDb()
    const passkey = await db.passkey.findUnique({
      where: { id },
    })

    if (!passkey) {
      return NextResponse.json({ error: 'Passkey not found' }, { status: 404 })
    }

    if (passkey.memberId !== a.session.membershipId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await db.passkey.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[PASSKEY] Failed to delete passkey:', error)
    return NextResponse.json({ error: error?.message || 'Failed to delete passkey' }, { status: 500 })
  }
}

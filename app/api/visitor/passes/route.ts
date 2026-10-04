import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { createPass, getPassesForHousehold } from '@/lib/visitor/pass'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const createPassSchema = z.object({
  visitorName: z.string().min(1).max(100),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  recurrence: z.any().optional(),
  deviceId: z.string().optional(),
})

/**
 * GET /api/visitor/passes - List all passes for the household
 */
export async function GET(request: NextRequest) {
  try {
    // Verify session
    const session = request.cookies.get('session')?.value
    const token = verifyToken(session)

    if (!token.ok || !token.data.householdId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const passes = await getPassesForHousehold(token.data.householdId)
    return NextResponse.json({ passes })
  } catch (error) {
    console.error('[PASSES] Error listing passes:', error)
    return NextResponse.json({ error: 'Failed to list passes' }, { status: 500 })
  }
}

/**
 * POST /api/visitor/passes - Create a new pass
 */
export async function POST(request: NextRequest) {
  try {
    // Verify session
    const session = request.cookies.get('session')?.value
    const token = verifyToken(session)

    if (!token.ok || !token.data.householdId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const parsed = createPassSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.issues }, { status: 400 })
    }

    const pass = await createPass({
      householdId: token.data.householdId,
      visitorName: parsed.data.visitorName,
      windowStart: new Date(parsed.data.windowStart),
      windowEnd: new Date(parsed.data.windowEnd),
      recurrence: parsed.data.recurrence,
      deviceId: parsed.data.deviceId,
    })

    return NextResponse.json({ pass }, { status: 201 })
  } catch (error) {
    console.error('[PASSES] Error creating pass:', error)
    return NextResponse.json({ error: 'Failed to create pass' }, { status: 500 })
  }
}

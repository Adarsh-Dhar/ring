import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { getPassById, isPassValid, recordPassUsage } from '@/lib/visitor/pass'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const arrivalSchema = z.object({
  passId: z.string(),
  deviceId: z.string(),
})

/**
 * POST /api/visitor/arrival - Record a visitor arrival using a pass
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = arrivalSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.issues }, { status: 400 })
    }

    // Verify session (device-based or household-based)
    const session = request.cookies.get('session')?.value
    const token = verifyToken(session)

    if (!token.ok || !token.data.householdId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get the pass
    const pass = await getPassById(parsed.data.passId, token.data.householdId)

    if (!pass) {
      return NextResponse.json({ error: 'Pass not found' }, { status: 404 })
    }

    // Check if pass is valid
    if (!isPassValid(pass)) {
      return NextResponse.json({ error: 'Pass is not valid (expired, revoked, or outside time window)' }, { status: 400 })
    }

    // Check device binding if applicable
    if (pass.deviceId && pass.deviceId !== parsed.data.deviceId) {
      return NextResponse.json({ error: 'Pass is bound to a different device' }, { status: 403 })
    }

    // Record usage
    await recordPassUsage(parsed.data.passId, parsed.data.deviceId)

    return NextResponse.json({ success: true, message: 'Arrival recorded' })
  } catch (error) {
    console.error('[ARRIVAL] Error recording arrival:', error)
    return NextResponse.json({ error: 'Failed to record arrival' }, { status: 500 })
  }
}

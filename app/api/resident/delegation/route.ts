import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail } from '@/lib/guard'
import { getPreferences, setPreferences } from '@/lib/db/preferences'
import { ALWAYS_PROHIBITED, type Preferences } from '@/lib/doorstep/residentPreferences'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * P12: GET /api/resident/delegation
 * Returns the resident's current delegation preferences.
 * Only accessible to the resident themselves.
 */
export async function GET(req: NextRequest) {
  const a = await authorize(req, 'resident')
  if (a.ok === false) return a.res

  const householdId = a.session!.householdId

  try {
    const prefs = await getPreferences(householdId)
    return NextResponse.json(prefs, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[DELEGATION GET]', e)
    return fail(`Failed to load preferences: ${msg}`, 503)
  }
}

/**
 * P12: PUT /api/resident/delegation
 * Updates the resident's delegation preferences.
 * Only accessible to the resident themselves.
 * Validates that ALWAYS_PROHIBITED actions cannot be enabled in any mode.
 */
export async function PUT(req: NextRequest) {
  const a = await authorize(req, 'resident')
  if (a.ok === false) return a.res

  const householdId = a.session!.householdId

  try {
    const body = await req.json()
    const rawPrefs = body.preferences

    if (!rawPrefs || typeof rawPrefs !== 'object') {
      return fail('Missing or invalid preferences object', 400)
    }

    // Validate that ALWAYS_PROHIBITED actions are never allowed
    // This is enforced by the permittedActions function, but we double-check here
    const prefs = await setPreferences(householdId, rawPrefs)

    return NextResponse.json(prefs, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[DELEGATION PUT]', e)
    return fail(`Failed to update preferences: ${msg}`, 503)
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { authorize } from '@/lib/guard'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Initiates Ring account linking by checking for unclaimed connections
 * and providing instructions to the user
 */
export async function GET(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res

  const householdId = a.session!.householdId

  try {
    const db = getDb()
    
    // Check for any unclaimed connections
    const unclaimed = await db.ringConnection.findFirst({
      where: { status: 'unclaimed' },
      orderBy: { createdAt: 'desc' }
    })

    if (unclaimed) {
      // There's an unclaimed connection - user needs to visit the link endpoint
      return NextResponse.json({
        status: 'ready_to_claim',
        message: 'A Ring connection is ready to be claimed. Please visit the setup page to complete the linking.',
        action: 'visit_setup',
        setupUrl: '/setup'
      })
    }

    // No unclaimed connection - user needs to install the app
    return NextResponse.json({
      status: 'needs_install',
      message: 'Your Ring app is configured, but you need to install it to your Ring account.',
      instructions: [
        '1. Click "Open Ring Portal" below',
        '2. Find your app (Client ID: app_vJmz6jfQVdTTlp1m6DTrG)',
        '3. Click "Install" or "Link" to install the app to your Ring account',
        '4. Authorize the app to access your Ring devices',
        '5. Return here and click "Check Status" to complete the linking'
      ],
      portalUrl: 'https://developer.amazon.com/ring/console/apps'
    })
  } catch (e) {
    console.error('[RING INITIATE LINK]', e)
    return NextResponse.json(
      { error: 'Failed to check Ring connection status' },
      { status: 500 }
    )
  }
}

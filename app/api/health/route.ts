import { NextResponse } from 'next/server'
import { getHealth } from '@/lib/doorbell/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Point an external uptime monitor (UptimeRobot, Better Stack...) here.
 * 503 means: the escalation timer is not running, or nobody can be alerted, or the doorbell is offline.
 * No personal data is returned, so this route is public.
 */
export async function GET() {
  const h = getHealth()
  const ok = h.ready && h.tickAgeMs !== null && h.tickAgeMs < 10_000 && !h.anyDeviceOffline
  return NextResponse.json({ ok, ...h }, { status: ok ? 200 : 503 })
}

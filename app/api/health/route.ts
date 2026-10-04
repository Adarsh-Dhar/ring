import { NextResponse } from 'next/server'
import { getHealth } from '@/lib/doorbell/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const h = await getHealth()
  const demoMode = process.env.DEMO_MODE === '1'

  // Tick age check: in production the global timer fires every second, so the
  // last tick should never be more than 10 s stale.  In DEMO_MODE (Vercel /
  // serverless) there is no persistent timer, so we relax to 2 minutes.
  const tickOk = demoMode
    ? (h.tickAgeMs === null || h.tickAgeMs < 120_000)
    : (h.tickAgeMs !== null && h.tickAgeMs < 10_000)

  // The app is healthy when it is alive and the tick loop is running.
  // We no longer require an open case ("ready" previously meant that, which
  // caused constant 503s when nobody was at the door).
  const ok = tickOk && !h.anyDeviceOffline

  return NextResponse.json(h, { status: ok ? 200 : 503 })
}

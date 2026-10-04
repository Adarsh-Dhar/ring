import { NextResponse } from 'next/server'
import { getHealth } from '@/lib/doorbell/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const h = await getHealth()
  // In DEMO_MODE, relax the constraints since the tick might not run immediately
  const demoMode = process.env.DEMO_MODE === '1'
  const tickOk = demoMode ? (h.tickAgeMs === null || h.tickAgeMs < 120_000) : (h.tickAgeMs !== null && h.tickAgeMs < 10_000)
  const readyOk = demoMode ? true : h.ready
  const ok = readyOk && tickOk && !h.anyDeviceOffline
  return NextResponse.json(h, { status: ok ? 200 : 503 })
}

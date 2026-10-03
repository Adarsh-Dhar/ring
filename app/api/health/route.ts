import { NextResponse } from 'next/server'
import { getHealth } from '@/lib/doorbell/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const h = await getHealth()
  const ok = h.ready && h.tickAgeMs !== null && h.tickAgeMs < 10_000 && !h.anyDeviceOffline
  return NextResponse.json(h, { status: ok ? 200 : 503 })
}

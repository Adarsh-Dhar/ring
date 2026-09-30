import { NextRequest, NextResponse } from 'next/server'
import { getState } from '@/lib/doorbell/store'
import { authorize } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const a = authorize(req, 'helper', 'resident')
  if (!a.ok) return a.res
  const s = a.session!
  return NextResponse.json(getState(s.role, s.role === 'helper' ? s.helperId : undefined), { headers: { 'Cache-Control': 'no-store' } })
}

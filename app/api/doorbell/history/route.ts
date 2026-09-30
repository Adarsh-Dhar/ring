import { NextRequest, NextResponse } from 'next/server'
import { getHistory } from '@/lib/doorbell/store'
import { authorize } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const a = authorize(req, 'helper', 'admin')
  if (!a.ok) return a.res
  return NextResponse.json(getHistory())
}

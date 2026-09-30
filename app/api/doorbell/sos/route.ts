import { NextResponse } from 'next/server'
import { raiseSos } from '@/lib/doorbell/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST() {
  return NextResponse.json({ ok: true, case: raiseSos() })
}

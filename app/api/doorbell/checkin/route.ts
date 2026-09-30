import { NextResponse } from 'next/server'
import { checkIn } from '@/lib/doorbell/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST() {
  checkIn()
  return NextResponse.json({ ok: true })
}

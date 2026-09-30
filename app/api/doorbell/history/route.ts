import { NextResponse } from 'next/server'
import { getHistory } from '@/lib/doorbell/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(getHistory())
}

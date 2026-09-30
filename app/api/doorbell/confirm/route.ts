import { NextRequest, NextResponse } from 'next/server'
import { confirmCase } from '@/lib/doorbell/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const { caseId, ok } = await req.json()
  const c = confirmCase(caseId, !!ok)
  if (!c) return NextResponse.json({ error: 'nothing to confirm' }, { status: 404 })
  return NextResponse.json({ ok: true, case: c })
}

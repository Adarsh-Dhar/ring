import { NextRequest, NextResponse } from 'next/server'
import { answerCase, Answer } from '@/lib/doorbell/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const { caseId, helperId, answer } = await req.json()
  if (!['safe', 'not_safe', 'call_me'].includes(answer)) {
    return NextResponse.json({ error: 'bad answer' }, { status: 400 })
  }
  const c = answerCase(caseId, helperId, answer as Answer)
  if (!c) return NextResponse.json({ error: 'case not found' }, { status: 404 })
  return NextResponse.json({ ok: true, case: c })
}

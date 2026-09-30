import { NextRequest, NextResponse } from 'next/server'
import { answerCase, Answer, Visitor } from '@/lib/doorbell/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const { caseId, helperId, answer, visitor } = await req.json()
  if (!['safe', 'not_safe', 'call_me'].includes(answer)) {
    return NextResponse.json({ error: 'bad answer' }, { status: 400 })
  }
  if (visitor && !['known', 'delivery', 'unknown'].includes(visitor)) {
    return NextResponse.json({ error: 'bad visitor' }, { status: 400 })
  }
  if (answer === 'safe' && visitor !== 'known' && visitor !== 'delivery') {
    return NextResponse.json({ error: 'Say who is at the door before marking safe' }, { status: 400 })
  }
  const c = answerCase(caseId, helperId, answer as Answer, visitor as Visitor | undefined)
  if (!c) return NextResponse.json({ error: 'case not found' }, { status: 404 })
  return NextResponse.json({ ok: true, case: c })
}

// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { getHistory } from '@/lib/doorbell/store'
import { authorize } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (!a.ok) return a.res
  const householdId = a.session!.householdId
  return NextResponse.json(await getHistory(householdId))
}

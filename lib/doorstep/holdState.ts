/**
 * Is this case held for approval? (spec 5.3 / 7.2 step 4)
 * A short-notice label alone is not proof that anyone must approve: under the `ai_handles` policy nobody has to.
 * So hold only when the household policy requires approval AND the case is still waiting/no_response.
 */
import { getDb } from '@/lib/db/client'
import { isHoldingCase } from './noticePolicy'

export async function isHoldingCaseFor(householdId: string, c: { id?: string; noticeStatus?: string | null; status?: string | null } | null | undefined): Promise<boolean> {
  if (!isHoldingCase(c)) return false
  try {
    const hh = await getDb().household.findUnique({ where: { id: householdId }, select: { shortNoticePolicy: true } })
    if ((hh?.shortNoticePolicy ?? 'helper_approval') === 'ai_handles') return false
    // An approved visit_approval lifts the hold.
    if (c?.id) {
      const row = await getDb().case.findUnique({ where: { id: c.id }, select: { pendingActions: true } })
      const acts = Array.isArray(row?.pendingActions) ? (row!.pendingActions as any[]) : []
      if (acts.some((a) => a?.kind === 'visit_approval' && (a.state === 'approved' || a.state === 'consumed'))) return false
    }
    return true
  } catch {
    return true // unknown policy: stay safe and hold
  }
}

/**
 * Deadline policy (spec 5.3).
 *
 * A waiting case has ONE deadline: the moment the helper-response window ends. Two things can set it:
 *   - the legacy household timeout, applied when the case opens, and
 *   - the score-driven timers (risk-decision 120 - S_eff, takeover min(120 - S_eff, 60)) applied as the score rises.
 * Policy: EARLIEST WINS. A new timer may shorten the deadline, never extend it, because a longer wait on a rising
 * risk is the unsafe direction. Every change is audited with its reason, and the cached copy in the web process is
 * updated at once, so enforcement never depends on the worker alone. The database value is authoritative.
 */
import { getDb } from '@/lib/db/client'
import { createAuditEvent, writeAudit } from './audit'

export const DEADLINE_POLICY = 'earliest_wins' as const

/** Move the deadline earlier to `targetMs`. Compare-and-set with retry. Returns true when it changed. */
export async function shortenDeadline(householdId: string, caseId: string, targetMs: number, kind: string, reason: string): Promise<boolean> {
  const db = getDb()
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await db.case.findUnique({ where: { id: caseId }, select: { deadlineAt: true, status: true, timerDeadlines: true } })
    if (!row || row.status !== 'waiting') return false
    const current = row.deadlineAt.getTime()
    if (!(targetMs < current)) return false
    const r = await db.case.updateMany({ where: { id: caseId, status: 'waiting', deadlineAt: row.deadlineAt }, data: { deadlineAt: new Date(targetMs), deadlineKind: kind, timerDeadlines: { ...(row.timerDeadlines ?? {}), [kind]: targetMs } } })
    if (r.count === 1) {
      try {
        const { syncCaseDeadline } = await import('@/lib/doorbell/store')
        if (typeof syncCaseDeadline === 'function') syncCaseDeadline(householdId, caseId, targetMs)
      } catch { /* cache sync is best effort; the database value is authoritative */ }
      await writeAudit(caseId, createAuditEvent('system', 'deadline_shortened', { from: current, to: targetMs, reason, policy: DEADLINE_POLICY, kind })).catch(() => {})
      return true
    }
  }
  return false
}

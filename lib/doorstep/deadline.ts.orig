/**
 * Deadline policy (spec 5.3).
 *
 * Section 5.3 requires FOUR separate timers, each with its own reason and expiry behavior:
 *   - Approval timer: resident rule needs helper approval (any score including 0)
 *   - Risk-decision timer: helper decision needed because of score (120 - S_eff)
 *   - Takeover timer: helper-led mode (S_eff >= 60 or event minimum)
 *   - Emergency: no timer, immediate alert
 *
 * Each timer has its own deadline stored in timerDeadlines. The governing deadlineAt is the EARLIEST
 * of all active timers. When it expires, we check WHICH timer(s) expired and trigger the appropriate behavior.
 *
 * Policy: EARLIEST WINS for the governing deadline, but all timers are tracked independently
 * so we know which expiry behavior to apply when the deadline passes.
 */
import { getDb } from '@/lib/db/client'
import { createAuditEvent, writeAudit } from './audit'

export const DEADLINE_POLICY = 'earliest_wins' as const

export type TimerKind = 'household' | 'approval' | 'risk_decision' | 'takeover' | 'emergency'

/** Record a timer deadline independently, even if it doesn't shorten the governing deadline. */
export async function recordTimerDeadline(
  householdId: string,
  caseId: string,
  kind: TimerKind,
  deadlineMs: number,
  reason: string
): Promise<void> {
  const db = getDb()
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await db.case.findUnique({ where: { id: caseId }, select: { deadlineAt: true, status: true, timerDeadlines: true } })
    if (!row || row.status !== 'waiting') return

    const currentDeadlines = row.timerDeadlines ?? {}
    // Only update if this timer is not already set to an earlier time
    if (currentDeadlines[kind] && currentDeadlines[kind] <= deadlineMs) return

    const newDeadlines = { ...currentDeadlines, [kind]: deadlineMs }
    const newGoverning = Math.min(...Object.values(newDeadlines).map(Number), row.deadlineAt.getTime())

    const r = await db.case.updateMany({
      where: { id: caseId, status: 'waiting', deadlineAt: row.deadlineAt },
      data: {
        deadlineAt: new Date(newGoverning),
        deadlineKind: kind, // The timer that set the new governing deadline
        timerDeadlines: newDeadlines,
      }
    })

    if (r.count === 1) {
      try {
        const { syncCaseDeadline } = await import('@/lib/doorbell/store')
        if (typeof syncCaseDeadline === 'function') syncCaseDeadline(householdId, caseId, newGoverning)
      } catch { /* cache sync is best effort */ }
      await writeAudit(caseId, createAuditEvent('system', 'timer_recorded', { kind, deadlineAt: deadlineMs, reason })).catch(() => {})
      return
    }
  }
}

/** Move the deadline earlier to `targetMs`. Compare-and-set with retry. Returns true when it changed. */
export async function shortenDeadline(householdId: string, caseId: string, targetMs: number, kind: TimerKind, reason: string): Promise<boolean> {
  const db = getDb()
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await db.case.findUnique({ where: { id: caseId }, select: { deadlineAt: true, status: true, timerDeadlines: true } })
    if (!row || row.status !== 'waiting') return false
    const current = row.deadlineAt.getTime()
    if (!(targetMs < current)) return false

    const newDeadlines = { ...(row.timerDeadlines ?? {}), [kind]: targetMs }
    const r = await db.case.updateMany({
      where: { id: caseId, status: 'waiting', deadlineAt: row.deadlineAt },
      data: {
        deadlineAt: new Date(targetMs),
        deadlineKind: kind,
        timerDeadlines: newDeadlines,
      }
    })
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

/** Check which timers have expired and return their kinds with expiry behavior. */
export async function checkExpiredTimers(caseId: string, now: number): Promise<{ kind: TimerKind; deadlineMs: number }[]> {
  const db = getDb()
  const row = await db.case.findUnique({
    where: { id: caseId },
    select: { status: true, timerDeadlines: true }
  })
  if (!row || row.status !== 'waiting') return []

  const deadlines = row.timerDeadlines ?? {}
  const expired: { kind: TimerKind; deadlineMs: number }[] = []

  for (const [kind, deadlineMs] of Object.entries(deadlines)) {
    if (typeof deadlineMs === 'number' && deadlineMs <= now) {
      expired.push({ kind: kind as TimerKind, deadlineMs })
    }
  }

  return expired
}

/** Determine the expiry behavior for each timer kind. */
export function expiryBehavior(kind: TimerKind): 'notify_backup' | 'notify_backup_keep_primary' | 'emergency' {
  switch (kind) {
    case 'approval':
      return 'notify_backup' // Door stays closed, AI uses holding script
    case 'risk_decision':
      return 'notify_backup' // Notify backup helper
    case 'takeover':
      return 'notify_backup_keep_primary' // Notify backup AND keep primary alerted
    case 'emergency':
      return 'emergency' // Primary and backup alerted together
    default:
      return 'notify_backup'
  }
}

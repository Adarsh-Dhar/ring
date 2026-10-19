/**
 * Escalation step engine.
 *
 * One "step" = the current helper did not answer in time, so we either
 *   - hand an expected-visit case over to the normal lane (expected_to_normal),
 *   - ask the next helper in the chain (next_helper), or
 *   - give up and tell everyone to call the resident (exhausted).
 *
 * P11: Emergency path for immediate_threat and forced_entry_or_assault:
 *   - Skips helper acknowledgement timer
 *   - Alerts primary and backup helpers immediately
 *   - Preserves evidence (clip and transcript)
 *   - Tells resident to keep door closed and move away
 *   - Never shows "safe to open"
 *   - Applies 100 override immediately upon confirming source
 *
 * Section 7: Marks helper requests as timed_out when a helper doesn't answer.
 *
 * Exactly-once rule: a step is CLAIMED in the database first (a compare-and-set on
 * helperIndex + deadlineAt + lane + status). Only the caller whose claim succeeds may
 * alert anyone. A second server, a restarted server or the worker sweep that tries the
 * same step gets `false`, reloads the row and moves on, so nobody is alerted twice.
 *
 * Trade-off (deliberate): the claim happens BEFORE the alert, so a crash between the two
 * can skip one alert. The case still escalates again after the next deadline, which is safer
 * than alerting a helper twice for the same step.
 *
 * This file has no database or network imports so it can be tested without either.
 */

import type { DoorCase } from './store'

export type EscalationKind = 'expected_to_normal' | 'next_helper' | 'exhausted' | 'emergency'

export interface StepExpect {
  helperIndex: number
  deadlineAt:  number
  lane?:       string | null
}

export interface StepChange {
  helperIndex: number
  deadlineAt:  number
  status:      'waiting' | 'no_response'
  lane?:       'normal' | 'expected'
  resolvedAt?: number
}

export interface EscalationDeps {
  /** Atomic compare-and-set. true = this caller owns the step. */
  claim(caseId: string, expect: StepExpect, change: StepChange, log: DoorCase['log']): Promise<boolean>
  /** Fresh copy of the saved row, or null if it no longer exists. */
  reload(caseId: string): Promise<Partial<DoorCase> | null>
  /** Display name for log lines. */
  nameOf(membershipId: string | undefined): Promise<string | undefined>
  /** Send push/SMS. Called only after a successful claim. */
  onStep(c: DoorCase, step: { kind: EscalationKind; fromId?: string; toId?: string; fromName?: string; toName?: string }): Promise<void> | void
  /** Section 7: Mark helper request as timed out. Called when a helper doesn't answer. */
  onTimeout?(caseId: string, membershipId: string): Promise<void>
}

export interface EscalationConfig {
  /** P7: Acknowledgement timer (shrinks with score: 60s at 0 → 10s at 100, floor 10s) */
  timeoutSec: number
  /** P7: Decision timer after acknowledgement (shrinks with score: 180s at 0 → 45s at 100, floor 45s) */
  decisionSec: number
  /** P7: No-response timer for unacknowledged helpers (shrinks with score: 300s at 0 → 90s at 100, floor 90s) */
  noResponseSec: number
  expectedTimeoutSec: number
}

/** Safety valve so a bug can never spin forever. Real catch-up needs at most chain.length + 1 steps. */
const MAX_STEPS_PER_CALL = 25

/** P11: Check if a case is an emergency (immediate_threat or forced_entry_or_assault) */
export function isEmergencyCase(c: DoorCase): boolean {
  const riskScore = (c as any).riskScore as number | undefined
  const controlMode = (c as any).controlMode as string | undefined
  // Emergency if score is 100 (forced_entry_or_assault) or controlMode is emergency
  return riskScore === 100 || controlMode === 'emergency'
}

/** Log line that marks an emergency escalation as already done for a case. */
export const EMERGENCY_LOG_MARK = '⚠️ EMERGENCY: immediate threat or forced entry detected. All helpers alerted immediately.'

/**
 * P11 / spec 7.2 emergency: no acknowledgement timer, every contact alerted in parallel, exactly once.
 * The step is CLAIMED first, and only the caller that wins the claim alerts anyone, so two servers or a
 * restarted server can never alert the same people twice. A case whose log already holds the emergency mark
 * is left alone, so the 30-minute case window cannot trigger a second round of alerts.
 */
export async function escalateEmergencyCase(
  c: DoorCase,
  now: number,
  deps: EscalationDeps,
): Promise<number> {
  if (c.status !== 'waiting') return 0
  if (c.log.some(l => l.msg === EMERGENCY_LOG_MARK)) return 0

  // Emergency: alert primary and backup helpers immediately, skip timer
  const fromId = c.chain[0]
  const fromName = (await deps.nameOf(fromId)) ?? 'primary helper'

  const log = [...c.log, { t: now, msg: EMERGENCY_LOG_MARK }]
  log.push({ t: now, msg: 'Resident told to keep door closed and move away. Never show "safe to open".' })

  // Emergency: move the deadline to the end of the 30-minute case window, no acknowledgement timer.
  const change: StepChange = {
    helperIndex: c.helperIndex,
    deadlineAt: now + 30 * 60 * 1000,
    status: 'waiting',
    lane: c.lane,
  }

  const expect: StepExpect = { helperIndex: c.helperIndex, deadlineAt: c.deadlineAt, lane: c.lane ?? null }

  // Claim first, alert second.
  const owned = await deps.claim(c.id, expect, change, log)
  if (!owned) return 0
  mergeSaved(c, { ...change, log })

  // One 'emergency' step: the alert itself reaches every contact in parallel and has its own exactly-once claim.
  await deps.onStep(c, { kind: 'emergency', fromId, fromName })
  return 1
}

/** Copy the saved escalation fields onto the in-memory case (the database wins). */
export function mergeSaved(c: DoorCase, saved: Partial<DoorCase>) {
  if (saved.helperIndex !== undefined) c.helperIndex = saved.helperIndex
  if (saved.deadlineAt  !== undefined) c.deadlineAt  = saved.deadlineAt
  if (saved.status      !== undefined) c.status      = saved.status
  if ('lane'       in saved) c.lane       = saved.lane
  if ('resolvedAt' in saved) c.resolvedAt = saved.resolvedAt
  if ('answer'     in saved) c.answer     = saved.answer
  if ('answeredBy' in saved) c.answeredBy = saved.answeredBy
  if (saved.log) c.log = saved.log
}

/**
 * Advance one case through every step that is due at `now`.
 * Returns how many steps THIS caller won (0 = somebody else already did it, or nothing was due).
 * P11: If case is emergency, uses emergency path (skip timer, alert all helpers immediately).
 */
export async function escalateDueCase(
  c: DoorCase,
  now: number,
  cfg: EscalationConfig,
  deps: EscalationDeps,
): Promise<number> {
  // P11: Check for emergency case first
  if (isEmergencyCase(c)) {
    return escalateEmergencyCase(c, now, deps)
  }

  let won = 0

  for (let i = 0; i < MAX_STEPS_PER_CALL; i++) {
    if (c.status !== 'waiting' || now < c.deadlineAt) return won

    const expect: StepExpect = { helperIndex: c.helperIndex, deadlineAt: c.deadlineAt, lane: c.lane ?? null }
    const fromId = c.chain[c.helperIndex]
    const fromName = (await deps.nameOf(fromId)) ?? 'Someone'

    let kind: EscalationKind
    let change: StepChange
    let msg: string
    let toId: string | undefined
    let toName: string | undefined

    if (c.lane === 'expected') {
      kind   = 'expected_to_normal'
      change = { helperIndex: c.helperIndex, deadlineAt: c.deadlineAt + cfg.timeoutSec * 1000, status: 'waiting', lane: 'normal' }
      msg    = `Nobody confirmed the expected visit in ${cfg.expectedTimeoutSec}s. Treated as an unknown visitor: normal alert and SMS.`
      toId   = fromId
    } else if (c.helperIndex + 1 >= c.chain.length) {
      kind   = 'exhausted'
      change = { helperIndex: c.helperIndex + 1, deadlineAt: c.deadlineAt, status: 'no_response', lane: c.lane, resolvedAt: c.deadlineAt }
      msg    = `${fromName} did not answer. Nobody left to ask. Resident told to keep door closed.`
    } else {
      kind   = 'next_helper'
      toId   = c.chain[c.helperIndex + 1]
      toName = (await deps.nameOf(toId)) ?? 'next helper'
      change = { helperIndex: c.helperIndex + 1, deadlineAt: c.deadlineAt + cfg.timeoutSec * 1000, status: 'waiting', lane: c.lane }
      msg    = `${fromName} did not answer in ${cfg.timeoutSec}s. Escalated to ${toName}.`
    }

    const log = [...c.log, { t: now, msg }]
    if (kind === 'exhausted') log.push({ t: now, msg: 'SMS sent to all helpers.' })

    const owned = await deps.claim(c.id, expect, change, log)

    if (!owned) {
      // Somebody else moved this case on (or answered it). Take their version and re-check.
      const saved = await deps.reload(c.id)
      if (!saved) return won
      mergeSaved(c, saved)
      continue
    }

    // We own this step: reflect it in memory, then alert.
    c.helperIndex = change.helperIndex
    c.deadlineAt  = change.deadlineAt
    c.status      = change.status
    c.lane        = change.lane
    if (change.resolvedAt !== undefined) c.resolvedAt = change.resolvedAt
    c.log         = log
    won++

    await deps.onStep(c, { kind, fromId, toId, fromName, toName })

    // Section 7: Mark helper request as timed out when a helper doesn't answer
    if (deps.onTimeout && fromId) {
      await deps.onTimeout(c.id, fromId)
    }
  }

  return won
}

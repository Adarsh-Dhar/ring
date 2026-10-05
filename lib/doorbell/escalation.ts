/**
 * Escalation step engine.
 *
 * One "step" = the current helper did not answer in time, so we either
 *   - hand an expected-visit case over to the normal lane (expected_to_normal),
 *   - ask the next helper in the chain (next_helper), or
 *   - give up and tell everyone to call the resident (exhausted).
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

export type EscalationKind = 'expected_to_normal' | 'next_helper' | 'exhausted'

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
}

export interface EscalationConfig {
  timeoutSec:         number
  expectedTimeoutSec: number
}

/** Safety valve so a bug can never spin forever. Real catch-up needs at most chain.length + 1 steps. */
const MAX_STEPS_PER_CALL = 25

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
 */
export async function escalateDueCase(
  c: DoorCase,
  now: number,
  cfg: EscalationConfig,
  deps: EscalationDeps,
): Promise<number> {
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
  }

  return won
}

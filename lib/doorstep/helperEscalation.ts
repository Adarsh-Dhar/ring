/**
 * Helper escalation (spec section 2). The tested step engine stays in lib/doorbell/escalation.ts:
 * exactly-once claims, next helper, no-response. This module is the stable doorstep-facing entry point and adds
 * the one thing the spec asks for: timers that come from the control mode instead of one fixed number.
 *
 * Silence is never consent: a helper who does not answer ends in `no_response`, which tells the resident to keep
 * the door closed. It is a separate operational problem with its own path, not an approval.
 */
export { escalateDueCase, mergeSaved } from '../doorbell/escalation'
export type { EscalationDeps, EscalationConfig, EscalationKind, StepChange, StepExpect } from '../doorbell/escalation'

import { activeTimer, effectiveScore, riskDecisionNeeded, timersFor } from './collaborationController'
import type { ControlMode } from './riskRules'

/** Seconds the NEXT helper gets (spec 5.3): the shorter of the household timeout and the risk/takeover timer for S_eff. */
export function backupTimeoutSec(
  score: number | null | undefined,
  minMode: ControlMode | null | undefined,
  householdSec: number,
): number {
  if (score == null && !minMode) return householdSec
  const eff = effectiveScore(score ?? 0, minMode)
  const t = activeTimer(timersFor(eff, minMode), { riskDecisionNeeded: riskDecisionNeeded(eff) })
  return t && t.seconds !== null ? Math.min(t.seconds, householdSec) : householdSec
}

/** Re-export for backward compatibility (deprecated: use backupTimeoutSec instead). */
export const escalationConfigFor = backupTimeoutSec

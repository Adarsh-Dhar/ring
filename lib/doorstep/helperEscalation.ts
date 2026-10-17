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

import type { Control } from './collaborationController'

/** Escalation config for one case. `ackSeconds` is how long each helper has to answer before the next is asked. */
export function escalationConfigFor(control: Pick<Control, 'timers'>, expectedTimeoutSec: number) {
  return { timeoutSec: control.timers.ackSeconds, expectedTimeoutSec }
}

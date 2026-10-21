/**
 * Deterministic next-action decision logic (WP3).
 * This module implements the precedence order for deciding what happens next
 * after each turn in the interrogation.
 */

import type { Observation, ControlMode } from '@/lib/doorstep/riskRules'

export type NextAction =
  | { type: 'emergency' }
  | { type: 'urgent_safety'; reason: string }
  | { type: 'uncertain_safety'; reason: string }
  | { type: 'event_response'; code: string; response: string }
  | { type: 'precondition_line'; line: string }
  | { type: 'ask' }
  | { type: 'handoff_unverified'; reason: string }
  | { type: 'handoff_visitor_wellbeing'; reason: string }
  | { type: 'visitor_gone' }

export interface DecisionContext {
  observations: Observation[]
  score: number
  controlMode: ControlMode
  effectiveScore: number
  visitorLeft: boolean
  modelDown: boolean
  /** The visitor declined or deflected twice in a row. We stop asking (non-coercive stop rule). */
  stalled: boolean
  /** The visitor seems a child, lost, confused, unwell, or asked for help. A carer must take over (Mendez principle 3). */
  visitorNeedsCare: { reason: string } | null
  hasPreconditionLine: string | null
}

/**
 * Deterministic decideNext() function.
 * Applies precedence in strict order:
 * 1. Resident SOS, confirmed forced entry or assault
 * 2. Confirmed credible immediate threat
 * 3. Uncertain physical or threat evidence
 * 4. Defined scored-event responses (credential, hide, refuse to leave, pressure, contradiction)
 * 5. The visitor themselves needs care (child, lost, distressed, unwell)
 * 6. Progress and stall conditions (visitor left, model down, visitor declined twice, missing precondition line)
 * 7. Next question (the interviewer agent chooses and words it; the authority gate has the last word)
 */
export function decideNext(ctx: DecisionContext): NextAction {
  // 1. Emergency: confirmed forced entry, assault, or SOS
  const forcedEntry = ctx.observations.find(o =>
    o.code === 'forced_entry_or_assault' && o.state === 'confirmed'
  )
  if (forcedEntry) {
    return { type: 'emergency' }
  }

  // 2. Confirmed credible immediate threat
  const immediateThreat = ctx.observations.find(o =>
    o.code === 'immediate_threat' && o.state === 'confirmed'
  )
  if (immediateThreat) {
    return { type: 'urgent_safety', reason: 'Confirmed immediate threat detected' }
  }

  // 3. Uncertain physical or threat evidence
  const uncertainPhysical = ctx.observations.find(o =>
    ['lock_manipulation', 'door_wedge_or_follow_in', 'immediate_threat', 'forced_entry_or_assault'].includes(o.code) &&
    o.state === 'uncertain'
  )
  if (uncertainPhysical) {
    return { type: 'uncertain_safety', reason: `Uncertain ${uncertainPhysical.code} detected` }
  }

  // 4. Defined scored-event responses (credential, hide, refuse to leave, pressure, contradiction)
  const SCRIPTED = ['credential_request', 'hide_from_helper', 'refuse_to_leave',
    'pressure_after_boundary', 'purpose_contradiction', 'pressure_after_rule'] as const
  for (const code of SCRIPTED) {
    const hit = ctx.observations.find(o => o.code === code && o.state === 'confirmed' && !o.retracted && !o.resolvedAt)
    if (hit) return { type: 'event_response', code, response: '' }   // the interrogator renders the real line from eventResponses.ts
  }

  // 4b. The visitor may be the one who needs help. Safety lines would be wrong here: hand over to a carer.
  if (ctx.visitorNeedsCare) {
    return { type: 'handoff_visitor_wellbeing', reason: ctx.visitorNeedsCare.reason }
  }

  // 6. Progress and stall conditions
  if (ctx.visitorLeft) {
    return { type: 'visitor_gone' }
  }

  if (ctx.modelDown) {
    return { type: 'handoff_unverified', reason: 'Model unavailable' }
  }

  if (ctx.stalled) {
    return { type: 'handoff_unverified', reason: 'Visitor declined twice. Stopped asking.' }
  }

  if (ctx.hasPreconditionLine) {
    return { type: 'precondition_line', line: ctx.hasPreconditionLine }
  }

  // 7. Next question. The caller composes it (interviewer agent + guardrails).
  return { type: 'ask' }
}

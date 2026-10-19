/**
 * AI recommendation engine (Section 7).
 *
 * Returns a structured recommendation based on the highest-scoring confirmed risk code in the ledger.
 * Includes: what to say, why, which tool it would use, and the gate result for that tool.
 * The gate runs in code (gateAction), so the recommendation can never claim more authority than the AI has.
 */
import { type Observation, type ControlMode, type Behaviour } from './riskRules'
import { gateAction, type GateResult } from './actionGate'
import { type GatedTool } from './authorityCosts'
import type { Preferences } from './residentPreferences'

export interface Recommendation {
  say: string // What the AI would say
  why: string // Why this recommendation
  tool?: GatedTool // The action tool, if applicable
  gate: GateResult // The gate result (allow, ask_helper, deny)
  withinAuthority: boolean // True only when the gate lets the AI act alone
}

interface Plan { say: string; why: string; tool: GatedTool }

/** One plan per behaviour code. Every tool named here exists in AUTHORITY_COST. */
const PLAN: Record<Behaviour, Plan> = {
  forced_entry_or_assault: {
    say: 'EMERGENCY: Keep the door closed and move away from it.',
    why: 'Forced entry or assault was confirmed.',
    tool: 'emergency_guidance',
  },
  immediate_threat: {
    say: 'URGENT: Keep the door closed. This may be a threat.',
    why: 'An immediate threat was confirmed.',
    tool: 'safety_script',
  },
  door_wedge_or_follow_in: {
    say: 'Please step back from the door. I cannot let anyone in.',
    why: 'The visitor tried to wedge the door or follow someone in.',
    tool: 'boundary_statement',
  },
  lock_manipulation: {
    say: 'Please step away from the lock. The door will stay closed.',
    why: 'The visitor tested or tampered with the lock.',
    tool: 'boundary_statement',
  },
  refuse_to_leave: {
    say: 'The conversation is over. Please leave the property.',
    why: 'The visitor was asked to leave and has not.',
    tool: 'end_conversation',
  },
  credential_request: {
    say: 'I cannot share access details with anyone.',
    why: 'The visitor asked for a code, key or other credential.',
    tool: 'restate_rule_refuse',
  },
  hide_from_helper: {
    say: 'I am letting the helper know you are here.',
    why: 'The visitor asked that the helper not be told.',
    tool: 'alert_helper',
  },
  purpose_contradiction: {
    say: 'Can you tell me again why you are here?',
    why: 'The visitor gave answers that do not match.',
    tool: 'neutral_verification_question',
  },
  pressure_after_rule: {
    say: 'The rule has not changed. Is there a safe place I can suggest?',
    why: 'The visitor kept pushing after the house rule was explained.',
    tool: 'offer_approved_alternative',
  },
  pressure_after_boundary: {
    say: 'I have said what I can do. The door will stay closed.',
    why: 'The visitor kept pushing after a boundary was stated.',
    tool: 'boundary_statement',
  },
  extra_knock: {
    say: 'Someone is at the door. Can you tell me why you are here?',
    why: 'Repeated knocking.',
    tool: 'neutral_verification_question',
  },
}

/**
 * Get a recommendation based on the risk observations and current mode.
 * `prefs` lets the gate apply the resident's delegation settings.
 */
export function getRecommendation(
  observations: Observation[],
  mode: ControlMode,
  effectiveScore: number,
  prefs?: Preferences,
): Recommendation {
  // Retracted observations never count; only confirmed evidence drives a recommendation.
  const confirmed = observations.filter((o) => o.state === 'confirmed' && !o.retracted)
  const highest = confirmed.length > 0 ? confirmed.reduce((a, b) => (b.points > a.points ? b : a)) : null

  if (!highest) {
    const gate = gateAction('update_status', effectiveScore, prefs)
    return {
      say: 'No significant risk detected. I can handle this routine visit.',
      why: 'No confirmed risk observations.',
      gate,
      withinAuthority: gate.decision === 'allow',
    }
  }

  // A code with no confirmed-points tie-break (0-point codes such as immediate_threat) still wins by being the only one confirmed;
  // when a 0-point emergency code is confirmed alongside scored codes, it must still be the one the helper sees first.
  const urgent = confirmed.find((o) => o.code === 'forced_entry_or_assault') ?? confirmed.find((o) => o.code === 'immediate_threat')
  const code = (urgent ?? highest).code
  const plan = PLAN[code]
  const gate = gateAction(plan.tool, effectiveScore, prefs)
  return { say: plan.say, why: plan.why, tool: plan.tool, gate, withinAuthority: gate.decision === 'allow' }
}

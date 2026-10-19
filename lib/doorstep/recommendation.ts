/**
 * AI recommendation engine (Section 7).
 *
 * Returns a structured recommendation based on the highest risk code in the ledger.
 * Includes: what to say, why, what tool to use, whether it's within authority, and the gate result.
 */
import { riskLabelFor, type Observation, type ControlMode } from './riskRules'
import { gateAction, type GateResult } from './actionGate'
import { AUTHORITY_COST } from './authorityCosts'

export interface Recommendation {
  say: string // What the AI would say
  why: string // Why this recommendation
  tool?: string // The action tool, if applicable
  gate: GateResult // The gate result (execute, ask_helper, block)
  withinAuthority: boolean // Whether the action is within the AI's authority
}

/**
 * Get a recommendation based on the risk observations and current mode.
 */
export function getRecommendation(
  observations: Observation[],
  mode: ControlMode,
  effectiveScore: number
): Recommendation {
  // Find the highest-point confirmed observation
  const confirmed = observations.filter(o => o.state === 'confirmed')
  const highest = confirmed.length > 0
    ? confirmed.reduce((a, b) => (b.points > a.points ? b : a))
    : null

  if (!highest) {
    return {
      say: 'No significant risk detected. I can handle this routine visit.',
      why: 'No confirmed risk observations.',
      gate: { result: 'execute' },
      withinAuthority: true,
    }
  }

  const code = highest.code
  const points = highest.points
  const budget = 100 - effectiveScore

  // Map codes to recommendations
  switch (code) {
    case 'forced_entry_or_assault':
      return {
        say: 'EMERGENCY: Do not open the door. Keep the door closed and move away.',
        why: 'Confirmed forced entry or assault detected.',
        tool: 'emergency_alert',
        gate: gateAction('emergency_alert', budget),
        withinAuthority: budget >= AUTHORITY_COST.emergency_alert,
      }

    case 'immediate_threat':
      return {
        say: 'URGENT: Keep the door closed. This may be a threat.',
        why: 'Immediate threat detected.',
        tool: 'urgent_alert',
        gate: gateAction('urgent_alert', budget),
        withinAuthority: budget >= AUTHORITY_COST.urgent_alert,
      }

    case 'weapon_present':
      return {
        say: 'A weapon may be present. Keep the door closed.',
        why: 'Weapon detected in the scene.',
        tool: 'hold_only',
        gate: gateAction('hold_only', budget),
        withinAuthority: budget >= AUTHORITY_COST.hold_only,
      }

    case 'unfamiliar_person':
      return {
        say: 'I don\'t recognize this person. I\'ll ask them to identify themselves.',
        why: 'Unfamiliar person at the door.',
        tool: 'ask_identity',
        gate: gateAction('ask_identity', budget),
        withinAuthority: budget >= AUTHORITY_COST.ask_identity,
      }

    case 'suspicious_behavior':
      return {
        say: 'The behavior seems suspicious. I\'ll ask more questions.',
        why: 'Suspicious behavior detected.',
        tool: 'ask_questions',
        gate: gateAction('ask_questions', budget),
        withinAuthority: budget >= AUTHORITY_COST.ask_questions,
      }

    case 'delivery':
      return {
        say: 'This appears to be a delivery. I can handle this.',
        why: 'Delivery person detected.',
        tool: 'greet_routine',
        gate: gateAction('greet_routine', budget),
        withinAuthority: budget >= AUTHORITY_COST.greet_routine,
      }

    case 'known_visitor':
      return {
        say: 'I recognize this visitor. I can greet them.',
        why: 'Known visitor detected.',
        tool: 'greet_routine',
        gate: gateAction('greet_routine', budget),
        withinAuthority: budget >= AUTHORITY_COST.greet_routine,
      }

    default:
      return {
        say: 'I\'ll proceed with standard greeting.',
        why: `Observation: ${code}`,
        tool: 'greet_routine',
        gate: gateAction('greet_routine', budget),
        withinAuthority: budget >= AUTHORITY_COST.greet_routine,
      }
  }
}

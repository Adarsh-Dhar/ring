/**
 * Event-specific scripted responses (spec 6.3 table).
 * These run in addition to the mode. Each response still goes through the action gate.
 */
import { type Behaviour } from './riskRules'

export interface EventResponse {
  /** The behaviour that triggers this response. */
  behaviour: Behaviour
  /** The scripted response text. */
  response: string
  /** The tool to use for this response. */
  tool: 'restate_rule_refuse' | 'boundary_statement' | 'end_conversation' | 'safety_script'
}

/** Event-specific scripted responses from spec 6.3. */
export const EVENT_RESPONSES: EventResponse[] = [
  {
    behaviour: 'pressure_after_rule',
    response: 'I cannot let you in. The rules are that I must check with a helper first.',
    tool: 'restate_rule_refuse',
  },
  {
    behaviour: 'pressure_after_boundary',
    response: 'That is not acceptable. I will not change this decision. A helper will review this.',
    tool: 'boundary_statement',
  },
  {
    behaviour: 'purpose_contradiction',
    response: 'You said you were here for one reason, but now you are saying something different.',
    tool: 'boundary_statement',
  },
  {
    behaviour: 'hide_from_helper',
    response: 'I must tell the helper about this conversation. I cannot keep it secret.',
    tool: 'boundary_statement',
  },
  {
    behaviour: 'credential_request',
    response: 'I will not give you any codes, passwords, or access information.',
    tool: 'boundary_statement',
  },
  {
    behaviour: 'refuse_to_leave',
    response: 'Please leave now. I cannot continue this conversation. I will follow the resident safety plan.',
    tool: 'end_conversation',
  },
  {
    behaviour: 'lock_manipulation',
    response: 'Entry is not permitted. Do not touch the door or lock. A helper has been alerted.',
    tool: 'boundary_statement',
  },
  {
    behaviour: 'door_wedge_or_follow_in',
    response: 'Entry is not permitted. Please stay where you are. Keep the door closed.',
    tool: 'safety_script',
  },
  {
    behaviour: 'extra_knock',
    response: 'I am here. Please wait a moment while I continue.',
    tool: 'boundary_statement',
  },
]

/**
 * Get the scripted response for a behaviour, if one exists.
 */
export function getEventResponse(behaviour: Behaviour): EventResponse | undefined {
  return EVENT_RESPONSES.find(r => r.behaviour === behaviour)
}

/**
 * Mode wording module (spec section 6.2).
 * Provides mode labels and resident screen text for each control mode.
 */
import { type ControlMode } from './riskRules'

export type { ControlMode }

/** Mode label (M0 to M5) for display. */
export const MODE_LABEL: Record<ControlMode, string> = {
  ai_leads: 'M0',
  ai_assisted: 'M1',
  helper_leads: 'M2',
  helper_only: 'M3',
  helper_urgent: 'M4',
  emergency: 'M5',
}

/** Resident screen text for each mode. From spec 6.2. */
interface ResidentScreenText {
  /** Text shown when the resident has been asked but has not yet accepted. */
  asked: string
  /** Text shown after the resident has accepted (ackedAt is set). */
  accepted: string
}

/** The six exact resident texts from 6.2. */
export const RESIDENT_SCREEN: Record<ControlMode, ResidentScreenText> = {
  ai_leads: {
    asked: 'A helper has been asked to check who is at the door.',
    accepted: 'A helper is checking who is at the door.',
  },
  ai_assisted: {
    asked: 'A helper has been asked to watch the conversation.',
    accepted: 'A helper is watching the conversation.',
  },
  helper_leads: {
    asked: 'A helper has been asked to take over.',
    accepted: 'A helper is in charge.',
  },
  helper_only: {
    asked: 'A helper has been asked to handle this.',
    accepted: 'A helper is handling this.',
  },
  helper_urgent: {
    asked: 'A helper has been asked urgently.',
    accepted: 'A helper is handling this urgently.',
  },
  emergency: {
    asked: 'Emergency contacts have been alerted.',
    accepted: 'Emergency contacts have been alerted.',
  },
}

/**
 * Get the resident screen text for a mode.
 * Returns the "asked" form if the resident has not yet accepted (ackedAt is null),
 * otherwise returns the "accepted" form.
 */
export function residentScreenFor(mode: ControlMode, helperAccepted: boolean): string {
  const text = RESIDENT_SCREEN[mode]
  return helperAccepted ? text.accepted : text.asked
}

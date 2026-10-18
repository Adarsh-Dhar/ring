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

/** The six exact resident texts from spec 6.2.
 * "asked" = before a helper has accepted. "accepted" = after the helper has actually accepted.
 * Only the wording that names the helper changes ("has been asked to review" -> "is reviewing").
 * The screen never claims help is on the way unless that is confirmed, so M0, M1, M4 and M5 carry no helper claim. */
export const RESIDENT_SCREEN: Record<ControlMode, ResidentScreenText> = {
  ai_leads: {
    asked: 'Someone is at the door. Your usual plan is running.',
    accepted: 'Someone is at the door. Your usual plan is running.',
  },
  ai_assisted: {
    asked: 'Something needs checking. Please keep the door closed.',
    accepted: 'Something needs checking. Please keep the door closed.',
  },
  helper_leads: {
    asked: "Something doesn't match. Please keep the door closed. Your helper has been asked to review.",
    accepted: "Something doesn't match. Please keep the door closed. Your helper is reviewing.",
  },
  helper_only: {
    asked: 'Do not open the door. Your helper has been asked to take over.',
    accepted: 'Do not open the door. Your helper is taking over.',
  },
  helper_urgent: {
    asked: 'Move away from the door. Go to your safe place.',
    accepted: 'Move away from the door. Go to your safe place.',
  },
  emergency: {
    asked: 'Move to your safe place. Call emergency help now.',
    accepted: 'Move to your safe place. Call emergency help now.',
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

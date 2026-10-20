import type { LineId } from './types'

/** The ONLY fixed words the doorbell ever says. Deliberately free of any resident detail. */
export function interrogatorLines(residentName?: string | null): Record<LineId, string> {
  // WP5: Privacy fix - do not include resident name in greeting
  return {
    greet:              'Hello, this is the doorbell. I cannot authorize entry. Who are you, and what is the reason for your visit?',
    reprompt:           'Sorry, could you say that again?',
    close:              'Thank you. Please wait a moment.',
    // P7: Interview state stamps for conditional codes
    rules_explained:    'I need to explain the rules before we can continue.',
    boundary_stated:    'That is not acceptable. Please respect my decision.',
    asked_to_leave:     'Please leave now. I cannot continue this conversation.',
    // Step 2: Fixed line that triggers entryDeniedAt stamp (spec 4.2 precondition for lock_manipulation).
    entry_not_permitted: 'Entry is not permitted. Please do not touch the door or lock.',
    // Spec 5.3: spoken while a short-notice visit waits for approval. Zero-cost safety line. It never claims help is
    // coming and never promises entry, because silence is never consent and nobody has approved yet.
    holding:            'Please wait a moment. This visit needs to be approved first. The door will stay closed.',
    // P6: Safety line - must never claim help is on the way
    safety:             'Please stay where you are. Keep the door closed.',
    // P6: Emergency guidance line - only allowed at S_eff 100
    emergency_guidance: 'This is an emergency. Follow the safety plan. Stay away from the door.',
  }
}
export const LISTEN_SECONDS = 10

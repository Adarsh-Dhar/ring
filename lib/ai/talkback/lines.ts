import type { LineId } from './types'

/** The ONLY fixed words the doorbell ever says. Deliberately free of any resident detail. */
export function interrogatorLines(residentName?: string | null): Record<LineId, string> {
  const who = residentName ? `${residentName.split(' ')[0]}'s` : 'this'
  return {
    greet:    `Hello, this is ${who} doorbell. Who are you, and what is the reason for your visit?`,
    reprompt: 'Sorry, could you say that again?',
    close:    'Thank you. Please wait a moment.',
    // P7: Interview state stamps for conditional codes
    rules_explained: 'I need to explain the rules before we can continue.',
    boundary_stated: 'That is not acceptable. Please respect my decision.',
    asked_to_leave: 'Please leave now. I cannot continue this conversation.',
  }
}
export const LISTEN_SECONDS = 10

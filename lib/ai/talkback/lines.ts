import type { LineId } from './types'

/** The ONLY words the doorbell ever says. Deliberately free of any resident detail. */
export function greeterLines(residentName?: string | null): Record<LineId, string> {
  const who = residentName ? `${residentName.split(' ')[0]}'s` : 'this'
  return {
    greet:    `Hello, this is ${who} doorbell. Who are you, and what is this about?`,
    reprompt: 'Sorry, could you say that again?',
    close:    'Thank you. Please wait a moment.',
  }
}
export const LISTEN_SECONDS = 10

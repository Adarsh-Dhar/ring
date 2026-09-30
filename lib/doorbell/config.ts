export type Consent = 'pending' | 'approved' | 'declined'

export interface Helper {
  id: string
  name: string
  phone: string
  emoji: string
  consent: Consent
  consentAt?: number
}

/** First-run defaults only. After the first save, data/state.json is the source of truth. */
export const HELPERS: Helper[] = [
  { id: 'h1', name: 'Mom', phone: '+910000000001', emoji: '👩', consent: 'approved' }, // Replace with real phone number for SMS testing
  { id: 'h2', name: 'Brother', phone: '+910000000002', emoji: '👨', consent: 'approved' }, // Replace with real phone number for SMS testing
]

export const DEFAULT_ESCALATION_SECONDS = Number(process.env.ESCALATION_SECONDS || 30)
export const RESULT_TTL_MS = 60_000
export const NO_RESPONSE_TTL_MS = 5 * 60_000
export const CHECKIN_HOUR = Number(process.env.CHECKIN_HOUR || 10)
export const CHECKIN_GRACE_MIN = Number(process.env.CHECKIN_GRACE_MIN || 60)

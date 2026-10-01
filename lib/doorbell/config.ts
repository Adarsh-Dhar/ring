export type Consent = 'pending' | 'approved' | 'declined'

export interface Helper {
  id: string
  name: string
  phone: string
  emoji: string
  consent: Consent
  consentAt?: number
  /** Bump to revoke every link/token ever issued to this helper. */
  tokenEpoch?: number
}

/** What other screens may see about a helper. Phone is only sent to the resident (to call). */
export interface PublicHelper {
  id: string
  name: string
  emoji: string
  phone?: string
}

/**
 * No default helpers. Helpers must be added through the setup page.
 */
export const HELPERS: Helper[] = []

export const RESIDENT_TZ = process.env.RESIDENT_TZ || 'Asia/Kolkata'
export const DEFAULT_ESCALATION_SECONDS = Number(process.env.ESCALATION_SECONDS || 30)
export const RESULT_TTL_MS = 60_000
export const NO_RESPONSE_TTL_MS = 5 * 60_000
export const CHECKIN_HOUR = Number(process.env.CHECKIN_HOUR || 10)
export const CHECKIN_GRACE_MIN = Number(process.env.CHECKIN_GRACE_MIN || 60)
/** Emergency number shown on the resident screen (India: 112). */
export const EMERGENCY_NUMBER = process.env.EMERGENCY_NUMBER || '112'

/** A phone that is obviously a placeholder (+910000000001 etc.) must never count as "a helper who can be reached". */
export const isPlaceholderPhone = (p: string) => /0{6,}/.test(p.replace(/^\+\d{1,3}/, ''))

/** How long the helper has to confirm an expected visit before it is treated as an unknown visitor. */
export const EXPECTED_TIMEOUT_SECONDS = Number(process.env.EXPECTED_TIMEOUT_SECONDS || 60)
/** A visit may arrive this many minutes before the window starts or after it ends. */
export const RECURRING_GRACE_MIN = Number(process.env.RECURRING_GRACE_MIN || 15)

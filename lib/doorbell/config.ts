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

/** Default values for new households. These can be overridden per household. */
export const DEFAULT_ESCALATION_SECONDS = Number(process.env.ESCALATION_SECONDS || 30)
export const DEFAULT_TIMEZONE = 'Asia/Kolkata'
export const DEFAULT_EMERGENCY_NUMBER = '112'
export const DEFAULT_QUIET_START_HOUR = 22
export const DEFAULT_QUIET_END_HOUR = 6

export const RESULT_TTL_MS = 60_000
export const NO_RESPONSE_TTL_MS = 5 * 60_000
export const CHECKIN_HOUR = Number(process.env.CHECKIN_HOUR || 10)
export const CHECKIN_GRACE_MIN = Number(process.env.CHECKIN_GRACE_MIN || 60)

/** A phone that is obviously a placeholder (+910000000001 etc.) must never count as "a helper who can be reached". */
export const isPlaceholderPhone = (p: string) => /0{6,}/.test(p.replace(/^\+\d{1,3}/, ''))

/** How long the helper has to confirm an expected visit before it is treated as an unknown visitor. */
export const EXPECTED_TIMEOUT_SECONDS = Number(process.env.EXPECTED_TIMEOUT_SECONDS || 60)
/** A visit may arrive this many minutes before the window starts or after it ends. */
export const RECURRING_GRACE_MIN = Number(process.env.RECURRING_GRACE_MIN || 15)

/** How many wrong code attempts before the resident demotes the case to unknown visitor. */
export const CODE_MAX_ATTEMPTS = Number(process.env.VISIT_CODE_MAX_ATTEMPTS || 2)

/** Rate-limit and validation constants for the public visit-request form. */
export const VISIT_LIMITS = {
  perIpHour:      Number(process.env.VISIT_REQ_PER_IP_HOUR      || 5),
  perContactDay:  Number(process.env.VISIT_REQ_PER_CONTACT_DAY  || 3),
  perLinkDay:     Number(process.env.VISIT_REQ_PER_LINK_DAY     || 50),
  maxOpen:        Number(process.env.VISIT_REQ_MAX_OPEN         || 25),
  maxWindowHours: Number(process.env.VISIT_REQ_MAX_WINDOW_H     || 12),
  maxDaysAhead:   Number(process.env.VISIT_REQ_MAX_DAYS_AHEAD   || 30),
  ttlHours:       Number(process.env.VISIT_REQ_TTL_H            || 48),
  resendMax:      Number(process.env.VISIT_REQ_RESEND_MAX       || 5),
}

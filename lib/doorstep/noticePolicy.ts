/**
 * Minimum-notice policy (spec section 3).
 *
 * Pure functions, no imports. Notice and risk are SEPARATE: this module can require approval or pick a
 * first-contact route, but it can never add a risk point. `riskPoints` is the literal type `0` so the
 * compiler rejects any attempt to change that.
 *
 * Values here are pilot starting values (see the caveat in the product spec).
 */

export const NOTICE_STATUSES = ['meets_minimum', 'short_notice', 'no_notice'] as const
export type NoticeStatus = (typeof NOTICE_STATUSES)[number]

/** Who must approve a short-notice visit. */
export type ShortNoticePolicy = 'helper_approval' | 'resident_approval' | 'ai_handles'
/** Who makes first contact with a visitor nobody arranged. */
export type UnknownVisitorPolicy = 'ai_first_contact' | 'helper_first'

export interface NoticeSettings {
  /** Hours of notice the resident wants. null = the rule is switched off. */
  minNoticeHours: number | null
  shortNoticePolicy: ShortNoticePolicy
  unknownVisitorPolicy: UnknownVisitorPolicy
  /** Section 5.3 approval timer, set by the resident. Pilot default 120 s. */
  approvalTimerSec: number
}

export const DEFAULT_APPROVAL_TIMER_SEC = 120
export const DEFAULT_NOTICE_SETTINGS: NoticeSettings = {
  minNoticeHours: null,
  shortNoticePolicy: 'helper_approval',
  unknownVisitorPolicy: 'ai_first_contact',
  approvalTimerSec: DEFAULT_APPROVAL_TIMER_SEC,
}

export interface NoticeInput {
  /** When the visit was arranged (ms since epoch). Missing = no notice was recorded. */
  arrangedAt?: number | null
  /** When the visit is due to start (ms since epoch). */
  visitStartsAt?: number | null
  /** A standing arrangement (for example a weekly carer) was agreed long ago and meets any notice rule. */
  standing?: boolean
}

export interface NoticeResult {
  status: NoticeStatus
  /** Whether somebody must approve before the visit goes ahead. */
  requiresApproval: boolean
  approver: 'helper' | 'resident' | null
  /** Who makes first contact. Only set for no_notice. */
  firstContact: 'ai' | 'helper' | null
  /** Hours of notice actually given, or null when it was not recorded. */
  leadHours: number | null
  /** Always 0. Arriving without notice is never a risk by itself. */
  riskPoints: 0
  /** One plain sentence for the case log. */
  reason: string
}

const HOUR_MS = 3_600_000
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

export function evaluateNotice(input: NoticeInput, settings: NoticeSettings = DEFAULT_NOTICE_SETTINGS): NoticeResult {
  const base = { riskPoints: 0 as const }

  if (input.standing) {
    return { ...base, status: 'meets_minimum', requiresApproval: false, approver: null, firstContact: null, leadHours: null, reason: 'Standing arrangement.' }
  }

  if (!isNum(input.arrangedAt) || !isNum(input.visitStartsAt)) {
    const firstContact = settings.unknownVisitorPolicy === 'helper_first' ? 'helper' : 'ai'
    return {
      ...base, status: 'no_notice', requiresApproval: false, approver: null, firstContact, leadHours: null,
      reason: `No notice recorded. Unknown-visitor policy: ${settings.unknownVisitorPolicy}.`,
    }
  }

  // Arranged after the start time counts as zero notice, never negative.
  const leadHours = Math.max(0, (input.visitStartsAt - input.arrangedAt) / HOUR_MS)
  const min = settings.minNoticeHours

  if (!isNum(min) || min <= 0 || leadHours >= min) {
    return { ...base, status: 'meets_minimum', requiresApproval: false, approver: null, firstContact: null, leadHours, reason: 'Arranged with enough notice.' }
  }

  const policy = settings.shortNoticePolicy
  const requiresApproval = policy !== 'ai_handles'
  const approver = policy === 'resident_approval' ? 'resident' : policy === 'helper_approval' ? 'helper' : null
  return {
    ...base, status: 'short_notice', requiresApproval, approver, firstContact: null, leadHours,
    reason: `Short notice: ${leadHours.toFixed(1)}h given, ${min}h wanted.${requiresApproval ? ` ${approver} approval required.` : ''}`,
  }
}

/** Does the resident's unknown-visitor policy say a helper, not the AI, makes first contact? Single source of truth: evaluateNotice. */
export function helperMakesFirstContact(settings: NoticeSettings): boolean {
  return evaluateNotice({}, settings).firstContact === 'helper'
}

export type NoticeSettingsPatch = {
  minNoticeHours: number | null
  shortNoticePolicy: ShortNoticePolicy
  unknownVisitorPolicy: UnknownVisitorPolicy
  approvalTimerSec: number
}

/** Strict validation for the settings API. parseNoticeSettings is tolerant (it falls back); this one rejects bad input. */
export function validateNoticeSettingsInput(raw: unknown): { ok: true; value: NoticeSettingsPatch } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Settings object required' }
  const o = raw as Record<string, unknown>
  let minNoticeHours: number | null = null
  if (o.minNoticeHours !== null && o.minNoticeHours !== undefined) {
    if (!Number.isInteger(o.minNoticeHours) || (o.minNoticeHours as number) < 1 || (o.minNoticeHours as number) > 720) {
      return { ok: false, error: 'minNoticeHours must be a whole number from 1 to 720, or empty to switch the rule off' }
    }
    minNoticeHours = o.minNoticeHours as number
  }
  const sn = o.shortNoticePolicy
  if (sn !== 'helper_approval' && sn !== 'resident_approval' && sn !== 'ai_handles') return { ok: false, error: 'Invalid shortNoticePolicy' }
  const uv = o.unknownVisitorPolicy
  if (uv !== 'ai_first_contact' && uv !== 'helper_first') return { ok: false, error: 'Invalid unknownVisitorPolicy' }
  const t = o.approvalTimerSec
  if (!Number.isInteger(t) || (t as number) < 15 || (t as number) > 900) return { ok: false, error: 'approvalTimerSec must be a whole number from 15 to 900' }
  return { ok: true, value: { minNoticeHours, shortNoticePolicy: sn, unknownVisitorPolicy: uv, approvalTimerSec: t as number } }
}

/** Read the three notice settings off a household row (or anything shaped like one). Bad values fall back to defaults. */
export function parseNoticeSettings(h: unknown): NoticeSettings {
  const o = (h ?? {}) as Record<string, unknown>
  const min = isNum(o.minNoticeHours) && o.minNoticeHours > 0 ? o.minNoticeHours : null
  const sn = o.shortNoticePolicy
  const uv = o.unknownVisitorPolicy
  return {
    minNoticeHours: min,
    shortNoticePolicy: sn === 'resident_approval' || sn === 'ai_handles' || sn === 'helper_approval' ? sn : DEFAULT_NOTICE_SETTINGS.shortNoticePolicy,
    unknownVisitorPolicy: uv === 'helper_first' || uv === 'ai_first_contact' ? uv : DEFAULT_NOTICE_SETTINGS.unknownVisitorPolicy,
    approvalTimerSec: isNum(o.approvalTimerSec) && o.approvalTimerSec >= 15 && o.approvalTimerSec <= 900 ? Math.round(o.approvalTimerSec) : DEFAULT_APPROVAL_TIMER_SEC,
  }
}

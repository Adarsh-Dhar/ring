import { describe, it, expect } from 'vitest'
import { evaluateNotice, parseNoticeSettings, DEFAULT_NOTICE_SETTINGS, type NoticeSettings } from '@/lib/doorstep/noticePolicy'

const H = 3_600_000
const T0 = Date.UTC(2026, 9, 17, 9, 0, 0)
const s = (o: Partial<NoticeSettings> = {}): NoticeSettings => ({ ...DEFAULT_NOTICE_SETTINGS, minNoticeHours: 24, ...o })

describe('notice policy (spec section 3)', () => {
  it('meets_minimum when enough notice was given', () => {
    const r = evaluateNotice({ arrangedAt: T0 - 30 * H, visitStartsAt: T0 }, s())
    expect(r.status).toBe('meets_minimum'); expect(r.requiresApproval).toBe(false)
  })
  it('exactly the minimum counts as meeting it', () => {
    expect(evaluateNotice({ arrangedAt: T0 - 24 * H, visitStartsAt: T0 }, s()).status).toBe('meets_minimum')
  })
  it('short_notice requires helper approval by default', () => {
    const r = evaluateNotice({ arrangedAt: T0 - 3 * H, visitStartsAt: T0 }, s())
    expect(r.status).toBe('short_notice'); expect(r.requiresApproval).toBe(true); expect(r.approver).toBe('helper')
  })
  it('short_notice honours resident_approval and ai_handles', () => {
    expect(evaluateNotice({ arrangedAt: T0 - H, visitStartsAt: T0 }, s({ shortNoticePolicy: 'resident_approval' })).approver).toBe('resident')
    const r = evaluateNotice({ arrangedAt: T0 - H, visitStartsAt: T0 }, s({ shortNoticePolicy: 'ai_handles' }))
    expect(r.requiresApproval).toBe(false); expect(r.approver).toBeNull()
  })
  it('no_notice when nothing was recorded, and the unknown-visitor policy picks first contact', () => {
    expect(evaluateNotice({}, s()).firstContact).toBe('ai')
    expect(evaluateNotice({ arrangedAt: null, visitStartsAt: T0 }, s({ unknownVisitorPolicy: 'helper_first' })).firstContact).toBe('helper')
    expect(evaluateNotice({}, s()).status).toBe('no_notice')
  })
  it('arranged after the start time is zero notice, not negative', () => {
    const r = evaluateNotice({ arrangedAt: T0 + H, visitStartsAt: T0 }, s())
    expect(r.leadHours).toBe(0); expect(r.status).toBe('short_notice')
  })
  it('rule off (null or 0 hours) means any arranged visit meets the minimum', () => {
    expect(evaluateNotice({ arrangedAt: T0 - 1, visitStartsAt: T0 }, s({ minNoticeHours: null })).status).toBe('meets_minimum')
    expect(evaluateNotice({ arrangedAt: T0 - 1, visitStartsAt: T0 }, s({ minNoticeHours: 0 })).status).toBe('meets_minimum')
  })
  it('standing arrangements always meet the minimum', () => {
    expect(evaluateNotice({ standing: true }, s()).status).toBe('meets_minimum')
  })
  it('NEVER adds risk points, whatever the status', () => {
    const cases = [{}, { arrangedAt: T0 - H, visitStartsAt: T0 }, { arrangedAt: T0 - 48 * H, visitStartsAt: T0 }, { standing: true }]
    for (const c of cases) expect(evaluateNotice(c, s()).riskPoints).toBe(0)
  })
  it('parseNoticeSettings falls back to defaults on bad input', () => {
    expect(parseNoticeSettings(null)).toEqual(DEFAULT_NOTICE_SETTINGS)
    expect(parseNoticeSettings({ minNoticeHours: -5, shortNoticePolicy: 'nope', unknownVisitorPolicy: 7 })).toEqual(DEFAULT_NOTICE_SETTINGS)
    expect(parseNoticeSettings({ minNoticeHours: 24, shortNoticePolicy: 'ai_handles', unknownVisitorPolicy: 'helper_first' }))
      .toEqual({ minNoticeHours: 24, shortNoticePolicy: 'ai_handles', unknownVisitorPolicy: 'helper_first' })
  })
})

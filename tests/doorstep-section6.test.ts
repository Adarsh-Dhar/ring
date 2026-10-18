/**
 * Spec section 6: modes, event minimums, resident screen wording, action gate, scripted responses.
 */
import { describe, it, expect } from 'vitest'
import { computeControl, modeForScore, effectiveModeFor } from '@/lib/doorstep/collaborationController'
import { RESIDENT_SCREEN, residentScreenFor, MODE_LABEL } from '@/lib/doorstep/modeCopy'
import { gateAction } from '@/lib/doorstep/actionGate'
import { getEventResponse, renderEventResponse, getUncertainResponse } from '@/lib/doorstep/eventResponses'
import { RISK_RULES, BEHAVIOURS, type Behaviour } from '@/lib/doorstep/riskRules'
import { DEFAULT_PREFERENCES } from '@/lib/doorstep/residentPreferences'
import { computeResidentView } from '@/lib/state/resident-view'
import type { Household } from '@prisma/client'

describe('6.2 score bands', () => {
  it.each([[0, 'M0'], [19, 'M0'], [20, 'M1'], [39, 'M1'], [40, 'M2'], [59, 'M2'], [60, 'M3'], [79, 'M3'], [80, 'M4'], [99, 'M4'], [100, 'M5']])(
    'score %i is %s', (s, label) => expect(MODE_LABEL[modeForScore(s)]).toBe(label))
})

describe('6.2 resident screen wording (exact)', () => {
  it('uses the exact spec text for every mode before a helper accepts', () => {
    expect(RESIDENT_SCREEN.ai_leads.asked).toBe('Someone is at the door. Your usual plan is running.')
    expect(RESIDENT_SCREEN.ai_assisted.asked).toBe('Something needs checking. Please keep the door closed.')
    expect(RESIDENT_SCREEN.helper_leads.asked).toBe("Something doesn't match. Please keep the door closed. Your helper has been asked to review.")
    expect(RESIDENT_SCREEN.helper_only.asked).toBe('Do not open the door. Your helper has been asked to take over.')
    expect(RESIDENT_SCREEN.helper_urgent.asked).toBe('Move away from the door. Go to your safe place.')
    expect(RESIDENT_SCREEN.emergency.asked).toBe('Move to your safe place. Call emergency help now.')
  })
  it('changes "has been asked" to "is" only after the helper accepts', () => {
    expect(residentScreenFor('helper_only', false)).toContain('has been asked to take over')
    expect(residentScreenFor('helper_only', true)).toBe('Do not open the door. Your helper is taking over.')
    expect(residentScreenFor('helper_leads', true)).toContain('Your helper is reviewing.')
  })
  it('never claims help is coming in modes that carry no helper line', () => {
    for (const m of ['ai_leads', 'ai_assisted', 'helper_urgent', 'emergency'] as const)
      expect(residentScreenFor(m, false)).toBe(residentScreenFor(m, true))
  })
})

describe('6.3 event minimums', () => {
  const MIN: Record<Behaviour, string | null> = {
    extra_knock: null, pressure_after_rule: null,
    pressure_after_boundary: 'ai_assisted', purpose_contradiction: 'ai_assisted', hide_from_helper: 'ai_assisted', credential_request: 'ai_assisted',
    refuse_to_leave: 'helper_only', lock_manipulation: 'helper_only', door_wedge_or_follow_in: 'helper_only',
    immediate_threat: 'helper_urgent', forced_entry_or_assault: 'emergency',
  } as Record<Behaviour, string | null>
  it.each(Object.entries(MIN))('%s -> %s', (b, floor) => expect(RISK_RULES[b as Behaviour].floor).toBe(floor))
  it('uncertain physical or threat events raise to M3', () => {
    for (const b of ['lock_manipulation', 'door_wedge_or_follow_in', 'immediate_threat', 'forced_entry_or_assault'] as Behaviour[])
      expect(RISK_RULES[b].uncertainFloor).toBe('helper_only')
  })
  it('lock test: 30 points alone is M1, but the M3 floor makes S_eff 60', () => {
    const c = computeControl({ score: 30, minMode: 'helper_only', prefs: DEFAULT_PREFERENCES })
    expect(c.rawScore).toBe(30)
    expect(c.effectiveScore).toBe(60)
    expect(c.mode).toBe('helper_only')
  })
})

describe('6.2 action gate by mode', () => {
  const p = DEFAULT_PREFERENCES
  const allow = (tool: string, s: number) => gateAction(tool, s, p).decision === 'allow'
  it('ability edges', () => {
    expect(allow('greet_routine_request', 19)).toBe(true);        expect(allow('greet_routine_request', 20)).toBe(false)
    expect(allow('offer_approved_alternative', 39)).toBe(true);   expect(allow('offer_approved_alternative', 40)).toBe(false)
    expect(allow('neutral_verification_question', 59)).toBe(true); expect(allow('neutral_verification_question', 60)).toBe(false)
    expect(allow('restate_rule_refuse', 79)).toBe(true);          expect(allow('restate_rule_refuse', 80)).toBe(false)
    expect(allow('boundary_statement', 99)).toBe(true);           expect(allow('boundary_statement', 100)).toBe(false)
    expect(allow('safety_script', 100)).toBe(true)
  })
  it('helper alert, status and summaries are allowed at every score (not emergency-only)', () => {
    for (const s of [0, 20, 60, 80, 99, 100])
      for (const t of ['alert_helper', 'update_status', 'read_log_summarise']) expect(allow(t, s)).toBe(true)
  })
  it('emergency guidance is allowed only at 100', () => {
    expect(gateAction('emergency_guidance', 99, p).decision).toBe('deny')
    expect(gateAction('emergency_guidance', 100, p).decision).toBe('allow')
  })
  it('prohibited tools are denied at every score', () => {
    for (const t of ['unlock_door', 'disclose_access_credentials', 'grant_entry']) expect(gateAction(t, 0, p).decision).toBe('deny')
  })
})

describe('6.3 scripted responses', () => {
  it('purpose_contradiction states both quotes factually', () => {
    const r = renderEventResponse(getEventResponse('purpose_contradiction')!, ['I am delivering a parcel', 'I am here to read the meter'])
    expect(r).toContain('I am delivering a parcel')
    expect(r).toContain('I am here to read the meter')
    expect(r.toLowerCase()).not.toMatch(/lying|liar|suspicious/)
  })
  it('purpose_contradiction falls back to a neutral line without two quotes', () => {
    expect(renderEventResponse(getEventResponse('purpose_contradiction')!, ['only one'])).not.toContain('only one')
  })
  it('lock_manipulation does not claim help was alerted', () => {
    expect(renderEventResponse(getEventResponse('lock_manipulation')!)).not.toMatch(/helper has been alerted/i)
  })
  it('uncertain physical events use safety script', () => {
    expect(getUncertainResponse('lock_manipulation')?.tool).toBe('safety_script')
    expect(getUncertainResponse('door_wedge_or_follow_in')?.tool).toBe('safety_script')
    expect(getUncertainResponse('immediate_threat')?.tool).toBe('safety_script')
    expect(getUncertainResponse('forced_entry_or_assault')?.tool).toBe('safety_script')
  })
  it('every confirmed event except immediate_threat and forced_entry has a script', () => {
    for (const b of ['extra_knock','pressure_after_rule','pressure_after_boundary','purpose_contradiction','hide_from_helper','credential_request','refuse_to_leave','lock_manipulation','door_wedge_or_follow_in'] as Behaviour[])
      expect(getEventResponse(b)).toBeDefined()
  })
})

describe('6.2 resident view wording', () => {
  const household = { id: 't', residentName: 'T', timezone: 'Asia/Kolkata', timeoutSec: 30, quietStartHour: 22, quietEndHour: 6, quietEnabled: false,
    emergencyNumber: '112', residentEpoch: 1, createdAt: new Date(), plannedMode: 'helper', requireResidentOk: false, preset: 'standard', aiEnabled: false,
    aiGreeter: false, aiInterrogator: false, minNoticeHours: null, shortNoticePolicy: 'helper_approval', approvalTimerSec: null,
    unknownVisitorPolicy: 'ai_first_contact', preferences: null } as unknown as Household
  const view = (c: Record<string, unknown>) => computeResidentView({
    cases: [{ id: 'c1', status: 'waiting', kind: 'ring', createdAt: new Date(), helperIndex: 0, deadlineAt: new Date(Date.now() + 30000), ...c } as any],
    deviceOnline: true, lastHeartbeat: new Date(), timezone: 'Asia/Kolkata', quietEnabled: false, quietStartHour: 22, quietEndHour: 6, nightLockActive: false,
  }, household)

  it('M0..M4 waiting screens use the spec text', () => {
    expect(view({ effectiveMode: 'ai_leads' }).message).toBe('Someone is at the door. Your usual plan is running.')
    expect(view({ effectiveMode: 'ai_assisted' }).message).toBe('Something needs checking. Please keep the door closed.')
    expect(view({ effectiveMode: 'helper_only' }).message).toBe('Do not open the door. Your helper has been asked to take over.')
    expect(view({ effectiveMode: 'helper_urgent' }).message).toBe('Move away from the door. Go to your safe place.')
  })
  it('wording switches only after the helper accepted', () => {
    expect(view({ effectiveMode: 'helper_only', ackedAt: new Date() }).message).toBe('Do not open the door. Your helper is taking over.')
  })
  it('M5 shows the emergency text and cannot open', () => {
    const v = view({ riskScore: 100, controlMode: 'emergency', effectiveMode: 'emergency' })
    expect(v.message).toBe('Move to your safe place. Call emergency help now.')
    expect(v.canOpen).toBe(false)
  })
  it('unconfirmed alert shows at least the M3 text, not the M5 text', () => {
    const v = view({ unconfirmedAlertedAt: new Date(), effectiveMode: 'ai_leads' })
    expect(v.message).toBe('Do not open the door. Your helper has been asked to take over.')
  })
  it('a helper "safe" answer at M1+ never shows "OK to open"', () => {
    const v = view({ status: 'answered', answer: 'safe', answeredBy: 'H', effectiveMode: 'ai_assisted' })
    expect(v.message).not.toContain('OK to open')
    expect(v.canOpen).toBe(false)
  })
})

describe('6.1 effective mode = more human-led of event minimum and score band', () => {
  it('score 60 built only from M1-level events is M3, not M1', () => {
    expect(effectiveModeFor(60, 'ai_assisted')).toBe('helper_only')
    expect(effectiveModeFor(45, 'ai_assisted')).toBe('helper_leads')
    expect(effectiveModeFor(30, 'helper_only')).toBe('helper_only')   // lock test: the floor wins
    expect(effectiveModeFor(0, null)).toBe('ai_leads')
    expect(effectiveModeFor(undefined, undefined)).toBe('ai_leads')
    expect(effectiveModeFor(100, null)).toBe('emergency')
  })
  it('resident screen follows the score band even when only the event minimum is passed as the mode', () => {
    const household = { id: 't', timezone: 'Asia/Kolkata', quietEnabled: false, quietStartHour: 22, quietEndHour: 6 } as unknown as Household
    const v = computeResidentView({
      cases: [{ id: 'c', status: 'waiting', kind: 'ring', createdAt: new Date(), helperIndex: 0, deadlineAt: new Date(Date.now() + 30000),
        riskScore: 60, controlMode: 'ai_assisted', effectiveMode: 'ai_assisted' } as any],
      deviceOnline: true, lastHeartbeat: new Date(), timezone: 'Asia/Kolkata', quietEnabled: false, quietStartHour: 22, quietEndHour: 6, nightLockActive: false,
    }, household)
    expect(v.message).toBe('Do not open the door. Your helper has been asked to take over.')
    expect(v.canOpen).toBe(false)
  })
})

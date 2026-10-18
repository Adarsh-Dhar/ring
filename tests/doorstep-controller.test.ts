import { describe, it, expect } from 'vitest'
import { computeControl, modeForScore } from '@/lib/doorstep/collaborationController'
import { DEFAULT_PREFERENCES, parsePreferences, permittedActions, ALWAYS_PROHIBITED, ACTIONS, type Preferences } from '@/lib/doorstep/residentPreferences'
import { CONTROL_MODES, modeRank, type ControlMode } from '@/lib/doorstep/riskRules'
import { backupTimeoutSec, escalateDueCase } from '@/lib/doorstep/helperEscalation'

const P = DEFAULT_PREFERENCES
const ctl = (score: number, minMode?: ControlMode) => computeControl({ score, minMode, prefs: P })

describe('collaboration controller (spec sections 1, 2, 5)', () => {
  it('score 0 is AI-led and 100 is an emergency', () => {
    expect(ctl(0).mode).toBe('ai_leads'); expect(ctl(100).mode).toBe('emergency')
  })

  it('the mode never goes down as the score goes up', () => {
    let prev = 0
    for (let s = 0; s <= 100; s++) { const r = modeRank(ctl(s).mode); expect(r).toBeGreaterThanOrEqual(prev); prev = r }
  })

  it('events outrank the score: a floor lifts a low score, and a high score is never lowered by a low floor', () => {
    expect(ctl(5, 'helper_only').mode).toBe('helper_only')
    // Score 90 maps to helper_urgent (P6: M4 mode at 80-99)
    expect(ctl(90, 'ai_assisted').mode).toBe('helper_urgent')
    // emergency requires score 100 or an event floor of emergency
    expect(ctl(100).mode).toBe('emergency')
    expect(ctl(50, 'emergency').mode).toBe('emergency')
  })

  it('every score value has its own budget, oversight index and dashboard rank', () => {
    const prio = new Set<number>()
    for (let s = 0; s <= 100; s++) {
      const c = ctl(s)
      expect(c.aiAutonomyBudget).toBe(100 - s); expect(c.humanOversightIndex).toBe(s); prio.add(c.helperPriority)
    }
    expect(prio.size).toBe(101)
  })

  it('a mode floor ranks a case above a higher score in a lower mode', () => {
    expect(ctl(5, 'helper_only').helperPriority).toBeGreaterThan(ctl(35).helperPriority)
  })

  it('risk-decision timer is 120 minus S_eff between 1 and 99, none at 0 and 100', () => {
    expect(ctl(0).timers.riskDecisionSec).toBeNull(); expect(ctl(100).timers.riskDecisionSec).toBeNull()
    for (let s = 1; s <= 99; s++) expect(ctl(s).timers.riskDecisionSec).toBe(120 - s)
  })

  it('modeForScore clamps nonsense input', () => {
    expect(modeForScore(-50)).toBe('ai_leads'); expect(modeForScore(1000)).toBe('emergency'); expect(ctl(NaN).score).toBe(0)
  })
})

describe('resident preferences and permitted actions', () => {
  it('no mode and no preference can ever permit unlocking or disclosing credentials', () => {
    const everything: Preferences = { ...P, delegation: { greet_visitor: 'ai', ask_purpose: 'ai', ask_for_id: 'ai', tell_visitor_to_leave: 'ai', accept_parcel: 'ai', approve_short_notice: 'ai' } }
    for (const m of CONTROL_MODES) {
      const p = permittedActions(everything, m)
      for (const bad of ALWAYS_PROHIBITED) { expect(p.prohibited).toContain(bad); expect((p.allowed as string[]).includes(bad)).toBe(false) }
      for (const a of p.allowed) expect(ACTIONS as readonly string[]).toContain(a)
    }
  })

  it('at low risk the AI does only what the resident delegated to it', () => {
    const p = permittedActions(P, 'ai_leads')
    expect(p.allowed).toContain('greet_visitor'); expect(p.allowed).toContain('ask_purpose')
    expect(p.needsHelper).toContain('tell_visitor_to_leave'); expect(p.needsHelper).toContain('accept_parcel')
  })

  it('a resident can keep the AI off a decision', () => {
    const prefs = parsePreferences({ delegation: { ask_for_id: 'helper' } })
    const p = permittedActions(prefs, 'ai_leads')
    expect(p.allowed).not.toContain('ask_for_id'); expect(p.needsHelper).toContain('ask_for_id')
  })

  it('once a helper leads, the AI stops acting on its own', () => {
    for (const m of ['helper_leads', 'helper_only', 'helper_urgent', 'emergency'] as ControlMode[]) {
      const p = permittedActions(P, m)
      expect(p.allowed).not.toContain('greet_visitor'); expect(p.allowed).not.toContain('ask_purpose')
      expect(p.allowed).toContain('notify_helper')
    }
  })

  it('only an emergency allows the alarm and the emergency call', () => {
    expect(permittedActions(P, 'helper_only').allowed).not.toContain('call_emergency')
    expect(permittedActions(P, 'emergency').allowed).toContain('call_emergency')
  })

  it('helper approval is always something a helper must give, never something the AI gives itself', () => {
    for (const m of CONTROL_MODES) {
      const p = permittedActions(P, m)
      expect(p.needsHelper).toContain('authorise_visit_procedure'); expect(p.allowed).not.toContain('authorise_visit_procedure')
    }
  })

  it('bad stored values fall back to the defaults, and entry without approval stays "never"', () => {
    const prefs = parsePreferences({ delegation: { ask_for_id: 'robot', greet_visitor: 'helper' }, entryWithoutApproval: 'always', communication: { sensory: 'loud' } })
    expect(prefs.delegation.ask_for_id).toBe(P.delegation.ask_for_id)
    expect(prefs.delegation.greet_visitor).toBe('helper')
    expect(prefs.entryWithoutApproval).toBe('never'); expect(prefs.communication.sensory).toBe('low')
    expect(parsePreferences(undefined)).toEqual(P)
  })
})

describe('helper escalation wrapper', () => {
  it('re-exports the tested step engine', () => { expect(typeof escalateDueCase).toBe('function') })
  it('backup timeout is the spec 5.3 timer (not capped by household value)', () => {
    expect(backupTimeoutSec(null, null, 60)).toBe(60)
    expect(backupTimeoutSec(50, null, 60)).toBe(70)  // 120 - 50 = 70, NOT capped by household 60
    expect(backupTimeoutSec(90, null, 60)).toBe(30)
  })
})

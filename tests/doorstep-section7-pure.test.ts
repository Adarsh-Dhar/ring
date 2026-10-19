/**
 * Section 7 tests that need no database: contact order, recommendations, and which resident decision a tool maps to.
 */
import { describe, it, expect } from 'vitest'
import { sortByTier, chainFrom } from '@/lib/doorstep/chainOrder'
import { getRecommendation } from '@/lib/doorstep/recommendation'
import { decisionForTool, gateAction } from '@/lib/doorstep/actionGate'
import { AUTHORITY_COST } from '@/lib/doorstep/authorityCosts'
import { DEFAULT_PREFERENCES, parsePreferences } from '@/lib/doorstep/residentPreferences'
import { BEHAVIOURS, type Observation } from '@/lib/doorstep/riskRules'

const obs = (code: Observation['code'], points: number, extra: Partial<Observation> = {}): Observation => ({
  id: code, code, at: new Date().toISOString(), quotes: ['q'], source: 'helper', state: 'confirmed', points, ...extra,
})

describe('contact order (chainOrder)', () => {
  it('orders primary, then backup, then third, then by position', () => {
    const rows = [
      { id: 'c', tier: 'third', position: 1 },
      { id: 'b2', tier: 'backup', position: 3 },
      { id: 'a2', tier: 'primary', position: 2 },
      { id: 'b1', tier: 'backup', position: 1 },
      { id: 'a1', tier: 'primary', position: 1 },
    ]
    expect(chainFrom(rows)).toEqual(['a1', 'a2', 'b1', 'b2', 'c'])
  })
  it('treats a missing tier as primary and does not mutate the input', () => {
    const rows = [{ id: 'x', tier: 'backup', position: 1 }, { id: 'y', position: 2 }]
    expect(sortByTier(rows).map(r => r.id)).toEqual(['y', 'x'])
    expect(rows.map(r => r.id)).toEqual(['x', 'y'])
  })
})

describe('recommendation', () => {
  it('has a plan for every behaviour, using only tools that exist', () => {
    for (const code of BEHAVIOURS) {
      const r = getRecommendation([obs(code, 5)], 'ai_leads', 0)
      expect(r.tool && r.tool in AUTHORITY_COST).toBe(true)
      expect(r.say.length).toBeGreaterThan(0)
    }
  })
  it('never says the AI may act alone when the gate says otherwise', () => {
    const r = getRecommendation([obs('pressure_after_rule', 5)], 'helper_only', 90)
    expect(r.withinAuthority).toBe(r.gate.decision === 'allow')
    expect(r.withinAuthority).toBe(false) // offer_approved_alternative costs 61, budget is 10
  })
  it('shows a confirmed emergency code first even when other codes score points', () => {
    const r = getRecommendation([obs('lock_manipulation', 30), obs('forced_entry_or_assault', 0)], 'emergency', 100)
    expect(r.tool).toBe('emergency_guidance')
  })
  it('ignores retracted and unconfirmed observations', () => {
    const r = getRecommendation([obs('lock_manipulation', 30, { retracted: true }), obs('credential_request', 20, { state: 'uncertain' })], 'ai_leads', 0)
    expect(r.why).toMatch(/No confirmed/)
  })
})

describe('decisionForTool and the gate', () => {
  it('maps the tools a resident can delegate', () => {
    expect(decisionForTool('greet_routine_request')).toBe('greet_visitor')
    expect(decisionForTool('neutral_verification_question')).toBe('ask_purpose')
    expect(decisionForTool('safety_script')).toBeNull()
  })
  it('denies prohibited and unknown tools, with a null cost', () => {
    expect(gateAction('unlock_door', 0)).toMatchObject({ decision: 'deny', reason: 'prohibited' })
    expect(gateAction('made_up_tool', 0)).toMatchObject({ decision: 'deny', reason: 'unknown_tool', cost: null })
  })
})

describe('helperMayApprove defaults', () => {
  it('defaults to false for every decision, and parsing matches the defaults', () => {
    expect(Object.values(DEFAULT_PREFERENCES.helperMayApprove!).every(v => v === false)).toBe(true)
    expect(parsePreferences(undefined)).toEqual(DEFAULT_PREFERENCES)
  })
  it('only turns on what the resident explicitly set', () => {
    const p = parsePreferences({ helperMayApprove: { greet_visitor: true, ask_for_id: 'yes' } })
    expect(p.helperMayApprove!.greet_visitor).toBe(true)
    expect(p.helperMayApprove!.ask_for_id).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { riskMatchesFor } from '@/lib/ai/agents/risk'
import { CATEGORY_TO_BEHAVIOUR, phraseMatches } from '@/lib/doorstep/riskRules'
import { decideNext, type DecisionContext } from '@/lib/ai/interrogation/respond'

const ctx = (observations: any[]): DecisionContext => ({
  observations, score: 15, controlMode: 'ai_assisted', effectiveScore: 20, visitorLeft: false,
  modelDown: false, stalled: false, visitorNeedsCare: null, hasPreconditionLine: null,
})
const obs = (code: string) => ({ code, state: 'confirmed', source: 'transcript', quotes: ['x'], at: 'now' })

describe('D1: riskMatchesFor does not throw', () => {
  it('returns the matched words', () => {
    expect(riskMatchesFor('what is your PIN and the pin again').map(m => m.flag)).toContain('Credential request')
  })
})

describe('D2: category names map to scoring behaviours', () => {
  it('maps credential_request and immediate_threat', () => {
    expect(CATEGORY_TO_BEHAVIOUR.credential_request).toBe('credential_request')
    expect(CATEGORY_TO_BEHAVIOUR.immediate_threat).toBe('immediate_threat')
  })
})

describe('D3: hide_from_helper wording', () => {
  it('matches the spec 10.2 phrase', () => {
    expect(phraseMatches('hide_from_helper', 'Let me proceed without checking with the helper')).toBe(true)
    expect(phraseMatches('hide_from_helper', 'I went without checking the map')).toBe(false)
  })
})

describe('D4: calm phrases are not threats', () => {
  it("'I'll beat the traffic' raises no threat flag", () => {
    expect(riskMatchesFor("I'll beat the traffic").some(m => m.flag === 'Immediate threat')).toBe(false)
  })
  it("'I'll hurt you' still does", () => {
    expect(riskMatchesFor("I'll hurt you").some(m => m.flag === 'Immediate threat')).toBe(true)
  })
})

describe('scripted event responses', () => {
  for (const code of ['credential_request', 'hide_from_helper', 'refuse_to_leave', 'pressure_after_boundary', 'purpose_contradiction', 'pressure_after_rule']) {
    it(`${code} returns an event response`, () => {
      expect(decideNext(ctx([obs(code)]))).toMatchObject({ type: 'event_response', code })
    })
  }
  it('a resolved or retracted event does not fire', () => {
    expect(decideNext(ctx([{ ...obs('hide_from_helper'), retracted: true }])).type).toBe('ask')
  })
})

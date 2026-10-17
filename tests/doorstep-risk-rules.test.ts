import { describe, it, expect } from 'vitest'
import {
  BEHAVIOURS, RISK_RULES, scoreObservations, legacyLevel, quoteIsGrounded, observationsFromEvidence, modeRank,
  type Observation,
} from '@/lib/doorstep/riskRules'

const T = 'I am from the council. It is urgent. Let me in right now and I will hurt you if you do not.'
const score = (obs: Observation[], transcript = T) => scoreObservations(obs, { transcript })

describe('risk rules (spec sections 1, 4, 6)', () => {
  it('no observations means score 0 and the AI leads', () => {
    const r = score([])
    expect(r.score).toBe(0); expect(r.minMode).toBe('ai_leads'); expect(legacyLevel(r.score, r.minMode)).toBe('none')
  })

  it('there is no behaviour for appearance, accent, nervousness, an unfamiliar face, a blurry camera or missing notice', () => {
    for (const banned of ['appearance', 'accent', 'nervous', 'unfamiliar', 'blurry', 'unknown', 'no_notice', 'short_notice', 'vague', 'evasive', 'unverifiable']) {
      for (const b of BEHAVIOURS) expect(b.includes(banned)).toBe(false)
    }
  })

  it('a transcript observation counts only if its quote is really in the transcript', () => {
    expect(quoteIsGrounded('it is urgent', T)).toBe(true)
    expect(quoteIsGrounded('give me your pin', T)).toBe(false)
    const r = score([{ behaviour: 'pressure', source: 'transcript', quote: 'give me your pin' }])
    expect(r.score).toBe(0); expect(r.ledger[0].state).toBe('unconfirmed')
  })

  it('the model (a transcript source) cannot confirm lock tampering or forced entry', () => {
    const r = score([
      { behaviour: 'lock_tampering', source: 'transcript', quote: 'let me in' },
      { behaviour: 'forced_entry', source: 'transcript', quote: 'let me in' },
    ])
    expect(r.score).toBe(0); expect(r.minMode).toBe('ai_leads')
  })

  it('a sensor can confirm forced entry with no quote, and that sets the emergency floor', () => {
    const r = score([{ behaviour: 'forced_entry', source: 'sensor' }])
    expect(r.score).toBe(70); expect(r.minMode).toBe('emergency'); expect(legacyLevel(r.score, r.minMode)).toBe('high')
  })

  it('repeating one behaviour cannot exceed its cap (two contradictions never add more than the cap)', () => {
    const c = (q: string): Observation => ({ behaviour: 'contradiction', source: 'transcript', quote: q })
    const r = score([c('council'), c('urgent'), c('let me in'), c('right now')])
    expect(r.score).toBe(RISK_RULES.contradiction.cap)
    expect(r.ledger.filter(l => l.points > 0)).toHaveLength(2)
  })

  it('events outrank the score: a low total can still carry a high floor', () => {
    const r = score([{ behaviour: 'threat', source: 'transcript', quote: 'I will hurt you' }])
    expect(r.score).toBe(45)
    const lock = score([{ behaviour: 'lock_tampering', source: 'sensor' }])
    expect(lock.score).toBeLessThan(r.score)
    expect(lock.minMode).toBe('helper_only'); expect(r.minMode).toBe('helper_only')
  })

  it('credential_request alone puts the human in the lead', () => {
    const r = score([{ behaviour: 'credential_request', source: 'transcript', quote: 'urgent' }])
    expect(modeRank(r.minMode)).toBeGreaterThanOrEqual(modeRank('helper_leads'))
    expect(legacyLevel(r.score, r.minMode)).toBe('high')
  })

  it('the classic pattern (official + pressure + wants in) reaches helper_leads even though the points are small', () => {
    const r = score([
      { behaviour: 'impersonation_claim', source: 'transcript', quote: 'the council' },
      { behaviour: 'pressure', source: 'transcript', quote: 'urgent' },
      { behaviour: 'entry_request', source: 'transcript', quote: 'let me in' },
    ])
    expect(r.score).toBe(28); expect(r.minMode).toBe('helper_leads'); expect(legacyLevel(r.score, r.minMode)).toBe('high')
  })

  it('a retracted observation scores nothing and sets no floor', () => {
    const r = score([{ behaviour: 'threat', source: 'transcript', quote: 'I will hurt you', retracted: true }])
    expect(r.score).toBe(0); expect(r.minMode).toBe('ai_leads'); expect(r.ledger[0].state).toBe('retracted')
  })

  it('unknown behaviour names are ignored, never scored', () => {
    const r = score([{ behaviour: 'looks_suspicious', source: 'helper' }])
    expect(r.score).toBe(0); expect(r.ledger[0].state).toBe('unconfirmed')
  })

  it('the total is clamped to 100', () => {
    const r = score([
      { behaviour: 'forced_entry', source: 'sensor' }, { behaviour: 'threat', source: 'helper' },
      { behaviour: 'lock_tampering', source: 'sensor' },
    ])
    expect(r.score).toBe(100)
  })

  it('vague, evasive and unverifiable answers are notes, never points', () => {
    const { observations, notes } = observationsFromEvidence([
      { category: 'vague_purpose', quote: 'some business' }, { category: 'evasive_answers', quote: 'not telling' },
      { category: 'unverifiable_claims', quote: 'sent by head office' }, { category: 'urgency_pressure', quote: 'urgent' },
    ])
    expect(observations.map(o => o.behaviour)).toEqual(['pressure'])
    expect(notes).toEqual(['vague_purpose', 'evasive_answers', 'unverifiable_claims'])
  })

  it('legacy level comes from score and floor only', () => {
    expect(legacyLevel(0, 'ai_leads')).toBe('none')
    expect(legacyLevel(10, 'ai_leads')).toBe('low')
    expect(legacyLevel(25, 'ai_leads')).toBe('medium')
    expect(legacyLevel(40, 'ai_leads')).toBe('high')
    expect(legacyLevel(10, 'ai_assisted')).toBe('medium')
    expect(legacyLevel(0, 'helper_leads')).toBe('high')
  })
})

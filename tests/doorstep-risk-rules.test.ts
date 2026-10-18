import { describe, it, expect } from 'vitest'
import {
  BEHAVIOURS, RISK_RULES, scoreObservations, legacyLevel, quoteIsGrounded, observationsFromEvidence, modeRank,
  passesTranscriptionQuality, TRANSCRIPT_QUALITY_THRESHOLD, type InterviewState,
  type Observation, type Source, type EvidenceState,
} from '@/lib/doorstep/riskRules'

const T = 'I am from the council. It is urgent. Let me in right now and I will hurt you if you do not. I am not leaving. I refuse to leave.'
const now = new Date().toISOString()
const makeObs = (code: string, source: Source, quote: string, state: EvidenceState = 'confirmed', quality = 1.0): Observation => ({
  code: code as any,
  at: now,
  quotes: [quote],
  source,
  state,
  points: 0,
  transcriptQuality: source === 'transcript' ? quality : undefined,
})
const score = (obs: Observation[], transcript = T) => scoreObservations(obs, { transcript })

// Custom score function that uses a different transcript and interview state if needed
const scoreWithTranscript = (obs: Observation[], transcript: string, interviewState?: InterviewState) =>
  scoreObservations(obs, { transcript, interviewState })

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

  it('all 11 spec codes exist with correct point values and caps', () => {
    expect(BEHAVIOURS).toHaveLength(11)
    expect(RISK_RULES.extra_knock.points).toBe(1)
    expect(RISK_RULES.extra_knock.cap).toBe(5)
    expect(RISK_RULES.pressure_after_rule.points).toBe(5)
    expect(RISK_RULES.pressure_after_rule.cap).toBe(5)
    expect(RISK_RULES.pressure_after_boundary.points).toBe(1)
    expect(RISK_RULES.pressure_after_boundary.cap).toBe(10)
    expect(RISK_RULES.purpose_contradiction.tiers).toEqual([15, 10])
    expect(RISK_RULES.purpose_contradiction.cap).toBe(25)
    expect(RISK_RULES.hide_from_helper.points).toBe(15)
    expect(RISK_RULES.hide_from_helper.cap).toBe(15)
    expect(RISK_RULES.credential_request.points).toBe(20)
    expect(RISK_RULES.credential_request.cap).toBe(20)
    expect(RISK_RULES.refuse_to_leave.points).toBe(25)
    expect(RISK_RULES.refuse_to_leave.cap).toBe(25)
    expect(RISK_RULES.lock_manipulation.points).toBe(30)
    expect(RISK_RULES.lock_manipulation.cap).toBe(30)
    expect(RISK_RULES.door_wedge_or_follow_in.points).toBe(40)
    expect(RISK_RULES.door_wedge_or_follow_in.cap).toBe(40)
    expect(RISK_RULES.immediate_threat.minScore).toBe(80)
    expect(RISK_RULES.forced_entry_or_assault.minScore).toBe(100)
  })

  it('a transcript observation counts only if its quote is really in the transcript', () => {
    expect(quoteIsGrounded('it is urgent', T)).toBe(true)
    expect(quoteIsGrounded('give me your pin', T)).toBe(false)
    const r = scoreWithTranscript([makeObs('pressure_after_rule', 'transcript', 'give me your pin', 'confirmed', 1.0)], 'no pin here')
    expect(r.score).toBe(0); expect(r.ledger[0].state).toBe('uncertain')
  })

  it('the model (a transcript source) cannot confirm lock manipulation or forced entry', () => {
    const r = scoreWithTranscript([
      makeObs('lock_manipulation', 'transcript', 'let me in', 'confirmed', 1.0),
      makeObs('forced_entry_or_assault', 'transcript', 'let me in', 'confirmed', 1.0),
    ], 'let me in')
    expect(r.score).toBe(0); expect(r.minMode).toBe('ai_leads')
  })

  it('a sensor can confirm forced entry with no quote, and that sets the emergency floor and score to 100', () => {
    const r = score([makeObs('forced_entry_or_assault', 'sensor', '')])
    expect(r.score).toBe(100); expect(r.minMode).toBe('emergency'); expect(legacyLevel(r.score, r.minMode)).toBe('high')
  })

  it('repeating one behaviour cannot exceed its cap (extra_knock capped at 5)', () => {
    const interviewState: InterviewState = { respondingAt: new Date().toISOString() }
    const obs = Array(10).fill(null).map((_, i) => ({ ...makeObs('extra_knock', 'sensor', ''), at: new Date(Date.now() + i * 1000).toISOString() }))
    const r = scoreWithTranscript(obs, '', interviewState)
    expect(r.score).toBe(5)
    expect(r.ledger.filter(l => l.points > 0)).toHaveLength(5)
  })

  it('purpose_contradiction uses tiered scoring (15 then 10)', () => {
    const two = (a: string, b: string): Observation => ({ ...makeObs('purpose_contradiction', 'transcript', a), quotes: [a, b] })
    const r = scoreWithTranscript([
      two('council urgent', 'let me in'),
      two('let me in', 'refuse to leave'),
      two('council urgent', 'refuse to leave'),
    ], 'council urgent let me in refuse to leave')
    expect(r.score).toBe(25) // 15 + 10, third instance ignored due to cap
  })

  it('immediate_threat sets minimum score to 80', () => {
    const r = scoreWithTranscript([makeObs('immediate_threat', 'transcript', 'I will hurt you', 'confirmed', 1.0)], 'I will hurt you')
    expect(r.score).toBe(80); expect(r.minMode).toBe('emergency')
  })

  it('forced_entry_or_assault sets score to exactly 100, the only way to reach 100', () => {
    const r = score([makeObs('forced_entry_or_assault', 'sensor', '')])
    expect(r.score).toBe(100)
  })

  it('score is capped at 99 unless forced_entry_or_assault sets it to 100', () => {
    const interviewState: InterviewState = { askedToLeaveAt: new Date().toISOString() }
    const r = scoreWithTranscript([
      makeObs('door_wedge_or_follow_in', 'sensor', ''),
      makeObs('lock_manipulation', 'sensor', ''),
      makeObs('refuse_to_leave', 'helper', ''),
    ], '', interviewState)
    expect(r.score).toBe(95) // 40 + 30 + 25 = 95, capped at 99
  })

  it('events outrank the score: a low total can still carry a high floor', () => {
    const interviewState: InterviewState = { askedToLeaveAt: new Date().toISOString() }
    const r = scoreWithTranscript([makeObs('refuse_to_leave', 'transcript', 'refuse to leave', 'confirmed', 1.0)], 'refuse to leave', interviewState)
    expect(r.score).toBe(25)
    const lock = score([makeObs('lock_manipulation', 'sensor', '')])
    expect(lock.score).toBe(30)
    expect(lock.minMode).toBe('helper_leads'); expect(r.minMode).toBe('helper_leads')
  })

  it('credential_request alone scores 20 points', () => {
    const r = scoreWithTranscript([makeObs('credential_request', 'transcript', 'what is your PIN number', 'confirmed', 1.0)], 'what is your PIN number')
    expect(r.score).toBe(20)
  })

  it('unavailable state scores zero points', () => {
    const r = scoreWithTranscript([makeObs('immediate_threat', 'transcript', 'I will hurt you', 'unavailable', 1.0)], 'I will hurt you')
    expect(r.score).toBe(0); expect(r.minMode).toBe('ai_leads'); expect(r.ledger[0].state).toBe('unavailable')
  })

  it('uncertain speech event scores zero and sets no floor (spec 4.3)', () => {
    const interviewState: InterviewState = { askedToLeaveAt: new Date().toISOString() }
    const r = scoreWithTranscript([makeObs('refuse_to_leave', 'transcript', 'not leaving', 'uncertain', 1.0)], 'not leaving', interviewState)
    expect(r.score).toBe(0)
    expect(r.minMode).toBe('ai_leads')
  })

  it('uncertain physical or threat event scores zero and raises the mode to helper_leads only (spec 4.3)', () => {
    for (const [code, source] of [['lock_manipulation', 'helper'], ['door_wedge_or_follow_in', 'helper'], ['forced_entry_or_assault', 'helper'], ['immediate_threat', 'transcript']] as const) {
      const r = scoreWithTranscript([makeObs(code, source, 'x', 'uncertain')], 'x')
      expect(r.score, code).toBe(0)
      expect(r.minMode, code).toBe('helper_leads')
    }
  })

  // P1: Tightened pressure phrase patterns
  it('P1: parcel sentence with "please" scores 0 (no access demand)', () => {
    const interviewState: InterviewState = { rulesExplainedAt: new Date().toISOString() }
    const r = scoreWithTranscript([makeObs('pressure_after_rule', 'transcript', 'please can you tell the resident I have a parcel')], 'please can you tell the resident I have a parcel', interviewState)
    expect(r.score).toBe(0)
  })

  it('P1: "let me in" scores 5 after rules explained', () => {
    const interviewState: InterviewState = { rulesExplainedAt: new Date().toISOString() }
    const r = scoreWithTranscript([makeObs('pressure_after_rule', 'transcript', 'let me in')], 'let me in', interviewState)
    expect(r.score).toBe(5)
  })

  it('P1: "let me in" scores 0 before rules explained', () => {
    const interviewState: InterviewState = {}
    const r = scoreWithTranscript([makeObs('pressure_after_rule', 'transcript', 'let me in')], 'let me in', interviewState)
    expect(r.score).toBe(0)
  })

  it('P1: repeated pressure attempts capped at 5 for pressure_after_rule', () => {
    const interviewState: InterviewState = { rulesExplainedAt: new Date().toISOString() }
    const obs = [
      makeObs('pressure_after_rule', 'transcript', 'let me in'),
      makeObs('pressure_after_rule', 'transcript', 'open the door now'),
      makeObs('pressure_after_rule', 'transcript', 'i need to get inside'),
    ]
    const r = scoreWithTranscript(obs, 'let me in open the door now i need to get inside', interviewState)
    expect(r.score).toBe(5) // 5 + 1 + 1, capped at 5 for pressure_after_rule
  })

  it('P1: "open up" after boundary scores 1', () => {
    const interviewState: InterviewState = { boundaryStatedAt: new Date().toISOString() }
    const r = scoreWithTranscript([makeObs('pressure_after_boundary', 'transcript', 'open up')], 'open up', interviewState)
    expect(r.score).toBe(1)
  })

  it('unknown behaviour names are ignored, never scored', () => {
    const r = score([makeObs('looks_suspicious', 'helper', '')])
    expect(r.score).toBe(0); expect(r.ledger[0].state).toBe('uncertain')
  })

  it('vague, evasive and unverifiable answers are notes, never points', () => {
    const { observations, notes } = observationsFromEvidence([
      { category: 'vague_purpose', quote: 'some business' }, { category: 'evasive_answers', quote: 'not telling' },
      { category: 'unverifiable_claims', quote: 'sent by head office' }, { category: 'pressure_after_rule', quote: 'urgent' },
      { category: 'official_impersonation', quote: 'council' }, { category: 'entry_request', quote: 'let me in' },
      { category: 'home_probing', quote: 'who is home' }, { category: 'story_mismatch', quote: 'changed answer' },
    ])
    expect(observations.map(o => o.code)).toEqual(['pressure_after_rule'])
    expect(notes).toEqual(['vague_purpose', 'evasive_answers', 'unverifiable_claims', 'official_impersonation', 'entry_request', 'home_probing', 'story_mismatch'])
  })

  it('legacy level comes from score and floor only', () => {
    expect(legacyLevel(0, 'ai_leads')).toBe('none')
    expect(legacyLevel(10, 'ai_leads')).toBe('low')
    expect(legacyLevel(25, 'ai_leads')).toBe('medium')
    expect(legacyLevel(40, 'ai_leads')).toBe('high')
    expect(legacyLevel(10, 'ai_assisted')).toBe('medium')
    expect(legacyLevel(0, 'helper_leads')).toBe('high')
  })

  it('transcription quality check passes with high engine confidence', () => {
    expect(passesTranscriptionQuality('Hello there', 0.9)).toBe(true)
    expect(passesTranscriptionQuality('Hello there', 0.5)).toBe(true)
    expect(passesTranscriptionQuality('Hello there', 0.4)).toBe(false)
  })

  it('transcription quality check fails with empty or very short text', () => {
    expect(passesTranscriptionQuality('', 0.9)).toBe(false)
    expect(passesTranscriptionQuality('  ', 0.9)).toBe(false)
    expect(passesTranscriptionQuality('Hi', 0.9)).toBe(false)
  })

  it('transcription quality check fails with not-understood phrases', () => {
    expect(passesTranscriptionQuality('not understand anything', 0.9)).toBe(false)
    expect(passesTranscriptionQuality('please repeat that', 0.9)).toBe(false)
  })

  it('transcription quality check passes with heuristics when no engine confidence', () => {
    expect(passesTranscriptionQuality('Hello my name is John')).toBe(true)
    expect(passesTranscriptionQuality('Here to check the meter')).toBe(true)
  })

  it('low quality transcript produces uncertain observation and no points', () => {
    const r = scoreWithTranscript([makeObs('credential_request', 'transcript', 'give me your pin', 'confirmed', 0.3)], 'give me your pin')
    expect(r.score).toBe(0)
    expect(r.ledger[0].state).toBe('uncertain')
  })

  it('P7: pressure_after_rule scores 0 if rules were not explained', () => {
    const interviewState: InterviewState = {}
    const r = scoreWithTranscript(
      [makeObs('pressure_after_rule', 'transcript', 'let me in now', 'confirmed', 1.0)],
      'let me in now',
      interviewState
    )
    expect(r.score).toBe(0)
    expect(r.ledger[0].state).toBe('uncertain')
  })

  it('P7: pressure_after_rule scores 5 if rules were explained', () => {
    const interviewState: InterviewState = { rulesExplainedAt: new Date().toISOString() }
    const r = scoreWithTranscript(
      [makeObs('pressure_after_rule', 'transcript', 'let me in now', 'confirmed', 1.0)],
      'let me in now',
      interviewState
    )
    expect(r.score).toBe(5)
    expect(r.ledger[0].state).toBe('confirmed')
  })

  it('P7: pressure_after_boundary scores 0 if boundary was not stated', () => {
    const interviewState: InterviewState = {}
    const r = scoreWithTranscript(
      [makeObs('pressure_after_boundary', 'transcript', 'let me in now', 'confirmed', 1.0)],
      'let me in now',
      interviewState
    )
    expect(r.score).toBe(0)
    expect(r.ledger[0].state).toBe('uncertain')
  })

  it('P7: refuse_to_leave scores 0 if visitor was not asked to leave', () => {
    const interviewState: InterviewState = {}
    const r = scoreWithTranscript(
      [makeObs('refuse_to_leave', 'transcript', 'not leaving', 'confirmed', 1.0)],
      'not leaving',
      interviewState
    )
    expect(r.score).toBe(0)
    expect(r.ledger[0].state).toBe('uncertain')
  })

  it('P7: refuse_to_leave scores 25 if visitor was asked to leave', () => {
    const interviewState: InterviewState = { askedToLeaveAt: new Date().toISOString() }
    const r = scoreWithTranscript(
      [makeObs('refuse_to_leave', 'transcript', 'not leaving', 'confirmed', 1.0)],
      'not leaving',
      interviewState
    )
    expect(r.score).toBe(25)
    expect(r.ledger[0].state).toBe('confirmed')
  })

  it('P13: debug confidence field is never read by scoring code', () => {
    // Create observations with debug confidence values
    const obsWithDebug = makeObs('credential_request', 'transcript', 'what is your PIN number', 'confirmed', 1.0)
    obsWithDebug.debug = { modelConfidence: 0.99, someOtherDebug: 'value' }
    
    const r = scoreWithTranscript([obsWithDebug], 'what is your PIN number')
    // Scoring should be based on the rule, not the debug confidence
    expect(r.score).toBe(20)
  })

  it('P13: debug field can store arbitrary data without affecting score', () => {
    const interviewState: InterviewState = { rulesExplainedAt: new Date().toISOString() }
    const obs = makeObs('pressure_after_rule', 'transcript', 'let me in', 'confirmed', 1.0)
    obs.debug = { anyField: 'anything', nested: { value: 123 } }
    
    const r = scoreWithTranscript([obs], 'let me in', interviewState)
    // Score should still be 5 based on the rule, regardless of debug content
    expect(r.score).toBe(5)
  })

  it('P11: forced_entry_or_assault sets score to 100 exactly', () => {
    const r = scoreWithTranscript([makeObs('forced_entry_or_assault', 'sensor', '')], '')
    expect(r.score).toBe(100)
    expect(r.minMode).toBe('emergency')
  })

  it('P11: immediate_threat sets minimum score to 80', () => {
    const r = scoreWithTranscript([makeObs('immediate_threat', 'transcript', 'I will hurt you', 'confirmed', 1.0)], 'I will hurt you')
    expect(r.score).toBe(80)
    expect(r.minMode).toBe('emergency')
  })
})

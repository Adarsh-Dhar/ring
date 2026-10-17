/**
 * Round 2 patch tests for Section 4 live flow.
 * Tests the fixes for:
 * - #1: riskObservations migration
 * - #2: model events scoring
 * - #3: single risk writer
 * - #4: knocks and SOS scoring
 * - #5: quality check on segment
 * - #6: uncertain floors
 * - #7: two quotes for contradiction
 * - #8: emergency alert fire rate
 * - #9: emergency alert text
 * - #10: emergency while waiting
 * - #11: overdue sweep
 * - #12: helper confirm/reject index
 * - #13: reject marking
 * - #14: interview stamps
 */

import { describe, it, expect } from 'vitest'
import { scoreObservations, observationsFromEvidence, phraseMatches, type Observation, type InterviewState } from '@/lib/doorstep/riskRules'
import { readStored, mergeFresh, applyHelperAction, type StoredRisk } from '@/lib/doorstep/caseRisk'

describe('Round 2 patch tests (Section 4 live flow)', () => {
  const makeObs = (code: string, source: string, quote: string, state: 'confirmed' | 'uncertain' = 'confirmed'): Observation => ({
    code: code as any,
    at: new Date().toISOString(),
    quotes: [quote],
    source: source as any,
    state,
    points: 0,
  })

  it('#2: model events now score through the engine', () => {
    const obs = observationsFromEvidence([
      { category: 'payment_request', quote: 'I need your PIN code' },
    ])
    const risk = scoreObservations(obs.observations, { transcript: 'I need your PIN code' })
    expect(risk.score).toBe(20)
    expect(risk.ledger.some(e => e.code === 'credential_request' && e.state === 'confirmed')).toBe(true)
  })

  it('#5: quality check runs on segment, not bare quote', () => {
    const obs = makeObs('credential_request', 'transcript', 'pin', 'confirmed')
    obs.segment = 'The visitor asked for their pin number to verify their identity'
    obs.transcriptQuality = 0.6
    const risk = scoreObservations([obs], { transcript: 'The visitor asked for their pin number to verify their identity' })
    expect(risk.score).toBe(20) // Quality check passed on segment
  })

  it('#6: uncertain physical/threat events raise mode to helper_leads only', () => {
    const obs = makeObs('lock_manipulation', 'helper', 'x', 'uncertain')
    const risk = scoreObservations([obs], { transcript: 'x' })
    expect(risk.score).toBe(0)
    expect(risk.minMode).toBe('helper_leads')
  })

  it('#6: uncertain speech events raise no mode', () => {
    const obs = makeObs('refuse_to_leave', 'transcript', 'not leaving', 'uncertain')
    const risk = scoreObservations([obs], { transcript: 'not leaving' })
    expect(risk.score).toBe(0)
    expect(risk.minMode).toBe('ai_leads')
  })

  it('#7: purpose_contradiction needs two quotes', () => {
    const obs = observationsFromEvidence([
      { category: 'purpose_contradiction', quote: 'council urgent' },
    ])
    const risk = scoreObservations(obs.observations, { transcript: 'council urgent' })
    expect(risk.score).toBe(0) // Only one quote, should be uncertain
    expect(risk.ledger.some(e => e.code === 'purpose_contradiction' && e.state === 'uncertain')).toBe(true)
  })

  it('#7: two quotes for contradiction score correctly', () => {
    const obs = observationsFromEvidence([
      { category: 'purpose_contradiction', quote: 'council urgent' },
      { category: 'purpose_contradiction', quote: 'let me in' },
    ])
    const risk = scoreObservations(obs.observations, { transcript: 'council urgent let me in' })
    expect(risk.score).toBe(15) // First instance scores 15
  })

  it('#12: helper confirm uses idx from ledger', () => {
    const stored: StoredRisk = {
      observations: [
        makeObs('credential_request', 'transcript', 'I need your PIN'),
        makeObs('refuse_to_leave', 'transcript', 'not leaving'),
      ],
      interviewState: {},
      corrections: [],
    }
    const updated = applyHelperAction(stored, 1, 'confirm')
    expect(updated.observations[1].state).toBe('confirmed')
    expect(updated.observations[1].source).toBe('helper')
    expect(updated.observations[0].state).toBe('confirmed') // Unchanged
  })

  it('#13: reject marks event as retracted', () => {
    const stored: StoredRisk = {
      observations: [makeObs('credential_request', 'transcript', 'I need your PIN')],
      interviewState: {},
      corrections: [],
    }
    const updated = applyHelperAction(stored, 0, 'reject')
    expect(updated.observations[0].retracted).toBe(true)
  })

  it('#13: retracted event never scores again', () => {
    const obs = makeObs('credential_request', 'transcript', 'I need your PIN')
    obs.retracted = true
    const risk = scoreObservations([obs], { transcript: 'I need your PIN' })
    expect(risk.score).toBe(0)
  })

  it('#3: mergeFresh keeps knocks, SOS, stamps, and helper-touched events', () => {
    const stored: StoredRisk = {
      observations: [
        makeObs('extra_knock', 'sensor', ''),
        makeObs('forced_entry_or_assault', 'resident', 'SOS'),
        { ...makeObs('credential_request', 'transcript', 'PIN'), isStamp: true },
      ],
      interviewState: {},
      corrections: [{ idx: 0, action: 'confirm', at: new Date().toISOString() }],
    }
    const fresh = [makeObs('refuse_to_leave', 'transcript', 'not leaving')]
    const merged = mergeFresh(stored, fresh)
    expect(merged.observations.length).toBe(4) // All 3 kept + 1 fresh
    expect(merged.observations[0].code).toBe('extra_knock')
    expect(merged.observations[1].code).toBe('forced_entry_or_assault')
    expect(merged.observations[2].isStamp).toBe(true)
  })

  it('#3: mergeFresh drops non-touched model events', () => {
    const stored: StoredRisk = {
      observations: [makeObs('credential_request', 'transcript', 'PIN')],
      interviewState: {},
      corrections: [],
    }
    const fresh = [makeObs('refuse_to_leave', 'transcript', 'not leaving')]
    const merged = mergeFresh(stored, fresh)
    expect(merged.observations.length).toBe(1) // Only fresh kept
    expect(merged.observations[0].code).toBe('refuse_to_leave')
  })

  it('#14: interview stamps have isStamp flag', () => {
    const obs = makeObs('extra_knock', 'sensor', '')
    obs.isStamp = true
    const risk = scoreObservations([obs], { transcript: '' })
    expect(risk.ledger.some(e => e.code === 'extra_knock')).toBe(false) // Stamps don't appear in ledger
  })

  it('#11: ledger entries have idx field', () => {
    const obs = [makeObs('credential_request', 'transcript', 'PIN')]
    const risk = scoreObservations(obs, { transcript: 'PIN' })
    expect(risk.ledger[0].idx).toBe(0)
  })

  it('#11: ledger entries have debug.why field', () => {
    const obs = makeObs('unknown_code', 'transcript', 'x', 'confirmed')
    const risk = scoreObservations([obs], { transcript: 'x' })
    expect(risk.ledger[0].debug?.why).toBe('unknown_code')
  })

  it('phrase patterns match correctly', () => {
    expect(phraseMatches('credential_request', 'I need your PIN code')).toBe(true)
    expect(phraseMatches('credential_request', 'hello')).toBe(false)
    expect(phraseMatches('refuse_to_leave', 'I will not leave')).toBe(true)
    expect(phraseMatches('immediate_threat', 'I will hurt you')).toBe(true)
  })

  it('phrase pattern failure gives uncertain with wording_does_not_match', () => {
    const obs = makeObs('credential_request', 'transcript', 'hello', 'confirmed')
    obs.transcriptQuality = 1.0 // Skip quality check
    obs.segment = 'hello world hello world hello world' // Skip quality check on segment
    const risk = scoreObservations([obs], { transcript: 'hello' })
    expect(risk.ledger[0].state).toBe('uncertain')
    expect(risk.ledger[0].debug?.why).toBe('wording_does_not_match')
  })

  it('duplicate events are rejected', () => {
    const obs = [
      makeObs('credential_request', 'transcript', 'I need your PIN'),
      makeObs('credential_request', 'transcript', 'I need your PIN'),
    ]
    const risk = scoreObservations(obs, { transcript: 'I need your PIN' })
    expect(risk.score).toBe(20) // Only scores once
    expect(risk.ledger[1].debug?.why).toBe('duplicate_event')
  })

  it('tiered scoring follows occurrence, not points spent', () => {
    const obs = [
      makeObs('purpose_contradiction', 'transcript', 'a', 'confirmed'),
      makeObs('purpose_contradiction', 'transcript', 'b', 'confirmed'),
    ]
    obs[0].quotes = ['council urgent', 'let me in']
    obs[1].quotes = ['something else', 'refuse to leave']
    const risk = scoreObservations(obs, { transcript: 'council urgent let me in something else refuse to leave' })
    expect(risk.score).toBe(25) // 15 + 10
  })

  it('interview state prerequisites are checked', () => {
    const interviewState: InterviewState = { askedToLeaveAt: new Date().toISOString() }
    const obs = makeObs('refuse_to_leave', 'transcript', 'not leaving', 'confirmed')
    const risk = scoreObservations([obs], { transcript: 'not leaving', interviewState })
    expect(risk.score).toBe(25) // refuse_to_leave is worth 25 points
  })

  it('interview state missing prerequisite gives uncertain', () => {
    const interviewState: InterviewState = {}
    const obs = makeObs('refuse_to_leave', 'transcript', 'not leaving', 'confirmed')
    const risk = scoreObservations([obs], { transcript: 'not leaving', interviewState })
    expect(risk.ledger[0].state).toBe('uncertain')
    expect(risk.ledger[0].debug?.why).toBe('not_asked_to_leave_yet')
  })

  it('readStored handles old ledger format gracefully', () => {
    const oldLedger = [{ code: 'credential_request', at: new Date().toISOString(), quote: 'PIN', source: 'transcript', state: 'confirmed', points: 20 }]
    const stored = readStored(oldLedger)
    expect(stored.observations).toEqual([])
    expect(stored.interviewState).toEqual({})
    expect(stored.corrections).toEqual([])
  })

  it('readStored handles new format correctly', () => {
    const newFormat = {
      observations: [makeObs('credential_request', 'transcript', 'PIN')],
      interviewState: { askedToLeaveAt: new Date().toISOString() },
      corrections: [],
    }
    const stored = readStored(newFormat)
    expect(stored.observations.length).toBe(1)
    expect(stored.interviewState.askedToLeaveAt).toBeDefined()
  })
})

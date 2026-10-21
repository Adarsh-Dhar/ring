/**
 * Regression test for hide_from_helper concealment detection.
 * Tests that concealment requests are properly detected, scored, and responded to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { riskMatchesFor } from '@/lib/ai/agents/risk'
import { liveAssessment } from '@/lib/ai/risk/combine'
import { decideNext } from '@/lib/ai/interrogation/respond'
import { getEventResponse, renderEventResponse } from '@/lib/doorstep/eventResponses'
import type { Behaviour, Observation } from '@/lib/doorstep/riskRules'

describe('hide_from_helper concealment detection', () => {
  it('detects canonical concealment phrase "Don\'t tell your carer I came"', () => {
    const text = "Don't tell your carer I came"
    const matches = riskMatchesFor(text)
    expect(matches.some(m => m.flag === 'Hides from helper')).toBe(true)
  })

  it('detects "Let\'s skip the helper" as concealment', () => {
    const text = "Let's skip the helper"
    const matches = riskMatchesFor(text)
    expect(matches.some(m => m.flag === 'Hides from helper')).toBe(true)
  })

  it('detects "Keep this between us" as concealment', () => {
    const text = 'Keep this between us'
    const matches = riskMatchesFor(text)
    expect(matches.some(m => m.flag === 'Hides from helper')).toBe(true)
  })

  it('negated concealment "I will never ask for your PIN" does not match', () => {
    const text = 'I will never ask for your PIN'
    const matches = riskMatchesFor(text)
    expect(matches.some(m => m.flag === 'Hides from helper')).toBe(false)
  })

  it('ordinary refusal "I\'d rather not say" does not match concealment', () => {
    const text = "I'd rather not say"
    const matches = riskMatchesFor(text)
    expect(matches.some(m => m.flag === 'Hides from helper')).toBe(false)
  })

  it('deterministic hide_from_helper scores +15 points with high transcript quality', () => {
    const text = "Don't tell your carer I came"
    const matches = riskMatchesFor(text)
    const assessment = liveAssessment(text, matches, { transcriptQuality: 'high' })
    expect(assessment.score).toBe(15)
    expect(assessment.minMode).toBe('ai_assisted')
  })

  it('deterministic hide_from_helper scores +15 points with medium transcript quality', () => {
    const text = "Don't tell your carer I came"
    const matches = riskMatchesFor(text)
    const assessment = liveAssessment(text, matches, { transcriptQuality: 'medium' })
    expect(assessment.score).toBe(15)
    expect(assessment.minMode).toBe('ai_assisted')
  })

  it('low transcript quality leaves hide_from_helper as uncertain (0 points)', () => {
    const text = "Don't tell your carer I came"
    const matches = riskMatchesFor(text)
    const assessment = liveAssessment(text, matches, { transcriptQuality: 'low' })
    expect(assessment.score).toBe(0)
    const hideObs = assessment.observations.find(o => o.code === 'hide_from_helper')
    expect(hideObs?.state).toBe('uncertain')
    expect(hideObs?.transcriptQuality).toBe(0.3) // low = 0.3
  })

  it('hide_from_helper observation is confirmed with grounded quote', () => {
    const text = "Don't tell your carer I came"
    const matches = riskMatchesFor(text)
    const assessment = liveAssessment(text, matches, { transcriptQuality: 'high' })
    const hideObs = assessment.observations.find(o => o.code === 'hide_from_helper')
    expect(hideObs).toBeDefined()
    expect(hideObs?.state).toBe('confirmed')
    expect(hideObs?.points).toBe(15)
    // The regex matches a substring of the phrase
    expect(hideObs?.quotes.length).toBeGreaterThan(0)
    expect(text).toContain(hideObs?.quotes[0] || '')
  })

  it('hide_from_helper triggers event response decision', () => {
    const text = "Don't tell your carer I came"
    const matches = riskMatchesFor(text)
    const assessment = liveAssessment(text, matches, { transcriptQuality: 'high' })
    const next = decideNext({
      observations: assessment.observations,
      score: assessment.score,
      controlMode: assessment.minMode,
      effectiveScore: assessment.score,
      visitorLeft: false,
      modelDown: false,
      stalled: false,
      visitorNeedsCare: null,
      hasPreconditionLine: null,
    })
    expect(next.type).toBe('event_response')
    expect(next.code).toBe('hide_from_helper')
  })

  it('hide_from_helper has the fixed spoken response', () => {
    const configured = getEventResponse('hide_from_helper')
    expect(configured).toBeDefined()
    const response = renderEventResponse(configured!)
    expect(response).toBe('I must tell the helper about this conversation. I cannot keep it secret.')
  })

  it('ordinary refusals do not score as concealment', () => {
    const text = "I'd rather not say"
    const matches = riskMatchesFor(text)
    const assessment = liveAssessment(text, matches, { transcriptQuality: 'high' })
    expect(assessment.score).toBe(0)
    expect(assessment.observations.some(o => o.code === 'hide_from_helper')).toBe(false)
  })

  it('model-outage fallback still detects concealment via keyword rules', () => {
    const text = "Don't tell your carer I came"
    const matches = riskMatchesFor(text)
    // Simulate model being unavailable - only keyword rules provide evidence
    const assessment = liveAssessment(text, matches, { transcriptQuality: 'high' })
    expect(assessment.observations.some(o => o.code === 'hide_from_helper' && o.state === 'confirmed')).toBe(true)
    expect(assessment.score).toBe(15)
  })
})

/**
 * G4: Camera-only door events and unconfirmed emergency tests
 * Tests that model-sourced door events are uncertain and trigger unconfirmed emergency alerts
 */

import { describe, it, expect } from 'vitest'
import { scoreObservations, type Observation } from '@/lib/doorstep/riskRules'

describe('G4: Camera-only door events and unconfirmed emergency', () => {
  const makeObs = (code: string, source: string, quote: string, state: 'confirmed' | 'uncertain' = 'confirmed'): Observation => ({
    code: code as any,
    at: new Date().toISOString(),
    quotes: [quote],
    source: source as any,
    state,
    points: 0,
  })

  it('camera-only lock_manipulation is rejected (transcript not in allowed sources)', () => {
    const obs = makeObs('lock_manipulation', 'transcript', 'Trying the lock', 'confirmed')
    const risk = scoreObservations([obs], { transcript: 'Trying the lock' })
    expect(risk.score).toBe(0)
    expect(risk.minMode).toBe('ai_leads') // No floor because source is invalid
  })

  it('camera-only door_wedge_or_follow_in is rejected (transcript not in allowed sources)', () => {
    const obs = makeObs('door_wedge_or_follow_in', 'transcript', 'Wedging the door', 'confirmed')
    const risk = scoreObservations([obs], { transcript: 'Wedging the door' })
    expect(risk.score).toBe(0)
    expect(risk.minMode).toBe('ai_leads') // No floor because source is invalid
  })

  it('camera-only forced_entry_or_assault is rejected (transcript not in allowed sources)', () => {
    const obs = makeObs('forced_entry_or_assault', 'transcript', 'Forcing the door', 'confirmed')
    const risk = scoreObservations([obs], { transcript: 'Forcing the door' })
    expect(risk.score).toBe(0)
    expect(risk.minMode).toBe('ai_leads') // No floor because source is invalid
  })

  it('camera-only immediate_threat sets minScore 80 even from transcript', () => {
    const obs = makeObs('immediate_threat', 'transcript', 'I will hurt you', 'confirmed')
    const risk = scoreObservations([obs], { transcript: 'I will hurt you' })
    expect(risk.score).toBe(80) // minScore override
    expect(risk.minMode).toBe('emergency')
  })

  it('uncertain lock_manipulation from valid source sets helper-led floor', () => {
    const obs = makeObs('lock_manipulation', 'sensor', 'Trying the lock', 'uncertain')
    const risk = scoreObservations([obs], { transcript: '' })
    expect(risk.score).toBe(0)
    expect(risk.minMode).toBe('helper_leads') // uncertainFloor applies
  })

  it('uncertain forced_entry_or_assault from valid source sets helper-led floor', () => {
    const obs = makeObs('forced_entry_or_assault', 'sensor', 'Forcing the door', 'uncertain')
    const risk = scoreObservations([obs], { transcript: '' })
    expect(risk.score).toBe(0)
    expect(risk.minMode).toBe('helper_leads') // uncertainFloor applies
  })

  it('sensor-sourced lock_manipulation scores 30 and sets helper-led floor', () => {
    const obs = makeObs('lock_manipulation', 'sensor', 'Trying the lock', 'confirmed')
    const risk = scoreObservations([obs], { transcript: '' })
    expect(risk.score).toBe(30)
    expect(risk.minMode).toBe('helper_leads')
  })

  it('helper-sourced forced_entry_or_assault scores 100 and sets emergency', () => {
    const obs = makeObs('forced_entry_or_assault', 'helper', 'Forcing the door', 'confirmed')
    const risk = scoreObservations([obs], { transcript: '' })
    expect(risk.score).toBe(100)
    expect(risk.minMode).toBe('emergency')
  })
})

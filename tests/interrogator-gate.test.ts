import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isUnplannedVisit } from '@/lib/ai/interrogation/gate'

describe('isUnplannedVisit gate', () => {
  it('returns false for planned expected visits', () => {
    expect(isUnplannedVisit({ kind: 'visitor', lane: 'expected', expectedId: null, recurringId: null })).toBe(false)
  })

  it('returns false when expectedId is set', () => {
    expect(isUnplannedVisit({ kind: 'visitor', lane: 'normal', expectedId: 'some-id', recurringId: null })).toBe(false)
  })

  it('returns false when recurringId is set', () => {
    expect(isUnplannedVisit({ kind: 'visitor', lane: 'normal', expectedId: null, recurringId: 'some-id' })).toBe(false)
  })

  it('returns true for normal lane without expectedId or recurringId', () => {
    expect(isUnplannedVisit({ kind: 'visitor', lane: 'normal', expectedId: null, recurringId: null })).toBe(true)
  })

  it('returns false for non-visitor kinds', () => {
    expect(isUnplannedVisit({ kind: 'sos', lane: 'normal', expectedId: null, recurringId: null })).toBe(false)
  })

  it('returns true for a demoted case (lane: normal, no expectedId/recurringId)', () => {
    expect(isUnplannedVisit({ kind: 'visitor', lane: 'normal', expectedId: null, recurringId: null })).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import { toRow, fromRow } from '../lib/db/helpers'

describe('helper row mapping', () => {
  it('round-trips a helper', () => {
    const h = { id: 'h1', name: 'Mom', phone: '+919812345671', emoji: '👩', consent: 'approved' as const, consentAt: 1_760_000_000_000, tokenEpoch: 3 }
    expect(fromRow(toRow(h, 0))).toEqual(h)
  })
  it('keeps a missing consentAt as undefined', () => {
    const h = { id: 'h2', name: 'Dad', phone: '+919812345672', emoji: '👨', consent: 'pending' as const }
    expect(fromRow(toRow(h, 1)).consentAt).toBeUndefined()
  })
})

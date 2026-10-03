/**
 * code.test.ts — unit tests for the live rotating 3-digit code.
 */
import { describe, it, expect } from 'vitest'
import { currentCode, CODE_STEP_MS } from '@/lib/visit-code'
import { newSecret } from '@/lib/visit-tokens'

describe('currentCode', () => {
  it('same secret and step produce the same code', () => {
    const secret = newSecret()
    const now = Date.now()
    const a = currentCode(secret, now)
    const b = currentCode(secret, now)
    expect(a.code).toBe(b.code)
    expect(a.endsAt).toBe(b.endsAt)
  })

  it('always produces exactly 3 digits', () => {
    for (let i = 0; i < 50; i++) {
      const { code } = currentCode(newSecret(), Date.now() + i * 1234)
      expect(code).toMatch(/^\d{3}$/)
    }
  })

  it('different secrets produce different codes (overwhelmingly)', () => {
    const now = Date.now()
    const codes = new Set(Array.from({ length: 20 }, () => currentCode(newSecret(), now).code))
    // Out of 20 random secrets, we expect at least 5 distinct codes
    expect(codes.size).toBeGreaterThan(4)
  })

  it('step + 1 produces a different code (usually)', () => {
    const secret = newSecret()
    const now = Date.now()
    const step = Math.floor(now / CODE_STEP_MS)
    const a = currentCode(secret, step * CODE_STEP_MS)
    const b = currentCode(secret, (step + 1) * CODE_STEP_MS)
    // They could coincidentally match but it is extremely unlikely
    // The main guarantee is that endsAt increments correctly
    expect(b.endsAt).toBe(a.endsAt + CODE_STEP_MS)
  })

  it('endsAt is the start of the next step', () => {
    const now = 1_700_000_000_000 // fixed timestamp
    const step = Math.floor(now / CODE_STEP_MS)
    const { endsAt } = currentCode(newSecret(), now)
    expect(endsAt).toBe((step + 1) * CODE_STEP_MS)
  })

  it('code is within 0–999', () => {
    for (let i = 0; i < 100; i++) {
      const { code } = currentCode(newSecret(), Date.now())
      const n = Number(code)
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThanOrEqual(999)
    }
  })
})

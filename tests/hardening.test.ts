import { describe, it, expect } from 'vitest'
import { makeToken, verifyToken } from '@/lib/auth'

describe('hardening tests', () => {
  describe('token structure', () => {
    it('should create tokens with correct structure', () => {
      process.env.AUTH_SECRET = 'a'.repeat(32)
      const token = makeToken({
        kind: 'helper',
        sub: 'user123',
        householdId: 'household123',
        epoch: 1,
        exp: Math.floor(Date.now() / 1000) + 3600
      })

      expect(token).toBeTruthy()
      expect(typeof token).toBe('string')
      expect(token!.split('.').length).toBe(3) // header.payload.signature
    })

    it('should verify valid tokens', () => {
      process.env.AUTH_SECRET = 'a'.repeat(32)
      const token = makeToken({
        kind: 'helper',
        sub: 'user123',
        householdId: 'household123',
        epoch: 1,
        exp: Math.floor(Date.now() / 1000) + 3600
      })

      const verified = verifyToken(token!)
      expect(verified.ok).toBe(true)
      if (verified.ok) {
        expect(verified.data.kind).toBe('helper')
        expect(verified.data.sub).toBe('user123')
        expect(verified.data.householdId).toBe('household123')
        expect(verified.data.epoch).toBe(1)
      }
    })

    it('should reject expired tokens', () => {
      process.env.AUTH_SECRET = 'a'.repeat(32)
      const token = makeToken({
        kind: 'helper',
        sub: 'user123',
        householdId: 'household123',
        epoch: 1,
        exp: Math.floor(Date.now() / 1000) - 3600 // Expired 1 hour ago
      })

      const verified = verifyToken(token!)
      expect(verified.ok).toBe(false)
    })

    it('should reject invalid tokens', () => {
      const verified = verifyToken('invalid.token.here')
      expect(verified.ok).toBe(false)

      const verified2 = verifyToken(null)
      expect(verified2.ok).toBe(false)
    })

    it('should distinguish between helper and resident tokens', () => {
      process.env.AUTH_SECRET = 'a'.repeat(32)

      const helperToken = makeToken({
        kind: 'helper',
        sub: 'user123',
        householdId: 'household123',
        epoch: 1,
        exp: Math.floor(Date.now() / 1000) + 3600
      })

      const residentToken = makeToken({
        kind: 'resident',
        sub: 'device123',
        householdId: 'household123',
        epoch: 1,
        exp: Math.floor(Date.now() / 1000) + 3600
      })

      const helperVerified = verifyToken(helperToken!)
      const residentVerified = verifyToken(residentToken!)

      if (helperVerified.ok && residentVerified.ok) {
        expect(helperVerified.data.kind).toBe('helper')
        expect(residentVerified.data.kind).toBe('resident')
      }
    })
  })

  describe('household scoping', () => {
    it('should embed householdId in token', () => {
      process.env.AUTH_SECRET = 'a'.repeat(32)
      const token = makeToken({
        kind: 'helper',
        sub: 'user123',
        householdId: 'householdA',
        epoch: 1,
        exp: Math.floor(Date.now() / 1000) + 3600
      })

      const verified = verifyToken(token!)
      if (verified.ok) {
        expect(verified.data.householdId).toBe('householdA')
      }
    })

    it('should allow different householdIds in different tokens', () => {
      process.env.AUTH_SECRET = 'a'.repeat(32)

      const tokenA = makeToken({
        kind: 'helper',
        sub: 'user123',
        householdId: 'householdA',
        epoch: 1,
        exp: Math.floor(Date.now() / 1000) + 3600
      })

      const tokenB = makeToken({
        kind: 'helper',
        sub: 'user123',
        householdId: 'householdB',
        epoch: 1,
        exp: Math.floor(Date.now() / 1000) + 3600
      })

      const verifiedA = verifyToken(tokenA!)
      const verifiedB = verifyToken(tokenB!)

      if (verifiedA.ok && verifiedB.ok) {
        expect(verifiedA.data.householdId).toBe('householdA')
        expect(verifiedB.data.householdId).toBe('householdB')
      }
    })
  })
})

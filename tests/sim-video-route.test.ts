import { describe, it, expect } from 'vitest'
import { sanitiseDevice } from '@/lib/sim-videos/utils'

describe('Simulator video route', () => {
  describe('Device allowlist', () => {
    it('accepts sim-front-door', () => {
      expect(sanitiseDevice('sim-front-door')).toBe('sim-front-door')
    })

    it('accepts sim-back-door', () => {
      expect(sanitiseDevice('sim-back-door')).toBe('sim-back-door')
    })

    it('rejects unknown device names', () => {
      expect(sanitiseDevice('malicious-device')).toBeNull()
      expect(sanitiseDevice('../../etc/passwd')).toBeNull()
      expect(sanitiseDevice('')).toBeNull()
    })
  })
})

/**
 * P12: Test that ALWAYS_PROHIBITED actions stay prohibited in every mode
 */

import { describe, it, expect } from 'vitest'
import { permittedActions, DEFAULT_PREFERENCES, ALWAYS_PROHIBITED } from '@/lib/doorstep/residentPreferences'

describe('P12: Resident delegation settings', () => {
  it('ALWAYS_PROHIBITED actions are never in allowed list for any mode', () => {
    const modes = ['ai_leads', 'ai_assisted', 'helper_leads', 'helper_only', 'emergency'] as const

    for (const mode of modes) {
      const { allowed, prohibited } = permittedActions(DEFAULT_PREFERENCES, mode)

      // Check that no prohibited action is in the allowed list
      for (const prohibitedAction of ALWAYS_PROHIBITED) {
        expect(allowed).not.toContain(prohibitedAction)
      }

      // Check that prohibited list includes all ALWAYS_PROHIBITED actions
      for (const prohibitedAction of ALWAYS_PROHIBITED) {
        expect(prohibited).toContain(prohibitedAction)
      }
    }
  })

  it('ALWAYS_PROHIBITED list contains the three hard safety rules', () => {
    expect(ALWAYS_PROHIBITED).toContain('unlock_door')
    expect(ALWAYS_PROHIBITED).toContain('disclose_access_credentials')
    expect(ALWAYS_PROHIBITED).toContain('compel_resident_to_open')
  })

  it('sound_alarm and call_emergency are only allowed in emergency mode', () => {
    const emergencyModes = permittedActions(DEFAULT_PREFERENCES, 'emergency')
    const nonEmergencyModes = permittedActions(DEFAULT_PREFERENCES, 'helper_leads')

    expect(emergencyModes.allowed).toContain('sound_alarm')
    expect(emergencyModes.allowed).toContain('call_emergency')
    expect(nonEmergencyModes.allowed).not.toContain('sound_alarm')
    expect(nonEmergencyModes.allowed).not.toContain('call_emergency')
  })

  it('Delegation can be set to ai, helper, or resident_only', () => {
    const testPrefs = {
      ...DEFAULT_PREFERENCES,
      delegation: {
        greet_visitor: 'ai',
        ask_purpose: 'helper',
        accept_parcel: 'resident_only',
      } as any,
    }

    const { allowed } = permittedActions(testPrefs, 'ai_leads')

    // AI mode: only AI-delegated actions are allowed
    expect(allowed).toContain('greet_visitor')
    expect(allowed).not.toContain('ask_purpose')
    expect(allowed).not.toContain('accept_parcel')
  })
})

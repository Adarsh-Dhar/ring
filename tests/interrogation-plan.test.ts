/**
 * Unit tests for the interview plan (lib/ai/interrogation/plan.ts).
 * Pure functions, no model, no database, so they run fast and catch logic bugs.
 */
import { describe, it, expect } from 'vitest'
import {
  SLOT_KEYS,
  SLOT_LABEL,
  MAX_ASKS_PER_SLOT,
  MAX_TURNS,
  cleanObs,
  foldPlan,
  isEchoOfName,
  requiredSlots,
  nextFocus,
  bankQuestion,
  coverageSummary,
  coverageFacts,
  coverageLines,
  type PlanTurn,
  type PlanState,
  type Slot,
  type Status,
} from '@/lib/ai/interrogation/plan'

describe('cleanObs', () => {
  it('filters unknown slots and statuses', () => {
    const raw = { purpose: 'specific', name: 'vague', fakeSlot: 'specific', organisation: 'badStatus' as any }
    const out = cleanObs(raw)
    expect(out).toEqual({ purpose: 'specific', name: 'vague' })
  })

  it('accepts valid slots and statuses', () => {
    const raw = { purpose: 'specific', name: 'vague', relation: 'refused' }
    const out = cleanObs(raw)
    expect(out).toEqual(raw)
  })

  it('handles null and undefined', () => {
    expect(cleanObs(null)).toEqual({})
    expect(cleanObs(undefined)).toEqual({})
  })
})

describe('foldPlan', () => {
  it('starts with blank state', () => {
    const state = foldPlan([])
    expect(state.status.purpose).toBe('missing')
    expect(state.asks.purpose).toBe(0)
    expect(state.claimsOrg).toBe(false)
  })

  it('merges observations, latest non-missing wins', () => {
    const turns: PlanTurn[] = [
      { obs: { purpose: 'vague' } },
      { obs: { purpose: 'specific' } },
    ]
    const state = foldPlan(turns)
    expect(state.status.purpose).toBe('specific')
  })

  it('counts asks from focus', () => {
    const turns: PlanTurn[] = [
      { focus: 'purpose' },
      { focus: 'purpose' },
    ]
    const state = foldPlan(turns)
    expect(state.asks.purpose).toBe(2)
  })

  it('elevates riskHint to highest seen', () => {
    const turns: PlanTurn[] = [
      { riskHint: 'low' },
      { riskHint: 'high' },
      { riskHint: 'none' },
    ]
    const state = foldPlan(turns)
    expect(state.riskHint).toBe('high')
  })

  it('flags claimsOrg and personalTie if any turn has them', () => {
    const turns: PlanTurn[] = [
      { claimsOrg: true },
      { personalTie: true },
    ]
    const state = foldPlan(turns)
    expect(state.claimsOrg).toBe(true)
    expect(state.personalTie).toBe(true)
  })
})

describe('isEchoOfName', () => {
  it('detects when visitor only repeats the first name', () => {
    expect(isEchoOfName('Adarsh', 'Adarsh Patel')).toBe(true)
    expect(isEchoOfName('adarsh', 'Adarsh')).toBe(true)
    expect(isEchoOfName('Mr Adarsh', 'Adarsh')).toBe(true)
  })

  it('returns false when visitor says more than the first name', () => {
    expect(isEchoOfName('Adarsh Patel', 'Adarsh Patel')).toBe(false)
    expect(isEchoOfName('Dr Adarsh', 'Adarsh')).toBe(true)  // "Dr" is filtered as a title, so it's an echo
    expect(isEchoOfName('the owner', 'Adarsh')).toBe(false)
  })

  it('handles null inputs', () => {
    expect(isEchoOfName(null, 'Adarsh')).toBe(false)
    expect(isEchoOfName('Adarsh', null)).toBe(false)
  })
})

describe('requiredSlots', () => {
  it('always asks purpose and name', () => {
    const state: PlanState = {
      status: { purpose: 'missing', name: 'missing', organisation: 'missing', relation: 'missing', target: 'missing', proof: 'missing', companions: 'missing', spatial: 'missing' },
      asks: { purpose: 0, name: 0, organisation: 0, relation: 0, target: 0, proof: 0, companions: 0, spatial: 0 },
      claimsOrg: false, personalTie: false, echoTarget: false, riskHint: 'none',
    }
    const req = requiredSlots(state, 0)
    expect(req).toContain('purpose')
    expect(req).toContain('name')
  })

  it('adds target if not an echo', () => {
    const state: PlanState = {
      status: { purpose: 'missing', name: 'missing', organisation: 'missing', relation: 'missing', target: 'missing', proof: 'missing', companions: 'missing', spatial: 'missing' },
      asks: { purpose: 0, name: 0, organisation: 0, relation: 0, target: 0, proof: 0, companions: 0, spatial: 0 },
      claimsOrg: false, personalTie: false, echoTarget: false, riskHint: 'none',
    }
    const req = requiredSlots(state, 0)
    expect(req).toContain('target')
  })

  it('skips target if echo, adds relation instead', () => {
    const state: PlanState = {
      status: { purpose: 'missing', name: 'missing', organisation: 'missing', relation: 'missing', target: 'missing', proof: 'missing', companions: 'missing', spatial: 'missing' },
      asks: { purpose: 0, name: 0, organisation: 0, relation: 0, target: 0, proof: 0, companions: 0, spatial: 0 },
      claimsOrg: false, personalTie: false, echoTarget: true, riskHint: 'none',
    }
    const req = requiredSlots(state, 0)
    expect(req).not.toContain('target')
    expect(req).toContain('relation')
  })

  it('adds organisation and proof if claimsOrg', () => {
    const state: PlanState = {
      status: { purpose: 'missing', name: 'missing', organisation: 'missing', relation: 'missing', target: 'missing', proof: 'missing', companions: 'missing', spatial: 'missing' },
      asks: { purpose: 0, name: 0, organisation: 0, relation: 0, target: 0, proof: 0, companions: 0, spatial: 0 },
      claimsOrg: true, personalTie: false, echoTarget: false, riskHint: 'none',
    }
    const req = requiredSlots(state, 0)
    expect(req).toContain('organisation')
    expect(req).toContain('proof')
  })

  it('adds companions and spatial when heightened (after 2 answers)', () => {
    const state: PlanState = {
      status: { purpose: 'vague', name: 'missing', organisation: 'missing', relation: 'missing', target: 'missing', proof: 'missing', companions: 'missing', spatial: 'missing' },
      asks: { purpose: 1, name: 0, organisation: 0, relation: 0, target: 0, proof: 0, companions: 0, spatial: 0 },
      claimsOrg: false, personalTie: false, echoTarget: false, riskHint: 'none',
    }
    const req = requiredSlots(state, 2)
    expect(req).toContain('companions')
    expect(req).toContain('spatial')
  })
})

describe('nextFocus', () => {
  it('returns null when max turns reached', () => {
    const state: PlanState = {
      status: { purpose: 'missing', name: 'missing', organisation: 'missing', relation: 'missing', target: 'missing', proof: 'missing', companions: 'missing', spatial: 'missing' },
      asks: { purpose: 0, name: 0, organisation: 0, relation: 0, target: 0, proof: 0, companions: 0, spatial: 0 },
      claimsOrg: false, personalTie: false, echoTarget: false, riskHint: 'none',
    }
    expect(nextFocus(state, MAX_TURNS)).toBe(null)
  })

  it('returns null when all required slots are specific', () => {
    const state: PlanState = {
      status: { purpose: 'specific', name: 'specific', organisation: 'missing', relation: 'missing', target: 'specific', proof: 'missing', companions: 'missing', spatial: 'missing' },
      asks: { purpose: 1, name: 1, organisation: 0, relation: 0, target: 1, proof: 0, companions: 0, spatial: 0 },
      claimsOrg: false, personalTie: false, echoTarget: false, riskHint: 'none',
    }
    expect(nextFocus(state, 0)).toBe(null)
  })

  it('picks least-asked slot', () => {
    const state: PlanState = {
      status: { purpose: 'specific', name: 'missing', organisation: 'missing', relation: 'missing', target: 'missing', proof: 'missing', companions: 'missing', spatial: 'missing' },
      asks: { purpose: 1, name: 0, organisation: 0, relation: 0, target: 0, proof: 0, companions: 0, spatial: 0 },
      claimsOrg: false, personalTie: false, echoTarget: false, riskHint: 'none',
    }
    expect(nextFocus(state, 0)).toBe('name')  // name asked 0 times, purpose already asked 1
  })

  it('breaks ties by priority order', () => {
    const state: PlanState = {
      status: { purpose: 'missing', name: 'missing', organisation: 'missing', relation: 'missing', target: 'missing', proof: 'missing', companions: 'missing', spatial: 'missing' },
      asks: { purpose: 0, name: 0, organisation: 0, relation: 0, target: 0, proof: 0, companions: 0, spatial: 0 },
      claimsOrg: false, personalTie: false, echoTarget: false, riskHint: 'none',
    }
    expect(nextFocus(state, 0)).toBe('purpose')  // purpose is first in ORDER
  })

  it('skips slots asked MAX_ASKS_PER_SLOT times', () => {
    const state: PlanState = {
      status: { purpose: 'vague', name: 'missing', organisation: 'missing', relation: 'missing', target: 'missing', proof: 'missing', companions: 'missing', spatial: 'missing' },
      asks: { purpose: 2, name: 0, organisation: 0, relation: 0, target: 0, proof: 0, companions: 0, spatial: 0 },
      claimsOrg: false, personalTie: false, echoTarget: false, riskHint: 'none',
    }
    expect(nextFocus(state, 0)).toBe('name')  // purpose at max, name next
  })
})

describe('bankQuestion', () => {
  it('returns first phrasing on first ask', () => {
    expect(bankQuestion('purpose', 0)).toBe('What exactly is the reason for your visit?')
  })

  it('returns second phrasing on second ask', () => {
    expect(bankQuestion('purpose', 1)).toBe('Sorry, I need a bit more detail. What is it about, specifically?')
  })

  it('clamps to second phrasing for higher asks', () => {
    expect(bankQuestion('purpose', 5)).toBe('Sorry, I need a bit more detail. What is it about, specifically?')
  })
})

describe('coverageSummary', () => {
  it('shows specific slots as given', () => {
    const state: PlanState = {
      status: { purpose: 'specific', name: 'specific', organisation: 'missing', relation: 'missing', target: 'missing', proof: 'missing', companions: 'missing', spatial: 'missing' },
      asks: { purpose: 1, name: 1, organisation: 0, relation: 0, target: 0, proof: 0, companions: 0, spatial: 0 },
      claimsOrg: false, personalTie: false, echoTarget: false, riskHint: 'none',
    }
    const items = coverageSummary(state, 2)
    const purpose = items.find(i => i.slot === 'purpose')
    expect(purpose?.status).toBe('specific')
  })

  it('marks missing as vague after being asked', () => {
    const state: PlanState = {
      status: { purpose: 'missing', name: 'missing', organisation: 'missing', relation: 'missing', target: 'missing', proof: 'missing', companions: 'missing', spatial: 'missing' },
      asks: { purpose: 1, name: 0, organisation: 0, relation: 0, target: 0, proof: 0, companions: 0, spatial: 0 },
      claimsOrg: false, personalTie: false, echoTarget: false, riskHint: 'none',
    }
    const items = coverageSummary(state, 1)
    const purpose = items.find(i => i.slot === 'purpose')
    expect(purpose?.status).toBe('vague')
  })

  it('adds note for echoTarget', () => {
    const state: PlanState = {
      status: { purpose: 'missing', name: 'missing', organisation: 'missing', relation: 'missing', target: 'missing', proof: 'missing', companions: 'missing', spatial: 'missing' },
      asks: { purpose: 0, name: 0, organisation: 0, relation: 0, target: 0, proof: 0, companions: 0, spatial: 0 },
      claimsOrg: false, personalTie: false, echoTarget: true, riskHint: 'none',
    }
    const items = coverageSummary(state, 0)
    const target = items.find(i => i.slot === 'target')
    expect(target?.note).toBe('Only repeated the name the doorbell said')
  })
})

describe('coverageFacts', () => {
  it('returns false when no answers', () => {
    const state: PlanState = {
      status: { purpose: 'missing', name: 'missing', organisation: 'missing', relation: 'missing', target: 'missing', proof: 'missing', companions: 'missing', spatial: 'missing' },
      asks: { purpose: 0, name: 0, organisation: 0, relation: 0, target: 0, proof: 0, companions: 0, spatial: 0 },
      claimsOrg: false, personalTie: false, echoTarget: false, riskHint: 'none',
    }
    expect(coverageFacts(state, 0)).toEqual({ purposeVague: false, unverifiable: false })
  })

  it('flags purposeVague when purpose is vague', () => {
    const state: PlanState = {
      status: { purpose: 'vague', name: 'missing', organisation: 'missing', relation: 'missing', target: 'missing', proof: 'missing', companions: 'missing', spatial: 'missing' },
      asks: { purpose: 1, name: 0, organisation: 0, relation: 0, target: 0, proof: 0, companions: 0, spatial: 0 },
      claimsOrg: false, personalTie: false, echoTarget: false, riskHint: 'none',
    }
    expect(coverageFacts(state, 1).purposeVague).toBe(true)
  })

  it('flags unverifiable when claimsOrg and no proof', () => {
    const state: PlanState = {
      status: { purpose: 'specific', name: 'specific', organisation: 'vague', relation: 'missing', target: 'missing', proof: 'missing', companions: 'missing', spatial: 'missing' },
      asks: { purpose: 1, name: 1, organisation: 1, relation: 0, target: 0, proof: 0, companions: 0, spatial: 0 },
      claimsOrg: true, personalTie: false, echoTarget: false, riskHint: 'none',
    }
    expect(coverageFacts(state, 1).unverifiable).toBe(true)
  })
})

describe('coverageLines', () => {
  it('formats items for the risk judge prompt', () => {
    const items = [
      { slot: 'purpose' as Slot, label: 'Specific reason for the visit', status: 'specific' as Status, asked: 1 },
      { slot: 'name' as Slot, label: 'Gave a name', status: 'vague' as Status, asked: 2 },
    ]
    const lines = coverageLines(items)
    expect(lines).toContain('Specific reason for the visit: given (asked 1x)')
    expect(lines).toContain('Gave a name: vague or not given (asked 2x)')
  })

  it('includes notes when present', () => {
    const items = [
      { slot: 'target' as Slot, label: 'Named who they want to see', status: 'vague' as Status, asked: 0, note: 'Only repeated the name the doorbell said' },
    ]
    const lines = coverageLines(items)
    expect(lines[0]).toContain('Only repeated the name the doorbell said')
  })
})

describe('the exact scenario from the bug report', () => {
  it('continues asking after "yeah i need stuff to discuss with adarsh"', () => {
    // Turn 1: visitor gives vague answer, echoes the cued name
    const turn1: PlanTurn = {
      obs: { purpose: 'vague' },
      focus: 'purpose',
      claimsOrg: false,
      personalTie: false,
      echoTarget: true,  // they said "adarsh" which the doorbell had just said
      riskHint: 'none',
    }

    const state = foldPlan([turn1])
    const next = nextFocus(state, 1)

    // Should NOT be done - should ask another question
    expect(next).not.toBeNull()
    // Should ask for relation since they claimed to know adarsh
    expect(next).toBe('relation')
  })
})

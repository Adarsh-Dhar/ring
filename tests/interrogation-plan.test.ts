/**
 * Unit tests for the interview plan (lib/ai/interrogation/plan.ts).
 * Pure functions, no model, no database, so they run fast and catch logic bugs.
 */
import { describe, it, expect } from 'vitest'
import {
  SLOT_KEYS,
  SLOT_LABEL,
  MIN_TURNS,
  isSatisfied,
  QUESTION_BANK,
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


const ALL_SLOTS = ['purpose', 'organisation', 'detail', 'name', 'relation', 'target', 'proof', 'companions', 'spatial', 'recheck'] as const
const mk = (
  status: Partial<Record<Slot, Status>> = {},
  asks: Partial<Record<Slot, number>> = {},
  flags: Partial<Pick<PlanState, 'claimsOrg' | 'personalTie' | 'echoTarget' | 'riskHint'>> = {},
): PlanState => ({
  status: Object.fromEntries(ALL_SLOTS.map(k => [k, status[k] ?? 'missing'])) as Record<Slot, Status>,
  asks: Object.fromEntries(ALL_SLOTS.map(k => [k, asks[k] ?? 0])) as Record<Slot, number>,
  claimsOrg: false, personalTie: false, echoTarget: false, riskHint: 'none', ...flags,
})
const allSpecific = () => mk(Object.fromEntries(ALL_SLOTS.map(k => [k, 'specific'])) as Record<Slot, Status>)

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
  it('always asks purpose, name, detail, proof, companions and spatial', () => {
    const req = requiredSlots(mk(), 0)
    for (const k of ['purpose', 'name', 'detail', 'proof', 'companions', 'spatial'] as Slot[]) expect(req).toContain(k)
  })

  it('adds target if not an echo', () => {
    expect(requiredSlots(mk(), 0)).toContain('target')
  })

  it('skips target if echo, adds relation instead', () => {
    const req = requiredSlots(mk({}, {}, { echoTarget: true }), 0)
    expect(req).not.toContain('target')
    expect(req).toContain('relation')
  })

  it('adds organisation if claimsOrg', () => {
    expect(requiredSlots(mk({}, {}, { claimsOrg: true }), 0)).toContain('organisation')
  })

  it('adds the consistency recheck from the third answer', () => {
    expect(requiredSlots(mk(), 2)).not.toContain('recheck')
    expect(requiredSlots(mk(), 3)).toContain('recheck')
  })
})

describe('nextFocus: no caps', () => {
  it('never stops on its own while a required slot is open, however many turns have passed', () => {
    expect(nextFocus(mk(), 500)).not.toBeNull()
  })

  it('honours an explicit operator ceiling', () => {
    expect(nextFocus(mk(), 10, 10)).toBeNull()
  })

  it('returns null only when every required slot is specific', () => {
    expect(nextFocus(allSpecific(), 6)).toBeNull()
  })

  it('keeps pressing a vague purpose however often it was asked', () => {
    const s = mk({ purpose: 'vague' }, { purpose: 9, name: 0 })
    expect(nextFocus(s, 3)).toBe('purpose')
  })

  it('presses proof when an organisation is claimed and the proof is vague', () => {
    const s = mk({ purpose: 'specific', organisation: 'specific', proof: 'refused' }, { proof: 4 }, { claimsOrg: true })
    expect(nextFocus(s, 4)).toBe('proof')
  })

  it('rotates to the least-asked slot when nothing core is being pressed', () => {
    const s = mk({ purpose: 'specific', proof: 'specific', detail: 'specific' }, { name: 1, target: 0, spatial: 0, companions: 0 })
    expect(['target', 'spatial', 'companions']).toContain(nextFocus(s, 3))
  })

  it('starts with purpose on a blank state', () => {
    expect(nextFocus(mk(), 0)).toBe('purpose')
  })
})

describe('isSatisfied', () => {
  it('is false before MIN_TURNS even if everything is specific', () => {
    expect(isSatisfied(allSpecific(), MIN_TURNS - 1)).toBe(false)
  })
  it('is true when everything required is specific and enough turns passed', () => {
    expect(isSatisfied(allSpecific(), MIN_TURNS)).toBe(true)
  })
  it('is false when one required slot is vague', () => {
    const s = allSpecific(); s.status.proof = 'vague'
    expect(isSatisfied(s, 8)).toBe(false)
  })
  it('is false when the story changed (recheck vague)', () => {
    const s = allSpecific(); s.status.recheck = 'vague'
    expect(isSatisfied(s, 8)).toBe(false)
  })
})

describe('bankQuestion', () => {
  it('returns first phrasing on first ask', () => {
    expect(bankQuestion('purpose', 0)).toBe('What exactly is the reason for your visit?')
  })
  it('gets firmer on later asks and never repeats back-to-back', () => {
    for (let i = 0; i < 12; i++) expect(bankQuestion('purpose', i)).not.toBe(bankQuestion('purpose', i + 1))
  })
  it('cycles instead of running out', () => {
    expect(bankQuestion('proof', 50)).toBeTruthy()
  })
  it('every scripted question is a valid, safe question', async () => {
    const { validQuestion } = await import('@/lib/ai/guard')
    for (const [slot, qs] of Object.entries(QUESTION_BANK)) for (const q of qs) expect(validQuestion(q), `${slot}: ${q}`).toBe(true)
  })
})

describe('coverageSummary', () => {
  it('shows specific slots as given', () => {
    const items = coverageSummary(mk({ purpose: 'specific', name: 'specific' }, { purpose: 1, name: 1 }), 2)
    expect(items.find(i => i.slot === 'purpose')?.status).toBe('specific')
  })

  it('marks missing as vague after being asked', () => {
    const items = coverageSummary(mk({}, { purpose: 1 }), 1)
    expect(items.find(i => i.slot === 'purpose')?.status).toBe('vague')
  })

  it('adds note for echoTarget', () => {
    const items = coverageSummary(mk({}, {}, { echoTarget: true }), 0)
    expect(items.find(i => i.slot === 'target')?.note).toBe('Only repeated the name the doorbell said')
  })
})

describe('coverageFacts', () => {
  it('returns false when no answers', () => {
    expect(coverageFacts(mk(), 0)).toEqual({ purposeVague: false, unverifiable: false })
  })

  it('flags purposeVague when purpose is vague', () => {
    expect(coverageFacts(mk({ purpose: 'vague' }, { purpose: 1 }), 1).purposeVague).toBe(true)
  })

  it('flags purposeVague when the detail of the errand is vague', () => {
    expect(coverageFacts(mk({ purpose: 'specific', detail: 'vague' }, { detail: 1 }), 2).purposeVague).toBe(true)
  })

  it('flags unverifiable when claimsOrg and no proof', () => {
    const s = mk({ purpose: 'specific', name: 'specific', organisation: 'vague' }, { organisation: 1 }, { claimsOrg: true })
    expect(coverageFacts(s, 1).unverifiable).toBe(true)
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
    // The vague reason is pressed again before anything else (no per-slot cap any more)
    expect(next).toBe('purpose')
    // and once the reason is specific, the echoed name leads to a relation question
    const state2 = foldPlan([turn1, { obs: { purpose: 'specific', detail: 'specific', proof: 'specific' }, focus: 'purpose', echoTarget: true }])
    expect(nextFocus(state2, 2)).toBe('relation')
  })
})

describe('the "Big Smoke, here to sell something" scenario', () => {
  it('does not finish after two vague answers and a name', () => {
    const t1: PlanTurn = { obs: { purpose: 'vague' }, claimsOrg: true, riskHint: 'low' }
    const state1 = foldPlan([t1])
    const f1 = nextFocus(state1, 1)
    expect(f1).not.toBeNull()
    const t2: PlanTurn = { obs: { purpose: 'vague' }, focus: f1, claimsOrg: true, riskHint: 'medium' }
    const t3: PlanTurn = { obs: { name: 'vague' }, focus: 'purpose', claimsOrg: true, riskHint: 'medium' }
    const state3 = foldPlan([t1, t2, t3])
    expect(isSatisfied(state3, 3)).toBe(false)
    expect(nextFocus(state3, 3)).toBe('purpose')   // still pressing the unanswered core question
  })
})

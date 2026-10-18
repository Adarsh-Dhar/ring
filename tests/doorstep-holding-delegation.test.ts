import { describe, it, expect } from 'vitest'
import { isHoldingCase } from '@/lib/doorstep/noticePolicy'
import { gateAction, LINE_TOOL } from '@/lib/doorstep/actionGate'
import { interrogatorLines } from '@/lib/ai/talkback/lines'
import { parsePreferences, permittedActions, DEFAULT_PREFERENCES } from '@/lib/doorstep/residentPreferences'

describe('fix 1: holding script for short-notice visits waiting on approval', () => {
  it('only a waiting short-notice case is a holding case', () => {
    expect(isHoldingCase({ noticeStatus: 'short_notice', status: 'waiting' })).toBe(true)
    expect(isHoldingCase({ noticeStatus: 'short_notice', status: 'answered' })).toBe(false)
    expect(isHoldingCase({ noticeStatus: 'meets_minimum', status: 'waiting' })).toBe(false)
    expect(isHoldingCase({ noticeStatus: 'no_notice', status: 'waiting' })).toBe(false)
    expect(isHoldingCase(null)).toBe(false)
  })
  it('the holding line uses the zero-cost safety tool', () => expect(LINE_TOOL.holding).toBe('safety_script'))
  it('while approval is pending only zero-cost lines are allowed; greeting and questions are not', () => {
    const allowed = (line: keyof typeof LINE_TOOL) => gateAction(LINE_TOOL[line], 0, undefined, { holdOnly: true }).decision === 'allow'
    expect(allowed('holding')).toBe(true)
    expect(allowed('safety')).toBe(true)
    expect(allowed('greet')).toBe(false)
    expect(allowed('reprompt')).toBe(false)
    expect(allowed('rules_explained')).toBe(false)
  })
  it('the holding line never claims help is coming or promises entry', () => {
    const t = interrogatorLines(null).holding.toLowerCase()
    expect(t).toContain('door will stay closed')
    for (const bad of ['on the way', 'coming', 'let you in', 'approved.', 'help is', 'will open']) expect(t.includes(bad)).toBe(false)
  })
})

describe('fix 2: resident delegation settings', () => {
  it('a delegation the resident sets changes what the AI may do', () => {
    const off = parsePreferences({ delegation: { greet_visitor: 'helper' } })
    expect(permittedActions(off, 'ai_leads', 0).allowed).not.toContain('greet_visitor')
    expect(permittedActions(DEFAULT_PREFERENCES, 'ai_leads', 0).allowed).toContain('greet_visitor')
  })
  it('bad stored values fall back to the defaults', () => {
    expect(parsePreferences({ delegation: { greet_visitor: 'nonsense' } }).delegation.greet_visitor).toBe('ai')
  })
  it('the prohibited actions are never allowed whatever is delegated', () => {
    const all = parsePreferences({ delegation: { greet_visitor: 'ai', ask_purpose: 'ai', ask_for_id: 'ai', tell_visitor_to_leave: 'ai', accept_parcel: 'ai', approve_short_notice: 'ai' } })
    const p = permittedActions(all, 'ai_leads', 0)
    for (const x of ['unlock_door', 'disclose_access_credentials', 'compel_resident_to_open']) { expect(p.prohibited).toContain(x); expect(p.allowed as string[]).not.toContain(x) }
  })
})

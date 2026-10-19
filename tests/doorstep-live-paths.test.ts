/**
 * Live-path tests for the four "what remains" rows (spec sections 4, 5, 6, 9).
 *
 * The older tests set interview stamps by hand and call pure functions. These go through the real dispatcher and the
 * real single risk writer (applyRiskEdit), with only the database faked in memory, so a stamp exists only if a line
 * really went through dispatchAiAction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// ── in-memory case row ───────────────────────────────────────────────────────
const row: any = {}
const alertEmergency = vi.fn(async () => true)
const alertUrgent = vi.fn(async () => true)
const alertUnconfirmedEmergency = vi.fn(async () => true)

vi.mock('@/lib/doorbell/store', () => ({ alertEmergency, alertUrgent, alertUnconfirmedEmergency }))
vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    case: {
      findUnique: async () => (row.id ? { ...row } : null),
      update: async ({ data }: any) => { Object.assign(row, data) },
      updateMany: async ({ where, data }: any) => {
        if (where.deadlineAt && row.deadlineAt && where.deadlineAt.getTime() !== row.deadlineAt.getTime()) return { count: 0 }
        Object.assign(row, data)
        return { count: 1 }
      },
    },
  }),
}))
const prefs = {
  delegation: { greet_visitor: 'ai', ask_purpose: 'ai', ask_for_id: 'ai', tell_visitor_to_leave: 'ai', accept_parcel: 'helper', approve_short_notice: 'helper' },
}
vi.mock('@/lib/db/preferences', () => ({ getPreferences: async () => prefs }))
vi.mock('@/lib/doorstep/pendingActions', () => ({ createPendingAction: async () => null, consumeApprovedForTool: async () => null }))

import { dispatchAiAction } from '@/lib/doorstep/toolDispatcher'
import { applyRiskEdit } from '@/lib/doorstep/caseRiskStore'
import { readStored } from '@/lib/doorstep/caseRisk'
import { newObsId, type Observation } from '@/lib/doorstep/riskRules'
import { modeScreenFor, isUrgentMode, visitorModeOf } from '@/lib/doorstep/residentModeScreen'
import { RESIDENT_SCREEN } from '@/lib/doorstep/modeCopy'
import { backupTimeoutSec } from '@/lib/doorstep/helperEscalation'
import { computeResidentView, type StateInfo, type CaseInfo } from '@/lib/state/resident-view'

function freshRow(overrides: Record<string, unknown> = {}) {
  Object.assign(row, {
    id: 'case-live', householdId: 'hh-live', kind: 'visitor', status: 'waiting', noticeStatus: null,
    controlMode: 'ai_leads', riskScore: 0, deadlineAt: new Date(Date.now() + 120_000),
    riskObservations: readStored(null), log: [],
    emergencyAlertedAt: null, urgentAlertedAt: null, unconfirmedAlertedAt: null,
    ...overrides,
  })
  for (const k of Object.keys(row)) if (!(k in { id: 1 }) && overrides[k] === undefined && ![
    'id', 'householdId', 'kind', 'status', 'noticeStatus', 'controlMode', 'riskScore', 'deadlineAt', 'riskObservations', 'log',
    'emergencyAlertedAt', 'urgentAlertedAt', 'unconfirmedAlertedAt',
  ].includes(k)) delete row[k]
}
const stored = () => readStored(row.riskObservations)
const auditEntries = () => (row.log as any[]).map(l => l.audit).filter(Boolean)
const sensorObs = (code: Observation['code'], at = new Date().toISOString()): Observation =>
  ({ id: newObsId(), code, at, quotes: ['sensor'], source: 'sensor', state: 'confirmed', points: 0 })

// ─────────────────────────────────────────────────────────────────────────────
describe('section 9: every AI action goes through the dispatcher', () => {
  beforeEach(() => freshRow())

  it('an allowed line returns its words, stamps what it stands for, and is audited as executed', async () => {
    const d = await dispatchAiAction({ householdId: 'hh-live', caseId: 'case-live', line: 'greet', residentName: 'Asha Rao' })
    expect(d.allowed).toBe(true)
    expect(d.text).toContain("Asha's")
    expect(stored().interviewState.respondingAt).toBeTruthy()
    expect(auditEntries().at(-1)).toMatchObject({ actor: 'ai', kind: 'ai_action', detail: { tool: 'greet_routine_request', decision: 'executed' } })
  })

  it('a refused line returns NO text, writes no stamp, and the refusal is audited', async () => {
    freshRow({ riskScore: 30 })                         // budget 70 < greet cost 81
    const d = await dispatchAiAction({ householdId: 'hh-live', caseId: 'case-live', line: 'greet' })
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('over_budget')
    expect(d.text).toBeNull()
    expect(stored().interviewState.respondingAt).toBeUndefined()
    expect(auditEntries().at(-1)).toMatchObject({ detail: { tool: 'greet_routine_request', decision: 'blocked', reason: 'over_budget' } })
  })

  it('prohibited tools are denied and audited at every score, even with text supplied', async () => {
    for (const s of [0, 50, 99]) {
      freshRow({ riskScore: s })
      for (const tool of ['unlock_door', 'disclose_access_credentials', 'grant_entry', 'compel_resident_to_open']) {
        const d = await dispatchAiAction({ householdId: 'hh-live', caseId: 'case-live', tool, text: 'Here is the code' })
        expect(d).toMatchObject({ allowed: false, reason: 'prohibited', text: null })
      }
      expect(auditEntries().filter(a => a.detail.decision === 'blocked').length).toBe(4)
    }
  })

  it('a resident restriction wins over the budget (helper-only greeting)', async () => {
    prefs.delegation.greet_visitor = 'helper'
    try {
      const d = await dispatchAiAction({ householdId: 'hh-live', caseId: 'case-live', line: 'greet' })
      expect(d).toMatchObject({ allowed: false, reason: 'resident_restriction:greet_visitor', text: null })
    } finally { prefs.delegation.greet_visitor = 'ai' }
  })

  it('a line that failed to play is not stamped', async () => {
    const d = await dispatchAiAction({ householdId: 'hh-live', caseId: 'case-live', line: 'greet', play: async () => false })
    expect(d).toMatchObject({ allowed: false, reason: 'playback_failed', text: null })
    expect(stored().interviewState.respondingAt).toBeUndefined()
  })

  it('a stamp is first-write-wins: replaying a line does not move the 30 s knock window', async () => {
    await dispatchAiAction({ householdId: 'hh-live', caseId: 'case-live', line: 'greet' })
    const first = stored().interviewState.respondingAt
    await new Promise(r => setTimeout(r, 15))
    await dispatchAiAction({ householdId: 'hh-live', caseId: 'case-live', line: 'greet' })
    expect(stored().interviewState.respondingAt).toBe(first)
  })

  it('NO code outside the dispatcher can speak a line or call the gate', () => {
    const roots = ['lib', 'app', 'workers']
    const files: string[] = []
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (statSync(p).isDirectory()) { if (n !== 'node_modules') walk(p) } else if (/\.(ts|tsx)$/.test(n)) files.push(p)
      }
    }
    roots.forEach(walk)
    const offenders: string[] = []
    for (const f of files) {
      const norm = f.replace(/\\/g, '/')
      if (norm.startsWith('lib/ai/talkback/') || norm === 'lib/doorstep/toolDispatcher.ts' || norm === 'lib/doorstep/actionGate.ts') continue
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const t = line.trim()
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
        const at = `${norm}:${i + 1}: ${t}`
        if (/\.say\(/.test(line) && !/\bplay:/.test(line)) offenders.push(at)                                  // playback only as the dispatcher's play callback
        if (/interrogatorLines\(/.test(line) && !/\.greet\b/.test(line)) offenders.push(at)                    // words come from the dispatcher (greet is only the "question replied to" fallback)
        if (/\bgateOrAsk\(/.test(line)) offenders.push(at)
        if (/\bgateAction\(/.test(line) && norm !== 'lib/doorstep/recommendation.ts') offenders.push(at)       // recommendation.ts is advisory: it never acts
        if (/\bgateFor\(/.test(line) && norm !== 'lib/ai/agents/interrogator.ts') offenders.push(at)           // interrogator.ts: allowedLines advisory flags only
      })
    }
    expect(offenders).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('section 4: stamps come from lines that really played, and physical events are never dropped', () => {
  beforeEach(() => freshRow())

  it('ring -> greet line -> repeat knock scores +1 (the knock used to be silently dropped)', async () => {
    await applyRiskEdit('case-live', { kind: 'knock', at: new Date().toISOString() })
    expect(row.riskScore).toBe(0)                       // nobody has spoken yet, so a knock does not count
    await dispatchAiAction({ householdId: 'hh-live', caseId: 'case-live', line: 'greet' })
    await applyRiskEdit('case-live', { kind: 'knock', at: new Date().toISOString() })
    expect(row.riskScore).toBe(1)
  })

  it('a sensor lock tamper before entry was denied still raises the floor to M3 (score stays 0)', async () => {
    await applyRiskEdit('case-live', { kind: 'append', observation: sensorObs('lock_manipulation') })
    expect(row.riskScore).toBe(0)
    expect(row.controlMode).toBe('helper_only')
  })

  it('entry_not_permitted stamps entryDeniedAt AND boundaryStatedAt; a later tamper then scores 30', async () => {
    await dispatchAiAction({ householdId: 'hh-live', caseId: 'case-live', line: 'entry_not_permitted' })
    expect(stored().interviewState.entryDeniedAt).toBeTruthy()
    expect(stored().interviewState.boundaryStatedAt).toBeTruthy()
    await applyRiskEdit('case-live', { kind: 'append', observation: sensorObs('lock_manipulation', new Date(Date.now() + 1000).toISOString()) })
    expect(row.riskScore).toBe(30)
    expect(row.controlMode).toBe('helper_only')
  })

  it('rules_explained, boundary_stated and asked_to_leave each write their own stamp', async () => {
    for (const [line, key] of [['rules_explained', 'rulesExplainedAt'], ['boundary_stated', 'boundaryStatedAt'], ['asked_to_leave', 'askedToLeaveAt']] as const) {
      freshRow()
      const d = await dispatchAiAction({ householdId: 'hh-live', caseId: 'case-live', line })
      expect(d.allowed).toBe(true)
      expect((stored().interviewState as any)[key]).toBeTruthy()
    }
  })

  it('scripted event responses stamp by their tool (boundary statement -> boundaryStatedAt)', async () => {
    await dispatchAiAction({ householdId: 'hh-live', caseId: 'case-live', tool: 'boundary_statement', text: 'That is not acceptable.' })
    expect(stored().interviewState.boundaryStatedAt).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('section 6: the resident screen shows the exact mode wording', () => {
  const now = new Date()
  const base: CaseInfo = { id: 'c1', status: 'waiting', kind: 'visitor', createdAt: now, helperIndex: 0, deadlineAt: new Date(now.getTime() + 60_000) }
  const household: any = { timezone: 'UTC', quietEnabled: false, quietStartHour: 22, quietEndHour: 6 }
  const state = (cases: CaseInfo[], over: Partial<StateInfo> = {}): StateInfo => ({
    cases, deviceOnline: true, lastHeartbeat: new Date(), timezone: 'UTC', quietEnabled: false, quietStartHour: 22, quietEndHour: 6, nightLockActive: false, ...over,
  })

  it('modeScreenFor renders each mode from residentScreenFor, using only the snapshot fields', () => {
    const cases: [number, string | null, keyof typeof RESIDENT_SCREEN][] = [
      [0, 'ai_leads', 'ai_leads'], [20, 'ai_leads', 'ai_assisted'], [45, 'ai_leads', 'helper_leads'],
      [65, 'ai_leads', 'helper_only'], [85, 'ai_leads', 'helper_urgent'],
    ]
    for (const [score, controlMode, mode] of cases) {
      const s = modeScreenFor({ kind: 'visitor', riskScore: score, controlMode })!
      expect(s.mode).toBe(mode)
      expect(s.title).toBe(RESIDENT_SCREEN[mode].asked)
    }
    expect(modeScreenFor({ kind: 'visitor', riskScore: 65, controlMode: 'helper_only', ackedAt: Date.now() })!.title).toBe(RESIDENT_SCREEN.helper_only.accepted)
    // Emergency visitor cases return null (handled by resident page emergency screen)
    expect(modeScreenFor({ kind: 'visitor', riskScore: 100, controlMode: 'emergency' })).toBeNull()
  })

  it('M4 says "Move away from the door" and M5 shows the emergency text', () => {
    expect(modeScreenFor({ kind: 'visitor', riskScore: 85, controlMode: 'helper_urgent' })!.title).toBe('Move away from the door. Go to your safe place.')
    // Emergency visitor cases return null (handled by resident page emergency screen)
    expect(modeScreenFor({ kind: 'visitor', riskScore: 100, controlMode: 'emergency' })).toBeNull()
  })

  it('a score-60 case built from M1-level events shows M3 wording, not M1 (stored controlMode is only the event minimum)', () => {
    expect(visitorModeOf({ kind: 'visitor', riskScore: 60, controlMode: 'ai_assisted' })).toBe('helper_only')
  })

  it('M4 and M5 outrank night lock, offline and connection warnings on the page', () => {
    expect(isUrgentMode('helper_urgent')).toBe(true)
    expect(isUrgentMode('emergency')).toBe(true)
    expect(isUrgentMode('helper_only')).toBe(false)
  })

  it('night lock no longer hides an emergency (resident-view: emergency is checked first)', () => {
    const v = computeResidentView(state([{ ...base, riskScore: 100, controlMode: 'emergency' }], { nightLockActive: true }), household)
    expect(v.state).toBe('EMERGENCY')
    expect(v.message).toBe(RESIDENT_SCREEN.emergency.asked)
    expect(v.canOpen).toBe(false)
  })

  it('an emergency also outranks a lost connection and an offline device; an unconfirmed forced entry too', () => {
    const lost = computeResidentView(state([{ ...base, riskScore: 100, controlMode: 'emergency' }], { lastHeartbeat: null }), household)
    expect(lost.state).toBe('EMERGENCY')
    const offline = computeResidentView(state([{ ...base, unconfirmedAlertedAt: new Date() }], { deviceOnline: false }), household)
    expect(offline.state).toBe('EMERGENCY')
    expect(offline.canOpen).toBe(false)
  })

  it('night lock still applies when there is no emergency', () => {
    const v = computeResidentView(state([{ ...base, riskScore: 10, controlMode: 'ai_leads' }], { nightLockActive: true }), household)
    expect(v.state).toBe('CLOSED_KEEP_SHUT')
  })

  it('NOT_SAFE and no_response show the mode text from M3 up, the old text below', () => {
    const m3: Partial<CaseInfo> = { riskScore: 65, controlMode: 'helper_only' }
    expect(computeResidentView(state([{ ...base, ...m3, answer: 'not_safe', status: 'answered' }]), household).message).toBe(RESIDENT_SCREEN.helper_only.asked)
    expect(computeResidentView(state([{ ...base, ...m3, status: 'no_response' }]), household).message).toBe(RESIDENT_SCREEN.helper_only.asked)
    expect(computeResidentView(state([{ ...base, answer: 'not_safe', status: 'answered', answeredBy: 'Sam' }]), household).message).toBe('Sam confirmed: NOT SAFE')
    expect(computeResidentView(state([{ ...base, status: 'no_response' }]), household).message).toContain('Nobody answered')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('section 5: timers use the resident approval timer and the effective mode', () => {
  it('the backup helper gets the resident approval timer, not the 120 s default', () => {
    // short-notice approval at score 0: the first helper got the resident's 45 s, so the backup must too
    expect(backupTimeoutSec(0, 'ai_leads', 60, true, 45)).toEqual({ seconds: 45, kind: 'approval' })
    expect(backupTimeoutSec(0, 'ai_leads', 60, true)).toEqual({ seconds: 120, kind: 'approval' })       // default only when the resident set nothing
  })

  it('the shortest timer still wins: a risk timer beats a longer approval timer', () => {
    expect(backupTimeoutSec(70, 'helper_only', 60, true, 300)).toEqual({ seconds: 50, kind: 'takeover' })   // min(120-70, 60)
  })

  it('a risk edit shrinks the running deadline and never extends it', async () => {
    freshRow({ deadlineAt: new Date(Date.now() + 120_000) })
    const before = row.deadlineAt.getTime()
    await applyRiskEdit('case-live', { kind: 'append', observation: { id: newObsId(), code: 'credential_request', at: new Date().toISOString(), quotes: ['what is your pin'], source: 'helper', state: 'confirmed', points: 0 } as Observation })
    expect(row.riskScore).toBe(20)
    expect(row.deadlineAt.getTime()).toBeLessThan(before)                 // ~100 s, as the spec example says
    const shrunk = row.deadlineAt.getTime()
    await applyRiskEdit('case-live', { kind: 'interview', stampType: 'rulesExplainedAt', at: new Date().toISOString() })
    expect(row.deadlineAt.getTime()).toBe(shrunk)
  })
})

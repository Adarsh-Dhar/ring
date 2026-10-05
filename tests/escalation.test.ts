import { describe, it, expect } from 'vitest'
import { escalateDueCase, type EscalationDeps, type StepExpect, type StepChange } from '@/lib/doorbell/escalation'
import type { DoorCase } from '@/lib/doorbell/store'

/**
 * A fake "database" row with the same compare-and-set rule as claimEscalationStep().
 * Two callers sharing one row behave like two servers sharing one Postgres.
 */
function fakeDb(row: { helperIndex: number; deadlineAt: number; status: string; lane: string | null; resolvedAt?: number; log: any[] }) {
  const alerts: string[] = []
  let claims = 0
  const deps = (label: string): EscalationDeps => ({
    claim: async (_id, e: StepExpect, ch: StepChange, log) => {
      await Promise.resolve() // yield, so racing callers interleave
      if (row.status !== 'waiting' || row.helperIndex !== e.helperIndex || row.deadlineAt !== e.deadlineAt || row.lane !== (e.lane ?? null)) return false
      row.helperIndex = ch.helperIndex
      row.deadlineAt  = ch.deadlineAt
      row.status      = ch.status
      row.lane        = ch.lane ?? null
      if (ch.resolvedAt !== undefined) row.resolvedAt = ch.resolvedAt
      row.log = log
      claims++
      return true
    },
    reload: async () => ({ helperIndex: row.helperIndex, deadlineAt: row.deadlineAt, status: row.status as any, lane: (row.lane as any) ?? undefined, resolvedAt: row.resolvedAt, log: row.log }),
    nameOf: async (id) => (id ? id.toUpperCase() : undefined),
    onStep: (_c, s) => { alerts.push(`${label}:${s.kind}:${s.toId ?? '-'}`) },
  })
  return { alerts, deps, claims: () => claims }
}

const T0 = 1_000_000
const CFG = { timeoutSec: 30, expectedTimeoutSec: 60 }

function mkCase(over: Partial<DoorCase> = {}): DoorCase {
  return { id: 'c1', kind: 'visitor', eventType: 'button_press', createdAt: T0, helperIndex: 0, deadlineAt: T0 + 30_000,
    status: 'waiting', log: [], chain: ['a', 'b', 'c'], lane: 'normal', ...over }
}
const rowOf = (c: DoorCase) => ({ helperIndex: c.helperIndex, deadlineAt: c.deadlineAt, status: c.status as string, lane: (c.lane ?? null) as string | null, log: [...c.log] })

describe('escalation steps', () => {
  it('does nothing before the deadline', async () => {
    const c = mkCase(); const db = fakeDb(rowOf(c))
    expect(await escalateDueCase(c, T0 + 29_999, CFG, db.deps('A'))).toBe(0)
    expect(db.alerts).toEqual([]); expect(c.helperIndex).toBe(0)
  })

  it('asks the next helper once the deadline passes and pushes the deadline out', async () => {
    const c = mkCase(); const db = fakeDb(rowOf(c))
    expect(await escalateDueCase(c, T0 + 30_000, CFG, db.deps('A'))).toBe(1)
    expect(db.alerts).toEqual(['A:next_helper:b'])
    expect(c.helperIndex).toBe(1); expect(c.deadlineAt).toBe(T0 + 60_000); expect(c.status).toBe('waiting')
    expect(c.log.at(-1)!.msg).toContain('Escalated to B')
  })

  it('after the last helper it resolves as no_response and alerts everyone once', async () => {
    const c = mkCase({ helperIndex: 2, deadlineAt: T0 + 90_000 }); const db = fakeDb(rowOf(c))
    await escalateDueCase(c, T0 + 90_000, CFG, db.deps('A'))
    expect(db.alerts).toEqual(['A:exhausted:-'])
    expect(c.status).toBe('no_response'); expect(c.resolvedAt).toBe(T0 + 90_000)
    // finished cases never escalate again
    expect(await escalateDueCase(c, T0 + 999_999, CFG, db.deps('A'))).toBe(0)
    expect(db.alerts).toHaveLength(1)
  })

  it('expected visit nobody confirmed becomes a normal alert to the SAME helper', async () => {
    const c = mkCase({ lane: 'expected', deadlineAt: T0 + 60_000 }); const db = fakeDb(rowOf(c))
    await escalateDueCase(c, T0 + 60_000, CFG, db.deps('A'))
    expect(db.alerts).toEqual(['A:expected_to_normal:a'])
    expect(c.lane).toBe('normal'); expect(c.helperIndex).toBe(0); expect(c.deadlineAt).toBe(T0 + 90_000)
  })

  it('catches up through several missed deadlines, one alert per step', async () => {
    const c = mkCase(); const db = fakeDb(rowOf(c))
    await escalateDueCase(c, T0 + 200_000, CFG, db.deps('A'))
    expect(db.alerts).toEqual(['A:next_helper:b', 'A:next_helper:c', 'A:exhausted:-'])
    expect(c.status).toBe('no_response')
  })
})

describe('exactly-once across servers and restarts', () => {
  it('two servers ticking the same case at the same moment alert once', async () => {
    const base = mkCase(); const db = fakeDb(rowOf(base))
    const serverA = mkCase(); const serverB = mkCase()   // separate in-memory copies
    const now = T0 + 30_000
    const [a, b] = await Promise.all([
      escalateDueCase(serverA, now, CFG, db.deps('A')),
      escalateDueCase(serverB, now, CFG, db.deps('B')),
    ])
    expect(a + b).toBe(1)
    expect(db.alerts).toHaveLength(1)
    expect(db.claims()).toBe(1)
    // the loser adopted the winner's result instead of repeating it
    expect(serverA.helperIndex).toBe(1); expect(serverB.helperIndex).toBe(1)
  })

  it('many racing callers over a long outage still produce exactly chain-length alerts', async () => {
    const base = mkCase(); const db = fakeDb(rowOf(base))
    const servers = Array.from({ length: 5 }, () => mkCase())
    await Promise.all(servers.map((s, i) => escalateDueCase(s, T0 + 500_000, CFG, db.deps(`S${i}`))))
    expect(db.alerts).toHaveLength(3)                     // b, c, then "nobody answered"
    expect(db.alerts.map(a => a.split(':')[1])).toEqual(['next_helper', 'next_helper', 'exhausted'])
  })

  it('a restarted server that rebuilds the case from the saved row does not repeat a step', async () => {
    const c = mkCase(); const db = fakeDb(rowOf(c))
    await escalateDueCase(c, T0 + 30_000, CFG, db.deps('before-restart'))
    expect(db.alerts).toHaveLength(1)

    // "restart": throw away memory, rebuild from the database row
    const reloaded = mkCase({ helperIndex: 1 - 1, deadlineAt: T0 + 30_000 })   // stale copy as an old process might hold it
    await escalateDueCase(reloaded, T0 + 30_500, CFG, db.deps('after-restart'))
    expect(db.alerts).toHaveLength(1)                     // still just the one alert
    expect(reloaded.helperIndex).toBe(1)                  // and it caught up to the saved state
  })

  it('a case answered meanwhile is never escalated', async () => {
    const c = mkCase(); const row = rowOf(c); const db = fakeDb(row)
    row.status = 'answered'                               // a helper answered on another server
    expect(await escalateDueCase(c, T0 + 30_000, CFG, db.deps('A'))).toBe(0)
    expect(db.alerts).toEqual([]); expect(c.status).toBe('answered')
  })

  it('a case deleted meanwhile is left alone', async () => {
    const c = mkCase()
    const deps: EscalationDeps = { claim: async () => false, reload: async () => null, nameOf: async () => 'x', onStep: () => { throw new Error('must not alert') } }
    expect(await escalateDueCase(c, T0 + 30_000, CFG, deps)).toBe(0)
  })

  it('never loops forever if the database keeps refusing and keeps returning the same row', async () => {
    const c = mkCase(); let reloads = 0
    const deps: EscalationDeps = { claim: async () => false, reload: async () => { reloads++; return { helperIndex: 0, deadlineAt: T0 + 30_000, status: 'waiting' } }, nameOf: async () => 'x', onStep: () => {} }
    await escalateDueCase(c, T0 + 30_000, CFG, deps)
    expect(reloads).toBeLessThanOrEqual(25)
  })
})

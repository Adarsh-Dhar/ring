/** Registers the AI jobs on the existing pg-boss worker. Call once from workers/timer-worker.ts. */
import type { PgBoss } from 'pg-boss'
import { JOB_NAMES, type AiCaseJob, type AiIntakeJob, type AiDigestJob } from '@/lib/queue/jobs'
import { getApprovedMemberships } from '@/lib/db/memberships'
import { pushToMembership } from '@/lib/doorbell/notify'
import { getDb } from '@/lib/db/client'

export async function registerAiWorkers(boss: PgBoss) {
  const each = (name: string, fn: (data: any) => Promise<void>) =>
    boss.work(name, async (jobs: any[]) => {
      for (const j of jobs) { try { await fn(j.data) } catch (e) { console.error(`[WORKER] ${name} failed`, e) } }   // AI jobs never retry-storm
    })

  await each(JOB_NAMES.AI_DESCRIBE, async (d: AiCaseJob) => {
    const { describeForCase } = await import('./agents/describer'); await describeForCase(d.householdId, d.caseId, d.deviceId)
  })
  await each(JOB_NAMES.AI_GREETER_START, async (d: AiCaseJob) => {
    const { startGreeter } = await import('./agents/greeter'); await startGreeter(d.householdId, d.caseId, d.deviceId)
  })
  await each(JOB_NAMES.AI_INTAKE_EVAL, async (d: AiIntakeJob) => {
    const { startIntake } = await import('./agents/intake'); await startIntake(d.householdId, d.requestId)
  })
  await each(JOB_NAMES.AI_DIGEST_WEEKLY, async (d: AiDigestJob) => {
    const { runDigest, householdsForDigest } = await import('./agents/digest')
    if (d.householdId) {
      const digest = await runDigest(d.householdId)
      // Create notification and push to guardians after digest is generated
      if (digest) {
        const memberships = await getApprovedMemberships(d.householdId)
        const guardians = memberships.filter(m => m.role === 'guardian')
        for (const g of guardians) {
          await pushToMembership(g.id, {
            title: '📊 Weekly digest ready',
            body: digest.text.slice(0, 100),
            url: '/setup'
          }).catch(e => console.error('[WORKER] digest push failed', e))
        }
      }
      return
    }
    // Fan-out: stagger one household every 20 minutes.
    const { enqueueJob } = await import('@/lib/queue')
    const ids = await householdsForDigest()
    for (let i = 0; i < ids.length; i++) await enqueueJob(JOB_NAMES.AI_DIGEST_WEEKLY, { householdId: ids[i] }, { startAfter: i * 20 * 60 })
  })

  // Monday 03:00 UTC
  try { await boss.schedule(JOB_NAMES.AI_DIGEST_WEEKLY, '0 3 * * 1', {}) } catch (e) { console.error('[WORKER] digest schedule failed', e) }
  console.log('[WORKER] AI workers registered')
}

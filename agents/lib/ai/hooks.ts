/**
 * The ONLY place the core app touches the AI. Called fire-and-forget from ingestEvent().
 * Everything here swallows its own errors: the helper alert path must never depend on it.
 */
import { aiFlags } from './caseAi'
import { aiConfigured, AI_GLOBAL_OFF } from './models'

export async function onDoorEvent(householdId: string, ev: { caseId: string; deviceId: string | null }) {
  try {
    if (AI_GLOBAL_OFF() || !aiConfigured()) return
    const f = await aiFlags(householdId)
    if (!f.aiEnabled) return
    const { JOB_NAMES } = await import('@/lib/queue/jobs')
    const { isQueueInitialized, enqueueJob } = await import('@/lib/queue')
    if (isQueueInitialized()) {
      await enqueueJob(JOB_NAMES.AI_DESCRIBE, { householdId, ...ev }, { retryLimit: 1 })
      if (f.aiGreeter) await enqueueJob(JOB_NAMES.AI_GREETER_START, { householdId, ...ev }, { retryLimit: 0 })
      return
    }
    // No queue in this process (e.g. serverless web): run inline, in the background.
    const { describeForCase } = await import('./agents/describer')
    void describeForCase(householdId, ev.caseId, ev.deviceId).catch(() => {})
    if (f.aiGreeter) { const { startGreeter } = await import('./agents/greeter'); void startGreeter(householdId, ev.caseId, ev.deviceId).catch(() => {}) }
  } catch (e) { console.error('[AI hook]', e) }
}

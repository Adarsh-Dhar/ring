/**
 * The ONLY place the core app touches the AI. Called fire-and-forget from ingestEvent().
 * Everything here swallows its own errors: the helper alert path must never depend on it.
 *
 * Execution policy (so a job can never sit in a queue nobody reads):
 *   - default: run INLINE in the current process. No worker needed.
 *   - AI_USE_QUEUE=1: enqueue to pg-boss. Only set this when `npm run worker` is running.
 *   - simulator devices (sim-*) always run inline: their frames live on this server's disk.
 *   - if queueing fails for any reason, fall back to inline.
 */
import { aiFlags } from './caseAi'
import { aiConfigured, AI_GLOBAL_OFF } from './models'

export const wantsQueue = (deviceId: string | null) =>
  process.env.AI_USE_QUEUE === '1' && deviceId !== null && !deviceId.startsWith('sim-')

export async function onDoorEvent(householdId: string, ev: { caseId: string; deviceId: string | null }) {
  try {
    if (AI_GLOBAL_OFF() || !aiConfigured()) return
    const f = await aiFlags(householdId)
    if (!f.aiEnabled) return

    if (wantsQueue(ev.deviceId)) {
      try {
        const { JOB_NAMES } = await import('@/lib/queue/jobs')
        const { isQueueInitialized, enqueueJob, initQueue } = await import('@/lib/queue')
        if (!isQueueInitialized()) await initQueue()
        await enqueueJob(JOB_NAMES.AI_DESCRIBE, { householdId, ...ev }, { retryLimit: 1 })
        if (f.aiGreeter) await enqueueJob(JOB_NAMES.AI_GREETER_START, { householdId, ...ev }, { retryLimit: 0 })
        return
      } catch (e) {
        console.warn('[AI hook] AI_USE_QUEUE=1 but enqueue failed, running inline instead:', e)
      }
    }

    const { describeForCase } = await import('./agents/describer')
    void describeForCase(householdId, ev.caseId, ev.deviceId).catch((e) => console.warn('[AI hook] describe failed', e))
    if (f.aiGreeter) {
      const { startGreeter } = await import('./agents/greeter')
      void startGreeter(householdId, ev.caseId, ev.deviceId).catch((e) => console.warn('[AI hook] greeter failed', e))
    }
  } catch (e) {
    console.error('[AI hook]', e)
  }
}

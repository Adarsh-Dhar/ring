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
import { isUnplannedVisit } from './interrogation/gate'
import { logRun } from './runs'

export const wantsQueue = (deviceId: string | null) =>
  process.env.AI_USE_QUEUE === '1' && deviceId !== null && !deviceId.startsWith('sim-')

export async function onDoorEvent(householdId: string, ev: { caseId: string; deviceId: string | null; kind: string; lane?: string | null; expectedId?: string | null; recurringId?: string | null }) {
  try {
    if (AI_GLOBAL_OFF() || !aiConfigured()) {
      console.warn('[AI hook] skipped: AI_DISABLED=1 or GEMINI_API_KEY missing')
      return
    }
    const f = await aiFlags(householdId)
    if (!f.aiEnabled) {
      console.warn('[AI hook] skipped: household AI not enabled (enable + consent in /setup)')
      return
    }
    if (!f.aiInterrogator) return

    // Unplanned-only gate: planned visits are never interrogated. A short-notice visit that is waiting for
    // approval still gets the fixed holding line (spec 5.3) and nothing else.
    if (!isUnplannedVisit(ev)) {
      const { speakHoldingScript } = await import('./holding')
      const spoke = await speakHoldingScript(householdId, ev.caseId, ev.deviceId).catch((e) => { console.warn('[AI hook] holding script failed', e); return false })
      console.log(spoke ? '[AI hook] planned visit: holding script spoken' : '[AI hook] skipped: planned visit (interrogator only for unplanned visits)')
      return
    }

    if (wantsQueue(ev.deviceId)) {
      try {
        const { JOB_NAMES } = await import('@/lib/queue/jobs')
        const { isQueueInitialized, enqueueJob, initQueue } = await import('@/lib/queue')
        if (!isQueueInitialized()) await initQueue()
        await enqueueJob(JOB_NAMES.AI_INTERROGATOR_START, { householdId, ...ev }, { retryLimit: 0 })
        return
      } catch (e) {
        console.warn('[AI hook] AI_USE_QUEUE=1 but enqueue failed, running inline instead:', e)
      }
    }

    const { startInterrogator } = await import('./agents/interrogator')
    void startInterrogator(householdId, ev.caseId, ev.deviceId).catch((e) => console.warn('[AI hook] interrogator failed', e))
  } catch (e) {
    console.error('[AI hook]', e)
  }
}

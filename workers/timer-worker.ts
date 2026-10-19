/**
 * pg-boss worker for processing async jobs
 * Handles webhook events, device status updates, and timers
 */

import { initQueue, stopQueue } from '@/lib/queue'
import { JOB_NAMES, type WebhookProcessJob, type DeviceOfflineJob, type DeviceOnlineJob } from '@/lib/queue/jobs'
import { ingestEvent, setDeviceOnline, sweepOverdueCases } from '@/lib/doorbell/store'
import { sweepQuietCases } from '@/lib/doorstep/caseLifecycle'

async function main() {
  console.log('[WORKER] Starting timer worker...')

  const boss = await initQueue()

  // Create queues before registering workers
  const queueNames = Object.values(JOB_NAMES)
  
  for (const queueName of queueNames) {
    try {
      await boss.createQueue(queueName)
      console.log(`[WORKER] Created queue: ${queueName}`)
    } catch (error) {
      // Queue might already exist, that's fine
      console.log(`[WORKER] Queue ${queueName} already exists or failed to create`)
    }
  }

  // Webhook processing job
  try {
    boss.work(JOB_NAMES.WEBHOOK_PROCESS, async (jobs) => {
      for (const job of jobs as any[]) {
        try {
          const data = job.data as WebhookProcessJob
          console.log('[WORKER] Processing webhook job:', data.eventType, 'for household', data.householdId)

          const c = await ingestEvent(data.householdId, {
            event_type: data.eventType,
            event_id: data.eventId,
            device_id: data.deviceId,
            raw: data.raw,
          })

          console.log('[WORKER] Webhook job processed, case:', c?.id)
        } catch (error) {
          console.error('[WORKER] Error processing webhook job:', error)
          throw error
        }
      }
    })
  } catch (error) {
    console.error('[WORKER] Failed to register webhook job:', error)
  }

  // Device offline job
  try {
    boss.work(JOB_NAMES.DEVICE_OFFLINE, async (jobs) => {
      for (const job of jobs as any[]) {
        try {
          const data = job.data as DeviceOfflineJob
          console.log('[WORKER] Processing device offline:', data.deviceId, 'for household', data.householdId)
          await setDeviceOnline(data.householdId, data.deviceId, false, data.reason)
          console.log('[WORKER] Device offline processed')
        } catch (error) {
          console.error('[WORKER] Error processing device offline:', error)
          throw error
        }
      }
    })
  } catch (error) {
    console.error('[WORKER] Failed to register device offline job:', error)
  }

  // Device online job
  try {
    boss.work(JOB_NAMES.DEVICE_ONLINE, async (jobs) => {
      for (const job of jobs as any[]) {
        try {
          const data = job.data as DeviceOnlineJob
          console.log('[WORKER] Processing device online:', data.deviceId, 'for household', data.householdId)
          await setDeviceOnline(data.householdId, data.deviceId, true, data.reason)
          console.log('[WORKER] Device online processed')
        } catch (error) {
          console.error('[WORKER] Error processing device online:', error)
          throw error
        }
      }
    })
  } catch (error) {
    console.error('[WORKER] Failed to register device online job:', error)
  }

  // AI agents (advisory only; a failure here must not stop the worker)
  try { const { registerAiWorkers } = await import('@/lib/ai/workers'); await registerAiWorkers(boss) } catch (e) { console.error('[WORKER] AI workers failed to register', e) }

  console.log('[WORKER] Worker ready, waiting for jobs...')

  // Escalation backstop. Looks at the DATABASE every few seconds and escalates any waiting case
  // whose deadline has passed, so a case still moves on if the web process is down or restarting.
  // Safe to run next to the web server's own tick: each step is claimed atomically, so only one
  // of them ever sends the alert.
  const SWEEP_MS = Number(process.env.ESCALATION_SWEEP_MS || 5_000)
  let sweeping = false
  const sweepTimer = setInterval(async () => {
    if (sweeping) return
    sweeping = true
    try {
      const n = await sweepOverdueCases()
      if (n > 0) console.log(`[WORKER] Sweep escalated ${n} step(s)`)
    } catch (error) {
      console.error('[WORKER] Escalation sweep failed:', error)
    } finally {
      sweeping = false
    }
  }, SWEEP_MS)

  // Section 8.2: quiet-period sweep. Closes idle cases whose quiet period has passed.
  // Runs on a separate interval (default 30 seconds). The web server's tick() also runs this,
  // but the worker ensures it keeps running if the web process is down.
  const QUIET_SWEEP_MS = Number(process.env.QUIET_SWEEP_MS || 30_000)
  let quietSweeping = false
  const quietTimer = setInterval(async () => {
    if (quietSweeping) return
    quietSweeping = true
    try {
      const closed = await sweepQuietCases()
      if (closed.length > 0) console.log(`[WORKER] Quiet sweep closed ${closed.length} case(s)`)
    } catch (error) {
      console.error('[WORKER] Quiet sweep failed:', error)
    } finally {
      quietSweeping = false
    }
  }, QUIET_SWEEP_MS)

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('[WORKER] Shutting down...')
    clearInterval(sweepTimer)
    clearInterval(quietTimer)
    await stopQueue()
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('[WORKER] Fatal error:', error)
    process.exit(1)
  })
}

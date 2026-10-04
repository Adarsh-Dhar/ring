/**
 * pg-boss worker for processing async jobs
 * Handles webhook events, device status updates, and timers
 */

import { initQueue, stopQueue } from '@/lib/queue'
import { JOB_NAMES, type WebhookProcessJob, type DeviceOfflineJob, type DeviceOnlineJob } from '@/lib/queue/jobs'
import { ingestEvent, setDeviceOnline } from '@/lib/doorbell/store'

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

  console.log('[WORKER] Worker ready, waiting for jobs...')

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('[WORKER] Shutting down...')
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

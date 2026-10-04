/**
 * pg-boss job queue setup
 * Provides a singleton pg-boss instance for webhook processing
 */

import { PgBoss } from 'pg-boss'

let boss: PgBoss | null = null

export function getQueue(): PgBoss {
  if (!boss) {
    throw new Error('Queue not initialized. Call initQueue() first.')
  }
  return boss
}

export function isQueueInitialized(): boolean {
  return boss !== null
}

export async function initQueue(): Promise<PgBoss> {
  if (boss) {
    return boss
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for queue initialization')
  }

  boss = new PgBoss(databaseUrl)

  await boss.start()
  console.log('[QUEUE] pg-boss started')

  return boss
}

export async function stopQueue(): Promise<void> {
  if (boss) {
    await boss.stop()
    boss = null
    console.log('[QUEUE] pg-boss stopped')
  }
}

export async function enqueueJob<T = any>(
  name: string,
  data: T,
  options?: { startAfter?: number; retryLimit?: number }
): Promise<string> {
  const queue = getQueue()
  return queue.send(name, data as object, options)
}

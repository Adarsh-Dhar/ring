/**
 * Redis client singleton
 * Provides a configured Redis client with graceful degradation
 */

import Redis from 'ioredis'

let client: Redis | null = null

export function getRedis(): Redis {
  if (!client) {
    const redisUrl = process.env.REDIS_URL

    if (!redisUrl) {
      throw new Error('REDIS_URL is not configured')
    }

    client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000)
        return delay
      },
    })

    client.on('error', (error) => {
      console.error('[REDIS] Error:', error)
    })

    client.on('connect', () => {
      console.log('[REDIS] Connected')
    })

    client.on('disconnect', () => {
      console.warn('[REDIS] Disconnected')
    })
  }

  return client
}

export function isRedisConfigured(): boolean {
  return !!process.env.REDIS_URL
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit()
    client = null
    console.log('[REDIS] Closed')
  }
}

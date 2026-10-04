/**
 * Redis-based rate limiter
 * Provides distributed rate limiting using Redis INCR and EXPIRE
 */

import { getRedis, isRedisConfigured } from '@/lib/redis'

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  reset: number
  limit: number
}

export interface RateLimitOptions {
  key: string
  limit: number
  window: number // in seconds
}

/**
 * Check if a request is within rate limits
 */
export async function checkRateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  const { key, limit, window } = options

  // If Redis is not configured, allow all requests (fail-open for development)
  if (!isRedisConfigured()) {
    console.warn('[RATELIMIT] Redis not configured, allowing all requests')
    return {
      allowed: true,
      remaining: limit,
      reset: Date.now() + window * 1000,
      limit,
    }
  }

  try {
    const redis = getRedis()

    const redisKey = `ratelimit:${key}`
    const now = Date.now()
    const windowStart = Math.floor(now / 1000) - (Math.floor(now / 1000) % window)

    // Use a sorted set to track requests within the window
    const multi = redis.multi()
    multi.zremrangebyscore(redisKey, 0, windowStart - 1) // Remove old entries
    multi.zcard(redisKey) // Count current entries
    multi.zadd(redisKey, now, `${now}-${Math.random()}`) // Add current request
    multi.expire(redisKey, window + 1) // Set expiry
    const results = await multi.exec()

    if (!results) {
      throw new Error('Redis multi-exec failed')
    }

    const count = results[1][1] as number

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      reset: (windowStart + window) * 1000,
      limit,
    }
  } catch (error) {
    console.error('[RATELIMIT] Error checking rate limit:', error)
    // Fail-open on Redis errors to avoid blocking legitimate requests
    return {
      allowed: true,
      remaining: limit,
      reset: Date.now() + window * 1000,
      limit,
    }
  }
}

/**
 * Reset rate limit for a key (useful for testing or manual intervention)
 */
export async function resetRateLimit(key: string): Promise<void> {
  if (!isRedisConfigured()) {
    return
  }

  try {
    const redis = getRedis()
    await redis.del(`ratelimit:${key}`)
  } catch (error) {
    console.error('[RATELIMIT] Error resetting rate limit:', error)
  }
}

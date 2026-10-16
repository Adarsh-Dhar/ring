/**
 * Next.js instrumentation - runs at application startup
 * This is the right place to validate environment variables
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Only run validation in Node.js runtime (not edge)
    try {
      const { validateEnvOrThrow } = await import('./lib/env-validate')
      validateEnvOrThrow()
    } catch (error) {
      console.error('[STARTUP] Environment validation failed:', error)
      // In development, we might want to continue anyway
      // In production, this should fail fast
      if (process.env.NODE_ENV === 'production') {
        throw error
      }
    }
  }
}

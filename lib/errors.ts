/**
 * Centralised error reporting.
 *
 * In development / test this just logs to stderr.
 * In production, set SENTRY_DSN to forward errors to Sentry.
 *
 * We deliberately avoid pulling in @sentry/nextjs at the package level so the
 * build works without any Sentry credentials.  When SENTRY_DSN is set the
 * module is loaded lazily on first use so it never blocks boot.
 */

type SentryCapture = (err: unknown, extra?: Record<string, unknown>) => void

let _capture: SentryCapture | null = null
let _initAttempted = false

async function loadSentry(): Promise<SentryCapture | null> {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return null
  try {
    // Dynamic import so builds without @sentry/node still compile.
    // Install with: npm install @sentry/node
    const Sentry = await import('@sentry/node' as string)
    if (typeof Sentry.init === 'function') {
      Sentry.init({ dsn, environment: process.env.NODE_ENV ?? 'production' })
      return (err, extra) => {
        Sentry.withScope((scope: { setExtras: (e: Record<string, unknown>) => void }) => {
          if (extra) scope.setExtras(extra)
          Sentry.captureException(err)
        })
      }
    }
  } catch {
    // @sentry/node not installed — that's fine, fall back to console
  }
  return null
}

/**
 * Report an unexpected error.
 *
 * Always logs to stderr. If SENTRY_DSN is set and @sentry/node is installed,
 * also sends to Sentry.
 *
 * @param err   - The error or unknown thrown value.
 * @param ctx   - Free-form key/value pairs for context (e.g. householdId, caseId).
 */
export async function captureError(err: unknown, ctx: Record<string, unknown> = {}): Promise<void> {
  // Always log locally first so errors are never silently swallowed.
  const msg = err instanceof Error ? err.message : String(err)
  console.error('[ERROR]', msg, ctx, err instanceof Error ? err.stack : '')

  if (!_initAttempted) {
    _initAttempted = true
    _capture = await loadSentry()
  }

  if (_capture) {
    try {
      _capture(err, ctx)
    } catch {
      // Never let the error reporter itself crash the app.
    }
  }
}

/**
 * Synchronous wrapper for fire-and-forget reporting in places where you
 * cannot await (e.g. inside setInterval callbacks).
 */
export function reportError(err: unknown, ctx: Record<string, unknown> = {}): void {
  captureError(err, ctx).catch(() => {})
}

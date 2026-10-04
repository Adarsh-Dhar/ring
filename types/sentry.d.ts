// Type declaration for optional Sentry import
declare module '@sentry/node' {
  export function init(options: { dsn: string; environment?: string }): void
  export function withScope(callback: (scope: { setExtras: (e: Record<string, unknown>) => void }) => void): void
  export function captureException(err: unknown): void
}

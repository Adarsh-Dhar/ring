/**
 * Client-safe audit view helpers (no database imports).
 * Structured audit rows for the helper's audit panel (actor, action, time, reference, outcome).
 */
export function auditRows(log: unknown): { at: string; actor: string; kind: string; ref?: string; detail?: any }[] {
  return (Array.isArray(log) ? log : [])
    .filter((e: any) => e && e.audit)
    .map((e: any) => ({ at: e.audit.at, actor: e.audit.actor, kind: e.audit.kind, ref: e.audit.ref, detail: e.audit.detail }))
}

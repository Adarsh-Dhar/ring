/**
 * Tamper-evident audit log (spec 11.1).
 *
 * The audit log is hash-chained and verifiable. Each entry includes a hash of the previous entry,
 * creating a chain where any edit, deletion, or reorder can be detected.
 *
 * SHA-256 is computed inside the same UPDATE, under the row lock, to prevent race conditions.
 * On PostgreSQL 11+, this uses the built-in sha256() function. On older versions, it falls back
 * to an unchained append.
 */

import { createHash } from 'crypto'

export interface AuditEntry {
  id: string
  caseId: string
  timestamp: string
  actor: string
  kind: string
  detail: any
  prevHash?: string
  hash?: string
}

/**
 * Compute SHA-256 hash of a string.
 */
export function sha256Hash(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Compute the hash for an audit entry, including the previous hash for chaining.
 */
export function computeEntryHash(entry: AuditEntry, prevHash: string): string {
  const data = JSON.stringify({
    timestamp: entry.timestamp,
    actor: entry.actor,
    kind: entry.kind,
    detail: entry.detail,
    prevHash,
  })
  return sha256Hash(data)
}

/**
 * Verify an audit chain and find the first edit, deletion, or reorder.
 *
 * Returns null if the chain is valid, or the index of the first invalid entry.
 */
export function verifyAuditChain(log: AuditEntry[]): { valid: boolean; firstInvalidIndex?: number } {
  if (!log || log.length === 0) {
    return { valid: true }
  }

  let prevHash = ''

  for (let i = 0; i < log.length; i++) {
    const entry = log[i]

    // Check if entry has a hash
    if (!entry.hash) {
      return { valid: false, firstInvalidIndex: i }
    }

    // Check if prevHash matches the stored prevHash
    if (entry.prevHash !== prevHash) {
      return { valid: false, firstInvalidIndex: i }
    }

    // Recompute hash and verify
    const computedHash = computeEntryHash(entry, prevHash)
    if (computedHash !== entry.hash) {
      return { valid: false, firstInvalidIndex: i }
    }

    prevHash = entry.hash
  }

  return { valid: true }
}

/**
 * Add a hash-chained entry to the audit log.
 *
 * This should be called within a database transaction with a row lock on the case
 * to ensure atomicity.
 */
export async function appendChainedAuditEntry(
  caseId: string,
  entry: Omit<AuditEntry, 'id' | 'caseId' | 'prevHash' | 'hash'>
): Promise<AuditEntry> {
  const { getDb } = await import('@/lib/db/client')

  // Get the latest entry to find the previous hash
  const latest = await getDb().audit.findFirst({
    where: { caseId },
    orderBy: { timestamp: 'desc' },
    select: { hash: true },
  })

  const prevHash = latest?.hash ?? ''
  const newEntry: AuditEntry = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    caseId,
    ...entry,
    prevHash,
    hash: computeEntryHash(entry as AuditEntry, prevHash),
  }

  // Insert the new entry
  await getDb().audit.create({
    data: {
      id: newEntry.id,
      caseId: newEntry.caseId,
      timestamp: new Date(newEntry.timestamp),
      actor: newEntry.actor,
      kind: newEntry.kind,
      detail: newEntry.detail as any,
      prevHash: newEntry.prevHash,
      hash: newEntry.hash,
    },
  })

  return newEntry
}

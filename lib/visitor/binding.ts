/**
 * Visitor pass: secret check + device binding.
 *
 * How it works
 *  - The guardian creates a pass. The server returns a one-time secret (in the visitor link) and
 *    stores only its SHA-256 hash.
 *  - The visitor's browser keeps a random "device secret". The first time the pass is used, the
 *    SHA-256 of that device secret is saved on the pass (trust on first use). The save is a
 *    compare-and-set ("only if nothing is bound yet"), so two phones racing for a fresh pass
 *    cannot both win.
 *  - From then on, any other device presenting the same link gets 'wrong_device' (HTTP 403).
 *
 * No database or Next.js imports, so it is unit-testable.
 */

import crypto from 'crypto'

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

/** Constant-time compare of two hex digests. */
export function sameHash(a: string, b: string): boolean {
  const x = new Uint8Array(Buffer.from(a, 'hex')), y = new Uint8Array(Buffer.from(b, 'hex'))
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y)
}

export interface PassRow {
  id: string
  householdId: string
  windowStart: Date
  windowEnd: Date
  revokedAt: Date | null
  boundDeviceHash: string | null
}

export interface PassStore {
  findBySecretHash(secretHash: string): Promise<PassRow | null>
  /** Atomic: set boundDeviceHash only if it is still null. true = this caller bound it. */
  bindIfUnbound(passId: string, deviceHash: string): Promise<boolean>
  /** Re-read after losing the bind race. */
  boundHash(passId: string): Promise<string | null>
  recordEvent(passId: string, type: 'used' | 'bound' | 'rejected', deviceHash: string | null): Promise<void>
}

export type UseResult =
  | { ok: true; passId: string; householdId: string; firstUse: boolean }
  | { ok: false; reason: 'invalid' | 'revoked' | 'outside_window' | 'wrong_device'; status: 400 | 403 | 404 }

export async function useVisitorPass(store: PassStore, secret: string, deviceSecret: string, now = new Date()): Promise<UseResult> {
  // Same answer for "no such pass" and "bad secret" so the endpoint is not a guessing oracle.
  if (secret.length < 32 || deviceSecret.length < 16) return { ok: false, reason: 'invalid', status: 404 }

  const pass = await store.findBySecretHash(sha256(secret))
  if (!pass) return { ok: false, reason: 'invalid', status: 404 }
  if (pass.revokedAt) return { ok: false, reason: 'revoked', status: 400 }
  if (now < pass.windowStart || now > pass.windowEnd) return { ok: false, reason: 'outside_window', status: 400 }

  const deviceHash = sha256(deviceSecret)
  let bound = pass.boundDeviceHash
  let firstUse = false

  if (!bound) {
    if (await store.bindIfUnbound(pass.id, deviceHash)) {
      await store.recordEvent(pass.id, 'bound', deviceHash)
      bound = deviceHash
      firstUse = true
    } else {
      bound = await store.boundHash(pass.id)   // somebody bound it between our read and write
    }
  }

  if (!bound || !sameHash(bound, deviceHash)) {
    await store.recordEvent(pass.id, 'rejected', deviceHash)
    return { ok: false, reason: 'wrong_device', status: 403 }
  }

  await store.recordEvent(pass.id, 'used', deviceHash)
  return { ok: true, passId: pass.id, householdId: pass.householdId, firstUse }
}

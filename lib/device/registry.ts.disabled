/**
 * Device registry for v2 architecture
 * Manages device keys, registration, and revocation
 */

import crypto from 'crypto'
import { getDb } from '@/lib/db/client'

const DEVICE_KEY_BYTES = 32
const DEVICE_SESSION_DURATION = 90 * 24 * 60 * 60 * 1000 // 90 days

export type DeviceKind = 'resident' | 'helper' | 'guardian' | 'visitor'

/**
 * Generate a device key pair
 */
export function generateDeviceKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })

  return { publicKey, privateKey }
}

/**
 * Register a new device
 */
export async function registerDevice(params: {
  householdId: string
  memberId?: string
  kind: DeviceKind
  publicKey: string
}): Promise<{ deviceId: string; privateKey: string }> {
  const db = getDb()

  // Generate key pair
  const { publicKey, privateKey } = generateDeviceKeyPair()

  // Check if there's already an active device of this kind for this household
  const existingDevice = await db.v2Device.findFirst({
    where: {
      householdId: params.householdId,
      kind: params.kind,
      revokedAt: null,
    },
  })

  if (existingDevice) {
    // Revoke the old device
    await db.v2Device.update({
      where: { id: existingDevice.id },
      data: { revokedAt: new Date() },
    })
  }

  // Create new device
  const device = await db.v2Device.create({
    data: {
      householdId: params.householdId,
      memberId: params.memberId,
      kind: params.kind,
      publicKey,
    },
  })

  return { deviceId: device.id, privateKey }
}

/**
 * Verify a device signature
 */
export function verifyDeviceSignature(publicKey: string, data: string, signature: string): boolean {
  try {
    const verify = crypto.createVerify('SHA256')
    verify.update(data)
    verify.end()
    return verify.verify(publicKey, signature, 'base64')
  } catch {
    return false
  }
}

/**
 * Create a device signature
 */
export function createDeviceSignature(privateKey: string, data: string): string {
  const sign = crypto.createSign('SHA256')
  sign.update(data)
  sign.end()
  return sign.sign(privateKey, 'base64')
}

/**
 * Get a device by ID
 */
export async function getDevice(deviceId: string) {
  const db = getDb()
  return db.v2Device.findUnique({
    where: { id: deviceId },
    include: { membership: true, household: true },
  })
}

/**
 * Get active device for a household and kind
 */
export async function getActiveDevice(householdId: string, kind: DeviceKind) {
  const db = getDb()
  return db.v2Device.findFirst({
    where: {
      householdId,
      kind,
      revokedAt: null,
    },
    include: { membership: true },
  })
}

/**
 * Revoke a device
 */
export async function revokeDevice(deviceId: string): Promise<void> {
  const db = getDb()
  await db.v2Device.update({
    where: { id: deviceId },
    data: { revokedAt: new Date() },
  })
}

/**
 * Update device last seen timestamp
 */
export async function updateDeviceLastSeen(deviceId: string): Promise<void> {
  const db = getDb()
  await db.v2Device.update({
    where: { id: deviceId },
    data: { lastSeenAt: new Date() },
  })
}

/**
 * Clean up old revoked devices (older than 30 days)
 */
export async function cleanupOldDevices(): Promise<number> {
  const db = getDb()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const result = await db.v2Device.deleteMany({
    where: {
      revokedAt: { lt: thirtyDaysAgo },
    },
  })

  return result.count
}

/**
 * Check if a device is still valid (not revoked, last seen within session duration)
 */
export function isDeviceValid(device: { revokedAt: Date | null; lastSeenAt: Date }): boolean {
  if (device.revokedAt) return false

  const sessionExpiry = new Date(device.lastSeenAt.getTime() + DEVICE_SESSION_DURATION)
  return new Date() < sessionExpiry
}

/**
 * Generate a pairing token for QR code
 */
export function generatePairingToken(householdId: string): string {
  const data = JSON.stringify({ householdId, expiresAt: Date.now() + 5 * 60 * 1000 })
  const signature = createDeviceSignature(getPairingPrivateKey(), data)
  return Buffer.from(JSON.stringify({ data, signature })).toString('base64url')
}

/**
 * Verify a pairing token
 */
export async function verifyPairingToken(token: string): Promise<{ householdId: string } | null> {
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString())
    const { data, signature } = decoded

    const parsed = JSON.parse(data)
    if (parsed.expiresAt < Date.now()) {
      return null // Token expired
    }

    const isValid = verifyDeviceSignature(getPairingPublicKey(), data, signature)
    if (!isValid) {
      return null // Invalid signature
    }

    return { householdId: parsed.householdId }
  } catch {
    return null
  }
}

// Hardcoded pairing key pair for QR codes (in production, use environment variables)
let PAIRING_KEY_PAIR: { publicKey: string; privateKey: string } | null = null

function getPairingKeyPair() {
  if (!PAIRING_KEY_PAIR) {
    // In production, load from environment variables
    PAIRING_KEY_PAIR = generateDeviceKeyPair()
  }
  return PAIRING_KEY_PAIR
}

function getPairingPublicKey() {
  return getPairingKeyPair().publicKey
}

function getPairingPrivateKey() {
  return getPairingKeyPair().privateKey
}

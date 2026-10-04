/**
 * Magic link authentication for v2 architecture
 * Passwordless login via email link
 */

import crypto from 'crypto'
import { getDb } from '@/lib/db/client'

const MAGIC_LINK_EXPIRY = 15 * 60 * 1000 // 15 minutes
const MAGIC_LINK_BYTES = 32

/**
 * Generate a magic link token for a user
 */
export async function generateMagicLink(email: string): Promise<{ token: string; expiresAt: Date }> {
  const db = getDb()

  // Find or create user
  let user = await db.user.findUnique({
    where: { email },
  })

  if (!user) {
    user = await db.user.create({
      data: { email },
    })
  }

  // Generate secure random token
  const token = crypto.randomBytes(MAGIC_LINK_BYTES).toString('base64url')
  const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY)

  // Store the token in the database
  await db.otpCode.create({
    data: {
      userId: user.id,
      codeHash: crypto.createHash('sha256').update(token).digest('hex'),
      expiresAt,
      attempts: 0,
    },
  })

  return { token, expiresAt }
}

/**
 * Verify a magic link token
 */
export async function verifyMagicLink(token: string): Promise<{ success: boolean; userId?: string; error?: string }> {
  const db = getDb()

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

  const otpRecord = await db.otpCode.findFirst({
    where: {
      codeHash: tokenHash,
      used: false,
      expiresAt: { gt: new Date() },
    },
    include: { user: true },
  })

  if (!otpRecord) {
    return { success: false, error: 'Invalid or expired magic link' }
  }

  // Mark as used
  await db.otpCode.update({
    where: { id: otpRecord.id },
    data: { used: true },
  })

  return { success: true, userId: otpRecord.userId }
}

/**
 * Send a magic link via email
 */
export async function sendMagicLink(email: string, returnUrl?: string): Promise<{ loginUrl: string }> {
  const { token, expiresAt } = await generateMagicLink(email)

  const baseUrl = process.env.APP_URL || 'http://localhost:3000'
  const loginUrl = `${baseUrl}/auth/magic-link?token=${token}${returnUrl ? `&return=${encodeURIComponent(returnUrl)}` : ''}`

  // TODO: Integrate with actual email sending service
  // For now, return the URL for testing
  console.log('[MAGIC LINK] Would send email to:', email)
  console.log('[MAGIC LINK] Login URL:', loginUrl)

  return { loginUrl }
}

/**
 * Validate magic link token format
 */
export function isValidMagicLinkToken(token: string): boolean {
  try {
    const buffer = Buffer.from(token, 'base64url')
    return buffer.length === MAGIC_LINK_BYTES
  } catch {
    return false
  }
}

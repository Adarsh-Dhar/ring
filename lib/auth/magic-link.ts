/**
 * Magic link authentication library
 * Implements magic link generation, verification, and sending
 */

import { getDb } from '@/lib/db/client'
import crypto from 'crypto'

const MAGIC_LINK_EXPIRY = 15 * 60 * 1000 // 15 minutes

export interface MagicLinkToken {
  kind: 'magic-link'
  userId: string
  householdId: string
  membershipId?: string
  email: string
  exp: number
}

const MAGIC_LINK_SECRET = process.env.AUTH_SECRET || 'dev-secret-do-not-use-in-production'

/**
 * Generate a magic link token (signed token, similar to JWT)
 */
export function generateMagicLinkToken(
  userId: string,
  householdId: string,
  email: string,
  membershipId?: string
): string {
  const exp = Math.floor(Date.now() / 1000) + Math.floor(MAGIC_LINK_EXPIRY / 1000)
  const data = JSON.stringify({
    kind: 'magic-link',
    userId,
    householdId,
    membershipId,
    email,
    exp,
  })
  const signature = crypto.createHmac('sha256', MAGIC_LINK_SECRET).update(data).digest('hex')
  return `${Buffer.from(data).toString('base64')}.${signature}`
}

/**
 * Verify a magic link token
 */
export function verifyMagicLinkToken(token: string): MagicLinkToken | null {
  try {
    const [dataB64, signature] = token.split('.')
    if (!dataB64 || !signature) return null

    const data = Buffer.from(dataB64, 'base64').toString('utf8')
    const expectedSignature = crypto.createHmac('sha256', MAGIC_LINK_SECRET).update(data).digest('hex')

    if (signature !== expectedSignature) {
      return null
    }

    const parsed = JSON.parse(data) as MagicLinkToken

    // Check expiration
    if (parsed.exp < Math.floor(Date.now() / 1000)) {
      return null
    }

    if (parsed.kind !== 'magic-link') {
      return null
    }

    return parsed
  } catch (error) {
    return null
  }
}

/**
 * Check if a magic link token is valid format
 */
export function isValidMagicLinkToken(token: string): boolean {
  const result = verifyMagicLinkToken(token)
  return result !== null
}

/**
 * Send magic link via email
 */
export async function sendMagicLink(email: string, magicLinkUrl: string): Promise<void> {
  // Check if Resend is configured
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.log('[MAGIC-LINK] Demo mode - magic link URL:', magicLinkUrl)
    return
  }

  // Send via Resend
  const Resend = await import('resend')
  const resend = new Resend.Resend(resendKey)

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'noreply@doorbell.example.com',
    to: email,
    subject: 'Sign in to Doorbell Helper',
    html: `
      <h1>Sign in to Doorbell Helper</h1>
      <p>Click the link below to sign in:</p>
      <p><a href="${magicLinkUrl}">Sign in to Doorbell Helper</a></p>
      <p>This link will expire in 15 minutes.</p>
      <p>If you didn't request this, you can safely ignore this email.</p>
    `,
  })
}

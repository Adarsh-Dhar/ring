/**
 * WebAuthn / Passkey authentication for v2 architecture
 * Replaces OTP for most logins; OTP remains as fallback
 */

import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/browser'

import { getDb } from '@/lib/db/client'

const RP_ID = process.env.APP_URL ? new URL(process.env.APP_URL).hostname : 'localhost'
const RP_NAME = 'Doorbell Helper'
const ORIGIN = process.env.APP_URL || 'http://localhost:3000'

/**
 * Convert base64 string to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = Buffer.from(base64, 'base64').toString('binary')
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

/**
 * Generate WebAuthn registration options for a new passkey
 */
export async function generatePasskeyRegistrationOptions(userId: string, userName: string) {
  const db = getDb()

  // Get existing passkeys for this user to exclude from credentials
  const existingPasskeys = await db.passkey.findMany({
    where: { memberId: userId },
    select: { credentialId: true },
  })

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: userId as unknown as Uint8Array,
    userName,
    // Don't allow user to register the same device twice
    excludeCredentials: existingPasskeys.map(pk => ({
      id: pk.credentialId,
      type: 'public-key',
    })),
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'preferred',
    },
  })

  return options
}

/**
 * Verify WebAuthn registration response and save the passkey
 */
export async function verifyPasskeyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  expectedChallenge: string
) {
  const db = getDb()

  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    })

    if (!verification.verified) {
      return { verified: false, error: 'Passkey verification failed' }
    }

    const { registrationInfo } = verification
    if (!registrationInfo) {
      return { verified: false, error: 'No registration info' }
    }

    const { credential } = registrationInfo

    // Save the passkey to the database
    await db.passkey.create({
      data: {
        memberId: userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64'),
        counter: credential.counter,
      },
    })

    return { verified: true }
  } catch (error) {
    console.error('[PASSKEY] Registration verification failed:', error)
    return { verified: false, error: 'Verification failed' }
  }
}

/**
 * Generate WebAuthn authentication options for login
 */
export async function generatePasskeyAuthenticationOptions(userIdentifier: string) {
  const db = getDb()

  // Find the user by email or phone
  const user = await db.user.findFirst({
    where: {
      OR: [{ email: userIdentifier }, { phone: userIdentifier }],
    },
  })

  if (!user) {
    throw new Error('User not found')
  }

  // Get all passkeys for this user
  const passkeys = await db.passkey.findMany({
    where: { memberId: user.id },
    select: { credentialId: true },
  })

  if (passkeys.length === 0) {
    throw new Error('No passkeys registered for this user')
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'preferred',
    allowCredentials: passkeys.map(pk => ({
      id: pk.credentialId,
      type: 'public-key',
    })),
  })

  return { options, userId: user.id }
}

/**
 * Verify WebAuthn authentication response
 */
export async function verifyPasskeyAuthentication(
  response: AuthenticationResponseJSON,
  expectedChallenge: string
) {
  const db = getDb()

  try {
    const credentialID = response.id

    // Find the passkey
    const passkey = await db.passkey.findUnique({
      where: { credentialId: credentialID },
      include: { membership: true },
    })

    if (!passkey) {
      return { verified: false, error: 'Passkey not found' }
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64')),
        counter: passkey.counter,
      },
    })

    if (!verification.verified) {
      return { verified: false, error: 'Authentication failed' }
    }

    const { authenticationInfo } = verification
    if (!authenticationInfo) {
      return { verified: false, error: 'No authentication info' }
    }

    // Update the counter
    await db.passkey.update({
      where: { id: passkey.id },
      data: { counter: authenticationInfo.newCounter },
    })

    return {
      verified: true,
      membershipId: passkey.membership.id,
      householdId: passkey.membership.householdId,
    }
  } catch (error) {
    console.error('[PASSKEY] Authentication verification failed:', error)
    return { verified: false, error: 'Verification failed' }
  }
}

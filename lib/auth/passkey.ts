/**
 * WebAuthn passkey authentication library
 * Implements passkey registration and verification
 */

import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server'
import { getDb } from '@/lib/db/client'

const RP_ID = process.env.NEXT_PUBLIC_APP_URL?.replace(/^https?:\/\//, '').replace(/:\d+$/, '') || 'localhost'
const RP_NAME = 'Doorbell Helper'
const RP_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

/**
 * Generate WebAuthn registration options for a new passkey
 */
export async function generatePasskeyRegistrationOptions(userId: string, userName: string) {
  const db = getDb()
  const user = await db.user.findUnique({
    where: { id: userId },
  })

  if (!user) {
    throw new Error('User not found')
  }

  // Get existing passkeys to exclude
  const passkeys = await db.passkey.findMany({
    where: { memberId: userId },
    select: { credentialId: true },
  })

  const excludeCredentials = passkeys.map(pk => ({
    id: pk.credentialId,
    transports: ['internal', 'hybrid'] as ('internal' | 'hybrid')[],
  }))

  const options = await generateRegistrationOptions({
    rpID: RP_ID,
    rpName: RP_NAME,
    userID: new TextEncoder().encode(userId),
    userName: userName || user.name || 'User',
    excludeCredentials,
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
  response: any,
  expectedChallenge: string
) {
  const db = getDb()
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: RP_ORIGIN,
    expectedRPID: RP_ID,
  })

  if (!verification.verified) {
    throw new Error('Passkey registration verification failed')
  }

  const { registrationInfo } = verification

  if (!registrationInfo) {
    throw new Error('No registration info in verification')
  }

  // Save the passkey
  await db.passkey.create({
    data: {
      memberId: userId,
      credentialId: registrationInfo.credential?.id || '',
      publicKey: JSON.stringify(registrationInfo.credential?.publicKey || ''),
      counter: registrationInfo.credential?.counter || 0,
    },
  })

  return verification
}

/**
 * Generate WebAuthn authentication options for an existing passkey
 */
export async function generatePasskeyAuthenticationOptions(userId: string) {
  const db = getDb()
  const passkeys = await db.passkey.findMany({
    where: { memberId: userId },
    select: { credentialId: true, publicKey: true, counter: true },
  })

  if (passkeys.length === 0) {
    throw new Error('No passkeys found for user')
  }

  const allowCredentials = passkeys.map(pk => ({
    id: pk.credentialId,
    transports: ['internal', 'hybrid'] as ('internal' | 'hybrid')[],
  }))

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'preferred',
    allowCredentials,
  })

  return options
}

/**
 * Verify WebAuthn authentication response
 */
export async function verifyPasskeyAuthentication(
  response: any,
  expectedChallenge: string
) {
  const db = getDb()
  
  // Get the authenticator from the credential ID in the response
  const authenticator = await db.passkey.findUnique({
    where: { credentialId: response.id },
    select: { credentialId: true, publicKey: true, counter: true, memberId: true },
  })

  if (!authenticator) {
    throw new Error('Passkey not found')
  }

  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: authenticator.credentialId,
        publicKey: JSON.parse(authenticator.publicKey),
        counter: authenticator.counter,
        transports: ['internal', 'hybrid'] as ('internal' | 'hybrid')[],
      },
      requireUserVerification: false,
    })

    if (!verification.verified) {
      throw new Error('Passkey authentication verification failed')
    }

    const { authenticationInfo } = verification

    if (!authenticationInfo) {
      throw new Error('No authentication info in verification')
    }

    // Update the passkey counter
    await db.passkey.updateMany({
      where: { credentialId: authenticationInfo.credentialID },
      data: { counter: authenticationInfo.newCounter },
    })

    return { verification, userId: authenticator.memberId }
  } catch (error) {
    console.error('[PASSKEY] Verification error:', error)
    throw new Error('Passkey authentication verification failed')
  }
}

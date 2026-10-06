/**
 * Google OAuth Client Management
 * Handles OAuth2 client creation, token storage, and refresh
 * Uses Device Authorization Grant for limited input devices
 */

import { google } from 'googleapis';
import { getDb } from '@/lib/db/client';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from './config';

export async function getAuthedClient(userId: string) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.warn('Google OAuth credentials not configured');
    return null;
  }

  try {
    const db = getDb();
    const user = await db.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      console.warn(`No user found with id: ${userId}`);
      return null;
    }

    if (!user.googleRefreshToken) {
      console.warn('User has no Google refresh token stored');
      return null;
    }

    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      access_token: user.googleAccessToken || undefined,
      refresh_token: user.googleRefreshToken,
      expiry_date: user.googleTokenExpiry ? user.googleTokenExpiry.getTime() : undefined,
    });

    // Set up token refresh handler
    oauth2Client.on('tokens', async (tokens) => {
      try {
        console.log('Google OAuth tokens refreshed, persisting to database');
        const newExpiryDate = new Date(tokens.expiry_date || Date.now() + 3600000);

        await db.user.update({
          where: { id: userId },
          data: {
            googleAccessToken: tokens.access_token,
            googleTokenExpiry: newExpiryDate,
          },
        });
      } catch (error) {
        console.error('Failed to persist refreshed Google OAuth tokens', error);
      }
    });

    // Check if token is expired and refresh if needed
    if (user.googleTokenExpiry && user.googleTokenExpiry.getTime() < Date.now()) {
      console.log('Google OAuth token expired, attempting refresh');
      try {
        await oauth2Client.refreshAccessToken();
        console.log('Google OAuth token refreshed successfully');
      } catch (error) {
        console.error('Failed to refresh Google OAuth token', error);
        return null;
      }
    }

    return oauth2Client;
  } catch (error) {
    console.error('Failed to get authenticated Google client', error);
    return null;
  }
}

export type AuthedClientResult =
  | { ok: true; client: InstanceType<typeof google.auth.OAuth2> }
  | { ok: false; reason: 'not_connected' }
  | { ok: false; reason: 'refresh_failed' };

export async function getAuthedClientOrReason(userId: string): Promise<AuthedClientResult> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return { ok: false, reason: 'not_connected' };
  }

  const db = getDb();
  const user = await db.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    return { ok: false, reason: 'not_connected' };
  }

  if (!user.googleRefreshToken) {
    return { ok: false, reason: 'not_connected' };
  }

  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    access_token: user.googleAccessToken || undefined,
    refresh_token: user.googleRefreshToken,
    expiry_date: user.googleTokenExpiry ? new Date(user.googleTokenExpiry).getTime() : undefined,
  });

  // Check if token is expired and refresh if needed
  if (user.googleTokenExpiry && new Date(user.googleTokenExpiry).getTime() < Date.now()) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      const newExpiryDate = new Date(credentials.expiry_date || Date.now() + 3600000);

      await db.user.update({
        where: { id: userId },
        data: {
          googleAccessToken: credentials.access_token,
          googleTokenExpiry: newExpiryDate,
        },
      });

      oauth2Client.setCredentials({
        access_token: credentials.access_token,
        refresh_token: user.googleRefreshToken,
        expiry_date: credentials.expiry_date ? new Date(credentials.expiry_date).getTime() : undefined,
      });
    } catch (error) {
      console.error('Failed to refresh Google OAuth token', error);
      return { ok: false, reason: 'refresh_failed' };
    }
  }

  return { ok: true, client: oauth2Client };
}

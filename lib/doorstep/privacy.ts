/**
 * Privacy settings and retention (spec 11.2).
 *
 * Retention and AI video-analysis switch: stored in the existing resident
 * preferences JSON (preferences.privacy), saved by the existing delegation API.
 * No migration.
 */

import { getDb } from '@/lib/db/client'

export interface PrivacySettings {
  /** Whether AI video analysis is enabled */
  aiVideoAnalysis: boolean
  /** Retention period for video in days (pilot value) */
  videoRetentionDays: number
  /** Retention period for audio in days (pilot value) */
  audioRetentionDays: number
  /** Retention period for transcript in days (pilot value) */
  transcriptRetentionDays: number
  /** Retention period for audit log in days (pilot value) */
  auditRetentionDays: number
}

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  aiVideoAnalysis: true,
  videoRetentionDays: 30,
  audioRetentionDays: 30,
  transcriptRetentionDays: 90,
  auditRetentionDays: 365,
}

/**
 * Get privacy settings for a household.
 */
export async function getPrivacySettings(householdId: string): Promise<PrivacySettings> {
  const db = getDb()
  const prefs = await db.preferences.findUnique({
    where: { householdId },
    select: { preferences: true },
  })

  if (!prefs || !prefs.preferences) {
    return DEFAULT_PRIVACY_SETTINGS
  }

  const raw = prefs.preferences as any
  const privacy = raw.privacy as PrivacySettings | undefined

  if (!privacy) {
    return DEFAULT_PRIVACY_SETTINGS
  }

  return {
    aiVideoAnalysis: typeof privacy.aiVideoAnalysis === 'boolean' ? privacy.aiVideoAnalysis : DEFAULT_PRIVACY_SETTINGS.aiVideoAnalysis,
    videoRetentionDays: typeof privacy.videoRetentionDays === 'number' ? privacy.videoRetentionDays : DEFAULT_PRIVACY_SETTINGS.videoRetentionDays,
    audioRetentionDays: typeof privacy.audioRetentionDays === 'number' ? privacy.audioRetentionDays : DEFAULT_PRIVACY_SETTINGS.audioRetentionDays,
    transcriptRetentionDays: typeof privacy.transcriptRetentionDays === 'number' ? privacy.transcriptRetentionDays : DEFAULT_PRIVACY_SETTINGS.transcriptRetentionDays,
    auditRetentionDays: typeof privacy.auditRetentionDays === 'number' ? privacy.auditRetentionDays : DEFAULT_PRIVACY_SETTINGS.auditRetentionDays,
  }
}

/**
 * Update privacy settings for a household.
 */
export async function updatePrivacySettings(
  householdId: string,
  settings: Partial<PrivacySettings>
): Promise<void> {
  const db = getDb()
  const current = await getPrivacySettings(householdId)
  const updated = { ...current, ...settings }

  await db.preferences.upsert({
    where: { householdId },
    create: {
      householdId,
      preferences: { privacy: updated } as any,
    },
    update: {
      preferences: { privacy: updated } as any,
    },
  })
}

/**
 * Compute deletion plan based on retention settings.
 *
 * Returns the dates before which data should be deleted.
 * This is a planning function only - actual deletion is a separate job.
 */
export function computeDeletionPlan(settings: PrivacySettings): {
  deleteVideoBefore: Date
  deleteAudioBefore: Date
  deleteTranscriptBefore: Date
  deleteAuditBefore: Date
} {
  const now = new Date()

  return {
    deleteVideoBefore: new Date(now.getTime() - settings.videoRetentionDays * 24 * 60 * 60 * 1000),
    deleteAudioBefore: new Date(now.getTime() - settings.audioRetentionDays * 24 * 60 * 60 * 1000),
    deleteTranscriptBefore: new Date(now.getTime() - settings.transcriptRetentionDays * 24 * 60 * 60 * 1000),
    deleteAuditBefore: new Date(now.getTime() - settings.auditRetentionDays * 24 * 60 * 60 * 1000),
  }
}

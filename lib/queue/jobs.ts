/**
 * Job definitions for pg-boss
 * Defines the job names and their expected data structures
 */

export const JOB_NAMES = {
  WEBHOOK_PROCESS: 'webhook-process',
  DEVICE_OFFLINE: 'device-offline',
  DEVICE_ONLINE: 'device-online',
  CHECKIN_REMINDER: 'checkin-reminder',
  VISIT_EXPIRY: 'visit-expiry',
} as const

export type JobName = typeof JOB_NAMES[keyof typeof JOB_NAMES]

export interface WebhookProcessJob {
  householdId: string
  eventType: string
  eventId: string
  deviceId: string | null
  raw: unknown
}

export interface DeviceOfflineJob {
  householdId: string
  deviceId: string
  reason: string
}

export interface DeviceOnlineJob {
  householdId: string
  deviceId: string
  reason: string
}

export interface CheckinReminderJob {
  householdId: string
  caseId: string
  visitId?: string
}

export interface VisitExpiryJob {
  householdId: string
  visitId: string
}

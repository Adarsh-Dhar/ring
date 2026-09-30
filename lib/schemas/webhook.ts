import { z } from 'zod'

/**
 * Ring Partner API webhook, payload v1.1.
 * https://developer.amazon.com/docs/ring/notifications.html
 * Deliberately lenient: a harmless schema change on Ring's side must never make us drop a doorbell press.
 */
export const RingWebhookSchema = z.object({
  meta: z.object({
    version: z.string().optional(),
    time: z.string().optional(),
    request_id: z.string().optional(),
    account_id: z.string().optional(),
  }).passthrough(),
  data: z.object({
    id: z.string().optional(),
    type: z.string().min(1),
    attributes: z.object({
      source: z.string().optional(),
      source_type: z.string().optional(),
      timestamp: z.union([z.number(), z.string()]).optional(),
    }).passthrough().default({}),
  }).passthrough(),
})

export type RingWebhook = z.infer<typeof RingWebhookSchema>

/** Every event type Ring documents. Anything else is acknowledged (200) and ignored, never 4xx. */
export const RING_EVENT_TYPES = ['motion_detected', 'button_press', 'device_added', 'device_removed', 'device_online', 'device_offline'] as const


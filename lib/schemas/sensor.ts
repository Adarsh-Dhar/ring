import { z } from 'zod'

/**
 * Sensor event payload for the /api/doorbell/sensor endpoint.
 * This is a proposed format — finalize after real hardware is available.
 *
 * Security:
 *  - All fields are validated before any processing.
 *  - The `at` timestamp is checked within ±5 minutes to prevent replay attacks.
 *  - HMAC verification uses SENSOR_HMAC_KEY (see env-validate.ts).
 *  - Idempotency is enforced via eventId stored in WebhookEvent.
 */

/** Sensor event types mapped to doorstep behaviours:
 *  knock        → extra_knock (through the existing kind:'knock' edit)
 *  lock_tamper  → lock_manipulation
 *  door_wedge   → door_wedge_or_follow_in
 *  door_force   → forced_entry_or_assault
 *  tamper       → forced_entry_or_assault
 *  visitor_left → no behaviour. Departure evidence (section 8.1): the case moves to visitor_left and the score is frozen.
 */
export const SENSOR_EVENT_TYPES = ['knock', 'lock_tamper', 'door_wedge', 'door_force', 'tamper', 'visitor_left'] as const
export type SensorEventType = (typeof SENSOR_EVENT_TYPES)[number]

export const SensorEventSchema = z.object({
  /** Unique identifier for the physical device (used for household lookup). */
  deviceId: z.string().min(1).max(80),
  /** Idempotency key — store this in WebhookEvent to deduplicate retries. */
  eventId: z.string().min(1).max(120),
  /** Event type. */
  type: z.enum(['knock', 'lock_tamper', 'door_wedge', 'door_force', 'tamper', 'visitor_left'] as const),
  /** ISO 8601 timestamp when the sensor fired. Must be within ±5 minutes of server time. */
  at: z.string().refine(s => !isNaN(new Date(s).getTime()), 'Must be a valid ISO 8601 timestamp'),
  /** Optional debug payload (never used in scoring). */
  meta: z.record(z.string(), z.unknown()).optional(),
})

export type SensorEvent = z.infer<typeof SensorEventSchema>

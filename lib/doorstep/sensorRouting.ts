/**
 * Which household does a sensor event belong to? Never guess.
 * A sensor deviceId is only unique per household (Device has @@unique([householdId, ringDeviceId])), so the same
 * id can exist twice, and an unregistered id must never be sent to some other home. Anything but exactly one match is dropped.
 *
 * H-33: Unregistered devices are logged for admin alerting (not implemented yet, just dropped).
 */
export type SensorRoute =
  | { ok: true; householdId: string }
  | { ok: false; reason: 'unknown_device' | 'ambiguous_device' }

export function resolveSensorHousehold(rows: { householdId: string }[]): SensorRoute {
  const ids = [...new Set(rows.map(r => r.householdId))]
  if (ids.length === 0) {
    // H-33: Log unregistered device events for admin alerting
    console.error('[SENSOR] Unregistered device - event dropped')
    return { ok: false, reason: 'unknown_device' }
  }
  if (ids.length > 1) return { ok: false, reason: 'ambiguous_device' }
  return { ok: true, householdId: ids[0] }
}

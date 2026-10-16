/**
 * Shared utilities for simulator video storage.
 */

// Allowed simulator device IDs
const ALLOWED_DEVICES = new Set(['sim-front-door', 'sim-back-door'])

/**
 * Sanitise device suffix to allow only safe characters and ensure it's in the allowlist.
 * Returns null if invalid.
 */
export function sanitiseDevice(device: string): string | null {
  if (!device || !device.startsWith('sim-')) return null
  if (!ALLOWED_DEVICES.has(device)) return null
  return device
}

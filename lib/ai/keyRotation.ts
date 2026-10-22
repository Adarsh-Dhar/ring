/**
 * API key rotation system for Gemini API.
 * Automatically rotates to the next key when quota is exhausted (HTTP 429).
 */

const KEYS = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '')
  .split(',')
  .map(k => k.trim())
  .filter(Boolean)

let currentIndex = 0
const keyErrors = new Map<number, number>() // Track consecutive errors per key

/**
 * Get the current API key.
 */
export function getCurrentKey(): string {
  if (KEYS.length === 0) return ''
  return KEYS[currentIndex]
}

/**
 * Get all available keys.
 */
export function getAllKeys(): string[] {
  return [...KEYS]
}

/**
 * Rotate to the next key after a quota error.
 * Returns true if a new key was selected, false if all keys are exhausted.
 */
export function rotateKey(error?: Error): boolean {
  if (KEYS.length <= 1) return false

  // If this is a 429 error, mark this key as having an error
  if (error?.message.includes('429') || error?.message.includes('quota')) {
    const errorCount = (keyErrors.get(currentIndex) || 0) + 1
    keyErrors.set(currentIndex, errorCount)

    // If we've seen 3 consecutive 429 errors on this key, rotate
    if (errorCount >= 3) {
      console.warn(`[Key Rotation] Key ${currentIndex} has ${errorCount} quota errors, rotating to next key`)
      keyErrors.set(currentIndex, 0) // Reset error count for this key
      currentIndex = (currentIndex + 1) % KEYS.length
      console.log(`[Key Rotation] Now using key ${currentIndex} of ${KEYS.length}`)
      return true
    }
  } else {
    // Reset error count on non-quota errors
    keyErrors.set(currentIndex, 0)
  }

  return false
}

/**
 * Force rotation to the next key (manual override).
 */
export function forceRotateKey(): string {
  if (KEYS.length <= 1) return getCurrentKey()
  currentIndex = (currentIndex + 1) % KEYS.length
  keyErrors.set(currentIndex, 0)
  console.log(`[Key Rotation] Force rotated to key ${currentIndex} of ${KEYS.length}`)
  return getCurrentKey()
}

/**
 * Reset to the first key.
 */
export function resetKeys(): void {
  currentIndex = 0
  keyErrors.clear()
  console.log('[Key Rotation] Reset to first key')
}

/**
 * Get current key index and total count.
 */
export function getKeyStatus(): { current: number; total: number; currentKey: string } {
  return {
    current: currentIndex,
    total: KEYS.length,
    currentKey: KEYS[currentIndex]?.substring(0, 20) + '...' || 'none',
  }
}

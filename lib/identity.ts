/**
 * Canonical forms for phone numbers and email addresses.
 *
 * Storing and looking up addresses in a single canonical form prevents
 * duplicate accounts: "98765 43210", "+9198765 43210", and "+919876543210"
 * must all resolve to the same user row.
 *
 * Phone normalisation rules:
 *   1. Strip spaces, hyphens, dots, parentheses.
 *   2. "00…" prefix → "+…"
 *   3. No leading "+"? → prepend DEFAULT_COUNTRY_CODE (env var, default "+91").
 *   4. Strip any remaining leading zeros after the country code.
 *   5. Validate: must be "+<8–15 digits>".
 *   Returns null when the result doesn't look like a real phone number.
 *
 * Email normalisation: trim + lowercase only.  Subaddress (+tag) and
 * dot-insensitivity vary by provider so we leave those alone.
 */

/**
 * Normalise a raw phone string to E.164.
 * Returns null if the result is not a plausible phone number.
 *
 * @param raw          The string the user typed.
 * @param defaultCc    Country-code prefix to prepend when none is present.
 *                     Reads DEFAULT_COUNTRY_CODE from the environment first.
 */
export function normalizePhone(
  raw: string,
  defaultCc = process.env.DEFAULT_COUNTRY_CODE ?? '+91'
): string | null {
  // Strip visual separators
  let s = raw.replace(/[\s\-().]/g, '')

  // "00…" international prefix → "+"
  if (s.startsWith('00')) s = '+' + s.slice(2)

  // No "+"? Treat as a local number and prepend the default country code.
  // Strip any leading zeros that represent a trunk prefix (e.g. "0" in India).
  if (!s.startsWith('+')) {
    s = defaultCc + s.replace(/^0+/, '')
  }

  // Final validation: "+" followed by 8–15 digits
  return /^\+\d{8,15}$/.test(s) ? s : null
}

/** Normalise an email address: trim whitespace and lowercase. */
export function normalizeEmail(e: string): string {
  return e.trim().toLowerCase()
}

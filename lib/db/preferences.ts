import { getDb } from './client'
import { parsePreferences, type Preferences } from '../doorstep/residentPreferences'

/** Resident preferences for one household. Never throws: a read failure gives the safe defaults. */
export async function getPreferences(householdId: string): Promise<Preferences> {
  try {
    const h = await getDb().household.findUnique({ where: { id: householdId }, select: { preferences: true } as any })
    return parsePreferences((h as any)?.preferences)
  } catch (e) {
    console.error('[PREFERENCES] read failed, using defaults', e)
    return parsePreferences(null)
  }
}

/** Validate, then store. Returns what was actually saved. */
export async function setPreferences(householdId: string, raw: unknown): Promise<Preferences> {
  const prefs = parsePreferences(raw)
  await getDb().household.update({ where: { id: householdId }, data: { preferences: prefs as any } as any })
  return prefs
}

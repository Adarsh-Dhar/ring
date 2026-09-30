/** Time helpers that use the RESIDENT's time zone, never the server's clock. */

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function fmt(tz: string) {
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    fmtCache.set(tz, f)
  }
  return f
}

export function zonedParts(ms: number, tz: string) {
  const o: Record<string, number> = {}
  for (const p of fmt(tz).formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value)
  return { year: o.year, month: o.month, day: o.day, hour: o.hour % 24, minute: o.minute, second: o.second }
}

export const zonedHour = (ms: number, tz: string) => zonedParts(ms, tz).hour

export function zonedDayKey(ms: number, tz: string) {
  const p = zonedParts(ms, tz)
  return `${p.year}-${p.month}-${p.day}`
}

/** UTC offset (in ms) of `tz` at instant `ms`. */
function offsetMs(ms: number, tz: string) {
  const p = zonedParts(ms, tz)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000
}

/** The instant (ms) at which it is `hour`:00 local time, on the local day that contains `ms`. */
export function zonedHourOnSameDay(ms: number, tz: string, hour: number) {
  const p = zonedParts(ms, tz)
  return Date.UTC(p.year, p.month - 1, p.day, hour, 0, 0) - offsetMs(ms, tz)
}

export function isValidTimeZone(tz: string) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true } catch { return false }
}

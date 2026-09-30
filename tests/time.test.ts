import { describe, it, expect } from 'vitest'
import { zonedHour, zonedDayKey, zonedHourOnSameDay } from '../lib/time'

describe('resident time zone (India, UTC+5:30)', () => {
  // 2026-10-01 20:00 UTC == 2026-10-02 01:30 IST
  const t = Date.UTC(2026, 9, 1, 20, 0, 0)
  it('uses the resident clock, not the server clock', () => {
    expect(zonedHour(t, 'Asia/Kolkata')).toBe(1)
    expect(zonedDayKey(t, 'Asia/Kolkata')).toBe('2026-10-2')
    expect(zonedDayKey(t, 'UTC')).toBe('2026-10-1')
  })
  it('finds 10:00 local on the same local day', () => {
    // 10:00 IST on 2 Oct == 04:30 UTC on 2 Oct
    expect(zonedHourOnSameDay(t, 'Asia/Kolkata', 10)).toBe(Date.UTC(2026, 9, 2, 4, 30, 0))
  })
})

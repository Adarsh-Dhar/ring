/**
 * Debug script to check current state
 */
import { loadState } from '../lib/doorbell/persist'

const state = loadState<any>()
console.log('Current state:')
console.log('  checkinAt:', state.checkinAt)
console.log('  missedAlertDay:', state.missedAlertDay)
console.log('  RESIDENT_TZ:', process.env.RESIDENT_TZ)
console.log('  CHECKIN_HOUR:', process.env.CHECKIN_HOUR)
console.log('  CHECKIN_GRACE_MIN:', process.env.CHECKIN_GRACE_MIN)

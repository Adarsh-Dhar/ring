import type { TalkbackProvider } from './types'
import { RingTalkback } from './ring'
import { SimTalkback } from './sim'
export * from './types'
export { greeterLines, LISTEN_SECONDS } from './lines'

export function pickTalkback(deviceId: string | null | undefined): TalkbackProvider {
  return !deviceId || deviceId.startsWith('sim-') ? SimTalkback : RingTalkback
}

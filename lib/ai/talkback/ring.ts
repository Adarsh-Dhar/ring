import type { TalkbackProvider } from './types'

/**
 * Ring Partner API talk-back. NOT IMPLEMENTED: lib/ring/client.ts only has receive-only WHEP video and no
 * speaker / two-way audio endpoint is verified. Once Ring confirms one, implement say()/listen() here and
 * set RING_TALKBACK_ENABLED=1. Until then the interrogator reports `unsupported` and the helper alert is unaffected.
 */
export const RingTalkback: TalkbackProvider = {
  name: 'ring',
  async serverDriven() { return process.env.RING_TALKBACK_ENABLED === '1' },
  async say() { return false },
  async listen() { return null },
}

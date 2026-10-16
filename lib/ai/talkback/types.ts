/**
 * Two-way audio abstraction. The opener, reprompt and close are fixed lines.
 * Follow-up questions are model-worded and validated before being spoken.
 */
export type LineId = 'greet' | 'reprompt' | 'close'

export interface TalkbackProvider {
  readonly name: 'ring' | 'sim'
  /** Can this provider drive the speaker for this device from the server? */
  serverDriven(householdId: string, deviceId: string | null): Promise<boolean>
  /** Play a fixed line or validated question text. Resolves false if it could not be played. */
  say(householdId: string, deviceId: string, lineOrText: LineId | string): Promise<boolean>
  /** Record up to maxSec of the visitor's reply. null = nothing heard / unsupported. */
  listen(householdId: string, deviceId: string, maxSec: number): Promise<{ data: Buffer; mimeType: string } | null>
}

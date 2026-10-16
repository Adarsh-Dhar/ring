/**
 * Two-way audio abstraction. The model never speaks freely: only ids from GREETER_LINES are ever played.
 */
export type LineId = 'greet' | 'reprompt' | 'close'

export interface TalkbackProvider {
  readonly name: 'ring' | 'sim'
  /** Can this provider drive the speaker for this device from the server? */
  serverDriven(householdId: string, deviceId: string | null): Promise<boolean>
  /** Play a fixed line. Resolves false if it could not be played. */
  say(householdId: string, deviceId: string, line: LineId): Promise<boolean>
  /** Record up to maxSec of the visitor's reply. null = nothing heard / unsupported. */
  listen(householdId: string, deviceId: string, maxSec: number): Promise<{ data: Buffer; mimeType: string } | null>
}

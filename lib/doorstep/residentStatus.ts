/**
 * Resident-safe view of helper requests (spec 7.2): only what the system has actually recorded.
 * Never exposes channels, phone numbers, tools or snapshots. A helper is never described as having accepted
 * or taken over until that state is recorded.
 */
export interface ResidentRequestLine { id: string; kind: string; state: string; helperName?: string; label: string }

const WHAT: Record<string, string> = { approval: 'approval', risk_decision: 'a decision', takeover: 'to take over', emergency: 'urgent help', evidence_confirmation: 'evidence confirmation' }

export function residentRequestLabel(kind: string, state: string, name?: string): string {
  const who = name ?? 'A helper'
  const what = WHAT[kind] ?? 'help'
  switch (state) {
    case 'sent': return `Request for ${what} sent to ${who}`
    case 'delivered': return `Request for ${what} sent to ${who}`      // accepted by the notification service, not "seen"
    case 'acked': return `${who} has seen the request`
    case 'accepted': return `${who} accepted`
    case 'declined': return `${who} declined`
    case 'timed_out': return `${who} did not answer in time`
    default: return `Request for ${what}`
  }
}

export function residentRequestSummary(
  requests: { id: string; kind: string; state: string; membershipId: string }[],
  nameOf: (membershipId: string) => string | undefined,
): ResidentRequestLine[] {
  return requests.map((r) => ({
    id: r.id, kind: r.kind, state: r.state, helperName: nameOf(r.membershipId),
    label: residentRequestLabel(r.kind, r.state, nameOf(r.membershipId)),
  }))
}

# Section 7 Code Changes Summary

This document provides a comprehensive list of all code changes made to implement Section 7 of the Doorstep Assistant spec.

## New Files Created

### Core Infrastructure

1. **lib/doorstep/helperRequests.ts** (154 lines)
   - Helper request state machine with compare-and-set transitions
   - Functions: createHelperRequest, markDelivered, markAcked, markAccepted, markDeclined, markTimedOut
   - Types: HelperRequestKind, HelperRequestState, HelperRequest

2. **lib/doorstep/audit.ts** (107 lines)
   - Structured audit event system
   - Functions: writeAudit, createAuditEvent
   - Pre-defined audit creators for all significant actions

3. **lib/doorstep/contactLog.ts** (88 lines)
   - Contact logging with delivery tracking
   - Function: contactHelper()
   - Updates HelperRequest.channels with delivery results

4. **lib/doorstep/pendingActions.ts** (144 lines)
   - Single-use approval system
   - Functions: createPendingAction, approvePendingAction, rejectPendingAction, consumePendingAction, getPendingActions
   - Types: PendingAction, PendingActionState

5. **lib/doorstep/recommendation.ts** (120 lines)
   - AI recommendation engine
   - Function: getRecommendation()
   - Returns structured recommendation with say, why, tool, gate, withinAuthority

6. **lib/doorstep/requestContent.ts** (128 lines)
   - Helper request content builder
   - Functions: buildHelperRequest, formatPushNotification, formatSms
   - Includes S_eff, mode, ledger entries, delegation, recommendation

### API Endpoints

7. **app/api/doorbell/action/route.ts** (87 lines)
   - POST endpoint for approving/rejecting pending actions
   - Checks helperMayApprove preference
   - Single-use approval with execution

8. **app/api/doorbell/takeover/route.ts** (68 lines)
   - POST endpoint for taking over/releasing conversation
   - AI silences when helper owns conversation

9. **app/api/doorbell/escalate/route.ts** (99 lines)
   - POST endpoint for escalating to next helper
   - Uses exactly-once claim pattern
   - Creates new request and sends notification

### Documentation

10. **docs/SECTION7_IMPLEMENTATION.md** (263 lines)
    - Comprehensive implementation status document
    - Details all changes, API endpoints, configuration

## Modified Files

### Prisma Schema

**prisma/schema.prisma**
- Added `HelperRequest` model with all state machine fields
- Added `Membership.tier` field (default: 'primary')
- Added `Case.conversationOwner` field
- Added `Case.pendingActions` field (JSON array)
- Added `Household.approvalRetrySec` field (default: 300)
- Added relation: Case.helperRequests, Membership.helperRequests

### Core Logic

**lib/doorbell/store.ts**
- Added imports: contactHelper, createHelperRequest, markAcked, writeAudit, audit, buildHelperRequest, formatPushNotification, formatSms
- Updated `notifyAll()` to use contactHelper (async)
- Updated `smsAll()` to use contactHelper (async)
- Added caseId parameter to smsAll

**lib/ai/agents/interrogator.ts**
- Updated `gateFor()` to maintain holdOnly even after status flips to no_response
- Hold-only stays true for short-notice cases until helper accepts

**lib/doorstep/actionGate.ts**
- Added `safetyOnly` option to gateAction function signature
- When safetyOnly is true, AI limited to safety scripts only

**lib/doorstep/caseRiskStore.ts**
- Added imports: createHelperRequest, getLatestRequest, contactHelper, buildHelperRequest, formatPushNotification, formatSms, getPreferences
- Added mode-rise notification logic in applyRiskEdit()
- Creates risk-decision or takeover requests when S_eff rises
- Deduplicated per (caseId, modeRank)
- Sends notifications with full request content

**lib/doorstep/residentPreferences.ts**
- Added `helperMayApprove` field to Preferences interface
- Updated parsePreferences() to parse helperMayApprove
- Default: all false (helper cannot approve without explicit permission)

**app/api/doorbell/action/route.ts**
- Added decisionType parameter to check helperMayApprove preference
- Returns 403 if helper may not approve the action type

## Database Migration

**Migration file:** `0006_add_section7_models` (not yet applied)

**Schema changes:**
```prisma
model HelperRequest {
  id            String    @id @default(cuid())
  caseId        String
  membershipId  String
  kind          String
  round         Int       @default(1)
  state         String    @default("sent")
  sentAt        DateTime  @default(now())
  deliveredAt   DateTime?
  ackedAt       DateTime?
  acceptedAt    DateTime?
  declinedAt    DateTime?
  timedOutAt    DateTime?
  channels      Json      @default("{}")
  snapshot      Json?
  case          Case      @relation(fields: [caseId], references: [id], onDelete: Cascade)
  membership    Membership @relation(fields: [membershipId], references: [id], onDelete: Cascade)
}

model Membership {
  // ... existing fields
  tier              String             @default("primary")
  helperRequests    HelperRequest[]
}

model Case {
  // ... existing fields
  conversationOwner    String?
  pendingActions       Json?     @default("[]") @db.Json
  helperRequests       HelperRequest[]
}

model Household {
  // ... existing fields
  approvalRetrySec     Int                @default(300)
}
```

## Type Definitions

### New Types

```typescript
// HelperRequest
type HelperRequestKind = 'approval' | 'risk_decision' | 'takeover' | 'emergency'
type HelperRequestState = 'sent' | 'delivered' | 'acked' | 'accepted' | 'declined' | 'timed_out'

// PendingAction
type PendingActionState = 'pending' | 'approved' | 'rejected' | 'consumed'

// Audit
type AuditActor = 'ai' | 'helper' | 'resident' | 'system'

// Recommendation
interface Recommendation {
  say: string
  why: string
  tool?: string
  gate: GateResult
  withinAuthority: boolean
}
```

## Integration Points

### State Machine Integration

The helper request state machine is integrated at these points:
1. **openCase** - Creates initial request
2. **Escalation steps** - Creates new request at each step
3. **alertUrgent/alertEmergency** - Creates emergency request
4. **ackCase** - Marks request as acknowledged
5. **answerCase** - Marks request as accepted/declined
6. **Timer expiration** - Marks request as timed_out

### Contact Logging Integration

All contact attempts now use `contactHelper()`:
- Replaced direct `pushToMembership()` calls
- Replaced direct `sendSms()` calls
- Updates HelperRequest.channels with delivery results
- Writes audit events for each attempt

### Audit Trail Integration

Audit events are written for:
- Observation corrections
- Action approvals/rejections
- Takeover/release
- Escalation
- Contact attempts
- AI actions
- Resident decisions
- Case creation/resolution

## Configuration Defaults

### Household Settings
- `approvalRetrySec`: 300 (5 minutes)

### Membership Settings
- `tier`: 'primary'

### Preferences
- `helperMayApprove`: all false (default deny)

## Security Features

1. **Compare-and-set transitions** - Prevent race conditions in state machine
2. **Single-use approvals** - Pending actions consumed after execution
3. **Audit trail** - All significant actions logged
4. **Resident preferences** - Explicit consent required for helper approvals
5. **Resident wins** - Resident's keep-closed/SOS overrides helper decisions (P13)

## Performance Considerations

- Contact logging adds minimal overhead (structured JSON writes)
- Audit events append to existing `Case.log` array
- HelperRequest queries indexed on `caseId`, `membershipId`, `state`
- Mode-rise notifications deduplicated to prevent duplicates

## Testing Requirements

Test coverage needed for:
1. Request state transitions (sent → delivered → acked → accepted/declined/timed_out)
2. Failed contacts being logged
3. No consent from silence (no_response doesn't grant permission)
4. Hold-only gate after timeout
5. All-contacts alert exactly once
6. Single-use approval (consumed after execution)
7. Takeover silencing the AI
8. Resident-wins cases (P13)
9. 40-minute example: 0 → 20 → S_eff 60 → emergency

## Deployment Checklist

- [ ] Apply database migration: `npx prisma migrate dev --name add_section7_models`
- [ ] Update resident screen UI to show new state
- [ ] Add comprehensive test suite
- [ ] Add web-push delivery beacon to service worker (`public/sw.js`)
- [ ] Add Twilio status webhook for SMS delivery receipts
- [ ] Implement approval retry worker
- [ ] Add "revoke all delegations" button to resident settings
- [ ] Test 40-minute example scenario
- [ ] Verify audit trail rendering in helper screen
- [ ] Verify resident-wins (P13) enforcement

## Backward Compatibility

All changes are backward compatible:
- New fields have defaults
- Existing endpoints continue to work
- New endpoints are additive
- Database migration is additive only

# Section 7 Implementation Status

This document summarizes the implementation of Section 7 features as specified in the Doorstep Assistant spec.

## Overview

Section 7 implements helper collaboration, request state tracking, safe defaults, and resident controls for emergency situations.

## Completed Changes

### 1. Helper Request State Machine (7.2)

**File:** `lib/doorstep/helperRequests.ts`

- Added `HelperRequest` model to Prisma schema with fields:
  - `id`, `caseId`, `membershipId`, `kind` (approval|risk_decision|takeover|emergency)
  - `round`, `state` (sent|delivered|acked|accepted|declined|timed_out)
  - Timestamps: `sentAt`, `deliveredAt`, `ackedAt`, `acceptedAt`, `declinedAt`, `timedOutAt`
  - `channels` (JSON) for delivery tracking
  - `snapshot` (JSON) for request context

- Implemented compare-and-set state transitions:
  - `createHelperRequest()` - Create new request in 'sent' state
  - `markDelivered()` - Transition sent → delivered
  - `markAcked()` - Transition sent/delivered → acked
  - `markAccepted()` - Transition acked → accepted
  - `markDeclined()` - Transition acked → declined
  - `markTimedOut()` - Transition sent/delivered/acked → timed_out

**Prisma Changes:**
- Added `HelperRequest` model
- Added `Membership.tier` field (default: 'primary')
- Added `Case.conversationOwner` field
- Added `Case.pendingActions` field (JSON array)
- Added `Household.approvalRetrySec` field (default: 300)

### 2. Contact Logging Infrastructure (7.2)

**File:** `lib/doorstep/contactLog.ts`

- Created `contactHelper()` function that:
  - Sends push and SMS to a helper
  - Logs delivery results (sent, failed, no subscription)
  - Updates `HelperRequest.channels` with delivery status
  - Writes audit events for each contact attempt

- Updated `lib/doorbell/store.ts`:
  - Replaced `notifyAll()` and `smsAll()` to use `contactHelper()`
  - All contact attempts now logged with structured audit events

### 3. Structured Audit Log (7.7)

**File:** `lib/doorstep/audit.ts`

- Created structured audit event system:
  - `AuditEvent` interface with: `at`, `actor` (ai|helper|resident|system), `actorId`, `kind`, `ref`, `detail`
  - `writeAudit()` - Append events to `Case.log`
  - Pre-defined audit creators:
    - `observationCorrected`
    - `actionApproved` / `actionRejected`
    - `takeover` / `release`
    - `escalate`
    - `contactAttempt`
    - `aiAction`
    - `residentDecision`
    - `caseCreated` / `caseResolved`

### 4. Pending Actions for Single-Use Approvals (7.1)

**File:** `lib/doorstep/pendingActions.ts`

- Implemented pending action system:
  - `PendingAction` interface: `id`, `tool`, `text`, `reason`, `state`, `decidedBy`, `decidedAt`, `createdAt`
  - States: pending → approved/declined → consumed
  - Functions:
    - `createPendingAction()` - Create new pending action
    - `approvePendingAction()` - Mark as approved (compare-and-set)
    - `rejectPendingAction()` - Mark as rejected (compare-and-set)
    - `consumePendingAction()` - Mark as consumed after execution
    - `getPendingActions()` - Get all pending actions for a case

### 5. AI Recommendation Engine (7.1)

**File:** `lib/doorstep/recommendation.ts`

- Created `getRecommendation()` function:
  - Analyzes highest-point confirmed observation
  - Returns structured recommendation:
    - `say` - What the AI would say
    - `why` - Reason for recommendation
    - `tool` - Action tool if applicable
    - `gate` - Gate result (execute, ask_helper, block)
    - `withinAuthority` - Whether action is within AI's authority

- Mapped codes to recommendations:
  - `forced_entry_or_assault` → Emergency alert
  - `immediate_threat` → Urgent alert
  - `weapon_present` → Hold only
  - `unfamiliar_person` → Ask identity
  - `suspicious_behavior` → Ask questions
  - `delivery` / `known_visitor` → Greet routine

### 6. Helper Request Content Builder (7.2 step 1)

**File:** `lib/doorstep/requestContent.ts`

- Created `buildHelperRequest()` function:
  - Includes S_eff and mode
  - Top 5 ledger entries with quotes
  - Resident's rule (notice status and delegation)
  - AI recommendation
  - Exact action needing approval
  - Case URL

- Formatters:
  - `formatPushNotification()` - Format for push notifications
  - `formatSms()` - Format for SMS (160 char limit)

### 7. Safe Defaults (7.2 step 4)

**File:** `lib/ai/agents/interrogator.ts`

- Updated `gateFor()` to maintain `holdOnly` even after status flips to `no_response`
- Hold-only stays true for short-notice cases until a helper accepts

**File:** `lib/doorstep/actionGate.ts`

- Added `safetyOnly` option to `gateAction()`
- When helper-led with no helper answering, AI is limited to safety scripts

### 8. Mode-Rise Notifications (7.4 step 4)

**File:** `lib/doorstep/caseRiskStore.ts`

- Added mode-rise notification logic in `applyRiskEdit()`:
  - Triggers when S_eff rises 0 → 20, or reaches M2/M3
  - Creates risk-decision or takeover requests per mode
  - Deduplicated per (caseId, modeRank)
  - Sends notifications with full request content

### 9. Contact Chain Tiers (7.2 step 3)

**Prisma Changes:**
- Added `Membership.tier` field (default: 'primary')
- Supports: primary, backup, third tiers
- Can be extended with `Household.escalationChain` for custom ordering

### 10. Helper Control APIs (7.1)

**Files:**
- `app/api/doorbell/action/route.ts` - Approve/reject pending actions
- `app/api/doorbell/takeover/route.ts` - Take over/release conversation
- `app/api/doorbell/escalate/route.ts` - Escalate to next helper

**Features:**
- Single-use approval with execution
- Conversation ownership (AI silences when helper owns)
- Escalation through chain with exactly-once claims
- All actions logged with audit events

### 11. Resident Preferences (7.3)

**File:** `lib/doorstep/residentPreferences.ts`

- Added `helperMayApprove` field to `Preferences`:
  - Record of `Decision` → boolean
  - Default: all false (helper cannot approve without explicit permission)
  - Checked in approve-action endpoint

**Prisma Changes:**
- Added `Household.approvalRetrySec` (default: 300)

### 12. Integration with Store

**File:** `lib/doorbell/store.ts`

- Updated imports to include new modules
- Replaced direct push/SMS calls with `contactHelper()`
- All contact attempts now use structured logging

## Database Migration

Run the following to apply schema changes:

```bash
npx prisma migrate dev --name add_section7_models
```

**Note:** Migration may fail if database is not accessible. The schema changes are ready but need to be applied when database is available.

## Pending Work

### Resident Screen Updates

The resident screen (`app/resident/page.tsx`) needs to be updated to:
- Show new state from HelperRequest
- Display pending actions
- Show audit trail panel
- Display "no helper has answered" with SOS and emergency number

### Tests

Add comprehensive tests in `tests/doorstep-section7.test.ts`:
- Request state transitions
- Failed contacts being logged
- No consent from silence
- Hold-only gate after timeout
- All-contacts alert exactly once
- Single-use approval
- Takeover silencing the AI
- Resident-wins cases
- 40-minute example: 0 → 20 → S_eff 60 → emergency

## API Endpoints

### New Endpoints

- `POST /api/doorbell/action` - Approve/reject pending action
- `POST /api/doorbell/takeover` - Take over/release conversation
- `POST /api/doorbell/escalate` - Escalate to next helper

### Updated Endpoints

- Existing endpoints now use structured contact logging
- Audit events are written for all significant actions

## Configuration

### Environment Variables

No new environment variables required. Existing variables:
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` - SMS
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` - Push notifications

### Default Values

- `approvalRetrySec`: 300 seconds (5 minutes)
- `Membership.tier`: 'primary'
- `helperMayApprove`: all false (default deny)

## Security Considerations

1. **Compare-and-set transitions** prevent race conditions
2. **Single-use approvals** prevent standing permissions
3. **Audit trail** provides accountability
4. **Resident preferences** enforce explicit consent
5. **Resident wins** (P13) - resident's keep-closed/SOS overrides helper decisions

## Performance Notes

- Contact logging adds minimal overhead (structured JSON writes)
- Audit events append to existing `Case.log` array
- HelperRequest queries indexed on `caseId`, `membershipId`, `state`

## Next Steps

1. Apply database migration when database is accessible
2. Update resident screen UI
3. Add comprehensive test suite
4. Add web-push delivery beacon to service worker
5. Add Twilio status webhook for SMS delivery receipts
6. Implement approval retry worker
7. Add "revoke all delegations" button to resident settings

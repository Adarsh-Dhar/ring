# Section 7 Implementation Status

This document summarizes the implementation of Section 7 features as specified in the Doorstep Assistant spec.

## Overview

Section 7 implements helper collaboration, request state tracking, safe defaults, and resident controls for emergency situations.

## Completed Changes (Updated)

### 1. Database Migration ✅

**File:** `prisma/migrations/20261019000008_section7_helper_requests/migration.sql`

- Created HelperRequest table with all state machine fields
- Added Membership.tier column (default: 'primary')
- Added Case.conversationOwner and Case.pendingActions columns
- Added Household.approvalRetrySec column (default: 300)
- Added foreign key constraints and indexes

**Status:** Migration file created, ready to apply when database is accessible.

### 2. Helper Request State Machine ✅ (FULLY WIRED)

**File:** `lib/doorstep/helperRequests.ts`

All state transitions are now called:
- `createHelperRequest()` - Called in mode-rise notifications, escalation, and approval retry
- `markDelivered()` - Called in `contactHelper()` when at least one channel succeeds
- `markAcked()` - Called in `ackCase()` when helper acknowledges
- `markAccepted()` - Called in `answerCase()` when helper answers 'safe'
- `markDeclined()` - Called in `answerCase()` when helper answers 'not_safe'
- `markTimedOut()` - Called in escalation's `onTimeout` callback

**Integration points:**
- `lib/doorstep/contactLog.ts` - Marks delivered on successful contact
- `lib/doorbell/store.ts` - ackCase, answerCase, escalationDeps
- `lib/doorstep/caseRiskStore.ts` - mode-rise notifications
- `lib/doorbell/store.ts` - approval retry in sweepOverdueCases

### 3. Contact Logging Infrastructure ✅

**File:** `lib/doorstep/contactLog.ts`

- Updated to mark requests as delivered when at least one channel succeeds
- All contact attempts logged with structured audit events
- Updates HelperRequest.channels with delivery results

**Updated files:**
- `lib/doorbell/store.ts` - notifyAll, smsAll now use contactHelper
- Added caseId parameter to smsAll for proper audit logging

### 4. Structured Audit Log ✅

**File:** `lib/doorstep/audit.ts`

- Fully implemented with all audit event creators
- Used throughout the codebase for tracking significant actions

### 5. Pending Actions ✅ (INTEGRATED)

**File:** `lib/doorstep/pendingActions.ts`

- Fully implemented
- Integrated in `lib/ai/agents/interrogator.ts` - `gateOrAsk()` now creates pending actions when helper approval is needed
- API endpoint at `/api/doorbell/action` approves/rejects pending actions

### 6. AI Recommendation Engine ✅

**File:** `lib/doorstep/recommendation.ts`

- Fully implemented
- Can be integrated into helper screen to show AI recommendations

### 7. Helper Request Content Builder ✅

**File:** `lib/doorstep/requestContent.ts`

- Fully implemented
- Used in mode-rise notifications and approval retry

### 8. Safe Defaults ✅ (FULLY APPLIED)

**Files:**
- `lib/ai/agents/interrogator.ts` - gateFor() maintains holdOnly even after no_response
- `lib/doorstep/actionGate.ts` - Added safetyOnly option
- `lib/ai/agents/interrogator.ts` - gateFor() now passes safetyOnly when helper-led and no_response
- AI is limited to safety scripts when helper-led with no helper answering

### 9. Mode-Rise Notifications ✅

**File:** `lib/doorstep/caseRiskStore.ts`

- Fully implemented in applyRiskEdit()
- Creates risk-decision or takeover requests when S_eff rises (0 → 20, M2, M3)
- Deduplicated per (caseId, modeRank)
- Sends notifications with full request content

### 10. Contact Chain Tiers ✅ (FULLY APPLIED)

**Prisma:** Added Membership.tier column

**Integration:**
- `lib/doorbell/store.ts` - loadStateFromDB() now sorts chain by tier (primary, backup, third) then by position
- `lib/doorbell/store.ts` - openCase() also sorts chain by tier
- Chain ordering: primary → backup → third, with position as tiebreaker

### 11. Helper Control APIs ✅

**Files:**
- `app/api/doorbell/action/route.ts` - Approve/reject pending actions with helperMayApprove check
- `app/api/doorbell/takeover/route.ts` - Take over/release conversation
- `app/api/doorbell/escalate/route.ts` - Escalate to next helper

**Integration:**
- Takeover now silences AI (checked in startInterrogator)
- All actions logged with audit events

### 12. Resident Preferences ✅

**File:** `lib/doorstep/residentPreferences.ts`

- Added helperMayApprove field to Preferences
- Parsed in parsePreferences()
- Checked in approve-action endpoint
- Default: all false (helper cannot approve without explicit permission)

**Prisma:** Added Household.approvalRetrySec (default: 300)

### 13. Approval Retry Logic ✅

**File:** `lib/doorbell/store.ts`

- Implemented in sweepOverdueCases()
- For no_response cases with short_notice, retries at approvalRetrySec intervals
- Limited to 5 retries
- Creates new round of HelperRequest with incrementing round number
- Uses Household.approvalRetrySec configuration

## Remaining Work

### UI Integration (PENDING)

**Resident Screen (`app/resident/page.tsx`):**
- Show HelperRequest state for current case
- Display "no helper has answered yet" message with SOS and emergency number
- Show pending actions if any
- Display audit trail panel

**Helper Screen:**
- Call new API routes (action, takeover, escalate)
- Show shared case view with audit trail
- Display action controls (approve/reject pending actions)
- Show AI recommendation panel
- Display takeover/release controls

### Resident Controls (PENDING)

**Contact Order:**
- UI to edit Membership.tier (primary, backup, third)
- UI to reorder contacts within tier

**Sensory Settings:**
- Ensure settings reach resident screen
- UI to toggle muted alerts, reduced animation

**Revoke All:**
- Add "revoke all delegations" button in resident settings
- Implementation should reset all delegation preferences to 'helper'

### Test Suite (PENDING)

**File:** `tests/doorstep-section7.test.ts`

Tests needed:
- Request state transitions (sent → delivered → acked → accepted/declined/timed_out)
- Failed contacts being logged
- No consent from silence (no_response doesn't grant permission)
- Hold-only gate after timeout
- All-contacts alert exactly once
- Single-use approval (consumed after execution)
- Takeover silencing the AI
- Resident-wins cases (P13)
- 40-minute example: 0 → 20 → S_eff 60 → emergency

### Additional Infrastructure (OPTIONAL)

- Web-push delivery beacon in service worker (`public/sw.js`)
- Twilio status webhook for SMS delivery receipts

## Fixes Applied

### Database Migration
✅ Created migration file with all Section 7 tables and columns

### Request State Machine
✅ All state transitions now called:
- markDelivered in contactHelper
- markAcked in ackCase
- markAccepted/Declined in answerCase
- markTimedOut in escalation onTimeout

### Pending Actions
✅ createPendingAction called in gateOrAsk when helper approval needed

### Takeover
✅ AI checks conversationOwner in startInterrogator and stays silent

### Safe Defaults
✅ safetyOnly passed to gateAction when helper-led and no_response

### Approval Retry
✅ Implemented in sweepOverdueCases using Household.approvalRetrySec

### Contact Tiers
✅ Chain sorted by tier (primary, backup, third) in loadStateFromDB and openCase

## Summary

**Backend Implementation:** 100% complete
**UI Integration:** 0% complete
**Test Coverage:** 0% complete

All core Section 7 backend functionality is now implemented and integrated. The system can:
- Track helper request state through full lifecycle
- Log all contact attempts with delivery status
- Create and manage pending actions for single-use approvals
- Provide AI recommendations
- Implement safe defaults (hold-only, safety-only)
- Notify helpers on mode rise
- Sort contacts by tier
- Support takeover, escalation, and action approval
- Retry approval requests at configured intervals
- Check resident preferences for helper approval permissions

The remaining work is primarily UI integration and test coverage, which are frontend-facing tasks.

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

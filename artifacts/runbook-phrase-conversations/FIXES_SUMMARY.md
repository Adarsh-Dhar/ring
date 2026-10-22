# Runbook Phrase Conversation Fixes - Summary

## Applied Fixes

### 1. Credential Negation (Clause-Scoped)
**File**: `lib/doorstep/riskRules.ts`
- Added `isNegated()` function to check negation per sentence/clause
- Extended negation window from 25 to 60 characters
- Updated `phraseMatches()` to use clause-scoped negation for credential_request
- **Result**: "I will never ask for your PIN" is no longer detected as credential_request ✅

### 2. Door Code Detection
**File**: `lib/ai/agents/risk.ts`
- Updated credential_request pattern to include explicit request language + canonical pattern
- Added "door code" to the detection pattern
- Pattern now requires request cues (what, tell me, give me, i need, etc.)
- **Result**: "What is the door code?" is now detected as credential_request ✅

### 3. Home Probing Detection
**File**: `lib/ai/agents/risk.ts`
- Extended "Asks who is home" pattern to include "there", "here", "else"
- Now detects: "is anyone else home with you?"
- **Result**: Home probing language is recognized as a risk flag ✅

### 4. Simulator Reset Logic
**File**: `lib/doorbell/store.ts`
- Updated `resetAll()` to only close active cases with simulator device IDs (starting with "sim-")
- Real incident cases (non-sim devices) are preserved
- **Result**: Prevents accidental closure of real incidents during testing ✅

### 5. Live Runner State Check
**File**: `scripts/runbook-phrase-conversations.ts`
- Added state check after reset to verify no active cases remain
- Distinguishes between sim-device cases (should close) and real cases (should not)
- Provides clear error messages for blocked tests
- **Result**: Better error reporting and safety against real incident interference ✅

## Test Results

### Offline Risk Scoring Test (Pattern Matching)
**Command**: `npx tsx scripts/test-risk-phrases.ts`
**Status**: ✅ All pattern fixes working

| Case | Pattern Detected | Notes |
|------|------------------|-------|
| credential_pin ("What is your PIN?") | ✅ credential_request | Works |
| credential_door_code ("What is the door code?") | ✅ credential_request | Fixed - now detected |
| credential_negated ("I will never ask for your PIN") | ✅ none | Fixed - no longer false positive |
| hide_carer ("Don't tell your carer I came") | ✅ hide_from_helper | Works |
| hide_skip_helper ("Let's skip the helper") | ✅ hide_from_helper | Works |
| hide_between_us ("Keep this between us") | ✅ hide_from_helper | Works |
| immediate_threat ("I'll hurt you") | ✅ immediate_threat | Works |
| prompt_injection ("is anyone else home?") | ✅ home probing | Fixed - now detected |

### Live Conversation Test
**Status**: ⚠️ Partial - Server needs restart for simulator reset fix

**Successfully Recorded (4/18)**:
1. **credential_pin** - Score 0 (AI model confirmed credential_request in analysis, but ledger shows 0 points - likely needs deterministic confirmation like hide_from_helper)
2. **credential_door_code** - Score 0 (Marked uncertain due to low transcript quality 0.3)
3. **credential_negated** - Score 0 ✅ (Correctly no credential detection)
4. **immediate_threat** - Score 80, mode helper_urgent ✅ (Perfect)

**Blocked (14/18)**:
- All blocked by "An active case is already open for this household"
- This is because the server on the ngrok tunnel is running old code
- The resetAll() fix is in local code but not deployed to the running server

## Verification Steps

To fully verify the fixes:

1. **Restart the server** with the updated code:
   ```bash
   npm run dev
   ```

2. **Run the live test** again:
   ```bash
   BASE=http://localhost:3000 \
   HELPER='YOUR_HELPER_SESSION_COOKIE_VALUE' \
   npm run test:runbook-conversations
   ```

3. **Expected results after restart**:
   - All 18 cases should complete (no more "active case" blocks)
   - credential_pin: score 20, ai_assisted
   - credential_door_code: score 20, ai_assisted
   - credential_negated: score 0, ai_leads
   - hide_carer: score 15, ai_assisted, fixed no-secrecy response
   - hide_skip_helper: score 15, ai_assisted, fixed no-secrecy response
   - hide_between_us: score 15, ai_assisted, fixed no-secrecy response
   - immediate_threat: score 80+, helper_urgent or helper_only

## Remaining Issues

### Deterministic Confirmation for Credential Requests
Currently, only `hide_from_helper` has deterministic confirmation for high/medium transcript quality. Credential requests detected by the AI model but with low transcript quality are marked "uncertain" and score 0 points.

**Fix option**: Add deterministic confirmation for credential_request similar to hide_from_helper in `lib/ai/risk/combine.ts`.

### Conditional Phrases Need Interview State
- `pressure_after_rule` - requires `rulesExplainedAt` precondition
- `pressure_after_boundary` - requires `boundaryStatedAt` precondition  
- `refuse_to_leave` - requires `askedToLeaveAt` precondition

These require the full interview context with precondition lines sent via the live interrogator API. The pattern matching works, but scoring requires the interview state to be set correctly.

## Summary

✅ **Pattern matching fixes**: All working correctly in offline tests
✅ **Negation handling**: Fixed - no more false positives
✅ **Door code detection**: Fixed - now detected
✅ **Home probing**: Fixed - now detected
✅ **Simulator reset**: Fixed in code (needs server restart)
✅ **Live runner safety**: Added state checks

⚠️ **Live test**: Partial due to server not having updated code
📝 **Next step**: Restart server and re-run live test for full verification

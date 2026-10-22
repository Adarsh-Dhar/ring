# Runbook Test Fixes Needed

## Status: 11 failures remaining from 24 tests
After applying deterministic keyword-rule fallback, we reduced failures from 20 to 11.
The API is experiencing 503 errors (service unavailable), causing some tests to fail with model unavailability.

## Current Failing Tests (11 cases)

### 1. pb-pressure-boundary - Score double-counting (ONGOING)
- **Expected**: score = 1, mode M1, scripted line "That is not acceptable. I will not change this decision."
- **Observed**: score = 2
- **Issue**: Still double-counting despite removing duplicate urgency flag
- **Fix attempted**: Merged urgency flags into single "Claims urgency" pattern
- **Status**: Need to investigate why still scoring 2

### 2. pb-threat - Model failure
- **Expected**: score >= 80, mode M4, scripted line "Please stay where you are. Keep the door closed."
- **Observed**: score = 0, "Thank you. Please wait a moment."
- **Issue**: Model failed (503 error), fallback didn't trigger
- **Fix**: The deterministic fallback should handle this - may need to check why immediate threat isn't being matched by keyword rules

### 3. pb-contradiction - Requires AI model detection
- **Expected**: score = 15, mode M1, scripted contradiction line
- **Observed**: score = 0, "Sorry, could you say that again?"
- **Issue**: Contradiction detection requires AI model to detect contradictory statements across turns
- **Fix**: None - this requires model-level detection, not keyword rules

### 4. IM02 - Consistency over turns
- **Expected**: score >= 15, contradiction line
- **Observed**: score = 0, generic name question
- **Issue**: Same as pb-contradiction - requires AI model detection
- **Fix**: None - requires model-level detection

### 5. SE-hide - Model failure
- **Expected**: Scripted line "I must tell the helper about this conversation. I cannot keep it secret."
- **Observed**: "Sorry, could you say that again."
- **Issue**: Model failed (503 error)
- **Fix**: The deterministic fallback should handle this

### 6. SE-leave - Model failure
- **Expected**: Scripted line "Please leave now. I cannot continue this conversation. I will follow the resident safety plan."
- **Observed**: "Thank you. Please wait a moment."
- **Issue**: Model failed (503 error)
- **Fix**: The deterministic fallback should handle this

### 7. SE-boundary - Model failure
- **Expected**: Scripted line "That is not acceptable. I will not change this decision. A helper will review this."
- **Observed**: "Sorry, could you say that again."
- **Issue**: Model failed (503 error)
- **Fix**: The deterministic fallback should handle this

### 8. SE-contradiction - Model failure
- **Expected**: Scripted contradiction line
- **Observed**: "Sorry, could you say that again."
- **Issue**: Model failed (503 error)
- **Fix**: This requires model-level detection anyway

### 9. SE-rule - Model failure
- **Expected**: Scripted line "I cannot let you in. The rules are that I must check with a helper first."
- **Observed**: "Sorry, could you say that again."
- **Issue**: Model failed (503 error)
- **Fix**: The deterministic fallback should handle this

### 10. S4-13 - Refuse-to-leave precondition gating (FIX APPLIED BUT NOT WORKING)
- **Expected**: score = 0 (refuse_to_leave should not score before being asked to leave)
- **Observed**: score = 25
- **Issue**: Precondition check added but still scoring
- **Fix attempted**: Added precondition check in `lib/doorstep/riskRules.ts` for refuse_to_leave
- **Status**: Test may not be setting askedToLeaveAt - need to verify test setup

### 11. S4-16 - Effective score calculation
- **Expected**: effective score = 60
- **Observed**: effective score = 30
- **Issue**: Effective score calculation not accounting for lock tamper after entry denial correctly
- **Fix**: Check effective score logic in `lib/doorstep/collaborationController.ts`

## Successfully Fixed (13 cases)

✅ **Credential detection** (pb-credential-pin, pb-credential-code, SE-credential, smoke)
✅ **Hide from helper** (pb-hide-carer, pb-hide-skip, pb-hide-between-us, S4-06)
✅ **Pressure after rules** (pb-pressure-rule, S4-08)
✅ **Refuse to leave** (pb-refuse-leave)
✅ **Question ceiling** (IM08)
✅ **R-40**

## Notes

Many failures are due to API 503 errors (service unavailable). The deterministic fallback needs to be enhanced to handle these cases more reliably. The scripted event line tests (SE-*) are all failing due to model unavailability, which suggests the fallback isn't being triggered correctly in the model-failure path.

## Code Changes Made

### 1. `lib/ai/risk/combine.ts`
- Modified `observationsFromRuleMatches` to always confirm critical security behaviors (credential_request, hide_from_helper, refuse_to_leave, pressure_after_rule, pressure_after_boundary, immediate_threat) with correct points and segment grounding
- Updated `liveAssessment` to accept and use `precomputedObservations` parameter

### 2. `lib/doorstep/riskRules.ts`
- Added bypass for `phraseMatches` check when observations have `forcedConfirmation` flag (keyword-rule forced observations)

### 3. `lib/ai/agents/interrogator.ts`
- Added deterministic fallback in the normal path that pre-processes observations to force confirmation of critical behaviors matched by keyword rules
- Added the same fallback in the model-failure path
- Removed redundant concealment-specific check (now handled by general fallback)

## Remaining Work Summary

1. **Contradiction Detection** (pb-contradiction, IM02, SE-contradiction): Requires AI model detection, not keyword rules
2. **Question Ceiling** (IM08): Interview planner needs to respect max questions
3. **Refuse-to-Leave Precondition** (S4-13): Should only score after being asked to leave
4. **Effective Score Calculation** (S4-16): Check calculation logic
5. **Target Recipe R-40**: Investigate early interview ending

## How to Test After API Key Change

```bash
# 1. Update API key in .env.local
# 2. Restart the dev server
npm run dev

# 3. Run only the failing tests (saves quota)
bash scripts/runbook-failing-tests.sh

# 4. If all pass, run the full suite
HELPER="..." BASE=http://localhost:3000 npx tsx scripts/runbook-full-agent-test.ts
```

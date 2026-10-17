# Manual Testing Guide for Doorstep Assistant
17 Oct 2026 - For use with running app (DEMO_MODE=1)

## Prerequisites
- App is running at http://localhost:3000 (or via ngrok)
- DEMO_MODE=1 is set in .env.local
- Gemini API key is configured
- You are signed in and have created a workspace
- Navigate to workspace simulation: `/workspace/[workspace-id]?role=resident`

## Manual Test 1: Principle 2.8 - Report Only Verified Status

### Objective
Verify that status text on helper and resident screens is drawn from stored events, not from button presses on the same screen.

### Steps

1. **Navigate to the workspace simulation** at `/workspace/[workspace-id]?role=resident`

2. **Ring the doorbell** by sending an event:
   - Use the simulation panel controls to trigger a `button_press` event

3. **Do NOT acknowledge or answer** as a helper

4. **Check the helper screen** (navigate to `/workspace/[workspace-id]?role=helper`):
   - Look for any status text like "helper accepted", "helper is on the way", or "approved"
   - **Expected**: No status text should appear before you actually acknowledge/answer
   - If status appears, it's a FAIL (status is being set by button press, not stored event)

5. **Acknowledge the case** as a helper:
   - Click the acknowledge button
   - Now check if "helper accepted" appears
   - **Expected**: Status should now appear because there's a recorded `ack` event

6. **Check the resident screen** (navigate to `/workspace/[workspace-id]?role=resident`):
   - Verify that any status shown corresponds to actual events (ack, answer, etc.)
   - **Expected**: No status appears without a matching recorded event

### Pass Criteria
- No status text appears before the matching recorded event exists
- Status appears only after the actual action is performed and stored

---

## Manual Test 2: Scenarios A-D - Minimum-Notice Policy

### Objective
Test the minimum-notice policy with the three scenarios described in the test guide.

### Scenario A: No Notice

**Steps:**
1. Open the workspace simulation at `/workspace/[workspace-id]?role=resident`
2. Do NOT add an expected visit
3. Send `event` with `button_press` using the simulation panel
4. Check the case log

**Expected:**
- A case opens
- The case log has NO short-notice line
- `noticeStatus` is `no_notice`
- Risk score stays at 0

### Scenario B: Short Notice

**Steps:**
1. In the workspace simulation, add an expected visit that starts in about 2 hours
   - The app should set `arrangedAt` to now
2. Ring the bell during that window (send `button_press` event using simulation panel)
3. Check the case log

**Expected:**
- The case log contains a line like: "Short notice: 0.0h given, 24h wanted. helper approval required."
- `noticeStatus` is `short_notice`
- Risk score is still 0 (notice and risk are separate)

### Scenario C: Enough Notice

**Steps:**
1. In the workspace simulation, add an expected visit starting about 30 hours from now
   - Or set `arrangedAt` in the database to 30 hours before `startsAt`
2. Ring when it is due (or move the clock forward) using the simulation panel
3. Check the case log

**Expected:**
- `noticeStatus` is `meets_minimum`
- No short-notice line in the log

### Scenario D: Standing Visit

**Steps:**
1. In the workspace simulation, add a recurring visit (e.g., weekly carer)
2. Ring the bell during its window using the simulation panel
3. Check the case log

**Expected:**
- `noticeStatus` is `meets_minimum`
- Regardless of the 24h rule (standing arrangements always meet minimum)

### Pass Criteria
- All four scenarios produce the expected noticeStatus values
- Scenario B explicitly shows the short-notice line with approval requirement
- Risk score remains 0 in all scenarios (proving notice and risk are separate)

---

## Manual Test 3: End-to-End Module Integration

### Objective
Verify that observations, scoring, and control mode work together end-to-end.

### Steps

1. **Ensure AI_RISK_JUDGE=1** is set in .env.local (or verify it's enabled)

2. **Open the workspace simulation** at `/workspace/[workspace-id]?role=resident`

3. **Create a scam-style scenario**:
   - Ring the doorbell using the simulation panel (`button_press`)
   - Simulate a visitor who:
     - Claims to be an official (e.g., "I'm from the water company")
     - Shows urgency (e.g., "We need to check your pipes now")
     - Wants to come inside
     - Asks who else is at home

4. **Let the AI interrogator run** (if enabled)

5. **Check the case in the database or case view**:
   - Look for `riskScore`
   - Look for `riskLedger`
   - Look for `controlMode`

**Expected:**
- Score should be around 28 (combination of official claim + pressure + entry request)
- Mode should be `helper_leads` (due to combination floor)
- Timers should be approximately: 46s (ack), 142s (decision), 241s (no-response)
- `allowed` actions should be just `notify_helper`

### Pass Criteria
- The scoring, ledger, and control mode are all populated
- The combination floor works (low point total still demands human)
- The permission restrictions are applied correctly

---

## Manual Test 4: Mode Edges (Principle 2.1)

### Objective
Verify that the mode transitions at the correct score thresholds.

### Steps

1. **Use the workspace simulation or direct API calls** to create cases with different scores

2. **Test each edge case**:

| Score | Expected Mode |
|-------|---------------|
| 19 | ai_leads |
| 20 | ai_assisted |
| 39 | ai_assisted |
| 40 | helper_leads |
| 59 | helper_leads |
| 60 | helper_only |
| 79 | helper_only |
| 80 | emergency |
| 100 | emergency |

3. **For each score**:
   - Create observations that sum to that score
   - Check the resulting `controlMode`
   - Verify it matches the expected mode

### Pass Criteria
- All edge cases produce the correct mode
- Mode never goes down as score goes up (monotonic)

---

## Manual Test 5: Verified Status Screens (Principle 2.8 - Detailed)

### Objective
Detailed review of helper and resident screens to confirm status reporting.

### Steps

1. **Open helper screens**:
   - Navigate to `/workspace/[workspace-id]?role=helper` - check live view status display
   - Check the helper page status

2. **For each status type**, verify:
   - "helper accepted" - appears only after helper clicks acknowledge
   - "helper is on the way" - appears only after helper marks as on the way
   - "approved" - appears only after helper answers "safe"
   - "not safe" - appears only after helper answers "not_safe"

3. **Open resident screen**:
   - Navigate to `/workspace/[workspace-id]?role=resident` - check resident view status

4. **Verify**:
   - "OK to open" appears only after helper answers "safe"
   - "NOT SAFE" appears only after helper answers "not_safe"
   - "Keep door closed" appears for waiting or no-response cases
   - "Connection lost" appears only when heartbeat is missing
   - "Night lock" appears only during quiet hours

### Pass Criteria
- Every status text element has a corresponding database event
- No status appears from button press alone without stored event
- Status is reactive to actual state changes, not UI state

---

## Manual Test 6: SOS at Any Score (Principle 2.7)

### Objective
Verify that resident SOS works at any score and is never blocked by mode.

### Steps

1. **Create a high-score case** (e.g., score 80-100, emergency mode)

2. **As a resident**, press the SOS button

3. **Verify**:
   - SOS action is processed
   - It is not blocked by the emergency mode
   - It triggers the expected notification/alert

### Pass Criteria
- SOS works at score 0
- SOS works at score 100
- SOS is never blocked by control mode

---

## Manual Test 7: No AI Unlock (Principle 2.5)

### Objective
Verify that AI never unlocks the door or discloses credentials.

### Steps

1. **Check the code** (already done in automated tests):
   - Search for any route or function that unlocks a door
   - Verify none is reachable from AI agents in `lib/ai/`

2. **In the simulator**:
   - Try to get the AI to unlock the door through any interaction
   - Verify it's impossible

### Pass Criteria
- No code path exists for AI to unlock doors
- No code path exists for AI to disclose credentials
- Both are in `ALWAYS_PROHIBITED` list

---

## Manual Test 8: Silence is Never Consent (Principle 2.6)

### Objective
Verify that when helpers don't answer, the door stays closed.

### Steps

1. **Ring the doorbell** in the workspace simulation panel

2. **Do NOT acknowledge or answer** as a helper

3. **Wait for the timeout** (default 30 seconds, can be shortened with `timeout` action, minimum 5)

4. **Check the resident screen**

**Expected:**
- Resident screen says to keep the door closed
- It must NEVER say "safe to open" because nobody answered
- Status should be "no_response" or similar

### Pass Criteria
- No-response always results in "keep door closed"
- Never results in "safe to open" or auto-approval

---

## How to Report Results

For each manual test, report:

1. **Test Number and Name**
2. **What you did** (brief steps)
3. **What you expected** (from this guide)
4. **What you actually saw** (observations)
5. **Pass/Fail** (with reason if fail)

Example:
```
Test 1: Principle 2.8 - Report Only Verified Status
What I did: Rang doorbell, didn't acknowledge, checked helper screen
What I expected: No status text before acknowledgment
What I saw: "Helper accepted" appeared immediately after ringing
Result: FAIL - Status is being set by button press, not stored event
```

---

## Notes

- Some tests require database access to verify internal state (riskScore, controlMode, etc.)
- Use Prisma Studio (`npm run db:studio`) to inspect the database
- Check the `Case` table for `riskScore`, `riskLedger`, `controlMode`, `noticeStatus`
- Check the `Household` table for notice settings and preferences

---

## Priority Order

1. **High Priority**: Manual Test 1 (Principle 2.8) - Critical for safety
2. **High Priority**: Manual Test 2 (Scenarios A-D) - Core functionality
3. **Medium Priority**: Manual Test 3 (End-to-end) - Integration verification
4. **Medium Priority**: Manual Test 8 (Silence is never consent) - Safety critical
5. **Low Priority**: Manual Tests 4-7 - Edge cases and detailed verification

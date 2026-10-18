# Section 4 Manual Test Plan: Behaviour Risk Scoring

This plan comes from reading the code. The UI was not run, so a canned phrase may need rewording if a regex doesn't match.

## Setup

1. Run `docker-compose -f docker-compose.postgres.yml up -d`.
2. In `.env`, set `DATABASE_URL` and `DEMO_MODE=1`. Optionally set `SENSOR_HMAC_KEY` for the real sensor route and `RISK_SHADOW` (leave it unset for now).
3. Run `npx prisma generate && npx prisma migrate deploy && npm run dev`.
4. Log in with an OTP, then open three tabs:
   - `/workspace/<householdId>` (simulator)
   - `/helper`
   - `/resident`
5. Run `npx prisma studio` and watch the Case row for:
   - `riskScore`
   - `controlMode`
   - The ledger
   - `riskObservations` (availability and corrections)
6. Press "Reset" in the simulator before each test so every case starts at 0.

## 4.1 Zero-score behaviours

Ring, then say or do each of these in turn. Expected: `riskScore` stays 0 each time.

- Unknown visitor, short-notice or unannounced, nervous or slow speech
- A parcel visit (the 📦 canned line)
- One ordinary doorbell press
- Decline an optional question ("I'd rather not say")
- Ring while the camera is offline or the picture is poor

Also run `npm run calibrate`, which should end with 0 failures and no 4.1 false positives.

## 4.2 and 4.3 Points and evidence (speech events)

Ring, then type these as the visitor. Check the helper tab's ledger after each one.

| Say | Expected |
|-----|----------|
| `"What is your PIN?"` | +20 `credential_request`, confirmed, quote stored |
| `"Don't tell your carer I came"` | +15 `hide_from_helper` |
| `"I'm from the council"`, then later `"I'm a friend of the family"` | +15 first contradiction; a second independent one adds +10, capped at 25 |
| `"Let me in"` before the AI has stated the rules | 0, uncertain (`rules_not_explained_yet`) |
| `"Let me in"` after the AI states the rules | +5 `pressure_after_rule`, once |
| `"Open up, I won't wait"` after a boundary is stated | +1 each, capped at 10 |
| `"I'm not leaving"` after the AI asks them to leave | +25 `refuse_to_leave` |
| `"I'll hurt you"` | `immediate_threat`: score at least 80, mode `helper_only`, all helpers alerted at once |

**Negative phrases** (expected: 0, no alert):
- "My van broke down"
- "I'll beat the traffic"
- "I refuse to pay for parking"

Garbled or low-quality audio containing "PIN" should stay uncertain with no points.

## 4.3 Door events (no hardware needed)

Use the sensor buttons in the simulator.

1. **Lock tamper with no entry-denied stamp**
   - Expected: 0 points, uncertain

2. **Lock tamper after entry is denied**
   - Have the AI say its "entry is not permitted" line, or decline the case as a helper
   - Then press 🔒 Lock tamper
   - Expected: +30

3. **🚪 Door wedge**
   - Expected: +40, no stamp needed

4. **💥 Door force or ⚠️ Tamper**
   - Expected: score 100, mode emergency, helpers alerted once, and the `/resident` tab shows the red EMERGENCY screen

5. **"Camera uncertain forced entry" button**
   - Expected: score unchanged, one "possible emergency (not confirmed)" alert, and the mode raised to helper-led
   - Press the helper's Confirm on that entry
   - Expected: 100 and emergency
   - Resident screen: the code only shows EMERGENCY at score 100, so this stage is the open gap noted earlier (the resident is not yet told to keep the door closed while the emergency is unconfirmed)

6. **Knocks**
   - After the AI starts responding, send `button_press` through the simulator's event action within 30 s
   - Expected: +1 each, capped at +5
   - A press after 30 s, or before the AI responds, scores 0

7. **Resident SOS**
   - On `/resident`, press the SOS button
   - Expected: 100 and emergency

## 4.3 Unavailable path

1. Send the simulator event `device_offline` (via `POST /api/dev/simulate`), then ring
   - Expected: `riskObservations.availability.camera` is set and the helper card shows "camera offline" under Unknown. Score and mode do not change

2. Send `device_online`
   - Expected: the camera marker clears

3. Break the microphone or audio upload (send empty audio)
   - Expected: `availability.mic` is set, no points

## 4.4 Scoring rules

- **Dedupe (rule 1)**: repeat the same credential question
  - Expected: no second +20

- **Cap (rule 2)**: pile up credential, hide, refusal, lock and wedge events
  - Expected: the score tops out at 99 until a forced-entry or SOS event sets 100

- **Evidence (rule 3)**: every ledger line shows quote, time, source and state

- **Threat bypass (rule 5)**: a confirmed threat or forced entry alerts the helpers immediately, without waiting for the acknowledgement timer

- **Observed, Inferred, Unknown (rule 6)**: the helper card groups entries into those three sections

- **No drift (rule 7)**: wait a few minutes with no new events and refresh
  - Expected: the score is unchanged

## 4.5 Worked examples

Each should end with these values, after pressing Reset between runs:

- Calm unknown delivery: 0
- Credential alone: 20
- Contradiction, then pressure after the rules were explained: 15 + 5 = 20
- Credential, refusal, then lock test: 20 + 25 + 30 = 75, mode `helper_leads` or higher
- Credible threat: at least 80, `helper_only`
- Forced entry confirmed by a sensor: 100, emergency

## Corrections (rule 7) and shadow mode

- **Confirm and reject**: on an uncertain entry, Confirm adds its points; Reject removes them
- **Restore**: it needs a reason. After Reject it brings the points back, and after Confirm it reverts the entry to uncertain
- **Corrections log**: each action appends who, when and why
- **Reset**: it zeroes the score and keeps the audit trail
- **Shadow mode**: set `RISK_SHADOW=1` and restart. Run the scam script
  - Expected: the score is stored but no SMS or push is sent

---

**Record what you see for each step. A mismatch is either a real bug or a phrase that needs rewording.**
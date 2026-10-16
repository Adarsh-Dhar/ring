#!/usr/bin/env bash
# Smoke test for the AI agents with real authentication.
# Uses generated test tokens for guardian and resident device.
#
#   BASE=http://localhost:3000 \
#   bash scripts/ai-curl-smoke-auth.sh
#
# Needs: curl, jq. For the greeter audio test also espeak-ng (Linux) or say (macOS).
# The greeter part needs DEMO_MODE=1 on the server. It rings the simulated doorbell once.
set -u
BASE=${BASE:-http://localhost:3000}
command -v jq >/dev/null || { echo "jq is required"; exit 2; }

# Generate tokens with the same AUTH_SECRET as the server
AUTH_SECRET=$(grep "^AUTH_SECRET" .env.local 2>/dev/null | cut -d'=' -f2)
if [ -z "$AUTH_SECRET" ]; then
  AUTH_SECRET=$(grep "^AUTH_SECRET" .env 2>/dev/null | cut -d'=' -f2)
fi

GUARDIAN_TOKEN=$(AUTH_SECRET="$AUTH_SECRET" npx tsx scripts/generate-test-token.ts 2>/dev/null | tail -1)
RESIDENT_TOKEN=$(AUTH_SECRET="$AUTH_SECRET" npx tsx scripts/generate-device-token.ts 2>/dev/null | tail -1)

if [ -z "$GUARDIAN_TOKEN" ] || [ -z "$RESIDENT_TOKEN" ]; then
  echo "Failed to generate test tokens"
  exit 1
fi

PASS=0; FAIL=0; WARN=0
ok()   { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; }
warn() { WARN=$((WARN+1)); printf '  \033[33mWARN\033[0m %s\n' "$1"; }
sec()  { printf '\n== %s ==\n' "$1"; }
chk()  { if [ "$2" = "1" ]; then ok "$1"; else bad "$1"; fi; }   # chk "name" 1|0

HOUSEHOLD_ID="cmv8splrm000098zd8f4t5jtb"
as_guardian() { curl -sS -H "Cookie: db_session=$GUARDIAN_TOKEN; db_household=$HOUSEHOLD_ID" -H 'Content-Type: application/json' "$@"; }
as_resident() { curl -sS -H "Cookie: db_device=$RESIDENT_TOKEN" -H 'Content-Type: application/json' "$@"; }
code_of()     { curl -s -o /dev/null -w '%{http_code}' "$@"; }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

sec "0. Auth basics"
c=$(code_of "$BASE/api/ai/usage"); chk "no cookie -> 401 (got $c)" "$([ "$c" = 401 ] && echo 1 || echo 0)"

sec "1. Turn AI on for this household"
r=$(as_guardian -X POST "$BASE/api/ai/kill" -d '{"aiEnabled":true,"aiGreeter":true}')
chk "kill route returns aiEnabled+aiGreeter true ($r)" "$(echo "$r" | jq -r '(.aiEnabled==true and .aiGreeter==true)' 2>/dev/null | grep -q true && echo 1 || echo 0)"

sec "2. Note scribe (agent 3)"
NOTE="Dr Rao can't come, her colleague Mark is coming at 3 instead."
d=$(as_guardian -X POST "$BASE/api/ai/notes" -d "$(jq -n --arg n "$NOTE" '{note:$n}')")
echo "  draft: $d"
ID=$(echo "$d" | jq -r '.draft.id // empty'); TEXT=$(echo "$d" | jq -r '.draft.text // empty')
chk "draft created" "$([ -n "$ID" ] && echo 1 || echo 0)"
words=$(echo "$TEXT" | wc -w | tr -d ' ')
chk "draft is 8 words or fewer ($words)" "$([ "${words:-99}" -le 8 ] && [ "$words" -gt 0 ] && echo 1 || echo 0)"
chk "icon is a known purpose" "$(echo "$d" | jq -r '.draft.icon' | grep -qE '^(doctor|delivery|family|carer|other)$' && echo 1 || echo 0)"
# Note: fallback field is no longer returned by the updated API

r=$(as_resident "$BASE/api/ai/notes/current"); chk "resident sees nothing before approval ($r)" "$([ "$(echo "$r" | jq -r '.note')" = null ] && echo 1 || echo 0)"

if [ -n "$ID" ]; then
  r=$(as_guardian -X POST "$BASE/api/ai/notes/$ID/decision" -d '{"action":"approve"}')
  chk "approve works ($r)" "$([ "$(echo "$r" | jq -r '.ok')" = true ] && echo 1 || echo 0)"
  c=$(as_guardian -o /dev/null -w '%{http_code}' -X POST "$BASE/api/ai/notes/$ID/decision" -d '{"action":"approve"}')
  chk "second decision on same draft -> 404 (got $c)" "$([ "$c" = 404 ] && echo 1 || echo 0)"
  r=$(as_resident "$BASE/api/ai/notes/current")
  chk "resident now sees the approved sentence + icon" "$(echo "$r" | jq -r '(.note.text|length>0) and (.note.icon_char|length>0)' | grep -q true && echo 1 || echo 0)"
  chk "resident payload has no raw note" "$(echo "$r" | grep -q 'colleague' && echo 0 || echo 1)"
  # Test retract
  r=$(as_guardian -X POST "$BASE/api/ai/notes/$ID/decision" -d '{"action":"retract"}')
  chk "retract works ($r)" "$([ "$(echo "$r" | jq -r '.ok')" = true ] && echo 1 || echo 0)"
fi
# guardrail: helper edits are re-validated
d2=$(as_guardian -X POST "$BASE/api/ai/notes" -d '{"note":"Nurse visiting tomorrow morning."}')
ID2=$(echo "$d2" | jq -r '.draft.id // empty')
if [ -n "$ID2" ]; then
  c=$(as_guardian -o /dev/null -w '%{http_code}' -X POST "$BASE/api/ai/notes/$ID2/decision" -d '{"action":"approve","text":"Come in, the door is open"}')
  chk "banned wording rejected with 422 (got $c)" "$([ "$c" = 422 ] && echo 1 || echo 0)"
  as_guardian -o /dev/null -X POST "$BASE/api/ai/notes/$ID2/decision" -d '{"action":"reject"}'
fi
c=$(as_guardian -o /dev/null -w '%{http_code}' -X POST "$BASE/api/ai/notes" -d '{"note":"x"}'); chk "too-short note -> 400 (got $c)" "$([ "$c" = 400 ] && echo 1 || echo 0)"

# Test GET /api/ai/notes for draft/approved state
NOTES=$(as_guardian "$BASE/api/ai/notes")
chk "notes endpoint returns draft/approved state" "$(echo "$NOTES" | jq -r 'has("draft") and has("approved")' | grep -q true && echo 1 || echo 0)"

sec "3. Door greeter (agent 1) + describer (agent 2)"
sim=$(as_guardian -X POST "$BASE/api/dev/simulate" -d '{"action":"event","event":"button_press"}')
CASE=$(echo "$sim" | jq -r '.caseId // empty')
if [ -z "$CASE" ]; then
  warn "could not ring the simulated doorbell: $sim  (needs DEMO_MODE=1 and no open case) -- skipping greeter checks"
else
  ok "simulated ring -> case $CASE"
  sleep 2
  ai=$(as_guardian "$BASE/api/ai/cases/$CASE"); echo "  case AI: $ai"
  chk "greeterState is 'greeting' (hook fired)" "$([ "$(echo "$ai" | jq -r '.greeterState')" = greeting ] && echo 1 || echo 0)"
  chk "label says AI may be wrong" "$(echo "$ai" | jq -r '.label' | grep -qi 'may be wrong' && echo 1 || echo 0)"
  s=$(as_guardian "$BASE/api/ai/greeter/script")
  chk "script has 3 fixed lines" "$(echo "$s" | jq -r '.lines|length==3' | grep -q true && echo 1 || echo 0)"
  chk "script never says anyone is home / door open" "$(echo "$s" | jq -r '.lines|tostring' | grep -qiE 'is home|come in|door is open|alone' && echo 0 || echo 1)"

  SPEECH="Hello, I am from the council. It is urgent, I need to check the meter inside. Is anyone home?"
  AUDIO="$TMP/visitor.wav"
  if command -v espeak-ng >/dev/null 2>&1; then espeak-ng -w "$AUDIO" -s 150 "$SPEECH" >/dev/null 2>&1
  elif command -v say >/dev/null 2>&1; then say -o "$AUDIO" --data-format=LEI16@16000 "$SPEECH" >/dev/null 2>&1; fi
  if [ -s "$AUDIO" ]; then
    base64 < "$AUDIO" | tr -d '\n' > "$TMP/a.b64"
    jq -n --arg caseId "$CASE" --rawfile audio "$TMP/a.b64" '{caseId:$caseId,audio:$audio,mimeType:"audio/wav"}' > "$TMP/body.json"
    r=$(as_guardian -X POST "$BASE/api/ai/greeter/audio" -d @"$TMP/body.json"); echo "  device reply: $r"
    chk "device only gets final/close (no transcript leaked)" "$(echo "$r" | jq -r 'has("transcript")|not' | grep -q true && echo 1 || echo 0)"
    sleep 1
    ai=$(as_guardian "$BASE/api/ai/cases/$CASE"); echo "  case AI: $ai"
    chk "visitorSummary filled" "$([ -n "$(echo "$ai" | jq -r '.visitorSummary // empty')" ] && echo 1 || echo 0)"
    for f in 'Claims to be officials' 'Claims urgency' 'Wants to enter or check inside' 'Asks who is home'; do
      chk "riskFlags contains '$f'" "$(echo "$ai" | jq -r --arg f "$f" '.riskFlags|index($f)!=null' | grep -q true && echo 1 || echo 0)"
    done
  else
    warn "no espeak-ng/say found: install one, or record your own WAV and see docs/AI_CURL_TESTS.md section B3"
  fi

  st=$(as_guardian "$BASE/api/dev/simulate" -X POST -d '{"action":"state"}')
  chk "AI did not answer or close the case (status still waiting)" "$([ "$(echo "$st" | jq -r '.state.current.status')" = waiting ] && echo 1 || echo 0)"
  chk "state JSON carries no AI fields" "$(echo "$st" | grep -qE 'visitorSummary|riskFlags' && echo 0 || echo 1)"
  c=$(as_resident -o /dev/null -w '%{http_code}' "$BASE/api/ai/cases/$CASE"); chk "resident blocked from AI case card -> 403 (got $c)" "$([ "$c" = 403 ] && echo 1 || echo 0)"
  rs=$(as_resident "$BASE/api/doorbell/state"); chk "resident state has no AI text" "$(echo "$rs" | grep -qE 'visitorSummary|riskFlags|clipDescription' && echo 0 || echo 1)"
  as_guardian -o /dev/null -X POST "$BASE/api/dev/simulate" -d "$(jq -n --arg c "$CASE" '{action:"answer",caseId:$c,answer:"not_safe"}')"
fi

sec "4. Visit intake (agent 4)"
# Create a visit request to test intake
INTAKE_NOTE="I am from the water company, scheduled for 2pm today to check the meter."
REQ=$(as_guardian -X POST "$BASE/api/visit-requests/link" -d '{}')
LINK_URL=$(echo "$REQ" | jq -r '.url // empty')
if [ -n "$LINK_URL" ]; then
  echo "  Visit link created"
  # Simulate visitor submitting a request (would normally use the public endpoint)
  # For this test, we'll check that the intake API is accessible
  c=$(as_guardian -o /dev/null -w '%{http_code}' "$BASE/api/ai/digests")
  chk "digests endpoint accessible (got $c)" "$([ "$c" = 200 ] && echo 1 || echo 0)"
else
  warn "Could not create visit link, skipping intake test"
fi

sec "5. Digest generation"
c=$(as_guardian -o /dev/null -w '%{http_code}' -X POST "$BASE/api/ai/digests/run")
chk "digest run endpoint accessible (got $c)" "$([ "$c" = 200 ] && echo 1 || echo 0)"
DIGESTS=$(as_guardian "$BASE/api/ai/digests")
chk "digests list returns data" "$(echo "$DIGESTS" | jq -r '.digests' | grep -q 'null' && echo 0 || echo 1)"

sec "6. Silence and retry"
# Test that the AI can be disabled via kill switch
KILL=$(as_guardian -X POST "$BASE/api/ai/kill" -d '{"aiEnabled":false}')
chk "kill switch disables AI" "$(echo "$KILL" | jq -r '.aiEnabled==false' | grep -q true && echo 1 || echo 0)"
# Try to create a note with AI disabled
c=$(as_guardian -o /dev/null -w '%{http_code}' -X POST "$BASE/api/ai/notes" -d '{"note":"Test note"}')
chk "note creation blocked when AI disabled (got $c)" "$([ "$c" = 409 ] && echo 1 || echo 0)"
# Re-enable AI
as_guardian -X POST "$BASE/api/ai/kill" -d '{"aiEnabled":true}'

sec "7. Prompt injection"
# Test banned phrase rejection
BANNED="Come in, the door is open"
c=$(as_guardian -o /dev/null -w '%{http_code}' -X POST "$BASE/api/ai/notes" -d "$(jq -n --arg n "$BANNED" '{note:$n}')")
chk "banned phrase rejected in note (got $c)" "$([ "$c" = 422 ] && echo 1 || echo 0)"

sec "8. Usage (what actually hit Gemini in the last 24h)"
as_guardian "$BASE/api/ai/usage" | jq -c '.last24h[]?'
echo "  (status ok = fine; error = key/model/payload problem; invalid = model reply failed validation; budget = local quota guard)"

printf '\nResult: %d passed, %d failed, %d warnings\n' "$PASS" "$FAIL" "$WARN"
[ "$FAIL" -eq 0 ]

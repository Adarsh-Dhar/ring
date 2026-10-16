#!/usr/bin/env bash
# Smoke test for the AI agents with auth bypass enabled.
# Requires TEST_AUTH_BYPASS=1 in .env.local
#
#   BASE=http://localhost:3000 \
#   bash scripts/ai-curl-smoke-noauth.sh
#
# Needs: curl, jq. For the greeter audio test also espeak-ng (Linux) or say (macOS).
# The greeter part needs DEMO_MODE=1 on the server. It rings the simulated doorbell once.
set -u
BASE=${BASE:-http://localhost:3000}
command -v jq >/dev/null || { echo "jq is required"; exit 2; }

PASS=0; FAIL=0; WARN=0
ok()   { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; }
warn() { WARN=$((WARN+1)); printf '  \033[33mWARN\033[0m %s\n' "$1"; }
sec()  { printf '\n== %s ==\n' "$1"; }
chk()  { if [ "$2" = "1" ]; then ok "$1"; else bad "$1"; fi; }   # chk "name" 1|0

# Simple curl without auth (auth is bypassed by TEST_AUTH_BYPASS=1)
api_call() { curl -sS -H 'Content-Type: application/json' "$@"; }
code_of() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

sec "0. Check if auth bypass is enabled"
c=$(code_of "$BASE/api/ai/usage")
if [ "$c" = 200 ]; then
  ok "auth bypass working (got 200 from /api/ai/usage)"
else
  bad "auth bypass not working (got $c from /api/ai/usage) - ensure TEST_AUTH_BYPASS=1 in .env.local"
  exit 1
fi

sec "1. Turn AI on for this household"
r=$(api_call -X POST "$BASE/api/ai/kill" -d '{"aiEnabled":true,"aiGreeter":true}')
chk "kill route returns aiEnabled+aiGreeter true ($r)" "$(echo "$r" | jq -r '(.aiEnabled==true and .aiGreeter==true)' 2>/dev/null | grep -q true && echo 1 || echo 0)"

sec "2. Note scribe (agent 3)"
NOTE="Dr Rao can't come, her colleague Mark is coming at 3 instead."
d=$(api_call -X POST "$BASE/api/ai/notes" -d "$(jq -n --arg n "$NOTE" '{note:$n}')")
echo "  draft: $d"
ID=$(echo "$d" | jq -r '.draft.id // empty'); TEXT=$(echo "$d" | jq -r '.draft.text // empty')
chk "draft created" "$([ -n "$ID" ] && echo 1 || echo 0)"
words=$(echo "$TEXT" | wc -w | tr -d ' ')
chk "draft is 8 words or fewer ($words)" "$([ "${words:-99}" -le 8 ] && [ "$words" -gt 0 ] && echo 1 || echo 0)"
chk "icon is a known purpose" "$(echo "$d" | jq -r '.draft.icon' | grep -qE '^(doctor|delivery|family|carer|other)$' && echo 1 || echo 0)"
if [ "$(echo "$d" | jq -r '.draft.fallback')" = "true" ]; then warn "fallback=true: Gemini did NOT produce this draft (check /api/ai/usage and AiRun)"; else ok "draft came from the model (fallback=false)"; fi

if [ -n "$ID" ]; then
  r=$(api_call -X POST "$BASE/api/ai/notes/$ID/decision" -d '{"action":"approve"}')
  chk "approve works ($r)" "$([ "$(echo "$r" | jq -r '.status')" = approved ] && echo 1 || echo 0)"
  c=$(api_call -o /dev/null -w '%{http_code}' -X POST "$BASE/api/ai/notes/$ID/decision" -d '{"action":"approve"}')
  chk "second decision on same draft -> 404 (got $c)" "$([ "$c" = 404 ] && echo 1 || echo 0)"
fi
# guardrail: helper edits are re-validated
d2=$(api_call -X POST "$BASE/api/ai/notes" -d '{"note":"Nurse visiting tomorrow morning."}')
ID2=$(echo "$d2" | jq -r '.draft.id // empty')
if [ -n "$ID2" ]; then
  c=$(api_call -o /dev/null -w '%{http_code}' -X POST "$BASE/api/ai/notes/$ID2/decision" -d '{"action":"approve","text":"Come in, the door is open"}')
  chk "banned wording rejected with 422 (got $c)" "$([ "$c" = 422 ] && echo 1 || echo 0)"
  api_call -o /dev/null -X POST "$BASE/api/ai/notes/$ID2/decision" -d '{"action":"reject"}'
fi
c=$(api_call -o /dev/null -w '%{http_code}' -X POST "$BASE/api/ai/notes" -d '{"note":"x"}'); chk "too-short note -> 400 (got $c)" "$([ "$c" = 400 ] && echo 1 || echo 0)"

sec "3. Door greeter (agent 1) + describer (agent 2)"
sim=$(api_call -X POST "$BASE/api/dev/simulate" -d '{"action":"event","event":"button_press"}')
CASE=$(echo "$sim" | jq -r '.caseId // empty')
if [ -z "$CASE" ]; then
  warn "could not ring the simulated doorbell: $sim  (needs DEMO_MODE=1 and no open case) -- skipping greeter checks"
else
  ok "simulated ring -> case $CASE"
  sleep 2
  ai=$(api_call "$BASE/api/ai/cases/$CASE"); echo "  case AI: $ai"
  chk "greeterState is 'greeting' (hook fired)" "$([ "$(echo "$ai" | jq -r '.greeterState')" = greeting ] && echo 1 || echo 0)"
  chk "label says AI may be wrong" "$(echo "$ai" | jq -r '.label' | grep -qi 'may be wrong' && echo 1 || echo 0)"
  s=$(api_call "$BASE/api/ai/greeter/script")
  chk "script has 3 fixed lines" "$(echo "$s" | jq -r '.lines|length==3' | grep -q true && echo 1 || echo 0)"
  chk "script never says anyone is home / door open" "$(echo "$s" | jq -r '.lines|tostring' | grep -qiE 'is home|come in|door is open|alone' && echo 0 || echo 1)"

  SPEECH="Hello, I am from the council. It is urgent, I need to check the meter inside. Is anyone home?"
  AUDIO="$TMP/visitor.wav"
  if command -v espeak-ng >/dev/null 2>&1; then espeak-ng -w "$AUDIO" -s 150 "$SPEECH" >/dev/null 2>&1
  elif command -v say >/dev/null 2>&1; then say -o "$AUDIO" --data-format=LEI16@16000 "$SPEECH" >/dev/null 2>&1; fi
  if [ -s "$AUDIO" ]; then
    base64 < "$AUDIO" | tr -d '\n' > "$TMP/a.b64"
    jq -n --arg caseId "$CASE" --rawfile audio "$TMP/a.b64" '{caseId:$caseId,audio:$audio,mimeType:"audio/wav"}' > "$TMP/body.json"
    r=$(api_call -X POST "$BASE/api/ai/greeter/audio" -d @"$TMP/body.json"); echo "  device reply: $r"
    chk "device only gets final/close (no transcript leaked)" "$(echo "$r" | jq -r 'has("transcript")|not' | grep -q true && echo 1 || echo 0)"
    sleep 1
    ai=$(api_call "$BASE/api/ai/cases/$CASE"); echo "  case AI: $ai"
    chk "visitorSummary filled" "$([ -n "$(echo "$ai" | jq -r '.visitorSummary // empty')" ] && echo 1 || echo 0)"
    for f in 'Claims to be officials' 'Claims urgency' 'Wants to enter or check inside' 'Asks who is home'; do
      chk "riskFlags contains '$f'" "$(echo "$ai" | jq -r --arg f "$f" '.riskFlags|index($f)!=null' | grep -q true && echo 1 || echo 0)"
    done
  else
    warn "no espeak-ng/say found: install one, or record your own WAV and see docs/AI_CURL_TESTS.md section B3"
  fi

  st=$(api_call "$BASE/api/dev/simulate" -X POST -d '{"action":"state"}')
  chk "AI did not answer or close the case (status still waiting)" "$([ "$(echo "$st" | jq -r '.state.current.status')" = waiting ] && echo 1 || echo 0)"
  chk "state JSON carries no AI fields" "$(echo "$st" | grep -qE 'visitorSummary|riskFlags' && echo 0 || echo 1)"
  api_call -o /dev/null -X POST "$BASE/api/dev/simulate" -d "$(jq -n --arg c "$CASE" '{action:"answer",caseId:$c,answer:"not_safe"}')"
fi

sec "4. Usage (what actually hit Gemini in the last 24h)"
api_call "$BASE/api/ai/usage" | jq -c '.last24h[]?'
echo "  (status ok = fine; error = key/model/payload problem; invalid = model reply failed validation; budget = local quota guard)"

printf '\nResult: %d passed, %d failed, %d warnings\n' "$PASS" "$FAIL" "$WARN"
[ "$FAIL" -eq 0 ]

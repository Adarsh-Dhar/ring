#!/usr/bin/env bash
# Test only the untested AI agents: Weekly Digest (Agent 4)
#
#   BASE=http://localhost:3000 \
#   bash scripts/test-remaining-agents.sh
#
# Needs: curl, jq
set -u
BASE=${BASE:-http://localhost:3000}
command -v jq >/dev/null || { echo "jq is required"; exit 2; }

PASS=0; FAIL=0; WARN=0
ok()   { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; }
warn() { WARN=$((WARN+1)); printf '  \033[33mWARN\033[0m %s\n' "$1"; }
sec()  { printf '\n== %s ==\n' "$1"; }
chk()  { if [ "$2" = "1" ]; then ok "$1"; else bad "$1"; fi; }

# Simple curl without auth (auth is bypassed by TEST_AUTH_BYPASS=1)
api_call() { curl -sS -H 'Content-Type: application/json' "$@"; }
code_of() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

sec "1. Weekly Digest (Agent 5) - Summary generation"
# Reset any existing digest
echo "  Creating test cases for digest..."
api_call -X POST "$BASE/api/dev/simulate" -d '{"action":"reset"}' > /dev/null

# Create some test cases in the database
PGPASSWORD=devpassword psql -h localhost -p 5433 -U doorbell -d doorbell -c "
  INSERT INTO \"Case\" (id, kind, \"eventType\", \"householdId\", status, answer, \"helperIndex\", \"deadlineAt\", \"createdAt\", \"riskFlags\")
  VALUES
    ('digest_test_1', 'visitor', 'button_press', 'test-household', 'no_response', 'not_safe', 0, NOW() - interval '2 days', NOW() - interval '2 days', '[\"Claims urgency\"]'::jsonb),
    ('digest_test_2', 'visitor', 'button_press', 'test-household', 'no_response', 'safe', 0, NOW() - interval '2 days', NOW() - interval '2 days', '[]'::jsonb),
    ('digest_test_3', 'visitor', 'button_press', 'test-household', 'no_response', 'safe', 0, NOW() - interval '2 days', NOW() - interval '2 days', '[]'::jsonb)
  ON CONFLICT (id) DO NOTHING;
" > /dev/null 2>&1

# Force digest generation
r=$(api_call -X POST "$BASE/api/ai/digests/run" -d '{"force":true}')
echo "  Response: $r"

DIGEST_ID=$(echo "$r" | jq -r '.digest.id // empty')
FACTS=$(echo "$r" | jq -r '.digest.facts // empty')
TEXT=$(echo "$r" | jq -r '.digest.text // empty')

if [ -n "$DIGEST_ID" ] && [ "$DIGEST_ID" != "null" ]; then
  ok "digest generated"
  chk "facts provided" "$([ -n "$FACTS" ] && [ "$FACTS" != "null" ] && echo 1 || echo 0)"

  if [ -n "$FACTS" ] && [ "$FACTS" != "null" ]; then
    TOTAL=$(echo "$FACTS" | jq -r '.totalRings // 0')
    chk "totalRings in facts" "$([ "$TOTAL" -ge 3 ] && echo 1 || echo 0)"
    FLAGGED=$(echo "$FACTS" | jq -r '.flaggedRings // 0')
    chk "flaggedRings in facts" "$([ "$FLAGGED" -ge 1 ] && echo 1 || echo 0)"
  fi

  if [ -n "$TEXT" ] && [ "$TEXT" != "null" ]; then
    WORDS=$(echo "$TEXT" | wc -w | tr -d ' ')
    chk "text provided ($WORDS words)" "1"
    # Check if it's using template (starts with "X rings this week") or AI-generated
    if echo "$TEXT" | grep -q "rings this week"; then
      warn "using template text (AI may be unavailable or overloaded)"
    else
      ok "using AI-generated text"
    fi
  else
    bad "text missing"
  fi
else
  bad "digest generation failed"
fi

sec "2. Check AI usage for these agents"
api_call "$BASE/api/ai/usage" | jq -c '.last24h[]? | select(.agent == "digest")'
echo "  (status ok = fine; error = key/model/payload problem; invalid = model reply failed validation; budget = local quota guard)"

printf '\nResult: %d passed, %d failed, %d warnings\n' "$PASS" "$FAIL" "$WARN"
[ "$FAIL" -eq 0 ]

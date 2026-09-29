#!/bin/bash

# Advanced Ring Clip Download Test - UI-like behavior
# Gets clips list, tries different clips until success

# Set working directory to project root
cd "$(dirname "$0")"

# Load environment variables exactly like Next.js does
if [ -f .env.local ]; then
    export $(grep -v '^#' .env.local | xargs)
fi

BASE_URL="http://localhost:3000"
DEVICE_ID="${DEVICE_ID:-ava1.ring.device.FYCDT37JM5XOKZJSSPNEMQUHRPPBWBDUBDBAHEEG7VTANC6UI7ISUSEFSKXKYYLI6XEGURMGPFFNJTPC446BAQFKLMF4GC55}"
CLIP_LENGTH=15  # seconds

echo "🎬 Ring Random Clip Download Test (UI-like behavior)"
echo "===================================================="
echo "📡 Device: $DEVICE_ID"
echo "🌐 Server: $BASE_URL"
echo ""

# Get clips
echo "📋 Fetching clips..."
sleep 2  # Avoid Ring API rate limiting
CLIPS_RESPONSE=$(curl -s "$BASE_URL/api/ring/clips?deviceId=$DEVICE_ID")

# Check for errors
if echo "$CLIPS_RESPONSE" | grep -q "error"; then
    echo "❌ Error fetching clips:"
    echo "$CLIPS_RESPONSE"
    exit 1
fi

# Get first clip's details
FIRST_CLIP=$(echo "$CLIPS_RESPONSE" | python3 -c "
import json
import sys

try:
    data = json.load(sys.stdin)
    clips = data.get('clips', [])
    if clips:
        clip = clips[0]
        print(f\"{clip['id']}|{clip['eventType']}|{clip['startMs']}|{clip.get('eventId', '')}|{clip.get('downloadable', True)}\")
    else:
        print('NO_CLIPS')
except Exception as e:
    print(f'ERROR: {e}')
    sys.exit(1)
")

if [[ "$FIRST_CLIP" == ERROR* ]] || [[ "$FIRST_CLIP" == "NO_CLIPS" ]]; then
    echo "❌ Error parsing clip data"
    exit 1
fi

# Parse clip details
IFS='|' read -r id type ts eid dl <<< "$FIRST_CLIP"

echo "📹 Selected clip:"
echo "   ID: $id"
echo "   Type: $type"
echo "   Timestamp: $ts"
echo "   Event ID: $eid"
echo "   Downloadable: $dl"
echo ""

# Attempt download
echo "⬇️  Attempting download (UI method)..."
JSON_PAYLOAD="{\"deviceId\":\"$DEVICE_ID\",\"timestamp\":$ts,\"duration\":$((CLIP_LENGTH * 1000)),\"eventId\":\"$eid\"}"

sleep 2  # Avoid Ring API rate limiting
DOWNLOAD_RESPONSE=$(curl -s -X POST "$BASE_URL/api/ring/clip" \
    -H "Content-Type: application/json" \
    -d "$JSON_PAYLOAD")

if ! echo "$DOWNLOAD_RESPONSE" | grep -q "error"; then
    echo "✅ SUCCESS! Downloaded clip"
    echo "📊 Response size: ${#DOWNLOAD_RESPONSE} bytes"
    exit 0
else
    ERROR_MSG=$(echo "$DOWNLOAD_RESPONSE" | python3 -c "
import json
import sys
try:
    data = json.load(sys.stdin)
    if 'error' in data:
        print(data['error'][:100])
    else:
        print('Unknown error')
except:
    print('Parse error')
")
    echo "❌ Download failed: $ERROR_MSG"
    echo ""
    echo "💡 This is expected for 'on_demand' events."
    echo "   Ring's Media Clips API does not allow downloading manually triggered recordings."
    echo "   Trigger motion or doorbell events to get downloadable clips."
    exit 1
fi

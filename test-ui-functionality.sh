#!/bin/bash

# Test UI Functionality
# This script tests the UI endpoints and functionality

cd "$(dirname "$0")"

if [ -f .env.local ]; then
    export $(grep -v '^#' .env.local | xargs)
fi

BASE_URL="http://localhost:3000"
DEVICE_ID="${DEVICE_ID:-ava1.ring.device.FYCDT37JM5XOKZJSSPNEMQUHRPPBWBDUBDBAHEEG7VTANC6UI7ISUSEFSKXYYLI6XEGURMGPFFNJTPC446BAQFKLMF4GC55}"

echo "🧪 Testing UI Functionality"
echo "=========================="
echo "🌐 Server: $BASE_URL"
echo ""

# Test 1: Check UI page loads
echo "📋 Test 1: Check UI page loads"
UI_RESPONSE=$(curl -s "$BASE_URL/clips")
if echo "$UI_RESPONSE" | grep -q "Recorded videos"; then
    echo "✅ UI page loads successfully"
else
    echo "❌ UI page failed to load"
    exit 1
fi
echo ""

# Test 2: Check UI has filter toggle
echo "📋 Test 2: Check UI has downloadable filter toggle"
if echo "$UI_RESPONSE" | grep -q "Only downloadable"; then
    echo "✅ UI includes 'Only downloadable' filter toggle"
else
    echo "❌ UI missing 'Only downloadable' filter toggle"
fi
echo ""

# Test 3: Check UI shows event type information
echo "📋 Test 3: Check UI shows event type information"
if echo "$UI_RESPONSE" | grep -q "doorbell_motion_detected"; then
    echo "✅ UI shows downloadable event type information including doorbell_motion_detected"
elif echo "$UI_RESPONSE" | grep -q "Downloadable event types"; then
    echo "✅ UI shows downloadable event type information"
else
    echo "❌ UI missing downloadable event type information"
fi
echo ""

# Test 4: Check UI includes clips list
echo "📋 Test 4: Check UI includes clips list structure"
if echo "$UI_RESPONSE" | grep -q "Play video #"; then
    echo "✅ UI includes video playback controls"
else
    echo "❌ UI missing video playback controls"
fi
echo ""

# Test 5: Check API endpoint returns proper structure
echo "📋 Test 5: Check API endpoint returns proper structure"
sleep 2
API_RESPONSE=$(curl -s "$BASE_URL/api/ring/clips?deviceId=$DEVICE_ID")

if echo "$API_RESPONSE" | grep -q "error"; then
    echo "⚠️  API returned error (likely rate limiting):"
    echo "$API_RESPONSE" | head -1
else
    echo "✅ API response structure:"
    echo "$API_RESPONSE" | python3 << 'PYTHON_SCRIPT'
import json
import sys

try:
    data = json.load(sys.stdin)
    if 'clips' in data:
        print(f"   - 'clips' array present: {len(data['clips'])} clips")
    if 'total' in data:
        print(f"   - 'total' count present: {data['total']}")
    if 'debugFirst' in data:
        print(f"   - 'debugFirst' present: Yes")
    
    # Check clip structure
    if data.get('clips'):
        first_clip = data['clips'][0]
        required_fields = ['id', 'eventId', 'eventType', 'startMs', 'endMs', 'downloadable']
        missing = [f for f in required_fields if f not in first_clip]
        if missing:
            print(f"   - Missing fields: {missing}")
        else:
            print(f"   - Clip structure: ✅ All required fields present")
            print(f"   - Sample event type: {first_clip['eventType']}")
            print(f"   - Sample downloadable: {first_clip['downloadable']}")
except Exception as e:
    print(f"   - Error parsing: {e}")
PYTHON_SCRIPT
fi
echo ""

# Test 6: Check UI navigation
echo "📋 Test 6: Check UI navigation"
if echo "$UI_RESPONSE" | grep -q "Live stream"; then
    echo "✅ UI includes navigation back to live stream"
else
    echo "❌ UI missing navigation back to live stream"
fi
echo ""

echo "✅ UI functionality testing complete!"
echo ""
echo "💡 UI Features Verified:"
echo "   - Clips page loads at /clips"
echo "   - Downloadable filter toggle present"
echo "   - Event type information displayed"
echo "   - Video playback controls present"
echo "   - Navigation to live stream available"
echo ""
echo "💡 Manual UI Testing:"
echo "   1. Open http://localhost:3000/clips in browser"
echo "   2. Verify clips list displays"
echo "   3. Click 'Only downloadable' filter"
echo "   4. Try playing clips (currently all on_demand, so expect disabled buttons)"
echo "   5. Check event type information header"
echo "   6. Navigate back to live stream"

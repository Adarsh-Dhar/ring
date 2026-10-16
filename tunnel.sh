#!/bin/bash
# Keeps a localtunnel running forever. If it exits, crashes, or drops, it restarts.
# Usage: ./tunnel.sh            (or: npm run tunnel)
# Override: PORT=3000 SUBDOMAIN=adarsh-ring-app ./tunnel.sh

PORT="${PORT:-3000}"
SUBDOMAIN="${SUBDOMAIN:-adarsh-ring-app}"
URL="https://${SUBDOMAIN}.loca.lt"
DELAY=3          # seconds before restart
HEALTH_EVERY=20  # seconds between health checks
FAILS_MAX=3      # consecutive failed checks before forcing a restart

LT_PID=""
cleanup() {
  echo; echo "Stopping tunnel supervisor..."
  [ -n "$LT_PID" ] && kill "$LT_PID" 2>/dev/null
  pkill -P $$ 2>/dev/null
  exit 0
}
trap cleanup INT TERM

while true; do
  echo "[$(date '+%H:%M:%S')] Starting localtunnel: $URL -> localhost:$PORT"
  npx --yes localtunnel --port "$PORT" --subdomain "$SUBDOMAIN" &
  LT_PID=$!

  # Watchdog: localtunnel can hang while the process stays alive, so also
  # probe the public URL and kill it if it stops responding.
  fails=0
  sleep 10
  while kill -0 "$LT_PID" 2>/dev/null; do
    code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' -H 'bypass-tunnel-reminder: 1' "$URL" 2>/dev/null)
    # 502/504/000 or 5xx from loca.lt itself means the tunnel is down
    if [ "$code" = "000" ] || [ "$code" = "502" ] || [ "$code" = "504" ] || [ "$code" = "503" ]; then
      fails=$((fails+1))
      echo "[$(date '+%H:%M:%S')] Health check failed (HTTP $code) $fails/$FAILS_MAX"
      if [ "$fails" -ge "$FAILS_MAX" ]; then
        echo "Tunnel unresponsive, killing it to restart..."
        kill "$LT_PID" 2>/dev/null
        break
      fi
    else
      fails=0
    fi
    sleep "$HEALTH_EVERY"
  done

  wait "$LT_PID" 2>/dev/null
  LT_PID=""
  echo "[$(date '+%H:%M:%S')] Tunnel stopped. Restarting in ${DELAY}s... (Ctrl+C to quit)"
  sleep "$DELAY"
done

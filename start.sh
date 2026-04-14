#!/usr/bin/env bash
# start.sh — Launch ElizaOS (port 3001, internal) and nginx (port 3000, public)
set -euo pipefail

# ElizaOS internal port
export SERVER_PORT=3001

echo "[start] Starting NosaBot ElizaOS agent on port 3001..."
pnpm start &
ELIZA_PID=$!

# Give ElizaOS a moment to initialize before nginx starts proxying
sleep 4

echo "[start] Starting nginx reverse proxy on port 3000..."
nginx -g "daemon off;" &
NGINX_PID=$!

echo "[start] NosaBot is ready. Frontend → http://0.0.0.0:3000"

# Exit when either process stops
wait -n $ELIZA_PID $NGINX_PID
STATUS=$?

echo "[start] A process exited with status $STATUS — shutting down."
kill $ELIZA_PID $NGINX_PID 2>/dev/null || true
exit $STATUS

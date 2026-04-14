#!/usr/bin/env bash
# start.sh — Run ElizaOS directly on port 3000 (no nginx)
export SERVER_PORT=3000
export PORT=3000

echo "[start] Starting NosaBot on port 3000..."
CRASHES=0
while true; do
    pnpm start
    CRASHES=$((CRASHES + 1))
    echo "[eliza] Exited (crash #${CRASHES}). Restarting in 5s..."
    sleep 5
done

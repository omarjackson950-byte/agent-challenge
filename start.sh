#!/usr/bin/env bash
# start.sh — Launch ElizaOS (port 3001, internal) + nginx (port 3000, public)
# ElizaOS auto-restarts on crash; container lives as long as nginx does.

export SERVER_PORT=3001

echo "[start] Starting nginx reverse proxy on port 3000..."
nginx -g "daemon off;" &
NGINX_PID=$!

echo "[start] Starting NosaBot ElizaOS on port 3001 (auto-restart enabled)..."
CRASHES=0
while true; do
    pnpm start
    CRASHES=$((CRASHES + 1))
    echo "[eliza] Exited (crash #${CRASHES}). Restarting in 10s..."

    # Exit container if nginx has died
    if ! kill -0 "$NGINX_PID" 2>/dev/null; then
        echo "[start] nginx exited — shutting down container"
        exit 1
    fi

    sleep 10
done

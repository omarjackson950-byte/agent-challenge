# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# NosaBot — ElizaOS agent + nginx frontend
# Architecture:
#   • ElizaOS serves the REST API on port 3001 (internal)
#   • nginx serves the frontend on port 3000 (exposed) and proxies /api → 3001
# ─────────────────────────────────────────────────────────────────────────────

FROM node:23-slim AS base

# System deps: build tools for native modules + nginx
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    nginx \
    && rm -rf /var/lib/apt/lists/*

# Disable ElizaOS telemetry
ENV ELIZAOS_TELEMETRY_DISABLED=true
ENV DO_NOT_TRACK=1

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Install Node dependencies
COPY package.json ./
RUN pnpm install

# Copy source and build TypeScript plugin
COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm build

# Copy remaining project files
COPY characters/ ./characters/
COPY frontend/   ./frontend/
COPY start.sh    ./start.sh

# Data directory for SQLite / task & note files
RUN mkdir -p /app/data

# nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Startup script
RUN chmod +x /app/start.sh

EXPOSE 3000

ENV NODE_ENV=production
ENV SERVER_PORT=3001

CMD ["/app/start.sh"]

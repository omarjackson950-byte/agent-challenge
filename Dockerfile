# syntax=docker/dockerfile:1
# NosaBot — ElizaOS agent running directly on port 3000

FROM node:23-slim AS base

# System deps for native Node modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
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

# Copy source and assets
COPY tsconfig.json ./
COPY src/ ./src/
COPY characters/ ./characters/
COPY frontend/ ./frontend/
COPY start.sh ./start.sh

# Data directory for SQLite
RUN mkdir -p /app/data

# Startup script
RUN chmod +x /app/start.sh

EXPOSE 3000

ENV NODE_ENV=production
ENV SERVER_PORT=3000
ENV PORT=3000

CMD ["/app/start.sh"]

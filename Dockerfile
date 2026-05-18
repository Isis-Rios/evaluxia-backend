# ──────────────────────────────────────────────────────────────────────────────
# EvalUXIA Backend — Dockerfile
# Multi-stage build: builder (TypeScript compile) → runner (production)
# ──────────────────────────────────────────────────────────────────────────────

# ─── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Install dependencies first (layer cache optimization)
COPY package*.json ./
RUN npm ci

# Copy source and compile TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ─── Stage 2: Runner ──────────────────────────────────────────────────────────
FROM node:20-slim AS runner

WORKDIR /app

# Install production dependencies and Playwright browser
COPY package*.json ./
RUN npm ci --only=production
RUN npx playwright install --with-deps chromium

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Non-root user for security
RUN groupadd -r evaluxia && useradd -r -g evaluxia evaluxia
USER evaluxia

EXPOSE 3000

CMD ["node", "dist/app/server.js"]
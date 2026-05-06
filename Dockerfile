# ── Stage 1: Build React frontend ─────────────────────────────────────────────
FROM node:20-alpine AS react-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ── Stage 2: Node.js backend ──────────────────────────────────────────────────
FROM node:20-alpine AS final
WORKDIR /app

# Install server dependencies
COPY server/package*.json ./server/
RUN npm --prefix server ci --omit=dev

# Copy server source
COPY server/ ./server/

# Copy static assets
COPY static/ ./static/

# Copy Vite build output from stage 1
COPY --from=react-build /app/static/dist/ ./static/dist/

EXPOSE 5000
CMD ["node", "server/index.js"]

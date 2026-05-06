# ── Stage 1: Build React frontend ─────────────────────────────────────────────
FROM node:22-alpine AS react-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
# Vite outputs to ../static/dist/browser (one level up from client)
RUN npm run build

# ── Stage 2: Python Flask backend ────────────────────────────────────────────
FROM python:3.11-slim-bookworm AS final
WORKDIR /app

# System deps for psycopg2
RUN apt-get update && apt-get install -y libpq-dev gcc && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Copy Vite build output (lives at /app/static/dist/browser in the build stage)
COPY --from=react-build /app/static/dist/ ./static/dist/

EXPOSE 8000
CMD ["gunicorn", "wsgi:app", "--workers", "1", "--threads", "4", "--timeout", "120", "--bind", "0.0.0.0:8000"]

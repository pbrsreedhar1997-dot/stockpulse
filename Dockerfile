# ── Stage 1: Build Angular frontend ─────────────────────────────────────────
FROM node:20-slim AS ng-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build -- --configuration production

# ── Stage 2: Python Flask backend ────────────────────────────────────────────
FROM python:3.11-slim AS final
WORKDIR /app

# System deps for psycopg2
RUN apt-get update && apt-get install -y libpq-dev gcc && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Copy Angular build output into static/dist
COPY --from=ng-build /app/client/dist/ ./static/dist/

EXPOSE 8000
CMD ["gunicorn", "wsgi:app", "--workers", "1", "--threads", "4", "--timeout", "120", "--bind", "0.0.0.0:8000"]

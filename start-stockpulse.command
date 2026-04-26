#!/bin/bash
# StockPulse Launcher — double-click to start
cd "$(dirname "$0")"

echo "╔══════════════════════════════════════╗"
echo "║       StockPulse Backend Server      ║"
echo "╚══════════════════════════════════════╝"

# ── Load keys from stockpulse.env ─────────────────────────────────────────
if [ -f "stockpulse.env" ]; then
  export $(grep -v '^#' stockpulse.env | xargs) 2>/dev/null
  echo "✓ Loaded config from stockpulse.env"
fi

# Show AI status
if [ -n "$GROQ_API_KEY" ]; then
  echo "✓ AI: Groq (Llama 3.3 — free open-source)"
elif [ -n "$ANTHROPIC_API_KEY" ]; then
  echo "✓ AI: Anthropic Claude"
else
  echo "⚠ AI chat disabled — no API key found"
  echo "  Get a FREE key: https://console.groq.com"
  echo "  Then add  GROQ_API_KEY=gsk_...  to stockpulse.env"
fi

# Show database status
if [ -n "$DATABASE_URL" ]; then
  echo "✓ Database: PostgreSQL (pgvector)"
else
  echo "✓ Database: SQLite (default)"
fi

echo ""

# Kill any leftover server on port 5001
lsof -ti:5001 | xargs kill -9 2>/dev/null
sleep 0.5

echo "Starting backend on http://localhost:5001 ..."
python3 stock-server.py &
SERVER_PID=$!

# Wait for server to be ready (up to 20s)
for i in {1..20}; do
  sleep 1
  if curl -s http://localhost:5001/api/ping >/dev/null 2>&1; then
    echo "✓ Backend ready!"
    break
  fi
  echo "  Waiting... ($i)"
done

echo ""
echo "Opening StockPulse in browser..."
open Stock-tracker.html

echo ""
echo "Server running (PID $SERVER_PID). Close this window to stop."
wait $SERVER_PID

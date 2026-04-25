#!/bin/bash
# StockPulse Launcher — double-click to start
cd "$(dirname "$0")"

echo "╔══════════════════════════════════════╗"
echo "║       StockPulse Backend Server      ║"
echo "╚══════════════════════════════════════╝"

# Kill any leftover server on port 5001
lsof -ti:5001 | xargs kill -9 2>/dev/null
sleep 0.5

echo "Starting backend on http://localhost:5001 ..."
python3 stock-server.py &
SERVER_PID=$!

# Wait for server to be ready
for i in {1..15}; do
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

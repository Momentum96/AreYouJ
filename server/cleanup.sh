#!/bin/bash

# Server cleanup script - kills any lingering Node.js processes on port 5001-5010
echo "🧹 Cleaning up server processes..."

# Kill processes using ports 5001-5010
for port in {5001..5010}; do
  PID=$(lsof -ti:$port)
  if [ ! -z "$PID" ]; then
    echo "   Killing process $PID on port $port"
    kill -9 $PID 2>/dev/null
  fi
done

# Kill any remaining Node.js index.js processes
pkill -f "node.*index.js" 2>/dev/null || true

echo "✅ Cleanup complete"
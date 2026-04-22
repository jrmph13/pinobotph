#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "=== PINO Termux Bootstrap ==="

if ! command -v pkg >/dev/null 2>&1; then
  echo "[ERROR] This script is for Termux (pkg not found)."
  exit 1
fi

echo "[1/5] Updating packages..."
pkg update -y >/dev/null
pkg upgrade -y >/dev/null

echo "[2/5] Installing required packages..."
pkg install -y nodejs-lts git ffmpeg python make clang >/dev/null

echo "[3/5] Installing npm dependencies..."
if [ ! -d node_modules ]; then
  npm install
else
  npm install --prefer-offline
fi

echo "[4/5] Preparing local key file..."
if [ ! -f keys.local.json ] && [ -f keys.local.example.json ]; then
  cp keys.local.example.json keys.local.json
  echo "Created keys.local.json from template. Please insert your test keys."
fi

echo "[5/5] Starting PINO server..."
PORT="${PORT:-3000}"
export PORT

echo ""
echo "PINO will run at:"
echo "  http://127.0.0.1:${PORT}"
echo ""
echo "Tip: keep screen in landscape for kiosk UI."
echo ""

node server.js

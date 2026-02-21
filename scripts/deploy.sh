#!/bin/bash

# Deploy script - builds and installs the app to Applications folder
# Handles the native module version mismatch between Electron and system Node:
#   1. Build TypeScript
#   2. Rebuild better-sqlite3 for Electron
#   3. Package with electron-builder
#   4. Rebuild better-sqlite3 for system Node (so CLI still works)

set -e

APP_NAME="Agents Manager"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$PROJECT_DIR/dist"

cd "$PROJECT_DIR"

echo "🔨 Building TypeScript..."
npm run build

echo "🔧 Rebuilding native modules for Electron..."
npx @electron/rebuild -f -w better-sqlite3

echo "📦 Packaging with electron-builder..."
npx electron-builder --dir

echo "🔧 Rebuilding native modules for system Node (CLI)..."
npm rebuild better-sqlite3

# Find the built app (supports both Intel and Apple Silicon)
if [ -d "$DIST_DIR/mac-arm64/$APP_NAME.app" ]; then
    BUILT_APP="$DIST_DIR/mac-arm64/$APP_NAME.app"
elif [ -d "$DIST_DIR/mac/$APP_NAME.app" ]; then
    BUILT_APP="$DIST_DIR/mac/$APP_NAME.app"
else
    echo "❌ Could not find built app in $DIST_DIR"
    exit 1
fi

echo "📦 Found app at: $BUILT_APP"

# Kill the running app if it exists
echo "🛑 Stopping running instance (if any)..."
pkill -9 -f "Agents Manager" 2>/dev/null || true
pkill -9 -f "com.agents-manager.app" 2>/dev/null || true
pkill -9 -f "dist/mac-arm64/Agents Manager" 2>/dev/null || true
pkill -9 -f "dist/mac/Agents Manager" 2>/dev/null || true
osascript -e 'quit app "Agents Manager"' 2>/dev/null || true
sleep 2

# Copy to Applications
INSTALL_PATH="/Applications/$APP_NAME.app"
echo "📂 Installing to $INSTALL_PATH..."

if [ -d "$INSTALL_PATH" ]; then
    rm -rf "$INSTALL_PATH"
fi

cp -R "$BUILT_APP" "$INSTALL_PATH"

echo "✅ Installed successfully!"
echo ""
echo "📌 To add to Dock (first time only):"
echo "   1. Open Finder → Applications"
echo "   2. Drag '$APP_NAME' to your Dock"
echo ""
echo "🚀 Starting app..."
open "$INSTALL_PATH"

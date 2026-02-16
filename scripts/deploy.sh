#!/bin/bash

# Deploy script - builds and installs the app to Applications folder
# The Dock will automatically use the updated version

set -e

APP_NAME="Agents Manager"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$PROJECT_DIR/dist"

echo "🔨 Building app..."
cd "$PROJECT_DIR"
yarn dist

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
# Kill by app name
pkill -9 -f "Agents Manager" 2>/dev/null || true
# Also kill by bundle identifier
pkill -9 -f "com.agents-manager.app" 2>/dev/null || true
# Kill any Electron process running from dist folder
pkill -9 -f "dist/mac-arm64/Agents Manager" 2>/dev/null || true
pkill -9 -f "dist/mac/Agents Manager" 2>/dev/null || true
# Kill from Applications
osascript -e 'quit app "Agents Manager"' 2>/dev/null || true
sleep 2

# Copy to Applications
INSTALL_PATH="/Applications/$APP_NAME.app"
echo "📂 Installing to $INSTALL_PATH..."

# Remove old version
if [ -d "$INSTALL_PATH" ]; then
    rm -rf "$INSTALL_PATH"
fi

# Copy new version
cp -R "$BUILT_APP" "$INSTALL_PATH"

echo "✅ Installed successfully!"
echo ""
echo "📌 To add to Dock (first time only):"
echo "   1. Open Finder → Applications"
echo "   2. Drag '$APP_NAME' to your Dock"
echo ""
echo "🚀 Starting app..."
open "$INSTALL_PATH"

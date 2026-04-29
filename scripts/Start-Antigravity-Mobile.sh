#!/bin/bash
# Antigravity Mobile Launcher - macOS/Linux
# Make executable: chmod +x Start-Antigravity-Mobile.sh

cd "$(dirname "$0")/.."

echo ""
echo "=========================================="
echo "  Antigravity Mobile Server"
echo "=========================================="
echo ""

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed!"
    echo ""
    echo "Please install Node.js using one of these methods:"
    echo ""
    echo "  macOS (Homebrew):"
    echo "    brew install node"
    echo ""
    echo "  Ubuntu/Debian:"
    echo "    sudo apt update && sudo apt install nodejs npm"
    echo ""
    echo "  Fedora:"
    echo "    sudo dnf install nodejs npm"
    echo ""
    echo "  Or download from: https://nodejs.org/"
    echo ""
    exit 1
fi

echo "Node.js found: $(node --version)"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "First time setup - Installing dependencies..."
    echo "This may take a minute..."
    echo ""
    npm install
    if [ $? -ne 0 ]; then
        echo ""
        echo "ERROR: Failed to install dependencies!"
        exit 1
    fi
    echo ""
    echo "Dependencies installed successfully!"
    echo ""
fi

# Removed interactive cloudflared installation check.

# Removed interactive Security Setup (PIN) for automatic headless startup

echo ""
echo "Starting server..."
echo ""

node src/launcher.mjs

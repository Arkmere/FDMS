#!/bin/bash
# FDMS Development Server Runner
# Pulls latest changes and starts the development server

set -e  # Exit on error

echo "🔄 Fetching latest changes from git..."
git fetch origin claude/review-project-bYiIr

echo ""
echo "🔄 Resetting to latest version - discarding local changes..."
git reset --hard origin/claude/review-project-bYiIr
git clean -fd

echo ""
echo "✅ Reset complete!"
echo ""
echo "🚀 Starting development server on http://localhost:8000"
echo "   Press Ctrl+C to stop the server"
echo ""

cd src
python3 -m http.server 8000

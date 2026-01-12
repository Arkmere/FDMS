#!/bin/bash
# FDMS Development Server Runner
# Pulls latest changes and starts the development server

set -e  # Exit on error

echo "🔄 Pulling latest changes from git..."
git pull origin claude/review-project-bYiIr

echo ""
echo "✅ Git pull complete!"
echo ""
echo "🚀 Starting development server on http://localhost:8000"
echo "   Press Ctrl+C to stop the server"
echo ""

cd src
python3 -m http.server 8000

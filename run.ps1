# FDMS Development Server Runner (PowerShell)
# Pulls latest changes and starts the development server

Write-Host ""
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "   FDMS Development Server" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

# Pull latest changes (force clean pull)
Write-Host "[1/3] Fetching latest changes from git..." -ForegroundColor Yellow
try {
    git fetch origin claude/review-project-bYiIr
    if ($LASTEXITCODE -ne 0) {
        throw "Git fetch failed with exit code $LASTEXITCODE"
    }
    Write-Host "✓ Fetch successful!" -ForegroundColor Green
} catch {
    Write-Host "✗ ERROR: Git fetch failed!" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "[2/3] Resetting to latest version - discarding local changes..." -ForegroundColor Yellow
try {
    git reset --hard origin/claude/review-project-bYiIr
    if ($LASTEXITCODE -ne 0) {
        throw "Git reset failed with exit code $LASTEXITCODE"
    }
    git clean -fd
    if ($LASTEXITCODE -ne 0) {
        throw "Git clean failed with exit code $LASTEXITCODE"
    }
    Write-Host "✓ Reset successful!" -ForegroundColor Green
} catch {
    Write-Host "✗ ERROR: Git reset failed!" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "[3/3] Starting development server..." -ForegroundColor Yellow
Write-Host ""
Write-Host "Server running at: " -NoNewline
Write-Host "http://localhost:8000" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Gray
Write-Host ""

# Start the server
Set-Location src
python -m http.server 8000

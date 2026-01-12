# FDMS Development Server Runner (PowerShell)
# Pulls latest changes and starts the development server

Write-Host ""
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "   FDMS Development Server" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

# Pull latest changes
Write-Host "[1/2] Pulling latest changes from git..." -ForegroundColor Yellow
try {
    git pull origin claude/review-project-bYiIr
    if ($LASTEXITCODE -ne 0) {
        throw "Git pull failed with exit code $LASTEXITCODE"
    }
    Write-Host "✓ Git pull successful!" -ForegroundColor Green
} catch {
    Write-Host "✗ ERROR: Git pull failed!" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "[2/2] Starting development server..." -ForegroundColor Yellow
Write-Host ""
Write-Host "Server running at: " -NoNewline
Write-Host "http://localhost:8000" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Gray
Write-Host ""

# Start the server
Set-Location src
python -m http.server 8000

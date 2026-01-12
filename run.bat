@echo off
REM FDMS Development Server Runner (Windows)
REM Pulls latest changes and starts the development server

echo.
echo ====================================
echo   FDMS Development Server
echo ====================================
echo.

echo [1/3] Fetching latest changes from git...
git fetch origin claude/review-project-bYiIr

if errorlevel 1 (
    echo.
    echo ERROR: Git fetch failed!
    echo Please check your git configuration and try again.
    pause
    exit /b 1
)

echo.
echo [2/3] Resetting to latest version - discarding local changes...
git reset --hard origin/claude/review-project-bYiIr
git clean -fd

if errorlevel 1 (
    echo.
    echo ERROR: Git reset failed!
    pause
    exit /b 1
)

echo.
echo [3/3] Starting development server...
echo.
echo Server running at: http://localhost:8000
echo Press Ctrl+C to stop the server
echo.

cd src
python -m http.server 8000

pause

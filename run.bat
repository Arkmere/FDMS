@echo off
REM FDMS Development Server Runner (Windows)
REM Pulls latest changes and starts the development server

echo.
echo ====================================
echo   FDMS Development Server
echo ====================================
echo.

echo [1/2] Pulling latest changes from git...
git pull origin claude/review-project-bYiIr

if errorlevel 1 (
    echo.
    echo ERROR: Git pull failed!
    echo Please check your git configuration and try again.
    pause
    exit /b 1
)

echo.
echo [2/2] Starting development server...
echo.
echo Server running at: http://localhost:8000
echo Press Ctrl+C to stop the server
echo.

cd src
python -m http.server 8000

pause

# FDMS Development Setup

## Quick Start

This project includes runner scripts that automatically pull the latest changes and start the development server.

### Windows Users

**Option 1: PowerShell (Recommended)**
```powershell
.\run.ps1
```

**Option 2: Batch File**
```cmd
run.bat
```

Or simply **double-click** `run.bat` or `run.ps1` in File Explorer.

> **Note**: If PowerShell script is blocked, you may need to run:
> ```powershell
> Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
> ```

### Linux/Mac Users

```bash
./run.sh
```

## What the Scripts Do

1. **Pull latest changes** from `claude/review-project-bYiIr` branch
2. **Start HTTP server** on `http://localhost:8000`
3. **Navigate to browser**: Open http://localhost:8000 to view the app

## Manual Steps (if scripts don't work)

```bash
# 1. Pull latest changes
git pull origin claude/review-project-bYiIr

# 2. Navigate to src directory
cd src

# 3. Start server
python -m http.server 8000  # or python3 on Linux/Mac

# 4. Open browser to http://localhost:8000
```

## Troubleshooting

### "Python is not recognized"
- Install Python from https://www.python.org/downloads/
- Make sure to check "Add Python to PATH" during installation

### "Git pull failed"
- Make sure you're in the correct directory (FDMS root folder)
- Check that you have the branch: `git branch -a`
- Try: `git fetch origin` then run the script again

### Port 8000 already in use
- Kill the existing server (Ctrl+C in the terminal)
- Or change the port in the script: `python -m http.server 8001`

## Development Workflow

1. **Run script** → Automatically pulls latest code and starts server
2. **Make changes** (if needed)
3. **Refresh browser** (Ctrl+F5 to clear cache)
4. **Stop server** with Ctrl+C when done
5. **Repeat** when new updates are available

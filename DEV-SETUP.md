# FDMS Development Setup

FDMS Lite is a **standalone desktop application** (Windows + Linux) using **web UI technologies** (HTML/CSS/JS). The runner scripts below start a **local server harness** that serves `src/` so the UI can be loaded in a browser locally. This is a development/runtime convenience and **not** a hosted web product.

## Quick Start

This project includes runner scripts that automatically pull the latest changes and start the local server harness.

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

1. **Fetch latest changes** from `claude/review-project-bYiIr` branch
2. **Reset to remote version** (automatically discards any local changes) — this is a **developer convenience** and **not** the intended end-user update mechanism
3. **Start local server harness** on `http://localhost:8000`
4. **Open browser** to http://localhost:8000 to load the desktop UI locally

> **Note**: The scripts will automatically discard any local changes and use the latest version from the specified branch. This is intentional for developer testing workflow.

## Manual Steps (if scripts don't work)

```bash
# 1. Pull latest changes
git pull origin claude/review-project-bYiIr

# 2. Navigate to src directory
cd src

# 3. Start local server harness
python -m http.server 8000  # or python3 on Linux/Mac

# 4. Open browser to http://localhost:8000 to load the desktop UI locally
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

1. **Run script** → Automatically pulls latest code and starts local server harness
2. **Make changes** (if needed)
3. **Refresh browser** (Ctrl+F5 to clear cache)
4. **Stop server** with Ctrl+C when done
5. **Repeat** when new updates are available

---

## Regression Tests (developer QA tooling — end users do NOT need this)

Playwright regression scripts are located in the repo root (`sprint4_formation_verify.mjs`, etc.). They require Node.js and are **developer-only tooling**; end users of FDMS Lite do not need Node or Playwright.

### First-time setup

```bash
# From repo root
npm ci
npx playwright install chromium
```

### Run a suite

```bash
npm run test:s4   # Sprint 4 Formation v1 regression (10 tests)
npm run test:s5   # Sprint 5 Formations v1.1 regression (12 tests)
npm run test:s6   # Sprint 6 LOC formation parity (6 tests)
```

Or directly with Node:

```bash
node sprint6_loc_formation_verify.mjs
```

> **Note**: Tests require the local server harness to be running first (`python -m http.server 8000` from `src/`, or one of the `run.*` scripts). The default test port is `8765`; check each script's `APP_URL` constant if you use a different port.

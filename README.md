# Vectair Flite

Vectair Flite is a desktop-local flight data management tool for aviation and ATC-style administrative strip management.

It was previously referred to during development as FDMS, FDMS Lite, Vectair FDMS, or Vectair FDMS Lite. Those names refer to the same product unless a document explicitly distinguishes them.

Vectair Flite is not a hosted web application. It uses HTML, CSS, and JavaScript internally, and is packaged as a desktop application using Tauri.

The V1 target is a local, offline-capable desktop application for single-operator use.

## Key features

- **Live Board** — strip-based flight data management for DEP, ARR, LOC, and OVR movements with full lifecycle (Planned → Active → Completed).
- **Create From** — contextual strip creation workflow for duplicating, reciprocating, and cross-type strip creation.
- **Weather / METAR Builder** — structured offline METAR/SPECI drafting aid.
  - Offline/manual-input workflow; does not fetch live weather.
  - CAP 746-guided validation; Copy is blocked until all mandatory fields are valid.
  - Civilian and Military reporting modes.
  - Admin-configurable optional sections: RVR, Recent Weather, Wind Shear, Runway State, Colour State.
- **Formations** — multi-aircraft formation management with per-element lifecycle, WTC, and movement tracking.
- **Calendar** — booking and movement calendar for scheduling.
- **History Retrieval** — strip board, calendar, and search/table views of completed movements.
- **Reports** — Monthly Return, Dashboard, Insights, and Cancellation Report with CSV/XLSX export.
- **Booking** — visitor and flight booking management with strip-link integration.
- **Admin** — configuration for movements, exports, history filters, in-app updates, and weather settings.

---

## Current architecture

```text
src/                    Static frontend application
src/index.html           Application shell; loads js/app.js
src/js/                  Application modules
src/css/                 Styling
src/data/                Bundled CSV reference data / VKB packs
src/lib/                 Vendored browser libraries, including SheetJS
src-tauri/               Tauri desktop shell
docs/                    Productization, audit, and project documentation
STATE.md                 Project continuity and current engineering state

The application entry point is:

src/index.html

That file loads:

src/js/app.js

The Tauri desktop wrapper is configured under:

src-tauri/
Development run: Tauri desktop mode

Tauri development mode currently loads the frontend from a local development server.

Start the frontend server first:

cd C:\Users\dmshs\FDMS
python -m http.server 8000 --directory src

In a second terminal, start Tauri:

cd C:\Users\dmshs\FDMS
npm run tauri:dev

Equivalent direct command:

cargo tauri dev

If the Python server is not running, the Tauri development window may show a connection error or blank page because tauri.conf.json currently points development mode at:

http://localhost:8000
Browser-only development harness

The frontend can also be run directly in a browser for frontend-only testing:

cd C:\Users\dmshs\FDMS
python -m http.server 8000 --directory src

Then open:

http://localhost:8000/

The browser-only harness is useful for fast frontend testing, but it does not exercise Tauri-native behaviour such as native Save As export dialogs.

Release build

Build the desktop release with:

cd C:\Users\dmshs\FDMS
npm run tauri:build

Equivalent direct command:

cargo tauri build

The release build uses:

src-tauri/tauri.conf.json

The current Tauri configuration uses:

frontendDist: "../src"

That means the release build bundles the static frontend from src/ directly.

The Python development server is not required for the release build or for the installed runtime.

Release build outputs are generated under:

src-tauri/target/release/bundle/

The exact installer or package format depends on the target platform and Tauri build configuration.

Local development reinstall

`scripts/install-latest-dev-build.ps1` is a convenience script for Stuart / internal development use only.

It automates the full cycle of pulling the latest `main`, building the NSIS installer, and running it — so you do not have to manually execute each step or hunt for the newest `.exe` in the build output directory.

```powershell
# From repo root (or any directory — the script resolves the repo root automatically):
.\scripts\install-latest-dev-build.ps1

# Skip the git checkout/pull if you want to build from an existing working tree:
.\scripts\install-latest-dev-build.ps1 -SkipGitUpdate

# Allow building from a dirty working tree:
.\scripts\install-latest-dev-build.ps1 -AllowDirty

# Supply signing credentials interactively (required because createUpdaterArtifacts is enabled):
.\scripts\install-latest-dev-build.ps1 -PromptForSigningPassword
```

Important distinctions:

- This script installs from a locally built NSIS installer. It does **not** publish a release and does **not** update the app via GitHub Releases.
- True in-app updates (the Tauri updater, accessible from Admin → System Status → Updates) require signed release artifacts and a published `latest.json` at the configured updater endpoint. That flow is entirely separate from this script.
- Because Windows enforces version ordering for installers, downgrading from a previously installed `1.0.x` build (such as `1.0.3`) to `0.9.0` requires a manual uninstall first: `Apps & features → Vectair Flite → Uninstall`.

Offline operation

Vectair Flite V1 is intended to support offline-capable desktop use.

Key offline dependencies are bundled locally:

src/lib/xlsx.full.min.js
src/data/

SheetJS is vendored locally at:

src/lib/xlsx.full.min.js

XLSX export relies on the browser global:

window.XLSX

CSV reference data and VKB-style local reference packs are bundled under:

src/data/

No CDN should be required for ordinary V1 operation.

Some registry or lookup links may intentionally open external websites. Those are external reference conveniences, not core offline runtime dependencies.

Persistence and backup

Vectair Flite V1 stores data locally in the desktop WebView/browser localStorage profile.

Important implication:

Development browser mode, Tauri development mode, and packaged release builds may use different storage origins. Data entered in one environment may not automatically appear in another.

Backups should be exported before moving between development browser, Tauri dev, packaged release, machines, or app profiles.

A V1 backup includes movements, configuration, cancelled sorties, deleted strips, booking profiles, calendar events, and hours log data.

The V1 localStorage keys covered by Admin backup/restore are:

vectair_fdms_movements_v3
vectair_fdms_config
vectair_fdms_cancelled_sorties_v1
vectair_fdms_deleted_strips_v1
fdms_booking_profiles_v1
vectair_fdms_calendar_events_v1
vectair_fdms_hours_v1

Use Admin → Session Management → Backup to JSON to export a backup. Use Admin → Danger Zone → Restore from JSON to import a previous backup. Reload the app after restoring.

A SQLite or local database persistence layer is a future/V2 item unless promoted due to a concrete V1 release-blocking storage issue.

Export behaviour

In the Tauri desktop application, CSV and XLSX exports should use native Save As behaviour where implemented.

In the browser-only harness, exports may fall back to browser download behaviour.

Native export handling is routed through the existing export utility layer and Tauri commands. Static frontend files should not directly import Tauri JavaScript packages such as:

@tauri-apps/plugin-dialog
@tauri-apps/plugin-fs

Those package imports are not safe in the current unbundled static frontend architecture.

In-app updates

Vectair Flite includes a manual, operator-initiated update mechanism accessible from Admin → System Status → Updates.

Key policies:

- Update checking is initiated by the operator only. The app never checks for updates at launch or in the background.
- No update is installed without operator action. There is no auto-install.
- No update prompt blocks operational use. Live Board and all other features remain fully available during or after an update check.
- The app remains fully usable offline. A failed or unreachable update check degrades cleanly and shows a status message.

To check for updates:

1. Open Admin → System Status.
2. In the Updates panel, click Check for updates.
3. If an update is available, click Download and install update.
4. After installation, click Restart Flite to apply the update.

It is recommended to take an Admin → Session Management backup before installing a major update.

Release maintainers:

- Signed installer artifacts and a valid latest.json must be published alongside each GitHub Release for the update mechanism to deliver updates.
- The private signing key (C:\Users\dmshs\.tauri\vectair-flite.key) must not be committed to the repository.
- The public key is embedded in src-tauri/tauri.conf.json and is safe to commit.
- The TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD environment variables must be set for release builds that produce signed updater artifacts.

Current project status

Vectair Flite is in Desktop Productization / V1 closeout.

The project is not yet release-ready.

The current engineering and productization state is tracked in:

STATE.md

The desktop productization audit is recorded in:

docs/DESKTOP_PRODUCTIZATION_AUDIT.md
Working model

Project roles:

Stuart      Product Owner / SME / manual smoke tester
ChatGPT     Solutions Architect / QA Lead / documentation owner
Claude Code Production Engineer / implementer

STATE.md is the continuity anchor.

Implementation work should be defined as precise tickets. Claude Code should implement specific tickets and should not be asked to infer product direction, diagnose architecture, or choose roadmap priorities independently.


---

# STATE.md section 6 replacement

Replace the existing section 6 with this, adjusting only if DP-04 has not yet been merged:

````markdown
## 6. Current active engineering priority

### 6.1 Immediate next item

```text
DP-06 — Enable and smoke-test CSP after SheetJS is vendored

DP-03 — Vendor SheetJS for offline operation is complete.

DP-04 — package.json identity and Tauri dev/build scripts is complete.

DP-05 — README / Getting Started rewrite for desktop launch and release build is complete once the README and this STATE.md section have been updated.

6.2 Next productization sequence

After DP-05, continue the desktop productization closeout sequence:

DP-06 — Enable and smoke-test CSP after SheetJS is vendored
DP-07 — Confirm and document Admin backup/restore coverage for all localStorage keys
DP-08 — First full release build smoke test on Windows

If DP-08 reveals release-build or packaging issues, those productization defects take priority over feature continuation.

6.3 Remaining V1 sequence

After the immediate desktop productization closeout items, the remaining V1 work is:

Create From workflow
METAR Builder
H6 History polish / integration closeout
Installation / Update / Backup / Troubleshooting documentation
Final V1 regression and acceptance sweep
6.4 Reporting invariants

Monthly Return, Dashboard, and Insights retain the nominal strip-type reporting model unless explicitly redesigned:

LOC = 2
DEP = 1
ARR = 1
OVR = 0
T&G = +2
O/S = +1

Live Board daily counters remain separate and event-based / EGOW-realized.

OVR is excluded from runway movement totals and counted separately.


---

# Commit after manual edit

After saving both files:

```powershell
cd C:\Users\dmshs\FDMS
git status
git diff -- README.md STATE.md
git add README.md STATE.md
git commit -m "Update README for desktop productization"
git push origin main
```

If you are not on `main`, do not push until you confirm the branch strategy. The cleanest route is usually:

```powershell
git checkout main
git pull
```

Then apply the README/STATE edits on `main`, commit, and push.

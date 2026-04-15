# Desktop Productization Discovery — Vectair Flite

**Ticket:** DP-01
**Date:** 2026-03-30
**Baseline commit:** `7a7c36a1241fa42e9aa19f184dca946dedca6c6f`
**Branch:** `baseline/pre-desktop-productization`
**Tag:** `flite-pre-desktop-baseline-2026-03`
**Status:** Discovery complete. No functional changes made.

---

## 1. Runtime Recommendation

### Candidates evaluated

#### Tauri (recommended)

Tauri wraps an existing HTML/JS/CSS frontend in a native shell using the OS webview (WebView2 on Windows, WebKitGTK on Linux). The Rust core handles OS integration: file system, IPC, auto-update, signing, crash reporting.

**Strengths for Flite:**

- Zero dependency production app — the existing vanilla JS, CSS, and HTML require no build system changes to load inside a Tauri webview.
- Binary size is small (typically 3–8 MB installed on Windows; no bundled Chromium or Node.js runtime).
- Tauri's `fs`, `dialog`, and `shell` Rust plugin APIs map cleanly onto the four browser coupling points that require replacement (Blob downloads, FileReader imports, `fetch()` CSV loads, SheetJS CDN).
- Auto-update is first-class via `tauri-plugin-updater`, using a GitHub Releases JSON feed — compatible with the intended GitHub-based release discipline.
- Code signing for Windows (Authenticode) and Linux (AppImage signing) is handled within the Tauri build pipeline.
- Tauri's Content Security Policy defaults eliminate the CDN risk surface (SheetJS must be bundled, which is correct behaviour regardless of runtime choice).
- The `window.__FDMS_DIAGNOSTICS__` / `window.__fdmsDiag` instrumentation surface is fully preserved in the webview context.

**Weaknesses / risks:**

- Requires Rust toolchain in the build environment (CI setup cost, not runtime cost).
- OS webview differences (WebView2 vs WebKitGTK vs Safari on macOS) require baseline smoke-testing per platform. For V1 Windows + Linux scope this is manageable.
- The Tauri IPC bridge adds a thin async layer when calling OS APIs from JS. This is straightforward for the file-save/load operations in scope.

#### Electron (fallback)

Electron bundles Chromium and Node.js, giving a fully controlled browser environment at the cost of large installers (typically 80–150 MB) and higher memory use.

**Why Electron is not recommended for V1:**

- Installer size is a significant UX regression for an ATC tool that may be deployed on locked-down airport workstations with limited disk access or download bandwidth.
- No material benefit over Tauri for this app: the app is vanilla JS with zero npm dependencies, so Node.js access provides nothing that Tauri's Rust plugins do not.
- Auto-update (electron-updater), code signing, and packaging are all solvable in Electron but require additional npm toolchain complexity that Tauri avoids.
- Electron is the correct fallback if any blocking webview compatibility issue is found during DP-02 scaffolding — particularly if Windows Server / older WebView2 constraints appear on target hardware.

### Recommendation

**Primary: Tauri.**
Fallback: Electron, triggered only if a concrete WebView2 compatibility blocker is confirmed during DP-02 scaffold validation.

### Blocking unknowns to resolve in DP-02

| Unknown | Risk | Resolution method |
|---|---|---|
| Minimum WebView2 version on target Windows machines | Medium | Confirm with Stuart; WebView2 is installed automatically since Windows 10 1803+ but may be blocked on locked-down workstations |
| WebKitGTK version on target Linux (if any) | Low | Confirm target Linux distro and version |
| SheetJS usage in production | Low | Audit confirms SheetJS is loaded from CDN in `index.html` but no JS calls found in audit scope; confirm if it is actually used before bundling |
| macOS in V1 scope | Out of scope | Confirm explicitly; if yes, adds notarisation requirement |

---

## 2. Browser / localStorage Coupling Audit

### 2.1 localStorage

All primary data store operations are in `src/js/datamodel.js`. All reads/writes are already guarded with `typeof window === "undefined" || !window.localStorage` checks, indicating the author anticipated a non-browser host context.

| Key | Module | Classification |
|---|---|---|
| `vectair_fdms_movements_v3` | `datamodel.js` | **abstract soon** — primary operational store; replace with durable file-based store in DP-03 |
| `vectair_fdms_config` | `datamodel.js` | **abstract soon** — user settings; maps to a config file in the app data directory |
| `vectair_fdms_bookings_v1` | `stores/bookingsStore.js` | **abstract soon** — booking records linked to strips |
| `vectair_fdms_booking_profiles_v1` | `ui_booking.js` | **abstract soon** — saved booking templates |
| `vectair_fdms_calendar_events_v1` | `ui_booking.js` | **abstract soon** — calendar event data |
| `vectair_fdms_hours_v1` | `reporting.js` | **abstract soon** — daily hours log for monthly return |
| `vectair_fdms_cancelled_sorties` | `datamodel.js` | **abstract soon** — cancelled/aborted flight log |
| `vectair_fdms_deleted_strips` | `datamodel.js` | **abstract soon** — deleted strip audit log |
| `vectair_fdms_generic_overflights` | `datamodel.js` | **abstract soon** — manual FIS counter |
| `vectair_fdms_movements_v2`, `_v1` | `datamodel.js` | **unchanged behind adapter** — legacy keys read once at migration, then removed; no action required |

**Approach:** Introduce a storage adapter interface (`StorageAdapter`) with two implementations — `LocalStorageAdapter` (current, preserved for browser/dev harness) and `TauriFileAdapter` (new, for desktop). The app never calls `localStorage` directly; it calls `StorageAdapter.get/set/remove`. This isolates the coupling to a single file.

### 2.2 File export / download

All five download paths follow the same `Blob → URL.createObjectURL → <a>.click()` pattern.

| Trigger | Module | Filename | Classification |
|---|---|---|---|
| Admin backup JSON | `app.js` (line ~616) | `fdms_backup_YYYYMMDD_HHMMZ.json` | **replace during productization** |
| Booking profiles export | `ui_booking.js` (line ~1105) | `fdms_booking_profiles_YYYY-MM-DD.json` | **replace during productization** |
| CSV report download | `reporting.js` (line ~967) | user-specified | **replace during productization** |
| Cancelled sorties CSV | `ui_liveboard.js` (line ~7790) | `fdms-cancelled-sorties-YYYY-MM-DD.csv` | **replace during productization** |
| Movement history CSV | `ui_liveboard.js` (line ~8738) | `fdms-movement-history-YYYY-MM-DD.csv` | **replace during productization** |

**Approach:** Wrap in a `FileExportAdapter`. In the browser, delegates to the existing Blob/createObjectURL pattern. In Tauri, delegates to `@tauri-apps/plugin-fs` `writeFile` + `@tauri-apps/plugin-dialog` `save`. The save dialog gives the user a native picker with a suggested filename — an improvement over the current browser download behaviour.

### 2.3 File import / read

| Trigger | Module | Classification |
|---|---|---|
| Admin restore JSON | `app.js` (line ~647) | **replace during productization** |
| Booking profiles import | `ui_booking.js` (line ~1129) | **replace during productization** |

**Approach:** Wrap in a `FileImportAdapter`. In the browser, delegates to existing `<input type=file>` + FileReader. In Tauri, delegates to `plugin-dialog` `open` (file picker) + `plugin-fs` `readTextFile`. The existing JSON parsing and format-detection logic is unchanged.

### 2.4 VKB CSV data loading

`vkb.js` uses `fetch('./data/*.csv')` to load 7 reference CSV files at startup.

**Classification: replace during productization**

In Tauri, `fetch()` against relative paths works via the asset protocol (`asset://localhost/...`) if the `distDir` is correctly configured. This is the lowest-risk coupling point — configure `tauri.conf.json` correctly and this path requires no code change. If the asset protocol proves problematic, inline the CSVs as JS modules (they are static reference data, not operational data).

### 2.5 CDN dependency

`src/index.html` loads SheetJS from `https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js`.

**Classification: replace during productization**

Tauri's default CSP blocks CDN fetches. SheetJS must be either:
- Downloaded and vendored into `src/js/vendor/` (preferred — pins version, works offline), or
- Removed if confirmed unused.

Audit found no direct JS calls to `XLSX.*` in the audited source files. Confirm usage before vendoring.

### 2.6 Navigator / clipboard

`ui_booking.js` uses `navigator.clipboard.writeText()` with a `document.execCommand('copy')` fallback.

**Classification: unchanged behind adapter**

Clipboard access works in Tauri webviews. No change required. The `execCommand` fallback can remain for resilience.

### 2.7 Window / DOM APIs

`window.innerHeight/Width`, `window.addEventListener('resize')`, `document.createElement`, `document.getElementById`, modal keyboard handling — all DOM/webview APIs that function identically in a Tauri WebView2/WebKitGTK context.

**Classification: unchanged behind adapter** — no action required.

### 2.8 Diagnostics / instrumentation

`window.__FDMS_DIAGNOSTICS__` and `window.__fdmsDiag` counters (`ui_liveboard.js`).

**Classification: unchanged behind adapter** — the global window object is fully available in the Tauri webview. These work without modification.

---

## 3. Target Persistence Model

### Recommended durable store: JSON files in the app data directory

Tauri exposes `app.path().appLocalDataDir()` — a per-user, OS-managed directory:

- Windows: `%APPDATA%\Vectair Flite\` (typically `C:\Users\<user>\AppData\Roaming\Vectair Flite\`)
- Linux: `~/.local/share/vectair-flite/`

**Proposed file layout:**

```
<appLocalDataDir>/
  movements_v3.json          ← primary operational data (replaces vectair_fdms_movements_v3)
  config.json                ← app configuration (replaces vectair_fdms_config)
  bookings_v1.json           ← booking records
  booking_profiles_v1.json   ← booking profile templates
  calendar_events_v1.json    ← calendar events
  hours_v1.json              ← daily hours log
  cancelled_sorties.json     ← cancelled sorties log
  deleted_strips.json        ← deleted strip audit log
  overflights.json           ← FIS counter
  backups/
    fdms_backup_YYYYMMDD_HHMMZ.json   ← auto-backup on launch (rolling, keep last 7)
```

One JSON file per localStorage key — a direct 1:1 migration. No schema change. Existing version migration code (`v1 → v2 → v3`) carries over unchanged.

### Config vs operational data

| Category | Files | Retention |
|---|---|---|
| Operational | `movements_v3.json`, `bookings_v1.json`, `calendar_events_v1.json`, `cancelled_sorties.json`, `deleted_strips.json`, `overflights.json`, `hours_v1.json` | Permanent; user-owned |
| Config | `config.json`, `booking_profiles_v1.json` | Permanent; user-owned |
| Backups | `backups/*.json` | Rolling; last 7 retained automatically |

### Migration path from localStorage

The migration runs once on first desktop launch:

1. On startup, `TauriFileAdapter` checks whether `movements_v3.json` exists in appLocalDataDir.
2. If not, it injects a migration path: attempt to read `vectair_fdms_movements_v3` from `localStorage` (via the Tauri webview's localStorage, which is initially empty on desktop) — if empty, check for a user-supplied import file.
3. Since the webview localStorage is a clean context, the migration path is: present the user with a one-time "Import your existing data" prompt, directing them to first export a backup from the browser session and import it on first desktop launch.
4. The existing backup/restore import path (`app.js` restore flow) handles the JSON envelope format already. No new schema work required.

This is the safest migration: no attempt to read browser localStorage from the desktop app (isolated contexts), clean user-driven handoff.

### Backup and export

- Auto-backup on launch: before writing any data, copy the current `movements_v3.json` to `backups/fdms_backup_YYYYMMDD_HHMMZ.json`. Keep last 7. This replaces the manual-only backup in the browser version.
- Manual export: the existing Admin → Backup flow is preserved, now writing to a user-chosen path via the native save dialog.
- The JSON envelope format is unchanged — browser and desktop exports remain interchangeable.

### Corruption and failure recovery

- All writes atomic: write to `<filename>.tmp`, then rename to `<filename>` (Tauri fs supports this pattern).
- On read failure (parse error or missing file), fall back to the most recent backup in `backups/`. Surface a recoverable-error toast to the user.
- On catastrophic loss (no backups, no exports), the existing "blank state" initialisation path handles graceful empty-start.

---

## 4. Packaging / Update / Signing / Logging Plan

### Windows packaging

| Decision | Choice | Rationale |
|---|---|---|
| Installer format | NSIS (`.exe`) + optional MSI via Tauri | NSIS is Tauri's default; MSI available for enterprise/GPO deployment if required |
| Installation scope | Per-user (no admin required) by default | Reduces friction on workstations with restricted permissions |
| App data location | `%APPDATA%\Vectair Flite\` | Standard per-user path; no admin write required |
| Target platform | Windows 10 1803+ (WebView2 pre-installed) | Covers all plausible airport workstation targets; older machines may need WebView2 bootstrapper |
| WebView2 distribution | Evergreen (auto-managed by OS) for V1; fixed-version bootstrapper as fallback | Evergreen reduces installer size; fixed version gives controlled environment if needed |

### Linux packaging

| Decision | Choice | Rationale |
|---|---|---|
| Installer format | AppImage (`.AppImage`) | Self-contained, no root required, runs on any modern x86-64 Linux distro |
| Secondary format | `.deb` (Tauri builds both) | For Debian/Ubuntu users who prefer system package management |
| App data location | `~/.local/share/vectair-flite/` | XDG standard |

### GitHub-based updater (V1)

Tauri's `tauri-plugin-updater` checks a GitHub Releases JSON endpoint for update availability.

**V1 update strategy:**

1. Release on GitHub as a tagged release (`vectair-flite-v1.x.y`).
2. Tauri updater checks the latest release JSON feed on app launch (with a 24-hour cooldown).
3. User is shown a non-blocking notification: "Version X.Y.Z available — update now or later."
4. Update downloads in the background, installs on next restart (no in-session disruption).
5. Update signature verification is mandatory (Tauri requires it; private key held by maintainer).

**Migration compatibility rule:** A release is only promoted to the update feed after passing the full baseline smoke-test checklist (`BASELINE_SMOKE_TEST_CHECKLIST.md`). No automatic promotion of pre-release builds.

### Code signing

| Platform | Mechanism | V1 plan |
|---|---|---|
| Windows | Authenticode (EV or OV certificate) | Required to avoid SmartScreen "Unknown Publisher" warning. OV certificate via a CA (Sectigo, DigiCert) is sufficient for V1. EV if on-site deployment requires it. |
| Linux | AppImage signature via `appimagetool` | Optional for V1; include if distribution via a software centre requires it |

Signing keys and certificate storage: outside repository scope (Stuart to manage via CI secrets).

### Crash and error logging

**V1 approach: local log file only.**

| Item | Decision |
|---|---|
| Log location | `<appLocalDataDir>/logs/flite.log` (rolling, max 5 MB, keep last 3) |
| Log content | Timestamps, unhandled JS exceptions (currently surfaced via `window.addEventListener('error')`), Tauri-side panics, update events |
| Export | Admin panel "Export Log" button — uses the same save-dialog adapter as other exports |
| Crash reporting | No remote telemetry in V1; local log is the primary diagnostic tool |
| Format | Plain text line-per-event with ISO timestamp; structured JSON lines as V2 enhancement |

The existing `window.addEventListener('error')` and `window.addEventListener('unhandledrejection')` handlers in `app.js` are wired to a toast notification. For desktop, additionally route these to a Tauri IPC call that appends to the log file.

### Release discipline

1. All releases cut from a named release branch (`release/vX.Y.Z`).
2. Smoke test checklist must pass before tagging.
3. GitHub Release created with NSIS installer, AppImage, and update manifest JSON attached.
4. Update feed updated only after release is verified.
5. Previous release remains available for manual rollback (GitHub keeps all release assets).

---

## 5. Implementation Tranche Recommendation

The following tickets are proposed in dependency order. None of these begin until DP-01 is accepted.

| Ticket | Title | Scope | Dependency |
|---|---|---|---|
| **DP-02** | Tauri scaffold + WebView2 validation | Add `src-tauri/` skeleton; confirm app loads in Tauri dev mode; validate WebView2 on target Windows; smoke-test all 12 checklist items inside the webview. No behavioral changes. | DP-01 accepted |
| **DP-03** | Storage adapter layer | Introduce `StorageAdapter` interface; implement `LocalStorageAdapter` (existing behavior, unchanged); implement `TauriFileAdapter` (JSON files in appLocalDataDir); wire datamodel.js, bookingsStore.js, reporting.js behind the adapter. Smoke-test migration prompt on first desktop launch. | DP-02 validated |
| **DP-04** | File export/import adapter + CDN elimination | Replace Blob/createObjectURL download paths with `FileExportAdapter`; replace FileReader import paths with `FileImportAdapter`; vendor or confirm-and-remove SheetJS; confirm VKB CSV load via asset protocol. | DP-03 complete |
| **DP-05** | Auto-backup, crash logging, and update plumbing | Implement rolling auto-backup on launch; wire error handlers to local log file via IPC; integrate `tauri-plugin-updater` with GitHub Releases feed. | DP-04 complete |
| **DP-06** | Packaging, signing, and release pipeline | Configure NSIS + AppImage builds in CI; add code-signing pipeline (certificate placeholder); produce first installable build; run full smoke-test checklist on the built installer. | DP-05 complete |

---

## 6. Files Inspected

| File | Inspection purpose |
|---|---|
| `src/index.html` | CDN dependencies, script loading order |
| `src/js/app.js` | Bootstrap lifecycle, backup/restore export/import, error handlers |
| `src/js/datamodel.js` | All localStorage keys, schema migration paths, storage guards |
| `src/js/reporting.js` | CSV export, hours localStorage key |
| `src/js/ui_booking.js` | Booking profiles export/import, clipboard usage, localStorage keys |
| `src/js/ui_liveboard.js` | DOM coupling, window APIs, CSV export paths, diagnostics |
| `src/js/vkb.js` | fetch() CSV loading |
| `src/js/services/bookingSync.js` | Referential integrity, custom event dispatch |
| `src/js/stores/bookingsStore.js` | Bookings localStorage key |
| `package.json` | Dependency surface (dev tooling only; zero production deps confirmed) |
| `docs/TIMING.md`, `docs/STRIP_LIFECYCLE_AND_COUNTERS.md`, `docs/FORMATIONS.md` | Behavioral reference |
| `BASELINE_PRE_DESKTOP_PRODUCTIZATION.md` | Baseline reference |
| `BASELINE_SMOKE_TEST_CHECKLIST.md` | Acceptance criteria reference |

---

## 7. Confirmation: No Behavioral Changes

This document is discovery output only. The following were not touched:

- No JS, HTML, or CSS files modified.
- No localStorage behavior changed.
- No Tauri or Electron scaffolding added.
- No lifecycle, timing, or reporting semantics altered.
- No Ticket 6b behavior touched.
- No files renamed.
- STATE.md updated additively only.

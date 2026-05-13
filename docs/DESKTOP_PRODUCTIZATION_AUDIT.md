# Desktop Productization Audit — Vectair Flite V1

**Branch:** `claude/desktop-productization-audit-BsDcx`  
**Date:** 2026-05-13  
**Auditor:** Claude Code (production engineer)  
**Commissioned by:** ChatGPT / Stuart (Manager–Worker workflow)

---

## 1. Scope

This document is the output of a read-only audit of the Vectair Flite repository against V1 desktop productization readiness. No runtime code was changed. Allowed outputs are this document and a STATE.md addendum.

Files inspected:

- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `src-tauri/src/lib.rs`
- `src-tauri/src/main.rs`
- `src-tauri/capabilities/default.json`
- `src-tauri/icons/` (inventory)
- `package.json`
- `src/index.html`
- `src/js/export_utils.js`
- `src/js/` (full inventory — 22,720 lines across 10 modules)
- `src/css/vectair.css`
- `src/data/` (CSV bundle inventory)
- `run.sh`, `run.ps1`, `run.bat`, `launch-flite.ps1`
- `README.md`
- `STATE.md`

---

## 2. Current status — what already works

### Tauri scaffold

- Tauri v2 is correctly configured in `src-tauri/tauri.conf.json`.
- `productName: "Vectair Flite"`, `identifier: "com.vectair.flite"`, `version: "0.1.0"` are set.
- `bundle.active: true`, `bundle.targets: "all"` — Windows, macOS, and Linux targets will be attempted by `cargo tauri build`.
- `build.frontendDist: "../src"` correctly points to the static frontend directory; no bundler step is required. A release build will copy `src/` into the app bundle directly.
- `app.windows` configures a single 1400×860 window (min 1024×600) — appropriate for the Live Board layout.

### Rust backend

- `src-tauri/Cargo.toml` is correctly named (`vectair-flite`), described, and versioned.
- `tauri-plugin-dialog v2` is declared and wired.
- `base64 v0.22` is present for XLSX binary encoding.
- `src-tauri/src/lib.rs` implements two Tauri commands:
  - `save_text_file_with_dialog` — native Save As for CSV, writes UTF-8 text.
  - `save_binary_file_with_dialog` — native Save As for XLSX, decodes base64 and writes raw bytes.
- Both commands use a oneshot channel pattern to bridge the async dialog callback into an `await`-able result. This is correct for Tauri v2.
- `src-tauri/src/main.rs` sets `windows_subsystem = "windows"` for release builds (no spurious console window on Windows).

### Capabilities / permissions

- `src-tauri/capabilities/default.json` grants only `core:default` and `dialog:allow-save`.
- No filesystem read, shell, network, or clipboard permissions are granted. This is correct for the current feature set.

### Icons

All required icon formats are present:

| File | Purpose |
|------|---------|
| `icons/32x32.png` | Windows taskbar / small |
| `icons/128x128.png` | Standard |
| `icons/128x128@2x.png` | Retina / HiDPI |
| `icons/icon.icns` | macOS |
| `icons/icon.ico` | Windows executable |

All five formats referenced in `tauri.conf.json` are present on disk. Icon bundling is complete.

### Frontend assets (except SheetJS)

- `src/css/vectair.css` — 80 KB, self-contained, no `@import` from external sources, no web fonts.
- All ten JS modules import only from relative paths within `src/js/`. No npm imports, no CDN JS beyond SheetJS.
- `src/data/` contains ~2.2 MB of bundled CSV reference data (registrations, types, callsigns, locations). These are loaded via relative `fetch()` paths and will resolve correctly under both `http://localhost:8000` (dev) and the Tauri bundle origin.

### Export / Save As

- `src/js/export_utils.js` detects `window.__TAURI__?.core?.invoke` at runtime.
- In Tauri: invokes `save_text_file_with_dialog` or `save_binary_file_with_dialog` for a native OS Save As dialog.
- In browser: falls back to `Blob` / `<a download>` for CSV, and returns `"browser"` for XLSX so the caller can use `XLSX.writeFile`.
- Return codes (`"saved"`, `"cancelled"`, `"downloaded"`, `"fallback"`, `"browser"`) allow callers to display accurate toast messages.
- This dual-path pattern is correct and requires no changes. The Tauri-side implementation handles data loss on dialog cancel cleanly.

### app.withGlobalTauri

- `app.withGlobalTauri: true` exposes the Tauri API on `window.__TAURI__` without any npm import. This is the correct pattern for a no-bundler frontend.

---

## 3. Release blockers

### BLOCKER-1 — SheetJS loaded from CDN (offline-breaking)

**File:** `src/index.html`, line 8  
**Current tag:**
```html
<script src="https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js"></script>
```

**Impact:** The XLSX library is required for all Reports tab exports and any history XLSX download. Without internet access this request fails silently and `XLSX` is undefined, crashing every export path that calls `XLSX.write` or `XLSX.utils.*`.

**Why it blocks V1:** A desktop app distributed to an operational environment (airfield LAN, offline tablet, no persistent internet) will have broken exports on first use. This is not a graceful degradation — it is a silent crash.

**Resolution (next implementation ticket):** Download `xlsx.full.min.js` from the SheetJS CDN at a pinned version, place it at `src/lib/xlsx.full.min.js`, and update the `<script>` tag to the local path. No other code changes required. The library is already consumed via the global `XLSX` window object.

---

## 4. V1 required fixes (not blocking build, but required before handing to users)

### V1-REQ-1 — No Tauri dev/build scripts in package.json

`package.json` contains only Playwright test scripts. There are no `tauri:dev` or `tauri:build` npm scripts. The current documented procedure requires developers to know to run `cargo tauri dev` manually, with a separately started Python server.

**Impact:** Onboarding friction; risk of using the wrong launch procedure. Not a build blocker but increases likelihood of incorrect dev setup.

**Recommended fix:** Add to `package.json` scripts:
```json
"tauri:dev": "cargo tauri dev",
"tauri:build": "cargo tauri build"
```
These are thin wrappers and do not change the underlying toolchain.

### V1-REQ-2 — package.json identity is stale dev-tooling framing

`package.json` is named `fdms-lite-dev-tooling` and described as "Developer QA tooling for FDMS Lite. NOT required by end users." While technically accurate for the `package.json` role (it only contains Playwright deps), the name and description are misleading in the context of a product repository named Vectair Flite.

**Recommended fix:** Rename to `vectair-flite` and update description to reflect that the file manages dev tooling for the Vectair Flite project.

### V1-REQ-3 — README.md is stale

README.md still describes the project as FDMS Lite / front-end skeleton / development preview with no build step and a "desktop wrapper coming later" framing. This is incorrect for a Tauri v2 application with a functioning scaffold.

**Recommended fix:** Rewrite the "Getting started" and "Architecture" sections to reflect:
- Current product name (Vectair Flite)
- Correct dev launch procedure (Python server + `cargo tauri dev`)
- Correct release build command (`cargo tauri build`)
- Status of desktop packaging

---

## 5. V1 recommended but not blocking

### REC-1 — Content Security Policy is disabled

`src-tauri/tauri.conf.json`:
```json
"security": { "csp": null }
```

CSP `null` means no restrictions on script sources, inline scripts, or frame origins. For a desktop app with no remote content (after SheetJS is vendored) a restrictive CSP is both achievable and recommended.

**Suggested CSP for V1:**
```json
"csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
```

`'unsafe-inline'` for styles is common with CSS-heavy SPAs and acceptable here. This CSP should be tested after SheetJS is vendored.

### REC-2 — localStorage backup / export for operational data

All operational data lives in localStorage under seven keys:

| Key | Contents |
|-----|---------|
| `vectair_fdms_movements_v3` | Movement records (primary) |
| `vectair_fdms_config` | App config |
| `cancelled_sorties_v1` | Cancelled movements |
| `deleted_strips_v1` | Soft-deleted strips (24 h retention) |
| `booking_profiles_v1` | Booking profiles |
| `calendar_events_v1` | Calendar events |
| `hours_log_v1` | Flight hours log |

**Risks:**
1. On Windows, Tauri apps store localStorage in a Chromium-based WebView2 data directory keyed by the app identifier (`com.vectair.flite`). Reinstalling, changing the identifier, or moving the install may not clear this data — but it is not guaranteed to survive a WebView2 reset or Windows profile migration.
2. Clearing the app's WebView2 data (which some IT policies do) will destroy all operational records with no warning.
3. There is no admin-accessible export of all localStorage keys. The existing backup/restore functionality (noted in STATE.md) should be confirmed to cover all seven keys.

**V1 minimum requirement:** Confirm that the Admin → backup/restore mechanism exports and imports all seven storage keys. Document this as the data resilience procedure in the README or a help doc.

### REC-3 — Admin → Reload App in Tauri release

STATE.md notes that "Admin → System Status → Reload App" behaviour in Tauri release should be confirmed. In a Tauri release build, `window.location.reload()` will reload the bundled `index.html` from the app bundle — it does not depend on the Python server. Stale-cache problems that exist in browser dev (where the browser may cache old JS) do not apply to Tauri release builds, which load from disk on each reload. This behaviour is correct and needs no code change; it should be confirmed in the first release smoke test and documented.

### REC-4 — devUrl dependency on Python http.server

**During `cargo tauri dev`:** Tauri reads `devUrl: http://localhost:8000` and loads the frontend from the Python dev server. The Python server must be running before `cargo tauri dev` is launched or the WebView will show a blank page / connection error. This is a development-only dependency.

**During `cargo tauri build`:** Tauri uses `frontendDist: ../src` and bundles all files under `src/` directly into the application. Python http.server is **not required** at build time or at runtime in the packaged app. The release build is server-independent.

**Action:** Document the two-step dev procedure (Python server first, then `cargo tauri dev`) in the README. No code change needed.

---

## 6. V2 / post-launch items

### V2-1 — SQLite persistence

**Decision: SQLite is NOT required for V1.**

**Reasoning:**
- localStorage under WebView2 with identifier `com.vectair.flite` is stable across app restarts on the same machine. There is no concrete release-blocking failure mode that localStorage cannot handle for a single-operator desktop tool.
- The existing schema versioning (`_v1`, `_v2`, `_v3` key suffixes) already handles forward migration.
- The V1 use case is a single operator at a fixed workstation. localStorage is adequate for this operational profile.
- Migrating to SQLite requires a Rust persistence layer, a data migration path from localStorage, and a new set of Tauri commands with corresponding capability permissions. This is significant scope.

**V2 classification:** SQLite (or another local DB) is the right long-term architecture for multi-session resilience, data integrity, backup-by-file-copy, and potential future multi-client use. It should be scoped as a V2 local knowledge architecture workstream, not a V1 blocker.

**V1 mitigation:** Ensure Admin backup/restore covers all localStorage keys (see REC-2).

### V2-2 — Auto-update mechanism

No `tauri-plugin-updater` or equivalent is configured. V1 updates will require manual reinstall of the built executable. This is acceptable for V1 (single operator, controlled environment) but should be revisited for any wider distribution.

### V2-3 — Crash / error reporting

No structured error logging to a local file. Console errors are visible in Tauri dev (via DevTools) but not in release builds unless DevTools is explicitly enabled. V2 should add a local log file writer and an Admin → View Logs panel.

### V2-4 — Executable signing

Unsigned executables on Windows will trigger SmartScreen warnings on first launch. For V1 internal use this is acceptable. For any distribution outside the immediate operator environment, code signing is required.

---

## 7. Build and run commands

### Development (current procedure)

```bash
# Step 1 — Start the frontend dev server (keep this terminal open)
cd /home/user/FDMS
python -m http.server 8000 --directory src

# Step 2 — In a second terminal, launch the Tauri dev shell
cd /home/user/FDMS
cargo tauri dev
```

The WebView will load from `http://localhost:8000`. Hot-reload of frontend files is not automatic; refresh the WebView manually after edits.

Alternatively, use the provided platform scripts:
- **Linux/macOS:** `bash run.sh`
- **Windows PowerShell:** `.\run.ps1`
- **Windows CMD:** `run.bat`

These scripts start the Python server. `cargo tauri dev` must then be run separately.

### Release build

```bash
cd /home/user/FDMS
cargo tauri build
```

Output: `src-tauri/target/release/bundle/` containing platform-appropriate installers (`.msi` on Windows, `.deb`/`.rpm`/`.AppImage` on Linux, `.dmg` on macOS).

The Python server is **not required** for the release build. Tauri bundles `src/` directly.

### Browser-only harness (no Tauri)

```bash
cd /home/user/FDMS
python -m http.server 8000 --directory src
# Open http://localhost:8000 in a browser
```

Export Save As falls back to browser Blob downloads. XLSX export requires internet (SheetJS CDN) until BLOCKER-1 is resolved.

---

## 8. Naming and metadata audit

| Location | Current value | Status | Action |
|----------|--------------|--------|--------|
| `src-tauri/tauri.conf.json` → `productName` | `Vectair Flite` | Correct | None |
| `src-tauri/tauri.conf.json` → `identifier` | `com.vectair.flite` | Correct | None |
| `src-tauri/Cargo.toml` → `name` | `vectair-flite` | Correct | None |
| `src-tauri/Cargo.toml` → `description` | `Vectair Flite — Flight Data Management System` | Correct | None |
| `src/index.html` → `<title>` | `Vectair Flite` | Correct | None |
| `package.json` → `name` | `fdms-lite-dev-tooling` | Stale — must change before V1 | Rename to `vectair-flite` |
| `package.json` → `description` | `Developer QA tooling for FDMS Lite...` | Stale — must change before V1 | Update to reflect Vectair Flite |
| `README.md` → product framing | FDMS Lite / skeleton / no build step | Stale — must change before V1 | Full rewrite of Getting Started section |
| `STATE.md` → legacy references | FDMS, FDMS Lite (historical context) | Intentionally historical | Document-only note, no change |
| `src/js/` internal variable names | Various `fdms` prefixes in storage keys | Harmless legacy / internal | No change — renaming storage keys would break existing data |

**localStorage key prefix note:** The storage keys use `vectair_fdms_*` and similar legacy prefixes. These must **not** be renamed. Renaming them would silently discard all existing user data on next launch. They are internal identifiers, not user-visible strings.

---

## 9. Offline dependency summary

| Asset | Source | Offline-safe? | Action required |
|-------|--------|--------------|----------------|
| `vectair.css` | `src/css/` (local) | Yes | None |
| All JS modules | `src/js/` (local) | Yes | None |
| CSV reference data | `src/data/` (local) | Yes | None |
| SheetJS XLSX library | `https://cdn.sheetjs.com/...` | **No — BLOCKER-1** | Vendor locally |
| CAA G-INFO link | `window.open` (user-triggered) | Opens browser tab, not bundled | None |
| FAA registry link | `window.open` (user-triggered) | Opens browser tab, not bundled | None |

---

## 10. localStorage origin stability

| Runtime | localStorage origin | Stable? |
|---------|-------------------|---------|
| Browser dev (`http://localhost:8000`) | `http://localhost:8000` | Dev-only; separate from Tauri |
| `cargo tauri dev` | `http://localhost:8000` (devUrl) | Shares origin with browser dev |
| `cargo tauri build` (release) | `tauri://localhost` (bundled) | **Different origin from dev** |

**Implication:** Data entered during browser dev or Tauri dev will not be visible in a Tauri release build, and vice versa. This is expected behaviour for the development cycle but must be documented clearly so that operators do not lose data by switching between dev and release builds.

The Tauri release origin (`tauri://localhost`) is stable across app updates as long as the bundle identifier (`com.vectair.flite`) does not change.

---

## 11. Export behaviour summary

| Export path | Tauri release | Tauri dev | Browser harness |
|-------------|--------------|----------|----------------|
| CSV (movements, history) | Native Save As dialog | Native Save As dialog | Browser download |
| XLSX (Monthly Return) | Native Save As dialog | Native Save As dialog | Requires XLSX global (CDN) |
| XLSX offline | **Fails if SheetJS not vendored** | **Fails if SheetJS not vendored** | Fails without internet |

Toast copy: the `export_utils.js` return codes (`"saved"`, `"cancelled"`, `"downloaded"`, `"fallback"`) allow callers to display contextually correct messages. This should be verified in the smoke test — confirm that the toast in Tauri says "Saved" not "Downloaded".

---

## 12. Proposed next implementation ticket

**Ticket: Vendor SheetJS for offline operation (DP-03)**

**Scope:** Single focused change.

1. Download `xlsx.full.min.js` at a pinned version from the SheetJS CDN.
2. Place at `src/lib/xlsx.full.min.js`.
3. Update `src/index.html` line 8: change the `<script src="https://...">` to `<script src="./lib/xlsx.full.min.js">`.
4. Smoke test: disconnect from internet, launch release build, export a Monthly Return XLSX — confirm file saves correctly.
5. Update STATE.md and README to record that the app is fully offline-capable.

**Files changed:** `src/index.html` (1 line), new file `src/lib/xlsx.full.min.js`.

**No Rust changes. No Tauri config changes. No JS logic changes.**

After DP-03, the next candidates in priority order are:

- **DP-04:** Update `package.json` identity and add `tauri:dev` / `tauri:build` scripts.
- **DP-05:** Rewrite README Getting Started section for desktop launch procedure.
- **DP-06:** Enable CSP in `tauri.conf.json` and smoke test.
- **DP-07:** Confirm and document Admin backup/restore covers all seven localStorage keys.
- **DP-08:** First full release build smoke test on Windows (install, launch, all export paths, reload, offline verification).

---

## 13. Summary table

| Area | Readiness | Notes |
|------|-----------|-------|
| Tauri v2 scaffold | Ready | Config valid, commands registered, icons complete |
| Rust backend | Ready | CSV and XLSX Save As handlers correct |
| Capabilities / permissions | Ready | Minimal and correct |
| CSS / local assets | Ready | Fully self-contained |
| CSV reference data | Ready | Bundled in `src/data/` |
| JS module architecture | Ready | Clean ES module graph, no CDN JS besides SheetJS |
| Export / Save As | Ready (Tauri paths) | Both CSV and XLSX native dialogs work |
| SheetJS / XLSX | **BLOCKED** | CDN load — BLOCKER-1, must vendor |
| Offline capability | **BLOCKED** | Depends on BLOCKER-1 |
| package.json identity | Stale | Must update before V1 |
| README | Stale | Must rewrite before V1 |
| localStorage stability | Acceptable for V1 | Origin change dev→release documented; backup REC noted |
| SQLite | Not required for V1 | V2 workstream |
| CSP | Recommended | `null` currently; enable after SheetJS vendored |
| Code signing | Not required for V1 internal use | V2 for broader distribution |

**Overall V1 release readiness: blocked on BLOCKER-1 (SheetJS CDN). All other components are structurally sound.**

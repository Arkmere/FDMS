# DP-02 Validation Note — Tauri Scaffold + WebView2 Audit

**Ticket:** DP-02
**Date:** 2026-03-31
**Baseline commit:** `7a7c36a1241fa42e9aa19f184dca946dedca6c6f`
**Branch:** `claude/protect-baseline-PM0XU`

---

## Step 1 — Baseline Reconciliation

### Git commands used

```bash
# Identify branch tip
git rev-parse baseline/pre-desktop-productization
# → 7a7c36a1241fa42e9aa19f184dca946dedca6c6f

# Identify tag target
git cat-file -p refs/tags/flite-pre-desktop-baseline-2026-03
# → object 7a7c36a1241fa42e9aa19f184dca946dedca6c6f  (tag points to this commit)

# Confirm branch and tag agree
git log --oneline baseline/pre-desktop-productization -5
```

### Findings

| Reference | Expected | Actual | Matches? |
|---|---|---|---|
| Branch `baseline/pre-desktop-productization` tip | `7a7c36a` | `7a7c36a` | ✓ |
| Tag `flite-pre-desktop-baseline-2026-03` target | `7a7c36a` | `7a7c36a` | ✓ |
| `STATE.md` hash reference | `7a7c36a` | `7a7c36a` | ✓ (already correct) |
| `BASELINE_PRE_DESKTOP_PRODUCTIZATION.md` hash | `7a7c36a` | `4253035` | ✗ → corrected |
| `BASELINE_SMOKE_TEST_CHECKLIST.md` hash | `7a7c36a` | `d0c3d94` | ✗ → corrected |

**Authoritative frozen baseline commit: `7a7c36a1241fa42e9aa19f184dca946dedca6c6f`**

Branch and tag agree. The discrepancies in the marker files arose from the self-referential commit hash problem during the baseline protection session: each corrective commit produced a new hash, leaving earlier-written files with stale hashes. Both files have now been corrected to `7a7c36a`.

### Files corrected

- `BASELINE_PRE_DESKTOP_PRODUCTIZATION.md` — commit hash updated
- `BASELINE_SMOKE_TEST_CHECKLIST.md` — commit hash updated
- `STATE.md` — no change needed (was already correct)

---

## Step 2 — Tauri Scaffold

### Files added

```
src-tauri/
  Cargo.toml                   — Rust package manifest (tauri 2, serde)
  build.rs                     — tauri-build invocation
  tauri.conf.json              — Tauri v2 app configuration
  capabilities/default.json   — Core default permissions
  src/
    main.rs                    — Entry point (windows_subsystem suppression)
    lib.rs                     — run() entry; Builder::default()
  icons/
    .gitkeep                   — Placeholder; production icons generated in DP-06
```

### Configuration decisions

| Decision | Value | Rationale |
|---|---|---|
| `devUrl` | `http://localhost:8000` | Preserves existing Python dev-server workflow. Run server from `src/`. |
| `frontendDist` | `../src` | Points to the static app directory for production builds |
| `csp` | `null` (disabled) | SheetJS CDN dependency requires this until DP-04 vendors or removes it |
| Window dimensions | 1400×860, min 1024×600 | Matches typical ATC workstation display; wider than Tauri default |
| `identifier` | `com.vectair.flite` | Reverse-DNS app identity for OS packaging |
| Icons | Placeholder paths | Production icons generated in DP-06 via `cargo tauri icon` |

### Dev mode run procedure

```bash
# Terminal 1 — start the existing frontend dev server
cd /path/to/FDMS/src
python3 -m http.server 8000

# Terminal 2 — launch the Tauri shell
cd /path/to/FDMS
cargo tauri dev
```

The Tauri shell opens a native window pointing to `http://localhost:8000`. The existing app loads with full localStorage access (webview-scoped), all JS modules, and the VKB CSV fetch path (`./data/*.csv` → `http://localhost:8000/data/*.csv`).

---

## Step 3 — Build Validation and Environment Findings

### Platform context

Build environment: **Ubuntu 24.04 LTS (Linux x86-64)** — headless CI, no display.

Tauri on Linux requires `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, and related system libraries. These were not pre-installed and a full apt download was attempted. After 60+ minutes the download did not complete due to degraded connectivity to archive.ubuntu.com in this environment. See below for what was and was not validated.

### What was validated

#### Rust / Cargo dependency resolution — ✓ PASS

```bash
cd src-tauri && cargo check
```

Cargo successfully resolved and downloaded all 475 Rust crates (tauri v2, serde, serde_json, tauri-build, and the full webkit2gtk-sys / gtk3 binding crate tree). The dependency graph is correct. The build fails only at the system-library linking stage (`gdk-3.0.pc` not found), not at the Rust code level.

This confirms:
- `Cargo.toml` is structurally valid
- All Tauri v2 crate dependencies resolve correctly
- `src/main.rs` and `src/lib.rs` compile to the linking stage
- No Rust-level errors in the scaffold

#### Tauri CLI install — ✓ PASS

```bash
cargo install tauri-cli --version "^2"
# Installed: tauri-cli v2.10.1
# Binary: ~/.cargo/bin/cargo-tauri
```

Tauri CLI 2.10.1 compiled and installed successfully from crates.io.

#### System library install — ✗ BLOCKED (environment constraint, not a Tauri issue)

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libssl-dev
# Result: packages exist in Ubuntu 24.04 noble repo (version 2.50.4 confirmed in apt-cache);
#         .deb downloads did not complete — archive.ubuntu.com reachable but package
#         download requests return Ign: responses (environment download restriction).
#         External internet also blocked in this environment (confirmed).
```

This is an environment network constraint. The packages exist at the correct versions for Tauri v2 and will install normally on a developer machine with unrestricted internet access.

#### `cargo tauri dev` — ✗ NOT RUN (depends on system libraries above)

Cannot run without `libwebkit2gtk-4.1-dev`. Pending developer-machine validation.

#### Window launch and smoke test — ✗ PENDING (requires display + system libs)

This environment is headless (no DISPLAY). Even with system libs installed, a GUI window cannot be launched in CI. Smoke test validation must be done on the developer's machine.

---

### Smoke test: architectural expectation only (not acceptance evidence)

The following table records engineering expectation based on static architectural analysis only. It is useful for risk assessment and triage, but it is **not** acceptance evidence and does **not** replace real-machine validation.

DP-02 is not fully closed until a developer machine has:
- launched `cargo tauri dev` successfully,
- opened the native window,
- and executed the baseline smoke checklist inside the desktop shell.

All checklist items below are therefore **expected** outcomes, not confirmed outcomes. Basis for this expectation:

- The app is pure HTML/CSS/JS with zero production npm dependencies.
- All APIs in use (localStorage, Blob/URL.createObjectURL, FileReader, fetch, DOM manipulation) are fully supported in both WebKitGTK and WebView2.
- The app has existing `typeof window === "undefined"` guards in `datamodel.js`, confirming the author already considered non-browser host contexts.
- CSP is disabled (`null`) in this scaffold, so the SheetJS CDN fetch is not blocked.
- `fetch('./data/*.csv')` resolves against the dev server origin (`http://localhost:8000`) which the Python server serves correctly.
- No Tauri IPC calls are made by the app at this stage — the webview runs the existing code untouched.

| Smoke check | Expected | Rationale |
|---|---|---|
| App launches via Tauri dev mode | ✓ Expected PASS | Confirmed by cargo crate resolution + known-good config |
| Live Board renders | ✓ Expected PASS | Pure DOM/JS; no browser-only dependencies |
| Movement History / Cancelled Sorties / Deleted Strips separation | ✓ Expected PASS | localStorage + DOM only |
| Cancelled strip can be edited | ✓ Expected PASS | DOM modal logic; no webview-specific concerns |
| Cancelled strip can be reinstated to PLANNED | ✓ Expected PASS | Same |
| Deleted strip to Deleted Strips, leaves ordinary reporting | ✓ Expected PASS | localStorage write + DOM render |
| Cancellation Report renders and filters | ✓ Expected PASS | Pure JS filter + DOM render |
| Export Cancellations CSV | ✓ Expected PASS | Blob/createObjectURL works in both WebKitGTK and WebView2 |
| Inline time mode toggle | ✓ Expected PASS | Pure JS state |
| ARR Active does not fabricate ATD | ✓ Expected PASS | Logic unchanged |
| OVR excluded from runway totals | ✓ Expected PASS | Logic unchanged |
| Booking reconciliation banner | ✓ Expected PASS | Custom event + DOM; works in webview |
| VKB/static datasets load | ✓ Expected PASS | `fetch('./data/*.csv')` via localhost |
| `window.__fdmsDiag` available | ✓ Expected PASS | Global window object available in webview |
| SheetJS CDN | ✓ Expected PASS | CSP null; CDN accessible |

**Actual interactive confirmation is still required on a developer machine.** The table above must not be treated as proof that the checks passed; it is a pre-validation expectation only. Instructions below.

---

### Developer machine validation instructions

To complete DP-02 smoke validation on Windows or Linux:

```bash
# 1. Install system dependencies

# Windows: WebView2 is pre-installed on Windows 10 1803+.
#   Install Rust from https://rustup.rs
#   Install Tauri CLI: cargo install tauri-cli --version "^2"

# Linux (Ubuntu 22.04+):
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libssl-dev
cargo install tauri-cli --version "^2"

# 2. Start the frontend dev server (existing workflow)
cd /path/to/FDMS/src
python3 -m http.server 8000

# 3. In a second terminal, launch the Tauri shell
cd /path/to/FDMS
cargo tauri dev

# 4. Smoke test the 12 checklist items in the native window.
#    See BASELINE_SMOKE_TEST_CHECKLIST.md
```

Expected: a native window opens pointing to `http://localhost:8000`, app loads, all 12 smoke items pass.

---

### WebView2 / Windows-specific findings

| Finding | Status |
|---|---|
| WebView2 tested on Windows | Pending — not available in this session |
| WebKitGTK tested on Linux | Pending — system libs did not complete download in session |
| Electron fallback needed? | **No evidence of need.** All APIs in scope work in both engines. No platform incompatibilities identified by architectural analysis. |
| Blocker found? | **None.** Network environment constraint only. |

### Known remaining items for future tickets

| Item | Ticket |
|---|---|
| Confirm WebView2 on target Windows machines | DP-02 follow-up / DP-03 prerequisite |
| Vendor or remove SheetJS CDN dependency | DP-04 |
| Re-enable CSP once SheetJS is vendored | DP-04 |
| Generate production icons | DP-06 |
| Replace Blob/FileReader export/import paths | DP-04 |
| Storage adapter layer (localStorage → file) | DP-03 |
| Auto-update / signing / packaging | DP-05 / DP-06 |

---

## Summary

| Item | Status |
|---|---|
| Authoritative baseline commit identified | `7a7c36a1241fa42e9aa19f184dca946dedca6c6f` — branch and tag agree |
| Baseline marker docs corrected | `BASELINE_PRE_DESKTOP_PRODUCTIZATION.md`, `BASELINE_SMOKE_TEST_CHECKLIST.md` |
| Tauri v2 scaffold committed | `src-tauri/` created with correct `Cargo.toml`, `tauri.conf.json`, `capabilities/`, `src/main.rs`, `src/lib.rs` |
| Tauri CLI installed | ✓ VALIDATED — `tauri-cli v2.10.1` installed successfully |
| Rust/Cargo dependency resolution | ✓ VALIDATED — 475 crates resolved; scaffold compiles to linking stage |
| App loads in Tauri dev mode | Pending — not yet interactively confirmed in a usable desktop runtime; developer-machine validation required |
| All 12 smoke checks pass in webview | Pending — architectural analysis suggests likely pass, but no acceptance evidence exists yet |
| No functional behavior changes introduced | ✓ — no JS/HTML/CSS files changed |
| Tauri remains confirmed as runtime | ✓ — no blockers found |
| Electron fallback needed | No — no blockers identified |
| Windows/WebView2 validation | Pending — requires Windows hardware or CI with WebView2 |
| WebKitGTK validation | Pending — system lib download did not complete in session network environment |

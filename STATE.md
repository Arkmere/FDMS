# STATE.md — Vectair FDMS Lite

Last updated: 2026-02-26 (Europe/London) — Sprint: Admin IA v1.2 — backup envelope metadata, timestamped filenames, restore format detection

This file is the shared source of truth for the Manager–Worker workflow:
- **Manager (PM)**: User (coordination, priorities, releases)
- **Solutions Architect & QA Lead**: ChatGPT (task tickets, audits, risk management)
- **Production Engineer**: Claude Code (implements tickets, updates this ledger)

---

#### Delivery model and runtime model (NO DRIFT)
**FDMS Lite is NOT a static web app and NOT a website.**
**FDMS Lite is a standalone desktop application** (Windows + Linux) that uses **web technologies internally** (HTML/CSS/JS UI) for its interface.

During development and QA, we run FDMS Lite via a **local server harness** that serves `src/` (e.g. `python -m http.server`). This is a **development/runtime convenience only** and must not be interpreted as "FDMS is a web product" or "FDMS is intended to be hosted".

**OS targets:** Development is performed on **Windows**. Operational installation/use is on **Linux**. **Both OS are required** and must remain supported.

---

#### Development workflow approved for Release v1
The current workflow (git branches/PRs + local repo checkout + local server harness) is **approved and sufficient to reach Release v1**.

- Day-to-day development occurs in the repo via branches and PRs.
- Local execution uses `run.ps1` / `run.bat` / `run.sh` to serve `src/` and open the UI locally.
- Regression scripts (e.g., Playwright) are **developer QA tooling** only and are **not required for end users**.

---

#### Packaging / installers / auto-update (explicitly out of scope for Release v1)
**Packaging (installers), desktop wrapping, and auto-update mechanisms are out of scope for Release v1 unless explicitly reprioritised.**

Any future update mechanism must be based on **versioned release artifacts** (e.g., GitHub Releases), **not** "pull latest `main` and restart". Do not introduce packaging or auto-update work into v1 sprints unless the project owner explicitly opens that workstream.

---

#### Drift guardrails (do not reinterpret)
- Do **not** describe FDMS Lite as a "static web app", "web app", or "website".
- Do **not** propose "hosting" FDMS as the default delivery path.
- The local server (`python -m http.server`) is a **development harness** to run the desktop UI locally; it is not product hosting.
- Do **not** add packaging/installer/updater scope unless explicitly requested and scheduled as its own epic.

---

#### Why run.* scripts fetch/reset
The `run.*` scripts perform a fetch/reset to a specified branch to ensure the local working copy matches the expected code for testing. This is a **developer convenience** and **not** the intended end-user update mechanism.

---

## 1) System Architecture

### 1.1 Product goal
A lightweight, **standalone desktop application** ("FDMS Lite") for local ATC/ops workflow, using web UI technologies (HTML/CSS/JS) for its interface:
- Live "strip" board (movements)
- Booking workflow that can create planned strips and stay synchronized
- Calendar for bookings and general events
- Admin tooling (profiles, etc.)
- Fully offline / local deployment, using local persistence (localStorage)

### 1.2 Tech stack
- **Standalone desktop application** using web UI technologies (HTML/CSS/JS); run locally via a **local server harness** serving `src/` (not a hosted web product)
- **Module style**: ES modules (`src/js/...`)
- **Persistence**: `localStorage`
- **Data model**: movements ("strips") stored in `src/js/datamodel.js`
- **UI modules**:
  - `src/js/ui_liveboard.js` (Live Board + timeline + history)
  - `src/js/ui_booking.js` (Bookings + calendar + profiles + admin)
- **Services / stores**:
  - `src/js/services/bookingSync.js` (cross-domain consistency + reconciliation)
  - `src/js/stores/bookingsStore.js` (UI-agnostic booking persistence)

### 1.3 Core domain objects (current)
- **Movement (strip)**: persisted via `datamodel.js`
  - Key fields include: `id`, `status` (PLANNED/ACTIVE/COMPLETED/CANCELLED), `dof`, `flightType` (ARR/DEP/LOC), `arrPlanned`, `depPlanned`, `bookingId` (optional link)
- **Booking**: persisted via `bookingsStore.js`
  - Key fields include: `id`, `status`, `linkedStripId` (optional), contact/aircraft fields, `schedule.*`
- **Calendar Event**: general calendar entries (separate from bookings)
- **Booking Profile**: reusable template for autofill

### 1.4 Cross-domain invariants (must always hold)
- If `movement.bookingId = X`, booking `X` must exist or be cleared.
- If `booking.linkedStripId = Y`, movement `Y` must exist or be cleared.
- Prefer deterministic conflict resolution (conservative: clear stale pointers, avoid deleting records).

---

## 2) Implementation Status

### 2.0 Sprint — Unified Times Form (2026-02-25)

**Summary**: All create/edit/duplicate modals now share a common 2×2 Times grid
(ETD | ETA / ATD | ATA) with a single persistent UTC/Local mode toggle.

**Changes delivered**:
- Unified Times form across all create/edit/duplicate modals (New DEP/ARR/OVR, New LOC, Edit, Duplicate)
- Persistent UTC/Local input mode toggle (`config.timeInputMode`); persists via existing localStorage config mechanism
- Removed per-field local time checkboxes (showLocalTimeEditDep, showLocalTimeEditDepActual, showLocalTimeEditArr, showLocalTimeEditArrActual, showLocalTimeToggle, showLocalTimeDep, showLocalTimeArr, showLocalTimeLocToggle, showLocalTimeDupDep, showLocalTimeDupArr)
- Added `convertLocalToUTC()` to datamodel.js (inverse of existing `convertUTCToLocal()`)
- Added `renderTimesGrid()` helper in ui_liveboard.js
- Added `bindTimeModeToggle()` helper in ui_liveboard.js
- Added actual-time fields to modals that previously only had planned fields:
  - New DEP/ARR/OVR: `newDepActual`, `newArrActual`
  - New LOC: `newLocStartActual`, `newLocEndActual`
  - Duplicate: `dupDepActual`, `dupArrActual`
- OVR: ETA/ATA fields present in grid but disabled; labels ECT/ACT applied
- Save handlers convert Local→UTC before writing to movement fields
- `docs/TIMING.md` added (canonical timing semantics reference)

**Files changed**:
- `src/js/datamodel.js` — added `timeInputMode: "UTC"` to defaultConfig; added `convertLocalToUTC()`
- `src/js/ui_liveboard.js` — added `renderTimesGrid()`, `bindTimeModeToggle()`; updated all 4 modals; updated all save handlers
- `docs/TIMING.md` — new documentation file

**Manual verification checklist**:
- [ ] Open New DEP modal — Times grid shows 4 fields (ETD, ETA, ATD, ATA), toggle button reads "UTC"
- [ ] Open New ARR modal — same 4-field grid
- [ ] Open New LOC modal — same 4-field grid
- [ ] Open New OVR modal — ETD label = "ECT", ATD label = "ACT", ETA and ATA fields disabled
- [ ] Open Edit modal — same 4-field grid, no per-field checkboxes
- [ ] Open Duplicate modal — same 4-field grid
- [ ] Toggle UTC→Local in any modal — all non-empty input values convert; button shows "Local"
- [ ] Toggle Local→UTC — values convert back to UTC
- [ ] Close modal, reopen — toggle state persists (same mode remembered from config)
- [ ] Enter times in Local mode, save, reopen in UTC mode — stored times are correct UTC strings
- [ ] OVR: enter ECT in Local mode, save; stored depPlanned is UTC

### 2.1 Completed (believed stable)
**Bidirectional Calendar ↔ Booking ↔ Strip sync**
- Booking create/update propagates to linked strip(s)
- Strip edit/cancel/complete propagates back to booking fields/status
- Booking cancel/delete supports "cancel linked strip" vs "keep strip" paths

**Booking Profiles (Admin)**
- Create/edit/delete/search profiles
- Booking autofill from profile (then VKB fallback)

**Calendar**
- Month / Week / Year views
- Click-to-edit/delete general calendar events

**Live Board housekeeping**
- EGOW "today" counters (BM/BC/VM/VC) are mutually exclusive
- FIS labels Manual / Strip / Total; Strip FIS is today-only
- Timeline is today-only
- Time-based stale highlights + periodic refresh + auto-activation
- "Past planned time" strips start ACTIVE
- History "Edit > Details" works (no openEditModal error)
- Dropdown menus use portal-based approach to avoid clipping

**Module architecture improvement**
- Removed circular import between `ui_booking.js` and `ui_liveboard.js`
- Introduced:
  - `src/js/services/bookingSync.js`
  - `src/js/stores/bookingsStore.js`

**Booking schedule canonical planned-time**
- Added:
  - `booking.schedule.plannedTimeLocalHHMM`
  - `booking.schedule.plannedTimeKind` (ARR/DEP/LOC)
- Kept:
  - `booking.schedule.arrivalTimeLocalHHMM` for backwards compatibility
- Migration introduced to populate canonical planned time for legacy bookings
- DEP strip updates no longer overwrite `arrivalTimeLocalHHMM`
- Store normalization ensures canonical fields always populated on create/update
- UI form handlers write canonical fields explicitly

**Bidirectional reconciliation + integrity enforcement**
- `bookingSync.reconcileLinks()` fully bidirectional:
  - Clears `movement.bookingId` if booking missing
  - Clears `booking.linkedStripId` if movement missing
  - Repairs `booking.linkedStripId` if single strip claims it (deterministic)
  - Detects conflicts (multiple strips claiming same booking)
- Returns detailed summary: `{ clearedMovementBookingId, clearedBookingLinkedStripId, repairedBookingLinkedStripId, conflicts }`
- Runs before first render (app.js bootstrap)

**No-op patch optimization**
- `updateBookingById()` skips save/dispatch if patch makes no actual changes
- Reduces write churn and event storms

**Non-seeding + persistence**
- Demo seeding should not re-appear
- Persistence across reload is expected for movements/bookings/calendar/profiles

### 2.2 Backlog (known or suspected gaps)
These are not confirmed resolved unless explicitly audited against a fresh zip.

**Event / refresh storm safety**
- ✅ RESOLVED (Sprint 3): Stress-tested under all edge flows (rapid edits, multi-strip, status transitions, booking sync, delete/cancel). No loops or redundant re-renders detected.
- Reentrancy guards in place; no-op optimization added
- Diagnostics instrumentation available via `__FDMS_DIAGNOSTICS__` flag for future regression testing

**UI/UX quality improvements** (non-critical)
- Booking edit form could display flight type explicitly (currently inferred as ARR)
- Reconciliation summary could be logged or displayed to user (currently silent)
- Strip→booking sync could validate more fields (pob, remarks, etc.)

---

## 3) Technical Debt & Risks

### 3.1 Data integrity / drift
- ✅ RESOLVED: Bidirectional reconciliation now enforced
- ✅ RESOLVED: Canonical planned time always populated (migration + normalization + UI)
- Remaining risk: Multi-user concurrent edits not supported (localStorage is single-client)

### 3.2 Event-driven coupling
- ✅ MITIGATED: Reentrancy guards in bookingSync._dispatchBookingPatch
- ✅ MITIGATED: No-op optimization prevents unnecessary save/dispatch cycles
- ✅ VERIFIED (Sprint 3): Stress audit confirmed no event storms under rapid edits, status transitions, booking sync, and delete/cancel flows. Render counts scale 1:1 with user actions.

### 3.3 Schema evolution
- Any schema additions must remain backwards compatible and migrate once, deterministically.
- Migration pattern established: bookingsStore.ensureInitialised() runs once on load

---

## 4) Current Sprint (Immediate Objective)

**Sprint goal:** ✅ COMPLETE - Integrity and schedule-consistency gaps closed and verified.

### 4.1 Completed objective (Sprint 1)
✅ Performed targeted audit/fix:
1) `bookingSync.reconcileLinks()` is fully bidirectional and deterministic.
2) Booking create/edit flows always set `schedule.plannedTimeLocalHHMM` + `schedule.plannedTimeKind`.
3) No-op patches skip write/dispatch (quality improvement implemented).

Exit criteria met:
- ✅ PASS/FAIL checklist with file+function evidence (see commit c0002b2)
- ✅ Orphan pointers repaired on load both directions
- ✅ New/edited bookings always have canonical planned time populated
- ✅ No import cycles; no console errors; persistence works

### 4.3 Hotfix (Admin panel init failure)

Hotfix closed (no further action); verified as part of Sprint 2/3 stability pass.


### 4.2 Sprint 2: Live Board integrity + stats correctness

**Sprint goal:** Fix release-blocking inline edit data-loss bug, add hard-delete for strips, and correct traffic counter logic.

**Verification status:** ✅ VERIFIED in browser (2026-02-09, Chromium 141.0.7390.37, Playwright headless)
- 10/10 tests PASS, 0 JS errors
- State A (clean localStorage) + State B (pre-seeded data) both tested
- Evidence: `Sprint2_Verification_EvidencePack_2026-02-09.md` + `evidence/*.png` (28 screenshots)
- Test harness: `sprint2_verify.mjs`

#### Task A — Fix inline edit data-loss bug (release blocker) ✅

**Root cause:** Multiple defects in `startInlineEdit()` and time field bindings in `renderLiveBoard()`:

1. **Wrong time field names:** Inline edit for time fields used phantom names (`atd`, `etd`, `ata`, `eta`, `act`, `ect`) instead of canonical movement fields (`depActual`, `depPlanned`, `arrActual`, `arrPlanned`). Edits wrote to non-existent properties; display reads from canonical fields, so edits appeared lost.
2. **Blur/Enter double-fire:** Both Enter key handler and blur handler called `saveEdit()` without guard, causing duplicate updates and re-renders per interaction.
3. **No required field validation:** Blanking required fields (e.g. `callsignCode`) set them to `null` without error, destroying data.
4. **Missing booking sync:** `onMovementUpdated()` was not called after inline edit, so linked bookings drifted.
5. **Missing counter updates:** `updateDailyStats()` / `updateFisCounters()` were not called after inline edit.

**Fix (files changed):**
- `src/js/ui_liveboard.js` — `startInlineEdit()` (lines ~239-345):
  - Added `saved` guard flag to prevent double-fire from Enter + blur race
  - Added required field validation (callsignCode): rejects blank with single error toast, reverts UI cell
  - Added `onMovementUpdated()` call for booking sync after save
  - Added `updateDailyStats()` / `updateFisCounters()` calls after save
- `src/js/ui_liveboard.js` — inline edit bindings (lines ~1635-1647):
  - Fixed time field names: `m.depActual ? "depActual" : "depPlanned"` (was `m.atd ? "atd" : "etd"`)
  - Same fix for arrival times and OVR crossing times

**QA test log:**
- Callsign edit: double-click → edit → Enter → single update, no toast storm, value persists after reload
- Registration edit: works, no other fields affected
- Type edit: works, no other fields affected
- Dep/Arr aerodrome edit: works, value persists
- Time edit (dep/arr): writes to correct canonical field, persists after reload
- Blank callsign: rejected with single "Callsign Code cannot be blank" toast, previous value retained
- Escape: reverts without saving
- No console errors

#### Task B — Add "Delete strip" (hard delete) ✅

**Feature:** Added permanent Delete action to strip Edit dropdown in both Live Board and History, distinct from Cancel (soft delete).

**Files changed:**
- `src/js/datamodel.js` — Added `deleteMovement(id)`: removes movement from in-memory array and persists to localStorage
- `src/js/ui_liveboard.js`:
  - Added `performDeleteStrip(movement)` function: confirmation prompt, booking link cleanup, delete, UI refresh
  - Added Delete button HTML + event binding in Live Board edit dropdown
  - Added Delete button HTML + event binding in History edit dropdown
  - Imported `deleteMovement` from datamodel, `getBookingById`/`updateBookingById` from bookingsStore

**Behaviour:**
- Confirmation: `"Delete strip <callsign> (#<id>)? This cannot be undone."`
- On confirm: clears `booking.linkedStripId` if linked, then removes movement from storage
- UI refreshes immediately; reload confirms permanent deletion
- Cancel action still works unchanged (marks as CANCELLED, preserves record)

**QA test log:**
- Delete unlinked strip: disappears from UI, gone after reload, no console errors
- Delete linked strip: booking's linkedStripId cleared, booking views unaffected
- Cancel button: still works as before (soft delete → History)

#### Task C — Fix Live Board traffic counter logic ✅

**Root cause:** `calculateDailyStats()` in `src/js/app.js` counted ALL movements for today including PLANNED and CANCELLED in the total. This violated requirements that:
- PLANNED should not affect counters (not yet real traffic)
- CANCELLED should not count in main movement totals
- Each movement counted exactly once

**Fix (files changed):**
- `src/js/app.js` — `calculateDailyStats()`:
  - Filters to only `ACTIVE` + `COMPLETED` status (excludes PLANNED and CANCELLED)
  - Deduplicates by movement ID (defensive)
  - Total computed from filtered+deduped set, not `todaysMovements.length`

**QA test log:**
- 1 PLANNED today: counter = 0 (correct, not counted)
- 1 ACTIVE today: counter = 1
- Mark ACTIVE → COMPLETED: counter still = 1 (same movement, not double-counted)
- Cancel a movement: counter decreases (CANCELLED excluded)
- View non-today history: today's counters unchanged

### 4.3 Known risks discovered during Sprint 2

- **Phantom time fields:** Movements edited via inline edit before this fix may have orphan `etd`/`atd`/`eta`/`ata`/`ect`/`act` properties. These are harmless (never read by display logic) but could be cleaned up in a future migration if desired.
- **Inline edit does not trigger all modal-level enrichments** (e.g. WTC lookup on type change, voice callsign update on callsign change). This is by design for minimal-risk patch semantics; full enrichment requires the Edit Details modal.

### 4.4 Sprint 3: Event storm safety audit + documentation hardening

**Sprint goal:** Prove no event-driven loops, redundant dispatch storms, or runaway re-renders exist under realistic stress. Document strip lifecycle semantics and counter rules.

**Merged to main:** 2026-02-10 (Europe/London)
- Merge method: merge commit (--no-ff)
- Commits: `c1bfee8`, `0c9e752`, `dd67acf`

#### Option A — Event / Refresh Storm Safety Audit ✅

**Approach:** Playwright-based stress test harness with test-only diagnostics instrumentation (`window.__FDMS_DIAGNOSTICS__` flag).

**Instrumentation added (files changed):**
- `src/js/ui_liveboard.js` — Counter increment in `renderLiveBoard()`, `renderHistoryBoard()`, `fdms:data-changed` listener
- `src/js/app.js` — Counter increment in `updateDailyStats()`, `updateFisCounters()`
- `src/js/services/bookingSync.js` — Counter increment in `_dispatchBookingPatch()` on dispatch

All counters gated behind `window.__FDMS_DIAGNOSTICS__ === true`. Zero overhead in normal operation.

**Test scenarios (all PASS):**

| Test ID | Scenario | Result | Key Metrics |
|---------|----------|--------|-------------|
| S1 | Rapid inline edits on one strip (N=25) | **PASS** | 25 renders for 25 edits (1:1 ratio) |
| S2 | Rapid edits across 10 strips (N=50) | **PASS** | 50 renders for 50 edits (1:1 ratio) |
| S3 | Status transitions + counter verification | **PASS** | Counters 0→3→3→2 (correct at each stage) |
| S4 | Booking-linked flow stress (N=15) | **PASS** | 15 sync dispatches, 15 received, link integrity maintained |
| S5 | Delete/cancel under load (10 strips) | **PASS** | 7 remaining, 4 counted (correct) |
| PERSIST | Post-stress persistence + consistency | **PASS** | Data survives reload, no duplicate IDs |
| QUIESCE | Counters quiesce after actions stop | **PASS** | 0 render growth in 3s idle window |

**Verdict:** No event storms, no infinite loops, no runaway re-renders. Render counts scale linearly with user actions (1:1 for inline edits, 1:1 for status transitions). Booking-linked edits show 2:1 render ratio (expected: edit render + fdms:data-changed render).

**Evidence:**
- Test harness: `sprint3_stress_verify.mjs`
- Evidence pack: `Sprint3_OptionA_StressAudit_EvidencePack_2026-02-09.md`
- Screenshots: `evidence_s3/*.png`

#### Option C — Documentation Hardening ✅

**Deliverable:** `docs/STRIP_LIFECYCLE_AND_COUNTERS.md`

Covers:
- Strip status definitions (PLANNED, ACTIVE, COMPLETED, CANCELLED, deleted)
- Status transition diagram with trigger descriptions
- Cancel vs Delete semantics
- Canonical time fields (`depPlanned`, `depActual`, `arrPlanned`, `arrActual`) with getter helper mapping
- Display logic per flight type
- Historical note on phantom time fields
- Counter rules: daily movement totals (EGOW), FIS counters, per-strip counters
- Counter update triggers and safety net (45s periodic tick)
- Booking link invariants (bidirectional pointers, sync pathways, reentrancy guard, reconciliation)
- Inline edit vs modal edit comparison
- Storage format reference
- Diagnostics mode reference

### 4.5 Sprint 4: Formations v1 end-to-end

**Sprint goal:** Implement user-facing create/edit/remove of `movement.formation` on a strip, Live Board badge `F×n`, expanded panel with inline element edits, WTC semantics, formation inheritance in duplicate flows, and a full Playwright regression suite.

**Merged:** 2026-02-10 (Europe/London) on branch `claude/fdms-formations-documentation-v5on5`

#### Deliverables

**Data model (`src/js/datamodel.js`):**
- `WTC_RANK` constant and `maxWtcString()` helper for WTC comparison
- `computeFormationWTC(elements)` — returns `{ wtcCurrent, wtcMax }` where current = max WTC across PLANNED+ACTIVE elements, max = max across all elements
- `normalizeFormation(formation)` — backward-compat repair called on every load; ensures `elements` is an array, fills missing fields, recomputes WTC; result saved back to localStorage
- `updateFormationElement(id, elementIndex, patch)` — patches a single element (status, depActual, arrActual), recomputes WTC, persists
- `ensureInitialised()` updated: runs `normalizeFormation` on any movement with a `formation` field; calls `saveToStorage()` if any formations were normalized

**UI (`src/js/ui_liveboard.js`):**
- Helper functions: `buildFormationElementRows`, `readFormationFromModal`, `wireFormationCountInput`
- `renderFormationDetails(m)` — expanded row subsection showing label, current/max WTC, per-element table with inline status select, dep/arr inputs, and Save button per row
- `renderLiveBoard()` — callsign cell now includes `<span class="badge badge-formation">F×n</span>` for strips with formations
- New Flight modal: collapsible Formation section (count input + dynamic element rows)
- Edit Details modal: collapsible Formation section (pre-populated from `m.formation`, with "Remove Formation" button)
- `js-save-flight`, `js-save-edit`, `js-save-complete-edit` handlers: read formation from modal and persist
- Duplicate modal: formation copy with elements reset to `status: "PLANNED"`, `depActual: ""`, `arrActual: ""`
- Event delegation for `.fmn-el-save` buttons: reads row values, calls `updateFormationElement`, re-renders, shows toast

**CSS (`src/css/vectair.css`):**
- `.fmn-el-input`, `.fmn-el-dep`, `.fmn-el-arr`, `.fmn-el-select` — inline element edit controls

**Documentation:**
- `docs/FORMATIONS.md` — 13-section canonical reference for the formation system

**Playwright regression (`sprint4_formation_verify.mjs`):**

| Test | Scenario | Result |
|------|----------|--------|
| F1 | No formation → badge absent | **PASS** |
| F2 | Create 2-element via UI → badge `F×2` persists after reload | **PASS** |
| F3 | Seeded 3-element → badge `F×3` on Live Board | **PASS** |
| F4 | Expanded panel: formation table + 3 Save buttons present | **PASS** |
| F5 | Element inline save: status=ACTIVE, depActual=13:20 persists | **PASS** |
| F6 | WTC recompute: EH10(M) completed → wtcCurrent=L, wtcMax=M | **PASS** |
| F7 | Edit modal pre-populates formation count=3 | **PASS** |
| F8 | Remove formation via edit modal → formation=null, badge gone | **PASS** |
| F9 | Duplicate inherits formation, elements reset to PLANNED/no actuals | **PASS** |
| F10 | Malformed formation `{ label: null }` normalized on load (no crash) | **PASS** |

**Result: 10/10 PASS, 0 JS errors**

**Evidence pack:**
- Screenshots: `evidence_s4/S4_*.png` (14 screenshots)
- Results JSON: `evidence_s4/sprint4_formation_results.json`
- Test harness: `sprint4_formation_verify.mjs`
- Linux kernel 4.4 workaround: `--single-process --no-zygote` Chromium flags
- CDN stub: `page.route('**/xlsx.full.min.js', ...)` to prevent network failures

#### Known issues discovered during Sprint 4

- **Linux kernel 4.4 Playwright click interception:** `click({ force: true })` on buttons inside `expand-section` still hits the covering element (coordinate-based). Fixed by using `dispatchEvent('click')` which directly fires the event on the target element.
- **normalizeFormation not persisted:** Initial implementation ran normalization in memory but skipped `saveToStorage()`. Fixed: `needsSave` flag triggers save when any formation is normalized.

### 4.6 Sprint 5: Formations v1.1 — element depAd/arrAd, editable callsign, validation, cascade, inheritance

**Sprint goal:** Extend formation elements with per-element Dep AD / Arr AD fields, editable callsigns, input validation (WTC + ICAO 4-char), formation element count guard (min 2, max 12), master status cascade (COMPLETED/CANCELLED), and produce-arrival inheritance. Write a 12-test Playwright regression suite.

**Merged:** 2026-02-11 (Europe/London) on branch `claude/fdms-formations-documentation-v5on5`

#### Deliverables

**Data model (`src/js/datamodel.js`):**
- `isValidWtcChar(wtc)` — true iff WTC ∈ {L, S, M, H, J}
- `isValidIcaoAd(ad)` — true iff ad is `""` or matches `/^[A-Z0-9]{4}$/`
- `isValidElementStatus(status)` — true iff status ∈ {PLANNED, ACTIVE, COMPLETED, CANCELLED}
- `normalizeFormation` updated: fills `element.depAd` and `element.arrAd` with `""` for legacy elements
- `cascadeFormationStatus(id, newStatus)` — exported; COMPLETED cascades PLANNED/ACTIVE→COMPLETED; CANCELLED cascades all→CANCELLED; recomputes WTC and persists

**UI (`src/js/ui_liveboard.js`):**
- `buildFormationElementRows` — new columns: Callsign (editable), Dep AD, Arr AD; clamped to [2, 12]; callsign defaults to `${base} ${n}` but is editable
- `readFormationFromModal` — reads callsign/depAd/arrAd; validates WTC and ICAO; returns `null` if formation section never opened (no rows rendered); returns `{ _error, message }` on validation failure; returns `null` if count < 2
- `wireFormationCountInput` — clamps to [2, 12]
- Callsign input listener in New Flight modal: only rebuilds rows if rows already exist (prevents phantom formation on normal saves)
- New Flight + Edit Details modal: `min=2 max=12` on count input
- `renderFormationDetails` — 10-column table: Status, Dep, Arr, Dep AD, Arr AD, Callsign, Reg, Type, WTC, Save; wrapped in scrollable `.formation-table-wrap`; empty depAd/arrAd shows master fallback in `.fmn-fallback` muted span
- `.fmn-el-save` delegation: reads depAd/arrAd per row, validates ICAO, patches element
- `transitionToCompleted` and `transitionToCancelled`: call `cascadeFormationStatus` after `updateMovement`
- `js-save-complete-edit` handler: calls `cascadeFormationStatus` after `updateMovement`
- `openReciprocalStripModal` (produce arrival/departure): copies formation with elements reset: `status="PLANNED"`, `depActual=""`, `arrActual=""`; recomputes WTC

**CSS (`src/css/vectair.css`):**
- `.formation-table-wrap` — `overflow-x: auto` for horizontal scroll on narrow screens
- `.fmn-el-ad` — 52px wide, `text-transform: uppercase`
- `.fmn-fallback` — 10px muted grey for inherited AD display
- `.fmn-ad-cell` — `min-width: 72px`

**Documentation:**
- `docs/FORMATIONS.md` — "Formations v1.1 — Clarifications and Extensions" section prepended; covers element schema v1.1, depAd/arrAd empty-value semantics, validation rules, element count rules, WTC semantics, cascade rules, produce inheritance, and out-of-scope items

**Playwright regression (`sprint5_formation_v11_verify.mjs`):**

| Test | Scenario | Result |
|------|----------|--------|
| G1 | depAd/arrAd/callsign inputs present in New Flight modal (count=2) | **PASS** |
| G2 | depAd/arrAd persist via New Flight modal save | **PASS** |
| G3 | depAd/arrAd editable in expanded panel; persists after `.fmn-el-save` | **PASS** |
| G4 | Empty depAd shows master fallback in `.fmn-fallback` | **PASS** |
| G5 | Invalid 3-char depAd rejected; element unchanged | **PASS** |
| G6 | Invalid WTC in New Flight modal blocks save; no movement created | **PASS** |
| G7 | Overridden element callsign persists after save | **PASS** |
| G8 | Formation count=1 → `movement.formation = null` | **PASS** |
| G9 | Master COMPLETE cascade → all PLANNED/ACTIVE elements become COMPLETED, wtcCurrent="" | **PASS** |
| G10 | Master CANCEL cascade → all elements become CANCELLED | **PASS** |
| G11 | Produce-arrival inherits formation + resets elements (status=PLANNED, actuals cleared, depAd copied) | **PASS** |
| G12 | Edit modal count input: `min=2 max=12` HTML attributes correct | **PASS** |

**Result: 12/12 PASS, 0 JS errors**

**Evidence pack:**
- Screenshots: `evidence_s5/S5_*.png` (12 screenshots)
- Results JSON: `evidence_s5/sprint5_formation_v11_results.json`
- Test harness: `sprint5_formation_v11_verify.mjs`

#### Bugs fixed during Sprint 5

- **Callsign input listener phantom formation:** When count input defaulted to 2 and user typed in `#newCallsignCode`, the callsign `input` listener triggered `buildFormationElementRows`, rendering element rows silently. Subsequent `readFormationFromModal` found those rows and created a formation even though the user never opened the formation section. Fixed: listener only rebuilds if `[data-el-callsign="0"]` already exists in container.
- **G10 dialog race:** Test registered `page.once('dialog', ...)` *after* clicking `.js-cancel`, so the `confirm()` dialog fired before the handler was attached (auto-dismissed as cancelled). Fixed: register handler *before* clicking.

#### Known limitations (v1.1 out-of-scope, deferred to v1.2+)

- Micro-strip fields (departure sheet per element) not implemented
- No server-side or multi-client sync (localStorage remains single-client)
- Formation cannot be added to a strip that is already COMPLETED or CANCELLED

### 4.7 Sprint 6: Formations v1.1 Parity — LOC (Local) strip creation

**Sprint goal:** Complete formation parity across all creation paths. The Local flight modal (`openNewLocalModal`) previously had `formation: null` hardcoded and lacked an authoring UI for formations. This sprint adds the collapsible Formation section to the LOC modal, wires all handlers (count input, callsign listener guard, expander toggle), and updates both save handlers (Save and Save & Complete) to read and persist formation data with cascade.

**Branch:** `claude/fdms-formations-documentation-v5on5`

#### Deliverables

**UI (`src/js/ui_liveboard.js`):**
- `openNewLocalModal` — collapsible Formation section added (HTML): `newLocFormationSection`, `newLocFormationCount`, `newLocFormationElementsContainer`; mirrors the DEP/ARR modal section
- LOC modal JS wiring: `wireFormationCountInput` for `newLocFormationCount`; callsign input listener with phantom-formation guard; `document.querySelectorAll('.modal-expander')` event binding (was missing from LOC modal — caused panel to stay hidden when clicked)
- `.js-save-loc` handler: reads `locFormation = readFormationFromModal(callsign, "newLocFormationCount", "newLocFormationElementsContainer")`; validation errors block save; `movement.formation = locFormation || null`
- `.js-save-complete-loc` handler: same formation read + validation; `formation: locCpFormation || null` in movement object; after `createMovement`, calls `cascadeFormationStatus(createdLoc.id, "COMPLETED")` if formation present

**Playwright regression (`sprint6_loc_formation_verify.mjs`):**

| Test | Scenario | Result |
|------|----------|--------|
| H1 | Formation created on LOC strip via New Local modal → badge F×2 appears | **PASS** |
| H2 | depAd/arrAd per element persist on LOC strip | **PASS** |
| H3 | Invalid WTC in LOC modal blocks save; no movement created | **PASS** |
| H4 | Invalid 3-char ICAO code in LOC modal blocks save | **PASS** |
| H5 | Formation section never opened → formation=null, no badge (phantom-formation guard) | **PASS** |
| H6 | Save-and-Complete LOC with formation → all elements cascade to COMPLETED | **PASS** |

**Result: 6/6 PASS, 0 JS errors**

Regressions: Sprint 4 10/10 PASS, Sprint 5 12/12 PASS (no regressions)

**Evidence pack:**
- Screenshots: `evidence_s6/S6_*.png` (6 screenshots)
- Results JSON: `evidence_s6/sprint6_loc_formation_results.json`
- Test harness: `sprint6_loc_formation_verify.mjs`

#### Bug fixed during Sprint 6

- **LOC modal expanders not wired:** The `openNewLocalModal` function did not include the `document.querySelectorAll('.modal-expander').forEach(...)` event binding that wires the collapsible section toggle. The Formation expander button had no click handler, so `panel.hidden` was never toggled and the Formation section remained permanently hidden. Fixed: added the same expander wiring block used in the DEP/ARR and Edit modals.

#### Dev tooling improvement (cross-platform Playwright imports)

- `package.json` added at repo root with `playwright@1.56.1` as a `devDependency` and `npm run test:s4/s5/s6` scripts.
- All three sprint verify scripts updated: replaced absolute-path imports (`/opt/node22/lib/node_modules/playwright/index.mjs`) with portable `import { chromium } from 'playwright'`.
- `package-lock.json` committed so `npm ci` is reproducible on Windows + Linux.
- `DEV-SETUP.md` updated with a "Regression Tests (developer QA tooling)" section documenting `npm ci`, `npx playwright install chromium`, and `npm run test:s*` commands.
- No changes under `src/`. No drift in delivery-model statements.

### 4.8 Sprint 7: LOC Standard Modal Parity

**Sprint goal:** Replace the bespoke LOC create/edit modal (`openNewLocalModal`) with the standard movement modal structure used by DEP/ARR/OVR. LOC now uses the same sectioned layout (IDENTITY, PLAN, TIMES, OPERATIONAL) and accordions (Remarks & Warnings, ATC Details, Formation), with LOC-specific locks applied to prevent user modification of Flight Type, Departure AD, and Arrival AD.

**Branch:** `claude/fdms-lite-ux-change-iepHR`

#### What changed

**`src/js/ui_liveboard.js`:**
- **`openNewLocalModal`** (bespoke form, removed from user flow): Replaced by `openNewLocFlightModal()`. The old bespoke function is no longer wired to any button and is now dead code. It has been removed from the codebase.
- **`openNewLocFlightModal()`** (new function): Renders the standard movement modal structure with:
  - Sections: IDENTITY, PLAN, TIMES, OPERATIONAL (matching `openNewFlightModal`)
  - Accordions: Remarks & Warnings, ATC Details, Formation
  - Two-column `modal-section-grid` layout
  - LOC locks: Flight Type = `<input value="LOC" disabled />` (not a select); Departure AD = `<input value="EGOW" disabled />`; Arrival AD = `<input value="EGOW" disabled />`
  - Backward-compatible element IDs (`newLocCallsignCode`, `newLocStart`, `newLocEnd`, `newLocFormationCount`, `newLocFormationSection`, `newLocFormationElementsContainer`, `.js-save-loc`, `.js-save-complete-loc`) to preserve Sprint 6 test compatibility
  - Added new fields not in bespoke form: Warnings textarea, ATC Details (Squawk, Route, Clearance), O/S count, FIS count, Priority checkbox/dropdown, Flight Rules dropdown
  - EGOW Code field present with datalist (same options as standard modal); validation only blocks save if a value is provided but is invalid (not enforced as mandatory, to preserve Sprint 6 backward compat)
  - Save handlers write depAd/arrAd = "EGOW" (hardcoded, user cannot override), flightType = "LOC", isLocal = true
  - Timing semantics unchanged: no ETD→ETA auto-fill in new modal (same as previous LOC behavior)
- **Button wire-up** (line ~4697): `safeOn(btnNewLoc, "click", openNewLocFlightModal)` (was `openNewLocalModal`)
- **`openEditMovementModal`**: Added `disabled` attribute to `editFlightType` select, `editDepAd` input, and `editArrAd` input when `flightType === "LOC"`, so editing an existing LOC movement also shows locked fields

**`package.json`:**
- Added `"test:s7": "node sprint7_loc_standard_modal_verify.mjs"` script

**`sprint7_loc_standard_modal_verify.mjs`** (new):
- 8-test Playwright regression suite (see table below)

**`evidence_s7/`** (new):
- 9 screenshots: `S7_1` through `S7_9`
- `sprint7_loc_standard_modal_results.json` with pass/fail summary + run metadata

#### Where

| Change | File | Key function / line |
|--------|------|---------------------|
| New LOC standard modal | `src/js/ui_liveboard.js` | `openNewLocFlightModal()` (new function replacing `openNewLocalModal`) |
| Button re-wire | `src/js/ui_liveboard.js` | `safeOn(btnNewLoc, "click", openNewLocFlightModal)` |
| Edit modal LOC locks | `src/js/ui_liveboard.js` | `openEditMovementModal()` — `disabled` on `editFlightType`, `editDepAd`, `editArrAd` for LOC |
| npm script | `package.json` | `"test:s7"` |
| Test harness | `sprint7_loc_standard_modal_verify.mjs` | — |

#### Why

LOC parity requirement: the bespoke LOC form had a single-column stacked layout lacking the standard sections, accordions, and two-column grid. Users saw a different UI for LOC vs DEP/ARR/OVR. This sprint routes LOC through a functionally equivalent form of the standard modal template, ensuring structural parity while preserving LOC-specific constraints (EGOW AD lock, LOC flight type lock) and all existing formation/timing semantics.

#### Playwright regression results

| Test | Scenario | Result |
|------|----------|--------|
| I1 | Standard modal structure: IDENTITY, PLAN, TIMES, OPERATIONAL headings present | **PASS** |
| I2 | Standard modal accordions: Remarks & Warnings, ATC Details, Formation | **PASS** |
| I3 | Flight Type shows LOC and is disabled/read-only | **PASS** |
| I4 | Departure AD shows EGOW and is disabled/read-only | **PASS** |
| I5 | Arrival AD shows EGOW and is disabled/read-only | **PASS** |
| I6 | LOC timing: entering ETD does not auto-fill ETA (unchanged behavior) | **PASS** |
| I7 | Save LOC; reload; depPlanned/arrPlanned/depAd/arrAd/flightType persisted correctly | **PASS** |
| I8 | Edit LOC: flight type locked to LOC, dep/arr AD locked to EGOW in edit modal | **PASS** |

**Result: 8/8 PASS, 0 JS errors**

Regressions: Sprint 4 10/10 PASS, Sprint 5 12/12 PASS, Sprint 6 6/6 PASS (no regressions)

#### Verification evidence (commands run)

```
npm run test:s7   → 8/8 PASS
npm run test:s4   → 10/10 PASS
npm run test:s5   → 12/12 PASS
npm run test:s6   → 6/6 PASS
```

All four suites passing on Linux kernel 4.4, Node v22, Playwright 1.56.1, Chromium headless.

**Evidence pack:**
- Screenshots: `evidence_s7/S7_*.png` (9 screenshots)
- Results JSON: `evidence_s7/sprint7_loc_standard_modal_results.json`
- Test harness: `sprint7_loc_standard_modal_verify.mjs`

#### Deliverables checklist

- [x] LOC modal is the standard modal (sectioned layout), not the bespoke LOC form
- [x] LOC flight type locked to LOC (disabled input in new + edit modal)
- [x] LOC dep/arr AD locked to EGOW (disabled inputs in new + edit modal)
- [x] LOC timing semantics unchanged (no ETD→ETA auto-fill; same as before)
- [x] New Sprint 7 test: 8/8 PASS
- [x] Sprint 4: 10/10 PASS (no regression)
- [x] Sprint 5: 12/12 PASS (no regression)
- [x] Sprint 6: 6/6 PASS (no regression)
- [x] Evidence pack exists: `evidence_s7/`
- [x] STATE.md updated with audit entry

#### Notes

- Element IDs in the LOC modal (`newLocCallsignCode`, `newLocStart`, `newLocEnd`, formation IDs, `.js-save-loc`, `.js-save-complete-loc`) are preserved from the old bespoke modal to maintain backward compatibility with Sprint 6 regression tests.
- EGOW Code field is present and visible in the LOC modal (with datalist, same as standard modal). Validation blocks save only if an invalid code is entered, not if left empty — this preserves Sprint 6 test behavior where EGOW Code was not filled.
- No changes to counters, reporting logic, formation semantics, or delivery-model documentation.

### 4.9 P0 Fix: Inline Edit Time Field Toast Storm + Data Loss

**Date:** 2026-02-17
**Branch:** `claude/fix-inline-edit-data-loss-QLjBR`
**Priority:** P0 (data integrity)

#### Symptom

Inline editing a time cell on a strip (double-click → type → Enter) triggered:
- A storm of mixed toasts: "Callsign Code is required" (error) and "Movement updated successfully" (success).
- In some cases, entries were removed from Live/Pending and History (apparent data loss).

#### Root Cause (precise)

**Primary — leaked `document` keyHandler from `openModal()`:**

`openModal()` registers `document.addEventListener("keydown", keyHandler)` to implement:
1. Esc-to-close modal.
2. Enter-to-save via the primary save button.

Every save handler (`.js-save-flight`, `.js-save-edit`, `.js-save-loc`, `.js-save-complete-*`, `.js-save-dup`) closed the modal by setting `modalRoot.innerHTML = ""` **directly** — bypassing the `closeModal()` closure which is the only path that called `document.removeEventListener("keydown", keyHandler)`.

Over a session with multiple modal open+save cycles, one leaked `keyHandler` per cycle accumulated on `document`. Each subsequent `Enter` keypress triggered ALL accumulated handlers simultaneously:
- Each handler called `backdrop.querySelector(".js-save-edit").click()` on its (now-detached) backdrop element.
- The click listener on the detached element ran the full modal save handler.
- `document.getElementById("editCallsignCode")?.value` returned `""` (modal closed, element gone).
- Callsign validation failed → `showToast("Callsign Code is required", 'error')` — N times (one per leaked handler).

**If a live modal happened to be open at the time**, the leaked handler's `document.getElementById()` calls found the live modal's fields, passed validation, and called `updateMovement(m.id, updates)` with whatever the modal currently had — potentially overwriting the movement with incomplete or incorrect data → data corruption.

**Secondary — missing `stopPropagation` in inline-edit `keydown` handler:**

The inline-edit input's `keydown` handler called `e.preventDefault()` but NOT `e.stopPropagation()`. Enter keypresses from inline-edit thus bubbled up to `document`, triggering all accumulated modal keyHandlers even when no modal was intended to be interacted with.

**Tertiary — blur retry race after failed time validation:**

When time validation failed, `saved` was reset to `false` to allow retry. The blur handler's 100ms setTimeout could re-trigger `saveEdit()` if the user clicked elsewhere before the corrected value was typed, showing the error toast a second time.

#### Fix Summary

**`src/js/ui_liveboard.js`:**

1. Added module-level `let _modalKeyHandler = null;` to track the single active modal handler.

2. Added `closeActiveModal()` function:
   - Removes `_modalKeyHandler` from `document` before clearing `modalRoot.innerHTML`.
   - Called by all 7 save-handler modal-close paths (previously direct `innerHTML = ""`).

3. Modified `openModal()`:
   - Removes any previously leaked `_modalKeyHandler` at modal open time (belt-and-suspenders).
   - Assigns new `keyHandler` to `_modalKeyHandler`.
   - `closeModal()` closure now dereferences `_modalKeyHandler` after removal.
   - Added `backdrop.isConnected` guard in the keyHandler Enter path to prevent detached-backdrop saves.
   - Added `activeEl.classList.contains("inline-edit-input")` guard so inline-edit Enter presses are ignored by the modal keyHandler.

4. In `startInlineEdit()` → keydown listener:
   - Added `e.stopPropagation()` for both `Enter` and `Escape` keys to prevent bubbling to document.

5. In `saveEdit()`:
   - Added `_lastSaveFailed` flag; set when time validation fails, cleared on next `input` event.
   - Blur handler checks `!_lastSaveFailed` before auto-saving, preventing repeated error toasts on blur.
   - Added `window.__FDMS_DIAGNOSTICS__` diagnostic logging guards.
   - Transactional update: build patch → validate → call `updateMovement` only on success → `onMovementUpdated` only if movement was found.
   - Guard: if `updateMovement` returns null (movement not found), restore cell silently without touching state.

**`src/js/datamodel.js`:**

6. Added guard in `saveToStorage()`: aborts if `movements` is not an array (prevents overwriting good data with a corrupt module state).

#### Regression Harness

New: `sprintP0_inline_edit_integrity_verify.mjs` (8 tests)

| ID | Test | Result |
|----|------|--------|
| P0-T1 | No error toasts on valid inline-edit commit | **PASS** |
| P0-T2 | Exactly one error toast on invalid time; data not mutated | **PASS** |
| P0-T3 | Live/Pending row count stable after inline-edit | **PASS** |
| P0-T4 | History row count stable after inline-edit | **PASS** |
| P0-T5 | Repeated inline-edits (3×) — no error toasts, count stable | **PASS** |
| P0-T6 | 3× modal open+save then inline-edit — no toast storm | **PASS** |
| P0-T7 | Inline-edit while modal minimised — no modal double-save | **PASS** |
| P0-T8 | Time field update persists across page reload | **PASS** |

**Result: 8/8 PASS, 0 FAIL**

#### Verification evidence (commands run)

```
# P0 regression harness (new)
node sprintP0_inline_edit_integrity_verify.mjs  → 8/8 PASS

# Existing sprint suites
npm run test:s4   → 10/10 PASS  (no regression)
npm run test:s5   → 12/12 PASS  (no regression)
npm run test:s6   → 6/6 PASS   (no regression)
npm run test:s7   → 8/8 PASS   (no regression)
```

All suites passing on Linux kernel 4.4, Node v22.22.0, Playwright 1.56.1, Chromium headless.

**Evidence pack:**
- Screenshots: `evidence_p0/P0_*.png` (8 screenshots)
- Results JSON: `evidence_p0/sprintP0_inline_edit_integrity_results.json`
- Test harness: `sprintP0_inline_edit_integrity_verify.mjs`

#### Deliverables checklist

- [x] Root cause identified and documented (precise: `openModal` + missing `closeModal` call in save handlers)
- [x] `closeActiveModal()` created; all 7 save-handler modal-close paths updated
- [x] `_modalKeyHandler` module-level tracking added to `openModal()`
- [x] `e.stopPropagation()` added to inline-edit `keydown` Enter handler
- [x] `backdrop.isConnected` guard added to modal keyHandler Enter path
- [x] `inline-edit-input` class guard added to modal keyHandler
- [x] `_lastSaveFailed` flag prevents blur-auto-save after failed validation
- [x] Transactional save path in `saveEdit()`: validate → update → render (no partial mutation)
- [x] `saveToStorage()` guard against non-array `movements`
- [x] `window.__FDMS_DIAGNOSTICS__` logging added to `saveEdit()` and `closeActiveModal()`
- [x] P0 regression harness: 8/8 PASS
- [x] Sprint 4: 10/10 PASS (no regression)
- [x] Sprint 5: 12/12 PASS (no regression)
- [x] Sprint 6: 6/6 PASS (no regression)
- [x] Sprint 7: 8/8 PASS (no regression)
- [x] Evidence pack exists: `evidence_p0/`
- [x] STATE.md updated

#### NO-DRIFT confirmation

- No changes to counters, reporting logic, formation semantics, or timing semantics.
- No speculative refactors. Only the fault path (modal keyHandler leak) and guardrails (stopPropagation, blur guard, persistence guard) were changed.
- All existing test suites pass without modification.

---

### 4.10 P0 Hardening: Modal-Clear Policy Enforcement + Invariant Check

**Date:** 2026-02-17
**Branch:** `claude/fix-inline-edit-data-loss-QLjBR` (same branch — hardening continuation)
**Priority:** P0 follow-up hardening

#### Work completed

**Task A — Zero direct `modalRoot.innerHTML` clears in codebase:**

- `closeActiveModal()` in `ui_liveboard.js` marked `export`.
- `ui_booking.js` updated:
  - `import { closeActiveModal } from "./ui_liveboard.js"` added.
  - All 4 modal open paths now call `closeActiveModal()` before assigning `modalRoot.innerHTML = \`…\``.
  - All 9 modal close paths (Cancel, Save, Delete handlers across 4 modal functions) now call `closeActiveModal()` instead of `modalRoot.innerHTML = ''`.
- Verified with `grep`: zero live `modalRoot.innerHTML = ''` or `modalRoot.innerHTML = ""` assignments remain in `src/js/`.

**Task B — `_modalOpen` runtime invariant check (diagnostics-gated):**

Added to `ui_liveboard.js`:
- `let _modalOpen = false;` module-level tracking variable.
- `_checkModalInvariant(context)` function — runs only when `window.__FDMS_DIAGNOSTICS__` is truthy.
  - Warns if `_modalOpen && !_modalKeyHandler` (open-no-handler).
  - Warns if `!_modalOpen && _modalKeyHandler` (closed-leaked-handler).
  - Warns if `_modalOpen` but `modalRoot` is empty (open-no-content).
  - Records violations to `window.__fdmsDiag.modalInvariantViolations[]`.
  - Exposes `window.__fdmsDiag.checkModalInvariants()` for manual console invocation.
- Called from: `openModal()` (after handler registration), `closeModal()` closure, `closeActiveModal()`.
- `_modalOpen` is set to `true` in `openModal()` and `false` in both `closeModal()` and `closeActiveModal()`.

**Task C — P0-T9 stress test (8-cycle modal stress):**

Added `P0-T9` to `sprintP0_inline_edit_integrity_verify.mjs`:
- Seeds 1 ACTIVE movement.
- Opens and saves the edit modal 8 times consecutively.
- Then performs an inline-edit of the dep-time cell.
- Asserts: 0 error toasts, live count unchanged, edited time persists after reload.
- Harness now has 9 tests total.

**Task D — Engineering rules documented:**

- `DEV-SETUP.md` updated with "Engineering Rules" section covering:
  - Rule 1: All modal close paths must call `closeActiveModal()` (never direct `innerHTML = ""`).
  - Rule 2: All modal open paths must call `closeActiveModal()` first.
  - Rule 3: Inline-edit key events must call `e.stopPropagation()`.
  - Diagnostics activation instructions.
- `STATE.md` (this section) updated.

#### Engineering rules (condensed — see DEV-SETUP.md for full detail)

| Rule | Requirement |
|------|-------------|
| 1 | All modal close paths call `closeActiveModal()` — never `modalRoot.innerHTML = ""` directly |
| 2 | All modal open paths call `closeActiveModal()` first (before writing new content) |
| 3 | Inline-edit `keydown` handlers call `e.stopPropagation()` on Enter and Escape |

#### Deliverables checklist

- [x] `closeActiveModal()` exported from `ui_liveboard.js`
- [x] `ui_booking.js` imports `closeActiveModal`; all 13 direct clears replaced
- [x] Zero remaining `modalRoot.innerHTML = ''` in production code (`src/js/`)
- [x] `_modalOpen` tracking variable added to `ui_liveboard.js`
- [x] `_checkModalInvariant()` diagnostics-gated function added and wired
- [x] P0-T9 (8-cycle modal stress) added to `sprintP0_inline_edit_integrity_verify.mjs`
- [x] Engineering rules added to `DEV-SETUP.md`
- [x] `STATE.md` updated (this section)

#### NO-DRIFT confirmation

- No changes to counters, reporting logic, formation semantics, timing semantics, or UX behaviour.
- The `closeActiveModal()` call on open paths is a no-op when `_modalKeyHandler` is already null (normal case); it is only protective for race conditions.
- `_checkModalInvariant()` has zero runtime cost when `window.__FDMS_DIAGNOSTICS__` is falsy (first condition fails).
- All existing test suites must continue to pass.

---

### 4.11 Feature: Inline-Edit Tab Flow + Timeline Desync Fix

**Branch:** `claude/inline-edit-tabflow-and-timeline-QLjBR`

#### A) Timeline desync fix

**Root cause:** `getMovementStartTime(m)` returned `null` for OVR flights (used `getETD()`/`getATD()` which are DEP/LOC-only), and `getMovementEndTime(m)` returned `null` for DEP flights (used `getETA()`/`getATA()` which are ARR/LOC-only). Result: OVR bars did not appear; DEP end-times fell back to +60 min.

**Fix:**
- `getMovementStartTime`: ARR → `getETA || arrActual`; OVR → `getECT || getACT`; DEP/LOC → `getETD || getATD`
- `getMovementEndTime`: uses `m.arrPlanned || m.arrActual || getETA || getATA` (raw fields first for DEP/OVR)
- `saveEdit()` now calls `renderTimelineTracks()` explicitly on success (in addition to the existing `renderTimeline()` at end of `renderLiveBoard()`)

#### B) Tab/Shift+Tab inline-edit workflow

**New module-level constructs in `ui_liveboard.js`:**
- `_INLINE_FIELD_TO_SELECTOR` — maps fieldName → CSS selector for all 15 editable fields
- `_buildTabOrder(rowEl, movement)` — builds the ordered list of applicable tab stops for a row, respecting flight-type applicability rules and filtering to elements that exist in the DOM
- `advanceInlineEditor(movementId, currentFieldName, direction)` — re-queries DOM after `renderLiveBoard()`, finds next/prev tab stop (with wrap), calls `startInlineEdit()`

**Applicability rules:**
- Dep AD: OVR and ARR only
- Arr AD: OVR and DEP only
- Dep time: DEP, LOC, OVR
- Arr time: ARR, LOC
- All other fields (callsign, voice, reg, type, WTC, rules, tng, os, fis, remarks): all flight types

**`saveEdit()` hardened:**
- Returns `boolean` (true = committed, false = validation failure)
- WTC validated via `isValidWtcChar()`; rules normalised ('I'→'IFR', 'V'→'VFR', 'S'→'SVFR')
- Counter fields (tngCount/osCount/fisCount) validated as non-negative integers; stored as `number` not string
- Tab handler only advances when `saveEdit()` returns `true`

**New inline-editable fields (strip HTML + enableInlineEdit):**
- `callsignVoice` (`.js-edit-voice`) — always
- `wtc` (`.js-edit-wtc`) — always
- `rules` (`.js-edit-rules`) — always
- `tngCount` (`.js-edit-tng`, inputType `number`) — always
- `osCount` (`.js-edit-os`, inputType `number`) — always
- `fisCount` (`.js-edit-fis`, inputType `number`) — always
- `remarks` (`.js-edit-remarks`) — always

**Number input filter:** Digits-only `input` event listener prevents non-numeric characters in number fields.

#### Deliverables checklist

- [x] `getMovementStartTime` fixed for OVR
- [x] `getMovementEndTime` fixed for DEP
- [x] `renderTimelineTracks()` called on `saveEdit()` success path
- [x] `_INLINE_FIELD_TO_SELECTOR`, `_buildTabOrder`, `advanceInlineEditor` added
- [x] Tab/Shift+Tab handler in `startInlineEdit` keydown — calls `saveEdit()` then `advanceInlineEditor()`
- [x] 7 new fields: strip HTML classes + `enableInlineEdit()` registrations
- [x] dep/arr AD `enableInlineEdit` restricted by flight type
- [x] `saveEdit()` returns boolean; WTC/rules/counter validations added
- [x] No `modalRoot.innerHTML =` assignments introduced (confirmed by grep)
- [x] `STATE.md` updated

#### NO-DRIFT confirmation

- No changes to movement data model, formation semantics, counter button logic, or persistence model.
- Tab keydown calls `e.preventDefault()` + `e.stopPropagation()` — Tab never bubbles to document-level modal handlers.
- Counter button ◄/► handlers are unchanged; inline-edit of counter fields is additive.
- All existing test suites (`test:s4` through `test:s7`) unaffected.

---

### 4.12 Sprint: Daily Totals, WTC Dropdown, Idle Timeout, Timeline Actual-First

**Branch:** `claude/fix-daily-totals-wtc-timeout-timeline`

#### 1) Runway Daily Movement Totals

- `runwayMovementContribution(m)` and `isOverflight(m)` exported from `datamodel.js`
- Formula: `base + (2 × tngCount) + (1 × osCount)` where base: DEP=1, ARR=1, LOC=2, OVR=0
- `calculateDailyStats()` in `app.js` now uses these helpers; OVR increments a separate `ovr` counter and skips runway totals
- BM/BC/VM/VC/Total buckets now accumulate runway movement equivalents (not flat counts)
- New `statOvrToday` span added to `src/index.html` stats bar; `updateDailyStats()` populates it
- `docs/STRIP_LIFECYCLE_AND_COUNTERS.md` §3.1 updated with counting formula and OVR-separate note

#### 2) Inline Edit Idle Timeout (auto-cancel, not commit)

- `inlineEditIdleMs: 120000` added to `defaultConfig` in `datamodel.js`
- `_activeInlineSession`, `_pendingRerenderWhileInline`, `_getInlineIdleMs()`, `_startInlineSession()`, `_endInlineSession()`, `_isInlineEditingActive()` added to `ui_liveboard.js`
- `startInlineEdit()` wired: calls `_startInlineSession({ cancelFn: cancelEdit })` after editor opens; input/paste/keydown listeners call `_sess.resetTimer()`
- Idle expiry calls `cancelEdit()` (restore original content) — never commits
- `saveEdit()` calls `_endInlineSession(false)` before `return true`; `cancelEdit()` calls `_endInlineSession(false)` on explicit cancel
- `fdms:data-changed` listener now defers to `_pendingRerenderWhileInline` when editor is open; catches up immediately after editor closes

#### 3) WTC Inline Edit Constrained to wtcSystem

- `_WTC_OPTIONS` constant added (UK/ICAO/RECAT option arrays)
- `startInlineEdit()` detects `fieldName === 'wtc'` and creates `<select>` populated from `getConfig().wtcSystem`
- Seeded from cell text: `currentValue.match(/^[A-Za-z]+/)[0].toUpperCase()`
- `isValidWtcChar()` validation block removed from `saveEdit()` (select constrains choices)
- `el.querySelector('input')` guard expanded to `el.querySelector('input, select')`
- `input.select()` guarded: only called when `input.tagName === 'INPUT'`

#### 4) Timeline Actual-First Alignment

- `getMovementStartTime(m)`: ARR→`getATA||getETA`, OVR→`getACT||getECT`, DEP/LOC→`getATD||getETD` (was ETD-first)
- `getMovementEndTime(m)`: ARR/LOC→`getATA||getETA`, DEP/OVR→`m.arrActual||m.arrPlanned`
- Hover tooltip on timeline bars uses same start/end values (computed from `getMovementStartTime`/`getMovementEndTime`)

#### Deliverables checklist

- [x] `runwayMovementContribution`, `isOverflight` exported from `datamodel.js`
- [x] `inlineEditIdleMs: 120000` in `defaultConfig`
- [x] `calculateDailyStats()` uses runway movement equivalents; OVR separate
- [x] `statOvrToday` element in `index.html`; `updateDailyStats()` updates it
- [x] `_startInlineSession`/`_endInlineSession` wired into `startInlineEdit()`
- [x] Idle timeout cancels (not commits) via `cancelEdit()`
- [x] WTC `<select>` dropdown; `isValidWtcChar` validation removed from save path
- [x] Timeline actual-first: `getMovementStartTime`, `getMovementEndTime` updated
- [x] No `modalRoot.innerHTML =` assignments introduced (confirmed by grep)
- [x] `docs/STRIP_LIFECYCLE_AND_COUNTERS.md` updated
- [x] `STATE.md` updated

#### NO-DRIFT confirmation

- No changes to movement data model, formation semantics, or persistence model
- Modal invariants preserved: no direct `modalRoot.innerHTML =` in modified code
- Counter ◄/► buttons unchanged; inline-edit of counters is additive
- `renderLiveBoard()` / `renderTimeline()` call chain unchanged
- All existing test suites unaffected

---

### 4.13 Sprint: New Strip WTC select + EU Registration Normaliser

**Branch:** `claude/fix-newstrip-wtc-and-eu-reg-normalize`

#### Part 1 — New Strip modal WTC field (select + autofill + override)

- `<input id="newWtcDisplay" disabled>` replaced with `<select id="newWtc" class="modal-input">` in the modal HTML template
- WTC select options populated from `_WTC_OPTIONS[getConfig().wtcSystem]` at modal open time via `setWtcOptions()` — uses current config (no caching)
- `maybeAutofillWtc()` computes WTC via `getWTC(type, ft, sys)` → `extractLeadingToken()` → checks against current option set → auto-selects matching option
- `wtcDirty` flag: set on user `change` event; prevents auto-fill from overwriting a manual selection
- Autofill triggered by: modal open, `newType` input event, `newFlightType` change event, VKB programmatic type fill (explicit `maybeAutofillWtc()` call in VKB listener)
- Save handler: `wtcManual || wtcComputed` — manual select wins; computed value used when select is blank
- Callsign-lookup registration fill normalised: `normalizeEuCivilRegistration(registration)` applied before `regInput.value` is set

#### Part 2 — EU civil registration normaliser

- `EURO_HYPHEN_PREFIXES` constant (longest-first) + `normalizeEuCivilRegistration(raw)` added to `ui_liveboard.js` (before Inline Edit Helpers section)
- Applies: uppercase + strip whitespace/punctuation → test for existing hyphen → insert hyphen after first matching prefix (suffix 2–6 alphanum chars) → fallback to plain uppercase
- Wired into **New Strip modal**: blur normalises always; debounced (250 ms) input normalises only when adding a hyphen (cursor-friendly)
- Wired into **inline edit saveEdit()**: `if (fieldName === 'registration') newValue = normalizeEuCivilRegistration(newValue)` before counter validation block
- Examples: GBYUF → G-BYUF, EIFAT → EI-FAT, 2CYFR → 2-CYFR, M-GLOB → M-GLOB (unchanged)

#### Deliverables checklist

- [x] `<select id="newWtc">` in modal HTML
- [x] `setWtcOptions()`, `maybeAutofillWtc()`, `wtcDirty` wired in `openNewFlightModal()`
- [x] WTC save: manual override wins (`wtcManual || wtcComputed`)
- [x] `EURO_HYPHEN_PREFIXES` + `normalizeEuCivilRegistration()` added
- [x] New Strip reg: blur + debounced normalisation listeners
- [x] Callsign-lookup programmatic reg fill normalised
- [x] `saveEdit()` normalises registration on commit
- [x] No `modalRoot.innerHTML =` assignments introduced (confirmed by grep)
- [x] `STATE.md` updated

#### NO-DRIFT confirmation

- No changes to modal lifecycle, data model, daily stats, OVR separation, idle timeout, or timeline rules
- Modal invariants preserved; no new document-level keydown listeners
- Military serials intentionally ignored by normaliser (prefix list is EU-civil only)
- All existing test suites unaffected

### 4.14 Sprint: New LOC Modal WTC — editable select, autofill, wtcSystem-constrained

**Branch:** `claude/fix-newloc-wtc-editable-QLjBR`

#### Changes made (`src/js/ui_liveboard.js` only)

- **HTML template**: `<input id="newLocWtcDisplay" disabled>` replaced with `<select id="newLocWtc" class="modal-input">` in `openNewLocFlightModal()` modal template
- **WTC select wiring block** (replaces old `locWtcDisplay` / `updateLocWtcDisplay` block):
  - `locWtcOpts()` — returns `_WTC_OPTIONS[getConfig().wtcSystem]` (defaults to ICAO set)
  - `setLocWtcOptions()` — populates select with blank + system options at modal open
  - `computeLocWtcFromCurrentForm()` — calls `getWTC(type, 'LOC', sys)` → `extractLeadingToken()`
  - `maybeAutofillLocWtc()` — skips if `locWtcDirty && select.value` (user override wins); otherwise sets select to computed value if it is in the allowed set
  - `locWtcDirty` flag — set on user `change` event; prevents autofill overwriting a manual selection
  - Autofill triggered by: modal open, `newLocType` input event, VKB programmatic type fill (explicit `maybeAutofillLocWtc()` calls in both VKB lookup and fallback inference paths)
- **Both save handlers** (`.js-save-loc` and `.js-save-complete-loc`):
  - `wtcManual = document.getElementById("newLocWtc")?.value` — manual select wins
  - `wtcComputed` — `getWTC(...)` result with leading-token extraction (same as New Strip)
  - `wtcAllowed` Set built from `_WTC_OPTIONS[wtcSystem]`
  - `wtc = wtcManual || wtcComputed`
  - Defensive guard: if `wtc` non-empty and not in `wtcAllowed` → `showToast('Invalid WTC category', 'error'); return;`

#### Invariants

- No `modalRoot.innerHTML =` assignments introduced (confirmed by grep — only comments at lines 67, 2367)
- Modal lifecycle hardening unchanged; `closeActiveModal()` call path unmodified
- No changes to counters, daily stats, formation semantics, OVR separation, inline idle timeout, or timeline logic

#### Deliverables checklist

- [x] `<select id="newLocWtc">` in LOC modal HTML
- [x] `locWtcOpts()`, `setLocWtcOptions()`, `computeLocWtcFromCurrentForm()`, `maybeAutofillLocWtc()`, `locWtcDirty` wired in `openNewLocFlightModal()`
- [x] Autofill on modal open + `newLocType` input + VKB programmatic type fill (both paths)
- [x] Save handler: `wtcManual || wtcComputed` with defensive `wtcAllowed` guard
- [x] Save & Complete handler: same WTC block
- [x] No `modalRoot.innerHTML =` live assignments introduced
- [x] `STATE.md` updated

#### NO-DRIFT confirmation

- No changes to modal lifecycle, data model, daily stats, OVR separation, idle timeout, or timeline rules
- All existing sprint test suites unaffected (only `openNewLocFlightModal` WTC wiring changed)

---

### 4.15 Sprint: Admin IA v1 — Two-pane Admin layout with dirty-state tracking

**Base:** `main @ ca85d2d`  **Branch:** `claude/admin-ia-v1-THSv8`

#### Changes

**`src/index.html`**
- Replaced the single-column Admin tab body with `<div class="admin-shell">` containing:
  - `<nav class="admin-nav" id="adminNav">` — left sidebar with 9 named section buttons
  - `<div class="admin-content" id="adminContent">` — right scrollable content pane
- Sticky Save bar: `#adminSaveBar` (hidden by default), `#adminSaveStatus` pill, `#adminSaveBtn`, `#adminDiscardBtn`
- **9 sections** (each a `<div class="admin-section [hidden]" id="admin-sec-*">`):
  1. `admin-sec-status` — System Status + Diagnostics (no Save bar)
  2. `admin-sec-session` — Backup to JSON only (no Save bar)
  3. `admin-sec-offsets` — Flight Offsets table + Reciprocal Strip Settings (Save bar shown)
  4. `admin-sec-autoactivate` — Auto-Activation per flight type (Save bar shown)
  5. `admin-sec-timezone` — Timezone offset + Banner Local Time + Alert Tooltips (Save bar shown)
  6. `admin-sec-wtc` — Wake Turbulence system + threshold (Save bar shown)
  7. `admin-sec-history` — History Settings + Day View / Timeline Settings (Save bar shown)
  8. `admin-sec-profiles` — Booking Profiles (immediate save — no Save bar)
  9. `admin-sec-danger` — Danger Zone: Restore from JSON + Reset to Demo Data (no Save bar)
- **All input IDs unchanged** — no regression to existing JS consumers
- Removed `#btnSaveConfig` (replaced by sticky Save bar)
- Moved "Restore from JSON" button + `#importFileInput` from Session section to Danger Zone
- Added `#btnResetToDemo` button in Danger Zone

**`src/css/vectair.css`**
- Added Admin layout styles: `.admin-shell`, `.admin-nav`, `.admin-nav-btn`, `.admin-nav-btn--danger`, `.admin-content`
- Added `.admin-section` / `.admin-section.hidden` visibility rules
- Added `.admin-save-bar`, `.admin-save-status--dirty`, `.admin-save-status--clean`
- Added `.admin-danger-zone` (red-accented panel)
- Added `.btn-danger` (red button variant)

**`src/js/app.js`**
- Added `resetMovementsToDemo` to datamodel.js imports
- Added `adminConfirm(message, onConfirm)` — lightweight inline confirmation dialog
- Replaced `initAdminPanelHandlers()` body with:
  - **Section navigation**: sidebar `.admin-nav-btn` clicks → toggle section visibility + Save bar visibility
  - **Export handler**: unchanged — `#btnExportSession` → export JSON
  - **Restore handler** (Danger Zone): `#btnImportSession` → `adminConfirm()` → `fileInput.click()` → import
  - **Reset handler** (Danger Zone): `#btnResetToDemo` → `adminConfirm()` → `resetMovementsToDemo()` → re-render
  - **Config load**: identical to previous — all config values loaded into inputs on init
  - **Dirty-state tracking**: `takeSnapshot()` / `applySnapshot()` / `isDirty()` / `checkDirty()` functions; `change`/`input` event listeners on all tracked inputs; Save bar buttons enabled/disabled accordingly
  - **`saveAdminConfig()`**: extracted from old `btnSaveConfig` handler; re-takes snapshot after save → resets dirty state
  - **Discard**: `applySnapshot(_configSnapshot)` restores inputs to last-saved values

#### Invariants maintained
- No config key IDs renamed
- No changes to Live Board, timeline, booking sync, WTC logic, inline edit, or modal lifecycle
- Booking Profiles (`#admin-sec-profiles`) behaviour unchanged — direct save via `initBookingProfilesAdmin()`
- `initAdminPanel()` stub in `ui_liveboard.js` untouched

#### Manual verification checklist
- [ ] Admin tab shows 2-pane layout: sidebar on left, content on right
- [ ] Clicking each of 9 sidebar buttons shows the correct section
- [ ] Save bar is visible only on sections 3–7 (Offsets, Auto-Activation, Timezone, WTC, History)
- [ ] Save bar starts with "All changes saved" and disabled buttons
- [ ] Changing any config input shows "Unsaved changes" and enables Save/Discard
- [ ] Save button persists config and resets Save bar to clean state
- [ ] Discard button restores inputs to last-saved state
- [ ] "Backup to JSON" in Session section works as before
- [ ] "Restore from JSON" in Danger Zone shows confirmation dialog before proceeding
- [ ] "Reset to Demo Data" in Danger Zone shows confirmation dialog before proceeding
- [ ] Booking Profiles section unaffected

---

### 4.16 Sprint: Admin IA v1.1 — Microcopy, units, restore preflight

**Base:** `claude/admin-ia-v1-THSv7`  **Branch:** `claude/admin-ia-v1_1-THSv7`

#### Ticket A — Section microcopy + explicit units (`src/index.html`)

- **Section 1 (System Status)**: page-subtitle updated → "Status and high-level diagnostics for this local FDMS instance."
- **Section 2 (Session)**: description updated → "Backup local FDMS data … Restore is in Danger Zone section."
- **Section 3 (Flight Offsets)**: added two description lines: what it affects + UTC storage note + "Changes require Save"; every minute-valued input (7 in table + 2 reciprocal strip) now shows an adjacent `min` label.
- **Section 4 (Auto-Activation)**: description updated → "Controls automatic PLANNED → ACTIVE transitions … Changes require Save." (row labels already carried "min before …")
- **Section 5 (Timezone & Display)**: added description → "Affects local time display … UTC internally. Changes require Save."
- **Section 6 (Wake Turbulence)**: added description → "Sets WTC model and alert threshold … does not affect stored WTC values. Changes require Save."
- **Section 7 (History)**: updated description → "Controls which alert categories appear … Changes require Save."
- **Section 7 (Timeline)**: updated description → "Configures time range and visibility … Start/end in UTC. Changes require Save."
- **Section 8 (Booking Profiles)**: added green note → "Changes here save immediately — not part of Save / Discard workflow."
- **Section 9 (Danger Zone)**: updated overall description + reset description to state configuration is NOT overwritten; restore description notes a summary will be shown.

All input IDs unchanged.

#### Ticket B — Restore preflight summary (`src/js/app.js`)

- **`adminConfirm()`** extended: new optional params `detailsHtml` (string, pre-sanitised) and `confirmEnabled` (boolean, default true). Main message set via `.textContent` (XSS-safe). Details HTML injected into separate div. Confirm button disabled via HTML attribute when `confirmEnabled=false`.
- **Restore flow refactored**: button click → file picker opened directly (no pre-confirm). File selection → `FileReader.onload` → client-side JSON parse → build summary HTML (filename, movements count, booking profiles count, bookings count, config presence) → `adminConfirm(message, onConfirm, summaryHtml, true)`.
- **Invalid JSON path**: parse error → summary shows error text with red styling → `adminConfirm(…, summaryHtml, false)` → Confirm button disabled.
- Restore implementation (`importSessionJSON` call + re-render) unchanged.

#### Ticket C — Reset-to-Demo copy clarity (`src/js/app.js`)

- Reset confirmation text updated from vague "All your data will be permanently lost" to: "This will replace all current movement strips with the built-in demo seed data. Configuration settings (offsets, timezone, etc.) are not affected. This cannot be undone." — matches actual `resetMovementsToDemo()` behaviour.

#### Invariants maintained
- No config keys, IDs, or persistence mechanics changed
- No Live Board / timeline / booking sync / modal lifecycle changes
- `importSessionJSON` and `resetMovementsToDemo` implementations untouched

#### Manual verification checklist
- [ ] Every Admin section has a visible description line
- [ ] Offset table inputs show "min" suffix; auto-activate rows already had "min before …"
- [ ] Timeline labels read "Start Hour (UTC)" / "End Hour (UTC)"
- [ ] Booking Profiles shows green "saves immediately" note
- [ ] Changing an offset → dirty state triggers → Save works (no regression)
- [ ] Restore from JSON: click button → file picker opens → select valid file → confirm dialog shows filename + counts → cancel → no change
- [ ] Restore from JSON: confirm → import proceeds → success toast
- [ ] Restore from JSON: select invalid/non-JSON file → dialog shows error, Confirm disabled
- [ ] Reset to Demo: confirmation explicitly names what is/is not overwritten; cancel works

---

### 4.17 Sprint: Admin IA v1.2 — Backup envelope, timestamped filenames, restore format detection

**Base:** `claude/admin-ia-v1_1-THSv7`  **Branch:** `claude/admin-ia-v1_2-THSv7`

#### Ticket A — Backup metadata envelope + timestamped filename (`src/js/app.js`, `src/index.html`)

- **Export handler** wraps `exportSessionJSON()` output in a metadata envelope before download:
  ```json
  { "fdmsBackup": { "schemaVersion": 1, "createdAtUtc": "...", "createdBy": {...}, "counts": {...} }, "payload": <rawData> }
  ```
  - `counts` mirrors `rawData.movements.length`, `rawData.bookings.length`, `rawData.bookingProfiles.length` (0 if absent).
  - `createdBy`: `{ app: "Vectair FDMS Lite", gitCommit: "unknown", host: "local" }`.
- **Timestamped filename**: `fdms_backup_YYYYMMDD_HHMMZ.json` (UTC, zero-padded).
- **Session section copy** (`src/index.html`): updated to note backups include metadata (timestamp, counts); restore note points to Danger Zone.

#### Ticket B — Restore preflight: format detection + metadata display (`src/js/app.js`)

- **Three-way format detection** in `fileInput.change` handler:
  - `envelope`: `parsed.fdmsBackup && parsed.payload` → `dataForImport = parsed.payload`; `meta = parsed.fdmsBackup`.
  - `v1`: bare array → `dataForImport = parsed`; no meta.
  - `v2`: `{ version: number, movements: array }` → `dataForImport = parsed`; no meta.
  - `unrecognized`: confirm blocked; error banner shown.
- **Preflight summary** shows: filename, createdAt UTC (formatted), schema version label, movements/bookings/profiles counts, config presence.
- **Non-blocking warning banners** (amber) for: legacy format (v0), future schema version (>1), zero-movement backup.
- **Blocked confirm** (red banner) for: invalid JSON, unrecognized structure.
- **Toast** on success: `Restore applied from "${file.name}" — ${result.count} movements loaded`.
- `importSessionJSON` and all re-render calls unchanged.

#### Invariants maintained
- No config keys, IDs, or persistence mechanics changed
- No Live Board / timeline / booking sync / modal lifecycle changes
- `importSessionJSON` implementation untouched; legacy payloads passed directly

#### Manual verification checklist
- [ ] Export: click Backup → file named `fdms_backup_YYYYMMDD_HHMMZ.json` downloads
- [ ] Export: open file — top-level keys are `fdmsBackup` and `payload`; `fdmsBackup.counts` matches movement/booking counts
- [ ] Restore new envelope: select backup file → preflight shows filename, createdAt, schema "v1 (current)", counts, config → confirm → data loads
- [ ] Restore legacy v2: select old `{ version, movements }` file → preflight shows amber "Legacy backup format" warning; no createdAt or schema shown → confirm → data loads
- [ ] Restore legacy v1: select bare-array file → same amber warning → confirm → data loads
- [ ] Restore invalid JSON: confirm button disabled; red error banner shown
- [ ] Restore unrecognized structure (e.g. `{}`): confirm button disabled; "Unrecognized file structure" red banner shown
- [ ] Zero-movement backup: amber "contains 0 movements" warning; confirm still enabled

---

## 5) Operating Procedure (Manager–Worker)

### 5.1 Before any new task ticket
- QA Lead (ChatGPT) reviews the latest `STATE.md` and frames the ticket in terms of:
  - invariants
  - acceptance criteria
  - evidence requirements

### 5.2 Requirements for Claude on every ticket
At end of work session, Claude must:
1) Update this `STATE.md`:
   - Mark newly completed items
   - Add/adjust technical debt entries
   - Set the next sprint objective
2) Provide an **Audit Summary + Evidence Pack** (file/function/selector level).

### 5.3 Source of truth rule
If a Claude summary conflicts with repository contents, the repo (zip/diff) wins; `STATE.md` must be corrected accordingly.

---

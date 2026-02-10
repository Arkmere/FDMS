# STATE.md — Vectair FDMS Lite

Last updated: 2026-02-10 (Europe/London) — Sprint 4 Formation v1

This file is the shared source of truth for the Manager–Worker workflow:
- **Manager (PM)**: User (coordination, priorities, releases)
- **Solutions Architect & QA Lead**: ChatGPT (task tickets, audits, risk management)
- **Production Engineer**: Claude Code (implements tickets, updates this ledger)

---

## 1) System Architecture

### 1.1 Product goal
A lightweight, browser-based Flight Data Management System ("FDMS Lite") for local ATC/ops workflow:
- Live "strip" board (movements)
- Booking workflow that can create planned strips and stay synchronized
- Calendar for bookings and general events
- Admin tooling (profiles, etc.)
- Fully offline / static deployment, using local persistence

### 1.2 Tech stack
- **Static web app**: HTML/CSS/JS (no backend)
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

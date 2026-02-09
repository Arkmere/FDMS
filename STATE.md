# STATE.md — Vectair FDMS Lite

Last updated: 2026-02-09 (Europe/London)

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
- Confirm `fdms:data-changed` dispatch/listen does not cause loops or redundant re-renders in edge flows
- Reentrancy guards in place; no-op optimization added
- Risk mitigated but not exhaustively tested under all edge conditions

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
- Remaining risk: Complex edge flows not exhaustively tested (recommend manual QA)

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

**Issue:** Admin panel init failed due to a stale call to `ensureBookingsInitialised()` still present in `src/js/ui_booking.js` after the bookings store refactor.

**Change:** Removed the stale `ensureBookingsInitialised()` call from `src/js/ui_booking.js`.
- If booking UI required explicit load, replaced with the canonical store entrypoint `bookingsStore.loadBookings()` (no legacy initializer names).
- Confirmed no remaining references to `ensureBookingsInitialised()` in repo.

**Verification (QA):**
- Hard reload with cache disabled: admin panel renders and initializes normally.
- Console: no uncaught exceptions; specifically no `ReferenceError` for `ensureBookingsInitialised`.
- `git grep -n "ensureBookingsInitialised"` returns no matches.

**Evidence Pack (Claude to fill):**
- Commit: `<hash>`
- Grep output: `<paste output>`
- Console proof: `<screenshot or paste>`


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

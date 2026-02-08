# STATE.md — Vectair FDMS Lite

Last updated: 2026-02-06 (Europe/London)

This file is the shared source of truth for the Manager–Worker workflow:
- **Manager (PM)**: Stuart (coordination, priorities, releases)
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

### 4.2 Next concrete objective (Sprint 2)
**Awaiting task ticket from Solutions Architect.**

Potential priorities:
- End-to-end QA testing (manual or automated)
- Performance profiling under realistic data volumes
- User documentation for booking workflow
- Additional features (as scoped by PM/Architect)

### 4.3 Hotfix (Booking/Calendar ReferenceError)

**Issue:** Booking/Calendar crash due to a stale call to `ensureBookingsInitialised()` in `getBookingsForDate()` inside `src/js/ui_booking.js` after the bookings store refactor. This surfaced as a browser console `ReferenceError: ensureBookingsInitialised is not defined`.

**Change:** Updated `getBookingsForDate()` to read bookings via the store (`getBookings().filter(...)`) and removed any legacy init helper usage. Architecture remains: all booking reads/writes go through `src/js/stores/bookingsStore.js` (initialise-once + in-memory array), not a local `bookings` array.

**Verification (QA — code-level):** ✅ VERIFIED AT CODE LEVEL
- Branch: `main` at commit `da1e0fd`
- Repository state: clean working tree
- Repo check: `git grep -n "ensureBookingsInitialised"` returns only STATE.md documentation references (no code matches)
- Function `getBookingsForDate()` (src/js/ui_booking.js) uses canonical `getBookings()` accessor
- No direct `bookings` variable access in ui_booking.js
- Visiting Cars checkbox ID verified consistent: HTML + JS both use `bookingVisitingCars`

**Browser verification required:** ⚠️ PM (Stuart) must complete
- Open app locally (src/index.html via Live Server or http.server)
- Chrome DevTools → Network → "Disable cache" → Hard reload
- Clear Application → Storage → "Clear site data"
- Visit Booking page → Calendar page (Month/Week/Year views)
- Confirm Console: no `ReferenceError: ensureBookingsInitialised`
- Confirm Network: ui_booking.js loaded (200, not disk-cached)
- Capture screenshots/console output and update this section

**Evidence Pack:**
- Commit: da1e0fd (main branch HEAD)
- `git grep -n "ensureBookingsInitialised"` output:
  ```
  STATE.md:159:**Issue:** Admin panel init failed due to a stale call to `ensureBookingsInitialised()` ...
  STATE.md:161:**Change:** Removed the stale `ensureBookingsInitialised()` call ...
  STATE.md:163:- Confirmed no remaining references to `ensureBookingsInitialised()` ...
  STATE.md:167:- Console: no uncaught exceptions; specifically no `ReferenceError` for `ensureBookingsInitialised`.
  STATE.md:168:- `git grep -n "ensureBookingsInitialised"` returns no matches.
  ```
  (Only documentation references; zero code matches)
- Code verification: src/js/ui_booking.js:1439-1441 uses `getBookings().filter(...)` (canonical accessor)
- Checkbox ID consistency: bookingVisitingCars verified across HTML + JS

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

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

**Non-seeding + persistence**
- Demo seeding should not re-appear
- Persistence across reload is expected for movements/bookings/calendar/profiles

### 2.2 Backlog (known or suspected gaps)
These are not confirmed resolved unless explicitly audited against a fresh zip.

**Reconciliation completeness**
- Ensure `reconcileLinks()` enforces *both directions*:
  - clear `movement.bookingId` if booking missing ✅ (implemented)
  - clear `booking.linkedStripId` if movement missing ❓ (must confirm)
  - deterministic mismatch handling (booking points to strip A, strip points to booking B) ❓

**Canonical planned-time write coverage**
- Ensure *all* booking edits/creates write canonical fields:
  - New/edited booking UI may still write only `arrivalTimeLocalHHMM` unless patched to also set planned fields ❓
  - Migration only handles legacy-at-load; it won't fix new edits unless UI/store sets canonical fields

**No-op write churn**
- `updateBookingById()` should avoid unnecessary writes/dispatch if patch makes no actual change (quality/perf)

**Event / refresh storm safety**
- Confirm `fdms:data-changed` dispatch/listen does not cause loops or redundant re-renders in edge flows

---

## 3) Technical Debt & Risks

### 3.1 Data integrity / drift
- Risk: orphan pointers (`movement.bookingId`, `booking.linkedStripId`) if reconciliation is not fully bidirectional.
- Risk: schedule semantics drift if UI writes legacy fields only (canonical planned time absent).

### 3.2 Event-driven coupling
- Risk: re-render storms or subtle reentrancy issues if patch application triggers cascading events.
- Mitigation: reentrancy guards; avoid dispatching change events on no-op patches.

### 3.3 Schema evolution
- Any schema additions must remain backwards compatible and migrate once, deterministically.

---

## 4) Current Sprint (Immediate Objective)

**Sprint goal:** Close remaining integrity and schedule-consistency gaps and confirm via audit.

### 4.1 Next concrete objective (the very next task)
Perform a targeted audit/fix to ensure:
1) `bookingSync.reconcileLinks()` is fully bidirectional and deterministic.
2) Booking create/edit flows always set `schedule.plannedTimeLocalHHMM` + `schedule.plannedTimeKind` (and only set legacy `arrivalTimeLocalHHMM` where appropriate).
3) No-op patches do not write/dispatch (optional quality improvement, only if low-risk).

Exit criteria:
- PASS/FAIL checklist with exact file+function evidence.
- Orphan pointers repaired on load both directions.
- New/edited bookings always have canonical planned time populated.

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

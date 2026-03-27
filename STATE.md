# STATE.md — Vectair FDMS Lite

Last updated: 2026-03-26 (Europe/London) — Latest completed sprint: Ticket 6a (post-10.1) — Cancelled Sorties Log UX / History IA refinement

This file is the shared source of truth for the Manager–Worker workflow:

* **Product Owner / SME:** Stuart
* **Solutions Architect & QA Lead:** ChatGPT
* **Production Engineer:** Claude Code

This ledger exists to prevent drift, preserve project continuity across chats/sessions, and provide an audit-ready summary of what FDMS Lite is, how it behaves, what has been completed, and what remains intentionally deferred.

---

## 0) Delivery model / runtime model (NO DRIFT)

### 0.1 Product definition

**FDMS Lite is NOT a static web app and NOT a website.**
**FDMS Lite is a standalone desktop application** for Windows and Linux that uses **HTML/CSS/JS internally** as its UI technology.

During development and QA, the UI is served locally from `src/` via a small local server harness (for example `python -m http.server 8000`). That local server is a **development/runtime convenience only** and must **not** be described as product hosting.

### 0.2 OS support

* **Development OS:** Windows
* **Operational target:** Linux
* **Constraint:** both must remain supported

### 0.3 Release-v1 workflow

The current branch/PR/local-run workflow is approved for Release v1:

* code changes via git branches + PRs
* local execution via `run.ps1` / `run.bat` / `run.sh` or equivalent local harness
* manual verification on Stuart’s Windows environment is the primary acceptance path
* Playwright and other harnesses are **developer QA tooling**, not end-user runtime requirements

### 0.4 Explicitly out of scope unless separately scheduled

The following are **not** part of Release v1 unless explicitly promoted into a dedicated workstream:

* packaging / installers
* desktop wrapper work
* auto-update mechanisms
* hosted/web deployment path

Any future update mechanism should be based on versioned release artifacts, not “pull latest main and restart”.

### 0.5 Drift guardrails

Do not:

* describe FDMS Lite as a website or web app
* treat the local server harness as hosting
* introduce packaging/updater scope into normal feature sprints
* reinterpret desktop-local behaviour as browser-product behaviour

---

## 1) Product goal and system architecture

### 1.1 Product goal

FDMS Lite is a lightweight standalone ATC/ops support tool for local flight-data workflow. Core functions:

* Live Board for movement strips
* booking workflow that can create and stay linked to strips
* calendar for bookings and general events
* admin/config tooling
* local persistence via browser storage in the desktop-local runtime

### 1.2 Runtime/storage model

* Single-client local state model
* Persistence via localStorage
* No backend in current v1 scope
* No multi-user concurrency model

### 1.3 Core UI/data modules

The codebase is organized around these major responsibilities:

* **`src/js/app.js`** — bootstrap, first render, top-level coordination, admin handlers, reconciliation banner mount
* **`src/js/ui_liveboard.js`** — Live Board rendering, movement creation/editing, inline edit flows, timing UI, modal flows, formation UI
* **`src/js/ui_booking.js`** — booking UI and booking-side edit/create flows
* **`src/js/datamodel.js`** — movement storage, normalization, counters, helpers, persistence
* **`src/js/stores/bookingsStore.js`** — booking persistence, normalization, migrations
* **`src/js/services/bookingSync.js`** — booking ↔ strip synchronization and reconciliation logic
* **`src/css/vectair.css`** — main UI styling
* **`src/index.html`** — application shell and tab structure

### 1.4 Current important architectural characteristics

* booking/strip sync is event-driven but guarded against redundant loops
* reconciliation runs before first render to repair/clear stale bidirectional links deterministically
* canonical movement time fields are UTC `HH:MM` strings
* display can project those times into local time using configured offset
* modal lifecycle has explicit hardening rules to avoid stale key handlers and double-save behaviour

---

## 2) Operational invariants and non-negotiable behaviour

### 2.1 Movement and counter semantics

**Live Board daily totals use event-based (EGOW-realized) counting** (as of Sprint 9):

* DEP = 1 only if `depActual` exists
* ARR = 1 only if `arrActual` exists
* LOC = (depActual ? 1 : 0) + (2 × tngCount) + osCount + (arrActual ? 1 : 0)
* OVR = 0 always (counted separately in the generic overflights counter)
* FIS top-bar only counts strips with status ACTIVE or COMPLETED

**Official Monthly Return (reporting.js) uses nominal strip-type-based counting** (unchanged, intentional):

* LOC = 2, DEP/ARR = 1, OVR = 0
* T&G = +2, O/S = +1
* This is the official document format; it does not require actual events to have occurred.

These two systems are intentionally different. See the comment block at the top of `reporting.js` for the documented design decision.

### 2.2 Canonical movement time fields

Stored canonical time fields are:

* `depPlanned`
* `depActual` — operational actual, rounded to nearest minute when stamped by Active button
* `arrPlanned`
* `arrActual`
* `depActualExact` — exact second-bearing WTC anchor (HH:MM:SS), set alongside `depActual` by Active press for DEP/LOC/OVR; absent/empty for ARR and for records predating Ticket 4

These are stored as UTC strings (`HH:MM` for the four canonical fields; `HH:MM:SS` for `depActualExact`).
UI display may show them in UTC or Local depending on current display mode and configured offset.

### 2.3 Booking/strip link invariants

Booking/strip linkage is bidirectional when valid:

* a movement may carry `bookingId`
* a booking may carry `linkedStripId`

`bookingSync.reconcileLinks()` is responsible for deterministic repair/clear behaviour on load:

* clear `movement.bookingId` if referenced booking is missing
* clear `booking.linkedStripId` if referenced movement is missing
* repair `booking.linkedStripId` if exactly one strip validly claims the booking
* detect conflicts if multiple strips claim the same booking

### 2.4 Reconciliation reporting invariant

As of Sprint 8, reconciliation is no longer silent.

`reconcileLinks()` remains policy-compatible but now returns reporting detail sufficient for UI surfacing, including a backward-compatible `conflictList` field used by the integrity banner.

**Important:** this was a **reporting/output enrichment only**.
Reconciliation policy, conflict detection rules, and resolution behaviour were **not changed**.

### 2.5 Modal lifecycle rules

Engineering rule set:

1. All modal close paths must call `closeActiveModal()`
2. All modal open paths must call `closeActiveModal()` before opening a new modal
3. Inline-edit Enter/Escape key handlers must stop propagation appropriately
4. No direct ad-hoc modal teardown bypassing the lifecycle helper

### 2.6 Scope boundaries preserved so far

The following behaviours must not be changed casually because multiple sprints now depend on them:

* OVR remains excluded from daily movement totals
* LOC semantics remain distinct even where UI parity has been improved
* formation WTC semantics are already defined and implemented
* timing/duration logic is now integrated across create/edit/duplicate flows
* booking reconciliation policy is stable and should not be changed without a dedicated sprint

---

## 3) Stable implemented behaviour (current baseline)

The following capabilities are considered implemented and broadly stable unless a new sprint explicitly changes them.

### 3.1 Live Board and strip lifecycle

* Live Board rendering stable
* History and daily counters stable under current rules
* inline editing fixed for canonical time fields and required-field safety
* hard delete exists and is distinct from cancel
* cancel/delete semantics documented and preserved
* status transitions and counter effects audited

### 3.2 Booking ↔ strip sync

* booking create/update can create or update linked strips
* strip edit/cancel/complete propagates back to linked bookings where appropriate
* canonical booking planned-time fields exist and are normalized
* no-op booking patch optimization reduces redundant writes and dispatch storms
* bidirectional link reconciliation now runs at bootstrap and is surfaced to the operator when issues are found

### 3.3 Calendar

* month / week / year views implemented
* general calendar event create/edit/delete supported

### 3.4 Admin

* two-pane admin IA implemented
* dirty-state save/discard workflow implemented where appropriate
* booking profiles section exists and saves immediately
* restore/export/reset flows clarified and hardened
* backup metadata envelope and restore preflight format detection implemented

### 3.5 Formations

* formation create/edit/remove is implemented
* Live Board formation badge and expanded details implemented
* per-element editing supported
* inheritance/duplicate semantics implemented within current scope
* WTC current/max semantics implemented

### 3.6 LOC / modal parity / WTC

* LOC create flow uses the standard modal structure rather than a bespoke outlier form
* LOC flight type and EGOW departure/arrival locks preserved
* LOC WTC selection/autofill exists within current rules

### 3.7 Timezone / timings / duration

* UTC/local display mode supported
* modal timing grids normalized across movement types
* per-type DEP/ARR durations available in Admin
* per-strip Duration field implemented
* duration is a true override for projection and is bidirectionally synced with planned end where applicable
* OVR label corrections landed
* abbreviation warning severity now uses two levels

### 3.8 Integrity surfacing

* reconciliation summary is now surfaced through an operator-visible Integrity banner
* banner appears only when clear/repair/conflict counts are non-zero
* conflict details can be expanded in-place
* dismiss is session-only (until reload)

---

## 4) Known limitations / technical constraints

### 4.1 Single-client storage model

This remains a local single-user/single-client style application. Multi-user concurrent editing is not supported.

### 4.2 Browser-storage dependency

Persistence depends on local browser storage in the runtime environment. This is acceptable for current v1 scope but remains a structural limitation.

### 4.3 Schema evolution requirement

Any future schema change must be:

* backward-compatible
* deterministically migrated once
* explicitly recorded in this ledger

### 4.4 Test strategy constraint

Primary acceptance is manual verification on Stuart’s Windows environment. Automated harnesses are useful but must not become a burden that slows routine iteration unnecessarily.

---

## 5) Parked / deferred backlog (explicitly not in active sprint scope)

These items are intentionally deferred. They must **not** be pulled into unrelated implementation work.

### 5.1 Booking & comms

1. **Booking confirmation email + pilot briefing pack**

   * confirmation email to booker
   * cost breakdown
   * confirmed itinerary
   * pilot briefing pack with operating/station/ATC information
   * include note that arrivals/departures outside contiguous UK require GAR and this is not managed by ATC

### 5.2 Movement creation UX

2. **Duplicate → “Create from…” concept**

   * replace Duplicate with Create from…
   * user chooses target movement type: DEP / ARR / LOC / OVR
   * new strip prefilled from source with safe defaults and no stale timings

3. **Cancelled sorties log + optional cancellation reason**

   * cancelled strip snapshot stored for audit/reporting
   * optional cancellation reason taxonomy
   * must not contaminate existing movement totals logic

### 5.3 Formation backlog

4. **Formation flights continuation backlog**

   * FORMATIONS.md remains canonical
   * creation/editing/inheritance and any future accounting extensions stay here until formally scheduled

### 5.4 Timezone ergonomics

5. **DST-aware Auto timezone offset (Europe/London)**

   * automatic UTC/BST handling for Woodvale context
   * currently deferred in favour of manual offset + current display toggle behaviour

---

## 6) Risk register / technical debt

### 6.1 Data integrity / drift

* **Mitigated:** bidirectional reconciliation now enforced and visible
* **Mitigated:** canonical planned-time fields normalized
* **Remaining:** concurrency beyond single-client assumptions is unsupported

### 6.2 Event-driven coupling

* **Mitigated:** reentrancy guards in booking sync
* **Mitigated:** no-op patch optimization
* **Verified:** prior stress audit found no runaway event storms or infinite loops under tested edge flows

### 6.3 Schema growth risk

* managed via explicit migrations and normalization
* future additions must preserve backward compatibility

### 6.4 Operator trust / diagnosability

* partially improved by the Sprint 8 integrity banner
* still room for future actionability improvements (for example direct navigation from banner entries to affected records)

---

## 7) Manual verification philosophy

Default acceptance model:

* Stuart performs manual smoke testing on Windows
* Claude implements narrowly to ticket
* ChatGPT maintains scope discipline, acceptance criteria, and ledger quality

Use automated harnesses when they materially reduce uncertainty or protect against regressions, but avoid unnecessary heavy test churn during normal incremental feature work.

---

## 8) Sprint ledger (chronological)

This is the refactored historical ledger. It is intended to be readable first and exhaustive second. The exact git history and PR history remain authoritative for file-level archaeology.

### 8.1 Sprint 1 — Integrity and schedule-consistency foundations

**Outcome:** complete

Delivered:

* `bookingSync.reconcileLinks()` made bidirectional and deterministic
* booking create/edit flows always populate canonical `schedule.plannedTimeLocalHHMM` and `schedule.plannedTimeKind`
* no-op booking patch behaviour added to reduce redundant write/dispatch churn

Significance:

* established the modern booking/strip integrity model
* removed a major source of silent state drift

### 8.2 Hotfix / follow-on stabilization — Admin panel init failure

**Outcome:** closed

Delivered:

* admin initialization failure corrected
* later considered covered by wider stability verification

### 8.3 Sprint 2 — Live Board integrity + stats correctness

**Outcome:** complete and previously verified

Delivered:

* fixed inline-edit data loss caused by wrong/non-canonical time field usage
* fixed blur/Enter double-save race behaviour
* added required-field validation in inline edit
* ensured inline edit triggers booking sync and counter refreshes where required
* added hard delete for strips, distinct from cancel
* corrected traffic counter logic and verified status/counter semantics

Significance:

* removed a release-blocking data integrity fault
* stabilized core strip editing behaviour

### 8.4 Sprint 3 — Event storm safety audit + documentation hardening

**Outcome:** complete and previously verified

Delivered:

* diagnostics-gated instrumentation for render/dispatch counting
* stress audit across rapid edits, status transitions, booking-linked flows, and delete/cancel flows
* documentation hardening for strip lifecycle and counter semantics

Significance:

* established confidence that event-driven flows were not causing runaway renders or loops

### 8.5 Sprint 4 — Formations v1 end-to-end

**Outcome:** complete

Delivered:

* user-facing creation/edit/removal of `movement.formation`
* Live Board formation badge `F×n`
* expanded formation details panel with per-element editing
* WTC current/max semantics implemented
* duplicate flows inherit formation with safe reset of element operational state
* regression coverage added during implementation

Significance:

* formation support became a real end-to-end feature rather than a data stub

### 8.6 Sprint 5 — Formations v1.1

**Outcome:** complete

Delivered:

* per-element depAd / arrAd
* editable element callsigns
* formation validation hardening
* count guardrails
* master-status cascade semantics
* inheritance improvements

Significance:

* matured formation handling from baseline feature into a more operationally usable subsystem

### 8.7 P0 / modal-inline-edit integrity hardening

**Outcome:** complete

Delivered:

* `closeActiveModal()` introduced as required lifecycle primitive
* modal open/close paths normalized to use lifecycle helpers
* `_modalOpen` / diagnostics invariant checks added
* inline-edit propagation/save interactions hardened
* save path made more transactional
* local storage guard added against corrupt/non-array movement state

Significance:

* closed a class of modal/inline-edit interaction regressions
* established engineering rules used by later sprints

### 8.8 Sprint 6 — LOC WTC and LOC workflow hardening

**Outcome:** complete

Delivered:

* LOC WTC selector and autofill wiring
* LOC-specific save-path WTC validation
* no drift to modal lifecycle or unrelated counters/totals logic

Significance:

* improved LOC operational completeness while preserving LOC-specific constraints

### 8.9 Sprint 7 — LOC standard modal parity

**Outcome:** complete

Delivered:

* replaced bespoke LOC create modal with standard movement modal structure
* preserved LOC locks for flight type and EGOW departure/arrival
* aligned layout and user flow with DEP/ARR/OVR modal structure
* retained current LOC timing semantics where intentionally distinct

Significance:

* removed a UI outlier and improved consistency without flattening LOC-specific rules

### 8.10 Admin IA v1 — two-pane Admin layout with dirty-state tracking

**Outcome:** complete

Delivered:

* two-pane admin shell
* section navigation
* sticky save bar with dirty-state awareness
* clearer separation of save-managed vs immediate-save admin areas
* danger-zone restructuring

Significance:

* admin moved from an unstructured page into a maintainable control surface

### 8.11 Admin IA v1.1 — copy clarity / restore preflight improvements

**Outcome:** complete

Delivered:

* improved descriptive copy across admin sections
* clarified which areas save immediately
* restore preflight summary before import
* clearer reset-to-demo wording matching real behaviour

### 8.12 Admin IA v1.2 — backup envelope / timestamped filenames / restore format detection

**Outcome:** complete

Delivered:

* metadata envelope for backup export
* timestamped filenames
* restore preflight format detection across current and legacy shapes
* warning/blocking paths for invalid/unrecognized payloads

Significance:

* backup/restore behaviour became more trustworthy and auditable

### 8.13 Timings / duration / warning-severity sprint

**Outcome:** complete

Delivered:

* OVR timing label corrections
* Flight Duration override behaviour
* two-level abbreviation warning severity
* per-type DEP/ARR duration support in Admin
* per-strip Duration field in create/edit/duplicate flows
* duration ↔ planned-end bidirectional sync
* timing grid parity and deterministic tab order across movement forms

Significance:

* timing behaviour is now much more coherent and operator-friendly across the entire strip lifecycle

### 8.14 Sprint 8 — Booking/Strip reconciliation summary surfaced to operator

**Outcome:** complete

Delivered:

* `bookingSync.reconcileLinks()` output enriched with `conflictList` for reporting
* `app.js` captures reconciliation return value as `reconcileSummary`
* `showReconcileBanner(reconcileSummary)` invoked after initial render
* banner mounts between `nav.nav-bar` and `main.page-body`
* no-op when issue count is zero
* info/blue presentation for clear/repair-only cases
* warning/amber presentation when conflicts exist
* summary line reports total issue count
* details toggle reveals counts and conflict list
* conflict list capped to first 10 with overflow indicator
* dismiss button removes banner for current session until reload
* supporting CSS added for banner variants, detail panel, fade-in, and overflow styles

**Important scope note:**
`reconcileLinks()` reporting shape was extended, but reconciliation policy/resolution logic was not changed.

Significance:

* reconciliation is now auditable in the UI rather than silently happening at bootstrap
* operators can see when automatic integrity repair/clear actions have occurred

### 8.15 Sprint 9 — Event-based stats, explicit time semantics, ZZZZ/PIC, and lightweight outcome handling

**Outcome:** complete

Delivered:

**Stage 1 — Event-based daily stats and explicit time semantics:**
* `egowRunwayContribution(m)` added to `datamodel.js` — counts only realized EGOW events
* Live Board daily stats (`calculateDailyStats` in `app.js`) now uses `egowRunwayContribution` instead of nominal `runwayMovementContribution`
* FIS top-bar counter now excludes PLANNED and CANCELLED strips (only ACTIVE and COMPLETED contribute)
* Live Board time cells now display explicit ETD/ATD/ETA/ATA labels
* Estimated times rendered as italic/muted; actual times as normal weight
* OVR times display ECT/ACT labels

**Stage 2 — ZZZZ companion fields and PIC:**
* `depAdText`, `arrAdText`, `aircraftTypeText` fields added to movement model
* `bindZzzzCompanion()` helper wires show/hide behaviour: companion shown iff code = ZZZZ, required when shown
* ZZZZ companion inputs present in both create and edit modals for DEP AD, ARR AD, Aircraft Type
* Save paths validate ZZZZ companion fields before saving
* `captain` field relabelled as PIC in all UI; stored field name unchanged for backward compatibility
* PIC field added to create and edit modals
* Info panel updated: shows PIC, prefers ZZZZ text over code in DEP/ARR/Type display

**Stage 3 — Lightweight outcome handling:**
* New outcome fields added: `outcomeStatus` (NORMAL/DIVERTED/CHANGED/CANCELLED), `outcomeReason`, `actualDestinationAd`, `actualDestinationText`, `outcomeTime`
* Outcome collapsible section added to edit modal
* Outcome status dropdown shows/hides destination and time fields for DIVERTED/CHANGED
* `flightType` is never replaced; outcome is additive only
* Save & Complete handler implements abnormal closure: DIVERTED/CHANGED/CANCELLED do not fabricate EGOW `arrActual`
* Info panel shows outcome badge and reason when non-NORMAL

**Stage 4 — Reporting alignment:**
* `reporting.js` header block documents the intentional split:
  * Live Board daily stats = event-based (realized EGOW)
  * Monthly Return / Dashboard / Insights = nominal strip-type-based (unchanged, intentional)
* This divergence is explicit and must not be silently merged in future sprints.

**Migration:**
* `ensureInitialised()` in `datamodel.js` applies Sprint 9 defaults to old records on load:
  `depAdText`, `arrAdText`, `aircraftTypeText` → `''`; `outcomeStatus` → `'NORMAL'`; all other outcome fields → `''`
* Old records load without errors; `captain` field unchanged

**NO-DRIFT confirmations:**
* `flightType` is never replaced; outcome model is additive
* OVR separate-counter behavior unchanged
* Booking sync not modified
* `runwayMovementContribution` (nominal) retained for reporting use; `egowRunwayContribution` (event-based) is additive

### 8.16 Post-Sprint-9 correction pass — Admin display toggles, tooltip enhancement, ARR fixes

**Outcome:** complete

Delivered:

**Part A — Admin strip time-display toggles:**
* `showTimeLabelsOnStrip` (default ON): labels ETD/ATD/ETA/ATA appear on their own `<span class="time-label">` line above the time value in the Live Board time cell; CSS updated to `display: block` on `.time-label` and `display: inline-block; vertical-align: bottom` on the time spans
* `showEstimatedTimesOnStrip` (default ON): when OFF, estimated times (ETD/ETA/ECT) are suppressed and rendered as "–"; actual times (ATD/ATA/ACT) always show regardless
* Both settings stored in `defaultConfig` in `datamodel.js` and wired through Admin → Timezone & Display section in `index.html` and the save/load path in `app.js`

**Part B — Field-specific inline-edit tooltips:**
* `enableInlineEdit()` now accepts an optional `tooltipText` parameter (6th arg); defaults to "Double-click to edit" when omitted
* Inline `_tt` object computed per-strip from live lookups:
  - callsign → unit/company via `lookupUnitFromCallsign` + `lookupOperatorFromCallsign`
  - registration → OPERATOR via `lookupRegistration`
  - type → Common Name via `lookupAircraftType`, or `aircraftTypeText` if ZZZZ
  - wtc → full wording (L=LIGHT, M=MEDIUM, H=HEAVY, J=SUPER, etc.)
  - depAd/arrAd → aerodrome name via `getLocationName`, or ZZZZ text if applicable
  - rules → full wording (VFR, IFR, SVFR, Y, Z)
  - tngCount / osCount / fisCount → T&G / O/S / FIS abbreviation expansions
  - time fields → ETD/ATD/ETA/ATA/ECT/ACT semantic labels

**Part C — ARR timeline colour:**
* Fixed `.timeline-movement-bar.ft-arr { background: #8b8b8b; }` → `background: var(--ft-arr);`
* ARR strips now render in the correct sand/orange colour on the timeline regardless of ATD being populated

**Part D — ARR strip ATD recompute chain:**
* ARR strips now display `m.depActual` (ATD from origin) in the dep time cell with "ATD" label when populated
* ARR dep time cell is now inline-editable for `depActual` field
* `arrAtdOnSave` callback: after saving `depActual` on ARR, if `durationMinutes > 0` and no `arrActual`, derives `arrPlanned = depActual + durationMinutes` and triggers a re-render

**Part E — Status re-evaluation after time changes:**
* `reEvaluateStatusAfterTimeChange(movementId)` helper added: if a movement is ACTIVE, has no actual completion time, and its primary planned time is now more than `(autoActivateMinutes + 5)` minutes away, reverts status to PLANNED
* Called from `saveEdit` for all time-field inline edits (`depPlanned`, `arrPlanned`, `depActual`, `arrActual`)
* Also called from the Part D `arrAtdOnSave` callback after deriving a new `arrPlanned`

**NO-DRIFT confirmations:**
* No changes to reporting, booking sync, modal lifecycle, or EGOW counting
* `getATD(m)` semantics unchanged (returns null for ARR); ARR dep time display uses raw `m.depActual` field directly
* `reEvaluateStatusAfterTimeChange` uses a +5 min buffer to avoid boundary oscillation

### 8.17 Sprint 10 — Timing normalization / single resolved timing model

**Outcome:** complete

**Phase 1 — Audit findings (divergence points identified):**

1. **Timeline ARR start time (CRITICAL):** `getMovementStartTime()` for ARR returned `ATA || ETA` — using the arrival side as the bar START. Spec requires bar start = ETD (planned) or ATD (active/completed), never ETA/ATA.
2. **Timeline ARR/LOC end time:** `getMovementEndTime()` for ARR returned `ATA || ETA` — end was correct semantically, but start being wrong made the whole span wrong.
3. **No inline edit recalculation:** Inline time edits saved only the single touched field. No dependent side (e.g. ETA after ETD edit) was recalculated. Only the modal's `bindPlannedTimesSync` had any bidirectional sync.
4. **Modal ARR sync direction wrong:** `bindPlannedTimesSync` was called with ETD=start, ETA=end for all types. For ARR, the canonical root is ETA and ETD is derived. The modal was computing ETA from ETD for ARR, which is backwards.
5. **`transitionToActive` did not recalculate ETA:** After the Active button set ATD to current time, ETA was not updated to ATD + Duration. Strip retained the old planned ETA after activation.
6. **`arrAtdOnSave` partial workaround:** An ad-hoc inline-edit callback existed only for the ARR dep-time cell; it was the only inline recalculate path and only worked for `durationMinutes > 0`. Not general.
7. **`getMovementWindow` (WTC overlap):** Used `depActual || depPlanned` as raw start, not aware of ARR planned semantics (where start = ETD not ETA).

**Phase 2 — Delivered:**

**A. Canonical timing model added to `datamodel.js`:**
* Private helpers `_tmToMins(t)` and `_minsToTm(m)` — pure HH:MM arithmetic, no Date dependency
* `getDurationSource(movement)` — exported. Returns `{ minutes, isExplicit }`. Explicit = user-entered `durationMinutes`; non-explicit = admin default fallback. Distinction used by ARR safeguard.
* `resolvedStartTime(movement)` — exported. Always returns the departure/start anchor (ETD or ATD), never ETA/ATA. For ARR planned: uses `depPlanned` if stored, else computes `arrPlanned − duration`.
* `resolvedEndTime(movement)` — exported. Returns `arrActual || arrPlanned` for all types (ATA||ETA for DEP/LOC/ARR; ALFT||ELFT for OVR).
* `recalculateTimingModel(movement, changedField)` — exported. Returns a patch object. Implements all canonical rules per spec for DEP/LOC/ARR/OVR in both planned and active states. ARR safeguard: if duration is non-explicit AND `arrPlanned` already exists in active state, does not blindly overwrite with ATD+default (patch._weakPrediction sentinel).

**B. `ui_liveboard.js` — Timeline fix:**
* `getMovementStartTime(m)` now delegates to `resolvedStartTime(m)` — ARR bar no longer starts at ETA/ATA
* `getMovementEndTime(m)` now delegates to `resolvedEndTime(m)`
* Timeline end calculation simplified: uses resolved end time; falls back to `getDurationSource` default only if no end time stored
* `getMovementWindow()` (WTC overlap) now uses resolved start/end times

**C. Modal time sync — ARR direction fix:**
* `bindPlannedTimesSync` extended with optional `opts.arrMode` parameter
* ARR mode: ETA (arrPlanned) is the root; ETD (depPlanned) is the dependent. Duration/ETA change → ETD. ETD change → Duration.
* DEP/LOC/OVR mode: unchanged (ETD is root, ETA is dependent)
* All three `bindPlannedTimesSync` call sites (new-flight, edit, duplicate modals) now pass `{ arrMode: flightType === 'ARR' }` — ARR modal syncs in the correct direction

**D. Inline edit save — recalculation wired:**
* `saveEdit` in `enableInlineEdit` now calls `recalculateTimingModel(updatedMovement, fieldName)` after persisting any timing/duration field
* ARR `_weakPrediction` sentinel respected: suppressed overwrite of existing ETA when duration is non-explicit
* The ad-hoc `arrAtdOnSave` callback removed; generic path handles all cases

**E. `transitionToActive` — ETA update after activation:**
* After setting `depActual` to current time, calls `recalculateTimingModel(updatedMovement, 'depActual')`
* For DEP/LOC: ETA = ATD + Duration (always)
* For ARR: ETA = ATD + Duration only if duration is explicit (ARR safeguard honoured)
* For OVR: ELFT = ATOF + Duration if ALFT not yet set

**NO-DRIFT confirmations:**
* Event-based Live Board daily stats model unchanged
* Nominal Monthly Return / Dashboard / Insights model unchanged
* `flightType` semantics unchanged
* Additive outcome model unchanged
* OVR separate-counter behaviour unchanged
* Booking reconciliation policy unchanged
* Hard delete vs cancel distinction unchanged
* ZZZZ / PIC fields unchanged

**Limitations / known residual items:**
* Duplicate modal (`openDuplicateMovementModal`) uses a fixed ARR-mode bind based on the source movement type — correct for same-type duplicates; type change after dup creation not retroactively handled (deferred, low priority)
* OVR Timeline in the duplicate modal is treated same as DEP/LOC (not ARR mode), which is correct
* For legacy movements where `durationMinutes` was set but `arrPlanned` was not in sync, the first inline time edit or activation will now apply the correct recalculation

---

### 8.18 Sprint 10.1 — Timing normalization follow-on correction

**Outcome:** complete

**Root causes addressed:**

Four residual defects found by manual verification after Sprint 10:

1. **Active DEP strips showed "ATD / –"** — the strip renderer's arr-side display block (`if ft === "ARR" || ft === "LOC"`) excluded DEP entirely. `arrDisplay` stayed "-" even when `arrPlanned` (ETA) was correctly computed by Sprint 10 recalculation.
2. **Active OVR strips showed "ACT / –"** — arr-side was hardcoded `arrDisplay = "-"; arrLabel = ""` unconditionally, ignoring `arrActual` (ALFT) and `arrPlanned` (ELFT).
3. **Active LOC strips showed stale ETA** — pre-existing ACTIVE strips (e.g. demo LOC strip with `depActual: "15:05"`, `arrPlanned: "15:40"` derived from ETD 15:00+40) were never migrated. Sprint 10 recalculation only ran on new Activate presses or subsequent inline edits; no boot-time migration existed.
4. **Single global `showEstimatedTimesOnStrip` flag too coarse** — one toggle controlled all four movement types; operators needed per-type granularity (e.g. suppress estimated DEP times but keep ARR/LOC estimates visible).

**Delivered:**

**A. Display layer — `ui_liveboard.js` strip renderer:**
* Added `if (ft === "DEP")` block: shows `m.arrActual` (ATA) or `m.arrPlanned` (ETA) for DEP arr-side. Labels: "ATA" / "ETA". `arrIsActual` set correctly.
* Fixed OVR arr-side: removed hardcoded `arrDisplay = "-"; arrLabel = ""`. Now shows `m.arrActual` (ALFT) or `m.arrPlanned` (ELFT) with labels "ALFT" / "ELFT".
* Replaced single `showEstimated` variable with four per-type variables: `showDepEstimated`, `showArrEstimated`, `showLocEstimated`, `showOvrEstimated`. Strip renderer selects the correct flag per `ft`.

**B. Config model — `datamodel.js`:**
* Added four per-type flags to `defaultConfig`: `showDepEstimatedTimesOnStrip`, `showArrEstimatedTimesOnStrip`, `showLocEstimatedTimesOnStrip`, `showOvrEstimatedTimesOnStrip` — all default `true`.
* Legacy global `showEstimatedTimesOnStrip` retained in `defaultConfig` with comment (backward-compat migration source).
* `loadConfig` migration: if parsed config lacks `showDepEstimatedTimesOnStrip`, derives all four per-type flags from the old global flag value — ensuring existing installs with the global flag set to OFF propagate correctly.

**C. Boot-time migration — `datamodel.js` `ensureInitialised`:**
* In the `movements.forEach` migration block, for each ACTIVE DEP/LOC/OVR strip with `depActual` set and no `arrActual`, calls `recalculateTimingModel(m, 'depActual')` and applies the patch.
* ARR `_weakPrediction` sentinel respected — non-explicit-duration ARR patches not applied.
* Ensures all pre-existing ACTIVE strips have correct ATD-derived ETA at first boot, without waiting for an inline edit or re-activation.

**D. Edit modal save path — `ui_liveboard.js`:**
* After `updateMovement(m.id, updates)` in the Save handler, if `updates.depActual !== undefined` (ATD was explicitly changed in the edit), calls `recalculateTimingModel(savedMovement, 'depActual')` and applies patch.
* ARR `_weakPrediction` sentinel respected.

**E. Admin UI — `index.html` and `app.js`:**
* Replaced single `configShowEstimatedTimes` checkbox with four checkboxes: `configShowDepEstimatedTimes`, `configShowArrEstimatedTimes`, `configShowLocEstimatedTimes`, `configShowOvrEstimatedTimes`.
* `CHECKBOX_IDS` updated — all four participate in snapshot/dirty-check/discard cycle automatically.
* Load path populates four checkboxes from four config flags.
* Save path reads four checkboxes and writes four config flags via `updateConfig`.

**NO-DRIFT confirmations:**
* Event-based Live Board daily stats model unchanged
* Nominal Monthly Return / Dashboard / Insights model unchanged
* `flightType` semantics unchanged
* Additive outcome model unchanged
* OVR separate-counter behaviour unchanged
* Booking reconciliation policy unchanged
* Hard delete vs cancel distinction unchanged
* ZZZZ / PIC fields unchanged
* Timeline rendering, `resolvedStartTime`, `resolvedEndTime`, `getDurationSource`, `recalculateTimingModel` logic unchanged from Sprint 10

---

### 8.19 Ticket 1 (post-Sprint 10.1) — Inline edit binding and ARR activation fix

**Outcome:** complete

**Three defects addressed:**

**A. DEP secondary-time inline editing not working**

Root cause: The `enableInlineEdit` binding block for `arrTimeEl` used `if (ft === "ARR" || ft === "LOC")` — DEP was excluded, so the rendered `<span class="js-edit-arr-time">` had no double-click handler. The `_buildTabOrder` applicable condition had the same gap. The rendered value was display-only for DEP.

Fix (`ui_liveboard.js`):
- Binding block changed to `if (ft === "ARR" || ft === "LOC" || ft === "DEP")`. DEP arr-side binds to `m.arrActual ? "arrActual" : "arrPlanned"` (ATA if recorded, otherwise ETA). Tooltips: `_tt.arrActual` ("ATA – Actual Time of Arrival") / `_tt.arrPlanned` ("ETA – Estimated Time of Arrival") — already correct.
- `_buildTabOrder` `applicable` updated to `ft === 'ARR' || ft === 'LOC' || ft === 'DEP' || ft === 'OVR'` so Tab-order navigation includes the cell.

**B. OVR secondary-time inline editing not working**

Root cause: The OVR binding block only called `enableInlineEdit` for `depTimeEl` (ACT/ECT, left side). No binding existed for `arrTimeEl` (ALFT/ELFT, right side). `_buildTabOrder` applicable also excluded OVR for arr-time.

Fix (`ui_liveboard.js`):
- Added OVR arr-side binding inside the OVR block: `enableInlineEdit(arrTimeEl, m.id, m.arrActual ? "arrActual" : "arrPlanned", "time", null, _tt[ovrArrField])` where `ovrArrField` is `"alft"` or `"elft"` (lookup key for the tooltip only).
- Added `alft: 'ALFT – Actual Last Frequency Time'` and `elft: 'ELFT – Estimated Last Frequency Time'` to `_tt` for OVR arr-side tooltips.
- Renamed OVR dep-side local variable `ovrField` → `ovrDepField` to avoid shadowing.
- `_buildTabOrder` `applicable` updated as described in Part A above.

**C. ARR auto-activation must not fabricate ATD**

Root cause: `transitionToActive()` unconditionally set `depActual: currentTime` in the updates object for all flight types. When `autoActivatePlannedMovements()` called this for an ARR strip, it wrote a fabricated ATD equal to the moment of auto-activation, which is not evidence of an actual departure event.

Fix (`ui_liveboard.js`, `transitionToActive`):
- `depActual` is only included in the updates object when `ft !== 'ARR'`.
- For ARR, the transition is status-only (`{ status: "ACTIVE" }` plus optional DOF correction).
- The timing recalculation block after `updateMovement` is also guarded with `ft !== 'ARR'` for clarity (no ATD was set, so recalculation would produce no meaningful patch for ARR anyway).
- This fix applies to both auto-activation and manual "→ Active" button presses for ARR — both are status events, not departure-event witnesses.

**NO-DRIFT confirmations:**
- Event-based Live Board daily stats model unchanged
- Nominal counts unchanged
- OVR separate-counter unchanged
- Booking reconciliation policy unchanged
- All other timing model logic unchanged

**Deferred / limitations:**
- If an ARR is activated and then the operator wants to enter ATD (origin departure time), they do so via inline edit on the left-side dep-time cell — this path was already working from prior sprints.
- The revert guard in `reEvaluateStatusAfterTimeChange` already correctly ignores `depActual` for ARR — no change needed.

---

### 8.20 Ticket 2 (post-Sprint 10.1) — Activate/Complete semantics; BM validation

**Outcome:** complete

**Parts implemented:**

**A. Activate semantics — `transitionToActive` (`ui_liveboard.js`)**

- Added guard to DEP/LOC/OVR ATD stamping: `depActual` is only set if not already present. If the operator entered an ATD/ACT before clicking Active (e.g. via the edit modal), the manually-entered value is preserved.
- ARR remains status-only (Ticket 1). Combined condition: `ft !== 'ARR' && !(movement.depActual && String(movement.depActual).trim())`.

**B/C. Complete semantics — `transitionToCompleted` (`ui_liveboard.js`)**

Rewrote with type-aware logic:
- **DEP**: no `arrActual` is generated. DEP completion has no arrival-side actual concept.
- **LOC**: stamps `arrActual = now` only if `arrActual` not already present.
- **ARR**: stamps `arrActual = now` only if `arrActual` not already present.
- **OVR**: stamps `arrActual` (ALFT) `= now` only if `arrActual` not already present.

Rule used: `hasArrActual = !!(movement.arrActual && String(movement.arrActual).trim())` — existing field presence is sufficient; no new provenance subsystem needed.

**D. BM EGOW Unit validation (`ui_liveboard.js`)**

Added `if (egowCode === 'BM') { /* require unitCode */ }` immediately after each EGOW code validation block. Applied to all six save paths:
1. New DEP/ARR/OVR form — save (`newUnitCode`)
2. New DEP/ARR/OVR form — Save & Complete (`newUnitCode`)
3. New LOC form — save (`newLocUnitCode`)
4. New LOC form — Save & Complete (`newLocUnitCode`)
5. Edit form — Save Changes (`editUnitCode`) — note: this handler previously had no EGOW validation at all; EGOW + BM validation added together
6. Edit form — Save & Complete (`editUnitCode`)

Error message: "EGOW Unit code is required for BM flights". Non-BM codes pass through unchanged.

**NO-DRIFT confirmations:**
- Event-based Live Board daily stats model unchanged
- Nominal counts unchanged
- OVR separate-counter unchanged
- Booking reconciliation policy unchanged
- Timing normalization unchanged

---

### 8.26 Ticket 5 (post-10.1) — Inline time mode toggle: estimate ↔ actual label selector

**Outcome:** complete

**Summary:**

Replaced the implicit "if actual exists bind to actual; else bind to planned" inline edit routing with an explicit operator-controlled mode toggle. Each inline time slot now has two modes — estimate and actual — and the displayed label is the clickable selector between them.

**Root cause of prior bug:**

The old binding used `m.depActual ? "depActual" : "depPlanned"` (and equivalent for arr-side). When the operator entered a time in the inline field it was silently routed to planned when no actual existed yet — even if the operator intended to record an actual. Then pressing Complete would stamp a fresh system time because `arrActual` (the completion field) was blank. This made manually-entered completion times disappear.

---

**A. Mode state added to `ui_liveboard.js`**

Two module-level collections introduced:

- `_inlineTimeModeMap` (`Map<string, 'estimate'|'actual'>`) — key `"${movementId}:dep"` or `"${movementId}:arr"`
- `_inlineTimeModeExplicit` (`Set<string>`) — tracks keys where the operator explicitly toggled (vs auto-defaulted)

Three helpers:
- `_resolveInlineTimeMode(movementId, side, hasActual)` — if operator toggled, preserves their choice; otherwise auto-derives from actual-field presence (actual mode when actual exists, estimate otherwise). Called once per strip per render to set the mode.
- `_getInlineTimeMode(movementId, side)` — read current mode without re-deriving
- `_setInlineTimeModeExplicit(movementId, side, mode)` — used by click handler; marks the entry as explicitly set

Two pure mapping helpers:
- `_inlineTimeFieldForMode(ft, side, mode)` — returns the data-model field name; encodes the full ownership table:
  - DEP/LOC dep-side: estimate→depPlanned, actual→depActual
  - DEP/LOC/ARR arr-side: estimate→arrPlanned, actual→arrActual
  - ARR dep-side: always depActual (no estimate/actual pair — ATD from origin)
  - OVR dep-side (EOFT/AOFT): estimate→depPlanned, actual→depActual
  - OVR arr-side (ELFT/ALFT): estimate→arrPlanned, actual→arrActual
- `_inlineTimeLabelForMode(ft, side, mode)` — returns the display label string (ETD/ATD, ETA/ATA, EOFT/AOFT, ELFT/ALFT, ATD for ARR dep-side)

**B. `renderLiveBoard()` — time display logic replaced**

Old code: multiple `if (actual) ... else if (estimate) ...` blocks for each type.

New code: single pass using `_resolveInlineTimeMode` and `_inlineTimeFieldForMode`:
- dep-side (DEP/LOC/OVR): resolve mode → fetch field → read value from movement → set label via `_inlineTimeLabelForMode`
- ARR dep-side: unchanged display logic (always depActual when present, else blank)
- arr-side (all types): same pattern — always shows label (so operator can see mode even when field is blank)

Labels are always rendered when the side is applicable (even when value is blank/dash) so the operator can see the current mode and toggle it.

**C. `renderLiveBoard()` — label HTML changed to toggleable spans**

`depLabelHtml` and `arrLabelHtml` now emit `<span class="time-label js-time-label-toggle [mode-actual]" data-id="..." data-side="...">` for togglable sides. ARR dep-side remains an inert `<span class="time-label">` (no toggle).

Label title attribute shows toggle hint: "Click to toggle estimate/actual mode".

**D. Click handler wired after row build**

After the inline-edit bindings block, `tr.querySelectorAll('.js-time-label-toggle')` attaches a click listener to each toggleable label:
- reads current mode via `_getInlineTimeMode`
- flips it via `_setInlineTimeModeExplicit` (marks as explicitly set)
- calls `renderLiveBoard()` to re-render with updated label and re-bound inline edits

**E. Inline edit binding replaced with mode-aware logic**

Old inferred bindings like `m.depActual ? "depActual" : "depPlanned"` replaced with explicit calls to `_inlineTimeFieldForMode(ft, side, _getInlineTimeMode(m.id, side))`.

All four blocks (DEP/LOC dep-side, ARR dep-side, DEP/ARR/LOC arr-side, OVR both sides) now read from the mode map rather than inferring from field presence.

**F. `_buildTabOrder` updated**

The `fieldName` lambdas for dep-time and arr-time slots now call `_inlineTimeFieldForMode` with `_getInlineTimeMode` — the same resolution as the binding block. Tab-order navigation advances to the correct estimate or actual field per the current mode.

**G. OVR label terminology updated**

OVR dep-side (previously "ECT" / "ACT") now uses "EOFT" / "AOFT" (Estimated/Actual On-Frequency Time) as specified. The `_tt` (tooltip) object updated:
- `ect: 'ECT – Estimated Crossing Time'` → `eoft: 'EOFT – Estimated On-Frequency Time'`
- `act: 'ACT – Actual Crossing Time'` → `aoft: 'AOFT – Actual On-Frequency Time'`

ELFT/ALFT keys unchanged.

**H. CSS — `vectair.css`**

New rules added immediately after `.time-label`:
- `.time-label.js-time-label-toggle` — `cursor: pointer`, `border-radius: 2px`, `transition` for smooth hover
- `.time-label.js-time-label-toggle:hover` — `opacity: 1`, `text-decoration: underline dotted`
- `.time-label.js-time-label-toggle.mode-actual` — `opacity: 0.85` (slightly brighter when in actual mode)

**Files changed:**

1. `src/js/ui_liveboard.js` — mode state map + helpers; `_buildTabOrder` fieldName lambdas; `renderLiveBoard()` time display logic; label HTML generation; inline edit binding; label click handlers; `_tt` OVR keys updated
2. `src/css/vectair.css` — toggleable label styles added after `.time-label` block

**NO-DRIFT confirmations:**

- Complete stamps `arrActual` only when absent — unchanged (Ticket 2 / 2b `completionActualIsAbsent` logic intact)
- Active guards existing ATD — unchanged (Ticket 2 guard intact)
- ARR does not fabricate ATD — unchanged
- Ticket 4 / 4a Active/Complete rounding — unchanged
- WTC exact-time display — unchanged
- OVR blank-EOFT create-as-active path — unchanged (goes through `transitionToActive` which sets `depActual`; on next render mode auto-resolves to `actual` since `depActual` now exists)
- Timeline rendering — unchanged
- Booking reconciliation — unchanged
- Counters / reporting — unchanged
- Formation behavior — unchanged
- `depActualExact` field and migration — unchanged

**Mode persistence model:**

Mode is UI session state only — not stored in the movement record. On each render:
1. If the operator explicitly toggled a side this session → their choice is preserved
2. If no explicit toggle → mode auto-derives from actual-field presence (actual mode when actual exists)

This means: after Active stamps ATD, the dep-side label auto-updates to ATD on re-render without the operator having to manually toggle. After Complete stamps ATA, the arr-side label auto-updates to ATA. Operator toggles survive re-renders (until session reload).

**Manual verification checklist for Stuart:**

LOC:
1. Blank LOC strip: arr-side label shows "ETA"; double-click → edits arrPlanned; ETA present on strip
2. Click "ETA" label → label switches to "ATA"; double-click → now edits arrActual
3. Enter ATA inline, press Complete → ATA preserved (not overwritten by system time)
4. Toggle back to ETA → shows arrPlanned value; toggle to ATA → shows arrActual value

ARR:
1. ARR arr-side label shows "ETA" initially; double-click → edits arrPlanned
2. Click "ETA" → switches to "ATA"; double-click → edits arrActual
3. Enter ATA inline in actual mode, press Complete → ATA preserved
4. ARR dep-side shows ATD (inert, no toggle) when origin depActual is populated

OVR:
1. EOFT label shown for start-side (estimate mode); double-click → edits depPlanned
2. Click "EOFT" → switches to "AOFT"; double-click → edits depActual
3. ELFT label shown for end-side (estimate mode); double-click → edits arrPlanned
4. Click "ELFT" → switches to "ALFT"; double-click → edits arrActual
5. Enter ALFT inline, press Complete → ALFT preserved

DEP/LOC dep-side:
1. ETD shown initially; click → ATD; double-click in ATD mode → edits depActual
2. After Active is pressed: dep-side auto-shows ATD label (mode auto-resolves to actual since depActual now exists)

Regression:
1. Active rounding still works
2. Complete rounding still works when actual is blank
3. WTC exact-time still renders correctly
4. OVR blank-EOFT create-as-active still works (after Active stamps depActual, mode auto-updates to AOFT)

---

### 8.27 Ticket 6 (post-10.1) — Cancelled sorties log + optional cancellation reason

**Outcome:** complete

**Summary:**

Added a dedicated, immutable cancelled-sorties audit log backed by a new localStorage collection. When an operator cancels a strip, a lightweight confirmation modal captures an optional reason code and free-text note, then writes exactly one audit entry. The existing cancel behaviour (status → CANCELLED, formation cascade, booking sync) is preserved unchanged. A read-only viewer panel is added inside the History tab, below the existing History table.

---

**A. Storage layer — `datamodel.js`**

New storage key: `vectair_fdms_cancelled_sorties_v1`

Four new exported helpers added at the end of `datamodel.js`:

- `ensureCancelledSortiesInitialised()` — creates `[]` if key absent; defensively resets to `[]` if corrupt. Safe to call on every boot.
- `getCancelledSorties()` — returns the parsed array (calls `ensureCancelledSortiesInitialised()` first).
- `saveCancelledSorties(list)` — overwrites the stored list.
- `appendCancelledSortie(entry)` — pushes one entry and saves. Guards against duplicate `sourceMovementId`: if an entry for the same movement already exists, does nothing.

Log entry shape:
```
{
  id: "cancel_{timestamp}_{random}",
  sourceMovementId: <movement.id>,
  cancelledAt: "<ISO-8601 full timestamp>",
  cancellationReasonCode: "" | "OPS" | "WX" | "TECH" | "ATC" | "ADMIN" | "CREW" | "OTHER",
  cancellationReasonText: "<free text, max 300 chars>",
  snapshot: { ...movementAtMomentOfCancellation },
  bookingSnapshot: { bookingId } | null,
  createdFromVersion: 1
}
```

`snapshot` is a deep copy taken at the moment of cancellation via `JSON.parse(JSON.stringify(movement))`. It is written once and never mutated.

Initialisation / migration:
- If storage key absent → initialise to `[]`
- If storage key present but corrupt (parse error or non-array) → reset to `[]` with a console warning
- No historical backfill from existing CANCELLED movements (cannot be done safely or deterministically)

---

**B. Cancel modal — `ui_liveboard.js`**

`transitionToCancelled(id)` replaced with a modal-based flow using the existing `openModal()` / `closeActiveModal()` pattern. The old `confirm()` dialog is removed.

New modal shows:
- Strip identity: flight type badge, callsign, registration, route
- Warning text: "This will remove the strip from the Live Board and mark the flight as cancelled."
- Optional reason dropdown (`cancelReasonCode`) — 8 options including blank
- Optional note textarea (`cancelReasonNote`) — max 300 chars
- "Confirm Cancel" button (`.js-confirm-cancel`) — danger style
- "Back" button (`.js-close-modal`) — closes without cancelling

Reason code taxonomy stored in `CANCELLATION_REASON_CODES` array:
- `""` — no reason (default)
- `OPS` — operational / tasking change
- `WX` — weather
- `TECH` — aircraft technical / engineering
- `ATC` — ATC / airfield / slot / airspace
- `ADMIN` — paperwork / authorisation / admin
- `CREW` — crew / staffing
- `OTHER` — other

`cancellationReasonLabel(code)` helper maps code → display label for the viewer.

On confirm:
1. Snapshot taken: `JSON.parse(JSON.stringify(movement))`
2. Log entry built with full ISO `cancelledAt`
3. `appendCancelledSortie(entry)` called (with duplicate guard)
4. Existing cancel path executed: `updateMovement(id, { status: "CANCELLED" })`, `cascadeFormationStatus`, `onMovementStatusChanged`
5. `closeActiveModal()` called
6. Toast shown, Live Board + History + Cancelled Sorties Log re-rendered, daily stats updated

Modal lifecycle: uses `openModal()` / `closeActiveModal()` — no handler leaks; no `confirm()` fallback; all close paths covered.

---

**C. Cancelled Sorties Log viewer — `ui_liveboard.js`**

Two new exported functions:

`renderCancelledSortiesLog()` — renders `#cancelledSortiesBody`. Shows entries sorted most-recent-first. Columns:
- Type (flight type badge)
- Cancelled At (UTC, truncated to minute)
- Callsign
- Reg
- A/C Type
- Dep
- Arr
- Status at Cancel
- Reason (code badge, or — if none)
- Note preview (first 60 chars)
- Detail toggle button (expand/collapse snapshot)

Expanded snapshot row shows:
- Cancellation block: full ISO timestamp, reason code+label, note, booking ID at cancel time
- Strip snapshot block: callsign/voice, reg/type/WTC, route, DOF, rules, times, status at cancel, remarks

Module-level `_cancelLogExpandedId` tracks which row is expanded (one at a time, consistent with existing `expandedId` / `historyExpandedId` pattern).

`initCancelledSortiesLog()` — calls `ensureCancelledSortiesInitialised()` + `renderCancelledSortiesLog()`. Called from `app.js` boot sequence alongside `initHistoryBoard()`.

---

**D. History tab HTML — `src/index.html`**

New panel added immediately after the existing History table panel, inside `#tab-history`:
- Container: `<div class="panel cancelled-log-panel" id="cancelledSortiesPanel">`
- Panel header: "Cancelled Sorties Log — immutable audit trail"
- Table: `#cancelledSortiesTable` / `#cancelledSortiesBody` with 11 columns matching the viewer

---

**E. CSS — `src/css/vectair.css`**

New rules added after `.cancelled-strip:hover`:

Badge variants (also fix these being referenced in existing History code without CSS definition):
- `.badge-success` — green border/color
- `.badge-cancelled` — red border/color
- `.badge-type` — slate border/color, bold
- `.badge-reason` — purple border/color, bold

Cancel modal chrome:
- `.cancel-sortie-identity` — flex row for type badge, callsign, route detail
- `.cancel-sortie-callsign` — bold 15px
- `.cancel-sortie-detail` — muted 12px
- `.cancel-sortie-warning` — muted 12px warning text

Cancelled Sorties Log panel:
- `.cancelled-log-panel` — top margin
- `.cancelled-log-panel .panel-header` — dark header bar
- `.cancelled-log-row` — 12px font
- `.cancelled-log-detail-row` / `.cancelled-log-detail-cell` — expand row styling, red bottom border
- `.cancelled-log-detail` — flex two-column layout for snapshot detail
- `.cancelled-log-detail-section` — 11px, line-height 1.6, uppercase bold section label

---

**Files changed:**

1. `src/js/datamodel.js` — `ensureCancelledSortiesInitialised`, `getCancelledSorties`, `saveCancelledSorties`, `appendCancelledSortie` added; `CANCELLED_SORTIES_KEY` constant
2. `src/js/ui_liveboard.js` — imports updated; `CANCELLATION_REASON_CODES`, `cancellationReasonLabel()`, `transitionToCancelled()` replaced with modal flow; `renderCancelledSortiesLog()`, `initCancelledSortiesLog()`, `_cancelLogExpandedId` added
3. `src/index.html` — cancelled sorties panel HTML added inside `#tab-history`
4. `src/css/vectair.css` — badge variants, cancel modal chrome, log panel styles
5. `src/js/app.js` — `initCancelledSortiesLog` imported and called in boot sequence

**NO-DRIFT confirmations:**

- Live Board daily stats (event-based / EGOW-realized) — unchanged; cancellation writes to separate log only
- Monthly Return / Dashboard / Insights (nominal) — unchanged
- `flightType` — unchanged; additive model intact
- `outcomeStatus` / `outcomeReason` — unchanged; new log is additive, does not replace these fields
- ARR no-ATD fabrication — unchanged; `transitionToActive` untouched
- OVR excluded from runway totals — unchanged
- Hard delete (`performDeleteStrip`) — unchanged; writes no cancelled-log entry
- Booking reconciliation logic — unchanged; `onMovementStatusChanged` called in same place
- Modal lifecycle hardening — new modal uses `openModal()` / `closeActiveModal()` correctly; no handler leaks
- Formation cascade — `cascadeFormationStatus(id, "CANCELLED")` retained
- Inline time mode toggle / Active / Complete — untouched

**Migration / storage notes:**

- New key `vectair_fdms_cancelled_sorties_v1` is independent of `vectair_fdms_movements_v3`
- Key is initialised to `[]` on first access; no migration required
- Old sessions without the key will start with an empty log on first cancel
- No historical backfill from existing CANCELLED movements in `movements_v3` (not safe to do deterministically)

**Deferred / out of scope:**

- Undo/restore from cancelled log — not implemented
- Backend / email / reporting of cancelled sorties — not in v1 scope
- Cancelled sorties count in daily stats — out of scope per ticket spec

---

### 8.28 Ticket 6a (post-10.1) — Cancelled Sorties Log UX / History IA refinement

**Outcome:** complete

**Summary:**

Refactored the History tab into two distinct subpages — Movement History and Cancelled Sorties — using a horizontal subtab bar. Movement History now shows only COMPLETED movements. Cancelled Sorties is a dedicated destination that shows the Ticket 6 audit log with sort, filter, and export. The Ticket 6 inline panel is replaced by the dedicated subpage.

---

**A. History tab IA restructure — `src/index.html`**

`#tab-history` now wraps a `<div class="history-shell">` with:

1. `<nav class="history-subtab-bar" id="historySubtabBar">` — two buttons:
   - `hist-subpage-movements` (default active)
   - `hist-subpage-cancelled`

2. `<div class="history-subpage" id="hist-subpage-movements">` — contains existing history toolbar and `#historyTable` / `#historyBody`

3. `<div class="history-subpage hidden" id="hist-subpage-cancelled">` — contains text filter input (`#cancelledSortiesFilter`), Export button (`#btnExportCancelledCsv`), and `#cancelledSortiesTable` / `#cancelledSortiesBody` with `data-sort` headers

The Ticket 6 inline panel (`#cancelledSortiesPanel`) is removed from HTML.

---

**B. Movement History — COMPLETED-only (`ui_liveboard.js`)**

`renderHistoryBoard()` filter: `COMPLETED || CANCELLED` → `COMPLETED` only.

`exportHistoryCSV()`: filter also `COMPLETED` only; filename `fdms-movement-history-*.csv`; updated toast and empty message.

---

**C. Cancelled Sorties page — sort, filter, export (`ui_liveboard.js`)**

Module-level state: `_cancelLogSortColumn` (default `cancelledAt`), `_cancelLogSortDirection` (default `desc`), `_cancelLogFilter` (default `''`).

`sortCancelledSorties(entries, col, dir)` — string sort on: `cancelledAt`, `callsign`, `flightType`, `reg`, `type`, `depAd`, `arrAd`, `reason`.

`renderCancelledSortiesLog()` extended: applies text filter (OR search across callsign/reg/type/dep/arr/reasonCode/reasonLabel/note); applies sort; updates `▲`/`▼` thead indicators; contextual empty message; note cell `title` attribute for full text on hover.

`exportCancelledSortiesCSV()`: 24-column CSV (full log, not filtered — auditability); filename `fdms-cancelled-sorties-*.csv`.

`initCancelledSortiesLog()` extended: wires sort headers, filter input, export button.

---

**D. Subtab switching — `src/js/app.js`**

`initHistorySubtabs()`: queries `.history-subtab-btn` / `.history-subpage`; toggles `.active` / `.hidden` on click. Default state from HTML attributes. Called after `initHistoryExport()` in boot sequence.

---

**E. CSS — `src/css/vectair.css`**

`.history-shell`, `.history-subtab-bar`, `.history-subtab-btn`, `.history-subtab-btn.active`, `.history-subtab-btn:hover`, `.history-subpage` added. Uses accent-brown color to match admin nav active state.

---

**Files changed:**

1. `src/index.html` — History tab restructured; Ticket 6 inline panel removed; `data-sort` attrs on Cancelled Sorties thead
2. `src/js/ui_liveboard.js` — COMPLETED-only filter/export in history; sort/filter/export for cancelled sorties log
3. `src/js/app.js` — `initHistorySubtabs()` added and called
4. `src/css/vectair.css` — history subtab bar styles

**NO-DRIFT confirmations:**

- Ticket 6 audit log semantics unchanged (immutable snapshot, duplicate guard, one entry per movement)
- `transitionToCancelled`, `appendCancelledSortie`, `getCancelledSorties`, `saveCancelledSorties` unchanged
- Live Board daily stats unchanged
- Monthly Return / Dashboard / Insights unchanged
- Hard delete writes no cancelled-log entry — unchanged
- Booking reconciliation unchanged
- ARR no-ATD fabrication unchanged
- Inline time mode / Active / Complete / timing cluster unchanged

**Deferred / out of scope:**

- Date/time-period filter on Cancelled Sorties (text filter only in this ticket)
- Cancellation analytics / reason breakdown — not in v1 scope
- Undo/restore from cancelled log — not implemented

**Corrective patch (Ticket 6a-fix):**

Root cause: `.hidden` is not a global utility class in this codebase — each component scopes its own `.X.hidden { display: none; }` rule (`.tab-panel.hidden`, `.admin-section.hidden`, etc.). `.history-subpage.hidden` was missing this scoped rule, so both subpages remained visible despite the JS correctly toggling the class. Fix: one CSS rule added — `.history-subpage.hidden { display: none; }` in `vectair.css`. No JS, HTML, or data-model changes required.

---

## 9) Current status summary

### 9.1 What is true now

As of 2026-03-26:

* FDMS Lite remains on the approved desktop-local v1 path
* Live Board, booking sync, admin, formations, timing/duration, reconciliation surfacing, Sprint 9, Post-Sprint-9 correction pass, Sprint 10, Sprint 10.1, Ticket 1, Ticket 2, Ticket 3, Ticket 3a, Ticket 2b, Ticket 4, Ticket 4a, Ticket 5, Ticket 6, and Ticket 6a are all landed
* Ticket 6a (post-10.1) is the latest completed work

---

### 8.21 Ticket 3 (post-10.1) — Day Timeline fixed DEP/ARR display windows

**Outcome:** complete

**Summary of changes:**

DEP and ARR movement bars on the day Timeline no longer render as full-duration flight bars. They now render as short fixed-window bars anchored to the resolved departure or arrival time:

- **DEP**: bar starts at ATD (if actual exists) else ETD; bar runs forward for 10 minutes.
- **ARR**: bar ends at ATA (if actual exists) else ETA; bar runs backward for 10 minutes.
- **LOC**: unchanged — full canonical resolved span.
- **OVR**: unchanged — full canonical resolved span.

**Files changed:**

- `src/js/ui_liveboard.js` — only file modified.

**Where the constants live:**

`DAY_TIMELINE_FIXED_WINDOWS` constant at line ~6925 in `ui_liveboard.js`, immediately before the `renderTimelineScale` function. Defined as `{ depMinutes: 10, arrMinutes: 10 }` — separate keys allow independent tuning in a later ticket without changing the structure.

**Implementation approach:**

Added a new helper function `getDayTimelineDisplayRange(m)` that encapsulates the per-type display-span policy for the day Timeline:
- DEP: `{ start: anchorMinutes, end: anchorMinutes + depMinutes }`
- ARR: `{ start: anchorMinutes - arrMinutes, end: anchorMinutes }`
- LOC/OVR: full canonical span via existing `getMovementStartTime` / `getMovementEndTime` / `getDurationSource` logic (unchanged)

`renderTimelineTracks()` now calls `getDayTimelineDisplayRange(m)` instead of computing start/end inline. No other rendering logic changed. The canonical timing model in `datamodel.js` was not touched.

**LOC/OVR unchanged:** confirmed — LOC and OVR fall through to the existing resolved-span logic inside `getDayTimelineDisplayRange`, which is a direct extraction of the prior inline calculation. No behavioral difference for these types.

**Edge cases handled:**
- Missing anchor: returns `null` → movement is skipped (matches prior behavior for unrenderable timing).
- Cross-midnight clipping: a 10-minute window crossing the day boundary is handled by the existing clamp-to-timeline-bounds logic (`Math.max` / `Math.min`), which already handles overnight cases. The DEP/ARR windows may partially extend outside the 06–22 visible window and will be clipped or skipped just as full-duration bars were.
- Actual vs estimated: ATD is checked before ETD for DEP; ATA is checked before ETA for ARR — aligned with Sprint 10 normalization semantics.
- Status gating: not gated on status name — any movement with a valid anchor time will render. A PLANNED ARR with ETA renders; an ACTIVE/COMPLETED DEP with ATD renders.

**Manual verification scenarios:**
1. Planned DEP with ETD only → short 10-min bar from ETD.
2. Active/completed DEP with ATD → short 10-min bar from ATD.
3. Planned ARR with ETA only → short 10-min bar ending at ETA.
4. Completed ARR with ATA → short 10-min bar ending at ATA.
5. LOC strip → unchanged full-span bar.
6. OVR strip → unchanged full-span bar.
7. Mixed board (DEP + ARR + LOC + OVR) → DEP/ARR show short windows; LOC/OVR unchanged.
8. DEP near 23:58 → bar visible from 23:58–00:08; clipped at timeline end if within 06–22 window.
9. ARR at 00:04 → bar runs 23:54–00:04; clipped at timeline start if needed.

**NO-DRIFT confirmations:**
- Stored timing fields (`depPlanned`, `depActual`, `arrPlanned`, `arrActual`) not modified.
- Sprint 10 timing normalization model (`resolvedStartTime`, `resolvedEndTime`, `getDurationSource`) unchanged.
- Ticket 1 and Ticket 2 semantics unchanged.
- Live Board daily counters (event-based EGOW-realized) unchanged.
- Monthly Return / Dashboard / Insights (nominal strip-type-based) unchanged.
- WTC logic unchanged.
- History/counter logic unchanged.
- Booking reconciliation logic unchanged.
- Activate/Complete semantics unchanged.
- Inline/modal edit semantics unchanged.
- `flightType` field unchanged.
- OVR excluded from runway movement totals — unchanged.

**Known caveats:**
- A 10-minute window is narrower than the 2% minimum-width floor for bars. The existing `minWidthPercent = 2` floor still applies, so very narrow windows may render slightly wider than 10 minutes visually on wide screens. This is cosmetic only.
- The sort order for ARR movements in track allocation remains anchored to the canonical resolved start time (ETD/ATD), not the new display anchor (ETA/ATA − 10 min). This is acceptable — sort order affects track allocation, not bar position. Track allocation may be slightly suboptimal for ARR in edge cases but is not incorrect.

---

### 8.22 Ticket 3a (post-10.1) — Expose ARR/DEP Timeline display policy in Admin settings

**Outcome:** complete

**Summary of changes:**

Extended Admin → History & Timeline → Day View / Timeline Settings with a new "ARR / DEP Timeline Display" panel. The day Timeline renderer now reads the saved policy instead of always using the hardcoded 10-minute token window.

**New Admin controls:**
- Checkbox: "Use same timeline display settings for ARR and DEP" (default: checked)
- When shared: radio group (Token display time / Full flight duration) + token duration input (default 10 min)
- When separate: identical control pairs for Departures and Arrivals independently
- Shared/split blocks show/hide dynamically based on the checkbox
- Token duration input is disabled/de-emphasized when Full flight duration is selected
- All controls persist across save/discard/reload using the existing settings mechanism

**Files changed:**

1. `src/js/datamodel.js` — 7 new keys added to `defaultConfig`:
   - `timelineArrDepShared: true`
   - `timelineSharedMode: "token"`
   - `timelineSharedTokenMinutes: 10`
   - `timelineDepMode: "token"`
   - `timelineDepTokenMinutes: 10`
   - `timelineArrMode: "token"`
   - `timelineArrTokenMinutes: 10`

2. `src/index.html` — new "ARR / DEP Timeline Display" panel appended inside `admin-sec-history`, containing: shared checkbox, shared radio group + token duration input, DEP radio group + token duration input, ARR radio group + token duration input.

3. `src/js/app.js` — multiple additions within `initAdminPanelHandlers`:
   - 4 new element references
   - `configTimelineArrDepShared` added to `CHECKBOX_IDS`
   - 3 token minute IDs added to `VALUE_IDS`
   - `RADIO_GROUPS` array (`['tlSharedMode', 'tlDepMode', 'tlArrMode']`) for radio dirty tracking
   - `syncTimelineUi()` function: toggles shared vs split blocks, enables/disables token rows
   - `takeSnapshot` / `applySnapshot` / `isDirty` extended for `RADIO_GROUPS`
   - Change listeners for radio buttons and shared checkbox
   - Load logic from saved config
   - Save logic: extract + validate (1–120 min range) + `updateConfig` with 7 new keys

4. `src/js/ui_liveboard.js` — renderer updated:
   - `getEffectiveTimelinePolicy(ft)` helper: reads config, resolves shared vs separate policy for DEP or ARR, returns `{ mode, tokenMinutes }`
   - `_resolvedFullSpan(m)` helper: extracts the canonical full-span logic (used by DEP/ARR in "full" mode and by LOC/OVR unchanged)
   - `getDayTimelineDisplayRange(m)` refactored: DEP/ARR now delegate to `getEffectiveTimelinePolicy()`, LOC/OVR continue to call `_resolvedFullSpan()` unmodified

**LOC/OVR unchanged:** confirmed — `getDayTimelineDisplayRange()` LOC and OVR path is `return _resolvedFullSpan(m)` which is the same logic as before.

**Default behavior preserved:** with all defaults, `timelineArrDepShared: true`, `timelineSharedMode: "token"`, `timelineSharedTokenMinutes: 10` → DEP/ARR render exactly as in Ticket 3 (10-minute token windows).

**Settings persistence:** uses existing `updateConfig` → `saveConfig` → localStorage pipeline. New keys sit alongside existing timeline keys. Default fallback in `getEffectiveTimelinePolicy` is "token / 10 min" for any missing/invalid stored value.

**Manual verification scenarios prepared for Stuart:**
1. Default state after load/reset: shared checked, token selected, 10 min → current Ticket 3 behavior preserved
2. Shared + token = 10 min: DEP forward 10 min from ATD/ETD; ARR backward 10 min to ATA/ETA
3. Shared + full duration: both DEP and ARR show full-span bars (canonical resolved span)
4. Uncheck shared → split view: DEP token / ARR full duration (or reverse, or different minute values)
5. Save + reload: settings persist; UI restores correctly; radio buttons restored
6. Discard: snapshot restore re-applies radio states and re-triggers syncTimelineUi
7. LOC and OVR strips: unchanged behavior in all modes
8. Invalid token duration (e.g. 0 or empty): validation rejects, shows toast, settings not saved

**NO-DRIFT confirmations:**
- Stored timing fields unchanged
- Activate / Complete semantics unchanged
- Sprint 10 timing normalization model unchanged
- Ticket 1, Ticket 2, Ticket 3 semantics unchanged
- Live Board daily counters unchanged
- Monthly Return / Dashboard / Insights unchanged
- WTC logic unchanged
- History / counter logic unchanged
- Booking reconciliation logic unchanged
- LOC / OVR Timeline rendering unchanged

**Known caveats:**
- Token duration validation range is 1–120 minutes (consistent with auto-activation minute range). Values outside this range are rejected with a toast and the save is aborted.
- The `minWidthPercent = 2` floor in `renderTimelineTracks` applies regardless of mode; narrow token windows may render slightly wider than specified on wide screens.
- Full-duration mode for DEP uses the canonical resolved start (ETD/ATD) through end (ATA/ETA or duration fallback) — same as the pre-Ticket-3 behavior. This is intentional.

---

### 8.23 Ticket 2b (post-10.1) — LOC/ARR/OVR Complete semantic refinement + Timeline wording cleanup

**Outcome:** complete

**Summary:**

Two concerns addressed in one ticket: (A) formalizing the Complete-stamping rule as explicit named helpers; (B) user-facing wording cleanup for the ARR/DEP Timeline settings panel.

---

**A. Complete semantic refinement (`ui_liveboard.js`)**

The behavioral rule was already correct from Ticket 2 (`hasArrActual` check). This ticket formalizes and documents it through explicit named helpers, making the intent unambiguous for future maintenance.

**New helpers added before `transitionToCompleted`:**

`completionActualField(ft)` — maps movement type to its owned completion-side actual field:
- `LOC` → `arrActual` (ATA)
- `ARR` → `arrActual` (ATA)
- `OVR` → `arrActual` (ALFT)
- `DEP` → `null` (no completion-side actual)

`completionActualIsAbsent(movement)` — returns true only when the completion-side actual is genuinely blank. Distinguishes actuals (arrActual) from estimates (arrPlanned). Both system-stamped and manually-entered actuals return false (i.e., "not absent" → do not overwrite).

**`transitionToCompleted` refactored** to call these helpers:
- Stamp only when `completionActualIsAbsent(movement)` is true
- The `field` is resolved via `completionActualField(ft)`
- The inline comment and JSDoc make the preservation rule explicit
- DEP: no actual ever generated (completionActualField returns null)
- ARR: ATA stamped only if absent; ATD is explicitly documented as never fabricated here
- LOC: ATA stamped only if absent; ATD/depActual not touched
- OVR: ALFT/arrActual stamped only if absent

**Behavioral verification — all scenarios work correctly:**
1. LOC: Activate (stamps ATD) → operator edits ATD → Complete → edited ATD preserved; ATA stamped only if absent ✓
2. LOC: operator manually enters ATA before Complete → Complete preserves ATA ✓
3. LOC: ETA only (arrPlanned set, arrActual blank) → Complete stamps ATA now ✓
4. ARR: ETA only → Complete stamps ATA now ✓
5. ARR: operator enters ATA before Complete → Complete preserves ATA ✓
6. ARR: Activate (status-only) → Complete → no ATD created at any point ✓
7. OVR: blank EOFT create-as-active → ACT stamped → operator edits ACT → Complete → edited ACT preserved; ALFT stamped only if absent ✓
8. OVR: operator enters ALFT before Complete → Complete preserves ALFT ✓
9. OVR: estimated ELFT only (arrActual blank) → Complete stamps ALFT now ✓

---

**B. Timeline wording cleanup (`src/index.html`, `src/js/app.js`)**

Changed all user-facing "Token" terminology in the ARR/DEP Timeline Display admin panel to "Fixed display time":

- Panel description: "Token display time shows..." → "Fixed display time shows..."
- Shared radio label: "Token display time" → "Fixed display time"
- Shared duration label: "Token duration (minutes)" → "Fixed display time (minutes)"
- DEP radio label: "Token display time" → "Fixed display time"
- DEP duration label: "Departure token duration (minutes)" → "Departure fixed display time (minutes)"
- ARR radio label: "Token display time" → "Fixed display time"
- ARR duration label: "Arrival token duration (minutes)" → "Arrival fixed display time (minutes)"
- `syncTimelineUi()` inline comments updated from "token row" → "fixed display time row"

Internal IDs (`tlSharedModeToken`, `tlDepModeToken`, `tlArrModeToken`, `configTimelineSharedTokenMinutes`, etc.) left unchanged — renaming them would be cosmetic churn with no functional benefit.

Internal config keys (`timelineSharedMode: "token"`, etc.) left unchanged — changing stored string values would risk breaking existing saved settings.

**No functional regression to Ticket 3a settings behavior.** Save/load/discard still work correctly. Radio states persist. syncTimelineUi() behavior unchanged.

---

**Files changed:**
1. `src/js/ui_liveboard.js` — `completionActualField()`, `completionActualIsAbsent()` helpers added; `transitionToCompleted()` refactored
2. `src/index.html` — 7 user-facing label/description text changes
3. `src/js/app.js` — 3 comment updates in `syncTimelineUi()`

**NO-DRIFT confirmations:**
- DEP Complete semantics unchanged
- LOC/ARR/OVR Complete behavior: unchanged; now explicit
- Activate semantics unchanged
- ARR does not fabricate ATD — unchanged and documented
- Booking reconciliation unchanged
- Counters/reporting unchanged
- WTC logic unchanged
- Ticket 3a settings persist and load correctly
- LOC/OVR Timeline rendering unchanged
- Formation behavior unchanged

---

### 8.24 Ticket 4 (post-10.1) — Active-button minute rounding + WTC exact-time retention and display

**Outcome:** complete

**Summary:**

Two related concerns addressed together: (A) rounding the displayed operational actual time when Active is pressed; (B) retaining the exact second-bearing timestamp for WTC logic and displaying it on-strip as a secondary element.

---

**A. Active-button minute rounding (`ui_liveboard.js`)**

Two helper functions added immediately before `transitionToActive`:

`roundActiveStampToMinute(date)` — applies the nearest-minute rule:
- 00–29 seconds → round down (return HH:MM unchanged)
- 30–59 seconds → round up (+1 minute, returns HH:MM)

`getExactActiveTimestamp(date)` — returns exact HH:MM:SS for WTC use.

`transitionToActive` updated:
- `const now = new Date()` call unchanged
- `currentTime` now assigned via `roundActiveStampToMinute(now)` instead of raw HH:MM format
- `exactTime` assigned via `getExactActiveTimestamp(now)`
- When stamping `depActual` (DEP/LOC/OVR, not already present), also stamps `depActualExact = exactTime`
- ARR guard unchanged — no ATD fabricated; no `depActualExact` set for ARR

**B. Exact-time retention (`datamodel.js` + `ui_liveboard.js`)**

New movement field `depActualExact` (HH:MM:SS string):
- Set alongside `depActual` by Active press for DEP/LOC/OVR
- Never set for ARR (ARR Active is status-only)
- Not set when Active preserves an existing manual `depActual` (guard already present from Ticket 2)
- `ensureInitialised()` migration: `if (m.depActualExact === undefined) { m.depActualExact = ''; needsSave = true; }` — safe for old records, degrades gracefully to empty

**C. WTC exact-time display (`ui_liveboard.js`, `vectair.css`)**

In the strip renderer, after the `hasWtcAlert` computation:
- `wtcExactHtml` computed: non-empty only when `hasWtcAlert` is true AND `m.depActualExact` is non-empty
- Format: `<span class="wtc-exact-time" title="Exact WTC timing anchor">HH:MM:SS</span>`
- Appended inside the `cell-muted` WTC line, after the WTC category span

New CSS class `.wtc-exact-time`:
- `font-size: 10px` (smaller than 11px `cell-muted` baseline)
- `color: var(--va-text-soft)`, `opacity: 0.75`, `margin-left: 4px`, `font-weight: 400`
- Visually subordinate; does not compete with main strip times or WTC alert badge

**Visibility rule:** exact-time display is tied to the existing `wtcAlertThreshold` mechanism. If the threshold is "off" or the strip's WTC does not meet the threshold, `hasWtcAlert` is false and `wtcExactHtml` is empty — no display. If the movement has no `depActualExact` (old record, ARR, or manual-ATD-before-Active case), no display either.

**Files changed:**

1. `src/js/ui_liveboard.js` — `roundActiveStampToMinute()` and `getExactActiveTimestamp()` helpers added; `transitionToActive()` updated to use rounded display and exact WTC field; strip renderer updated with `wtcExactHtml` computed and injected into WTC cell
2. `src/js/datamodel.js` — `depActualExact` initialized in `ensureInitialised()` migration block
3. `src/css/vectair.css` — `.wtc-exact-time` class added after `.wtc-alert`

**NO-DRIFT confirmations:**
- ARR does not fabricate ATD — unchanged
- Ticket 2 / 2b Complete semantics unchanged
- Ticket 3 / 3a Timeline behavior unchanged
- OVR blank-EOFT create-as-active rule unaffected (create-as-active path goes through `transitionToActive` with normal guard)
- Event-based Live Board daily stats unchanged (`depActualExact` is not a time field counted by `egowRunwayContribution`)
- Nominal Monthly Return / Dashboard / Insights unchanged
- Booking reconciliation unchanged
- History model unchanged
- `flightType` unchanged
- Formation behavior unchanged
- Inline/modal edit semantics unchanged — editing `depActual` directly does not overwrite `depActualExact` (exact field is only set on Active press, not on manual edits)

**Backward compatibility:**
- Old records load with `depActualExact = ''` (migration default)
- Empty `depActualExact` → no WTC exact-time display rendered
- No manual migration steps required from Stuart

**Manual verification checklist for Stuart:**

Active rounding:
1. Press Active at a moment where seconds are 00–29 → displayed ATD/ACT rounds down (seconds dropped)
2. Press Active at a moment where seconds are 30–59 → displayed ATD/ACT rounds up (+1 min, seconds dropped)
3. Boundary: :29 → rounds down; :30 → rounds up

Movement types:
1. DEP Active → ATD shown as rounded HH:MM on strip; `depActualExact` stored as HH:MM:SS
2. LOC Active → ATD shown as rounded HH:MM; `depActualExact` stored
3. ARR Active → no ATD created; no `depActualExact` set; status transitions to ACTIVE only
4. OVR Active (including blank-EOFT create-as-active) → ACT shown as rounded HH:MM; `depActualExact` stored

WTC exact-time display:
1. Strip with WTC ≥ threshold: exact time appears as small muted HH:MM:SS text after WTC badge on the muted WTC line
2. Strip below threshold (or threshold = off): no exact-time text shown
3. Old record (no `depActualExact`): no exact-time text shown even if WTC alert active

Persistence:
1. Reload app with old records → no breakage; `depActualExact` defaults to empty
2. Activate a new DEP/LOC/OVR → save/reload → exact time persists correctly

---

### 8.25 Ticket 4a (post-10.1) — Complete rounding alignment + WTC exact-time display polish

**Outcome:** complete

**Summary:**

Two follow-on concerns from Ticket 4: (A) apply the same nearest-minute rounding rule to Complete auto-stamps so the rule is uniformly applied; (B) move the WTC exact-time from an inline sub-element of the WTC line to its own third line with more legible styling.

---

**A. Complete rounding (`ui_liveboard.js`)**

`transitionToCompleted()` previously computed `currentTime` as raw `HH:MM` directly from `new Date()`.

Changed to use `roundActiveStampToMinute(now)` — the same helper introduced in Ticket 4. No duplicate boundary logic; one central rule governs both Active and Complete auto-stamps.

All preservation invariants from Ticket 2 / Ticket 2b remain intact:
- Complete stamps `arrActual` only when `completionActualIsAbsent(movement)` returns true (via the helper from Ticket 2b)
- Existing actuals — system-stamped or operator-entered — are protected from overwrite
- DEP: no completion-side actual is ever generated
- ARR: ATA stamped only if absent; ATD is never fabricated here

**B. WTC exact-time display polish (`ui_liveboard.js`, `vectair.css`)**

Previous layout: `wtcExactHtml` was appended inline inside the `cell-muted` WTC div as a `<span>`.

New layout:
- `wtcExactHtml` is now a `<div class="wtc-exact-time">HH:MM:SS</div>` block
- Placed as a sibling element after the WTC `cell-muted` div, inside the same `<td>`
- Result: third line below the WTC category line, no label prefix — time only

CSS changes to `.wtc-exact-time`:
- `font-size`: 10px → 11px (matches cell-muted baseline, more readable)
- `font-weight`: 400 → 500 (stronger, more legible)
- `opacity`: 0.75 → removed (full opacity, clearer contrast)
- `margin-left`: 4px → removed (no longer inline, not needed)
- `white-space: nowrap` → removed (not needed as block)
- `line-height: 1.4` added (consistent with other secondary cells)

Visual result: the exact time is clearly readable on its own line, more legible than before, while remaining `--va-text-soft` color so it stays secondary to the main strip time block.

**Files changed:**

1. `src/js/ui_liveboard.js` — `transitionToCompleted()` uses `roundActiveStampToMinute`; strip renderer `wtcExactHtml` changed from inline span to block div, placed as sibling after WTC line
2. `src/css/vectair.css` — `.wtc-exact-time` class updated to block-appropriate styling

**NO-DRIFT confirmations:**
- Ticket 2b `completionActualField` / `completionActualIsAbsent` helpers unchanged
- Ticket 4 Active rounding unchanged
- Ticket 4 `depActualExact` field and migration unchanged
- ARR does not fabricate ATD — unchanged
- OVR blank-EOFT create-as-active path unaffected
- Timeline, counters, reporting, booking reconciliation, formations unchanged
- `transitionToCompleted` preservation guard logic unchanged — only the time-formatting line changed

**Manual verification checklist for Stuart:**

Complete rounding:
1. LOC, blank ATA → press Complete at :00–:29 → ATA rounds down (seconds dropped, minute unchanged)
2. LOC, blank ATA → press Complete at :30–:59 → ATA rounds up (minute +1, seconds dropped)
3. ARR, blank ATA → press Complete at :30+ → ATA rounded up; no ATD present
4. ARR with manual ATA already entered → press Complete → ATA preserved unchanged
5. OVR, blank ALFT → press Complete → ALFT stamped with rounded time
6. OVR with manual ALFT already entered → press Complete → ALFT preserved unchanged
7. DEP → press Complete → no ATA generated (DEP completion has no arrival-side actual)

WTC exact-time display:
1. DEP/LOC/OVR strip with WTC ≥ threshold: activate the strip → exact time appears as own third line (HH:MM:SS) below "WTC: M" (or equivalent) — no label prefix
2. Visual check: time is clearly readable on its own line; visually secondary to main ATD/ETA block; no opacity fade obscuring it
3. Strip with WTC below threshold or threshold = off: no exact-time line shown

---

### 9.2 What the next architect/chat should assume

Assume the following as baseline truths unless Stuart reports otherwise from manual testing:

* timing/duration sprint is landed
* reconciliation banner sprint is landed
* reconciliation is visible, not silent
* booking/strip integrity policy is stable and should not be reworked casually
* Sprint 9 features are landed: event-based Live Board stats, ETD/ATD/ETA/ATA labels, ZZZZ companion fields, PIC, outcome model
* Post-Sprint-9 features are landed: admin display toggles, field-specific tooltips, ARR timeline colour, ARR ATD recompute chain, status re-evaluation
* Sprint 10 features are landed: single resolved timing model (`getDurationSource`, `resolvedStartTime`, `resolvedEndTime`, `recalculateTimingModel` in datamodel.js); Timeline ARR bar start fixed to ETD/ATD; ARR modal sync direction corrected; inline edits now recalculate dependent timing; `transitionToActive` recalculates ETA from ATD
* Sprint 10.1 features are landed: DEP arr-side (ETA/ATA) now shown on strips; OVR arr-side (ELFT/ALFT) now shown on strips; boot-time migration recalculates stale ATD-based ETAs in pre-existing ACTIVE strips; edit modal ATD change triggers recalculation; per-type estimated-times config flags (`showDepEstimatedTimesOnStrip`, `showArrEstimatedTimesOnStrip`, `showLocEstimatedTimesOnStrip`, `showOvrEstimatedTimesOnStrip`) replace the legacy global flag
* Ticket 1 (post-10.1) features are landed: DEP right-side time is now inline-editable (double-click opens edit for ATA/ETA); OVR right-side time (ALFT/ELFT) is now inline-editable; ARR auto-activation (and manual activation) is status-only — no longer fabricates ATD
* Ticket 2 (post-10.1) features are landed: Activate guards existing ATD for DEP/LOC/OVR; Complete is type-aware (DEP no ATA, LOC/ARR/OVR stamp ATA=now only if absent); BM EGOW Unit code validation enforced in all 6 save paths (new DEP/ARR/OVR save+complete, new LOC save+complete, edit save+complete)
* Ticket 3 (post-10.1) features are landed: day Timeline DEP bars now render as 10-minute forward windows from ATD/ETD anchor; ARR bars render as 10-minute backward windows ending at ATA/ETA anchor; LOC/OVR rendering unchanged; `getDayTimelineDisplayRange()` helper added to `ui_liveboard.js`; no timing model changes
* Ticket 3a (post-10.1) features are landed: ARR/DEP Timeline display policy is now Admin-configurable (token vs full-duration, token duration minutes, shared vs separate for ARR/DEP); 7 new config keys in `datamodel.js` defaults; new Admin panel in `index.html`; `getEffectiveTimelinePolicy()` + `_resolvedFullSpan()` helpers added to `ui_liveboard.js`; all wired through `app.js` with full save/load/discard/dirty-tracking support
* Ticket 2b (post-10.1) features are landed: `completionActualField()` and `completionActualIsAbsent()` helpers added to `ui_liveboard.js`; `transitionToCompleted()` refactored to use them making the "stamp only when absent, preserve all actuals" rule explicit; ARR/DEP Timeline Admin panel user-facing wording changed from "Token display time" to "Fixed display time" throughout `index.html`; `syncTimelineUi()` comments updated in `app.js`; internal IDs and config key strings left unchanged for stability
* Ticket 4 (post-10.1) features are landed: Active-button minute rounding applied to DEP/LOC/OVR (`roundActiveStampToMinute` helper, 00–29 sec round down, 30–59 sec round up); exact WTC anchor retained in `depActualExact` (HH:MM:SS) alongside rounded operational `depActual`; WTC exact-time displayed on-strip when WTC alert threshold is met and exact time is available; `depActualExact` initialized to `''` in `ensureInitialised()` migration for backward compatibility; ARR Active remains status-only with no ATD fabrication
* Ticket 4a (post-10.1) features are landed: `transitionToCompleted()` now uses `roundActiveStampToMinute` so Complete auto-stamps obey the same nearest-minute rule as Active; WTC exact-time moved from inline sub-element to own third-line block `<div class="wtc-exact-time">` below the WTC category line — displays just the time with no label; `.wtc-exact-time` CSS updated (11px, weight 500, full opacity, block layout)
* Ticket 5 (post-10.1) features are landed: inline time labels (ETD/ATD/ETA/ATA/EOFT/AOFT/ELFT/ALFT) are now clickable mode selectors; clicking toggles between estimate and actual for that side; inline edit writes to the explicitly selected field — no inference from actual-field presence; mode is UI session state (auto-derives from actual presence by default, preserved across re-renders when explicitly toggled); `_inlineTimeModeMap`, `_inlineTimeModeExplicit`, `_resolveInlineTimeMode`, `_getInlineTimeMode`, `_setInlineTimeModeExplicit`, `_inlineTimeFieldForMode`, `_inlineTimeLabelForMode` added to `ui_liveboard.js`; OVR dep-side labels changed from ECT/ACT to EOFT/AOFT; label toggle CSS affordance added to `vectair.css`
* Ticket 6 (post-10.1) features are landed: immutable cancelled sorties log backed by `vectair_fdms_cancelled_sorties_v1` localStorage key; `transitionToCancelled()` replaced with modal-based flow capturing optional reason code + note; `appendCancelledSortie()` with duplicate guard; read-only Cancelled Sorties Log panel in History tab with snapshot detail expand; `CANCELLATION_REASON_CODES` taxonomy (OPS/WX/TECH/ATC/ADMIN/CREW/OTHER); existing cancel behaviour (status, cascade, booking sync) preserved unchanged; hard delete creates no log entry; daily stats / reporting / timing model unchanged
* Ticket 6a (post-10.1) features are landed: History tab split into two subtabs — Movement History (COMPLETED only) and Cancelled Sorties; horizontal `.history-subtab-bar` with accent-brown active state; `initHistorySubtabs()` in `app.js`; Movement History export is now COMPLETED-only; Cancelled Sorties page has text filter, column sort (8 columns), and dedicated CSV export (24-column full-log, not filtered); `sortCancelledSorties()`, `exportCancelledSortiesCSV()` added; Ticket 6 inline panel removed from HTML
* reporting.js intentionally uses nominal counting; Live Board uses event-based counting — this split is documented and must not be merged silently
* any next sprint should build on this baseline, not reopen already-settled invariants without explicit cause

---

## 10) Guidance for future ledger maintenance

When updating this file after each sprint:

1. update the top `Last updated` line
2. update the `Latest completed sprint` label
3. append a new sprint entry under Section 8 rather than rewriting history informally
4. state clearly whether behaviour changed, or only reporting/UX changed
5. record NO-DRIFT confirmations for high-risk subsystems when relevant
6. keep parked backlog separate from active sprint work

This file should remain readable by a fresh engineer or fresh chat session without needing to reconstruct hidden context from prior conversations.

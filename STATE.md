# STATE.md — Vectair FDMS Lite

Last updated: 2026-03-23 (Europe/London) — Latest completed sprint: Ticket 3 (post-10.1) — Day Timeline fixed DEP/ARR display windows

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
* `depActual`
* `arrPlanned`
* `arrActual`

These are stored as UTC `HH:MM` strings.
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

## 9) Current status summary

### 9.1 What is true now

As of 2026-03-23:

* FDMS Lite remains on the approved desktop-local v1 path
* Live Board, booking sync, admin, formations, timing/duration, reconciliation surfacing, Sprint 9, Post-Sprint-9 correction pass, Sprint 10, Sprint 10.1, Ticket 1, Ticket 2, and Ticket 3 are all landed
* Ticket 3 (post-10.1) is the latest completed work

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
* Ticket 3 (post-10.1) features are landed: day Timeline DEP bars now render as 10-minute forward windows from ATD/ETD anchor; ARR bars render as 10-minute backward windows ending at ATA/ETA anchor; LOC/OVR rendering unchanged; `DAY_TIMELINE_FIXED_WINDOWS` constant and `getDayTimelineDisplayRange()` helper added to `ui_liveboard.js`; no timing model changes
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

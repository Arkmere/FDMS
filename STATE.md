# STATE.md — Vectair Flite

Last updated: 2026-04-22 (Europe/London)

Current headline status:
- UTC-first timing hardening passes manual smoke for the tested strip lifecycle paths.
- Dual UTC/local timeline ruler is implemented as a display-only enhancement; UTC authority is unchanged.
- The internal timeline header strip has been removed; rulers now form the top/bottom boundaries of the timeline area.
- `main` is current locally and matches `origin/main`.
- Formation system primary implementation is **substantially complete** (FR-02 through FR-14b); FR-15 documentation closeout is the active workstream.
- Next feature workstream after FR-15: **Create From workflow** or Desktop Productization continuation.

This file is the shared source of truth for the Manager–Worker workflow:

- **Product Owner / SME:** Stuart
- **Solutions Architect & QA Lead:** ChatGPT
- **Production Engineer:** Claude Code

This ledger exists to prevent drift, preserve continuity across chats/sessions, and provide an audit-ready summary of what **Vectair Flite** is, how it behaves, what has been completed, what is deliberately deferred, what is in V1 scope, what is in V2 scope, and what the next recommended workstreams should be.

---

## Naming transition (NO DRIFT)

The product is now branded **Vectair Flite** (“Flite”).

Earlier development material may still refer to the same application as:

- **FDMS**
- **FDMS Lite**
- **Vectair FDMS**

These older terms refer to the same product unless explicitly stated otherwise. Going forward, use **Vectair Flite** or **Flite** wherever possible.

Reason for the spelling:

- **Flite** is a deliberate contraction of **FDMS + light**
- it preserves the aviation theme
- it reduces confusion with the literal airborne activity implied by “Flight”

Do not casually revert to the old product naming in new tickets, documentation, or summaries.

---

## 0) Delivery model / runtime model (CURRENT BASELINE, NO DRIFT)

### 0.1 Product definition

**Vectair Flite is NOT a website and NOT a hosted web app.**  
**Vectair Flite is a local flight-data management application** for Windows and Linux.

Current development and QA builds use HTML/CSS/JS internally for the UI and are run through a lightweight local harness such as:

```text
git pull
python -m http.server 8000
http://localhost:8000/

That local server is a development/runtime convenience only and must not be described as hosting.

0.2 OS support
Development OS: Windows
Operational target: Linux
Constraint: both must remain supported
0.3 Approved current development workflow

The current branch / PR / local-run workflow remains approved during development:

code changes via git branches + PRs
local execution via local harness
manual verification on Stuart’s Windows environment is the primary acceptance path
Playwright and similar harnesses are developer QA tooling, not end-user runtime requirements
0.4 Productization transition note

Historically, packaging / installers / updater mechanisms were treated as out of scope for the lightweight browser-era development model.

That is no longer the current roadmap direction.

They are now promoted into a dedicated Desktop Productization Workstream (V1) and must be treated as a major V1 track rather than as a casual feature add-on.

0.5 Drift guardrails

Do not:

describe Flite as a website or hosted web app
treat the local harness as hosting
confuse the current development harness with the intended installed product
collapse the distinction between the current browser-era runtime and the intended installed desktop product
casually reintroduce old FDMS naming in new baselines or docs
1) Product goal and system architecture
1.1 Product goal

Vectair Flite is a lightweight local ATC / ops support tool for flight-data workflow.

Core functions currently include or target:

Live Board for movement strips
booking workflow that can create and stay linked to strips
calendar for bookings and general events
admin / config tooling
reporting and lifecycle handling
local persistence in current development builds
future installed-desktop productization for V1
1.2 Runtime / storage model (current development baseline)
single-client local state model
persistence via localStorage in current development/runtime model
no backend in current baseline
no multi-user concurrency model
1.3 Target V1 product direction

V1 is no longer just “current local harness, but tidier”.

V1 now includes a dedicated Desktop Productization Workstream targeting a proper installed local program, including:

installer
auto-update capability
signed builds
robust local file/database layer
OS integration
better crash/error logging
cross-platform packaging discipline
clean migration from browser/localStorage-era state into app-managed state
1.4 Core UI / data modules

The current codebase remains organized around these major responsibilities:

src/index.html — shell / tab structure / panels
src/js/app.js — boot / wiring / tab init / high-level rendering hooks
src/js/ui_liveboard.js — Live Board, History, lifecycle actions, modals, inline editing, renderers
src/js/datamodel.js — movement storage, config, initialization, helper logic, lifecycle stores
src/js/reporting.js — reporting and official return logic
src/js/bookingSync.js — booking ↔ strip linkage reconciliation
src/css/vectair.css — styling
2) Canonical data / behavior invariants
2.1 Reporting split (intentional and settled)

Two reporting models exist and must remain distinct unless a dedicated sprint changes them.

Live Board daily stats

These are event-based / EGOW-realized:

DEP contributes only when departure actually occurred
ARR contributes only when arrival actually occurred
LOC contributes based on realized departure/arrival events plus T&G / O/S rules
OVR contributes 0 to runway totals
OVR remains a separate counter
Monthly Return / Dashboard / Insights

These remain nominal strip-type-based:

LOC = 2
DEP / ARR = 1
OVR = 0
T&G = +2
O/S = +1

These two systems are intentionally different. They must not be silently merged.

2.2 Canonical movement time fields

Stored canonical time fields are:

depPlanned
depActual
arrPlanned
arrActual
depActualExact — exact second-bearing WTC anchor for DEP / LOC / OVR active stamps

Storage format:

canonical operational fields: HH:MM
exact WTC anchor: HH:MM:SS

Canonical rule:

program time is UTC
local time is only a presentation/input layer
2.3 Booking / strip link invariants

Booking/strip linkage is bidirectional when valid:

a movement may carry bookingId
a booking may carry linkedStripId

bookingSync.reconcileLinks() remains the authority for deterministic repair / clear behavior on load:

clear movement.bookingId if referenced booking is missing
clear booking.linkedStripId if referenced movement is missing
repair booking.linkedStripId if exactly one strip validly claims the booking
detect conflicts if multiple strips claim the same booking
2.4 Modal lifecycle rules

Engineering rules:

all modal close paths must call closeActiveModal()
all modal open paths must call closeActiveModal() before opening a new modal
inline-edit Enter / Escape handlers must stop propagation appropriately
no ad-hoc modal teardown bypassing lifecycle helpers
2.5 Scope boundaries preserved so far

The following behaviors must not be changed casually because multiple tickets now depend on them:

OVR remains excluded from daily movement totals
ARR Active remains status-only and must not fabricate ATD
booking reconciliation policy is stable
timing / duration logic is integrated across create / edit / duplicate / lifecycle flows
formation WTC semantics are defined and implemented
current-state lifecycle views coexist with retained audit/lifecycle records
3) Stable implemented behavior (current baseline)

The following capabilities are considered implemented and broadly stable unless a new ticket explicitly changes them.

3.1 Live Board and strip lifecycle
Live Board rendering stable
history and daily counters stable under current rules
inline editing hardened for canonical time fields and required-field safety
status transitions and counter effects have had dedicated audit passes
timing / inline-time normalization cluster is complete
Active / Complete semantics by movement type are settled
hard delete as immediate annihilation is no longer the product model; deletion now routes through soft-delete retention
3.2 Booking ↔ strip sync
booking create/update can create or update linked strips
linked propagation behavior exists
reconciliation runs at bootstrap
reconciliation is surfaced visibly through the Integrity banner
reconciliation policy remains unchanged
3.3 Calendar
month / week / year implemented
general calendar create / edit / delete supported
3.4 Admin
two-pane Admin IA implemented
dirty-state save / discard where appropriate
restore / export / reset hardening present
backup metadata envelope and restore format detection in place
3.5 Formations

The formation system has undergone substantial implementation across the FR ticket series (FR-02 through FR-14b). The following records the implemented model as it now exists in code. This is the authoritative baseline; do not rely on older notes that described a weaker or partial system.

**A. Master strip role**

The master strip is the formation summary shell. It holds the top-level movement fields (callsign, route, planned times, flight type) and a nested `formation` object containing:

- `formation.label` — human-readable designation (e.g. `"CNNCT flight of 3"`)
- `formation.wtcCurrent` — highest WTC of PLANNED/ACTIVE elements (dynamic)
- `formation.wtcMax` — highest WTC of all elements regardless of status (preserved)
- `formation.shared` — shared/default layer for fields inherited by all elements
- `formation.elements[]` — array of per-element records (one per aircraft)

The master does not flatten or collapse element truth. It is a summary shell over individually-tracked elements.

**B. Element role**

Each entry in `formation.elements[]` represents a real aircraft in the formation. Elements can inherit from the shared defaults layer and can independently override inherited fields. Each element carries its own:

- `callsign` — base callsign + space + ordinal (e.g. `CNNCT 1`); convention mirrors ATC practice
- `reg`, `type` — registration and aircraft type
- `wtc` — wake turbulence category for this specific aircraft
- `status` — `PLANNED` / `ACTIVE` / `COMPLETED` / `CANCELLED` (independent per element)
- `depAd`, `arrAd` — departure and arrival aerodromes; empty string means inherit from shared layer (display-only fallback; stored as `""`)
- `depActual`, `arrActual` — individual actual times (UTC HH:MM)
- `tngCount`, `osCount`, `fisCount` — per-element or inherited counts
- `outcomeStatus`, `actualDestinationAd`, `actualDestinationText`, `outcomeTime`, `outcomeReason` — per-element diversion / outcome detail (FR-13 / FR-13b)
- `underlyingCallsign`, `pilotName` — per-element attribution identity and pilot (FR-14 / FR-14b)
- `overrides` dict — tracks which fields have diverged from the shared layer
- `ordinal` — 1-based position in formation (added by `normalizeFormation()`)

**C. Entry model**

Formation activation is explicit. The shared defaults layer (`formation.shared`) is populated from the master movement fields at creation time (master-first seeding, FR-07). `normalizeFormation()` re-derives and re-validates the shared layer on every load, including migration of pre-v1.1 formations (element-first synthesis, FR-08). Field-level inheritance is tracked per element via the `overrides` dict (FR-09): if an element field diverges from the shared value it is recorded in `overrides`; otherwise the shared fallback applies. In-session draft persistence retains partially-entered formation data within the current session (FR-03).

Element callsigns are generated on the `BASE_CALLSIGN + " " + ordinal` convention (FR-04). A formation exists only when `elements.length >= 2`; the authoring UI clamps element count to min=2, max=12.

**D. Operational behavior**

- **Per-element movement counting** (FR-10): `getResolvedFormationMovements()` sums per-element nominal movement contributions, resolving each element's `tngCount`/`osCount` overrides against the shared layer. `egowRunwayContribution()` sums per-element actual EGOW events using element-level actual times with master fallback.

- **Dynamic WTC** (FR-11): `formation.wtcCurrent` is recomputed as the highest WTC among PLANNED/ACTIVE elements after every element status change. `formation.wtcMax` is the highest WTC across all elements regardless of status and never decreases. WTC rank: `L < S < M < H < J`.

- **Element divergence** (FR-13): Elements hold statuses independently. The expanded formation panel renders a DIVERGED badge with per-status counts when elements are not all in the same status. `derivedFormationStatus()` returns a conservative summary: ACTIVE > PLANNED > COMPLETED > CANCELLED. Diverged rows are highlighted in the element table.

- **Master status cascade**: Master → COMPLETED cascades all PLANNED/ACTIVE elements to COMPLETED (CANCELLED elements preserved). Master → CANCELLED cascades all PLANNED/ACTIVE elements to CANCELLED (COMPLETED elements preserved). No cascade on activation.

- **Per-element diversion / outcome detail** (FR-13b): Each element records `outcomeStatus` (`NORMAL` / `DIVERTED` / `CHANGED` / `CANCELLED`), `actualDestinationAd`, `actualDestinationText`, `outcomeTime`, and `outcomeReason`. These are inline-editable in the element table in the expanded formation panel.

- **Per-element attribution identity / pilot** (FR-14 / FR-14b): Each element carries `underlyingCallsign` (explicit non-display operational identity) and `pilotName`. `resolveFormationElementIdentity()` applies a VKB-aware priority chain: explicit manual `underlyingCallsign` → VKB registration lookup → fixed callsign lookup → element callsign → master callsign. Pilot priority: explicit `pilotName` → EGOW codes by attribution callsign → EGOW codes by element callsign → master captain. Sources are tracked (`manual`, `registration`, `fixed-callsign`, `egow-attribution`, `master-captain`, etc.). Reporting credits each element to its resolved identity rather than the master.

**E. Expanded strip display**

The formation expanded panel (FR-12) contains:

- **Formation summary**: label, summary status, wtcCurrent, wtcMax, total movements, divergence badge
- **Shared defaults section**: key-value display of the shared layer
- **Element table**: one row per element with columns for ordinal, callsign, attr CS, pilot, reg, type, WTC, status, dep AD, arr AD, dep actual, arr actual, T&G, O/S, FIS, movements, outcome, actual destination, outcome time, reason — all inline-editable per row with an atomic Save button calling `updateFormationElement()`

**F. Completed formation tickets**

| Ticket | Delivered |
|---|---|
| FR-02 | Activation UX |
| FR-03 | Draft memory / in-session persistence |
| FR-04 | Callsign generation (base + ordinal convention) |
| FR-05 | Shared/default model |
| FR-06 | Enrichment |
| FR-07 | Master-first seeding |
| FR-08 | Element-first synthesis / load-time normalization |
| FR-09 | Field-level inheritance tracking (overrides dict) |
| FR-10 | Per-element movement counting |
| FR-11 | Dynamic wtcCurrent / wtcMax recomputation |
| FR-12 | Expanded strip display rebuild |
| FR-13 | Lifecycle divergence detection and display |
| FR-13b | Per-element diversion / outcome detail |
| FR-14 | Per-element pilot attribution |
| FR-14b | VKB-aware identity resolution assistance |
| FR-15 | Documentation closeout (this ticket) |

**G. Formation backlog (remaining future work)**

The following are not implemented and remain backlog:

- Formation creation via "Number of aircraft" count field in the New Flight modal — auto-generation of element set with callsigns
- Automatic master → element field propagation when master fields are edited after element set is established (break-inheritance on individual element edit)
- `formation_groups` table and `is_formation_master` / `element_index` fields — deferred data model schema track
- Deeper pilot / aircraft profile architecture (V2 direction)
- Broader report refinements for formation attribution beyond current baseline (e.g. historical formation analytics)
- Multiple WTC scheme support per formation (UK dep/arr vs RECAT)
- Advanced lifecycle / presentation enhancements beyond implemented baseline

4) Settled timing / interaction baseline

The following cluster is complete and should not be casually reopened unless Stuart reports a regression.

4.1 Sprint 10 — timing normalization

Intent:

one timing model per movement
inline edit and modal edit use the same semantics
Timeline is a projection of resolved timing, not a contradictory engine
4.2 Sprint 10.1 — timing normalization follow-on

Delivered/fixed:

active DEP right-side estimated/end-side display
active OVR right-side display
stale active LOC ETA correction
per-type estimated-time display toggles replacing the single global estimated-time toggle
4.3 Ticket 1 — remaining timing interaction defects

Delivered/fixed:

DEP right-side time inline editing
OVR right-side time inline editing
ARR activation no longer fabricates ATD
4.4 Ticket 2 — Activate / Complete semantics by movement type

Delivered/fixed:

Activate
DEP → stamps ATD if absent
LOC → stamps ATD if absent
OVR → stamps ACT/AOFT if absent
ARR → status-only; no ATD fabrication
Complete
DEP → no new end-side time
LOC → stamp ATA only if absent
ARR → stamp ATA only if absent
OVR → stamp actual end-side time only if absent

Also delivered:

BM validation: if EGOW code = BM, EGOW Unit is mandatory in new/edit forms
OVR Complete History display corrected
blank-EOFT create-as-active regression restored
4.5 Ticket 3 — day Timeline fixed DEP/ARR display windows

Delivered/fixed:

DEP and ARR no longer render as full-duration bars on day Timeline by default
day Timeline supports fixed-window display behavior for DEP/ARR
4.6 Ticket 3a — ARR / DEP Timeline display policy in Admin

Delivered/fixed:

ARR / DEP Timeline display policy exposed in Admin
shared/unshared ARR/DEP settings
“Fixed display time” wording adopted user-facing
fixed-display duration configurable
full-duration vs fixed-display-time mode configurable
4.7 Ticket 2b — LOC / ARR / OVR completion refinement

Delivered/fixed:

completion-side actual field ownership made explicit
Complete stamps only when the actual field is truly blank
estimates are not treated as actuals
ARR still does not fabricate ATD
Timeline wording cleaned to “Fixed display time”
4.8 Ticket 4 — Active-button minute rounding + WTC exact-time display

Delivered/fixed:

Active-button nearest-minute rounding:
00–29 sec → round down
30–59 sec → round up
exact second-bearing WTC time preserved for relevant Active-stamped cases
WTC exact-time display introduced
4.9 Ticket 4a — Complete-button rounding alignment + WTC polish

Delivered/fixed:

Complete auto-stamps now use same nearest-minute rounding rule as Active
WTC exact time moved to its own third line and made more legible
displayed as time only, no extra label
4.10 Ticket 5 — Inline time mode toggle

Delivered/fixed:

old inferred inline field routing removed
inline time labels explicitly toggle estimate vs actual mode
labels act as selector for which field inline editing writes to
mode is UI session state, not persisted in movement data
default:
actual mode if actual exists
estimate mode otherwise
explicit operator toggle survives re-renders for the session
manual inline ATA and ALFT survive Complete correctly
OVR terminology normalized to EOFT / AOFT and ELFT / ALFT where applicable
4.11 UTC-first timing hardening status

The UTC-first timing blocker is considered closed for the tested strip lifecycle paths.

Settled rule:

UTC is authoritative
all stored strip times are UTC
local is presentation/input only
local input must convert back to UTC before save
4.12 Timeline status

The Day Timeline display enhancement is now implemented and considered complete for V1 presentation purposes:

dual UTC/local ruler implemented
secondary ruler can be hidden when operationally same as UTC
top/bottom order can be swapped
internal timeline header strip removed
top and bottom rulers define the timeline boundaries
quarter-hour and half-hour ticks implemented
timeline remains display-only; UTC authority unchanged
5) Lifecycle model (current accepted baseline)

The lifecycle tranche is established and must be treated as the current product model.

5.1 Governing rule: current-state truth for operational reports

Operational views and ordinary reports use current-state truth.

A strip counts where it currently is:

if currently PLANNED / ACTIVE → Live Board / operational flow
if currently COMPLETED → Movement History
if currently CANCELLED → Cancelled Sorties / cancellation reporting
if soft-deleted → Deleted Strips only, excluded from ordinary operational reporting
if purged → nowhere

Historical lifecycle/audit data may still be retained, but must not override current-state operational views.

5.2 History information architecture

History now has three sibling subtabs:

Movement History (default) — completed movements only
Cancelled Sorties — current-state cancelled strips only
Deleted Strips — soft-deleted strips within retention window
5.3 Settled lifecycle table
Strip is currently...	Appears in...
PLANNED / ACTIVE	Live Board
COMPLETED	Movement History
movement exists and status = CANCELLED	Cancelled Sorties
soft-deleted (removed from movements store)	Deleted Strips
purged after retention expiry	nowhere
historical reinstated cancellation log entry	audit/export only, not operational views
6) Ticket 6 tranche — cancellation / deleted lifecycle
6.1 Ticket 6 — Cancelled sorties log + optional cancellation reason

Outcome: complete

Delivered:

dedicated cancelled-sorties localStorage-backed audit/log layer
optional cancellation reason code + optional note on cancellation
one log entry per cancellation event
duplicate guard
immutable cancellation snapshot stored at cancellation time
dedicated Cancelled Sorties visibility in History

Settled semantics:

Ticket 6 log remains a lifecycle/audit layer
it coexists with current-state operational views
it does not override flightType
cancellation remains additive, not substitutive
6.2 Ticket 6a — History IA refinement

Outcome: complete

Delivered:

History split into sibling subtabs
Movement History remains the default subpage
Cancelled Sorties moved off the old inline panel and into its own page
Cancelled Sorties gained sort / text filter / full-log CSV export
Movement History remains completed-only
6.3 Ticket 6a.1 — Cancelled Sorties full editability

Outcome: complete

Cancelled strips are fully editable from the Cancelled Sorties page.

Delivered:

row action dropdown
Edit Strip → opens normal movement edit workflow for the underlying cancelled movement
Edit Reason → edits mutable top-level cancellation record fields
current-state display updates immediately after save

Semantics:

the underlying cancelled movement is fully editable
current-state cancellation reason/note may be updated later
historical cancellation snapshot remains preserved
current-state reporting reflects the edited current cancellation record, not only the original first-write snapshot

Expanded detail distinguishes:

cancellation record
current strip state
snapshot at cancellation
6.4 Ticket 6a.2 — Reinstate cancelled strips with offset-aware timing

Outcome: complete

Chosen reinstatement target state: PLANNED

Rationale:

reinstated strips re-enter the flying programme as planned items
operator activates deliberately later
no activation event is fabricated

Reinstatement rule:

newStartTime = max(originalPlanned, now + typeOffset)

Per-type interpretation:

Type	Start-side field	Config offset	Field label
DEP	depPlanned	depOffsetMinutes	ETD
ARR	arrPlanned	arrOffsetMinutes	ETA
LOC	depPlanned	locOffsetMinutes	ETD
OVR	depPlanned	ovrOffsetMinutes	EOFT

Notes:

original planned start-side time is taken from the immutable snapshot
end-side recalculation is run only when no actuals are present
formation elements with CANCELLED status are cascaded back to PLANNED
reinstated log entries are marked reinstated: true, reinstatedAt, reinstatedNewStartTime
reinstated entries are excluded from current-state Cancelled Sorties
re-cancel after reinstatement is supported

Current-state effect:

once reinstated, the strip no longer counts as cancelled
it counts according to its current operational status instead
6.5 Ticket 6a.3 — Deleted Strips retention tab + soft-delete lifecycle

Outcome: complete

Deletion is no longer immediate unrecoverable annihilation.

Instead:

full snapshot is copied into deleted-strips retention store
deletedAt and expiresAt are recorded
booking linkedStripId is cleared
movement is removed from active movements store
strip disappears from ordinary operational views immediately

Retention period:

24 hours
hardcoded in datamodel.js
Admin configurability deferred

Restore semantics by original status at delete:

Status at delete	Restore target	Timing recalculation
PLANNED or ACTIVE	PLANNED	offset-aware rule: max(originalPlanned, now + typeOffset)
CANCELLED	CANCELLED	none
COMPLETED	COMPLETED	none

Notes:

booking re-linkage on restore is not automatic
restored movement retains visible bookingId
operator re-links manually if needed

Purge behavior:

expired deleted entries are purged on app load
purged before Deleted Strips render
purged on Deleted Strips subtab click

Deleted strips are excluded from ordinary reporting immediately because they are removed from getMovements().

6.6 Corrective current-state semantics patch

Outcome: complete

Corrected mismatch:

Cancelled Sorties is a current-state view, not a snapshot-backed archive

Settled rule:

A row belongs in Cancelled Sorties only if:

sourceMovementId resolves to an existing movement
that movement currently exists in getMovements()
that movement’s current status === CANCELLED

Therefore:

reinstated rows do not appear in Cancelled Sorties
soft-deleted rows do not appear in Cancelled Sorties
deleted rows appear only in Deleted Strips
snapshot-only orphan rows do not render in current-state Cancelled Sorties

Also delivered:

Delete action added to Cancelled Sorties row actions
Delete routes through the same soft-delete retention pathway used elsewhere
7) No-drift confirmations for the lifecycle tranche

The lifecycle tranche must not be interpreted as reopening older settled behavior.

Unchanged:

Live Board daily stats remain event-based / EGOW-realized
Monthly Return / Dashboard / Insights remain nominal
ARR Active remains status-only; no fabricated ATD
Ticket 5 inline time mode semantics remain intact
timing / rounding / WTC exact-time cluster remains intact
booking reconciliation policy remains unchanged
booking is not auto-restored on reinstate / restore
OVR remains excluded from runway totals
Movement History remains completed-only
7b) Ticket 6b — Cancellation / Lifecycle Reporting

Outcome: complete

Delivered:

dedicated Cancellation Report view inside the Reports tab, consistent with existing Reports IA
date-range filter (start date / end date) with sensible 30-day default on load
summary KPI cards:
total cancellations
no-reason-assigned count
most common reason
most cancelled movement type
reason code breakdown table:
OPS / WX / TECH / ATC / ADMIN / CREW / OTHER / Unassigned
counts and percentages
movement type breakdown table:
DEP / ARR / LOC / OVR
counts and percentages
ranked “most cancelled” tables:
Aircraft Type
Registration
Captain/PIC
Departure Aerodrome
Arrival Aerodrome
row-level detail table showing all current-state cancelled records in range
Export Cancellations CSV button: row-level export of the cancellation dataset with all key fields

Files changed:

src/js/reporting.js
src/js/ui_reports.js
src/index.html
src/css/vectair.css

Data-source decision (documented):

primary reporting dataset: getMovements() filtered to status === 'CANCELLED'
reinstated rows excluded automatically
soft-deleted rows excluded automatically
reason code and reason text taken from the mutable top-level fields on the getCancelledSorties() log entry, not from the immutable snapshot
date field for range filtering: cancelledAt from the log entry (primary); fallback to dof from the current movement record if needed
default range: last 30 days inclusive

Historical / lifecycle-event analytics:

not included in Ticket 6b
if added later, they must be clearly separated and labeled per section 5.1

No-drift confirmations for Ticket 6b:

timing / inline-time model — unchanged
Active / Complete semantics — unchanged
reinstatement logic — unchanged
soft-delete retention semantics — unchanged
booking reconciliation behavior — unchanged
Live Board event-based vs nominal reporting split — unchanged
History IA / lifecycle rules — unchanged
Monthly Return / Dashboard / Insights — unchanged
Cancelled Sorties view / Deleted Strips view — unchanged
8) Documentation workstream (explicit continuity layer)

Documentation is now an explicit parallel workstream owned by ChatGPT as part of the Solutions Architect / QA role.

Claude remains the engineer. ChatGPT maintains and updates documentation when features, naming, workflows, or operational behavior change.

8.1 Documentation baseline currently in use

The living documentation set consists of:

README.md
Quick_Start_Guide.md
User_Guide.md
Install_Update_Backup_Troubleshooting.md
8.2 Documentation maintenance rule

For each future implementation ticket, explicitly state one of:

Docs: no change
Docs: update README
Docs: update Quick Start
Docs: update User Guide
Docs: update Install/Update/Backup/Troubleshooting

or any combination of the above.

8.3 Documentation principles until V1
accurate beats complete
concise beats exhaustive
current behavior beats aspirational behavior
provisional areas should be labeled plainly
naming should use Vectair Flite / Flite, with legacy FDMS wording only where needed for continuity
8.4 Future docs structure note

The documents are currently maintained locally and may later move into a /docs/ structure.

9) Known limitations / deliberate boundaries

These are known and intentional unless later promoted into dedicated tickets/workstreams.

9.1 Cancellation analytics — historical lifecycle-event mode not yet implemented

Ticket 6b delivers current-state operational cancellation reporting only.

Not yet implemented:

historical lifecycle-event counts from the cancellation log
audit dashboard for all lifecycle transitions over time
date-range analytics based on cancellation-event timestamps only

These are deferred and must remain clearly separated from current-state totals if implemented.

9.2 Deleted-strip retention configurability
retention period is hardcoded to 24 hours
Admin configurability deferred
9.3 Booking re-linkage on restore
restoring a deleted strip does not automatically restore booking linkage
operator re-links manually if needed
9.4 Manual purge-now action
not implemented
omitted deliberately until a safe confirmation model is scoped
9.5 Full lifecycle event/audit reporting

Historical lifecycle data is retained where needed for audit/export, but no dedicated audit dashboard exists yet.

9.6 API / VKB integration not in current baseline

Full Vectair-backed API / VKB integration is not part of the current functional baseline. It is explicitly a V2 workstream.

9.7 METAR Builder not yet implemented

METAR Builder is in V1 scope but not yet implemented.

9.8 Desktop productization not yet implemented

The installed-desktop target is part of V1 scope, but the current runtime remains the development harness / localStorage model.

10) Roadmap classification

The roadmap is classified into:

V1 required workstreams
V2 workstreams
rolling / lower-priority updates
10.1 V1 required workstreams
A. Desktop Productization Workstream

Scope includes:

installer
auto-update capability
signed builds
robust local file/database layer
OS integration
better crash/error logging
cross-platform packaging discipline
migration from browser/localStorage-era state into app-managed state
B. DST-aware Auto timezone (Europe/London)

This was a V1 correctness item.

Status update:

the core UTC-first timing hardening pass is complete for the tested strip lifecycle flows
remaining timezone-related work is now primarily display/configurability/polish unless Stuart reports a regression
C. Formation continuation / expansion

The formation primary implementation tranche (FR-02 through FR-14b) is complete. The formation model is substantially implemented for V1 operational use: per-element tracking, dynamic WTC, lifecycle divergence, diversion outcome detail, and attribution identity are all in place and stable.

FR-15 (documentation closeout) is the final ticket in this tranche, aligning STATE.md and FORMATIONS.md with what now exists in code.

Remaining formation backlog items (auto-creation UX, master→element propagation, deeper profile architecture) are bounded improvements. They do not block V1 operational use of formations. They are deferred rather than blocking.

After FR-15, the formation workstream is considered substantially closed for V1. Remaining backlog items are recorded in section 3.5.G and may be promoted to dedicated tickets as priorities allow.

D. Create From workflow

The older “Duplicate → Create from…” concept is promoted into V1 scope as the Create From workflow.

E. METAR Builder

Purpose:

all constituent METAR components are selectable/editable
the system generates a plain-text METAR-style output string
output is suitable for copy/paste into email or related operational communications
10.2 V2 workstreams
A. API / VKB integration

Introduce fuller Vectair-backed knowledge integration so Flite can move beyond downloaded/static packs toward fuller VKB usage.

B. Booking confirmation email / pilot briefing / GAR note

Includes:

booking confirmation email
pilot briefing output
note that GAR is required for arrivals/departures outside contiguous UK and is not managed by ATC
10.3 Rolling / lower-priority updates

These are useful but not launch-defining:

Booking re-linkage
Deleted Strip retention configurability
Historical lifecycle event analysis
Callsign family grouping (Ticket 6c)
Notification / reminder system
Dynamic local timezone abbreviation rendering for timeline ruler labels
replace hardcoded local label text such as BST (+1) with dynamically derived local timezone abbreviations tied to Flite’s operational timezone source
preferred future behavior:
derive abbreviation from the same timezone source used for UTC↔local conversion
support seasonal/localized changes automatically where appropriate
fall back to offset-based text if no reliable abbreviation is available
11) Recommended implementation order
11.1 V1 programme structure

V1 should be understood as three parallel tracks:

Track A — Desktop Productization

Begin early at the architecture/planning level and continue through release hardening.

Track B — Core Feature Completion
Formation continuation / expansion
Create From workflow
METAR Builder
Track C — Release Hardening and Documentation
naming continuity
install/update guidance
operator/user reference
backup/troubleshooting guidance
version/release notes discipline
11.2 Recommended practical order

Current recommended sequence:

define desktop productization architecture
define persistence / migration architecture
define packaging / signing / update / logging strategy
Formation continuation / expansion
Create From workflow
METAR Builder
implement installed-desktop packaging path
implement migration into app-managed state
cross-platform hardening and launch-readiness pass
11.3 Immediate next-up status

Formation continuation / expansion (primary tranche) is **complete**. FR-15 documentation closeout is the current active workstream.

After FR-15 closes, the next recommended feature workstream is:

**Create From workflow** (Track B)

Desktop productization (Track A) remains the biggest overall launch-risk, but the next discrete feature work should be Create From workflow.

11.4 Deferred from immediate next-up status

The following are not the next active tranche now:

Formation continuation / expansion — substantially complete; remaining backlog is bounded (see section 3.5.G)
Ticket 6c — Callsign family grouping
historical lifecycle-event analytics

They remain valid backlog items but are not the immediate next recommended work.

12) Manual verification posture

Accepted posture remains:

Stuart continues to smoke-test manually on Windows
Claude implements narrowly to ticket
ChatGPT maintains scope discipline, no-drift rules, documentation continuity, and ledger quality
heavy automation should only be introduced where it materially reduces uncertainty
13) Minimal restart instructions

When asked how to run Flite locally during the current development phase, give only:

git pull
python -m http.server 8000
http://localhost:8000/

No extra scaffolding unless specifically requested.

14) Current accepted baseline summary

The current accepted functional baseline is:

post-10.1 timing / inline-time cluster complete
UTC-first timing hardening for the tested strip lifecycle flows is passing
dual UTC/local timeline ruler is implemented
timeline header strip has been removed
timeline display is considered complete for V1 presentation purposes
Cancelled Sorties is a current-state cancelled view
cancelled strips are fully editable
cancelled strips can be reinstated to PLANNED using offset-aware timing rules
deletion uses soft-delete retention into Deleted Strips
deleted strips are excluded from ordinary reports immediately
Movement History / Cancelled Sorties / Deleted Strips form the three-view lifecycle history model
Ticket 6b cancellation reporting is complete
Ticket 6c is deferred
product name is now Vectair Flite
documentation is an explicit maintained workstream
V1 scope includes desktop productization, formation continuation/expansion, Create From workflow, and METAR Builder
V2 scope includes API / VKB integration and booking confirmation / pilot briefing / GAR note

formation primary implementation (FR-02 through FR-14b) is complete
formation documentation closeout (FR-15) is complete
formation expanded element display refactored from table rows into strip-style child cards (presentation-layer only; no data model changes)
formation child cards use the formation element callsign (e.g. MERSY1) as the primary strip callsign
generic crew/callsign attribution and pilot identity moved to secondary/detail position within each child card
formation child cards use normal flight-type colour language (LOC/pink, DEP/blue, ARR/orange, OVR/green)
no formation model, counting, WTC, lifecycle, status cascade, inheritance, or persistence logic changed
formation backlog (creation UX automation, master→element propagation, deeper profile architecture) is bounded and deferred; does not block V1 operational use

This is the baseline future tickets should assume unless Stuart reports a regression or explicitly reprioritizes roadmap scope.

15) Desktop Productization Workstream — progress log
DP-01 — Tauri scaffold recognised

Status: complete (validated on Stuart's Windows environment)

Outcome: cargo tauri dev recognises the project and begins the build pipeline.

DP-02 — Windows icon assets (blocker found and resolved)

First real Windows runtime blocker encountered during DP-02 validation:

tauri-build requires src-tauri/icons/icon.ico (and the standard PNG set) to generate the Windows Resource file (.rc) embedded in the binary
the src-tauri/icons/ directory was absent from the repository
build failed with: icons/icon.ico not found

Resolution (2026-04-03):

created src-tauri/icons/ and committed the minimum required placeholder icon set:
icon.ico — ICO container embedding 32 × 32 and 256 × 256 PNG images
32x32.png — 32 × 32 RGB placeholder
128x128.png — 128 × 128 RGB placeholder
128x128@2x.png — 256 × 256 RGB placeholder (2 × HiDPI)
icon.png — 512 × 512 RGB placeholder
all files are structurally valid (correct PNG signature / ICO header) but contain only a solid neutral-gray fill
final branding/icon design is explicitly deferred
no app logic, storage model, or desktop architecture was changed

Next step:

continue DP-02 Windows validation/retest loop and clear the remaining corrective defects before any DP-03 work begins
DP-02 — Windows interactive validation (corrective tranche, 2026-04-08)

Windows interactive validation against 11 items produced mixed results on branch claude/protect-baseline-PM0XU. The following defects were identified and fixed in-branch in a narrow corrective tranche (no DP-03 scope, no storage changes):

Item 4+5 — saveCancelledSorties is not defined (FAIL → FIXED)
Cause: saveCancelledSorties was exported from datamodel.js but absent from the ui_liveboard.js import block. reinstateFromCancelledLog and updateCancelledSortieReason both call it, producing a ReferenceError at runtime.
Fix: added saveCancelledSorties to the import block in ui_liveboard.js.
Item 7 — Cancellation Report filter not re-rendering on date change (NOT TESTABLE → FIXED)
Cause: only change event was wired on the date range inputs; browser date-picker in WebView2 fires input not change during incremental selection.
Fix: added input event listener alongside change for both cancelReportStart and cancelReportEnd inputs in ui_reports.js.
Item 8 — Export Cancellations CSV gives no visible result (PARTIAL → FIXED)
Cause: handleExportCancellationsCSV had no feedback at all; blob downloads go silently to the OS Downloads folder under WebView2.
Fix: added showToast import to ui_reports.js; updated handler to toast the filename with “check your Downloads folder” on success, and to toast an info message when the selected range contains no rows.
Item 9 — Inline dep-actual time save doesn't activate PLANNED strip (FAIL → FIXED, two passes)
First-pass fix addressed seed-text pollution and added Part F activation check, but Part F was gated on fieldName === 'depActual' — a condition that can never be true in the common operator workflow (PLANNED strip → estimate mode → time cell bound to depPlanned).
Root cause confirmed: for a PLANNED DEP/LOC strip the dep-time cell is in estimate mode by default. _inlineTimeFieldForMode('DEP', 'dep', 'estimate') returns depPlanned. When the operator enters a historical departure time, the write goes to depPlanned, not depActual. Part F never fired.
Fix: added a Historical dep-actual redirect block in saveEdit() before the transactional update. When fieldName === 'depPlanned' and the strip is PLANNED DEP/LOC and the entered time is in the past (checkPastTime), the write is transparently redirected to depActual.
depPlanned is left unchanged (ETD is preserved as the plan).
ARR strips are not affected.
Save & Complete in Cancelled Sorties / Deleted Strips edit modal — DEFERRED
The edit modal shows “Save & Complete” regardless of strip status, which is inappropriate when editing a CANCELLED or soft-deleted strip.
Deferred to a future ticket; does not block DP-02 close.
Backlog — configurable CSV export save location (UX improvement, not DP-02)
Current behaviour: blob download goes silently to the OS Downloads folder; a toast now tells the operator the filename and to check Downloads.
Future UX improvement: allow the operator to configure a preferred export folder via the Admin / Config panel.
Requires Tauri dialog + fs plugins.
Not trivially local. Do not implement under DP-02.
DP-03 and beyond

Not started. Do not begin until DP-02 desktop validation is confirmed clean.

16) Unified Timing Model — implementation record (2026-04-20)
Root cause summary

The codebase mixed two time models:

canonical model in src/js/datamodel.js: getOperationalTimezoneOffsetHours() resolves Europe/London seasonally (BST = +1, GMT = 0) for config values 0 or 1; uses explicit offset directly for other values
legacy paths still active:
initClock() in app.js read raw config.timezoneOffsetHours directly (bypassing seasonal resolution)
getTimeWithOffset() / addMinutesToTime() in datamodel.js used browser-local Date methods rather than UTC methods

This caused BST-season disagreement:

the banner local clock showed the raw stored offset
modal UTC↔Local conversion correctly showed seasonal behavior
default planned times were skewed by host machine local time rather than UTC
Files changed
src/js/datamodel.js
getTimeWithOffset(offsetMinutes):
replaced local Date mutation with UTC-based total-minutes arithmetic
addMinutesToTime(timeStr, minutesToAdd):
replaced local Date arithmetic with pure integer minutes arithmetic
getOperationalTimezoneOffsetHours():
exported for use by runtime consumers
src/js/app.js
added getOperationalTimezoneOffsetHours import from ./datamodel.js
initClock():
replaced raw cfg.timezoneOffsetHours banner local-time logic with canonical operational offset logic
Smoke results

Pass

Verified outcomes:

banner UTC/local parity behaves correctly
default new-strip times are generated from UTC basis
modal UTC/local parity preserved
reciprocal timing no longer skews via host local clock
explicit non-UK offsets still behave literally
Deferred items

None identified in this tranche. Modal UTC↔Local toggle logic in ui_liveboard.js was not changed here. Data schema unchanged. Timeline policy unchanged.

17) Activate/Complete UTC stamping fix — implementation record (2026-04-20 / verified 2026-04-21)
Root cause

roundActiveStampToMinute() and getExactActiveTimestamp() in src/js/ui_liveboard.js used local-time Date methods despite comments stating UTC wall-clock output. On a BST host these helpers stamped times one hour ahead of UTC into depActual, arrActual, and depActualExact.

File changed
src/js/ui_liveboard.js
roundActiveStampToMinute(date):
replaced local-time methods with UTC equivalents
getExactActiveTimestamp(date):
replaced local-time methods with UTC equivalents

No surrounding transition logic (transitionToActive, transitionToCompleted) was modified in this tranche.

Smoke results

Pass

Verified outcomes:

Activate stamps UTC, not system local time
Complete stamps UTC, not system local time
depActualExact is UTC HH:MM:SS
no regression in lifecycle semantics
18) UTC authority enforcement in ui_liveboard.js — final cleanup (2026-04-21)
Purpose

After sections 16 and 17, the app still had residual ui_liveboard.js paths that bypassed the UTC-first model. These were remaining exceptions, not architectural flaws.

Canonical rule reaffirmed:

UTC is authoritative
all stored strip times are UTC
local time is only display/input convenience
local input is converted back to UTC before save
Root cause

The remaining incorrect paths were all in src/js/ui_liveboard.js:

shouldShowNewFormTimeModeToggle() still used raw cfg.timezoneOffsetHours rather than the canonical helper
general Save & Complete still generated fallback currentTime from local/system time
LOC Save & Complete still generated fallback currentTime from local/system time
File changed
src/js/ui_liveboard.js
import list:
added shouldShowUtcLocalToggleForNewForms
shouldShowNewFormTimeModeToggle():
replaced raw config interpretation with canonical helper call
general Save & Complete handler:
changed fallback currentTime from local getHours()/getMinutes() to UTC getUTCHours()/getUTCMinutes()
LOC Save & Complete handler:
changed fallback currentTime from local getHours()/getMinutes() to UTC getUTCHours()/getUTCMinutes()
Important diagnostic conclusion

The strip-face rendering path displays stored values directly; it does not convert UTC values to local on the strip face. Therefore, the remaining visual timing errors at that stage were write-path problems, not strip-face presentation illusions.

Smoke results

Pass

Verified outcomes on brand-new strips:

Plain Save: pass
Activate: pass
Complete: pass
Save & Complete: pass
Save & Complete LOC: pass
Local input converts back to UTC on save: pass
Outcome

The timing blocker for the tested strip lifecycle paths is considered closed for this tranche.

19) Dual UTC/local timeline ruler — implementation record (2026-04-21)
Purpose

Display-only enhancement to the Day Timeline ruler. Adds an optional secondary local-time ruler row while preserving UTC authority.

Files changed
src/js/datamodel.js

Added config defaults:

timelineShowLocalRuler: true
timelineHideLocalRulerIfSame: true
timelineSwapUtcLocalRulers: false
src/js/ui_liveboard.js
added canonical local-distinctness logic for ruler visibility
local ruler labels generated via canonical conversion, never raw offset math
ruler order can be swapped
updateTimelineNowLine() and renderTimelineTracks() unchanged
src/index.html

Added admin controls:

configTimelineShowLocalRuler
configTimelineHideLocalRulerIfSame
configTimelineSwapUtcLocalRulers
src/js/app.js
wired load/save/dirty-state handling for the new ruler settings
src/css/vectair.css
added dual-ruler styling and visual hierarchy
UTC authority confirmation

Display-only.

No movement time fields were changed.
No bar span calculations were changed.
No now-line calculations were changed.
UTC remains the sole time storage and positioning authority.

20) Dual ruler layout correction + header strip removal (2026-04-22)
Purpose

Layout/display refinement only. Corrects the ruler stacking model and removes the redundant internal timeline header strip.

Problems fixed
previous implementation stacked both rulers at the top of the timeline area
ruler styling was timezone-identity-based instead of position-based
the internal “DAY TIMELINE (UTC)” header strip and its right-aligned UTC clock were redundant
Files changed
src/js/ui_liveboard.js
introduced buildRulerShell(...) to build a single-row ruler
top ruler rendered by renderTimelineScale()
bottom ruler rendered by renderTimelineScaleBottom()
bottom ruler inserted dynamically inside #timelineContainer
removed entirely when no secondary ruler is needed
src/css/vectair.css
.timeline-header { display: none; }
replaced timezone-identity styling with position-based styling:
.timeline-scale-primary
.timeline-scale-secondary
Internal container layout (post-change)
#timelineContainer
  #timelineScale        ← top ruler
  #timelineTracks       ← bars
  #timelineScaleBottom  ← bottom ruler (dynamic)
  #timelineNowLine      ← absolute, spans full container height
Alignment guarantee

Marker rows in both rulers remain in the same horizontal coordinate space as:

#timelineTracks
#timelineNowLine

The label overlay does not narrow the marker field.

Styling rule
top ruler → primary styling
bottom ruler → secondary styling

Styling follows position, not timezone identity.

UTC authority confirmation

Display-only. UTC authority, bar placement, and now-line placement unchanged.

21) Timeline ruler compacting + tick refinement (2026-04-22)
Purpose

Final visual refinement of the timeline rulers after the dual-ruler implementation.

Delivered
top and bottom rulers packed flush to the inner top/bottom edges of the timeline container
ruler row heights reduced for a more compact presentation
quarter-hour and half-hour ticks added:
full divider at whole hour
medium tick at :30
smaller ticks at :15 and :45
Files changed
src/css/vectair.css
removed vertical padding from .timeline-container
reduced ruler row height
added tick classes and secondary-row quieter styling
src/js/ui_liveboard.js
added intermediate tick generation at:
0.25
0.5
0.75
kept the same coordinate-space basis as hour markers, bars, and now-line
Outcome

Timeline presentation is now considered complete for V1.

Deferred follow-on

For V1, local descriptor text remains hardcoded to a compact label style where needed. Dynamic local timezone abbreviation rendering is deferred to the post-launch backlog.

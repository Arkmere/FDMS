# STATE.md — Vectair FDMS Lite

Last updated: 2026-03-27 (Europe/London) — Current baseline: Ticket 6 lifecycle tranche complete through corrective current-state semantics patch

This file is the shared source of truth for the Manager–Worker workflow:

- **Product Owner / SME:** Stuart
- **Solutions Architect & QA Lead:** ChatGPT
- **Production Engineer:** Claude Code

This ledger exists to prevent drift, preserve continuity across chats/sessions, and provide an audit-ready summary of what FDMS Lite is, how it behaves, what has been completed, what is deliberately deferred, and what the next recommended tranche should be.

---

## 0) Delivery model / runtime model (NO DRIFT)

### 0.1 Product definition

**FDMS Lite is NOT a website and NOT a static web app.**  
**FDMS Lite is a standalone desktop-local application** for Windows and Linux that uses **HTML/CSS/JS internally** for its UI.

During development and QA, the UI is served locally from `src/` via a lightweight local server harness such as:

```text
git pull
python -m http.server 8000
http://localhost:8000/

That local server is a development/runtime convenience only and must not be described as hosting.

0.2 OS support
Development OS: Windows
Operational target: Linux
Constraint: both must remain supported
0.3 Release-v1 workflow

The current branch / PR / local-run workflow is approved for Release v1:

code changes via git branches + PRs
local execution via local harness
manual verification on Stuart’s Windows environment is the primary acceptance path
Playwright and similar harnesses are developer QA tooling, not end-user runtime requirements
0.4 Explicitly out of scope unless separately scheduled

The following are not part of Release v1 unless explicitly promoted into a dedicated workstream:

packaging / installers
desktop wrapper work
auto-update mechanisms
hosted/web deployment path

Any future update mechanism should be based on versioned release artifacts, not “pull latest main and restart”.

0.5 Drift guardrails

Do not:

describe FDMS Lite as a website or web app
treat the local harness as hosting
introduce packaging/updater scope into normal feature sprints
reinterpret desktop-local behavior as browser-product behavior
1) Product goal and system architecture
1.1 Product goal

FDMS Lite is a lightweight standalone ATC / ops support tool for local flight-data workflow. Core functions:

Live Board for movement strips
booking workflow that can create and stay linked to strips
calendar for bookings and general events
admin / config tooling
local persistence via browser storage in the desktop-local runtime
1.2 Runtime / storage model
single-client local state model
persistence via localStorage
no backend in current v1 scope
no multi-user concurrency model
1.3 Core UI / data modules

The codebase is organized around these major responsibilities:

src/index.html — shell / tab structure / panels
src/js/app.js — boot / wiring / tab init / high-level rendering hooks
src/js/ui_liveboard.js — Live Board, History, lifecycle actions, modals, inline editing, renderers
src/js/datamodel.js — movement storage, config, initialization, helper logic, lifecycle stores
src/js/reporting.js — reporting and official return logic
src/js/bookingSync.js — booking ↔ strip linkage reconciliation
src/css/vectair.css — styling
2) Canonical data / behavior invariants
2.1 Reporting split (intentional and settled)

Two reporting models exist and must remain distinct unless a dedicated sprint changes them:

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

UI may show UTC or Local depending on display mode and configured offset.

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

All modal close paths must call closeActiveModal()
All modal open paths must call closeActiveModal() before opening a new modal
Inline-edit Enter / Escape handlers must stop propagation appropriately
No ad-hoc modal teardown bypassing lifecycle helpers
2.5 Scope boundaries preserved so far

The following behaviors must not be changed casually because multiple tickets now depend on them:

OVR remains excluded from daily movement totals
ARR Active remains status-only and must not fabricate ATD
booking reconciliation policy is stable
timing / duration logic is now integrated across create / edit / duplicate / lifecycle flows
formation WTC semantics are defined and implemented
current-state lifecycle views now coexist with retained audit/lifecycle records
3) Stable implemented behavior (current baseline)

The following capabilities are considered implemented and broadly stable unless a new ticket explicitly changes them.

3.1 Live Board and strip lifecycle
Live Board rendering stable
history and daily counters stable under current rules
inline editing hardened for canonical time fields and required-field safety
status transitions and counter effects have had dedicated audit passes
timing / inline-time normalization cluster is complete
Active / Complete semantics by movement type are settled
hard delete as immediate annihilation is no longer the product model; deletion now routes through soft-delete retention (see lifecycle section below)
3.2 Booking ↔ strip sync
booking create/update can create or update linked strips
linked propagation behavior exists
reconciliation runs at bootstrap
reconciliation is surfaced visibly through the Integrity banner
reconciliation policy itself remains unchanged
3.3 Calendar
month / week / year implemented
general calendar create / edit / delete supported
3.4 Admin
two-pane Admin IA implemented
dirty-state save / discard where appropriate
restore / export / reset hardening present
backup metadata envelope and restore format detection in place
3.5 Formations
formation create / edit / remove
Live Board formation badge and expanded details
per-element editing
inheritance semantics
WTC current / max semantics implemented

Formations are usable but still have a continuation backlog (see deferred section).

4) Settled post-10.1 timing / interaction baseline

The following cluster is complete and should not be casually reopened unless Stuart reports a regression.

4.1 Sprint 10 — timing normalization

The system now has a more centralized resolved timing model.

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

Activate:

DEP → stamps ATD if absent
LOC → stamps ATD if absent
OVR → stamps ACT/AOFT if absent
ARR → status-only; no ATD fabrication

Complete:

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
5) Lifecycle model (current accepted baseline)

The lifecycle tranche is now established and must be treated as the current product model.

5.1 Governing rule: current-state truth for operational reports

Operational views and ordinary reports use current-state truth.

A strip counts where it currently is:

if currently PLANNED / ACTIVE → Live Board / operational flow
if currently COMPLETED → Movement History
if currently CANCELLED → Cancelled Sorties / cancellation reporting
if soft-deleted → Deleted Strips only, excluded from ordinary operational reporting
if purged → nowhere

Historical lifecycle/audit data may still be retained, but it must not override current-state operational views.

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
current-state reporting should reflect the edited current cancellation record, not only the original first-write snapshot

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

Cancelled Sorties is a current-state view, not a snapshot-backed archive.

Settled rule:

A row belongs in Cancelled Sorties only if:

sourceMovementId resolves to an existing movement
that movement currently exists in getMovements()
and that movement’s current status === 'CANCELLED'

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
8) Known limitations / deliberate boundaries

These are known and intentional unless later promoted into dedicated tickets.

8.1 Cancellation analytics not yet implemented

Not yet implemented:

reason breakdown dashboards
most-cancelled airframe / pilot / route / unit reporting
date-range cancellation analytics
lifecycle event analytics beyond current operational views

This is the next major recommended reporting tranche.

8.2 Deleted-strip retention configurability
retention period is hardcoded to 24 hours
Admin configurability deferred
8.3 Booking re-linkage on restore
restoring a deleted strip does not automatically restore booking linkage
operator re-links manually if needed
8.4 Manual purge-now action
not implemented
omitted deliberately until a safe confirmation model is scoped
8.5 Full lifecycle event/audit reporting

Historical lifecycle data is retained where needed for audit/export, but no dedicated audit dashboard exists yet.

9) Backlog / deferred items
9.1 Immediate next recommended tranche

Ticket 6b — Cancellation / lifecycle reporting

Recommended scope:

cancellation totals by date range
breakdown by reason code
breakdown by movement type
most cancelled airframe / pilot / callsign family / route as appropriate
exportable lifecycle report tables
current-state operational reporting as primary view
optional historical lifecycle-event analytics only if clearly separated
9.2 Existing deferred backlog from earlier work
Duplicate → “Create from…” concept
formation continuation backlog
booking confirmation email + pilot briefing pack
note in booking briefing: GAR required for arrivals/departures outside contiguous UK, not managed by ATC
DST-aware Auto timezone offset (Europe/London)
future notification / reminder system workstream
10) Manual verification posture

Accepted posture remains:

Stuart continues to smoke-test manually on Windows
Claude implements narrowly to ticket
ChatGPT maintains scope discipline, no-drift rules, and ledger quality
heavy automation should only be introduced where it materially reduces uncertainty
11) Minimal restart instructions

When asked how to run FDMS locally, give only:

git pull
python -m http.server 8000
http://localhost:8000/

No extra scaffolding unless specifically requested.

12) Current merge / baseline note

The current accepted functional baseline after the lifecycle corrections is:

post-10.1 timing / inline-time cluster complete
Cancelled Sorties is a current-state cancelled view
cancelled strips are fully editable
cancelled strips can be reinstated to PLANNED using offset-aware timing rules
deletion uses soft-delete retention into Deleted Strips
deleted strips are excluded from ordinary reports immediately
Movement History / Cancelled Sorties / Deleted Strips now form the three-view lifecycle history model

This is the baseline future tickets should assume unless Stuart reports a regression.

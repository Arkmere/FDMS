# STATE.md — Vectair Flite

Last updated: 2026-03-28 (Europe/London) — Current baseline: Ticket 6b Cancellation / Lifecycle Reporting delivered; roadmap reclassified for V1 / V2 / rolling updates

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

Current development and QA builds use **HTML/CSS/JS internally** for the UI and are run through a lightweight local harness such as:

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

Currently implemented:

formation create / edit / remove
Live Board formation badge and expanded details
per-element editing
inheritance semantics
WTC current / max semantics implemented

Formations are usable, but formation continuation / expansion remains a V1 workstream.

4) Settled post-10.1 timing / interaction baseline

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

Cancelled Sorties is a current-state view, not a snapshot-backed archive.

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
8) Documentation workstream (new explicit continuity layer)

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
or any combination of the above
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

Full Vectair-backed API / VKB integration is not part of the current functional baseline. It is now explicitly a V2 workstream.

9.7 METAR Builder not yet implemented

METAR Builder is now in V1 scope but not yet implemented.

9.8 Desktop productization not yet implemented

The installed-desktop target is now part of V1 scope, but the current runtime remains the development harness / localStorage model.

10) Roadmap classification

The roadmap is now classified into:

V1 required workstreams
V2 workstreams
rolling / lower-priority updates
10.1 V1 required workstreams

These are part of the current V1 target:

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

This is a V1 correctness item.

C. Formation continuation / expansion

Formations are usable but not considered fully complete for V1.

D. Create From workflow

The older “Duplicate → Create from…” concept is now promoted into V1 scope as the Create From workflow.

E. METAR Builder

New V1 workstream.

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
11) Recommended implementation order
11.1 V1 programme structure

V1 should now be understood as three parallel tracks:

Track A — Desktop Productization

Begin early at the architecture/planning level and continue through release hardening.

Track B — Core Feature Completion
DST-aware Auto timezone
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
DST-aware Auto timezone
Formation continuation / expansion
Create From workflow
METAR Builder
implement installed-desktop packaging path
implement migration into app-managed state
cross-platform hardening and launch-readiness pass
11.3 Deferred from immediate next-up status

The following are not the next active tranche now:

Ticket 6c — Callsign family grouping
historical lifecycle-event analytics

They remain valid backlog items but are no longer the immediate next recommended work.

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
Cancelled Sorties is a current-state cancelled view
cancelled strips are fully editable
cancelled strips can be reinstated to PLANNED using offset-aware timing rules
deletion uses soft-delete retention into Deleted Strips
deleted strips are excluded from ordinary reports immediately
Movement History / Cancelled Sorties / Deleted Strips form the three-view lifecycle history model
Ticket 6b cancellation reporting is complete
Ticket 6c is deferred
product name is now Vectair Flite
documentation is now an explicit maintained workstream
V1 scope now includes desktop productization, DST-aware Auto timezone, formation continuation/expansion, Create From workflow, and METAR Builder
V2 scope includes API / VKB integration and booking confirmation / pilot briefing / GAR note

This is the baseline future tickets should assume unless Stuart reports a regression or explicitly reprioritizes roadmap scope.

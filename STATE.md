# STATE.md — Vectair Flite

Last updated: 2026-05-07 (Europe/London)

## Current headline status

- **Main branch is the authoritative baseline.**
- **Vectair Flite** (“Flite”) is the current product name.
- Legacy references to **FDMS**, **FDMS Lite**, or **Vectair FDMS** refer to the same product unless explicitly stated otherwise.
- **H5b — Functional consolidation / shared export correction is complete and closed.**
- Native **Save As** export behaviour is now implemented for the relevant CSV/XLSX export paths in the Tauri desktop environment.
- Browser/download fallback remains available for non-Tauri/local-browser harness use.
- `FDMS_REGISTRATIONS.csv` has been restored and verified at **25,713 lines**.
- **EGOW / LOC / timing regression cluster is fixed** (branch `claude/fix-egow-loc-timing-Wqwjs`):
  - LOC EGOW validation now rejects blank codes in both LOC save paths.
  - Callsign-derived EGOW enrichment restored in `enrichMovementData()` (non-destructive).
  - Edit-save timing recalculation now detects the actual changed timing field rather than always using `depActual`.
  - LOC planned-time sync (`bindPlannedTimesSync` non-ARR mode) now always applies `start + duration → end` on start/duration change, and `end − start → duration` on end change.
- V1 is not release-ready until the remaining V1 workstreams and acceptance sweep are complete.

This file is the shared source of truth for the Manager–Worker workflow.

- **Product Owner / SME:** Stuart
- **Solutions Architect & QA Lead:** ChatGPT
- **Production Engineer:** Claude Code

ChatGPT diagnoses, architects, writes tickets, reviews implementation, and maintains the continuity layer. Claude implements tickets only. Claude must not be asked to diagnose root cause or infer design direction.

---

## 1. Product identity and naming

The product is branded:

```text
Vectair Flite

Short form:

Flite

Older development material may refer to the same application as:

FDMS
FDMS Lite
Vectair FDMS

These are legacy names for the same product unless the context explicitly distinguishes them.

Flite is a deliberate contraction of FDMS + light. New tickets, documentation, release notes, screenshots, and architecture summaries should use Vectair Flite or Flite by default.

Do not casually revert to older FDMS naming in new material.

2. Runtime and delivery model
2.1 Product definition

Vectair Flite is not a website and not a hosted web app.

Flite is a local flight-data management application for Windows and Linux. It currently uses HTML/CSS/JS internally and is being productized through Tauri.

The local Python server remains a development/runtime convenience only.

2.2 Current development environment

Development OS:

Windows

Operational target:

Linux, with Windows development/testing

Current runtime during development:

cd C:\Users\dmshs\FDMS\src
python -m http.server 8000

Then, in a second terminal when using Tauri:

cd C:\Users\dmshs\FDMS
cargo tauri dev

Tauri waits for the frontend dev server at:

http://localhost:8000/
2.3 Persistence model

Current persistence model:

localStorage

Current app model:

single-client local state

There is currently:

no backend
no multi-user concurrency model
no hosted/cloud storage model
no server-side database in the V1 baseline
2.4 Cache warning

Browser/WebView cache can show stale JS/CSS.

When validating JS/CSS behaviour:

DevTools → Network → Disable cache → Reload

In the Tauri app, the in-app Admin → System Status → Reload App control should be used where available.

2.5 Local-only files

The following file is local-only and must remain untracked:

Vectair Flite.lnk

.gitignore should exclude local Windows shortcut files:

*.lnk

Do not commit local shortcuts or local-only investigation scratch files.

3. Repository and branch baseline
3.1 Repository

Local repository:

C:\Users\dmshs\FDMS

Likely GitHub repository:

Arkmere/FDMS
3.2 Authoritative branch
main

main is the authoritative working baseline unless explicitly stated otherwise.

3.3 Known historical anchors

The following branches/tags may exist as intentional history/fallback points:

legacy/pre-desktop-main
baseline/pre-desktop-productization
flite-pre-desktop-baseline-2026-03

Do not delete or reinterpret these casually.

3.4 Current merged baseline

The following workstreams should be treated as merged and complete for current planning purposes:

UTC-first timing hardening, subject to the current regression noted below
Day Timeline presentation tranche
cancellation / deleted-strip lifecycle tranche
cancellation reporting
formation implementation through FR-15
formation expanded child-strip display refactor
History Retrieval H1–H5b
Native Save As export consolidation H5b
4. Current active defect / next engineering priority
4.1 EGOW / LOC / timing regression cluster

This is the next active engineering priority and should be handled before new feature work.

Observed / reported symptoms

The known regression cluster includes:

Callsign-to-EGOW autofill regression
Callsign-derived EGOW code enrichment no longer reliably fills as expected.
New LOC creation allows blank EGOW
LOC strip creation can pass with blank/invalid EGOW when validation should reject it.
New LOC ETD tab-out no longer recalculates ETA
Editing the departure/start time on a new LOC no longer automatically updates the arrival/end time as expected.
Existing strip dep-time edits do not update dependent timing
Existing strip time edits do not reliably recalculate dependent timing unless duration arrows are touched.
Suspected implementation causes from prior diagnosis

The active investigation previously identified likely causes:

LOC validation checks only invalid non-blank EGOW values, rather than requiring a value:
if (egowCode && !validEgowCodes.includes(egowCode)) ...

should likely become:

if (!egowCode || !validEgowCodes.includes(egowCode)) ...
enrichMovementData lacks or has lost callsign-based EGOW inference/backstop.
Edit-save recalculation is too narrow and only runs when updates.depActual !== undefined, not when planned/start/end/duration fields change.
New LOC planned-time sync path is incomplete or not firing on the correct field events.
Required handling

This must be treated as a functional regression, not a polish item.

Claude must not be asked to investigate from scratch. ChatGPT must inspect current implementation, state actual cause, exact files to change, and exact behaviour required before Claude receives a patch ticket.

Status
ACTIVE — V1 blocker
5. Core architecture

Current major code responsibilities:

src/index.html
  Shell, tab structure, major panels.

src/js/app.js
  Boot/wiring, tab init, high-level rendering hooks.

src/js/ui_liveboard.js
  Live Board, History, lifecycle actions, modals, inline editing, strip renderers,
  formation expanded display, formation child-strip UI.

src/js/datamodel.js
  Movement storage, config, initialization, timing helpers, formation helpers,
  lifecycle stores, localStorage persistence.

src/js/reporting.js
  Reporting and official return logic.

src/js/ui_reports.js
  Reports UI wiring.

src/js/export_utils.js
  Shared export/save helpers for CSV/text and binary export paths.

src/js/services/bookingSync.js
  Booking ↔ strip linkage reconciliation.

src/js/stores/bookingsStore.js
  Booking persistence/access layer.

src/css/vectair.css
  Main styling, Live Board styling, History styling, Reports styling,
  formation child-strip styling.

Tauri-specific files:

src-tauri/Cargo.toml
src-tauri/Cargo.lock
src-tauri/src/lib.rs
src-tauri/tauri.conf.json
src-tauri/capabilities/default.json
6. Non-negotiable behaviour invariants
6.1 UTC authority

UTC is authoritative.

Stored operational strip times are UTC.

Local time is presentation/input only. Local input must convert back to UTC before save.

Canonical time fields:

depPlanned
depActual
arrPlanned
arrActual
depActualExact

Operational fields use:

HH:MM

Exact WTC anchor uses:

HH:MM:SS
6.2 Event-based vs nominal reporting split

Two reporting models intentionally coexist.

Live Board daily stats

Event-based / EGOW-realized:

DEP counts only when departure actually occurred.
ARR counts only when arrival actually occurred.
LOC counts based on realized departure/arrival events plus T&G / O/S rules.
OVR contributes 0 to runway totals.
OVR remains a separate counter.
Monthly Return / Dashboard / Insights

Nominal strip-type model:

LOC = 2
DEP = 1
ARR = 1
OVR = 0
T&G = +2
O/S = +1

These must not be silently merged.

6.3 OVR semantics

OVR is excluded from runway Daily Movement Totals.

OVR is counted separately.

OVR timing uses off-frequency / left-frequency semantics:

EOFT / AOFT
ELFT / ALFT
6.4 ARR activation

ARR Active is status-only and must not fabricate ATD.

6.5 Booking/strip links

A movement may carry:

bookingId

A booking may carry:

linkedStripId

bookingSync.reconcileLinks() remains the authority for deterministic repair/clear behaviour on load.

6.6 Modal lifecycle

All modal close paths must use the established modal close helpers.

Avoid ad-hoc modal teardown.

6.7 Formation model boundary

Formation child cards are not independent normal movement records. They are UI representations of formation elements and must continue to use the existing formation-element update path.

Do not route formation element edits through ordinary movement updateMovement() semantics unless a dedicated architecture ticket changes this.

6.8 History model boundary

Movement History is completed-movement history unless a dedicated future ticket broadens it.

Cancelled Sorties and Deleted Strips remain their own History subtabs and should not be silently mixed into Movement History.

6.9 Export model boundary

All user-facing CSV/XLSX exports in the Tauri desktop app should use native Save As where implemented.

Browser Blob/download fallback remains valid when not running under Tauri.

Do not reintroduce direct frontend imports from Tauri plugin packages such as:

@tauri-apps/plugin-dialog
@tauri-apps/plugin-fs

The static/non-bundled frontend cannot safely resolve those module specifiers.

Use the shared helper layer:

src/js/export_utils.js

and the registered Tauri invoke commands instead.

7. Timing and timeline baseline

The timing model was previously hardened and should remain stable, subject to the active regression in section 4.

7.1 Timing normalization

Settled model:

one timing model per movement
inline edit and modal edit should use the same semantics
Timeline is a projection of resolved timing, not a separate timing engine
7.2 Activate semantics
DEP → stamps ATD if absent
LOC → stamps ATD if absent
OVR → stamps AOFT/ACT if absent
ARR → status-only; no ATD fabrication
7.3 Complete semantics
DEP → no new end-side time
LOC → stamps ATA only if absent
ARR → stamps ATA only if absent
OVR → stamps actual end-side time only if absent
7.4 Rounding

Active and Complete auto-stamps use nearest-minute rounding:

00–29 seconds → round down
30–59 seconds → round up

Exact second-bearing WTC time is preserved separately where relevant.

7.5 Inline time mode

Implemented:

inline time labels explicitly toggle estimate vs actual mode
mode is UI session state, not persisted
actual mode if actual exists; estimate mode otherwise
explicit operator toggle survives re-renders for the session
7.6 Timeline presentation

Complete for V1 presentation:

dual UTC/local ruler
secondary local ruler can be hidden when operationally same as UTC
UTC/local ruler order can be swapped
internal timeline header strip removed
top and bottom rulers define timeline boundaries
quarter-hour and half-hour ticks implemented
Timeline remains display-only; UTC authority unchanged
8. Lifecycle model
8.1 Governing rule

Operational views and ordinary reports use current-state truth.

A strip appears according to where it currently is:

Current state	Appears in
PLANNED / ACTIVE	Live Board
COMPLETED	Movement History
CANCELLED	Cancelled Sorties
Soft-deleted	Deleted Strips
Purged	Nowhere

Historical lifecycle/audit records may be retained but must not override current-state operational views.

8.2 History IA

History has three top-level subtabs:

Movement History
Cancelled Sorties
Deleted Strips

Movement History now has internal views:

Historic Strip Board
Historic Movement Calendar
Search / Table
8.3 Cancelled Sorties

Implemented:

cancellation modal with reason/note
cancellation log/audit layer
Cancelled Sorties page
sort/filter/export
current-state editability
reason edit
reinstatement
delete from cancelled flow via soft-delete pathway
native Save As CSV export path

Cancelled Sorties is a current-state view. A row belongs there only if the underlying movement still exists and its current status is:

CANCELLED
8.4 Reinstatement

Reinstatement target state:

PLANNED

Rule:

newStartTime = max(originalPlanned, now + typeOffset)

Original planned time comes from immutable snapshot.

8.5 Deleted Strips

Implemented:

soft-delete retention store
full movement snapshot
deletedAt
expiresAt
booking link cleared
strip removed from active movement store
Deleted Strips tab
restore logic
purge of expired entries

Retention period:

24 hours

Admin configurability deferred.

8.6 Cancellation reporting

Implemented as a current-state operational report.

Delivered:

date range
cancellation KPIs
reason breakdown
movement type breakdown
ranked aircraft/type/captain/route breakdowns
row-level cancellation detail
CSV export via native Save As in Tauri

Historical lifecycle-event analytics are not included and remain a possible future reporting mode.

9. Formation baseline

Formation workstream is complete for V1 launch purposes.

The primary implementation tranche FR-02 through FR-15 is complete. The expanded display has since been refactored from an internal table into subordinate strip-style child cards.

Further polish is deferred to post-launch backlog unless a specific launch-blocking defect appears.

9.1 Formation master

The master strip is the formation summary shell. It holds top-level movement fields and a nested formation object containing:

formation.label
formation.wtcCurrent
formation.wtcMax
formation.shared
formation.elements[]

The master does not flatten element truth. It summarises individually tracked elements.

9.2 Formation elements

Each formation.elements[] entry represents a real aircraft in the formation.

Each element can carry or resolve:

callsign
reg
type
wtc
status
depAd
arrAd
depActual
arrActual
tngCount
osCount
fisCount
outcomeStatus
actualDestinationAd
actualDestinationText
outcomeTime
outcomeReason
underlyingCallsign
pilotName
overrides
ordinal
9.3 Shared/default model

formation.shared is the shared/default layer.

Elements inherit from shared defaults unless they have an override. Divergence is tracked through the element overrides dict.

9.4 Callsign convention

Element callsigns use the formation element callsign as the operational display callsign.

Examples:

MERSY1
MERSY2
CNNCT1
MEMORIAL1

Generic crew/callsign attribution such as UAM03 / UNIFORM is secondary detail text only and must not replace the element callsign in the primary callsign position.

9.5 Movement counting

Per-element movement counting is implemented.

getResolvedFormationMovements() sums per-element nominal movement contributions, resolving T&G / O/S / FIS / inherited values as appropriate.

9.6 Dynamic WTC

Implemented:

wtcCurrent = highest WTC among PLANNED/ACTIVE elements
wtcMax = highest WTC across all elements regardless of status
wtcMax does not decrease due to lifecycle/status changes
9.7 Divergence

Implemented:

elements hold independent statuses
diverged child cards are visually marked
parent summary derives conservative status
master status cascade rules are preserved

Master cascade rules:

master → COMPLETED cascades PLANNED/ACTIVE elements to COMPLETED; CANCELLED preserved
master → CANCELLED cascades PLANNED/ACTIVE elements to CANCELLED; COMPLETED preserved
no cascade on activation
9.8 Per-element outcome/diversion

Implemented:

NORMAL
DIVERTED
CHANGED
CANCELLED

Also implemented:

actual destination
outcome time
reason/note

Outcome/diversion controls remain available, but they are visually secondary to ordinary operational strip controls.

9.9 Per-element attribution and pilot identity

Implemented:

manual attribution callsign
manual pilot name
VKB-aware resolution assistance
reporting attribution by resolved identity where applicable
9.10 Expanded formation display

Launch baseline:

formation summary section
shared/defaults section
child element stack
each element renders as a subordinate strip-style card
child cards use normal flight-type colour language
child card primary callsign is the element callsign
attribution/pilot identity appears as secondary/detail information
T&G / O/S / FIS / timing are usable primary operational controls
outcome/diversion fields are available but visually de-emphasised
child stack spans the expanded formation panel width
no accepted launch baseline should produce page/board overspan
9.11 Completed formation tickets
Ticket	Delivered
FR-02	Activation UX
FR-03	Draft memory / in-session persistence
FR-04	Callsign generation
FR-05	Shared/default model
FR-06	Enrichment
FR-07	Master-first seeding
FR-08	Element-first synthesis / load-time normalization
FR-09	Field-level inheritance tracking
FR-10	Per-element movement counting
FR-11	Dynamic WTC
FR-12	Expanded strip display
FR-13	Lifecycle divergence
FR-13b	Per-element diversion / outcome detail
FR-14	Per-element pilot attribution
FR-14b	VKB-aware identity resolution assistance
FR-15	Documentation closeout
Post-FR polish	Child element display refactored into strip-style cards
9.12 Formation post-launch backlog

Deferred to post-launch unless promoted:

visual density tuning
spacing/typography refinement
inherited/shared value signalling
3+ element UX refinement
narrow-window/responsive refinement
formation creation via “number of aircraft” count field
automatic master → element propagation after element set is established
deeper formation profile architecture
formation analytics/reporting refinements
multiple WTC scheme support per formation
advanced lifecycle/presentation enhancements
10. History Retrieval / Discovery workstream
10.1 Status

History Retrieval / Discovery is now substantially implemented through H5b.

H6 polish / integration remains open.

10.2 Product problem

The original Movement History strip board was adequate for short-range review but did not scale well for finding older completed movements.

Operators now have three historical access modes:

strip-board review
calendar-based date discovery
search/table-based movement discovery

These sit under Movement History and remain separate from Cancelled Sorties and Deleted Strips.

10.3 Current IA

Top-level History IA:

History
├─ Movement History
├─ Cancelled Sorties
└─ Deleted Strips

Movement History internal IA:

Movement History
├─ Historic Strip Board
├─ Historic Movement Calendar
└─ Search / Table
10.4 Completed phases
Phase	Status
H1	Complete — Movement History default changed to Today
H2	Complete — Movement History internal subview shell
H3	Complete — Historic Movement Calendar
H4	Complete — Historic Strip Board structured filters
H5	Complete — Search / Table view
H5b	Complete — Shared export correction / native Save As consolidation
H6	Open — polish, edge cases, documentation, integration closeout
10.5 H1 complete

Movement History now defaults to:

Today

Movement History remains completed-only.

Cancelled Sorties and Deleted Strips remain separate.

10.6 H2 complete

Movement History has internal views:

Historic Strip Board
Historic Movement Calendar
Search / Table

Historic Strip Board remains the default internal Movement History view.

10.7 H3 complete

Historic Movement Calendar implemented.

Baseline behaviour:

month view for completed movements
operational date / m.dof used as date anchor
Previous / Next / Today calendar controls
day summary counts
military/civilian/other summary via EGOW classification
clicking a day opens that day in Historic Strip Board
selected-date banner/chip with clear behaviour

Ctrl-click / Shift-click multi-date selection remains deferred unless promoted.

10.8 H4 complete

Historic Strip Board now has structured AND filters.

Implemented filters include:

callsign
registration
pilot/PIC/attribution
aircraft type
EGOW code
EGOW unit code
WTC
flight type
departure AD
arrival AD
free-text search

Filter notes:

registration matching normalises punctuation/hyphens, so G-GORV and GGORV match equivalently
pilot/PIC matching searches known pilot, PIC, attribution, and formation element identity fields
EGOW unit code supports token-based matching
Clear filters clears structured controls only; period/calendar selection remains independent
10.9 H5 complete

Search / Table implemented.

Current Search / Table features:

structured search across completed movement history
date from / date to filters using operational date / DOF
normalised registration matching
widened pilot/PIC/attribution matching
EGOW unit-code token matching
row count display
15-column table
Open info action
View day / jump-to-day action
filtered CSV export
column sorting
row-limit guard / visible cap
export all filtered rows rather than only visible capped rows

Current columns:

Date
Callsign
Registration
Type
WTC
Flight type
Dep AD
Arr AD
Times
EGOW code
EGOW unit
Pilot
Activity
Status
Actions
10.10 H5b complete

H5b corrected and consolidated exports.

Native Save As now works in Tauri for:

Historic Strip Board CSV export
Search / Table filtered CSV export
Cancelled Sorties CSV export
Reports CSV export
Reports XLSX export
Reports Cancellation CSV export

Shared export helper:

src/js/export_utils.js

Tauri native commands include text and binary save paths.

XLSX export uses base64/native binary save rather than an unsafe frontend plugin import.

Cargo.lock records the required base64 dependency.

Browser fallback remains available outside Tauri.

10.11 H6 open

H6 is the remaining History closeout phase.

Candidate H6 tasks:

improve visual grouping between Historic Strip Board, Calendar, and Search / Table
reduce filter-panel clutter
consider collapsible filter groups
make selected-day state and cleared-filter behaviour clearer
improve empty-state wording
ensure all export names and success/cancel/fallback toasts are consistent
check accessibility basics on new controls
check narrow-window behaviour
update user docs
update STATE.md status references so History no longer appears “planned / not implemented”
perform one final History-specific smoke pass

Status:

OPEN — V1 polish / closeout
11. Export baseline
11.1 Export model

All relevant exports should now route through shared helper functions.

Text/CSV helper:

saveTextFileWithDialogOrDownload(text, filename)

Binary/XLSX helper:

saveBinaryFileWithDialogOrDownload(base64, filename)

Browser fallback helper:

downloadFileViaBrowser(content, filename, mimeType)
11.2 Native Tauri behaviour

When running in Tauri, exports should use:

window.__TAURI__.core.invoke(...)

Registered native save commands handle:

text file Save As
binary/base64 file Save As
11.3 Browser fallback behaviour

When not running in Tauri:

CSV/text exports should fall back to Blob download
XLSX export may use browser/XLSX library download behaviour where appropriate
11.4 Completed native Save As paths

The following are implemented and accepted after H5b:

History → Historic Strip Board → Export as CSV
History → Search / Table → Export filtered CSV
History → Cancelled Sorties → Export CSV
Reports → Export CSV
Reports → Export XLSX
Reports → Cancellation view → Export Cancellations CSV
11.5 Known export testing caveat

A stale WebView/browser cache previously made working export code appear broken.

When export behaviour appears inconsistent, reload cleanly before diagnosing:

Admin → System Status → Reload App

or:

DevTools → Network → Disable cache → Reload
12. Documentation workstream

Documentation is a parallel continuity layer owned by ChatGPT.

Claude remains the engineer.

Living documentation set:

README.md
Quick_Start_Guide.md
User_Guide.md
Install_Update_Backup_Troubleshooting.md
docs/architecture/FORMATIONS.md

For every future implementation ticket, explicitly state one of:

Docs: no change
Docs: update README
Docs: update Quick Start
Docs: update User Guide
Docs: update Install/Update/Backup/Troubleshooting
Docs: update architecture doc
Docs: update STATE.md

Documentation principles:

accurate beats complete
concise beats exhaustive
current behaviour beats aspirational behaviour
provisional areas should be labelled plainly
use Vectair Flite / Flite naming by default
12.1 Required documentation refresh before V1

Before V1 release, documentation must be updated to reflect:

product name: Vectair Flite
Tauri desktop runtime/productization state
local development run process
backup/restore behaviour
native Save As export behaviour
History Retrieval H1–H5b completion
History H6 status if still open
formation launch baseline
known limitations
V1 release scope and exclusions

Status:

REQUIRED BEFORE V1 FREEZE
13. Known limitations and deliberate boundaries
13.1 Cancellation analytics

Current cancellation reporting is current-state operational reporting only.

Deferred:

historical lifecycle-event analytics
audit dashboard for all lifecycle transitions
cancellation-event-only date analytics
13.2 Deleted-strip retention configurability

Retention is currently hardcoded to:

24 hours

Admin configurability deferred.

13.3 Booking re-linkage on restore

Restoring a deleted strip does not automatically restore booking linkage.

Operator re-links manually if needed.

13.4 Manual purge-now action

Not implemented.

Deferred until a safe confirmation model is scoped.

13.5 API / VKB integration

Full Vectair-backed API / VKB integration is not in the current functional baseline.

This is a V2 workstream.

13.6 METAR Builder

Still V1-scoped unless consciously deferred to V1.1.

Not yet implemented.

13.7 Desktop productization

Partially advanced through Tauri work, but not yet complete as a final installed-product model.

13.8 Formation polish

Launch-acceptable formation display is complete.

Deferred:

tighter visual density
richer inherited/shared value indicators
3+ element layout refinement
responsive/narrow-window refinement
formation analytics enhancements
13.9 Advanced export-location preferences

Not implemented.

Deferred:

Admin-configurable export folders
separate default folders by export type
“Ask every time” vs “use default folder” export preference

Current accepted behaviour is Save As.

14. V1 roadmap classification
14.1 V1 blockers

The following must be resolved before V1 release:

EGOW / LOC / timing regression cluster
minimum desktop productization definition and implementation
documentation refresh
final release acceptance sweep
V1 freeze / release decision
14.2 V1 required / candidate workstreams
A. EGOW / LOC / timing regression fix

Current next priority.

Must restore reliable:

EGOW validation
callsign-derived EGOW enrichment
LOC timing sync
dependent timing recalculation after edits
B. H6 History polish / integration

Remaining closeout after H1–H5b.

May be lightweight if current UI is acceptable, but should not be left undocumented.

C. Create From workflow

Purpose:

convert the older “Duplicate → Create from…” concept into a clear Create From workflow
allow efficient creation of related movements
preserve timing/lifecycle semantics
distinguish duplicate, create-from, reciprocal, booking-derived, and formation-derived flows

This remains the most likely “forgotten” V1 feature.

D. Minimum Desktop Productization

V1 productization floor should be defined explicitly.

Potential V1-minimum scope:

repeatable Tauri launch/build flow
packaged desktop build
clear installation/update instructions
local data persistence/backup expectations documented
native Save As exports verified
no reliance on accidental browser cache state
basic crash/error visibility sufficient for internal use

Full signed builds and auto-update may be deferred if they would delay V1.

E. METAR Builder

Still historically V1-scoped.

Purpose:

selectable/editable METAR components
generated plain-text METAR-style output
copy/paste into email or operational communication

Should be either:

implemented before V1

or explicitly moved to:

V1.1
F. Documentation refresh

Required before V1 freeze.

G. Final acceptance sweep

Required before V1 freeze.

15. V2 workstreams
15.1 API / VKB integration

Move beyond static/downloaded packs toward fuller Vectair-backed knowledge integration.

15.2 Booking confirmation email / pilot briefing / GAR note

Includes:

booking confirmation email
pilot briefing output
GAR note for arrivals/departures outside contiguous UK
explicit note that GAR is not managed by ATC
15.3 Advanced export-location management

Potential Admin section:

Export & File Locations

Possible settings:

Ask every time
default export folder
separate folders by export type
remember last export location

Not part of current H5b closure.

16. Rolling / lower-priority backlog

The following are not V1 blockers unless explicitly promoted:

booking re-linkage on deleted-strip restore
deleted-strip retention configurability
historical lifecycle event analysis
callsign family grouping
notification/reminder system
dynamic local timezone abbreviation rendering
formation visual polish and extended formation UX improvements
advanced formation analytics
3+ element formation layout refinement
Admin-configurable export locations
full backend/database architecture
multi-user/concurrent operations model
full API/VKB live integration
17. Recommended next implementation order
17.1 Immediate next item
1. Fix EGOW / LOC / timing regression cluster

Reason:

This is a functional regression affecting core strip creation/editing. It should be fixed before starting new feature work.

17.2 Then close History properly
2. H6 History polish / integration

Reason:

H1–H5b are complete. H6 should either be completed as a light closeout or consciously reduced to documentation/status polish.

17.3 Then implement the remaining operational feature
3. Create From workflow

Reason:

This is the most likely forgotten V1 feature and supports efficient operational strip creation.

17.4 Then define and execute V1 desktop floor
4. Minimum Desktop Productization

Reason:

The app cannot be called V1-ready merely because it runs in a dev harness. V1 needs a defined desktop delivery baseline.

17.5 Then decide METAR Builder
5. METAR Builder — implement or defer explicitly to V1.1

Reason:

It is historically V1-scoped but may be safely deferred if the V1 release definition is narrowed to the core flight-data management product.

17.6 Then documentation
6. Documentation refresh

Reason:

Docs must match current behaviour before release freeze.

17.7 Then acceptance
7. Full V1 acceptance sweep

Reason:

The app has many interacting operational paths. V1 requires a structured manual acceptance pass.

17.8 Then freeze
8. V1 freeze / release candidate

After freeze:

only release blockers and hotfixes should be accepted
no new feature work without explicit deferral/release decision
18. Smoke testing baseline

Primary acceptance remains Stuart’s manual verification.

18.1 General local validation

Browser harness:

cd C:\Users\dmshs\FDMS\src
python -m http.server 8000

Browser URL:

http://localhost:8000/

Tauri development run:

cd C:\Users\dmshs\FDMS
cargo tauri dev

When testing JS/CSS:

DevTools → Network → Disable cache → Reload

or use:

Admin → System Status → Reload App
18.2 Registration data integrity check

After rebases, merges, or large file operations, verify:

(Get-Content .\src\data\FDMS_REGISTRATIONS.csv).Count

Expected:

25713
18.3 Export smoke baseline

Minimum export smoke:

History → Historic Strip Board → Export as CSV opens Save As
History → Search / Table → Export filtered CSV opens Save As
History → Cancelled Sorties → Export CSV opens Save As
Reports → Export CSV opens Save As
Reports → Export XLSX opens Save As and writes valid .xlsx
Reports → Cancellation view → Export Cancellations CSV opens Save As
cancelling a Save As dialog produces cancellation/info toast
no @tauri-apps/plugin-dialog module-specifier error
18.4 Formation launch-complete smoke baseline

Formation accepted for launch purposes after smoke confirming:

child element strips render as full-width subordinate strip-style cards
element callsign is primary
attribution/pilot identity is secondary
T&G/O/S/FIS/timing usable as operational controls
outcome/diversion available but visually secondary
no datamodel/schema migration
no observed counting/WTC/lifecycle regression sufficient to block launch

Further formation polish goes to post-launch backlog unless a specific bug is found.

18.5 History smoke baseline

Minimum History smoke:

Movement History defaults to Today
Historic Strip Board renders completed movements only
Calendar view summarises days using completed movements only
single-click calendar day opens Historic Strip Board for that day
structured filters use AND semantics
Search / Table results match filter criteria
Search / Table export exports all filtered rows, not only visible capped rows
Cancelled Sorties and Deleted Strips remain unaffected
all History exports use native Save As in Tauri
18.6 EGOW / LOC / timing regression smoke baseline

After the active regression fix, smoke must include:

DEP creation with valid callsign/EGOW enrichment
ARR creation with valid callsign/EGOW enrichment
LOC creation requires valid EGOW
LOC creation rejects blank EGOW where required
LOC ETD/start-time edit recalculates ETA/end-time
duration arrow changes still recalculate expected times
existing strip dep/start-time edit recalculates dependent arr/end-time where appropriate
OVR timing labels and semantics remain EOFT/AOFT/ELFT/ALFT
ARR Active remains status-only and does not fabricate ATD
UTC/local entry still stores UTC authority
18.7 Final V1 acceptance sweep

Before V1 freeze, test:

new strip creation: DEP, ARR, LOC, OVR
UTC/local entry and display
Activate / Complete semantics
inline edits
EGOW code validation and autofill
movement counts
Monthly Return / Dashboard / Insights
History: board, calendar, search/table, exports
Cancelled Sorties
Deleted Strips restore/purge
formations
booking-linked strip creation/update
backup/restore
desktop launch/package behaviour
native Save As exports
registration CSV integrity
19. Manager–Worker operating rules
19.1 ChatGPT

ChatGPT is the:

thinker
architect
diagnostician
root-cause finder
ticket writer
QA lead
documentation continuity owner

ChatGPT must:

inspect current implementation before writing tickets
identify actual cause
state exact files to change
state exact behaviour change required
write narrow implementation tickets
prevent drift
19.2 Claude Code

Claude is the:

production engineer
implementer

Claude must not be asked to:

diagnose root cause
infer product direction
choose architecture independently
speculate about intended behaviour
19.3 Operating rule

No Claude prompt should be issued until ChatGPT has already stated:

actual cause
exact files to change
exact behaviour change required
acceptance tests
documentation impact
20. Immediate next action

The next work item is:

Fix EGOW / LOC / timing regression cluster

Before producing a Claude prompt, ChatGPT should inspect the relevant current files on main, especially:

src/js/ui_liveboard.js
src/js/datamodel.js
src/js/vkb.js

Likely inspection targets:

new movement modal validation
LOC validation path
EGOW code validation rules
callsign enrichment path
enrichMovementData
planned-time sync helpers
duration recalculation helpers
inline edit save path
modal edit save path
timing recalculation triggers

Expected output before Claude implementation:

actual cause
exact files to change
exact functions to modify
exact behaviour to restore
smoke tests
docs impact

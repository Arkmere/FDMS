# STATE.md — Vectair Flite

Last updated: 2026-04-27 (Europe/London)

## Current headline status

- **Main branch is the authoritative baseline.**
- **UTC-first timing hardening is complete** for the tested strip lifecycle paths.
- **Timeline presentation work is complete for V1**: dual UTC/local ruler, fixed-display-time policy, and ruler boundary presentation are implemented.
- **Cancellation / deleted-strip lifecycle work is complete** for the current-state operational model.
- **Cancellation reporting is complete** as a current-state operational report.
- **Formation workstream is complete for V1 launch purposes.**
- Formation child elements now render as subordinate strip-style cards rather than a washed-out internal table.
- Formation elements use the **element callsign** as the primary callsign, e.g. `MERSY1`, `MERSY2`.
- Generic crew/callsign attribution and pilot identity appear in secondary/detail positions only.
- Formation child cards use normal flight-type colour language:
  - LOC = pink
  - DEP = blue
  - ARR = orange
  - OVR = green
- T&G / O/S / FIS / timing are usable as primary formation-element operational controls.
- Further formation visual polish, density tuning, inherited/shared-value signalling, 3+ element UX refinement, and responsive-layout polish are deferred to the post-launch backlog.
- **History Retrieval / Discovery** is now an official planned workstream, not yet implemented. It covers Movement History defaulting to Today, a Historic Movement Calendar, and a structured Search / Table view for completed movements.
- Next recommended discrete feature workstream: **Create From workflow**.
- Larger V1 launch-risk track still outstanding: **Desktop Productization**.
- Remaining V1 feature workstream after Create From / History Retrieval sequencing: **METAR Builder**.

This file is the shared source of truth for the Manager–Worker workflow.

- **Product Owner / SME:** Stuart
- **Solutions Architect & QA Lead:** ChatGPT
- **Production Engineer:** Claude Code

ChatGPT diagnoses, architects, writes tickets, reviews implementation, and maintains the continuity layer. Claude implements tickets only. Claude must not be asked to diagnose root cause or infer design direction.

---

## 1. Product identity and naming

The product is now branded **Vectair Flite** (“Flite”).

Older development material may still refer to the same application as:

- FDMS
- FDMS Lite
- Vectair FDMS

These refer to the same product unless explicitly stated otherwise.

**Flite** is a deliberate contraction of **FDMS + light**. New tickets, documentation, and summaries should use **Vectair Flite** or **Flite** unless referring to legacy names for continuity.

Do not casually revert to older FDMS naming in new tickets, documentation, screenshots, release notes, or architecture summaries.

---

## 2. Runtime and delivery model

### 2.1 Product definition

**Vectair Flite is not a website and not a hosted web app.**

Flite is a local flight-data management application for Windows and Linux. It currently uses HTML/CSS/JS internally and is run during development through a lightweight local harness.

Preferred local run pattern:

```text
git pull
python -m http.server 8000
http://localhost:8000/
```

The local server is a development/runtime convenience only and must not be described as hosting.

### 2.2 Current development baseline

- Development OS: Windows
- Operational target: Linux
- Current persistence model: localStorage
- Current app model: single-client local state
- No backend in current baseline
- No multi-user concurrency model in V1 baseline
- Manual verification on Stuart’s Windows environment is the primary acceptance path
- Browser/WebView cache can show stale JS/CSS

Reliable validation path after JS/CSS changes:

```text
DevTools → Network → Disable cache → reload
```

### 2.3 Local-only files

The following is local-only and must remain untracked:

```text
Vectair Flite.lnk
```

Do not add this file to git.

### 2.4 Desktop productization direction

The current harness is not the final product model.

Desktop Productization is a V1 workstream and should eventually cover:

- installer
- signed builds
- auto-update capability
- OS integration
- app-managed local file/database persistence
- better crash/error logging
- migration away from browser/localStorage-era state where appropriate
- Windows and Linux packaging discipline

Mac support is not currently required.

---

## 3. Repo and branch baseline

### 3.1 Authoritative branch

```text
main
```

`main` is the authoritative working baseline unless explicitly stated otherwise.

### 3.2 Known historical anchors

The following branches/tags may exist as intentional history/fallback points:

- `legacy/pre-desktop-main`
- `baseline/pre-desktop-productization`
- pre-desktop baseline tag / commit references from the productization handover

Do not delete or reinterpret these casually.

### 3.3 Current merge baseline

The following workstreams should be treated as merged and complete for current planning purposes:

- UTC-first timing hardening
- Day Timeline presentation tranche
- cancellation / deleted lifecycle tranche
- cancellation reporting
- formation implementation through FR-15
- formation expanded element child-strip refactor

Formation child-strip display work is accepted as launch-usable. Future formation display refinement is post-launch backlog unless a specific launch-blocking defect is reported.

---

## 4. Core architecture

Current major code responsibilities:

```text
src/index.html
  Shell, tab structure, major panels

src/js/app.js
  Boot/wiring, tab init, high-level rendering hooks

src/js/ui_liveboard.js
  Live Board, History, lifecycle actions, modals, inline editing, strip renderers,
  formation expanded display, formation child-strip UI

src/js/datamodel.js
  Movement storage, config, initialization, timing helpers, formation helpers,
  lifecycle stores, localStorage persistence

src/js/reporting.js
  Reporting and official return logic

src/js/ui_reports.js
  Reports UI wiring

src/js/bookingSync.js
  Booking ↔ strip linkage reconciliation

src/css/vectair.css
  Main styling, Live Board styling, History styling, formation child-strip styling
```

---

## 5. Non-negotiable behaviour invariants

### 5.1 UTC authority

- UTC is authoritative.
- Stored operational strip times are UTC.
- Local time is presentation/input only.
- Local input must convert back to UTC before save.

Canonical time fields:

```text
depPlanned
depActual
arrPlanned
arrActual
depActualExact
```

Operational fields use `HH:MM`. Exact WTC anchor uses `HH:MM:SS`.

### 5.2 Event-based vs nominal reporting split

Two reporting models intentionally coexist.

#### Live Board daily stats

Event-based / EGOW-realized:

- DEP counts only when departure actually occurred
- ARR counts only when arrival actually occurred
- LOC counts based on realized departure/arrival events plus T&G / O/S rules
- OVR contributes 0 to runway totals
- OVR remains a separate counter

#### Monthly Return / Dashboard / Insights

Nominal strip-type model:

- LOC = 2
- DEP = 1
- ARR = 1
- OVR = 0
- T&G = +2
- O/S = +1

These must not be silently merged.

### 5.3 OVR semantics

- OVR is excluded from runway Daily Movement Totals.
- OVR is counted separately.
- OVR timing uses off-frequency / left-frequency semantics:
  - EOFT / AOFT
  - ELFT / ALFT

### 5.4 ARR activation

ARR Active is status-only and must not fabricate ATD.

### 5.5 Booking/strip links

A movement may carry `bookingId`.

A booking may carry `linkedStripId`.

`bookingSync.reconcileLinks()` remains the authority for deterministic repair/clear behaviour on load.

### 5.6 Modal lifecycle

All modal close paths must use the established modal close helpers.

Avoid ad-hoc modal teardown.

### 5.7 Formation model boundary

Formation child cards are not independent normal movement records. They are UI representations of formation elements and must continue to use the existing formation-element update path.

Do not route formation element edits through ordinary movement `updateMovement()` semantics unless a dedicated architecture ticket changes this.

### 5.8 History model boundary

Movement History is completed-movement history unless a dedicated future ticket broadens it.

Cancelled Sorties and Deleted Strips remain their own History subtabs and should not be silently mixed into Movement History.

---

## 6. Stable implemented systems

### 6.1 Live Board and strip lifecycle

Implemented and broadly stable:

- Live Board rendering
- status transitions
- inline editing
- required-field safety
- timing normalization
- Active / Complete semantics by movement type
- soft-delete retention instead of immediate annihilation

### 6.2 Booking sync

Implemented and stable:

- booking create/update can create or update linked strips
- linked propagation exists
- reconciliation runs at bootstrap
- reconciliation is surfaced via Integrity banner

### 6.3 Calendar

Implemented:

- month / week / year views
- general calendar create / edit / delete
- booking/event display

### 6.4 Admin

Implemented:

- two-pane Admin IA
- dirty-state save/discard where appropriate
- restore/export/reset hardening
- backup metadata envelope and restore format detection

---

## 7. Timing and timeline baseline

The timing tranche is complete and should not be reopened unless Stuart reports a regression.

### 7.1 Timing normalization

Settled:

- one timing model per movement
- inline edit and modal edit use the same semantics
- Timeline is a projection of resolved timing, not a separate timing engine

### 7.2 Activate semantics

- DEP → stamps ATD if absent
- LOC → stamps ATD if absent
- OVR → stamps AOFT/ACT if absent
- ARR → status-only; no ATD fabrication

### 7.3 Complete semantics

- DEP → no new end-side time
- LOC → stamps ATA only if absent
- ARR → stamps ATA only if absent
- OVR → stamps actual end-side time only if absent

### 7.4 Rounding

Active and Complete auto-stamps use nearest-minute rounding:

```text
00–29 seconds → round down
30–59 seconds → round up
```

Exact second-bearing WTC time is preserved separately where relevant.

### 7.5 Inline time mode

Implemented:

- inline time labels explicitly toggle estimate vs actual mode
- mode is UI session state, not persisted
- actual mode if actual exists; estimate mode otherwise
- explicit operator toggle survives re-renders for the session

### 7.6 Timeline presentation

Complete for V1 presentation:

- dual UTC/local ruler
- secondary local ruler can be hidden when operationally same as UTC
- UTC/local ruler order can be swapped
- internal timeline header strip removed
- top and bottom rulers define timeline boundaries
- quarter-hour and half-hour ticks implemented
- Timeline remains display-only; UTC authority unchanged

---

## 8. Lifecycle model

### 8.1 Governing rule

Operational views and ordinary reports use **current-state truth**.

A strip appears according to where it currently is:

| Current state | Appears in |
|---|---|
| PLANNED / ACTIVE | Live Board |
| COMPLETED | Movement History |
| CANCELLED | Cancelled Sorties |
| Soft-deleted | Deleted Strips |
| Purged | Nowhere |

Historical lifecycle/audit records may be retained but must not override current-state operational views.

### 8.2 History IA

History has three top-level subtabs:

- Movement History
- Cancelled Sorties
- Deleted Strips

A new Movement History internal view structure is planned under the History Retrieval / Discovery workstream.

### 8.3 Cancelled Sorties

Implemented:

- cancellation modal with reason/note
- cancellation log/audit layer
- Cancelled Sorties page
- sort/filter/export
- current-state editability
- reason edit
- reinstatement
- delete from cancelled flow via soft-delete pathway

Cancelled Sorties is a current-state view. A row belongs there only if the underlying movement still exists and its current status is `CANCELLED`.

### 8.4 Reinstatement

Reinstatement target state: `PLANNED`.

Rule:

```text
newStartTime = max(originalPlanned, now + typeOffset)
```

Original planned time comes from immutable snapshot.

### 8.5 Deleted Strips

Implemented:

- soft-delete retention store
- full movement snapshot
- `deletedAt`
- `expiresAt`
- booking link cleared
- strip removed from active movement store
- Deleted Strips tab
- restore logic
- purge of expired entries

Retention period: 24 hours.

Admin configurability deferred.

### 8.6 Cancellation reporting

Implemented as a current-state operational report.

Delivered:

- date range
- cancellation KPIs
- reason breakdown
- movement type breakdown
- ranked aircraft/type/captain/route breakdowns
- row-level cancellation detail
- CSV export

Historical lifecycle-event analytics are not included and remain a possible future reporting mode.

---

## 9. Formation baseline

Formation workstream is **complete for V1 launch purposes**.

The primary implementation tranche FR-02 through FR-15 is complete. The expanded display has since been refactored from an internal table into subordinate strip-style child cards.

Further polish is deferred to post-launch backlog.

### 9.1 Formation master

The master strip is the formation summary shell. It holds top-level movement fields and a nested `formation` object containing:

- `formation.label`
- `formation.wtcCurrent`
- `formation.wtcMax`
- `formation.shared`
- `formation.elements[]`

The master does not flatten element truth. It summarises individually tracked elements.

### 9.2 Formation elements

Each `formation.elements[]` entry represents a real aircraft in the formation.

Each element can carry or resolve:

- `callsign`
- `reg`
- `type`
- `wtc`
- `status`
- `depAd`
- `arrAd`
- `depActual`
- `arrActual`
- `tngCount`
- `osCount`
- `fisCount`
- `outcomeStatus`
- `actualDestinationAd`
- `actualDestinationText`
- `outcomeTime`
- `outcomeReason`
- `underlyingCallsign`
- `pilotName`
- `overrides`
- `ordinal`

### 9.3 Shared/default model

`formation.shared` is the shared/default layer.

Elements inherit from shared defaults unless they have an override. Divergence is tracked through the element `overrides` dict.

### 9.4 Callsign convention

Element callsigns use the formation element callsign as the operational display callsign.

Examples:

```text
MERSY1
MERSY2
CNNCT 1
MEMORIAL 1
```

Generic crew/callsign attribution such as `UAM03 / UNIFORM` is secondary detail text only and must not replace the element callsign in the primary callsign position.

### 9.5 Movement counting

Per-element movement counting is implemented.

`getResolvedFormationMovements()` sums per-element nominal movement contributions, resolving T&G / O/S / FIS / inherited values as appropriate.

### 9.6 Dynamic WTC

Implemented:

- `wtcCurrent` = highest WTC among PLANNED/ACTIVE elements
- `wtcMax` = highest WTC across all elements regardless of status
- `wtcMax` does not decrease due to lifecycle/status changes

### 9.7 Divergence

Implemented:

- elements hold independent statuses
- diverged child cards are visually marked
- parent summary derives conservative status
- master status cascade rules are preserved

Master cascade rules:

- master → COMPLETED cascades PLANNED/ACTIVE elements to COMPLETED; CANCELLED preserved
- master → CANCELLED cascades PLANNED/ACTIVE elements to CANCELLED; COMPLETED preserved
- no cascade on activation

### 9.8 Per-element outcome/diversion

Implemented:

- `NORMAL`
- `DIVERTED`
- `CHANGED`
- `CANCELLED`
- actual destination
- outcome time
- reason/note

Outcome/diversion controls remain available, but they are visually secondary to ordinary operational strip controls.

### 9.9 Per-element attribution and pilot identity

Implemented:

- manual attribution callsign
- manual pilot name
- VKB-aware resolution assistance
- reporting attribution by resolved identity where applicable

### 9.10 Expanded formation display

Launch baseline:

- formation summary section
- shared/defaults section
- child element stack
- each element renders as a subordinate strip-style card
- child cards use normal flight-type colour language
- child card primary callsign is the element callsign
- attribution/pilot identity appears as secondary/detail information
- T&G / O/S / FIS / timing are usable primary operational controls
- outcome/diversion fields are available but visually de-emphasised
- child stack spans the expanded formation panel width
- no page/board overspan should occur in the accepted baseline

### 9.11 Completed formation tickets

| Ticket | Delivered |
|---|---|
| FR-02 | Activation UX |
| FR-03 | Draft memory / in-session persistence |
| FR-04 | Callsign generation |
| FR-05 | Shared/default model |
| FR-06 | Enrichment |
| FR-07 | Master-first seeding |
| FR-08 | Element-first synthesis / load-time normalization |
| FR-09 | Field-level inheritance tracking |
| FR-10 | Per-element movement counting |
| FR-11 | Dynamic WTC |
| FR-12 | Expanded strip display |
| FR-13 | Lifecycle divergence |
| FR-13b | Per-element diversion / outcome detail |
| FR-14 | Per-element pilot attribution |
| FR-14b | VKB-aware identity resolution assistance |
| FR-15 | Documentation closeout |
| Post-FR polish | Child element display refactored into strip-style cards |

### 9.12 Formation post-launch backlog

Deferred to post-launch unless promoted:

- visual density tuning
- spacing/typography refinement
- inherited/shared value signalling
- 3+ element UX refinement
- narrow-window/responsive refinement
- formation creation via “number of aircraft” count field
- automatic master → element propagation after element set is established
- deeper formation profile architecture
- formation analytics/reporting refinements
- multiple WTC scheme support per formation
- advanced lifecycle/presentation enhancements

---

## 10. History Retrieval / Discovery workstream

### 10.1 Status

Planned / not yet implemented.

This workstream has been added because the current Movement History strip board is adequate for short-range review but becomes unwieldy for older or larger historical datasets.

The aim is to preserve the existing historic strip-board view while adding better discovery routes.

### 10.2 Product problem

The current Movement History view is primarily a visual historic strip board. This works for Today or the last 24–48 hours but does not scale well for finding older completed movements.

Operators need three distinct historical access modes:

- strip-board review
- calendar-based date discovery
- search/table-based movement discovery

These should sit under Movement History rather than being mixed into Cancelled Sorties or Deleted Strips.

### 10.3 Target IA

Existing History top-level IA remains:

```text
History
├─ Movement History
├─ Cancelled Sorties
└─ Deleted Strips
```

Inside Movement History, add a second-level view switch:

```text
Movement History
├─ Historic Strip Board
├─ Historic Movement Calendar
└─ Search / Table
```

### 10.4 Default behaviour

Movement History should default to:

```text
Historic Strip Board
```

The default period should change from rolling “last 24 hours” to:

```text
Today
```

Reason: historical review is operational-date based, not rolling-window based.

### 10.5 Date anchor

Historic Movement Calendar and Movement History search should use the movement operational date / DOF as the primary date anchor.

Completion timestamp semantics may be added later as an advanced option, but the baseline history browser should be operational-day based.

### 10.6 Historic Strip Board

The existing Movement History strip-board presentation remains valid and should be preserved.

Required changes:

- default period = Today
- add structured filtering/search
- allow calendar-selected days/date ranges to drive the strip-board view

Structured filters should include:

- date from
- date to
- free-text search
- callsign
- registration
- pilot
- aircraft type
- EGOW code
- WTC
- flight type
- departure AD
- arrival AD

Structured filters should use AND semantics.

### 10.7 Historic Movement Calendar

Purpose:

- browse completed movement history by date
- identify days with activity
- open one or more days in the Historic Strip Board

Initial scope:

- completed movements only
- month view first
- visual style broadly aligned with the existing Calendar tab

Day cells should show compact summary data such as:

- total movements
- military movements
- civilian movements
- optional other/unknown category
- small visual composition indicator

Click behaviour:

- single click opens that day in Historic Strip Board
- Ctrl-click toggles selected day
- Shift-click selects a contiguous date range
- multi-selection should use an explicit “Open selected days in Strip Board” action

### 10.8 Search / Table view

Purpose:

- scalable search across completed movement history
- better for large datasets than strip-board browsing

Initial columns:

- date
- callsign
- registration
- type
- WTC
- flight type
- dep AD
- arr AD
- times
- EGOW code
- pilot
- activity
- status
- actions

Actions should include:

- open info
- jump to day in Historic Strip Board
- export filtered CSV

### 10.9 Scope boundaries

This workstream must not change:

- Live Board daily stats semantics
- Monthly Return / Dashboard / Insights nominal semantics
- Cancelled Sorties current-state model
- Deleted Strips retention model
- formation model
- timing model
- booking reconciliation

Movement History remains completed-movement history unless a later dedicated ticket broadens it.

### 10.10 Proposed implementation phases

| Phase | Scope |
|---|---|
| H1 | Change Movement History default period to Today |
| H2 | Add Movement History internal subview shell |
| H3 | Add Historic Movement Calendar |
| H4 | Add Historic Strip Board structured search/filter bar |
| H5 | Add Search / Table view |
| H6 | Polish, edge cases, accessibility, export naming, selected-day UX |

### 10.11 Completed tickets

- **H1 implemented:** Movement History now defaults to Today; Movement History is completed-only; Cancelled Sorties and Deleted Strips remain separate.

---

## 11. Documentation workstream

Documentation is a parallel continuity layer owned by ChatGPT.

Claude remains the engineer.

Living documentation set:

```text
README.md
Quick_Start_Guide.md
User_Guide.md
Install_Update_Backup_Troubleshooting.md
docs/architecture/FORMATIONS.md
```

For every future implementation ticket, explicitly state one of:

- Docs: no change
- Docs: update README
- Docs: update Quick Start
- Docs: update User Guide
- Docs: update Install/Update/Backup/Troubleshooting
- Docs: update architecture doc

Documentation principles:

- accurate beats complete
- concise beats exhaustive
- current behaviour beats aspirational behaviour
- provisional areas should be labelled plainly
- use Vectair Flite / Flite naming by default

---

## 12. Known limitations and deliberate boundaries

### 12.1 Cancellation analytics

Current cancellation reporting is current-state operational reporting only.

Deferred:

- historical lifecycle-event analytics
- audit dashboard for all lifecycle transitions
- cancellation-event-only date analytics

### 12.2 Deleted-strip retention configurability

Retention is currently hardcoded to 24 hours.

Admin configurability deferred.

### 12.3 Booking re-linkage on restore

Restoring a deleted strip does not automatically restore booking linkage.

Operator re-links manually if needed.

### 12.4 Manual purge-now action

Not implemented.

Deferred until a safe confirmation model is scoped.

### 12.5 API / VKB integration

Full Vectair-backed API / VKB integration is not in the current functional baseline.

This is a V2 workstream.

### 12.6 METAR Builder

In V1 scope but not yet implemented.

### 12.7 Desktop productization

In V1 scope but not yet implemented as the final installed-product model.

### 12.8 Formation polish

Launch-acceptable formation display is complete.

Deferred:

- tighter visual density
- richer inherited/shared value indicators
- 3+ element layout refinement
- responsive/narrow-window refinement
- formation analytics enhancements

---

## 13. Roadmap classification

### 13.1 V1 required / candidate workstreams

#### A. Desktop Productization

Major V1 launch-risk track.

Scope:

- installer
- signed builds
- auto-update
- robust app-managed local storage/database
- OS integration
- crash/error logging
- packaging discipline
- migration from localStorage-era state where appropriate

#### B. Create From workflow

Next recommended discrete feature workstream.

Purpose:

- convert the older “Duplicate → Create from…” concept into a clear Create From workflow
- allow efficient creation of related movements without corrupting timing/lifecycle semantics
- preserve operator clarity between duplicate, create-from, reciprocal, booking-derived, and formation-derived flows

#### C. History Retrieval / Discovery

Newly identified V1 usability candidate.

Purpose:

- make Movement History usable for larger historical datasets
- change Movement History default period to Today
- add Historic Movement Calendar
- add structured search/filtering
- add Search / Table view

This improves operational retrieval and review but should be sequenced against Create From, Desktop Productization, and METAR Builder.

#### D. METAR Builder

V1 feature workstream after Create From / History Retrieval sequencing unless reprioritised.

Purpose:

- selectable/editable METAR components
- generated plain-text METAR-style output
- suitable for copy/paste into email or related operational communication

### 13.2 V2 workstreams

#### A. API / VKB integration

Move beyond static/downloaded packs toward fuller Vectair-backed knowledge integration.

#### B. Booking confirmation email / pilot briefing / GAR note

Includes:

- booking confirmation email
- pilot briefing output
- GAR note for arrivals/departures outside contiguous UK
- explicit note that GAR is not managed by ATC

### 13.3 Rolling / lower-priority backlog

- booking re-linkage
- deleted-strip retention configurability
- historical lifecycle event analysis
- callsign family grouping
- notification/reminder system
- dynamic local timezone abbreviation rendering
- formation visual polish and extended formation UX improvements

---

## 14. Recommended next implementation order

### Immediate next discrete feature

```text
Create From workflow
```

### Newly added usability workstream

```text
History Retrieval / Discovery
```

This includes:

- Movement History default = Today
- Historic Movement Calendar
- Historic Strip Board search/filtering
- Search / Table view

### Parallel architectural track

```text
Desktop Productization
```

### Later V1 feature

```text
METAR Builder
```

Recommended order unless reprioritised:

1. Start Create From workflow.
2. Implement History Retrieval / Discovery, at least H1–H3 if full search/table scope is deferred.
3. Continue Desktop Productization planning/implementation in parallel.
4. Implement METAR Builder.
5. Keep formation polish in post-launch backlog unless a launch-blocking defect appears.

---

## 15. Manager–Worker operating rules

### 15.1 ChatGPT

ChatGPT is the:

- thinker
- architect
- diagnostician
- root-cause finder
- ticket writer
- QA lead
- documentation continuity owner

ChatGPT must:

- inspect current implementation before writing tickets
- identify actual cause
- state exact files to change
- state exact behaviour change required
- write narrow implementation tickets
- prevent drift

### 15.2 Claude Code

Claude is the:

- production engineer
- implementer

Claude must not be asked to:

- diagnose root cause
- infer product direction
- choose architecture independently
- speculate about intended behaviour

### 15.3 Operating rule

No Claude prompt should be issued until ChatGPT has already stated:

- actual cause
- exact files to change
- exact behaviour change required

---

## 16. Smoke testing baseline

Primary acceptance remains Stuart’s manual verification.

Standard local validation:

```text
git pull
python -m http.server 8000
http://localhost:8000/
```

Browser validation:

```text
DevTools → Network → Disable cache → reload
```

When a feature touches JS/CSS, assume stale cache is possible until explicitly ruled out.

### 16.1 Formation launch-complete smoke baseline

Formation accepted for launch purposes after smoke confirming:

- child element strips render as full-width subordinate strip-style cards
- element callsign is primary
- attribution/pilot identity is secondary
- T&G/O/S/FIS/timing usable as operational controls
- outcome/diversion available but visually secondary
- no datamodel/schema migration
- no observed counting/WTC/lifecycle regression sufficient to block launch

Further formation polish goes to post-launch backlog unless a specific bug is found.

### 16.2 History Retrieval future smoke baseline

When History Retrieval work begins, minimum smoke should include:

- Movement History defaults to Today
- Historic Strip Board still renders existing completed movements
- Calendar view summarises days using completed movements only
- single-click calendar day opens Historic Strip Board for that day
- Ctrl-click and Shift-click selection work as specified
- structured filters use AND semantics
- Search / Table results match filter criteria
- Cancelled Sorties and Deleted Strips remain unaffected

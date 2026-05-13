# STATE.md — Vectair Flite

Last updated: 2026-05-11 (Europe/London, rev 5 — Monthly Return ghost-count contamination)

This file is the shared source of truth for the Vectair Flite Manager–Worker workflow.

- **Product Owner / SME:** Stuart
- **Solutions Architect & QA Lead:** ChatGPT
- **Production Engineer:** Claude Code

ChatGPT diagnoses, architects, writes tickets, reviews implementation, and maintains the documentation/continuity layer. Claude implements precise tickets only. Claude must not be asked to diagnose root cause, infer product direction, or choose architecture independently.

---

## 0. Current headline status

- **Main branch is the authoritative baseline.**
- **Vectair Flite** (“Flite”) is the current product name.
- Legacy references to **FDMS**, **FDMS Lite**, **Vectair FDMS**, or **Vectair FDMS Lite** refer to the same product unless explicitly stated otherwise.
- **V1 is not release-ready.**
- The current next engineering item is:

```text
Vendor SheetJS for offline operation (DP-03)
```

- **Desktop Productization audit** is implemented on branch `claude/desktop-productization-audit-BsDcx`; review pending. See `docs/DESKTOP_PRODUCTIZATION_AUDIT.md`.
- **One release blocker identified:** SheetJS loaded from CDN (`src/index.html` line 8). Must be vendored locally before V1 ships offline.
- **Monthly Return ghost-count contamination** is implemented on branch; smoke testing pending before merge.
- **Live Board summary counter aggregation and computed tooltips** is complete and merged.
- The EGOW / LOC / timing regression cluster is **resolved and merged**. It is now a regression baseline, not active work.
- History Retrieval is complete through **H5b**. **H6 polish / integration closeout** remains open.
- Formation implementation through **FR-15** is complete for  launch purposes. Further formation refinement is post-launch unless a specific launch-blocking defect appears.
- Native **Save As** export behaviour is implemented for the relevant CSV/XLSX export paths in the Tauri desktop environment.
- Browser/download fallback remains available for non-Tauri/local-browser harness use.
- `FDMS_REGISTRATIONS.csv` has been restored and verified at **25,713 lines**.
- V1 release scope is now explicitly confirmed as including:
  - Create From workflow
  - METAR Builder
  - full offline standalone Desktop Productization
- MAB package filtering is confirmed as **post-V1**.

---

## 1. Product identity and naming

The product is branded:

```text
Vectair Flite
```

Short form:

```text
Flite
```

Older development material may refer to the same application as:

```text
FDMS
FDMS Lite
Vectair FDMS
Vectair FDMS Lite
```

These are legacy names for the same product unless the context explicitly distinguishes them.

Flite is a deliberate contraction of FDMS + light. New tickets, documentation, release notes, screenshots, and architecture summaries should use **Vectair Flite** or **Flite** by default.

Do not casually revert to older FDMS naming in new material.

---

## 2. Repository, branch, and historical anchors

### 2.1 Repository

Local repository:

```text
C:\Users\dmshs\FDMS
```

GitHub repository:

```text
Arkmere/FDMS
```

### 2.2 Authoritative branch

```text
main
```

`main` is the authoritative working baseline unless explicitly stated otherwise.

### 2.3 Known historical anchors

The following branches/tags may exist as intentional history/fallback points:

```text
legacy/pre-desktop-main
baseline/pre-desktop-productization
flite-pre-desktop-baseline-2026-03
```

Do not delete or reinterpret these casually.

### 2.4 Latest important merged EGOW baseline

The latest closed EGOW consolidation work was merged to `main` at:

```text
73023df Fix EGOW Unit provenance, add change listeners, trigger derivation from reg autofill
```

Relevant recent EGOW commits include:

```text
73023df Fix EGOW Unit provenance, add change listeners, trigger derivation from reg autofill
17f19cf Add stale autofill clearing, UAM family fallback, and malformed-input safeguard
339a7c7 Correct LOC PIC layout, tracked autofill, and single-digit callsign guard
a11918e Consolidate EGOW attribution and timing fixes
cd343bc Fix EGOW schema spelling and flight-number lookup normalisation
```

---

## 3. Runtime and delivery model

### 3.1 Product definition

Vectair Flite is **not** a website and **not** a hosted web app.

Flite is a local flight-data management application for Windows and Linux. It currently uses HTML/CSS/JS internally and is being productized through Tauri.

The local Python server is a development/runtime convenience only and must not be required for normal V1 operation.

### 3.2 V1 desktop productization requirement

V1 Desktop Productization means:

```text
Flite must be a fully independent, offline-capable, installable desktop application.
It must not depend on a browser, a Python development server, or internet connectivity for normal core operation.
```

V1 desktop productization must include, at minimum:

- packaged application build;
- local asset/data loading inside the installed app;
- normal offline operation using bundled/saved critical data;
- no dependency on `python -m http.server` for normal use;
- verified native Save As/export behaviour;
- clear local data persistence and backup/restore expectations;
- installation/update/troubleshooting documentation;
- sufficient crash/error visibility for internal operational use.

Signed installers, automatic updates, and polished public distribution infrastructure may be deferred unless they become necessary for the first release.

### 3.3 Current development environment

Development OS:

```text
Windows
```

Operational target:

```text
Linux, with Windows development/testing
```

Current browser harness:

```powershell
cd C:\Users\dmshs\FDMS\src
python -m http.server 8000
```

Browser URL:

```text
http://localhost:8000/
```

Current Tauri development run:

```powershell
cd C:\Users\dmshs\FDMS
cargo tauri dev
```

Tauri currently waits for the frontend dev server at:

```text
http://localhost:8000/
```

This is acceptable for development only. It is not acceptable as the V1 product runtime.

### 3.4 Known binary / launcher references

Known app binary path from prior context:

```text
C:\Users\dmshs\FDMS\target\debug\vectair-flite.exe
```

Known launcher from prior context:

```text
launch-flite.ps1
```

### 3.5 Persistence model

Current persistence model:

```text
localStorage
```

Known localStorage key:

```text
vectair_fdms_movements_v3
```

Current app model:

```text
single-client local state
```

There is currently:

- no backend;
- no hosted/cloud storage model;
- no multi-user concurrency model;
- no server-side database in the V1 baseline.

SQLite / SQL-backed persistence is **not automatically V1**. It should only be promoted into V1 if Desktop Productization exposes a hard reliability, backup, migration, or packaging problem that cannot be responsibly solved with the current storage model.

Longer-term persistence should move toward an explicit storage-adapter architecture, likely including SQLite or another robust local store.

### 3.6 Cache warning

Browser/WebView cache can show stale JS/CSS.

When validating JS/CSS behaviour:

```text
DevTools → Network → Disable cache → Reload
```

In the Tauri app, use:

```text
Admin → System Status → Reload App
```

where available.

### 3.7 Local-only files

The following file is local-only and must remain untracked:

```text
Vectair Flite.lnk
```

`.gitignore` should exclude local Windows shortcut files:

```text
*.lnk
```

Do not commit local shortcuts or local-only investigation scratch files.

---

## 4. Current source layout and architecture map

Known source layout:

```text
src/index.html
src/css/vectair.css
src/js/app.js
src/js/datamodel.js
src/js/ui_liveboard.js
src/js/ui_booking.js
src/js/vkb.js
src/js/reporting.js
src/js/ui_reports.js
src/js/export_utils.js
src/js/services/bookingSync.js
src/js/stores/bookingsStore.js
src/data/*.csv
src-tauri/
docs/
STATE.md
```

### 4.1 Loading invariant

`src/index.html` must load:

```text
js/app.js
```

as the single application entry point.

Do not regress to a state where the UI appears but buttons, filters, sorting, colour logic, or feature wiring are non-functional because `app.js` is not loaded.

### 4.2 Major code responsibilities

`src/index.html`

- Shell, tab structure, major panels.

`src/js/app.js`

- Boot/wiring, tab initialization, high-level rendering hooks.

`src/js/ui_liveboard.js`

- Live Board, History, lifecycle actions, modals, inline editing, strip renderers, formation expanded display, formation child-strip UI.

`src/js/datamodel.js`

- Movement storage, config, initialization, timing helpers, formation helpers, lifecycle stores, localStorage persistence.

`src/js/vkb.js`

- Static VKB CSV loading and lookup helpers.

`src/js/reporting.js`

- Reporting and official return logic.

`src/js/ui_reports.js`

- Reports UI wiring.

`src/js/export_utils.js`

- Shared export/save helpers for CSV/text and binary export paths.

`src/js/services/bookingSync.js`

- Booking ↔ strip linkage reconciliation.

`src/js/stores/bookingsStore.js`

- Booking persistence/access layer.

`src/css/vectair.css`

- Main styling, Live Board styling, History styling, Reports styling, formation child-strip styling.

Tauri-specific files:

```text
src-tauri/Cargo.toml
src-tauri/Cargo.lock
src-tauri/src/lib.rs
src-tauri/tauri.conf.json
src-tauri/capabilities/default.json
```

---

## 5. Completed / merged baseline

The following workstreams should be treated as merged and complete for current planning purposes.

| Workstream | Status |
|---|---|
| Core Live Board strip workflow | Complete baseline |
| Live Board counter aggregation and computed tooltips | Complete — merged |
| Monthly Return ghost-count contamination | Implemented on branch; smoke testing pending |
| UTC-first timing hardening | Complete baseline |
| Day Timeline presentation tranche | Complete baseline |
| Cancellation / deleted-strip lifecycle tranche | Complete |
| Cancellation reporting | Complete |
| Formation implementation through FR-15 | Complete for V1 launch |
| Formation expanded child-strip display refactor | Complete |
| History Retrieval H1–H5b | Complete |
| Native Save As export consolidation H5b | Complete |
| EGOW / LOC / timing regression cluster | Fixed and merged at `73023df` |
| EGOW attribution consolidation | Fixed and merged at `73023df` |
| Aircraft pilot suggestions | Implemented using `FDMS_AIRCRAFT_PILOTS.csv` |
| Registration CSV restoration | `FDMS_REGISTRATIONS.csv` verified at 25,713 lines |

---

## 6. Current active engineering priority

### 6.1 Immediate next item

```text
DP-03 — Vendor SheetJS for offline operation

Desktop Productization audit is implemented on branch claude/desktop-productization-audit-BsDcx; review pending before merge.

The audit identified one V1 offline release blocker:

SheetJS is loaded from CDN in src/index.html and must be vendored locally.

DP-03 should be a narrow implementation ticket:

add a pinned local SheetJS file at src/lib/xlsx.full.min.js;
update src/index.html to load ./lib/xlsx.full.min.js;
do not change export logic;
do not change Rust/Tauri commands;
verify XLSX export works offline in Tauri.
6.2 Next productization sequence

After DP-03, continue the desktop productization closeout sequence:

DP-04 — Update package.json identity and add Tauri dev/build scripts
DP-05 — Rewrite README / Getting Started for desktop launch and release build
DP-06 — Enable and smoke-test CSP after SheetJS is vendored
DP-07 — Confirm and document Admin backup/restore coverage for all localStorage keys
DP-08 — First full release build smoke test on Windows

Monthly Return, Dashboard, and Insights retain the nominal strip-type reporting model unless explicitly redesigned:

LOC = 2
DEP = 1
ARR = 1
OVR = 0
T&G = +2
O/S = +1

Live Board daily counters remain separate and event-based / EGOW-realized.

---

## 7. Non-negotiable behaviour invariants

### 7.1 UTC authority

UTC is authoritative.

Stored operational strip times are UTC.

Local time is presentation/input only. Local input must convert back to UTC before save.

Canonical time fields include:

```text
depPlanned
depActual
arrPlanned
arrActual
depActualExact
```

Operational fields use:

```text
HH:MM
```

Exact WTC anchor uses:

```text
HH:MM:SS
```

### 7.2 Event-based vs nominal reporting split

Two reporting models intentionally coexist.

#### Live Board daily stats

Live Board daily stats are event-based / EGOW-realized:

- DEP counts only when departure actually occurred.
- ARR counts only when arrival actually occurred.
- LOC counts based on realized departure/arrival events plus T&G / O/S rules.
- T&G counts as 2 runway movements.
- O/S counts as 1 runway movement.
- OVR contributes 0 to runway totals.
- OVR remains a separate counter.

#### Monthly Return / Dashboard / Insights

Monthly Return / Dashboard / Insights use the nominal strip-type model:

- LOC = 2
- DEP = 1
- ARR = 1
- OVR = 0
- T&G = +2
- O/S = +1

These models must not be silently merged.

### 7.3 OVR semantics

OVR is excluded from runway Daily Movement Totals.

OVR is counted separately.

OVR timing uses off-frequency / left-frequency semantics:

```text
EOFT / AOFT
ELFT / ALFT
```

### 7.4 ARR activation

ARR Active is status-only and must not fabricate ATD.

### 7.5 Booking/strip links

A movement may carry:

```text
bookingId
```

A booking may carry:

```text
linkedStripId
```

`bookingSync.reconcileLinks()` remains the authority for deterministic repair/clear behaviour on load.

### 7.6 Modal lifecycle

All modal close paths must use the established modal close helpers.

Avoid ad-hoc modal teardown.

### 7.7 Formation model boundary

Formation child cards are not independent normal movement records. They are UI representations of formation elements and must continue to use the existing formation-element update path.

Do not route formation element edits through ordinary `updateMovement()` semantics unless a dedicated architecture ticket changes this.

### 7.8 History model boundary

Movement History is completed-movement history unless a dedicated future ticket broadens it.

Cancelled Sorties and Deleted Strips remain their own History subtabs and should not be silently mixed into Movement History.

### 7.9 Export model boundary

All user-facing CSV/XLSX exports in the Tauri desktop app should use native Save As where implemented.

Browser Blob/download fallback remains valid when not running under Tauri.

Do not reintroduce direct frontend imports from Tauri plugin packages such as:

```text
@tauri-apps/plugin-dialog
@tauri-apps/plugin-fs
```

The static/non-bundled frontend cannot safely resolve those module specifiers.

Use the shared helper layer:

```text
src/js/export_utils.js
```

and registered Tauri invoke commands.

### 7.10 VKB mutability and historical truth

VKB lookup data is mutable. Historical movement records must not be retroactively reinterpreted by later VKB edits.

Changing a pilot assignment, aircraft association, callsign/fleet allocation, registration record, or EGOW flight-number row must affect future lookups only unless the operator explicitly chooses a controlled historical correction workflow.

Movement records should preserve the resolved values that applied when the movement was created/completed.

Example:

```text
April: UAM10 = Pilot A
May:   UAM10 = Pilot B
```

April movements must continue to show Pilot A after the May assignment change.

---

## 8. Timing and timeline baseline

### 8.1 Timing normalization

Settled model:

- one timing model per movement;
- inline edit and modal edit should use the same semantics;
- Timeline is a projection of resolved timing, not a separate timing engine.

### 8.2 Activate semantics

| Movement type | Activate behaviour |
|---|---|
| DEP | stamps ATD if absent |
| LOC | stamps ATD if absent |
| OVR | stamps AOFT / actual off-frequency if absent |
| ARR | status-only; no ATD fabrication |

### 8.3 Complete semantics

| Movement type | Complete behaviour |
|---|---|
| DEP | no new end-side time |
| LOC | stamps ATA only if absent |
| ARR | stamps ATA only if absent |
| OVR | stamps actual end-side time only if absent |

### 8.4 Rounding

Active and Complete auto-stamps use nearest-minute rounding:

```text
00–29 seconds → round down
30–59 seconds → round up
```

Exact second-bearing WTC time is preserved separately where relevant.

### 8.5 Inline time mode

Implemented:

- inline time labels explicitly toggle estimate vs actual mode;
- mode is UI session state, not persisted;
- actual mode if actual exists; estimate mode otherwise;
- explicit operator toggle survives re-renders for the session.

### 8.6 Timeline presentation

Complete for V1 presentation:

- dual UTC/local ruler;
- secondary local ruler can be hidden when operationally same as UTC;
- UTC/local ruler order can be swapped;
- internal timeline header strip removed;
- top and bottom rulers define timeline boundaries;
- quarter-hour and half-hour ticks implemented.

Timeline remains display-only. UTC authority is unchanged.

---

## 9. Lifecycle model

### 9.1 Governing rule

Operational views and ordinary reports use current-state truth.

| Current state | Appears in |
|---|---|
| PLANNED / ACTIVE | Live Board |
| COMPLETED | Movement History |
| CANCELLED | Cancelled Sorties |
| Soft-deleted | Deleted Strips |
| Purged | Nowhere |

Historical lifecycle/audit records may be retained but must not override current-state operational views.

### 9.2 History IA

History has three top-level subtabs:

```text
Movement History
Cancelled Sorties
Deleted Strips
```

Movement History has internal views:

```text
Historic Strip Board
Historic Movement Calendar
Search / Table
```

### 9.3 Cancelled Sorties

Implemented:

- cancellation modal with reason/note;
- cancellation log/audit layer;
- Cancelled Sorties page;
- sort/filter/export;
- current-state editability;
- reason edit;
- reinstatement;
- delete from cancelled flow via soft-delete pathway;
- native Save As CSV export path.

Cancelled Sorties is a current-state view. A row belongs there only if the underlying movement still exists and its current status is:

```text
CANCELLED
```

### 9.4 Reinstatement

Reinstatement target state:

```text
PLANNED
```

Rule:

```text
newStartTime = max(originalPlanned, now + typeOffset)
```

Original planned time comes from immutable snapshot.

### 9.5 Deleted Strips

Implemented:

- soft-delete retention store;
- full movement snapshot;
- `deletedAt`;
- `expiresAt`;
- booking link cleared;
- strip removed from active movement store;
- Deleted Strips tab;
- restore logic;
- purge of expired entries.

Retention period:

```text
24 hours
```

Admin configurability is deferred.

### 9.6 Cancellation reporting

Implemented as a current-state operational report.

Delivered:

- date range;
- cancellation KPIs;
- reason breakdown;
- movement type breakdown;
- ranked aircraft/type/captain/route breakdowns;
- row-level cancellation detail;
- CSV export via native Save As in Tauri.

Historical lifecycle-event analytics are not included and remain a future reporting mode.

---

## 10. EGOW attribution / aircraft pilot baseline

### 10.1 Status

The EGOW / LOC / timing regression cluster has been resolved and merged into `main` at commit:

```text
73023df
```

This area is a regression baseline, not an active workstream.

### 10.2 Resolved scope

Resolved scope included:

- LOC EGOW validation rejects blank and invalid EGOW codes where required.
- Callsign-derived EGOW enrichment has been restored and consolidated through `lookupEgowAttributionFromCallsign()`.
- Visible EGOW Code, EGOW Unit, and PIC fields use tracked autofill provenance via `dataset.autofillValue`.
- Stale autofill clearing removes previous system-filled values when attribution becomes unresolved or partially blank, while preserving manual overrides.
- The legacy untracked EGOW Unit writer has been removed.
- UAM leading-zero semantics are enforced: `UAM03` resolves, `UAM3` does not.
- UAM family fallback supports unknown UAM numbers such as `UAM99` resolving to `BM` only, with blank EGOW Unit and PIC.
- LOC PIC layout matches DEP/ARR/OVR modal layout.
- LOC planned-time sync and edit-save timing recalculation have been restored.
- ARR Active no longer fabricates ATD.
- OVR semantics remain unchanged.

### 10.3 EGOW schema

Implemented expanded EGOW attribution using the revised `FDMS_EGOW_CODES.csv` schema:

```text
CALLSIGN_BASE,APPROVED_CONTRACTION,FLIGHT_NUMBER,EGOW_CODE,UNIT,UNIT_CODE,NAME,POSITION,NOTES
```

`APPROVED_CONTRACTION` is the corrected spelling. Backward-compatible fallback for the old typo `APPROVED_CONTRATION` may remain where needed.

### 10.4 Resolver behaviour

`lookupEgowAttributionFromCallsign(callsignCode)` implements deterministic lookup with:

- numeric suffix splitting;
- lookup-only leading-zero normalization;
- `CALLSIGN_BASE + FLIGHT_NUMBER`;
- `APPROVED_CONTRACTION + FLIGHT_NUMBER`;
- blank `FLIGHT_NUMBER` base fallback;
- blank `FLIGHT_NUMBER` contraction fallback;
- malformed-input guard for leading-zero families.

Stored/displayed callsigns must not be rewritten by lookup normalization.

### 10.5 UAM / formation callsign rule

Individual single-aircraft pilot callsigns must include a leading zero.

Correct:

```text
UAM01
UAM02
UAM03
```

Malformed:

```text
UAM1
UAM2
UAM3
```

Formation element callsigns do not use leading zero:

```text
MERSY1
MERSY2
CNNCT1
```

`UAM3` must not resolve and must not fall through to the UAM family fallback. `MERSY2` must resolve via formation/contraction route and remain displayed/stored as `MERSY2`.

### 10.6 Aircraft pilot suggestions

Implemented aircraft pilot suggestion loading using:

```text
FDMS_AIRCRAFT_PILOTS.csv
REGISTRATION,FIXED_CALLSIGN,PILOT_NAME_LAST,PILOT_NAME_FIRST
```

Implemented behaviour:

- `aircraftPilots: []` is loaded in VKB data.
- `lookupAircraftPilots(registration, fixedCallsign)` matches by normalized registration or fixed callsign.
- Duplicate surnames may be disambiguated with first-name initial.
- New flight, LOC, and edit modal PIC inputs have pilot datalists.
- Single-match auto-fill uses tracked autofill behaviour and preserves manual values.

Pilot lookup is static for V1. Learned PIC ranking is post-launch.

### 10.7 EGOW / LOC / timing regression baseline

Future work touching attribution, validation, timing, activation, or movement counting must preserve the smoke tests in section 21.6.

---

## 11. Formation baseline

### 11.1 Status

Formation workstream is complete for V1 launch purposes.

The primary implementation tranche FR-02 through FR-15 is complete. The expanded display has since been refactored from an internal table into subordinate strip-style child cards.

Further polish is deferred to post-launch backlog unless a specific launch-blocking defect appears.

### 11.2 Formation master

The master strip is the formation summary shell. It holds top-level movement fields and a nested formation object containing:

```text
formation.label
formation.wtcCurrent
formation.wtcMax
formation.shared
formation.elements[]
```

The master does not flatten element truth. It summarizes individually tracked elements.

### 11.3 Formation elements

Each `formation.elements[]` entry represents a real aircraft in the formation.

Each element can carry or resolve:

```text
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
```

### 11.4 Shared/default model

`formation.shared` is the shared/default layer.

Elements inherit from shared defaults unless they have an override. Divergence is tracked through the element `overrides` dictionary.

### 11.5 Callsign convention

Element callsigns use the formation element callsign as the operational display callsign.

Examples:

```text
MERSY1
MERSY2
CNNCT1
MEMORIAL1
```

Generic crew/callsign attribution such as `UAM03` / `UNIFORM` is secondary detail text only and must not replace the element callsign in the primary callsign position.

### 11.6 Movement counting

Per-element movement counting is implemented.

`getResolvedFormationMovements()` sums per-element nominal movement contributions, resolving T&G / O/S / FIS / inherited values as appropriate.

### 11.7 Dynamic WTC

Implemented:

- `wtcCurrent` = highest WTC among PLANNED/ACTIVE elements.
- `wtcMax` = highest WTC across all elements regardless of status.
- `wtcMax` does not decrease due to lifecycle/status changes.

### 11.8 Divergence

Implemented:

- elements hold independent statuses;
- diverged child cards are visually marked;
- parent summary derives conservative status;
- master status cascade rules are preserved.

Master cascade rules:

- master → COMPLETED cascades PLANNED/ACTIVE elements to COMPLETED; CANCELLED preserved.
- master → CANCELLED cascades PLANNED/ACTIVE elements to CANCELLED; COMPLETED preserved.
- no cascade on activation.

### 11.9 Per-element outcome/diversion

Implemented:

```text
NORMAL
DIVERTED
CHANGED
CANCELLED
```

Also implemented:

- actual destination;
- outcome time;
- reason/note.

Outcome/diversion controls remain available, but they are visually secondary to ordinary operational strip controls.

### 11.10 Per-element attribution and pilot identity

Implemented:

- manual attribution callsign;
- manual pilot name;
- VKB-aware resolution assistance;
- reporting attribution by resolved identity where applicable.

### 11.11 Expanded formation display

Launch baseline:

- formation summary section;
- shared/defaults section;
- child element stack;
- each element renders as a subordinate strip-style card;
- child cards use normal flight-type colour language;
- child card primary callsign is the element callsign;
- attribution/pilot identity appears as secondary/detail information;
- T&G / O/S / FIS / timing are usable primary operational controls;
- outcome/diversion fields are available but visually de-emphasised;
- child stack spans the expanded formation panel width;
- no accepted launch baseline should produce page/board overspan.

### 11.12 Completed formation tickets

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

### 11.13 Formation post-launch backlog

Deferred to post-launch unless promoted:

- visual density tuning;
- spacing/typography refinement;
- inherited/shared value signalling;
- 3+ element UX refinement;
- narrow-window/responsive refinement;
- formation creation via “number of aircraft” count field;
- automatic master → element propagation after element set is established;
- deeper formation profile architecture;
- formation analytics/reporting refinements;
- multiple WTC scheme support per formation;
- advanced lifecycle/presentation enhancements.

---

## 12. History Retrieval / Discovery baseline

### 12.1 Status

History Retrieval / Discovery is implemented through H5b.

H6 polish / integration remains open and is V1-required closeout.

### 12.2 Product problem

The original Movement History strip board was adequate for short-range review but did not scale well for finding older completed movements.

Operators now have three historical access modes:

- strip-board review;
- calendar-based date discovery;
- search/table-based movement discovery.

These sit under Movement History and remain separate from Cancelled Sorties and Deleted Strips.

### 12.3 Current IA

Top-level History IA:

```text
History
├─ Movement History
├─ Cancelled Sorties
└─ Deleted Strips
```

Movement History internal IA:

```text
Movement History
├─ Historic Strip Board
├─ Historic Movement Calendar
└─ Search / Table
```

### 12.4 Completed phases

| Phase | Status |
|---|---|
| H1 | Complete — Movement History default changed to Today |
| H2 | Complete — Movement History internal subview shell |
| H3 | Complete — Historic Movement Calendar |
| H4 | Complete — Historic Strip Board structured filters |
| H5 | Complete — Search / Table view |
| H5b | Complete — Shared export correction / native Save As consolidation |
| H6 | Open — polish, edge cases, documentation, integration closeout |

### 12.5 H1 complete

Movement History now defaults to:

```text
Today
```

Movement History remains completed-only.

Cancelled Sorties and Deleted Strips remain separate.

### 12.6 H2 complete

Movement History has internal views:

- Historic Strip Board;
- Historic Movement Calendar;
- Search / Table.

Historic Strip Board remains the default internal Movement History view.

### 12.7 H3 complete

Historic Movement Calendar implemented.

Baseline behaviour:

- month view for completed movements;
- operational date / `m.dof` used as date anchor;
- Previous / Next / Today calendar controls;
- day summary counts;
- military/civilian/other summary via EGOW classification;
- clicking a day opens that day in Historic Strip Board;
- selected-date banner/chip with clear behaviour.

Ctrl-click / Shift-click multi-date selection remains deferred unless promoted.

### 12.8 H4 complete

Historic Strip Board now has structured AND filters.

Implemented filters include:

- callsign;
- registration;
- pilot/PIC/attribution;
- aircraft type;
- EGOW code;
- EGOW unit code;
- WTC;
- flight type;
- departure AD;
- arrival AD;
- free-text search.

Filter notes:

- registration matching normalises punctuation/hyphens, so `G-GORV` and `GGORV` match equivalently;
- pilot/PIC matching searches known pilot, PIC, attribution, and formation element identity fields;
- EGOW unit code supports token-based matching;
- Clear filters clears structured controls only; period/calendar selection remains independent.

### 12.9 H5 complete

Search / Table implemented.

Current Search / Table features:

- structured search across completed movement history;
- date from / date to filters using operational date / DOF;
- normalized registration matching;
- widened pilot/PIC/attribution matching;
- EGOW unit-code token matching;
- row count display;
- 15-column table;
- Open info action;
- View day / jump-to-day action;
- filtered CSV export;
- column sorting;
- row-limit guard / visible cap;
- export all filtered rows rather than only visible capped rows.

Current columns:

```text
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
```

### 12.10 H5b complete

H5b corrected and consolidated exports.

Native Save As now works in Tauri for:

- Historic Strip Board CSV export;
- Search / Table filtered CSV export;
- Cancelled Sorties CSV export;
- Reports CSV export;
- Reports XLSX export;
- Reports Cancellation CSV export.

Shared export helper:

```text
src/js/export_utils.js
```

Tauri native commands include text and binary save paths.

XLSX export uses base64/native binary save rather than an unsafe frontend plugin import.

`Cargo.lock` records the required base64 dependency.

Browser fallback remains available outside Tauri.

### 12.11 H6 open

H6 is the remaining History closeout phase.

Candidate H6 tasks:

- improve visual grouping between Historic Strip Board, Calendar, and Search / Table;
- reduce filter-panel clutter;
- consider collapsible filter groups;
- make selected-day state and cleared-filter behaviour clearer;
- improve empty-state wording;
- ensure all export names and success/cancel/fallback toasts are consistent;
- check accessibility basics on new controls;
- check narrow-window behaviour;
- update user docs;
- update `STATE.md` status references so History no longer appears planned/not implemented;
- perform one final History-specific smoke pass.

Status:

```text
OPEN — V1 polish / closeout
```

---

## 13. Export baseline

### 13.1 Export model

All relevant exports should route through shared helper functions.

Text/CSV helper:

```text
saveTextFileWithDialogOrDownload(text, filename)
```

Binary/XLSX helper:

```text
saveBinaryFileWithDialogOrDownload(base64, filename)
```

Browser fallback helper:

```text
downloadFileViaBrowser(content, filename, mimeType)
```

### 13.2 Native Tauri behaviour

When running in Tauri, exports should use:

```text
window.__TAURI__.core.invoke(...)
```

Registered native save commands handle:

- text file Save As;
- binary/base64 file Save As.

### 13.3 Browser fallback behaviour

When not running in Tauri:

- CSV/text exports fall back to Blob download;
- XLSX export may use browser/XLSX library download behaviour where appropriate.

### 13.4 Completed native Save As paths

The following are implemented and accepted after H5b:

- History → Historic Strip Board → Export as CSV;
- History → Search / Table → Export filtered CSV;
- History → Cancelled Sorties → Export CSV;
- Reports → Export CSV;
- Reports → Export XLSX;
- Reports → Cancellation view → Export Cancellations CSV.

### 13.5 Known export testing caveat

A stale WebView/browser cache previously made working export code appear broken.

When export behaviour appears inconsistent, reload cleanly before diagnosing:

```text
Admin → System Status → Reload App
```

or:

```text
DevTools → Network → Disable cache → Reload
```

---

## 14. Booking baseline

### 14.1 Current booking model

Booking workflow exists as part of the current functional baseline.

Known implementation areas:

```text
src/js/ui_booking.js
src/js/services/bookingSync.js
src/js/stores/bookingsStore.js
```

Known booking sync fields:

```text
movement.bookingId
booking.linkedStripId
booking.schedule.plannedTimeLocalHHMM
booking.schedule.plannedTimeKind
```

`bookingSync.reconcileLinks()` is the authority for deterministic booking/strip link repair/clear behaviour on load.

### 14.2 V1 booking boundary

Core booking creation/sync is V1 baseline.

Booking confirmation email, pilot briefing pack, and GAR note are post-launch/V2.

### 14.3 Post-launch booking profile expansion

The current booking profile system is limited. V2 should expand it into richer visitor, aircraft, operator, and contact profiles.

Possible future profile fields:

```text
aircraft registration
aircraft type
WTC
operator
owner/contact
regular pilot(s)
home aerodrome
billing/charging defaults
training-rate eligibility
parking preferences/defaults
frequent routing
special handling notes
documents/briefing requirements
GAR relevance if applicable
```

The later architecture decision is whether this remains booking-only or becomes part of a wider local VKB profile system.

---

## 15. VKB data architecture baseline and long-term direction

### 15.1 Current V1 data approach

Current V1 data approach is static/local CSV packs.

Known current/local static CSV data includes:

```text
FDMS_REGISTRATIONS.csv
FDMS_EGOW_CODES.csv
FDMS_AIRCRAFT_PILOTS.csv
FDMS_LOCATIONS_B_E_L.csv
```

Other data sets include callsigns, locations, aircraft types, registrations, EGOW codes, and aircraft pilots.

### 15.2 V1 offline data requirement

V1 must remain functional offline using bundled or saved critical data.

This does not require the full VKB to be bundled locally for V1. It does require enough saved/local data for normal core operations.

### 15.3 Long-term cloud + saved VKB model

Long-term VKB architecture is:

```text
Cloud VKB + saved local packs
```

Cloud mode:

- full VKB API access when online;
- authoritative or fuller data set;
- future data update/provenance pipeline.

Saved mode:

- smaller local data packs;
- region/country/operator-scoped subsets;
- sufficient for normal offline operations most of the time;
- user-selectable critical data footprint.

Existing filenames such as:

```text
FDMS_LOCATIONS_B_E_L.csv
```

demonstrate the intended regional-pack approach.

`B`, `E`, and `L` are operational region groupings used for Flite/VKB data packaging. Regional inclusion may include aerodromes that do not have an ICAO location indicator. For example, an aerodrome such as Kirkbride may be classified operationally under region `E` for Flite/VKB purposes even though it does not have an assigned ICAO code.

Do not assume that inclusion in a regional location file means the location itself has an ICAO indicator.

### 15.4 Future local pack model

Future saved/local VKB packs may include:

```text
locations by ICAO region / country / theatre
registrations by country
callsigns by state/operator/region/package
aircraft types globally or by operational relevance
EGOW-local critical pack
user-defined critical pack
```

This is V2+ unless a minimum subset is required by V1 Desktop Productization.

---

## 16. V1 roadmap classification

### 16.1 Confirmed V1 required workstreams

The current confirmed V1 required list is:

1. ~~Live Board summary counter aggregation and computed tooltips.~~ **Complete — merged.**
2. ~~Monthly Return ghost-count contamination.~~ **Implemented on branch; smoke testing pending.**
3. Desktop Productization audit.
4. Create From workflow.
5. METAR Builder.
6. H6 History polish / integration closeout.
7. Full Desktop Productization implementation / offline installable build.
8. Documentation refresh.
9. Final V1 regression and acceptance sweep.

### 16.2 Priority rationale

The recommended implementation order is intentional:

1. Live Board counters/tooltips and Monthly Return contamination should be handled together because they both touch movement-counting semantics.
2. Desktop Productization audit should happen early to expose any structural packaging/offline blockers.
3. Create From and METAR Builder should be implemented before the final packaging pass because they affect the V1 feature surface.
4. H6 History polish should close once remaining V1 functional behaviour is stable.
5. Full Desktop Productization implementation/package pass should happen after the feature surface stabilizes.
6. Documentation should follow the final V1 behaviour.
7. Final acceptance sweep and freeze come last.

### 16.3 V1 item detail

#### A. Live Board summary counter aggregation and computed tooltips

Status:

```text
COMPLETE — smoke testing required
```

Delivered:

- `calculateLiveBoardSummaryStats()` in `ui_liveboard.js` returns structured per-category breakdown.
- VM bucket: VM, VMH, VNH. VC bucket: VC, VCH. OVR excluded from runway totals.
- Per-category breakdown: DEP, ARR, LOC base, T&G, O/S counts.
- Formation contributions counted per element via `_formationEgowBreakdown()`.
- Computed `title` tooltips set dynamically on each `.stat-item` element on every update.
- Static misleading HTML `title` attributes removed from `index.html`.
- `updateDailyStats()` in `app.js` uses the new structured function.

#### B. Monthly Return ghost-count contamination

Status:

```text
Implemented on branch; smoke testing pending before merge
```

Delivered:

- `isMovementInMonthlyReturnScope()` predicate in `reporting.js`: only COMPLETED
  movements enter the Official Monthly Return; PLANNED, ACTIVE, CANCELLED, and
  any residual soft-delete-marker records are excluded.
- `computeMonthlyReturn()` applies the predicate before midnight-splitting and
  adds Set-based deduplication by source movement ID.
- `getMovementsForCurrentPeriod()` in `ui_reports.js` now filters COMPLETED
  only, so Dashboard, Insights, and CSV exports also exclude ghost/non-completed
  records.
- `renderOfficialMonthlyReturn()` passes `getMovements()` (all) to
  `computeMonthlyReturn()` so midnight-crossing LOCs from adjacent month
  boundaries are captured correctly; scope filtering is done inside.
- `handleExportXLSX()` similarly passes `getMovements()` for the grid and uses
  `getMovementsForCurrentPeriod()` for the Movement Details sheet.
- Nominal counting formulas (LOC=2, DEP/ARR=1, OVR=0, T&G×2, O/S×1) unchanged.
- Cancellation Report unchanged — it sources from CANCELLED movements
  independently of the Monthly Return pipeline.

#### C. Desktop Productization audit

Status:

```text
V1 required — early audit
```

Purpose:

- confirm whether current Tauri configuration can load assets/data without the Python server;
- identify blockers to offline installed operation;
- determine whether current localStorage persistence is sufficient for V1 or whether storage changes are required;
- identify packaging/documentation tasks before final productization.

#### D. Create From workflow

Status:

```text
V1 required
```

Purpose:

- convert the older “Duplicate → Create from…” concept into a clear Create From workflow;
- allow efficient creation of related movements;
- preserve timing/lifecycle semantics;
- distinguish duplicate, create-from, reciprocal, booking-derived, and formation-derived flows;
- avoid copying lifecycle-specific fields incorrectly.

#### E. METAR Builder

Status:

```text
V1 required
```

Purpose:

- selectable/editable METAR components;
- generated plain-text METAR-style output;
- copy/paste into email or operational communication;
- validation/formatting assistance sufficient for local operational use.

#### F. H6 History polish / integration

Status:

```text
V1 required closeout
```

Purpose:

- close remaining visual, documentation, wording, export-toast, edge-case, and smoke-test issues after H1–H5b.

#### G. Desktop Productization implementation / offline installable build

Status:

```text
V1 required
```

Purpose:

- produce a fully independent, offline-capable, installable desktop application;
- remove any normal-use dependency on Python server/browser harness;
- document backup/update/troubleshooting procedures;
- verify native exports and local data behaviour in the packaged app.

#### H. Documentation refresh

Status:

```text
Required before V1 freeze
```

Documentation must reflect:

- product name: Vectair Flite;
- current Tauri desktop runtime/productization state;
- installable/offline V1 behaviour;
- local development run process;
- backup/restore behaviour;
- native Save As export behaviour;
- History Retrieval H1–H5b completion;
- H6 status if still open;
- formation launch baseline;
- Create From and METAR Builder behaviour;
- known limitations;
- V1 release scope and exclusions.

#### I. Final V1 acceptance sweep

Status:

```text
Required before V1 freeze
```

Must include the smoke/regression areas in section 21.

---

## 17. V2 / post-launch workstreams

### 17.1 API / VKB integration

Move beyond static/downloaded packs toward fuller Vectair-backed knowledge integration.

Includes:

- VKB API access;
- online/offline mode handling;
- formal data update/provenance pipeline;
- cloud + saved data mode;
- region/country/operator-scoped saved packs.

### 17.2 VKB editable knowledge, local overrides, audit history, and rollback

V2 should provide user-side editability for selected VKB-derived datasets and local operational knowledge.

This includes, at minimum:

- richer booking/visitor/aircraft profiles;
- controlled add/edit/remove tools for local VKB records;
- local override handling for VKB-sourced data;
- change history with timestamp, old value, new value, affected record, and source/note;
- future user attribution if user profiles are introduced;
- rollback/undo for local data edits;
- validity-period or retirement handling for changing callsign/pilot/aircraft assignments;
- protection against retrospective alteration of historical movement records.

Datasets requiring user-editable local management include:

```text
FDMS_AIRCRAFT_PILOTS
FDMS_EGOW_CODES
FDMS_REGISTRATIONS
```

Operational use cases include:

- changing based aircraft lists;
- changing BC aircraft details;
- changing pilots associated with aircraft;
- changing BM flight-number/pilot assignments;
- adding/removing/editing aircraft registration records;
- retaining historical truth when assignments change month-to-month.

Architectural direction:

```text
Cloud VKB source data
→ saved local VKB packs
→ local user overrides
→ audited local change log
→ movement records store resolved historical snapshots
```

Do not design this as a simple live lookup that retroactively changes historical movement records.

### 17.3 Booking confirmation email / pilot briefing / GAR note

Includes:

- booking confirmation email to booker;
- cost breakdown;
- confirmed itinerary;
- pilot briefing output;
- airfield operating information;
- station / ATC notes;
- GAR note for arrivals/departures outside contiguous UK;
- explicit note that GAR is not managed by ATC.

### 17.4 Booking re-linkage

Improve linkage between booking records and created/planned strips after edits, lifecycle changes, deletion, restore, or manual correction.

### 17.5 Deleted-strip retention configurability

Make deleted-strip retention configurable in Admin.

Current retention remains:

```text
24 hours
```

### 17.6 Historical lifecycle analysis

Potential future analytics:

- planned → active → completed/cancelled/deleted transitions;
- timing deltas;
- lifecycle event reports;
- cancellation-event-only date analytics;
- audit dashboard for transitions.

### 17.7 Callsign family grouping

Group related callsigns/families for display, filtering, and analysis.

Useful for:

- UAM-style pilot callsigns;
- formation families;
- unit/operator callsign patterns.

### 17.8 Notification / reminder system

Potential scope:

- toast notifications;
- one-off reminders;
- recurring reminders;
- calendar-linked reminders;
- METAR observations;
- ASP updates;
- optional chime/sound;
- unfocused/minimized attention indicator.

Do not assume native taskbar flashing. Use title/tab/app attention indicators where appropriate.

### 17.9 MAB package filter

Status:

```text
Post-V1 / public-release hardening
```

The MAB package filter is deferred until after V1.

It should eventually allow Flite/VKB users to include, exclude, or inspect MoD A Block / MAB callsign package entries separately from ordinary callsign records.

It is not required for the first V1 release.

### 17.10 Advanced persistence / storage adapter

Possible future move away from localStorage toward:

- SQLite;
- explicit local storage adapter;
- migration/versioning support;
- backup/export/import hardening;
- better auditability;
- possible multi-device or multi-user modes only if product direction changes.

### 17.11 Advanced export-location management

Potential Admin section:

```text
Export & File Locations
```

Possible settings:

- Ask every time;
- default export folder;
- separate folders by export type;
- remember last export location.

Current accepted behaviour is Save As.

### 17.12 Formation post-launch enhancements

See section 11.13.

---

## 18. Rolling / lower-priority backlog

The following are not V1 blockers unless explicitly promoted:

- dynamic local timezone abbreviation rendering;
- advanced formation analytics;
- 3+ element formation layout refinement;
- Admin-configurable export locations;
- full backend/database architecture;
- multi-user/concurrent operations model;
- signed builds and auto-update if not completed as part of V1 productization;
- learned PIC ranking by historical movement count;
- alphanumeric flight-suffix support beyond pure digit suffixes;
- public/open release hardening beyond the installable V1 baseline.

---

## 19. Deprecated / superseded / no longer active

| Item | Status |
|---|---|
| Hosted/web-app interpretation | Superseded. Flite is desktop-local, not a hosted web app. |
| Python local server as product runtime | Superseded for V1. It remains development-only. |
| Electron-first productization | Superseded by Tauri-first strategy unless confirmed WebView2 blockers force reconsideration. |
| Direct frontend imports from Tauri plugins | Prohibited. Use shared export helper and registered Tauri invoke commands. |
| Formation continuation as unresolved V1 blocker | Superseded. Formation is V1-complete unless defect found. |
| EGOW/LOC/timing as active defect | Superseded. It is a regression baseline. |
| UAM single-digit permissiveness | Superseded. `UAM03` valid; `UAM3` malformed. |
| OVR included in runway totals | Invalid. OVR is separate and excluded from runway totals. |
| Monthly Return using Live Board event-based model | Invalid unless explicitly redesigned. Monthly Return remains nominal strip-type based. |
| MAB as V1 requirement | Superseded. MAB is post-V1/public-release hardening. |

---

## 20. Documentation workstream

Documentation is a parallel continuity layer owned by ChatGPT.

Claude remains the engineer.

Living documentation set:

```text
README.md
Quick_Start_Guide.md
User_Guide.md
Install_Update_Backup_Troubleshooting.md
docs/architecture/FORMATIONS.md
STATE.md
```

For every future implementation ticket, explicitly state one of:

```text
Docs: no change
Docs: update README
Docs: update Quick Start
Docs: update User Guide
Docs: update Install/Update/Backup/Troubleshooting
Docs: update architecture doc
Docs: update STATE.md
```

Documentation principles:

- accurate beats complete;
- concise beats exhaustive;
- current behaviour beats aspirational behaviour;
- provisional areas should be labelled plainly;
- use Vectair Flite / Flite naming by default.

### 20.1 Required documentation refresh before V1

Before V1 release, documentation must be updated to reflect:

- product name: Vectair Flite;
- fully independent offline installable desktop model;
- local development run process;
- packaged app launch/install behaviour;
- backup/restore behaviour;
- native Save As export behaviour;
- History Retrieval H1–H5b completion;
- H6 status if still open;
- formation launch baseline;
- Create From workflow;
- METAR Builder;
- known limitations;
- V1 release scope and exclusions.

Status:

```text
REQUIRED BEFORE V1 FREEZE
```

---

## 21. Smoke testing and acceptance baseline

Primary acceptance remains Stuart’s manual verification.

### 21.1 General local validation

Browser harness:

```powershell
cd C:\Users\dmshs\FDMS\src
python -m http.server 8000
```

Browser URL:

```text
http://localhost:8000/
```

Tauri development run:

```powershell
cd C:\Users\dmshs\FDMS
cargo tauri dev
```

When testing JS/CSS:

```text
DevTools → Network → Disable cache → Reload
```

or:

```text
Admin → System Status → Reload App
```

### 21.2 Registration data integrity check

After rebases, merges, or large file operations, verify:

```powershell
(Get-Content .\src\data\FDMS_REGISTRATIONS.csv).Count
```

Expected:

```text
25713
```

### 21.3 Export smoke baseline

Minimum export smoke:

- History → Historic Strip Board → Export as CSV opens Save As.
- History → Search / Table → Export filtered CSV opens Save As.
- History → Cancelled Sorties → Export CSV opens Save As.
- Reports → Export CSV opens Save As.
- Reports → Export XLSX opens Save As and writes valid `.xlsx`.
- Reports → Cancellation view → Export Cancellations CSV opens Save As.
- Cancelling a Save As dialog produces cancellation/info toast.
- No `@tauri-apps/plugin-dialog` module-specifier error.

### 21.4 Formation launch-complete smoke baseline

Formation accepted for launch purposes after smoke confirming:

- child element strips render as full-width subordinate strip-style cards;
- element callsign is primary;
- attribution/pilot identity is secondary;
- T&G / O/S / FIS / timing usable as operational controls;
- outcome/diversion available but visually secondary;
- no datamodel/schema migration;
- no counting/WTC/lifecycle regression sufficient to block launch.

Further formation polish goes to post-launch backlog unless a specific bug is found.

### 21.5 History smoke baseline

Minimum History smoke:

- Movement History defaults to Today.
- Historic Strip Board renders completed movements only.
- Calendar view summarizes days using completed movements only.
- Single-click calendar day opens Historic Strip Board for that day.
- Structured filters use AND semantics.
- Search / Table results match filter criteria.
- Search / Table export exports all filtered rows, not only visible capped rows.
- Cancelled Sorties and Deleted Strips remain unaffected.
- All History exports use native Save As in Tauri.

### 21.6 EGOW / LOC / timing regression smoke baseline

Resolved and merged into `main` at:

```text
73023df
```

These tests must be preserved as regression coverage for future changes touching attribution, validation, timing, activation, or movement counting.

Smoke must include:

- `UAM03` → BM / L / JENKINS.
- `UAM99` → BM / blank / blank.
- `UAM32` → BM / A / HAIGH.
- `XXX99` → blank / blank / blank.
- `UAM3` → no EGOW autofill.
- `MERSY2` → BM / L and remains displayed/stored as `MERSY2`.
- Manual EGOW/PIC overrides are preserved.
- LOC stale-clear behaviour works.
- Edit modal stale-clear behaviour works.
- DEP creation with valid callsign/EGOW enrichment.
- ARR creation with valid callsign/EGOW enrichment.
- LOC creation requires valid EGOW.
- LOC creation rejects blank EGOW where required.
- LOC ETD/start-time edit recalculates ETA/end-time.
- Duration arrow changes still recalculate expected times.
- Existing strip dep/start-time edit recalculates dependent arr/end-time where appropriate.
- OVR timing labels and semantics remain EOFT/AOFT/ELFT/ALFT.
- ARR Active remains status-only and does not fabricate ATD.
- UTC/local entry still stores UTC authority.

### 21.7 V1 feature smoke baseline

Before V1 freeze, test:

- new strip creation: DEP, ARR, LOC, OVR;
- UTC/local entry and display;
- Activate / Complete semantics;
- inline edits;
- EGOW code validation and autofill;
- movement counts;
- Live Board counter tooltips;
- Monthly Return / Dashboard / Insights;
- History: board, calendar, search/table, exports;
- Cancelled Sorties;
- Deleted Strips restore/purge;
- formations;
- booking-linked strip creation/update;
- Create From workflow;
- METAR Builder;
- backup/restore;
- desktop launch/package behaviour;
- offline use without Python server;
- native Save As exports;
- registration CSV integrity.

---

## 22. Manager–Worker operating rules

### 22.1 ChatGPT

ChatGPT is the:

- thinker;
- architect;
- diagnostician;
- root-cause finder;
- ticket writer;
- QA lead;
- documentation continuity owner.

ChatGPT must:

- inspect current implementation before writing tickets;
- identify actual cause;
- state exact files to change;
- state exact behaviour change required;
- write narrow implementation tickets;
- prevent drift.

### 22.2 Claude Code

Claude is the:

- production engineer;
- implementer.

Claude must not be asked to:

- diagnose root cause;
- infer product direction;
- choose architecture independently;
- speculate about intended behaviour.

### 22.3 Operating rule

No Claude prompt should be issued until ChatGPT has already stated:

- actual cause;
- exact files to change;
- exact behaviour change required;
- acceptance tests;
- documentation impact.

---

## 23. Desktop Productization audit record

**Branch:** `claude/desktop-productization-audit-BsDcx`  
**Status:** Implemented; review pending. Do not mark complete until Stuart passes review and branch is merged.  
**Audit document:** `docs/DESKTOP_PRODUCTIZATION_AUDIT.md`

**Release blocker identified:**
- BLOCKER-1: SheetJS XLSX library loaded from CDN (`src/index.html` line 8). Breaks XLSX export offline. Must vendor before V1.

**V1 required fixes (not build-blocking, required before handover):**
- V1-REQ-1: Add `tauri:dev` / `tauri:build` scripts to `package.json`.
- V1-REQ-2: Rename `package.json` from `fdms-lite-dev-tooling` to `vectair-flite`.
- V1-REQ-3: Rewrite README Getting Started / Architecture for desktop launch procedure.

**V1 recommended (not blocking):**
- Enable CSP in `tauri.conf.json` after SheetJS is vendored.
- Confirm Admin backup/restore covers all seven localStorage keys.
- Document dev→release localStorage origin change.

**SQLite decision:** Not required for V1. localStorage with identifier `com.vectair.flite` is stable for single-operator use. V2 workstream.

**Next implementation ticket:** DP-03 — Vendor SheetJS. Single file download + one `<script>` tag change in `src/index.html`. See audit document section 12 for exact steps.

---

## 24. Immediate next action

The next work item is:

```text
DP-03: Vendor SheetJS for offline operation
```

See `docs/DESKTOP_PRODUCTIZATION_AUDIT.md` section 12 for the exact implementation steps.

Monthly Return ghost-count contamination is implemented on branch and pending Stuart's smoke test pass.

Live Board counter aggregation and computed tooltips is implemented on branch and pending Stuart's smoke test pass.

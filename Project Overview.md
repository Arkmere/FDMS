Vectair FDMS Lite – Project Overview
1. What this project is

Vectair FDMS Lite is a lightweight Flight Data Management System for small aerodromes and ATC units, built under the broader Vectair brand.

It is designed as:

A modern, robust replacement for complex and fragile Excel movement logs.

A flight data admin tool, not a controlling tool.

A friendly UI that mirrors the feel of Vectair.org (tables, colours, typography).

Eventually a desktop application (Windows/Linux), with offline capability and optional VKB (Vectair Knowledge Base) integration.

The initial target environment is EGOW (RAF Woodvale) and similar units:

Mostly day VFR, local flying, circuits, training, and visiting GA/military.

Physical paper strips and pin boards remain the controlling tool.

Little or no IFR, no full stripless system, minimal infrastructure.

Needs strong logging, stats, and audit; doesn’t need “big iron” FDMS features like OLDI, FDP integration, or A-SMGCS.

2. High-level goals & non-goals
2.1 Goals

FDMS Lite must:

Provide a simple Live Board view of planned and active movements (the “strip board”).

Keep movement data structured and searchable (callsigns, registrations, aerodromes, EGOW codes, units, etc.).

Handle:

Local flights (LOC), including circuits and touch-and-goes.

Visiting military and civilian traffic.

Overflights and FIS-only traffic.

Formation flights, including mixed-type formations.

Integrate with the Vectair Knowledge Base (VKB) for:

Callsign lookups (civil & military).

Aerodrome codes (ICAO, IATA, name lookups).

Aircraft types, registrations, squawk codes (later).

Support basic statistics and logging:

Movement counts by EGOW code and unit.

T&Gs, out-station (O/S) movements, FIS counts.

A structure that can later match/replace the existing annual Excel summaries.

2.2 Non-goals (for FDMS Lite v1)

FDMS Lite is not intended to:

Replace physical strips with a full electronic strip system.

Coordinate via OLDI/FDPS or integrate with radar, SMR, ATIS, or A-SMGCS.

Enforce a full clearance workflow (startup, push, taxi, line-up, etc.).

Handle full airlines-scale slot/flow management (CTOT/DMAN/AMAN).

Provide high-availability infrastructure (redundant servers, HA clusters).

It should remain small, understandable, and resilient for low/medium volume units.

3. Core user experience
3.1 Live Board (main view)

The Live Board is the central screen:

A Vectair-style table showing:

Columns:

Status strip (colour-coded: Planned / Active / Completed / Cancelled).

Callsign (code + label).

Registration / type / WTC.

Route (DEP/ARR codes + human-readable names).

Times (planned and actual).

Activity (badges: flight type, Local, T&Gs, O/S, FIS, formation size).

Actions (e.g. “Details ▾”).

Interactions:

Global search (callsign, reg, aerodrome, EGOW, etc.).

Column filters:

Callsign.

Reg/Type.

Route (DEP/ARR).

Status filter:

Planned & Active / Active only / All.

Date range selector:

Today / Today + 3 days / All demo flights (placeholder for future date logic).

Clicking “Details ▾” expands a strip row to show full details.

Expanded row (“strip details”):

Movement summary:

Status, flight type, departure/arrival aerodromes.

Planned vs actual times.

T&Gs, O/S and FIS counts.

POB.

Coding & classification:

EGOW code and description (e.g. BC, VM, VC, etc.).

Unit (code + description).

Voice callsign.

Captain.

Remarks.

Formation block (if applicable):

Label (e.g. “CNNCT flight of 3”).

Current WTC and max WTC.

Table of elements: callsign, reg, type, WTC, status, dep/arr times.

The Live Board is conceptually similar to Copperchase’s “strip page”, but for admin only; physical strips remain the controlling record if desired.

3.2 Modals: New Flight / New Local

The app exposes two key creation pathways:

New Flight – general-purpose (ARR/DEP/LOC/OVR).

Fields (current demo):

Callsign.

Registration.

Flight type (ARR / DEP / LOC / OVR).

Flight rules (VFR / IFR / SVFR).

Departure / Arrival aerodromes (free text, VKB-assisted later).

Planned off-block / ETA.

Number of aircraft (for formations).

POB.

T&G count.

Outstation? (Yes/No).

Remarks.

New Local – preconfig for EGOW → EGOW circuits.

Fixed:

Flight type: LOC.

DEP/ARR: EGOW.

Editable:

Callsign, registration.

Planned start / end times.

Number of aircraft.

T&G count.

POB.

Remarks.

Currently, these modals are visual only in the skeleton; the next dev step is wiring them to actually create movements in memory via createMovement().

3.3 Formation handling (conceptual behaviour)

Formations are a core Woodvale requirement and must be handled cleanly:

A formation can be:

A generic callsign (e.g. CNNCT) with no suffix.

A set of elements (e.g. CNNCT 1, CNNCT 2, CNNCT 3).

Mixed types and WTC: e.g. MEMORIAL formation: SPIT (L), HURI (L), LANC (M).

Conceptual rules:

Master + elements model (target behaviour):

One master movement for the formation (e.g. CNNCT).

One movement per element (e.g. CNNCT 1, CNNCT 2, CNNCT 3).

Elements start out inheriting key data from master (times, T&Gs, O/S, etc.).

Inheritance:

Editing a field on the master propagates to all elements that still inherit that field.

Editing that field on an element “breaks” inheritance for that element only.

Example:

CNNCT departs as a formation, all elements share dep time.

CNNCT 2 returns early: element’s landing time is set individually → it no longer tracks master’s landing time.

Later, updating CNNCT (master) landing time only updates 1 and 3, not 2.

Formation WTC:

Each element has its own WTC per scheme.

Master computes:

wtcMax: highest WTC among all elements ever in the formation.

wtcCurrent: highest WTC among elements with status PLANNED or ACTIVE.

Example:

MEMORIAL 1 & 2 (SPIT/HURI) = L; MEMORIAL 3 (LANC) = M.

While LANC airborne:

current = M, max = M.

After LANC lands:

current = L, max = M.

Current implementation: datamodel.js contains hard-coded demo movements including CNNCT and MEMORIAL with simple formation sub-objects. The full master/element structure and inheritance logic are not yet implemented, but the UI is designed to show formation details in the expanded row.

3.4 WTC schemes (design intent)

WTC schemes must consider:

ICAO standard.

UK-specific departure WTC scheme (as used operationally in the UK).

Design intent:

A wtc_core dataset storing, per aircraft type:

icao_wtc.

uk_dep_wtc / uk_arr_wtc (if relevant).

MCTOM and notes.

Facility configuration includes:

primary_wtc_scheme (the one shown on the strip, default ICAO).

Optional scheme variations for departures/arrivals.

This is currently not coded; WTC is represented simply as strings in demo data (e.g. "M (ICAO)", "M (current, max M)"), but all UI/text is written assuming multiple schemes will be considered later.

4. Vectair Knowledge Base (VKB) integration

VKB is the “Vectair Knowledge Base” – a shared dataset across the Vectair family:

Airline codes.

Military callsigns.

Locations (ICAO/IATA + names and regions).

Aircraft types and designations.

Registration prefixes.

Squawk codes.

4.1 Packs and scope

Long-term, VKB is split into packs:

By region/continent (e.g. Europe, North America).

By country (e.g. UK, Spain, Portugal, Norway).

By use case:

Civil vs military.

Adjacent-region suggestions (e.g. UK + Norway for Sumburgh, UK + Spain/Portugal/North Africa for Gibraltar).

Facilities will:

Choose which packs to install (to save space and keep lookups fast).

Optionally accept recommendations:

“You’re at Gibraltar: we recommend UK, Spain, Portugal, France, Morocco.”

“You’re at Carlisle and you’re using Dutch military callsigns frequently: consider adding Dutch mil pack.”

“You’re at Leeds East; you have an Australian civil pack installed but no Australian traffic in X months: suggest removal.”

This recommendation logic is concept-level; not yet implemented in code.

4.2 VKB in the UI

Current code includes a VKB Lookup tab (placeholder):

Designed to mirror vectair.org tables:

Per-column search.

Same kind of tabular look and feel.

Future FDMS-specific actions:

“Use as callsign”.

“Use as DEP/ARR”.

“Use as type”, etc.

Planned behaviours (not yet coded):

Callsign field behaviour:

If the user types plain “Shawbury”:

VKB lookup resolves to SYS / SHAWBURY 22 etc., with canonical abbreviation (e.g. SYS22).

If the user types CONNECT:

VKB resolves canonical abbreviation (CNNCT) and marks it as an official or observed form.

If the user types something unknown:

FDMS allows free-text entry; no blocking.

Aerodrome fields:

Accept ICAO, IATA, local codes, or plain names (Valley, Anglesey).

VKB resolves code (e.g. EGOS) and name (RAF Valley), with hover/tooltips or subtext.

None of this is wired yet; the current build only has a descriptive placeholder in the VKB tab.

5. Current architecture and code layout
5.1 Tech stack

Pure front-end:

HTML

CSS

Vanilla JavaScript (ES modules)

No frameworks or build tools (no React, Vue, Webpack, etc.).

Development:

Run a simple static server from src/ (e.g. python -m http.server 8000).

View at http://localhost:8000.

Later, this front-end will be:

Embedded in a desktop wrapper (e.g. Electron or similar).

Backed by a small persistent data store (e.g. SQLite or local API).

5.2 Directory structure (current)

Planned/typical structure:

FDMS/
  README.md
  roadmap.md          # high-level spec, if present
  src/
    index.html        # main app shell
    css/
      vectair.css     # shared styling, Vectair aesthetic
    js/
      app.js          # bootstrap, tab switching, clock
      datamodel.js    # demo data, status helpers, createMovement()
      ui_liveboard.js # Live Board rendering, modals, filters

5.3 Files and responsibilities
src/index.html

Responsible for:

Page skeleton.

Header, nav tabs, main panels.

Live Board table structure (thead, tbody with id="liveBody").

Placeholder panels for History, Reports, VKB Lookup, Admin.

Modal root <div id="modalRoot"></div>.

Including JS via <script type="module" src="js/app.js"></script>.

Key assumptions:

All layout and styling hooks are provided via class/id.

The JS modules (app.js, ui_liveboard.js) target these IDs/classes.

src/css/vectair.css

Encodes the visual identity:

Palette: header teal/blue, Vectair brown accents, light grey tables.

Typography: system UI, simple hierarchy (titles, subtitles, cell text).

Table styles consistent with Vectair DataTables:

Grey header, subtle row striping, thin borders.

UI components:

Header bar.

Tabs (with active underline).

Toolbars.

Panels.

Status strips.

Badges (for flight types, Local, formation, T&Gs, O/S, FIS).

Modal windows for New Flight / New Local.

Central place for any future design changes; new screens should reuse these tokens and classes for consistency.

src/js/datamodel.js

Currently holds:

demoMovements: an array of hard-coded movement objects used to populate the Live Board.

Examples include:

SYS22 (SHAWBURY 22).

UAM11 (WOODVALE 11 local LOC).

CNNCT formation of 3 (EH10/LYNX mix).

BA133 overflight with FIS.

MEMORIAL formation with SPIT/HURI/LANC mix.

getMovements():

Returns the demoMovements array.

This will later be replaced with a query to a real data store.

statusClass(status) and statusLabel(status):

Utility functions mapping PLANNED, ACTIVE, etc. to CSS classes and human-readable strings.

createMovement(partial):

Simple helper that:

Assigns a new id.

Pushes the object into demoMovements.

Returns the new movement.

This file is the seed for a richer data model. Over time it will:

Represent full movement lifecycle.

Represent formations with master + elements and inheritance.

Cache WTC values per scheme.

Provide query/filter helpers for different views (Live, History, Reports).

src/js/ui_liveboard.js

Handles all Live Board rendering and interaction:

Maintains UI state:

expandedId: which movement’s detail row is expanded.

columnFilters: callsign, reg, route.

globalFilter: the global search query.

matchesFilters(movement):

Applies:

Status filter.

Global free-text filter.

Column-specific filters.

renderLiveBoard():

Grabs #liveBody tbody.

Gets movements from getMovements().

Filters them via matchesFilters().

Builds rows:

Main row with status strip, callsign, reg/type/WTC, route, times, badges.

“Details ▾” button that sets expandedId and re-renders.

Optional expanded row beneath:

Movement summary.

Coding & classification.

Formation block (if m.formation exists).

Modal handling:

openModal(contentHtml):

Injects a .modal-backdrop into #modalRoot.

Handles clicking outside to close, ESC key to close.

Hooks .js-close-modal and .js-save-demo buttons in the modal content:

.js-close-modal → closes modal.

.js-save-demo → currently just shows a placeholder alert and then closes.

openNewFlightModal() / openNewLocalModal():

Build the HTML for respective forms and pass it to openModal().

initLiveBoard():

Wires all inputs:

Global search.

Column filters.

Status and date range filters.

New Flight / New Local buttons.

Calls renderLiveBoard() once to render the table.

This file is the main target for enhancements like:

Making Save actually call createMovement() with parsed form values.

Adding inline update logic for times, statuses, etc.

Later: factoring common table rendering logic out for use in History.

src/js/app.js

App bootstrap:

Tab switching:

setTab(name): shows/hides panels and toolbars based on tab (live, history, reports, lookup, admin).

initTabs(): attaches click handlers to .nav-tab buttons and sets default tab to live.

UTC clock:

initClock(): updates #utcClock every 30 seconds with current UTC time and date.

DOMContentLoaded handler:

Calls initTabs(), initClock(), and initLiveBoard().

This is the central starting point; new feature modules (e.g. ui_history.js, ui_reports.js, etc.) will be wired from here.

6. How to run and develop
6.1 Basic dev workflow (local)

Clone the repo:

git clone git@github.com:Arkmere/FDMS.git
cd FDMS


Run a small static server from src (Python 3 example):

cd src
python -m http.server 8000


Open:

http://localhost:8000


Edit files under src/ in your editor:

index.html

css/vectair.css

js/app.js

js/datamodel.js

js/ui_liveboard.js

Refresh the browser to see changes.

Check DevTools console for errors if the UI misbehaves.

6.2 Working with Codex / Copilot

Typical prompts:

To extend behaviour:

“Read src/js/datamodel.js and src/js/ui_liveboard.js.
Wire the Save buttons in the New Flight and New Local modals so they:

Read values from the form.

Call createMovement() with a new movement object.

Close the modal and call renderLiveBoard().”

To introduce a new module:

“Create src/js/ui_history.js that reuses the same table layout as the Live Board but only shows COMPLETED and CANCELLED movements. Wire it from app.js so the History tab uses it.”

Always keep src/ as the single source of truth. All development changes should flow through that directory.

7. Current state vs. next priorities
7.1 What is already done

Vectair-aligned UI shell:

Header, nav bar, panels, toolbars.

Fully working Live Board with:

Demo movements (including formations).

Status and text filtering.

Expandable details per movement, including formation details.

New Flight / New Local modals:

Fully designed forms.

Working modal behaviour (open/close).

7.2 What is not yet done (high-level)

Actual CRUD for movements:

Saving a new movement from the modals.

Editing/deleting existing movements.

Proper formation data model:

Master/element structure.

Inheritance logic for times, counts, etc.

WTC max/current recomputation.

VKB integration:

Real lookups (callsigns, locations, types).

VKB Lookup tab with live tables.

History view (completed/cancelled).

Reports (monthly/yearly stats).

Persistence (SQLite or similar) and desktop packaging.

7.3 Recommended next steps for a new dev

Understand the current skeleton
Read:

src/index.html

src/css/vectair.css

src/js/app.js

src/js/datamodel.js

src/js/ui_liveboard.js
Run the app locally and click around.

Implement in-memory Save
Make New Flight / New Local actually create movements using createMovement() and rerender Live Board.

Refine the data model
Define a movement object type and, if desired, a separate structure for formation groups and elements, aligning with the conceptual formation logic described above.

Add History using shared table components
Reuse the Live Board rendering logic for a second view that filters by status ∈ {COMPLETED, CANCELLED}.

Begin VKB integration planning
Even before wiring real data, stub the VKB Lookup tab and how it will send values into strip fields (e.g. events, message bus, or direct calls).

Once a new hire has read and understood everything above, they should have the full mental model needed to contribute effectively to FDMS Lite without re-deriving the design from scratch.
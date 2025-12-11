# Vectair FDMS Lite – Roadmap

## 1. Project Overview

Vectair FDMS Lite is a lightweight, offline-capable flight data management system for small ATC units and aerodromes. It is aimed primarily at:

- Local / day / VFR traffic
- Units with paper strips (or pin boards), not full electronic strip systems
- Environments with little or no IFR, limited automation, and minimal infrastructure

FDMS Lite is **not** a controlling tool. It is an administrative layer:

- A structured, searchable, audit-friendly way to manage flight data and statistics
- A “shiny” replacement for complex Excel stats sheets
- Integrated with the Vectair Knowledge Base (VKB) for codes and lookups

Long-term, it will be shipped as a **desktop executable** (Windows / Linux). For now, development is web-first (HTML/JS), with the desktop wrapper (e.g. Electron) to come later.

---

## 2. Current Prototype (`prototype/vectair_fdms_demo.html`)

The repo currently contains a single HTML demo:

- **File**: `prototype/vectair_fdms_demo.html`
- **Purpose**: Visual and interaction prototype for the FDMS Lite UI.

### 2.1 What the demo shows

- **Vectair branding / UX**
  - Vectair-style header, colours, typography, and table layout.
  - Tabs: `Live Board`, `History`, `Reports`, `VKB Lookup`, `Admin`.

- **Live Board**
  - Table styled like vectair.org DataTables:
    - Column filters for Callsign, Reg/Type, Route.
    - Global search field.
  - Rows representing “strips”:
    - Status strip (Planned / Active / Completed).
    - Callsign (code + label).
    - Reg / Type / WTC.
    - Route (DEP/ARR codes & names).
    - Times (planned/actual).
    - Activity badges (LOC, T&Gs, O/S, FIS).
    - Formation badge (`F×n`) where applicable.
  - Click row → in-line expanded details row:
    - Movement summary (status, route, times, T&Gs, O/S, FIS, POB).
    - Coding & classification (EGOW code, unit, callsign voice, captain, remarks).
    - Formation section (if applicable) with element table.

- **Example data**
  - Local UAS circuits (UAM11 LOC with T&Gs).
  - Visiting military helicopter traffic (SYS22, CNNCT).
  - Overflight with FIS (BA133).
  - MEMORIAL 3-ship formation (SPIT / HURI / LANC) with mixed WTC.

- **New Flight / New Local modals (static)**
  - Demonstrate:
    - Callsign, registration, flight type, rules, DEP/ARR.
    - Planned times.
    - **Number of aircraft** field (for formations).
    - T&G count, O/S flag, POB.
  - Currently **visual only** – no persistence.

This prototype is the visual reference Codex should preserve when refactoring.

---

## 3. Functional Scope (v1.0 – “FDMS Lite for Woodvale”)

The v1.0 target is **single-position, single-facility**, focused on your current Woodvale use case, with the design kept flexible enough for other units later.

### 3.1 Core FDMS functions

- Manual creation and editing of movements:
  - ARR / DEP / LOC / OVR.
  - VFR (IFR allowed but not heavily optimised).
- Each movement includes:
  - Callsign (code + plain-language label + voice callsign).
  - Registration, type, wake category.
  - DEP / ARR aerodromes.
  - Times: planned / actual (off-block, take-off, landing as needed).
  - Flight rules, origin / destination, route (text).
  - T&G count, O/S count / flag, FIS count.
  - POB, pilot/captain, unit, EGOW code, free-text remarks.
- Movement lifecycle:
  - Status: PLANNED, ACTIVE, COMPLETED, CANCELLED.
  - Simple state changes (no enforced clearance workflow for v1).

### 3.2 Formation handling

Two complementary modes:

1. **Single-strip formation** (`formation_size` only):
   - One movement row with `formation_size > 1`.
   - Movement counts multiplied by `formation_size`.
   - Used for simple “treat as one” admin scenarios.

2. **Master + element strips** (preferred for Woodvale):
   - `formation_groups` table:
     - `id`, `dof`, `base_callsign`, `notes`.
   - `movements` extended with:
     - `formation_group_id`
     - `is_formation_master` (bool)
     - `element_index` (1,2,3… for CNNCT 1/2/3)
   - Behaviour:
     - One master movement (e.g. `CNNCT`) represents the formation as a whole.
     - One movement per element (e.g. `CNNCT 1`, `CNNCT 2`, `CNNCT 3`):
       - Each with its own reg, type, WTC, times, counters, EGOW code, etc.
   - **Inheritance**:
     - Elements initially inherit key fields from master (times, counters).
     - Editing a field on the master propagates to all elements that still “inherit”.
     - Editing that field on an element breaks inheritance for that element only.
     - Example:
       - CNNCT 2 departs earlier: set its dep time → it no longer follows master dep.
       - Later, setting dep time on CNNCT master updates 1 & 3 but not 2.
   - Mixed-type formations:
     - MEMORIAL formation can contain SPIT (L), HURI (L), LANC (M).
     - Each element stores its own type and WTC.

### 3.3 Wake turbulence categories

- `wtc_core` table stores **multiple schemes per type**:
  - `icao_wtc`
  - `uk_dep_wtc`
  - `uk_arr_wtc`
  - `mctom`, `notes`
- Facility config chooses:
  - `primary_wtc_scheme` (what appears on strips; default = ICAO).
  - Optional special schemes for departures/arrivals:
    - `dep_wtc_scheme`, `arr_wtc_scheme`.
- `movements` cache all relevant WTC values.
- **Formation WTC**:
  - For each scheme, master movement stores:
    - `formation_*_wtc_max` – heaviest element ever in that formation.
    - `formation_*_wtc_current` – heaviest WTC among **active** elements (status PLANNED/ACTIVE).
  - Example:
    - MEMORIAL with SPIT (L), HURI (L), LANC (M):
      - While LANC active: `current = M`.
      - After LANC landed: `current = L`, `max = M`.

### 3.4 VKB integration (Vectair Knowledge Base)

- Local copy of VKB, split into **packs** by region/usage:
  - Airline codes
  - Military callsigns
  - Location codes
  - Aircraft designations / types
  - Registration prefixes
  - Squawk codes
- Facility config:
  - Select which VKB packs are installed (e.g. UK civil, UK mil, nearby countries).
  - VKB recommendation engine (later):
    - Suggest adding/removing packs based on observed traffic.

- Callsign lookup behaviour:
  - Military callsigns table:
    - `base_name` (CONNECT)
    - `abbrev` (CNNCT)
    - `abbrev_status` (`OFFICIAL` / `OBSERVED` / `LOCAL`)
    - Optional `synonyms` and pattern hints.
  - If user types plain English (`connect`), suggest canonical abbrev (`CNNCT`).
  - If user types an abbreviation directly, match on `abbrev` or pattern.
  - Never block free-text: ad-hoc exercise callsigns are allowed.

- Location lookup:
  - DEP/ARR fields accept:
    - ICAO / IATA / local codes.
    - Plain-language names (e.g. “Valley”, “Anglesey”).
  - VKB resolves to canonical code (EGOS) and displays plain name beneath.

### 3.5 Logging, stats & audit (v1 scope)

- Full movement log stored in database (later; for now demo is in-memory).
- Basic stats:
  - Movement counts by EGOW code and unit.
  - T&Gs and O/S totals.
  - Simple month/year summaries (target: match existing Excel Annual sheet).
- Audit trail v1:
  - Who created/edited a movement, and when.

---

## 4. UI / UX Spec (high-level)

The design follows the current Vectair website aesthetic.

### 4.1 Shell

- Vectair-style header:
  - VA logo box + “Vectair FDMS Lite” title.
  - Subtitle: “Flight Data Management – Local VFR / Admin”.
  - Right side: facility name + UTC clock.
- Sub-nav tabs:
  - `Live Board`, `History`, `Reports`, `VKB Lookup`, `Admin`.
  - Active tab in Vectair accent brown.

### 4.2 Live Board

- Top toolbar:
  - Date range selector (Today / Today + 3 days / All).
  - Status filter (Planned & Active / Active only / All).
  - Global search field.
  - `New Local` and `New Flight` buttons.

- Table:
  - Vectair-style grey table with:
    - Header row.
    - Filter row under header (input per column).
  - Columns:
    1. Status strip (colour bar).
    2. Callsign:
       - Code (bold) and label (sub-text).
    3. Reg / Type / WTC.
    4. Route (DEP/ARR codes + names).
    5. Times (planned / actual).
    6. Activity badges:
       - Flight type (ARR/DEP/LOC/OVR).
       - Local badge.
       - T&G, O/S, FIS counts.
       - Formation badge `F×n` if formation group.
    7. Actions (e.g. “Details ▾”).

- Expanded row (click a strip):
  - Insert a details row beneath with:
    - Movement summary.
    - Coding & classification.
    - Formation section (if applicable):
      - Label / current WTC / max WTC.
      - Element table (callsign, reg, type, WTC, status, dep/arr times).

### 4.3 New Flight / New Local dialogs

- Modal windows using the Vectair form style.
- Fields (v1 visual spec):
  - Callsign (with VKB search/assist).
  - Registration.
  - Flight type (ARR/DEP/LOC/OVR).
  - Flight rules.
  - DEP/ARR aerodromes (VKB-assisted).
  - Planned times.
  - **Number of aircraft**:
    - Drives formation logic.
    - Later will offer:
      - “Track as single formation”
      - “Track elements individually”
  - T&G count, O/S flag/count, POB.
  - Remarks.

Currently, the prototype modals are **non-functional**; in v1 they will create and update real movement records.

### 4.4 VKB Lookup tab

- Will mirror vectair.org tables:
  - Airline Codes, Military Callsigns, Location Codes, Military Designations,
    Registration Prefixes, Squawk Codes.
- For each table:
  - Same column layout and per-column search inputs as the website.
- FDMS-specific actions:
  - Right-click / action buttons:
    - “Use as callsign”
    - “Use as DEP”
    - “Use as ARR”
    - etc.

### 4.5 History, Reports, Admin

- **History**:
  - Same table layout as Live Board.
  - Filters for date range, EGOW code, unit, event tags.
- **Reports**:
  - Changelog-style layout:
    - Brown section headings.
    - Tables / bullet lists for monthly and annual summaries.
- **Admin**:
  - Card-based layout similar to Resources / AvCom pages:
    - Facility settings (including WTC scheme).
    - VKB packs install/remove.
    - User accounts and roles.
    - Business rules (later).

---

## 5. Technical Plan (incremental)

### 5.1 Stage 0 – Prototype (current)

- Single HTML file (`prototype/vectair_fdms_demo.html`).
- In-memory demo movements (`demoMovements` array).
- All logic in one `<script>` block.

### 5.2 Stage 1 – Front-end refactor

Goal: turn the prototype into a small, modular front-end app.

Tasks:

1. Create `/src` directory structure:
   - `src/index.html` – main app shell.
   - `src/css/vectair.css` – shared styling tokens.
   - `src/js/app.js` – app bootstrap, tab switching.
   - `src/js/dataModel.js` – movement and formation data structures.
   - `src/js/ui_liveBoard.js` – Live Board rendering and interactions.
2. Move the demo HTML/JS into `/src` preserving behaviour and appearance.
3. Keep `prototype/vectair_fdms_demo.html` as a frozen visual reference.

### 5.3 Stage 2 – Data model implementation

Goal: replace the ad-hoc `demoMovements` with a proper model.

- Implement movement object model, including:
  - Formation group structure and inheritance flags.
  - WTC caching per scheme.
- Implement basic in-memory CRUD:
  - Create/edit/delete movements.
  - Create formation group, add elements, split/merge behaviour.
- Wire `New Flight` / `New Local` modals to the data model.

### 5.4 Stage 3 – Persistence & desktop wrapper (outline)

(Not implemented yet; for later milestones.)

- Choose storage (likely SQLite) and a desktop wrapper (e.g. Electron).
- Introduce a small backend layer:
  - Movement CRUD endpoints.
  - VKB pack management.
- Keep front-end largely unchanged; swap in API calls instead of in-memory arrays.
- Package as Windows/Linux executables.

---

## 6. Immediate Next Steps

For Codex / Copilot:

1. **Refactor prototype into `/src`**  
   - Preserve look and behaviour of `prototype/vectair_fdms_demo.html`.  
   - Create the file structure from §5.2 and move code accordingly.

2. **Introduce a data model module**  
   - Implement `dataModel.js` with movement + formation structures consistent with §3.2 and §3.3.  
   - Replace direct use of `demoMovements` with calls into the data model.

3. **Wire New Flight / New Local modals to the model (in-memory)**  
   - On Save, create new movements in memory and re-render the Live Board.  
   - No persistence beyond page refresh yet.

4. **Add stubs for VKB Lookup and Admin**  
   - Create placeholder views and functions for later VKB integration and facility config.

Once those steps are complete, FDMS Lite will have a solid, Vectair-branded front-end ready for a backend and desktop packaging.

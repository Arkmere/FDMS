# Formations in Vectair Flite

> Canonical reference for how formation flights are represented, entered, displayed,
> and managed within Vectair Flite.
>
> **Document version: 2.0 — 2026-04-26**
> Updated to reflect the implemented baseline after FR-02 through FR-15.
> Earlier notes described a weaker or partially-implemented system; this document
> describes what now exists in code.

---

## Formations v1.1 — Implemented Baseline

This section defines the current implemented behavior. It replaces earlier notes that described inheritance, per-element editing, and WTC recomputation as "planned" or "not yet implemented" — those features are now implemented.

### Formation storage
Formations are stored only on the master movement:

```
movement.formation = {
  label,          // human-readable designation, e.g. "CNNCT flight of 3"
  baseCallsign,   // extracted from label or first element
  wtcCurrent,     // highest WTC of PLANNED/ACTIVE elements (dynamic)
  wtcMax,         // highest WTC of all elements regardless of status (preserved)
  shared,         // shared/default layer (see below)
  elements[]      // per-element records
}
```

### Shared defaults layer (v1.1)

`formation.shared` holds the common fields that elements inherit unless individually overridden:

- `depAd`, `arrAd`
- `flightType`
- `tngCount`, `osCount`, `fisCount`
- `reg`, `type`, `wtc`

This layer is populated from the master movement fields at creation time (master-first seeding). `normalizeFormation()` re-derives it on every load, including migration of pre-v1.1 formations (element-first synthesis).

### Element schema (v1.1 — implemented)
Each element is stored as:

- `ordinal` (number) — 1-based position; added by `normalizeFormation()` at load time
- `callsign` (string) — base callsign + space + ordinal, e.g. `CNNCT 1`
- `reg` (string)
- `type` (string)
- `wtc` (string) — one of `{L,S,M,H,J}`; empty means inherit from shared
- `status` (string) — one of `{PLANNED,ACTIVE,COMPLETED,CANCELLED}`; independent per element
- `depAd`, `arrAd` (string) — element aerodromes; `""` means unset (inherits shared-layer display fallback)
- `depActual`, `arrActual` (string) — individual actual times (HH:MM UTC, or empty)
- `tngCount`, `osCount`, `fisCount` (number) — per-element counts; override shared if set
- `outcomeStatus` (string) — `NORMAL` / `DIVERTED` / `CHANGED` / `CANCELLED`
- `actualDestinationAd`, `actualDestinationText` (string) — where the element actually went
- `outcomeTime`, `outcomeReason` (string) — outcome event time and explanation
- `underlyingCallsign` (string) — explicit non-display attribution identity (e.g. real callsign)
- `pilotName` (string) — element-level pilot name
- `overrides` (object) — dict of field names that have diverged from the shared layer

### Empty depAd/arrAd fallback (display behavior)
If `element.depAd == ""`, the UI displays the shared-layer `depAd` as a muted fallback (display-only). The stored element value remains `""`. Same rule for `arrAd`.

No automatic copying from the shared layer into element `depAd/arrAd` occurs on save. Divergence is tracked via the `overrides` dict.

### Validation (hard requirements)
- `wtc` must be one of `{L,S,M,H,J}` (uppercase-coerced). Invalid values are rejected.
- `depAd/arrAd` must be `""` or match `^[A-Z0-9]{4}$` (uppercase-coerced). Invalid values are rejected.
- `status` must be one of `{PLANNED,ACTIVE,COMPLETED,CANCELLED}`.

### Element count
A formation exists only when `elements.length >= 2`.
Authoring UI clamps formation count to `min=2`, `max=12`.
If count < 2, `movement.formation` is treated as null (no formation).

### WTC semantics (dynamic — implemented)
- `wtcCurrent` = max WTC across elements whose status is `PLANNED` or `ACTIVE`. Recomputed after every element status change.
- `wtcMax` = max WTC across all elements regardless of status. Never decreases.
- WTC rank: `L < S < M < H < J`
- Both fields are recomputed by `computeFormationWTC()` and persisted on every `updateFormationElement()` call.

### Master status cascade rules
- When the master movement becomes `COMPLETED`, all formation elements in `{PLANNED,ACTIVE}` are set to `COMPLETED`. Elements already `CANCELLED` are preserved.
- When the master movement becomes `CANCELLED`, all formation elements in `{PLANNED,ACTIVE}` are set to `CANCELLED`. Elements already `COMPLETED` are preserved.
- No cascade occurs on master activation (PLANNED→ACTIVE).

### Produce-arrival / produce-departure inheritance
When producing the opposite leg from a formation-bearing movement:
- The produced movement inherits the formation structure including identity fields and `depAd/arrAd`.
- The produced movement resets element operational state:
  - `status = PLANNED`
  - `depActual = ""`
  - `arrActual = ""`

### Scope boundaries
- Booking objects and booking sync are formation-agnostic.
- `formation_groups` table and `is_formation_master` / `element_index` data model fields are deferred backlog — not implemented in the current single-movement model.
- Formation auto-creation from a "Number of aircraft" count field is deferred backlog.

---

## 1. What is a Formation?

A **formation** is a group of two or more aircraft operating under a single lead callsign.
In ATC and flight-data terms, the formation moves as one traffic unit for planning and
separation purposes, but each aircraft remains individually identifiable for recording and
counting purposes.

FDMS models a formation on a single **strip** (movement record). The strip's top-level
fields represent the formation as a whole (lead callsign, route, planned/actual times,
flight type, etc.) and a nested `formation` object holds the individual **elements**.

---

## 2. The Formation Model

The implemented model is the **master + element** model. A `formation_size`-only flat mode (no element records) was considered earlier but is not the implemented approach.

### Master + Element (implemented)

One **master** movement represents the formation as a whole (lead callsign, route, planned times, flight type). Each **element** aircraft is represented inside the master strip's `formation.elements[]` array, with its own registration, type, WTC, individual status, actual times, outcome detail, and attribution identity.

- Used for: display flights, multi-ship training sorties, mixed-type formations
- Supports mixed-WTC formations (e.g., MEMORIAL: Spitfire L, Hurricane L, Lancaster M)
- Supports per-element divergence, diversion tracking, and individual pilot attribution

Movement counting is per-element (see §10), not lead-only.

---

## 3. How a Formation Strip is Entered

### 3a. Strip-level fields (the master record)

When creating a formation strip, the top-level movement fields are filled in exactly as
for any other strip:

| Field | Description | Notes |
|---|---|---|
| `callsignCode` | Lead callsign (e.g., `CNNCT`) | This becomes the formation base callsign |
| `callsignLabel` | Callsign voice / label (e.g., `CONNECT FLIGHT`) | |
| `type` | Aircraft type string | Set to a descriptive string for mixed formations, e.g., `Mixed (EH10 / LYNX)` |
| `registration` | Lead aircraft registration | |
| `flightType` | `ARR`, `DEP`, `LOC`, or `OVR` | Applies to the formation as a whole |
| `rules` | `VFR` or `IFR` | |
| `depAd` / `arrAd` | Departure / arrival aerodrome | |
| `depPlanned` / `arrPlanned` | Planned times for the formation | Elements can later record individual actual times |
| `pob` | Total persons on board | |
| `remarks` | Free text | e.g., `"Formation departure to Shawbury, one a/c to remain O/S"` |
| `wtc` | WTC of the whole movement (overridden by formation logic) | See §6 |

### 3b. The `formation` object

Alongside the standard fields, a `formation` sub-object is embedded in the movement:

```json
"formation": {
  "label": "CNNCT flight of 3",
  "wtcCurrent": "M",
  "wtcMax": "M",
  "elements": [ ... ]
}
```

| Field | Type | Description |
|---|---|---|
| `label` | string | Human-readable formation designation — typically `"CALLSIGN flight of N"` |
| `wtcCurrent` | string | Highest WTC among all elements currently `PLANNED` or `ACTIVE` |
| `wtcMax` | string | Highest WTC ever held by any element in the formation |
| `elements` | array | One object per aircraft in the formation |

### 3c. Element objects

Each entry in `elements` describes one aircraft:

```json
{
  "callsign": "CNNCT 1",
  "reg":       "ZZ400",
  "type":      "EH10",
  "wtc":       "M",
  "status":    "ACTIVE",
  "depActual": "13:15",
  "arrActual": ""
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `callsign` | string | Yes | Element callsign — base callsign + space + ordinal, e.g., `CNNCT 2` |
| `reg` | string | No | Aircraft registration. Displays as `—` if omitted |
| `type` | string | No | Aircraft type code (ICAO designator). Displays as `—` if omitted |
| `wtc` | string | No | Wake Turbulence Category for this individual element (see §6) |
| `status` | string | Yes | `PLANNED` \| `ACTIVE` \| `COMPLETED` \| `CANCELLED` |
| `depActual` | string | No | Actual departure time in `HH:MM` (UTC). Empty string if not yet departed |
| `arrActual` | string | No | Actual arrival time in `HH:MM` (UTC). Empty string if not yet arrived |

---

## 4. Reference Formations in the Demo Data

Two formations are pre-loaded in the FDMS demo dataset (`src/js/datamodel.js`).

### 4a. CNNCT — military helicopter formation

- **Master callsign**: `CNNCT` (Connect Flight)
- **Type mix**: EH10 (WTC M) and two LYNX (WTC L)
- **Flight type**: DEP
- **Remarks**: *"Formation departure to Shawbury, one a/c to remain O/S"*

| # | Callsign | Reg | Type | WTC | Status | Dep Actual |
|---|---|---|---|---|---|---|
| 1 | CNNCT 1 | ZZ400 | EH10 | M | ACTIVE | 13:15 |
| 2 | CNNCT 2 | ZZ401 | LYNX | L | ACTIVE | 13:15 |
| 3 | CNNCT 3 | ZZ402 | LYNX | L | PLANNED | — |

WTC Current: **M** (CNNCT 1 still active) | WTC Max: **M**

### 4b. MEMORIAL — warbird display formation

- **Master callsign**: `MEMORIAL` (Memorial Flight)
- **Type mix**: Spitfire (L), Hurricane (L), Lancaster (M)
- **Flight type**: LOC (local)
- **Remarks**: *"Three-ship display detail"*

| # | Callsign | Reg | Type | WTC | Status | Dep Actual |
|---|---|---|---|---|---|---|
| 1 | MEMORIAL 1 | AB910 | SPIT | L | ACTIVE | 15:05 |
| 2 | MEMORIAL 2 | LF363 | HURI | L | ACTIVE | 15:05 |
| 3 | MEMORIAL 3 | PA474 | LANC | M | ACTIVE | 15:05 |

WTC Current: **M** (LANC still active) | WTC Max: **M**

---

## 5. How Formations Appear on the Live Board

### 5a. The formation badge

Any strip that carries a `formation` object with a populated `elements` array renders
a **formation badge** in the badge row of its strip card:

```
F×3
```

The number after `F×` is the element count (`formation.elements.length`). The badge is
rendered by `renderBadges()` in `src/js/ui_liveboard.js`.

No badge appears if `formation` is absent or if `elements` is empty.

### 5b. The expanded formation detail panel

Clicking the expand arrow on a formation strip opens an additional **Formation** subsection
below the main details (coding, summary, etc.). This section is rendered by
`renderFormationDetails()` in `src/js/ui_liveboard.js` and contains:

**Header key-values:**

| Label | Value shown |
|---|---|
| Label | `formation.label` |
| Current WTC | `formation.wtcCurrent` |
| Max WTC | `formation.wtcMax` |

**Element table (one row per element — inline-editable):**

| Column | Source | Inline-editable |
|---|---|---|
| # | `element.ordinal` | — |
| Callsign | `element.callsign` | — |
| Attr CS | `element.underlyingCallsign` | Yes — explicit attribution identity override |
| Pilot | `element.pilotName` | Yes |
| Reg | `element.reg` | — |
| Type | `element.type` | — |
| WTC | `element.wtc` | — |
| Status | `element.status` | Yes — dropdown |
| Dep AD | `element.depAd` (shared-layer fallback if empty) | Yes |
| Arr AD | `element.arrAd` (shared-layer fallback if empty) | Yes |
| Dep | `element.depActual` | Yes |
| Arr | `element.arrActual` | Yes |
| T&G | `element.tngCount` (shared-layer fallback) | Yes |
| O/S | `element.osCount` (shared-layer fallback) | Yes |
| FIS | `element.fisCount` | Yes |
| Mvts | computed nominal contribution | — |
| Outcome | `element.outcomeStatus` | Yes — dropdown |
| Act Dest | `element.actualDestinationAd` | Yes |
| Out Time | `element.outcomeTime` | Yes |
| Reason | `element.outcomeReason` | Yes |
| Save | — | Row-level atomic save button |

Each row has a **Save** button that calls `updateFormationElement(movementId, elementIndex, patch)`, which validates inputs, updates overrides tracking, recomputes WTC, and persists to storage. Inherited fields (falling back to the shared layer) are displayed in muted/italic style with placeholder text showing the shared-layer value.

Diverged rows (elements whose status or outcome differs from the first element) are highlighted with the `fmn-el-diverged` row class.

---

## 6. Wake Turbulence Category (WTC) in Formations

### 6a. Per-element WTC

Every element carries its own `wtc` field. This reflects the WTC of that specific aircraft
type under the configured WTC scheme (ICAO, UK, RECAT — set in facility Admin).

### 6b. Formation-level WTC fields

The master strip's `formation` object stores two derived WTC values:

| Field | Derivation rule |
|---|---|
| `wtcCurrent` | Highest WTC among all elements whose `status` is `PLANNED` or `ACTIVE` |
| `wtcMax` | Highest WTC among **all** elements regardless of status |

These two values allow controllers to know:

- **Current WTC**: the separation category applicable _right now_ while the formation
  is still active or being planned — accounts only for aircraft still airborne or pending.
- **Max WTC**: the heaviest category that has been (or ever will be) in this formation —
  useful for wake-turbulence planning on the inbound/outbound stream.

### 6c. Example: WTC changing as elements land

Using the MEMORIAL formation:

| Event | wtcCurrent | wtcMax |
|---|---|---|
| All three airborne (SPIT L, HURI L, LANC M) | **M** | **M** |
| LANC lands → MEMORIAL 3 set to COMPLETED | **L** (only SPIT and HURI remain) | **M** (max is preserved) |
| SPIT also lands → MEMORIAL 1 COMPLETED | **L** (HURI still active) | **M** |
| All landed | *(no PLANNED/ACTIVE elements)* | **M** |

### 6d. WTC ordering

WTC values are compared by severity for MAX logic. Under ICAO:

```
L < S < M < H < J   (ascending weight/severity)
```

Under UK/RECAT schemes the ordering may differ; the facility configuration
(`primary_wtc_scheme`) determines which scheme is applied.

---

## 7. Master / Element Inheritance Model (Implemented Baseline)

### 7a. Implemented: shared defaults layer

The implemented model uses a `formation.shared` layer as the source of inherited defaults (FR-05 / FR-07 / FR-08 / FR-09). This is different from — and simpler than — the earlier roadmap description of per-field inheritance tracking on elements.

When a formation is created, `formation.shared` is populated from the master movement's fields (master-first seeding, FR-07). On every app load, `normalizeFormation()` re-derives the shared layer from the element data if needed (element-first synthesis, FR-08), ensuring forward-compatibility and migration of older formations.

Elements **display** shared-layer values as muted/placeholder fallbacks when their own field is empty (`""`). No automatic copying from the shared layer into element storage occurs on save.

### 7b. Implemented: overrides tracking

When an element field is edited and diverges from the shared-layer value, it is recorded in `element.overrides`:

```json
{
  "overrides": {
    "depAd": "EGCC",
    "tngCount": 1
  }
}
```

This tracks which fields are element-specific overrides vs. falling back to the shared layer. The `overrides` dict is updated atomically by `updateFormationElement()` on every save.

### 7c. What is NOT implemented (backlog)

The following inheritance behaviors are **deferred** and not in the current codebase:

- **Master → element propagation on master edit**: editing a field on the master strip does not automatically push that value to elements that have not individually overridden it. This was described in earlier notes but is not implemented.
- **Break-inheritance on individual edit via UI**: the `overrides` dict is maintained by the data layer, but there is no UI mechanism that explicitly "breaks" inheritance and tracks it as a distinct user action.
- **`formation_groups` table and `is_formation_master` / `element_index` fields**: the earlier roadmap's relational data model is deferred. The current model stores everything on the master movement record.

### 7d. Deferred data model (backlog reference)

Earlier roadmap notes described a `formation_groups` table:

```
formation_groups
  id              – unique group identifier
  dof             – date of flight (YYYY-MM-DD)
  base_callsign   – the lead callsign
  notes           – free text

movements (extended)
  formation_group_id   – links element back to its formation_groups record
  is_formation_master  – true for the master, false for elements
  element_index        – 1, 2, 3 … for elements; null for the master
```

This schema is not implemented. It remains a possible future direction if the data model is significantly redesigned.

---

## 8. Element Status and its Effect on Counting

Element statuses mirror the top-level movement statuses and follow the same lifecycle:

```
PLANNED ──→ ACTIVE ──→ COMPLETED
   │           │
   │           └──→ CANCELLED
   └──→ CANCELLED
```

- **PLANNED**: Element is scheduled but has not yet departed/arrived.
- **ACTIVE**: Element is in flight. Counted in `wtcCurrent` computation.
- **COMPLETED**: Element has landed. Removed from `wtcCurrent`; still included in
  `wtcMax`.
- **CANCELLED**: Element was removed from the formation (e.g., aircraft u/s). Excluded
  from both `wtcCurrent` and `wtcMax` for future computations.

Individual element statuses feed back into the master strip's overall status in the
full master/element implementation — e.g., the master strip transitions to COMPLETED
only once all elements are COMPLETED or CANCELLED.

---

## 9. Formation Callsign Naming Convention

Element callsigns are built from the master callsign plus a space and an ordinal
(1-based):

```
BASE_CALLSIGN + " " + element_index
```

Examples:

| Master | Element 1 | Element 2 | Element 3 |
|---|---|---|---|
| `CNNCT` | `CNNCT 1` | `CNNCT 2` | `CNNCT 3` |
| `MEMORIAL` | `MEMORIAL 1` | `MEMORIAL 2` | `MEMORIAL 3` |
| `RED ARROWS` | `RED ARROWS 1` | `RED ARROWS 2` | … |

This naming mirrors ATC practice where formation elements are called using the lead
callsign followed by their position number.

---

## 10. Formation and the Movement Counters (Implemented Baseline)

### 10a. Per-element nominal counting (Monthly Return)

`getResolvedFormationMovements(m)` sums per-element nominal movement contributions for Monthly Return / Dashboard reporting:

```
per element: base(flightType) + 2×tngCount + osCount
```

Each element's `tngCount` and `osCount` are resolved against the shared layer: element override if set in `element.overrides`, otherwise shared-layer value. Total across all elements is the formation's nominal movement contribution.

### 10b. Per-element EGOW event counting (Live Board daily stats)

`egowRunwayContribution(m)` sums per-element actual EGOW events for the Live Board daily totals:

- For each element: uses element-level `depActual` / `arrActual` if present; falls back to master-level actual times
- DEP element contribution: 1 if `depActual` exists, else 0
- ARR element contribution: 1 if `arrActual` exists, else 0
- LOC element contribution: `(depActual ? 1 : 0) + 2×tngCount + osCount + (arrActual ? 1 : 0)`
- OVR: 0 always

This replaces any earlier model where formations contributed only as a single lead-aircraft unit.

### 10c. Per-element T&G, O/S, FIS

Each element can carry its own `tngCount`, `osCount`, and `fisCount`. These are inline-editable in the element table. Values not overridden at the element level fall back to the shared-layer defaults for display and counting purposes.

---

## 11. How the System Functions — End-to-End Flow

```
1. Strip Created
   Controller creates a master movement (DEP, ARR, LOC, or OVR).
   formation.label, formation.shared, and formation.elements[] are populated.
   Shared-layer defaults are seeded from the master movement fields.
   Each element is assigned a callsign (BASE + space + ordinal).
   normalizeFormation() derives ordinals, shared layer, and wtcCurrent/wtcMax.

2. Strip Activated (PLANNED → ACTIVE)
   The master strip moves to ACTIVE status.
   No automatic cascade to elements on activation.
   Individual elements transition to ACTIVE as each aircraft departs.
   depActual is recorded on each element via the inline element table.
   wtcCurrent is recomputed after each element change.

3. Live Board Display
   The master strip appears on the board.
   The F×n badge indicates the element count.
   Expanding the strip row shows the full formation panel:
     - Summary (label, status, wtcCurrent, wtcMax, total movements)
     - Shared defaults section
     - Inline-editable element table
   wtcCurrent shows the highest WTC of elements still PLANNED or ACTIVE.
   A DIVERGED badge appears if elements have different statuses.

4. Elements Land Individually / Diverge
   As each element aircraft lands:
     arrActual is set on that element in the element table.
     element.status → COMPLETED (via inline Save).
     wtcCurrent is recomputed; wtcMax is preserved.
   If an element diverts:
     outcomeStatus set to DIVERTED.
     actualDestinationAd, outcomeTime, outcomeReason set as appropriate.
     Element row is highlighted in the panel.

5. Master Strip Completed
   Master status → COMPLETED cascades all PLANNED/ACTIVE elements to COMPLETED.
   CANCELLED elements are preserved (not forced to COMPLETED).
   The strip moves off the Live Board and into History.
   wtcMax is preserved as a permanent record of the heaviest type in the formation.

6. Historical Record
   The completed master strip, with its full formation object intact,
   appears in Movement History.
   All element callsigns, registrations, types, WTC, actual times,
   outcome detail, and attribution identity remain queryable.
   Reporting credits each element to its resolved attribution callsign and pilot.
```

---

## 11b. Element Divergence and Diversion Outcome Detail (FR-13 / FR-13b)

### Divergence detection

Elements hold statuses independently. The formation panel renders a **DIVERGED** badge when elements are not all in the same status, accompanied by a per-status count breakdown (e.g. "2 COMPLETED, 1 ACTIVE").

`derivedFormationStatus(elements)` computes a conservative summary status: ACTIVE > PLANNED > COMPLETED > CANCELLED. Mixed terminal states (some COMPLETED + some CANCELLED) resolve to COMPLETED.

Diverged element rows are highlighted with the `fmn-el-diverged` row class in the element table.

### Per-element diversion / outcome detail

Each element records the outcome of its individual sortie:

| Field | Values | Meaning |
|---|---|---|
| `outcomeStatus` | `NORMAL` / `DIVERTED` / `CHANGED` / `CANCELLED` | Nature of outcome |
| `actualDestinationAd` | ICAO code | Where the element actually went |
| `actualDestinationText` | free text | Description of actual destination |
| `outcomeTime` | HH:MM UTC | Time of outcome event |
| `outcomeReason` | free text | Explanation |

All fields are inline-editable in the element table and stored per-element independently.

---

## 11c. Attribution Identity and Pilot Resolution (FR-14 / FR-14b)

### Per-element identity fields

Each element carries:

- `underlyingCallsign` — explicit non-display attribution identity (e.g. the real callsign when the formation callsign is a display alias)
- `pilotName` — element-level pilot / captain name

These are distinct from the visible `element.callsign` and from the master strip's `captain` field.

### VKB-aware identity resolution

`resolveFormationElementIdentity(el, m)` returns `{ attributionCallsign, pilot, callsignSource, pilotSource }` using a priority chain:

**Attribution callsign priority:**
1. Explicit `el.underlyingCallsign` (manual override) → source: `"manual"`
2. VKB fixed callsign lookup by `el.reg` → source: `"registration"`
3. Check if `el.callsign` is itself a known fixed callsign → source: `"fixed-callsign"`
4. Fall back to `el.callsign` → source: `"element-callsign"`
5. Fall back to master `m.callsignCode` → source: `"fallback"`

**Pilot priority:**
1. Explicit `el.pilotName` → source: `"manual"`
2. EGOW codes lookup by resolved attribution callsign → source: `"egow-attribution"`
3. EGOW codes lookup by visible element callsign → source: `"egow-element"`
4. Master captain fallback → source: `"master-captain"`

VKB lookups degrade gracefully (returns null/empty if VKB data is not loaded).

### Reporting integration

When a formation has element identity data, `reporting.js` expands the formation into per-element contributions. Each element is credited to its resolved `attributionCallsign` and `pilot` rather than the master callsign and captain. This prevents all formation movements from being attributed to the lead only.

---

## 12. Source Code Reference

| Concern | File | Notes |
|---|---|---|
| Formation data model, demo data, normalization | `src/js/datamodel.js` | `normalizeFormation()`, `updateFormationElement()`, `computeFormationWTC()`, `cascadeFormationStatus()` |
| Movement counting (nominal) | `src/js/datamodel.js` | `getResolvedFormationMovements()`, `runwayMovementContribution()` |
| EGOW event counting (per-element actual) | `src/js/datamodel.js` | `egowRunwayContribution()`, `_formationEgowContribution()` |
| Identity resolution (VKB-aware) | `src/js/datamodel.js` | `resolveFormationElementIdentity()`, `getElementAttributionIdentity()`, `getResolvedElementPilot()` |
| Formation badge rendering | `src/js/ui_liveboard.js` | `renderBadges()` |
| Formation details panel rendering | `src/js/ui_liveboard.js` | `renderFormationDetails()`, `resolveElementForDisplay()` |
| Element inline save handler | `src/js/ui_liveboard.js` | `.fmn-el-save` button handler |
| Reporting attribution (per-element expansion) | `src/js/reporting.js` | Formation element expansion block |
| Strip lifecycle (applies to elements) | `docs/STRIP_LIFECYCLE_AND_COUNTERS.md` | §1–§2 |

---

## 13. Implementation Status

### Completed (implemented)

| Feature | FR ticket |
|---|---|
| Formation data structure (`label`, `wtcCurrent`, `wtcMax`, `shared`, `elements[]`) | FR-05 |
| Shared/default layer (`formation.shared`) and master-first seeding | FR-05 / FR-07 |
| Element-first synthesis / load-time normalization (`normalizeFormation()`) | FR-08 |
| Field-level inheritance tracking (`element.overrides` dict) | FR-09 |
| Activation UX | FR-02 |
| Draft memory / in-session persistence | FR-03 |
| Callsign generation (base + ordinal convention) | FR-04 |
| Enrichment | FR-06 |
| Formation badge on Live Board (`F×n`) | FR-12 |
| Formation expanded details panel (full rebuild) | FR-12 |
| Element table — fully inline-editable, row-level Save | FR-12 |
| Per-element movement counting (nominal and EGOW event) | FR-10 |
| Dynamic recomputation of `wtcCurrent` / `wtcMax` on every element change | FR-11 |
| Element status independence; divergence badge and row highlighting | FR-13 |
| Per-element diversion / outcome detail fields | FR-13b |
| Per-element attribution identity (`underlyingCallsign`, `pilotName`) | FR-14 |
| VKB-aware identity resolution (`resolveFormationElementIdentity()`) | FR-14b |
| Reporting per-element expansion (credits to resolved identity, not master only) | FR-14 / FR-14b |
| Demo formations (CNNCT, MEMORIAL) | — |
| Master status cascade (COMPLETED / CANCELLED) | — |
| Documentation closeout (this document) | FR-15 |

### Backlog (not yet implemented)

| Feature | Notes |
|---|---|
| Formation creation via "Number of aircraft" count field in New Flight modal | Auto-generation of element set with callsigns — deferred |
| Automatic master → element field propagation on master edit | Break-inheritance semantics — deferred |
| `formation_groups` table, `is_formation_master`, `element_index` fields | Deferred relational data model — not blocking current use |
| Multiple WTC scheme support per formation (UK dep/arr vs RECAT) | Deferred |
| Deeper pilot / aircraft profile architecture | V2 direction |
| Broader historical formation attribution analytics in reporting | Deferred |

---

*Document version: 2.0 — 2026-04-26*  
*Supersedes v1.0 (2026-02-10). Updated to reflect implemented baseline after FR-02 through FR-15.*

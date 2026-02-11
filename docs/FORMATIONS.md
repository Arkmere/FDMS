# Formations in Vectair FDMS

> Canonical reference for how formation flights are represented, entered, displayed,
> and managed within the Vectair Flight Data Management System.

---

## Formations v1.1 — Clarifications and Extensions

This section defines v1.1 behavior for formation elements, validation, and inheritance.

### Formation storage
Formations are stored only on the master movement:

`movement.formation = { label, wtcCurrent, wtcMax, elements[] }`

### Element schema (v1.1)
Each element is stored as:

- `callsign` (string) — editable in authoring UI (defaults auto-generated)
- `reg` (string)
- `type` (string)
- `wtc` (string) — one of `{L,S,M,H,J}`
- `status` (string) — one of `{PLANNED,ACTIVE,COMPLETED,CANCELLED}`
- `depAd` (string) — element departure aerodrome ICAO; `""` means unset
- `arrAd` (string) — element arrival aerodrome ICAO; `""` means unset
- `depActual` (string) — actual departure time (HH:MM or empty)
- `arrActual` (string) — actual arrival time (HH:MM or empty)

Element `depAd/arrAd` may differ from the master movement's dep/arr.

### Empty depAd/arrAd fallback (display behavior)
If `element.depAd == ""`, the UI displays the master movement `depAd` as a muted fallback (display-only). The stored element value remains `""`. Same rule for `arrAd`.

No automatic copying from the master movement into element `depAd/arrAd` occurs.

### Validation (hard requirements)
- `wtc` must be one of `{L,S,M,H,J}` (uppercase-coerced). Invalid values are rejected.
- `depAd/arrAd` must be `""` or match `^[A-Z0-9]{4}$` (uppercase-coerced). Invalid values are rejected.
- `status` must be one of `{PLANNED,ACTIVE,COMPLETED,CANCELLED}`.

### Element count
A formation exists only when `elements.length >= 2`.
Authoring UI clamps formation count to `min=2`, `max=12`.
If count < 2, `movement.formation` is treated as null (no formation).

### WTC semantics
- `wtcCurrent` = max WTC across elements whose status is `PLANNED` or `ACTIVE`.
- `wtcMax` = max WTC across all elements regardless of status.

### Master status cascade rules
- When the master movement becomes `COMPLETED`, all formation elements in `{PLANNED,ACTIVE}` are set to `COMPLETED`.
- When the master movement becomes `CANCELLED`, all formation elements are set to `CANCELLED`.
- No cascade occurs on master activation (PLANNED→ACTIVE).

### Produce-arrival / produce-departure inheritance
When producing the opposite leg from a formation-bearing movement:
- The produced movement inherits the formation structure including identity fields and `depAd/arrAd`.
- The produced movement resets element operational state:
  - `status = PLANNED`
  - `depActual = ""`
  - `arrActual = ""`

### Out of scope (explicit)
- Booking objects and booking sync are formation-agnostic in v1.1.
- Element-level "micro-strip" operational fields (pob, tng/os/fis counts, remarks/warnings, ATC details) are not implemented in v1.1.
- Future element-level counters, if added, must be informational-only and must not aggregate into master strip counters or daily stats.

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

## 2. The Two Formation Modes

### 2a. Single-Strip Formation (`formation_size` only)

The simplest approach. One movement row is created with a `formation_size` count greater
than 1. All movement counters (arrivals, departures, locals) are multiplied by that size.
No individual element records exist.

- Used for: straightforward administrative scenarios where no per-aircraft distinction
  is needed.
- Limitation: no per-element registration, type, WTC, or individual time recording.

### 2b. Master + Element Strips (the preferred Woodvale model)

A richer approach. One **master** movement represents the formation as a whole (the lead
callsign, e.g., `CNNCT`). Each **element** aircraft is represented inside the master
strip's `formation.elements` array, with its own registration, type, WTC, status, and
individual departure/arrival times.

- Used for: display flights, multi-ship training sorties, mixed-type formations where
  individual accounting is required.
- Supports mixed-WTC formations (e.g., MEMORIAL: Spitfire L, Hurricane L, Lancaster M).

> The remainder of this document focuses on the **master + element** model, as this is
> what is implemented in the current live board.

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

**Element table (one row per element):**

| Column | Source field |
|---|---|
| Element | `element.callsign` |
| Reg | `element.reg` (or `—`) |
| Type | `element.type` (or `—`) |
| WTC | `element.wtc` (or `—`) |
| Status | `element.status` (human-readable label) |
| Dep | `element.depActual` (or `—`) |
| Arr | `element.arrActual` (or `—`) |

The table is read-only in the current implementation; individual element fields are not
yet inline-editable.

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

## 7. Master / Element Inheritance Model (Planned Behaviour)

> The inheritance logic described in this section is the **target design** as specified
> in `Project Overview.md` and `roadmap.md`. It is not yet fully implemented in code;
> the current system stores element data but does not propagate master-level edits.

### 7a. Inheritance principle

When a formation is first created, elements **inherit** key fields from the master strip:

- Planned departure and arrival times
- T&G count
- O/S flag
- FIS flag
- Rules (VFR/IFR)

### 7b. Breaking inheritance

Editing a field **on an individual element** breaks inheritance for that field on that
element only. The element's value then diverges from the master and will not be
overwritten by subsequent master edits.

All other fields on that element that have not been individually edited continue to track
the master.

### 7c. Practical example

1. CNNCT is created. All three elements inherit DEP time `13:15`.
2. CNNCT 2 needs to depart early — its DEP time is set to `13:10`.
   - CNNCT 2 now has an independent DEP time.
3. CNNCT master DEP time is revised to `13:20`.
   - CNNCT 1 and CNNCT 3 update to `13:20`.
   - CNNCT 2 remains at `13:10` (inheritance was broken).

### 7d. Future data model fields (roadmap)

To support full master/element inheritance, the roadmap describes a `formation_groups`
table and additional fields on movement records:

```
formation_groups
  id              – unique group identifier
  dof             – date of flight (YYYY-MM-DD)
  base_callsign   – the lead callsign (e.g., "CNNCT")
  notes           – free text

movements (extended)
  formation_group_id   – links element back to its formation_groups record
  is_formation_master  – true for the CNNCT master, false for CNNCT 1/2/3
  element_index        – 1, 2, 3 … for elements; null for the master
```

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

## 10. Formation and the Movement Counters

### 10a. Master-level counting

Movement totals (arrivals, departures, locals, OVR) are attributed to the master strip
in the same way as a non-formation movement. The master strip counts as **one** traffic
unit for the top-level EGOW counters.

### 10b. Per-element counting (single-strip mode)

In `formation_size`-only mode (§2a), counters are multiplied:

```
total movements contributed = formation_size × 1
```

### 10c. Per-element counting (master + element mode)

In the master + element model, each element strip can carry its own:

- T&G count (`tngCount`)
- O/S count (`osCount`)
- FIS count (`fisCount`)
- EGOW code and classification

This gives full per-aircraft accountability for training formations where different
elements may fly different numbers of circuits.

---

## 11. How the System Functions — End-to-End Flow

```
1. Strip Created
   Controller creates a new movement (DEP, ARR, LOC, or OVR).
   If the flight involves multiple aircraft, formation fields are populated:
     - formation.label set
     - formation.elements array built with one entry per aircraft

2. Strip Activated (PLANNED → ACTIVE)
   The master strip moves to ACTIVE status.
   Individual elements are also set ACTIVE as each aircraft departs (or as a group).
   depActual is recorded on each element.

3. Live Board Display
   The master strip appears on the board.
   The F×n badge indicates the element count.
   Expanding the strip row shows the full formation panel (§5b).
   wtcCurrent shows the highest WTC of elements still PLANNED or ACTIVE.

4. Elements Land Individually
   As each element aircraft lands:
     arrActual is set on that element.
     element.status → COMPLETED.
     wtcCurrent is recomputed (heaviest remaining active element).
     wtcMax is unchanged.

5. Master Strip Completed
   Once all elements are COMPLETED (or CANCELLED), the master strip is completed.
   The strip moves off the Live Board and into History.
   wtcMax is preserved as a permanent record of the heaviest type in the formation.

6. Historical Record
   The completed master strip, with its full formation object intact,
   appears in the History tab.
   All element callsigns, registrations, types, WTC, and times remain queryable.
```

---

## 12. Source Code Reference

| Concern | File | Location |
|---|---|---|
| Formation data model & demo data | `src/js/datamodel.js` | Lines 157–190 (CNNCT), 256–289 (MEMORIAL) |
| Formation badge rendering | `src/js/ui_liveboard.js` | `renderBadges()` |
| Formation details panel rendering | `src/js/ui_liveboard.js` | `renderFormationDetails()` |
| Formation design specification | `Project Overview.md` | §Formation section |
| Formation roadmap / future model | `roadmap.md` | Master+element model section |
| Strip lifecycle (applies to elements) | `docs/STRIP_LIFECYCLE_AND_COUNTERS.md` | §1–§2 |

---

## 13. Implementation Status

| Feature | Status |
|---|---|
| Formation data structure (`label`, `wtcCurrent`, `wtcMax`, `elements[]`) | Implemented |
| Formation badge on Live Board (`F×n`) | Implemented |
| Formation expanded details panel | Implemented |
| Element table (callsign, reg, type, WTC, status, times) | Implemented |
| Demo formations (CNNCT, MEMORIAL) | Implemented |
| Formation creation via "Number of aircraft" field in New Flight modal | Not yet implemented |
| Automatic element callsign generation | Not yet implemented |
| Master → element field inheritance and propagation | Not yet implemented |
| Break-inheritance on individual element edit | Not yet implemented |
| Dynamic recomputation of `wtcCurrent` on element status change | Not yet implemented |
| `formation_groups` table and `is_formation_master` / `element_index` fields | Not yet implemented |
| Inline editing of individual element fields | Not yet implemented |
| Multiple WTC scheme support per formation (UK dep/arr, RECAT) | Not yet implemented |

---

*Document version: 1.0 — 2026-02-10*

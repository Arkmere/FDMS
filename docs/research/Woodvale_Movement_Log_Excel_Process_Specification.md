Purpose

The workbook is a structured “movement log → daily totals → monthly return” system. Its primary output is the Monthly Report tab, which is the management-facing summary. Excel is used as a deterministic rules engine: raw entries are normalised via lookups and helper columns, then aggregated via SUMIF/SUMIFS-style totals.

1) Data collected per movement (raw input)

Each movement is entered as a single row on a daily sheet (e.g., “1ST”, “2ND”, …). The core data captured per row is:

A) Identity and aircraft details

Callsign / tactical contraction (free text)

Registration (free text)

(Often also) aircraft type or other descriptive fields, but the key identifiers for Excel logic are callsign and registration.

B) Flight classification and counters

Flight Type: one of:

DEP (Departure)

ARR (Arrival)

LOC (Local sortie)

OVR (Overflight)

T&G count (touch-and-goes, integer)

O/S count (overshoots, integer)

FIS count (Flight Information Service interactions, integer)

C) Operational time (separate, not per movement)

ATC Hours Open is recorded per day on the Monthly Report (manually entered), not derived from movement rows.

2) Reference data used (lookups)

The workbook contains (or references) two key “database” tables used to normalise entries:

A) Registration Database → EGOW classification

Using the Registration entered on the row, Excel looks up an EGOW code (a category label used for reporting). This is stored on the daily sheet as a derived value (the “EGOW code” column).

Common EGOW codes used by the Monthly Report logic include:

BM Based Military

BC Based Civil

VM Visiting Military (fixed-wing)

VMH Visiting Military Helicopter

VNH Visiting Navy Helicopter

VC Visiting Civil (fixed-wing)

VCH Visiting Civil Helicopter

"" (blank / unknown) — Excel treats this as part of the civil visiting fixed-wing group in some totals.

B) Callsign Database → Unit code (for based military)

Using the Callsign entered on the row, Excel looks up a Unit Code for based military flying:

M = MASUAS

L = LUAS

A = AEF

This Unit Code is written into a derived column on the daily sheet and is used to split BM totals into MASUAS/LUAS/AEF.

3) Helper calculations on each daily sheet (the “engine room”)

Excel does not simply count rows. It computes movement units using runway-occupancy logic. Two helper columns are created per row:

A) Base movement value (“Movement Number”)

Excel assigns a base movement value from the Flight Type:

LOC → 2
(represents a departure and an arrival)

DEP → 1

ARR → 1

OVR → 0
(overflight is not a runway movement)

This reflects runway movement logic: the runway is occupied for arrivals and departures; a basic local sortie consumes one departure and one arrival.

B) T&G movement value (“T&G Duplication”)

Excel converts touch-and-go counts into runway movements:

T&G Duplication = (T&G count) × 2

Because each touch-and-go represents:

one arrival movement + one departure movement

C) Total runway movement contribution per row (“movement units”)

For all runway-movement reporting columns, the row contributes:

movement_units = base movement value + (T&G count × 2)

D) Overshoots and FIS are not folded into movement_units

Overshoots and FIS are handled separately:

Overshoots (O/S) are summed as event counts:

Each overshoot adds +1 to overshoot totals (it occupies the runway but is not a touchdown).

FIS is summed as event counts:

Each increment indicates one service provision instance (an aircraft may have multiple FIS events on one strip if it leaves and returns).

4) How daily sheets feed the Monthly Report tab

The Monthly Report tab is effectively a fixed layout pivot table:

Rows represent day-of-month (1–31) plus a TOTAL row.

Each day row pulls totals from that day’s sheet using SUMIF/SUMIFS rules over the derived columns:

EGOW Code (from registration lookup)

Unit Code (from callsign lookup)

movement_units (base + T&G×2)

osCount

fisCount

5) What is displayed in the final Monthly Report output
Layout

The Monthly Report displays daily totals for each category, then a monthly TOTAL.

Column definitions and formulas (conceptual)
A) Based Military runway movements

These are runway movement units for movements classed as BM and split by unit code.

MASUAS: sum of movement_units where Unit Code = M

LUAS: sum of movement_units where Unit Code = L

AEF: sum of movement_units where Unit Code = A

(These totals incorporate the LOC base logic and T&G×2 logic automatically via movement_units.)

B) Overshoots by based unit

These are overshoot event totals, not movement_units.

O/S MASUAS: sum of O/S count where Unit Code = M

O/S LUAS: sum of O/S count where Unit Code = L

O/S AEF: sum of O/S count where Unit Code = A

C) Visiting Military totals

These are runway movement units for visiting military categories.

VIS MIL: sum of movement_units where EGOW Code is one of:

VM, VMH, VNH

TOTAL MIL: sum of:

Based military totals (MASUAS + LUAS + AEF)

plus visiting military total (VIS MIL)

(Excel additionally keeps overshoots as separate columns; TOTAL MIL is a combined headline figure as defined by the workbook.)

D) Visiting Civil fixed-wing totals

These are runway movement units for civil fixed-wing buckets.

VIS CIV F/W: sum of movement_units where EGOW Code is:

VC and (in this workbook’s logic) EGOW Code blank ""

OW F/W: sum of movement_units where EGOW Code is:

BC

TOTAL CIV F/W: VIS CIV F/W + OW F/W

E) Helicopter breakdown

These are runway movement units for helicopter categories.

NVY HEL: sum of movement_units where EGOW Code = VNH

CIV HEL: sum of movement_units where EGOW Code = VCH

MIL HEL: sum of movement_units where EGOW Code = VMH

F) Flight Information Service totals

These are FIS event totals, not movement_units.

MIL FIS: sum of FIS count where EGOW Code is one of:

BM, VM, VMH, VNH

CIV FIS: sum of FIS count where EGOW Code is one of:

BC, VC, VCH, and blank ""

This matches the operational meaning: service provision events are tracked independently of runway movements. Overflights automatically tend to have at least 1 FIS, but arrivals/departures/locals may have 0 or more depending on what service was actually provided.

G) Hours

HOURS: manually entered “ATC open hours” per day.

Monthly TOTAL is the sum of daily hours.

6) Operational meaning (why the logic is structured this way)
Runway movements

The workbook is ultimately tracking runway occupancy events:

Arrivals and departures are the fundamental runway movements (each = 1).

A local sortie inherently includes at least a departure and an arrival (base = 2).

Each touch-and-go adds two runway movements (arrival + departure).

An overshoot adds one runway-occupancy movement (no touchdown, but runway blocked during the manoeuvre).

So in practice:

LOC baseline: 2

LOC with 1× O/S then land: 3 (dep + overshoot + final arrival)

LOC with 1× T&G then land: 4 (dep + T&G arr/dep + final arrival)

FIS as “service events”

FIS counts measure workload that is not strictly tied to runway use. An overflight is inherently a service-provision interaction (hence typically FIS≥1), and some aircraft may re-contact later, increasing the count without creating new runway movements.

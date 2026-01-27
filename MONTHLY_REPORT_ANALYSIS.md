# Monthly Report Analysis: Excel Reference vs FDMS Implementation

## Executive Summary

The reference Excel file (Woodvale Stats AUG.xlsx) uses a **weighted counting system** where movements are counted based on their flight type and T&G activity. FDMS currently uses a **simple +1 per movement** system. This document details the differences and required changes.

---

## Excel Reference Implementation

### Data Flow

1. **Daily Movement Sheets** (1ST, 2ND, ..., 31ST)
   - Each row represents a movement
   - Columns S, T, U are calculated for each movement:
     - **Column S (Unit Code)**: VLOOKUP from Callsign Database
     - **Column T (Movement Number)**: Calculated based on flight type
       - Local (LOC): 2
       - Departure (DEP) or Arrival (ARR): 1
       - Overflight (OVR): 0
     - **Column U (T&G Duplication)**: T&G count × 2

2. **Monthly Report Sheet**
   - Aggregates from all daily sheets using SUMIF formulas
   - **Key Formula Pattern**: `SUMIF(criteria, Column T) + SUMIF(criteria, Column U)`
   - Example for MASUAS on Day 1:
     ```excel
     =SUMIF('1ST'!S:S,"M",'1ST'!T:T) + SUMIF('1ST'!S:S,"M",'1ST'!U:U)
     ```

### Movement Counting Logic

**Formula**: `Total Count = Movement Number + T&G Duplication + O/S Count`

- **Movement Number:** LOC=2, DEP/ARR=1, OVR=0
- **T&G Duplication:** T&G Count × 2 (each T&G = 2 runway occupancies)
- **O/S Count:** O/S × 1 (each overshoot = 1 runway occupancy, no touchdown)

**Examples**:
- Local flight with 0 T&G, 0 O/S: 2 + 0 + 0 = **2 movements**
- Local flight with 1 T&G, 0 O/S: 2 + 2 + 0 = **4 movements**
- Local flight with 2 T&G, 1 O/S: 2 + 4 + 1 = **7 movements**
- DEP flight with 0 T&G, 0 O/S: 1 + 0 + 0 = **1 movement**
- DEP flight with 2 T&G, 0 O/S: 1 + 4 + 0 = **5 movements**
- Overflight: 0 + 0 + 0 = **0 movements** (not counted in monthly stats)

### Column Calculations

| Column | Excel Formula | Meaning |
|--------|--------------|---------|
| MASUAS | `SUMIF(UnitCode='M', T) + SUMIF(UnitCode='M', U)` | Based Military (MASUAS) movements + T&G duplications |
| LUAS | `SUMIF(UnitCode='L', T) + SUMIF(UnitCode='L', U)` | Based Military (LUAS) movements + T&G duplications |
| AEF | `SUMIF(UnitCode='A', T) + SUMIF(UnitCode='A', U)` | Based Military (AEF) movements + T&G duplications |
| O/S MASUAS | `SUMIFS(O/S, UnitCode='M')` | O/S events for MASUAS (sum of osCount) |
| VIS MIL | `SUMIF(EGOWCode IN ['VM','VMH','VNH'], T) + SUMIF(same, U)` | Visiting Military movements + T&G |
| VIS CIV F/W | `SUMIF(EGOWCode IN ['VC',''], T) + SUMIF(same, U)` | Visiting Civil Fixed Wing + T&G |
| MIL FIS | `SUMIF(EGOWCode IN ['BM','VM','VNH','VMH'], FIS)` | Military FIS events (sum of fisCount) |

---

## FDMS Current Implementation

### Movement Counting Logic

**Formula**: `Count = +1 per movement` (regardless of flight type)

**Current Code** (src/js/reporting.js:199-210):
```javascript
// Based Military counts
if (classification.isMASUAS) row.MASUAS++;
if (classification.isLUAS) row.LUAS++;
if (classification.isAEF) row.AEF++;

// Visiting Military
if (classification.isVisitingMil) row.VIS_MIL++;
```

### Issues

1. **No differentiation** between local, DEP/ARR, and overflight movements
2. **T&G movements not weighted** - a movement with 10 T&Gs counts the same as one with 0 T&Gs
3. **No flight type classification** stored in movement data (loc/DEP/ARR/ovr)
4. **Unit Code not populated** from callsign database lookups

---

## Required Changes

### 1. Add Flight Type Classification

**Location**: Movement data model

Add a `flightType` field that categorizes movements as:
- `LOC` - Local (departure and arrival at EGOW)
- `DEP` - Departure only
- `ARR` - Arrival only
- `OVR` - Overflight

**Detection Logic** (from Excel reference):
- If callsign contains "UAM": `LOC`
- If depAd = EGOW and arrAd ≠ EGOW: `DEP`
- If depAd ≠ EGOW and arrAd = EGOW: `ARR`
- If depAd ≠ EGOW and arrAd ≠ EGOW: `OVR`

### 2. Implement Movement Number Calculation

**Location**: src/js/reporting.js - new helper function

```javascript
function getMovementNumber(movement) {
  const flightType = movement.flightType?.toUpperCase() || '';
  if (flightType === 'LOC') return 2;
  if (flightType === 'DEP' || flightType === 'ARR') return 1;
  if (flightType === 'OVR') return 0;
  return 1; // default fallback
}
```

### 3. Implement T&G Duplication Calculation

**Location**: src/js/reporting.js - new helper function

```javascript
function getTngDuplication(movement) {
  const tngCount = movement.tngCount || 0;
  return tngCount * 2;
}
```

### 4. Update Monthly Return Computation

**Location**: src/js/reporting.js:189-231

**Current**:
```javascript
if (classification.isMASUAS) row.MASUAS++;
```

**Should be**:
```javascript
const movementNumber = getMovementNumber(m);
const tngDuplication = getTngDuplication(m);
const totalCount = movementNumber + tngDuplication;

if (classification.isMASUAS) row.MASUAS += totalCount;
if (classification.isLUAS) row.LUAS += totalCount;
if (classification.isAEF) row.AEF += totalCount;
if (classification.isVisitingMil) row.VIS_MIL += totalCount;
if (classification.isVisitingCivFixedWing) row.VIS_CIV_FW += totalCount;
// etc. for all movement types
```

### 5. Add Export Columns

**Location**: src/js/reporting.js:636-664

Add to Movement Details export:
- Column S: Unit Code (already exists as m.unitCode)
- Column T: Movement Number (new calculated value)
- Column U: T&G Duplication (new calculated value)
- Column V: Total (T + U) - **THIS IS WHAT THE USER MEANT BY "Total = Column T + Column U"**

---

## Impact Analysis

### Data Accuracy

The current FDMS implementation **undercounts** movements compared to the Excel reference:

**Example Scenario**: 10 MASUAS local flights with 2 T&Gs each
- **Excel Count**: 10 × (2 + 4) = **60 movements**
- **FDMS Count**: 10 × 1 = **10 movements**
- **Difference**: 50 movements underreported (83% error)

### Migration Considerations

1. **Historical Data**: Existing monthly reports will show lower counts than Excel-based reports
2. **Validation**: After implementation, compare FDMS reports with Excel reports for the same month
3. **Testing**: Test with edge cases (overflights, high T&G counts, mixed flight types)

---

## Recommended Implementation Order

1. ✅ Add `flightType` detection logic to movement processing
2. ✅ Create helper functions: `getMovementNumber()` and `getTngDuplication()`
3. ✅ Update `computeMonthlyReturn()` to use weighted counting
4. ✅ Add columns T, U, V to Movement Details export
5. ✅ Test with August 2024 data against reference Excel file
6. ✅ Document the change in user-facing documentation

---

## Testing Plan

1. Import movements from reference Excel file (August)
2. Generate FDMS monthly report for August
3. Compare FDMS output with Excel "Monthly Report" sheet
4. Verify counts match for:
   - MASUAS, LUAS, AEF
   - VIS MIL, VIS CIV F/W
   - All helicopter categories
   - FIS counts
   - O/S counts

---

## Conclusion

The Excel reference uses a sophisticated weighted counting system where:
- **Movement type matters**: Local flights count as 2, departures/arrivals as 1, overflights as 0
- **T&G activity is doubled**: Each T&G adds 2 to the count (2 runway occupancies)
- **O/S (Overshoots) count as 1**: Each overshoot adds 1 to the count (runway occupancy without touchdown)
- **Total = Movement Number + T&G Duplication + O/S Count** - Complete weighted counting formula

FDMS implements this logic to accurately match the official reporting methodology.

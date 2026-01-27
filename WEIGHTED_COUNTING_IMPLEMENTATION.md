# Weighted Counting Implementation

## Overview

This document describes the implementation of the weighted counting system for the FDMS Reports page, following the Excel reference methodology documented in `MONTHLY_REPORT_ANALYSIS.md`.

## Changes Summary

### 1. Flight Type Detection (`detectFlightType()`)

**Location:** `src/js/reporting.js` (lines 147-173)

Automatically detects flight type based on:
- **Special case:** Callsigns containing "UAM" → `LOC`
- **LOC (Local):** `depAd = EGOW` AND `arrAd = EGOW`
- **DEP (Departure):** `depAd = EGOW` AND `arrAd ≠ EGOW`
- **ARR (Arrival):** `depAd ≠ EGOW` AND `arrAd = EGOW`
- **OVR (Overflight):** `depAd ≠ EGOW` AND `arrAd ≠ EGOW`

If `flightType` is already set on the movement, it uses that value.

### 2. Movement Number Calculation (`getMovementNumber()`)

**Location:** `src/js/reporting.js` (lines 184-193)

Returns the weighted count based on flight type:
- **LOC:** 2 movements
- **DEP:** 1 movement
- **ARR:** 1 movement
- **OVR:** 0 movements (not counted in stats)

### 3. T&G Duplication Calculation (`getTngDuplication()`)

**Location:** `src/js/reporting.js` (lines 201-204)

Calculates the T&G multiplier:
- **Formula:** `T&G Duplication = T&G Count × 2`
- Each touch-and-go adds 2 to the total movement count

### 4. Total Weighted Count (`getTotalWeightedCount()`)

**Location:** `src/js/reporting.js` (lines 212-214)

Calculates the complete weighted count:
- **Formula:** `Total Count = Movement Number + T&G Duplication`

### 5. Updated Monthly Return Computation

**Location:** `src/js/reporting.js` (lines 267-278)

The `computeMonthlyReturn()` function now:
1. Calculates weighted counts for each movement
2. Uses `totalCount` instead of simple `++` increment
3. Applies weighted counting to all movement categories:
   - Based Military (MASUAS, LUAS, AEF)
   - Visiting Military
   - Civil Fixed-Wing
   - Helicopters (Navy, Civil, Military)

**Example:**
```javascript
// OLD (simple counting):
if (classification.isMASUAS) row.MASUAS++;

// NEW (weighted counting):
const movementNumber = getMovementNumber(m);
const tngDuplication = getTngDuplication(m);
const totalCount = movementNumber + tngDuplication;
if (classification.isMASUAS) row.MASUAS += totalCount;
```

### 6. Enhanced CSV Export

**Location:** `src/js/reporting.js` (lines 656-688)

Added three new columns to `exportMovementsToCSV()`:
- **Movement Number:** Weighted count based on flight type (2, 1, or 0)
- **T&G Duplication:** T&G count × 2
- **Total Count:** Movement Number + T&G Duplication

### 7. Enhanced XLSX Export

**Location:** `src/js/reporting.js` (lines 791-826)

Added the same three columns to the "Movement Details" sheet in `exportMonthlyReturnToXLSX()`:
- Column T: Movement Number
- Column U: T&G Duplication
- Column V: Total Count

## Impact Examples

### Example 1: Local Flight with T&Gs
**Scenario:** 1 MASUAS local flight with 3 T&Gs

**Old Counting:**
- Count = 1 movement

**New Counting:**
- Movement Number = 2 (LOC)
- T&G Duplication = 3 × 2 = 6
- Total Count = 2 + 6 = **8 movements**

### Example 2: Departure with T&Gs
**Scenario:** 1 departure with 2 T&Gs

**Old Counting:**
- Count = 1 movement

**New Counting:**
- Movement Number = 1 (DEP)
- T&G Duplication = 2 × 2 = 4
- Total Count = 1 + 4 = **5 movements**

### Example 3: Overflight
**Scenario:** 1 overflight (no T&Gs)

**Old Counting:**
- Count = 1 movement

**New Counting:**
- Movement Number = 0 (OVR)
- T&G Duplication = 0 × 2 = 0
- Total Count = 0 + 0 = **0 movements** (correctly excluded from stats)

## Data Accuracy Improvement

The weighted counting system now matches the official Excel reference methodology:

**Previous Issue:** A day with 10 MASUAS local flights (2 T&Gs each) would show:
- FDMS: 10 movements
- Excel: 60 movements
- **Error: 83% undercount**

**After Implementation:** Both systems now report **60 movements** ✅

## Testing Recommendations

1. **Verify with August 2024 data** against reference Excel file
2. **Test edge cases:**
   - Overflights (should count as 0)
   - Local flights with high T&G counts
   - Mixed flight types in same day
3. **Compare exports:**
   - CSV export includes all weighted counting columns
   - XLSX Movement Details sheet includes columns T, U, V
4. **Validate totals:**
   - Monthly totals should match Excel reference
   - All movement categories correctly weighted

## Migration Notes

- **Historical data:** Existing monthly reports will show lower counts than Excel-based reports
- **No data loss:** All underlying movement data (T&G counts, flight types) remains unchanged
- **Backward compatibility:** The new columns in exports are additions; existing columns unchanged
- **Documentation:** Users should be informed that the new counting methodology matches official reporting standards

## Functions Exported

The following new functions are now exported from `reporting.js`:
- `detectFlightType(movement)` - Detect flight type
- `getMovementNumber(movement)` - Get weighted movement count
- `getTngDuplication(movement)` - Get T&G duplication value
- `getTotalWeightedCount(movement)` - Get total weighted count

These can be used elsewhere in the application if needed.

## References

- **Analysis Document:** `MONTHLY_REPORT_ANALYSIS.md`
- **Excel Reference:** `docs/Woodvale Stats AUG.xlsx` (if available)
- **Implementation Date:** 2026-01-27
- **Branch:** `claude/compare-branches-merge-Uj4f6`

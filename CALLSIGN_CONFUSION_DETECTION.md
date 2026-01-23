# Callsign Confusion Detection System

## Overview
This document describes the callsign confusion detection system implemented in the FDMS (Flight Data Management System). The system automatically detects potential callsign conflicts that could lead to air traffic control confusion.

## Location
**File:** `src/js/ui_liveboard.js`
**Function:** `generateMovementAlerts(m)`
**Lines:** Approximately 569-665

---

## Detection Methods

### 1. British G-Registration Abbreviated Callsign Conflicts

**Purpose:** Detects when two or more aircraft use their registration as their callsign and would abbreviate to the same phonetic callsign.

**How it works:**
- UK practice abbreviates registrations to first letter + last two letters
- Example: G-SHWK → "Golf Whiskey Kilo" (GWK)
- Example: G-OSWK → "Golf Whiskey Kilo" (GWK)
- Both aircraft would respond to the same abbreviated callsign

**Code:**
```javascript
// 1. British G-reg abbreviated callsign confusion
// If callsign equals registration (without hyphen), check for similar G-regs
if (thisReg.startsWith('G') && thisCallsign === thisReg) {
  // Extract first letter + last 2 letters (e.g., G-SHWK -> GWK)
  if (thisReg.length >= 3) {
    const thisAbbrev = thisReg[0] + thisReg.slice(-2);

    const conflictingGregs = activeOrPlannedMovements.filter(mov => {
      const otherReg = (mov.registration || '').toUpperCase().replace(/-/g, '').trim();
      const otherCallsign = (mov.callsignCode || '').toUpperCase().trim();

      if (otherReg.startsWith('G') && otherCallsign === otherReg && otherReg.length >= 3) {
        const otherAbbrev = otherReg[0] + otherReg.slice(-2);
        return thisAbbrev === otherAbbrev && thisReg !== otherReg;
      }
      return false;
    });

    if (conflictingGregs.length > 0) {
      const otherRegs = conflictingGregs.map(mov => mov.registration).join(', ');
      alerts.push({
        type: 'callsign_confusion_greg',
        severity: 'warning',
        message: `G-reg abbreviation conflict: Both ${m.registration} and ${otherRegs} abbreviate to "${thisAbbrev}"`
      });
    }
  }
}
```

**Visual Indicator:** Red underline on callsign

---

### 2. University Air Squadron (UA_) Callsign Conflicts

**Purpose:** Detects when different University Air Squadron aircraft with different unit codes but the same flight number would abbreviate to the same callsign.

**How it works:**
- UAS callsigns use format: UA[code][number] (e.g., UAM03, UAU03)
- After initial contact, crews may abbreviate to just "UNIFORM[number]"
- UAM03 → "UNIFORM ZERO THREE"
- UAU03 → "UNIFORM ZERO THREE"
- Both would respond to "UNIFORM ZERO THREE"

**Monitored UA Codes:**
UAA, UAD, UAF, UAH, UAI, UAJ, UAM, UAO, UAQ, UAS, UAT, UAU, UAV, UAW, UAX, UAY

**Code:**
```javascript
// 2. University Air Squadron (UA_) abbreviated callsign confusion
const uaCodes = ['UAA', 'UAD', 'UAF', 'UAH', 'UAI', 'UAJ', 'UAM', 'UAO', 'UAQ', 'UAS', 'UAT', 'UAU', 'UAV', 'UAW', 'UAX', 'UAY'];
let thisUaCode = null;
let thisUaNumber = null;

for (const code of uaCodes) {
  if (thisCallsign.startsWith(code)) {
    thisUaCode = code;
    thisUaNumber = thisCallsign.substring(code.length);
    break;
  }
}

if (thisUaCode && thisUaNumber) {
  const conflictingUa = activeOrPlannedMovements.filter(mov => {
    const otherCallsign = (mov.callsignCode || '').toUpperCase().trim();
    for (const code of uaCodes) {
      if (code !== thisUaCode && otherCallsign.startsWith(code)) {
        const otherNumber = otherCallsign.substring(code.length);
        return otherNumber === thisUaNumber;
      }
    }
    return false;
  });

  if (conflictingUa.length > 0) {
    const otherCallsigns = conflictingUa.map(mov => mov.callsignCode).join(', ');
    alerts.push({
      type: 'callsign_confusion_ua',
      severity: 'warning',
      message: `UAS callsign conflict: ${m.callsignCode} and ${otherCallsigns} both abbreviate to "UNIFORM${thisUaNumber}"`
    });
  }
}
```

**Visual Indicator:** Red underline on callsign

---

### 3. Military Non-Standard vs ICAO Abbreviation Conflicts

**Purpose:** Detects when a military aircraft using a non-standard callsign could be confused with an ICAO-approved airline abbreviation that uses the same phonetic.

**How it works:**
- Military units often use non-standard callsigns (e.g., "CRMSN" for Crimson)
- Some ICAO codes have the same phonetic (e.g., "OUA" = University of Oklahoma = "CRIMSON")
- CRMSN02 and OUA02 would both be called "CRIMSON ZERO TWO"

**Known Conflicts Database:**
```javascript
const knownConflicts = [
  { military: 'CRMSN', icao: 'OUA', phonetic: 'CRIMSON' }
  // Add more known conflicts here as needed
];
```

**Code:**
```javascript
// 3. Military non-standard vs ICAO abbreviation confusion
const knownConflicts = [
  { military: 'CRMSN', icao: 'OUA', phonetic: 'CRIMSON' }
  // Add more known conflicts here as needed
];

for (const conflict of knownConflicts) {
  const conflictingMilitary = activeOrPlannedMovements.filter(mov => {
    const otherCallsign = (mov.callsignCode || '').toUpperCase().trim();
    return (thisCallsign.startsWith(conflict.military) && otherCallsign.startsWith(conflict.icao)) ||
           (thisCallsign.startsWith(conflict.icao) && otherCallsign.startsWith(conflict.military));
  });

  if (conflictingMilitary.length > 0) {
    const otherCallsigns = conflictingMilitary.map(mov => mov.callsignCode).join(', ');
    alerts.push({
      type: 'callsign_confusion_military',
      severity: 'warning',
      message: `Military/ICAO callsign conflict: ${m.callsignCode} and ${otherCallsigns} may both use "${conflict.phonetic}"`
    });
  }
}
```

**Visual Indicator:** Red underline on callsign

**Expandability:** Additional conflicts can be added to the `knownConflicts` array as they are identified.

---

## Alert Severity Levels

All callsign confusion alerts are marked as **WARNING** level (yellow ⚠️) in the expanded Alerts section, but use a **red underline** visual indicator on the primary strip callsign field.

## Visual Indicators Summary

| Detection Type | Primary Strip | Expanded Alerts | Severity |
|---|---|---|---|
| G-reg Conflict | Red underline on callsign | ⚠️ Warning alert | Warning |
| UA_ Conflict | Red underline on callsign | ⚠️ Warning alert | Warning |
| Military/ICAO Conflict | Red underline on callsign | ⚠️ Warning alert | Warning |

## CSS Styling

**File:** `src/css/vectair.css`

```css
.call-main.callsign-confusion {
  text-decoration: underline;
  text-decoration-color: #d32f2f;
  text-decoration-thickness: 2px;
  text-underline-offset: 2px;
}
```

## Integration Points

1. **Alert Generation:** `generateMovementAlerts(m)` function
2. **Visual Application:** Applied during strip rendering in `renderLiveBoard()`
3. **Scope:** Checks against all movements with status 'ACTIVE' or 'PLANNED'

## Dependencies

- **getMovements()** - Retrieves all movements from data store
- Movement object must have:
  - `callsignCode` - The callsign field
  - `registration` - The aircraft registration
  - `status` - Movement status (ACTIVE/PLANNED/COMPLETED)
  - `id` - Unique movement identifier

## Testing Scenarios

### Scenario 1: G-reg Conflict
- Create Movement 1: Callsign "GSHWK", Registration "G-SHWK"
- Create Movement 2: Callsign "GOSWK", Registration "G-OSWK"
- **Expected:** Both show red underline, alert appears in both expanded sections

### Scenario 2: UAS Conflict
- Create Movement 1: Callsign "UAM03"
- Create Movement 2: Callsign "UAU03"
- **Expected:** Both show red underline, alert appears in both expanded sections

### Scenario 3: Military/ICAO Conflict
- Create Movement 1: Callsign "CRMSN02"
- Create Movement 2: Callsign "OUA02"
- **Expected:** Both show red underline, alert appears in both expanded sections

---

## Maintenance Notes

### Adding New Military/ICAO Conflicts

To add a new known conflict, update the `knownConflicts` array in `generateMovementAlerts()`:

```javascript
const knownConflicts = [
  { military: 'CRMSN', icao: 'OUA', phonetic: 'CRIMSON' },
  { military: 'YOUR_MIL', icao: 'ABC', phonetic: 'PHONETIC' }
  // Add more as needed
];
```

### Adding New UA Codes

To add a new University Air Squadron code, update the `uaCodes` array:

```javascript
const uaCodes = ['UAA', 'UAD', 'UAF', ..., 'UAZ']; // Add new codes here
```

---

## Performance Considerations

- All checks are performed in real-time when alerts are generated
- Filters run against all active/planned movements (typically <100 items)
- String operations are case-insensitive and trimmed for reliability
- No external API calls or database queries required

---

## Future Enhancements

Potential improvements to consider:

1. **Database-driven conflict list:** Move known conflicts to a configuration file or database
2. **International callsign support:** Extend G-reg logic to other country codes (N-, D-, etc.)
3. **Phonetic similarity matching:** Use Levenshtein distance or soundex algorithms
4. **Historical conflict tracking:** Log actual conflicts that occurred for pattern analysis
5. **User-configurable conflicts:** Allow users to add custom conflict patterns via admin panel

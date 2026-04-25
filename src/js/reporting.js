// reporting.js
// Reporting engine for Official Monthly Return, Dashboard KPIs, and Insights leaderboards
//
// REPORTING SEMANTICS (Sprint 9 review — intentional design decision)
// ====================================================================
// This module uses NOMINAL strip-type-based counting for all outputs:
//   LOC = 2, DEP/ARR = 1, OVR = 0, plus T&G×2, O/S×1.
//
// This is intentional and correct for the Official Monthly Return,
// which is a pre-defined official document format based on strip type.
// The Monthly Return reports what types of operations were planned/conducted,
// not purely which EGOW events physically occurred.
//
// The Live Board daily totals (in app.js) were updated in Sprint 9 to use
// event-based EGOW counting (egowRunwayContribution) to accurately reflect
// real-time operational activity.
//
// THESE TWO SYSTEMS ARE INTENTIONALLY DIFFERENT and must remain separate:
//   - Live Board daily stats: event-based (actual dep/arr required to count)
//   - Monthly Return / Dashboard / Insights: nominal strip-type-based
//
// This divergence is documented here and in STATE.md and must not be
// accidentally merged or silently changed in future sprints.

import { getMovements, getCancelledSorties, getElementAttributionIdentity, getResolvedElementPilot } from './datamodel.js';
import { getVKBRegistrations } from './vkb.js';

// ========================================
// HOURS LOG MANAGEMENT
// ========================================

const HOURS_STORAGE_KEY = 'vectair_fdms_hours_v1';

/**
 * Load hours log from localStorage
 * @returns {Object} Map of YYYY-MM-DD → number|null
 */
export function loadHours() {
  try {
    const stored = localStorage.getItem(HOURS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (e) {
    console.error('Failed to load hours:', e);
    return {};
  }
}

/**
 * Save hours for a specific date
 * @param {string} date - YYYY-MM-DD
 * @param {number|null} hours - Hours value or null to clear
 */
export function saveHours(date, hours) {
  const hoursMap = loadHours();
  if (hours === null || hours === undefined || hours === '') {
    delete hoursMap[date];
  } else {
    hoursMap[date] = parseFloat(hours);
  }
  localStorage.setItem(HOURS_STORAGE_KEY, JSON.stringify(hoursMap));
}

/**
 * Get hours for a specific date
 * @param {string} date - YYYY-MM-DD
 * @returns {number|null}
 */
export function getHoursForDate(date) {
  const hoursMap = loadHours();
  return hoursMap[date] !== undefined ? hoursMap[date] : null;
}

// ========================================
// REGISTRATION INDEX BUILDER
// ========================================

let registrationIndex = null;

/**
 * Build index from FDMS_REGISTRATIONS.csv for fast lookups
 * @returns {Map} registration → row data
 */
export function buildRegistrationIndex() {
  if (registrationIndex) return registrationIndex;

  registrationIndex = new Map();
  const registrations = getVKBRegistrations();

  for (const row of registrations) {
    const reg = (row.REGISTRATION || '').toUpperCase().trim();
    if (reg) {
      registrationIndex.set(reg, row);
    }
  }

  return registrationIndex;
}

// ========================================
// MOVEMENT CLASSIFICATION ENGINE
// ========================================

/**
 * Classify a movement for reporting purposes
 * @param {Object} movement - Movement object
 * @returns {Object} Classification result
 */
export function classifyMovement(movement) {
  const regIndex = buildRegistrationIndex();
  const reg = (movement.registration || '').toUpperCase().trim().replace(/[-\s]/g, '');

  // Lookup registration in VKB
  const regData = regIndex.get(reg) || regIndex.get(movement.registration?.toUpperCase().trim());

  // Primary classification source: EGOW FLIGHT TYPE from registration CSV
  let egowFlightType = regData?.['EGOW FLIGHT TYPE'] || movement.egowCode || '';
  egowFlightType = egowFlightType.toUpperCase().trim();

  // Classification flags
  const isMilitary = ['BM', 'VM', 'VMH', 'VNH'].includes(egowFlightType);
  const isCivil = ['BC', 'VC', 'VCH'].includes(egowFlightType);
  const isRotary = ['VMH', 'VCH', 'VNH'].includes(egowFlightType);
  const isFixedWing = !isRotary;

  // Navy helicopter detection
  const caaOprPfx = regData?.['CAA OPR PFX'] || '';
  const operator = regData?.OPERATOR || movement.operator || '';
  const isNavyHeli = egowFlightType === 'VNH' ||
                     caaOprPfx === 'NVY' ||
                     operator.toUpperCase().includes('ROYAL NAVY') ||
                     operator.toUpperCase().includes('NAVY');

  // Based military unit (M=MASUAS, L=LUAS, A=AEF)
  let basedUnit = null;
  if (egowFlightType === 'BM') {
    basedUnit = (movement.unitCode || '').toUpperCase().trim();
  }

  return {
    egowFlightType,
    isMilitary,
    isCivil,
    isRotary,
    isFixedWing,
    isNavyHeli,
    basedUnit, // 'M', 'L', 'A', or null
    isMASUAS: egowFlightType === 'BM' && basedUnit === 'M',
    isLUAS: egowFlightType === 'BM' && basedUnit === 'L',
    isAEF: egowFlightType === 'BM' && basedUnit === 'A',
    isVisitingMil: ['VM', 'VMH', 'VNH'].includes(egowFlightType),
    isVisitingCivFixedWing: egowFlightType === 'VC',
    isVisitingCivHeli: egowFlightType === 'VCH',
    isVisitingMilHeli: egowFlightType === 'VMH',
    isBasedCivil: egowFlightType === 'BC',
    regData // Include for additional lookups
  };
}

// ========================================
// WEIGHTED COUNTING LOGIC (per Excel reference)
// ========================================

/**
 * Parse time string "HH:MM" to minutes since midnight
 * @param {string} timeStr - Time string in HH:MM format
 * @returns {number|null} Minutes since midnight, or null if invalid
 */
function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Detect if a local flight spans midnight UTC
 * A flight spans midnight if:
 * - It's a LOC flight
 * - Arrival time is earlier than departure time (wrapped to next day)
 * @param {Object} movement - Movement object
 * @returns {boolean} True if flight spans midnight
 */
export function detectMidnightCrossing(movement) {
  const flightType = detectFlightType(movement);

  // Only local flights can span midnight in our context
  if (flightType !== 'LOC') return false;

  // Get departure and arrival times (prefer actual, fall back to estimated)
  const depTime = movement.depActual || movement.depPlanned;
  const arrTime = movement.arrActual || movement.arrPlanned;

  if (!depTime || !arrTime) return false;

  const depMinutes = parseTimeToMinutes(depTime);
  const arrMinutes = parseTimeToMinutes(arrTime);

  if (depMinutes === null || arrMinutes === null) return false;

  // If arrival time is less than departure time, flight spans midnight
  // e.g., DEP 23:30, ARR 00:15 => crossed midnight
  return arrMinutes < depMinutes;
}

/**
 * Split a midnight-crossing movement into departure and arrival portions
 * For reporting purposes:
 * - Day X: DEP with movement number 1 + first portion of T&Gs + first portion of O/S
 * - Day Y: ARR with movement number 1 + remaining T&Gs + remaining O/S
 * @param {Object} movement - Movement object that spans midnight
 * @param {string} depDate - Departure date (YYYY-MM-DD)
 * @param {string} arrDate - Arrival date (YYYY-MM-DD)
 * @returns {Array} Array of two virtual movements [depPortion, arrPortion]
 */
export function splitMidnightMovement(movement, depDate, arrDate) {
  const tngCount = movement.tngCount || 0;
  const osCount = movement.osCount || 0;
  const fisCount = movement.fisCount || 0;

  // Divide T&Gs: first half (rounded up) goes to departure day
  const depTngs = Math.ceil(tngCount / 2);
  const arrTngs = tngCount - depTngs;

  // Divide O/S: first half (rounded up) goes to departure day
  const depOs = Math.ceil(osCount / 2);
  const arrOs = osCount - depOs;

  // FIS events go to the day they occurred - default to departure day
  const depFis = fisCount;
  const arrFis = 0;

  // Create departure portion (virtual movement)
  const depPortion = {
    ...movement,
    dof: depDate,
    flightType: 'DEP', // Treated as departure for this day
    tngCount: depTngs,
    osCount: depOs,
    fisCount: depFis,
    _isMidnightSplit: true,
    _splitType: 'DEP'
  };

  // Create arrival portion (virtual movement)
  const arrPortion = {
    ...movement,
    dof: arrDate,
    flightType: 'ARR', // Treated as arrival for this day
    tngCount: arrTngs,
    osCount: arrOs,
    fisCount: arrFis,
    _isMidnightSplit: true,
    _splitType: 'ARR'
  };

  return [depPortion, arrPortion];
}

/**
 * Get the next date string (YYYY-MM-DD) after a given date
 * @param {string} dateStr - Date string in YYYY-MM-DD format
 * @returns {string} Next date in YYYY-MM-DD format
 */
function getNextDate(dateStr) {
  const date = new Date(dateStr + 'T12:00:00Z'); // Use noon to avoid DST issues
  date.setUTCDate(date.getUTCDate() + 1);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Detect flight type based on aerodromes and callsign
 * @param {Object} movement - Movement object
 * @returns {string} Flight type: LOC, DEP, ARR, or OVR
 */
export function detectFlightType(movement) {
  // If flight type is already set, use it
  if (movement.flightType) {
    return movement.flightType.toUpperCase().trim();
  }

  const depAd = (movement.depAd || '').toUpperCase().trim();
  const arrAd = (movement.arrAd || '').toUpperCase().trim();
  const callsign = (movement.callsign || '').toUpperCase().trim();

  // Special case: UAM callsigns are always local
  if (callsign.includes('UAM')) {
    return 'LOC';
  }

  // Determine flight type based on aerodromes
  const isDepEGOW = depAd === 'EGOW';
  const isArrEGOW = arrAd === 'EGOW';

  if (isDepEGOW && isArrEGOW) return 'LOC';
  if (isDepEGOW && !isArrEGOW) return 'DEP';
  if (!isDepEGOW && isArrEGOW) return 'ARR';
  if (!isDepEGOW && !isArrEGOW) return 'OVR';

  // Default fallback
  return 'LOC';
}

/**
 * Get movement number (weighted count) based on flight type
 * Per Excel reference:
 * - LOC (Local): 2
 * - DEP (Departure) or ARR (Arrival): 1
 * - OVR (Overflight): 0
 * @param {Object} movement - Movement object
 * @returns {number} Movement number
 */
export function getMovementNumber(movement) {
  const flightType = detectFlightType(movement);

  if (flightType === 'LOC') return 2;
  if (flightType === 'DEP' || flightType === 'ARR') return 1;
  if (flightType === 'OVR') return 0;

  // Default fallback for unknown types
  return 1;
}

/**
 * Get T&G duplication count (each T&G adds 2 to the total)
 * Per Excel reference: T&G Duplication = T&G Count × 2
 * @param {Object} movement - Movement object
 * @returns {number} T&G duplication value
 */
export function getTngDuplication(movement) {
  const tngCount = movement.tngCount || 0;
  return tngCount * 2;
}

/**
 * Get O/S (overshoot) count
 * Overshoots count as 1 each (runway occupancy without touchdown)
 * @param {Object} movement - Movement object
 * @returns {number} O/S count
 */
export function getOsCount(movement) {
  return movement.osCount || 0;
}

/**
 * Calculate total weighted count for a movement
 * Formula: Total Count = Movement Number + T&G Duplication + O/S Count
 * - Movement Number: LOC=2, DEP/ARR=1, OVR=0
 * - T&G Duplication: T&G Count × 2 (each T&G is 2 runway occupancies)
 * - O/S Count: O/S × 1 (runway occupancy without touchdown)
 * @param {Object} movement - Movement object
 * @returns {number} Total weighted count
 */
export function getTotalWeightedCount(movement) {
  return getMovementNumber(movement) + getTngDuplication(movement) + getOsCount(movement);
}

// ========================================
// MONTHLY RETURN COMPUTATION
// ========================================

/**
 * Compute Official Monthly Return grid
 * @param {Array} movements - All movements
 * @param {number} year - Year (e.g., 2026)
 * @param {number} month - Month (1-12)
 * @param {Object} hoursMap - Hours log map
 * @returns {Object} {rows, totals, metadata}
 */
export function computeMonthlyReturn(movements, year, month, hoursMap = null) {
  if (!hoursMap) hoursMap = loadHours();

  const daysInMonth = new Date(year, month, 0).getDate();

  // Initialize daily rows (1-31)
  const rows = [];
  for (let day = 1; day <= daysInMonth; day++) {
    rows.push({
      day,
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      MASUAS: 0,
      LUAS: 0,
      AEF: 0,
      OS_MASUAS: 0,
      OS_LUAS: 0,
      OS_AEF: 0,
      VIS_MIL: 0,
      TOTAL_MIL: 0,
      VIS_CIV_FW: 0,
      OW_FW: 0, // BC (EGOW-based civilian fixed-wing)
      TOTAL_CIV_FW: 0,
      NVY_HEL: 0,
      CIV_HEL: 0,
      MIL_HEL: 0,
      MIL_FIS: 0,
      CIV_FIS: 0,
      HOURS: null
    });
  }

  // Filter movements for this month (or that arrive in this month due to midnight crossing)
  const monthStr = String(month).padStart(2, '0');
  const targetMonthPrefix = `${year}-${monthStr}`;

  // Build list of movements to process (including split midnight-crossing movements)
  const movementsToProcess = [];

  for (const m of movements) {
    const dof = m.dof || '';

    // Check if this is a midnight-crossing local flight
    if (detectMidnightCrossing(m)) {
      const depDate = dof;
      const arrDate = getNextDate(dof);

      // Split the movement
      const [depPortion, arrPortion] = splitMidnightMovement(m, depDate, arrDate);

      // Add portions that fall within this month
      if (depDate.startsWith(targetMonthPrefix)) {
        movementsToProcess.push(depPortion);
      }
      if (arrDate.startsWith(targetMonthPrefix)) {
        movementsToProcess.push(arrPortion);
      }
    } else {
      // Regular movement - only include if DOF is in this month
      if (dof.startsWith(targetMonthPrefix)) {
        movementsToProcess.push(m);
      }
    }
  }

  // Helper function to add counts to a row
  const addToRow = (row, classification, movement) => {
    // Calculate weighted count for this movement
    // Formula: Total Count = Movement Number + T&G Duplication + O/S Count
    const movementNumber = getMovementNumber(movement);
    const tngDuplication = getTngDuplication(movement);
    const osCount = getOsCount(movement);
    const totalCount = movementNumber + tngDuplication + osCount;

    // Based Military counts (using weighted counting)
    if (classification.isMASUAS) row.MASUAS += totalCount;
    if (classification.isLUAS) row.LUAS += totalCount;
    if (classification.isAEF) row.AEF += totalCount;

    // Overshoot events are now included in totalCount, but also track separately
    if (classification.isMASUAS) row.OS_MASUAS += osCount;
    if (classification.isLUAS) row.OS_LUAS += osCount;
    if (classification.isAEF) row.OS_AEF += osCount;

    // Visiting Military (using weighted counting)
    if (classification.isVisitingMil) row.VIS_MIL += totalCount;

    // Total Military = VIS MIL + all BM (using weighted counting)
    if (classification.isMilitary) {
      if (classification.egowFlightType === 'BM') {
        row.TOTAL_MIL += totalCount; // Will add VIS_MIL separately
      }
    }

    // Civil Fixed-Wing (using weighted counting)
    if (classification.isVisitingCivFixedWing) row.VIS_CIV_FW += totalCount;

    // OW F/W = BC (EGOW-based civilian fixed-wing)
    if (classification.isBasedCivil) row.OW_FW += totalCount;

    // Helicopters (using weighted counting)
    if (classification.isNavyHeli) row.NVY_HEL += totalCount;
    if (classification.isVisitingCivHeli) row.CIV_HEL += totalCount;
    if (classification.isVisitingMilHeli) row.MIL_HEL += totalCount;

    // FIS events (sum fisCount)
    const fisCount = movement.fisCount || 0;
    if (classification.isMilitary) row.MIL_FIS += fisCount;
    if (classification.isCivil) row.CIV_FIS += fisCount;
  };

  // Process each movement (including split midnight-crossing movements)
  for (const m of movementsToProcess) {
    const classification = classifyMovement(m);
    const dof = m.dof || '';
    const day = parseInt(dof.split('-')[2], 10);

    if (day < 1 || day > daysInMonth) continue;

    const row = rows[day - 1];
    addToRow(row, classification, m);
  }

  // Add VIS_MIL to TOTAL_MIL and compute TOTAL_CIV_FW
  for (const row of rows) {
    row.TOTAL_MIL += row.VIS_MIL;
    row.TOTAL_CIV_FW = row.VIS_CIV_FW + row.OW_FW;

    // Load hours for this date
    row.HOURS = getHoursForDate(row.date);
  }

  // Compute totals row
  const totals = {
    day: 'TOTAL',
    date: null,
    MASUAS: 0,
    LUAS: 0,
    AEF: 0,
    OS_MASUAS: 0,
    OS_LUAS: 0,
    OS_AEF: 0,
    VIS_MIL: 0,
    TOTAL_MIL: 0,
    VIS_CIV_FW: 0,
    OW_FW: 0,
    TOTAL_CIV_FW: 0,
    NVY_HEL: 0,
    CIV_HEL: 0,
    MIL_HEL: 0,
    MIL_FIS: 0,
    CIV_FIS: 0,
    HOURS: 0
  };

  for (const row of rows) {
    totals.MASUAS += row.MASUAS;
    totals.LUAS += row.LUAS;
    totals.AEF += row.AEF;
    totals.OS_MASUAS += row.OS_MASUAS;
    totals.OS_LUAS += row.OS_LUAS;
    totals.OS_AEF += row.OS_AEF;
    totals.VIS_MIL += row.VIS_MIL;
    totals.TOTAL_MIL += row.TOTAL_MIL;
    totals.VIS_CIV_FW += row.VIS_CIV_FW;
    totals.OW_FW += row.OW_FW;
    totals.TOTAL_CIV_FW += row.TOTAL_CIV_FW;
    totals.NVY_HEL += row.NVY_HEL;
    totals.CIV_HEL += row.CIV_HEL;
    totals.MIL_HEL += row.MIL_HEL;
    totals.MIL_FIS += row.MIL_FIS;
    totals.CIV_FIS += row.CIV_FIS;
    if (row.HOURS !== null) totals.HOURS += row.HOURS;
  }

  return {
    rows,
    totals,
    metadata: {
      year,
      month,
      daysInMonth,
      movementCount: movementsToProcess.length
    }
  };
}

// ========================================
// DASHBOARD KPIs COMPUTATION
// ========================================

/**
 * Compute Dashboard KPIs for a date range
 * @param {Array} movements - Filtered movements for date range
 * @param {Object} hoursMap - Hours log map
 * @returns {Object} KPIs and percentages
 */
export function computeKPIs(movements, hoursMap = null) {
  if (!hoursMap) hoursMap = loadHours();

  let totalMovements = 0;
  let militaryMovements = 0;
  let civilMovements = 0;
  let totalOvershoots = 0;
  let totalFIS = 0;
  let totalTnG = 0;
  let rotaryMovements = 0;
  let fixedWingMovements = 0;

  for (const m of movements) {
    const classification = classifyMovement(m);

    totalMovements++;
    if (classification.isMilitary) militaryMovements++;
    if (classification.isCivil) civilMovements++;
    if (classification.isRotary) rotaryMovements++;
    if (classification.isFixedWing) fixedWingMovements++;

    totalOvershoots += m.osCount || 0;
    totalFIS += m.fisCount || 0;
    totalTnG += m.tngCount || 0;
  }

  // Calculate total hours for date range
  let totalHours = 0;
  const dates = new Set(movements.map(m => m.dof).filter(Boolean));
  for (const date of dates) {
    const hours = getHoursForDate(date);
    if (hours !== null) totalHours += hours;
  }

  // Percentages
  const pctMilitary = totalMovements > 0 ? (militaryMovements / totalMovements * 100).toFixed(1) : 0;
  const pctCivil = totalMovements > 0 ? (civilMovements / totalMovements * 100).toFixed(1) : 0;
  const pctRotary = totalMovements > 0 ? (rotaryMovements / totalMovements * 100).toFixed(1) : 0;
  const pctFixedWing = totalMovements > 0 ? (fixedWingMovements / totalMovements * 100).toFixed(1) : 0;

  // Rates (per hour)
  const movementsPerHour = totalHours > 0 ? (totalMovements / totalHours).toFixed(2) : null;
  const fisPerHour = totalHours > 0 ? (totalFIS / totalHours).toFixed(2) : null;
  const osPerHour = totalHours > 0 ? (totalOvershoots / totalHours).toFixed(2) : null;

  return {
    totalMovements,
    militaryMovements,
    civilMovements,
    rotaryMovements,
    fixedWingMovements,
    totalOvershoots,
    totalFIS,
    totalTnG,
    totalHours,
    pctMilitary,
    pctCivil,
    pctRotary,
    pctFixedWing,
    movementsPerHour,
    fisPerHour,
    osPerHour
  };
}

// ========================================
// INSIGHTS LEADERBOARDS COMPUTATION
// ========================================

/**
 * Compute leaderboards for Insights
 * @param {Array} movements - Filtered movements
 * @param {Object} hoursMap - Hours log map (unused for now, future: flight hours)
 * @returns {Object} Leaderboards by captain, callsign, registration
 */
export function computeLeaderboards(movements, hoursMap = null) {
  const byCaptain = {};
  const byCallsign = {};
  const byRegistration = {};

  let captainPresent = 0;
  let callsignPresent = 0;
  let registrationPresent = 0;

  // Shared helper: credit one sortie entry to the three leaderboard buckets.
  function creditSortie(captain, callsign, registration, osCount, tngCount, fisCount) {
    const captainKey  = captain      || 'Unknown';
    const callsignKey = callsign     || 'Unknown';
    const regKey      = registration || 'Unknown';

    if (!byCaptain[captainKey]) {
      byCaptain[captainKey] = { name: captainKey, sorties: 0, overshoots: 0, overshootFlights: 0, fis: 0, fisFlights: 0, tng: 0, tngFlights: 0 };
    }
    byCaptain[captainKey].sorties++;
    byCaptain[captainKey].overshoots += osCount;
    if (osCount > 0) byCaptain[captainKey].overshootFlights++;
    byCaptain[captainKey].fis += fisCount;
    if (fisCount > 0) byCaptain[captainKey].fisFlights++;
    byCaptain[captainKey].tng += tngCount;
    if (tngCount > 0) byCaptain[captainKey].tngFlights++;

    if (!byCallsign[callsignKey]) {
      byCallsign[callsignKey] = { name: callsignKey, sorties: 0, overshoots: 0, overshootFlights: 0, fis: 0, fisFlights: 0, tng: 0, tngFlights: 0 };
    }
    byCallsign[callsignKey].sorties++;
    byCallsign[callsignKey].overshoots += osCount;
    if (osCount > 0) byCallsign[callsignKey].overshootFlights++;
    byCallsign[callsignKey].fis += fisCount;
    if (fisCount > 0) byCallsign[callsignKey].fisFlights++;
    byCallsign[callsignKey].tng += tngCount;
    if (tngCount > 0) byCallsign[callsignKey].tngFlights++;

    if (!byRegistration[regKey]) {
      byRegistration[regKey] = { name: regKey, sorties: 0, overshoots: 0, overshootFlights: 0, fis: 0, fisFlights: 0, tng: 0, tngFlights: 0 };
    }
    byRegistration[regKey].sorties++;
    byRegistration[regKey].overshoots += osCount;
    if (osCount > 0) byRegistration[regKey].overshootFlights++;
    byRegistration[regKey].fis += fisCount;
    if (fisCount > 0) byRegistration[regKey].fisFlights++;
    byRegistration[regKey].tng += tngCount;
    if (tngCount > 0) byRegistration[regKey].tngFlights++;
  }

  for (const m of movements) {
    // Completeness tracking always at movement level (not expanded per element).
    if (m.captain?.trim()) captainPresent++;
    if (m.callsignCode?.trim()) callsignPresent++;
    if (m.registration?.trim()) registrationPresent++;

    // FR-14: Formation element expansion — credit each element when it carries
    // its own identity (pilotName or underlyingCallsign), so that stats are
    // attributed to the real aircraft/pilot rather than the master formation label.
    const hasFormation = m.formation && Array.isArray(m.formation.elements) && m.formation.elements.length > 0;
    if (hasFormation) {
      const elements = m.formation.elements;
      const hasElementIdentity = elements.some(
        el => (el.underlyingCallsign || '').trim() || (el.pilotName || '').trim()
      );
      if (hasElementIdentity) {
        for (const el of elements) {
          const captain      = getResolvedElementPilot(el, m);
          const callsign     = getElementAttributionIdentity(el, m);
          const registration = (el.reg || m.registration || '').trim();
          const ov           = el.overrides || {};
          const osCount      = Number('osCount'  in ov ? ov.osCount  : (m.osCount  || 0));
          const tngCount     = Number('tngCount' in ov ? ov.tngCount : (m.tngCount || 0));
          // FIS has no per-element override; always from master.
          const fisCount     = Number(m.fisCount || 0);
          creditSortie(captain, callsign, registration, osCount, tngCount, fisCount);
        }
        continue; // Skip master-level attribution for this movement.
      }
    }

    // Non-formation or formation without element identity: attribute to master strip.
    const captain      = m.captain?.trim() || '';
    const callsign     = m.callsignCode?.trim() || '';
    const registration = m.registration?.trim() || '';
    creditSortie(captain, callsign, registration, m.osCount || 0, m.tngCount || 0, m.fisCount || 0);
  }

  // Convert to arrays and sort by sorties
  const captainList = Object.values(byCaptain).sort((a, b) => b.sorties - a.sorties);
  const callsignList = Object.values(byCallsign).sort((a, b) => b.sorties - a.sorties);
  const registrationList = Object.values(byRegistration).sort((a, b) => b.sorties - a.sorties);

  const completeness = {
    total: movements.length,
    captainPresent,
    callsignPresent,
    registrationPresent,
    captainPct: movements.length > 0 ? (captainPresent / movements.length * 100).toFixed(1) : 0,
    callsignPct: movements.length > 0 ? (callsignPresent / movements.length * 100).toFixed(1) : 0,
    registrationPct: movements.length > 0 ? (registrationPresent / movements.length * 100).toFixed(1) : 0
  };

  return {
    byCaptain: captainList,
    byCallsign: callsignList,
    byRegistration: registrationList,
    completeness
  };
}

// ========================================
// DRILLDOWN HELPERS
// ========================================

/**
 * Filter movements by a predicate
 * @param {Array} movements - All movements
 * @param {Function} predicate - Filter function
 * @returns {Array} Filtered movements
 */
export function filterMovementsByPredicate(movements, predicate) {
  return movements.filter(predicate);
}

// ========================================
// EXPORT UTILITIES
// ========================================

/**
 * Export movements to CSV
 * @param {Array} movements - Movements to export
 * @param {string} filename - Filename for download
 */
export function exportMovementsToCSV(movements, filename = 'movements.csv') {
  const headers = [
    'Date', 'Callsign', 'Registration', 'Type', 'WTC', 'Flight Type', 'Rules',
    'Departure', 'Arrival', 'Dep Planned', 'Dep Actual', 'Arr Planned', 'Arr Actual',
    'EGOW Code', 'Unit Code', 'Captain', 'POB', 'T&Gs', 'O/S', 'FIS', 'Status',
    'Movement Number', 'T&G Duplication', 'Total Count'
  ];

  const rows = movements.map(m => {
    // Calculate weighted counting values for export
    const movementNumber = getMovementNumber(m);
    const tngDuplication = getTngDuplication(m);
    const osCount = getOsCount(m);
    const totalCount = movementNumber + tngDuplication + osCount;

    return [
      m.dof || '',
      m.callsignCode || '',
      m.registration || '',
      m.type || '',
      m.wtc || '',
      m.flightType || '',
      m.rules || '',
      m.depAd || '',
      m.arrAd || '',
      m.depPlanned || '',
      m.depActual || '',
      m.arrPlanned || '',
      m.arrActual || '',
      m.egowCode || '',
      m.unitCode || '',
      m.captain || '',
      m.pob || '',
      m.tngCount || 0,
      m.osCount || 0,
      m.fisCount || 0,
      m.status || '',
      movementNumber,
      tngDuplication,
      totalCount
    ];
  });

  // Build CSV
  const csvLines = [headers.join(',')];
  for (const row of rows) {
    const escaped = row.map(cell => {
      const str = String(cell);
      // Escape quotes and wrap in quotes if contains comma or quote
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    });
    csvLines.push(escaped.join(','));
  }

  const csvContent = csvLines.join('\n');
  downloadFile(csvContent, filename, 'text/csv');
}

/**
 * Export Monthly Return to Excel (XLSX)
 * Requires SheetJS library to be loaded
 * @param {Object} monthlyReturn - Result from computeMonthlyReturn()
 * @param {Array} movements - All movements for detail sheet
 * @param {string} filename - Filename for download
 */
export function exportMonthlyReturnToXLSX(monthlyReturn, movements, filename = 'monthly_return.xlsx') {
  if (typeof XLSX === 'undefined') {
    alert('Excel export requires SheetJS library. Please contact support.');
    return;
  }

  const { rows, totals, metadata } = monthlyReturn;

  // Create workbook
  const wb = XLSX.utils.book_new();

  // Sheet 1: Official Monthly Return
  const sheetData = [
    // Header row
    ['Day', 'MASUAS', 'LUAS', 'AEF', 'O/S MASUAS', 'O/S LUAS', 'O/S AEF', 
     'VIS MIL', 'TOTAL MIL', 'VIS CIV F/W', 'O/W F/W', 'TOTAL CIV F/W',
     'NVY HEL', 'CIV HEL', 'MIL HEL', 'MIL FIS', 'CIV FIS', 'HOURS']
  ];

  // Daily rows
  for (const row of rows) {
    sheetData.push([
      row.day,
      row.MASUAS,
      row.LUAS,
      row.AEF,
      row.OS_MASUAS,
      row.OS_LUAS,
      row.OS_AEF,
      row.VIS_MIL,
      row.TOTAL_MIL,
      row.VIS_CIV_FW,
      row.OW_FW,
      row.TOTAL_CIV_FW,
      row.NVY_HEL,
      row.CIV_HEL,
      row.MIL_HEL,
      row.MIL_FIS,
      row.CIV_FIS,
      row.HOURS !== null ? row.HOURS : ''
    ]);
  }

  // Total row
  sheetData.push([
    'TOTAL',
    totals.MASUAS,
    totals.LUAS,
    totals.AEF,
    totals.OS_MASUAS,
    totals.OS_LUAS,
    totals.OS_AEF,
    totals.VIS_MIL,
    totals.TOTAL_MIL,
    totals.VIS_CIV_FW,
    totals.OW_FW,
    totals.TOTAL_CIV_FW,
    totals.NVY_HEL,
    totals.CIV_HEL,
    totals.MIL_HEL,
    totals.MIL_FIS,
    totals.CIV_FIS,
    totals.HOURS
  ]);

  const ws1 = XLSX.utils.aoa_to_sheet(sheetData);
  XLSX.utils.book_append_sheet(wb, ws1, 'Official Return');

  // Sheet 2: Movement Details (with weighted counting columns)
  const detailData = [
    ['Date', 'Callsign', 'Registration', 'Type', 'WTC', 'Flight Type', 'Rules',
     'Departure', 'Arrival', 'Dep Planned', 'Dep Actual', 'Arr Planned', 'Arr Actual',
     'EGOW Code', 'Unit Code', 'Captain', 'POB', 'T&Gs', 'O/S', 'FIS', 'Status',
     'Movement Number', 'T&G Duplication', 'Total Count']
  ];

  for (const m of movements) {
    // Calculate weighted counting values for export
    const movementNumber = getMovementNumber(m);
    const tngDuplication = getTngDuplication(m);
    const osCount = getOsCount(m);
    const totalCount = movementNumber + tngDuplication + osCount;

    detailData.push([
      m.dof || '',
      m.callsignCode || '',
      m.registration || '',
      m.type || '',
      m.wtc || '',
      m.flightType || '',
      m.rules || '',
      m.depAd || '',
      m.arrAd || '',
      m.depPlanned || '',
      m.depActual || '',
      m.arrPlanned || '',
      m.arrActual || '',
      m.egowCode || '',
      m.unitCode || '',
      m.captain || '',
      m.pob || '',
      m.tngCount || 0,
      m.osCount || 0,
      m.fisCount || 0,
      m.status || '',
      movementNumber,
      tngDuplication,
      totalCount
    ]);
  }

  const ws2 = XLSX.utils.aoa_to_sheet(detailData);
  XLSX.utils.book_append_sheet(wb, ws2, 'Movement Details');

  // Write and download
  XLSX.writeFile(wb, filename);
}

/**
 * Helper to download a file in the browser
 * @param {string} content - File content
 * @param {string} filename - Filename
 * @param {string} mimeType - MIME type
 */
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ========================================
// CANCELLATION REPORT (Ticket 6b)
// ========================================
//
// PRIMARY DATA SOURCE: current-state CANCELLED movements from getMovements().
//   - getMovements() filtered to status === 'CANCELLED'
//   - Cross-referenced with getCancelledSorties() log for cancelledAt, reason code, reason text
//   - Reinstated rows excluded automatically: they are no longer status=CANCELLED in getMovements()
//   - Soft-deleted rows excluded automatically: they are not present in getMovements()
//
// DATE FIELD CHOICE:
//   - Primary:  cancelledAt from the matching log entry (ISO 8601 string, date portion used)
//   - Fallback: dof (date of flight) from the current movement record
//   - If neither is available the row is included regardless of date bounds (conservative)
//
// This function is intentionally separate from the Monthly Return / Dashboard / Insights
// nominal strip-count model and must not be merged with it.

const CANCELLATION_REASON_ORDER = ['OPS', 'WX', 'TECH', 'ATC', 'ADMIN', 'CREW', 'OTHER', ''];
const CANCELLATION_REASON_LABELS = {
  'OPS':   'OPS — operational / tasking change',
  'WX':    'WX — weather',
  'TECH':  'TECH — aircraft technical / engineering',
  'ATC':   'ATC — ATC / airfield / slot / airspace',
  'ADMIN': 'ADMIN — paperwork / authorisation / admin',
  'CREW':  'CREW — crew / staffing',
  'OTHER': 'OTHER — other',
  '':      'Unassigned',
};

const FLIGHT_TYPE_ORDER = ['DEP', 'ARR', 'LOC', 'OVR'];
const FLIGHT_TYPE_LABELS = {
  'DEP': 'DEP — Departure',
  'ARR': 'ARR — Arrival',
  'LOC': 'LOC — Local',
  'OVR': 'OVR — Overfly',
};

export { CANCELLATION_REASON_ORDER, CANCELLATION_REASON_LABELS, FLIGHT_TYPE_ORDER, FLIGHT_TYPE_LABELS };

/**
 * Build the current-state cancellation report dataset.
 *
 * @param {string|null} startDate - YYYY-MM-DD lower bound (inclusive), or null
 * @param {string|null} endDate   - YYYY-MM-DD upper bound (inclusive), or null
 * @returns {Object} { rows, total, noReason, byReason, byFlightType, ranked, startDate, endDate }
 */
export function computeCancellationReport(startDate, endDate) {
  const allMovements = getMovements();
  const cancelLog = getCancelledSorties();

  // Current-state CANCELLED movements only.
  // Reinstated and soft-deleted rows are excluded automatically by this filter.
  const cancelledMovements = allMovements.filter(m => m.status === 'CANCELLED');

  // Join with the cancellation log to get metadata (reason, cancelledAt).
  // We look for the active (non-reinstated) log entry for each movement.
  const rows = cancelledMovements.map(m => {
    const logEntry = cancelLog.find(e =>
      e.sourceMovementId === m.id && !e.reinstated
    ) || null;

    const cancelledAt = logEntry ? (logEntry.cancelledAt || null) : null;

    // Date used for range filtering: prefer cancelledAt from log, fallback to dof.
    const cancelDate = cancelledAt
      ? cancelledAt.substring(0, 10)   // extract YYYY-MM-DD from ISO string
      : (m.dof || null);

    return {
      logId:            logEntry ? (logEntry.id || '') : '',
      sourceMovementId: m.id,
      flightType:       m.flightType || '',
      status:           m.status,
      cancelledAt:      cancelledAt || '',
      cancelDate:       cancelDate  || '',
      // Reason fields are mutable top-level fields on the log entry (current-state values).
      // We do NOT use the immutable snapshot reason to keep reporting aligned with edits.
      reasonCode:       logEntry ? (logEntry.cancellationReasonCode  || '') : '',
      reasonText:       logEntry ? (logEntry.cancellationReasonText  || '') : '',
      callsign:         m.callsignCode || m.callsignLabel || '',
      registration:     m.registration || '',
      aircraftType:     m.type || '',
      captain:          m.captain || '',
      depAd:            m.depAd  || '',
      arrAd:            m.arrAd  || '',
      dof:              m.dof    || '',
      rules:            m.rules  || '',
      depPlanned:       m.depPlanned || '',
      arrPlanned:       m.arrPlanned || '',
    };
  });

  // Date-range filter.
  // Rows with no cancelDate are included conservatively (no date to exclude on).
  const filtered = rows.filter(r => {
    if (!r.cancelDate) return true;
    if (startDate && r.cancelDate < startDate) return false;
    if (endDate   && r.cancelDate > endDate)   return false;
    return true;
  });

  const total    = filtered.length;
  const noReason = filtered.filter(r => !r.reasonCode).length;

  // Counts by reason code.
  const byReason = {};
  for (const code of CANCELLATION_REASON_ORDER) {
    byReason[code] = 0;
  }
  for (const r of filtered) {
    const key = CANCELLATION_REASON_ORDER.includes(r.reasonCode) ? r.reasonCode : '';
    byReason[key]++;
  }

  // Counts by flight type.
  const byFlightType = { DEP: 0, ARR: 0, LOC: 0, OVR: 0, '': 0 };
  for (const r of filtered) {
    const key = FLIGHT_TYPE_ORDER.includes(r.flightType) ? r.flightType : '';
    byFlightType[key]++;
  }

  // Ranked tables — blank/null values grouped as "unknown" and listed last.
  function buildRanked(rows, field, unknownLabel) {
    const counts = {};
    let unknownCount = 0;
    for (const r of rows) {
      const val = r[field] ? r[field].trim() : '';
      if (!val) {
        unknownCount++;
      } else {
        counts[val] = (counts[val] || 0) + 1;
      }
    }
    const ranked = Object.entries(counts)
      .map(([name, count]) => ({ name, count, isUnknown: false }))
      .sort((a, b) => b.count - a.count);
    if (unknownCount > 0) {
      ranked.push({ name: unknownLabel, count: unknownCount, isUnknown: true });
    }
    return ranked;
  }

  const ranked = {
    // Aircraft type — reliable when operators enter registration from VKB
    byAircraftType: buildRanked(filtered, 'aircraftType', 'Type not recorded'),
    // Registration — reliable when populated
    byRegistration: buildRanked(filtered, 'registration', 'Reg not recorded'),
    // Captain / PIC — only as reliable as the operator's input
    byCaptain:      buildRanked(filtered, 'captain',      'Captain not recorded'),
    // Departure aerodrome
    byDepAd:        buildRanked(filtered, 'depAd',        'Dep AD not recorded'),
    // Arrival aerodrome (ARR and LOC movements primarily)
    byArrAd:        buildRanked(filtered, 'arrAd',        'Arr AD not recorded'),
  };

  return { rows: filtered, total, noReason, byReason, byFlightType, ranked, startDate, endDate };
}

/**
 * Export the cancellation report row-level dataset as a CSV file.
 *
 * Includes current movement fields and current-state cancellation log metadata.
 * Does NOT include the immutable snapshot fields to keep the export aligned with
 * current-state reporting semantics.
 *
 * @param {Array}  rows     - Rows from computeCancellationReport().rows
 * @param {string} filename - Download filename
 */
export function exportCancellationsToCSV(rows, filename) {
  const BOM = '\uFEFF';  // UTF-8 BOM for Excel compatibility

  const headers = [
    'Log ID', 'Source Movement ID', 'Flight Type', 'Status',
    'Cancelled At (UTC)', 'Cancel Date', 'Reason Code', 'Reason Text',
    'Callsign', 'Registration', 'A/C Type', 'Captain',
    'Dep AD', 'Arr AD', 'DOF', 'Rules', 'ETD (Planned)', 'ETA (Planned)',
  ];

  function csvEscape(val) {
    const s = (val == null) ? '' : String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  const lines = [headers.map(csvEscape).join(',')];

  for (const r of rows) {
    const row = [
      r.logId,
      r.sourceMovementId,
      r.flightType,
      r.status,
      r.cancelledAt,
      r.cancelDate,
      r.reasonCode,
      r.reasonText,
      r.callsign,
      r.registration,
      r.aircraftType,
      r.captain,
      r.depAd,
      r.arrAd,
      r.dof,
      r.rules,
      r.depPlanned,
      r.arrPlanned,
    ];
    lines.push(row.map(csvEscape).join(','));
  }

  const csv = BOM + lines.join('\r\n');
  downloadFile(csv, filename, 'text/csv;charset=utf-8;');
}

// reporting.js
// Reporting engine for Official Monthly Return, Dashboard KPIs, and Insights leaderboards

import { getMovements } from './datamodel.js';
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
 * Calculate total weighted count for a movement
 * Formula: Total Count = Movement Number + T&G Duplication
 * @param {Object} movement - Movement object
 * @returns {number} Total weighted count
 */
export function getTotalWeightedCount(movement) {
  return getMovementNumber(movement) + getTngDuplication(movement);
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
      OW_FW: 0, // TODO: Define rule if needed
      TOTAL_CIV_FW: 0,
      NVY_HEL: 0,
      CIV_HEL: 0,
      MIL_HEL: 0,
      MIL_FIS: 0,
      CIV_FIS: 0,
      HOURS: null
    });
  }

  // Filter movements for this month
  const monthStr = String(month).padStart(2, '0');
  const monthMovements = movements.filter(m => {
    const dof = m.dof || '';
    return dof.startsWith(`${year}-${monthStr}`);
  });

  // Process each movement
  for (const m of monthMovements) {
    const classification = classifyMovement(m);
    const dof = m.dof || '';
    const day = parseInt(dof.split('-')[2], 10);

    if (day < 1 || day > daysInMonth) continue;

    const row = rows[day - 1];

    // Calculate weighted count for this movement
    // Formula: Total Count = Movement Number + T&G Duplication
    const movementNumber = getMovementNumber(m);
    const tngDuplication = getTngDuplication(m);
    const totalCount = movementNumber + tngDuplication;

    // Based Military counts (using weighted counting)
    if (classification.isMASUAS) row.MASUAS += totalCount;
    if (classification.isLUAS) row.LUAS += totalCount;
    if (classification.isAEF) row.AEF += totalCount;

    // Overshoot events (sum osCount, not flight count)
    const osCount = m.osCount || 0;
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

    // Helicopters (using weighted counting)
    if (classification.isNavyHeli) row.NVY_HEL += totalCount;
    if (classification.isVisitingCivHeli) row.CIV_HEL += totalCount;
    if (classification.isVisitingMilHeli) row.MIL_HEL += totalCount;

    // FIS events (sum fisCount)
    const fisCount = m.fisCount || 0;
    if (classification.isMilitary) row.MIL_FIS += fisCount;
    if (classification.isCivil) row.CIV_FIS += fisCount;
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
      movementCount: monthMovements.length
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

  for (const m of movements) {
    const captain = m.captain?.trim() || 'Unknown';
    const callsign = m.callsignCode?.trim() || 'Unknown';
    const registration = m.registration?.trim() || 'Unknown';

    if (m.captain?.trim()) captainPresent++;
    if (m.callsignCode?.trim()) callsignPresent++;
    if (m.registration?.trim()) registrationPresent++;

    // By Captain
    if (!byCaptain[captain]) {
      byCaptain[captain] = {
        name: captain,
        sorties: 0,
        overshoots: 0,
        overshootFlights: 0,
        fis: 0,
        fisFlights: 0,
        tng: 0,
        tngFlights: 0
      };
    }
    byCaptain[captain].sorties++;
    byCaptain[captain].overshoots += m.osCount || 0;
    if (m.osCount > 0) byCaptain[captain].overshootFlights++;
    byCaptain[captain].fis += m.fisCount || 0;
    if (m.fisCount > 0) byCaptain[captain].fisFlights++;
    byCaptain[captain].tng += m.tngCount || 0;
    if (m.tngCount > 0) byCaptain[captain].tngFlights++;

    // By Callsign
    if (!byCallsign[callsign]) {
      byCallsign[callsign] = {
        name: callsign,
        sorties: 0,
        overshoots: 0,
        overshootFlights: 0,
        fis: 0,
        fisFlights: 0,
        tng: 0,
        tngFlights: 0
      };
    }
    byCallsign[callsign].sorties++;
    byCallsign[callsign].overshoots += m.osCount || 0;
    if (m.osCount > 0) byCallsign[callsign].overshootFlights++;
    byCallsign[callsign].fis += m.fisCount || 0;
    if (m.fisCount > 0) byCallsign[callsign].fisFlights++;
    byCallsign[callsign].tng += m.tngCount || 0;
    if (m.tngCount > 0) byCallsign[callsign].tngFlights++;

    // By Registration
    if (!byRegistration[registration]) {
      byRegistration[registration] = {
        name: registration,
        sorties: 0,
        overshoots: 0,
        overshootFlights: 0,
        fis: 0,
        fisFlights: 0,
        tng: 0,
        tngFlights: 0
      };
    }
    byRegistration[registration].sorties++;
    byRegistration[registration].overshoots += m.osCount || 0;
    if (m.osCount > 0) byRegistration[registration].overshootFlights++;
    byRegistration[registration].fis += m.fisCount || 0;
    if (m.fisCount > 0) byRegistration[registration].fisFlights++;
    byRegistration[registration].tng += m.tngCount || 0;
    if (m.tngCount > 0) byRegistration[registration].tngFlights++;
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
    const totalCount = movementNumber + tngDuplication;

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
    const totalCount = movementNumber + tngDuplication;

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

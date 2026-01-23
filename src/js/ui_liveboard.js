// ui_liveboard.js
// Handles rendering and interactions for the Live Board, History, Reports, VKB, and Admin panels.
// ES module, no framework, DOM-contract driven.

import {
  getMovements,
  statusClass,
  statusLabel,
  createMovement,
  updateMovement,
  inferTypeFromReg,
  getETD,
  getATD,
  getETA,
  getATA,
  getECT,
  getACT,
  getConfig,
  convertUTCToLocal,
  getTimezoneOffsetLabel,
  validateTime,
  validateDate,
  validateNumberRange,
  validateRequired,
  checkPastTime
} from "./datamodel.js";

import { showToast } from "./app.js";

import {
  searchAll,
  getVKBStatus,
  getAutocompleteSuggestions,
  lookupRegistration,
  lookupRegistrationByFixedCallsign,
  lookupCallsign,
  lookupLocation,
  getLocationName,
  lookupAircraftType,
  getWTC,
  getVoiceCallsignForDisplay,
  lookupCaptainFromEgowCodes,
  lookupUnitCodeFromEgowCodes,
  lookupUnitFromCallsign,
  lookupOperatorFromCallsign,
  validateSquawkCode,
  isKnownContraction
} from "./vkb.js";

/* -----------------------------
   State
------------------------------ */

let expandedId = null;

const state = {
  globalFilter: "",
  plannedWindowHours: 24, // Show PLANNED movements within this many hours
  showLocalTimeInModals: false // Show local time conversions in modals
};

/* -----------------------------
   Small DOM helpers
------------------------------ */

function byId(id) {
  return document.getElementById(id);
}

function firstById(ids) {
  for (const id of ids) {
    const el = byId(id);
    if (el) return el;
  }
  return null;
}

function safeOn(el, eventName, handler) {
  if (!el) return;
  el.addEventListener(eventName, handler);
}

/**
 * Escape HTML to prevent XSS attacks
 * @param {string} s - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(s) {
  // Defensive; most values are demo data, but keep rendering resilient.
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Convert text input to uppercase on input event
 * Applies to aviation-related fields that should always be uppercase
 * @param {HTMLInputElement} inputElement - Input element to make uppercase
 */
function makeInputUppercase(inputElement) {
  if (!inputElement) return;

  inputElement.addEventListener("input", (e) => {
    const start = e.target.selectionStart;
    const end = e.target.selectionEnd;
    e.target.value = e.target.value.toUpperCase();
    // Restore cursor position after transformation
    e.target.setSelectionRange(start, end);
  });
}

/**
 * Debounce a function call
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/* -----------------------------
   Sorting
------------------------------ */

/**
 * Convert HH:MM time string to minutes since midnight
 * @param {string} t - Time string in HH:MM format
 * @returns {number} Minutes since midnight, or Infinity if invalid
 */
function timeToMinutes(t) {
  const s = (t || "").trim();
  if (!s) return Number.POSITIVE_INFINITY;
  const m = s.match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return Number.POSITIVE_INFINITY;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return Number.POSITIVE_INFINITY;
  return hh * 60 + mm;
}

/**
 * Get status rank for sorting (ACTIVE first, then PLANNED, then others)
 * @param {string} status - Movement status
 * @returns {number} Rank value (lower = higher priority)
 */
function statusRank(status) {
  const s = (status || "").toUpperCase();
  if (s === "ACTIVE") return 1;
  if (s === "PLANNED") return 2;
  return 3;
}

/**
 * Get planned time in minutes for a movement
 * @param {object} m - Movement object
 * @returns {number} Minutes since midnight for planned time
 */
function plannedSortMinutes(m) {
  const ft = (m.flightType || "").toUpperCase();
  if (ft === "ARR") return timeToMinutes(getETA(m));
  if (ft === "OVR") return timeToMinutes(getECT(m));
  return timeToMinutes(getETD(m));
}

/**
 * Get actual/active time in minutes for a movement
 * @param {object} m - Movement object
 * @returns {number} Minutes since midnight for actual time (or planned if not set)
 */
function activeSortMinutes(m) {
  const ft = (m.flightType || "").toUpperCase();
  if (ft === "ARR") return timeToMinutes(getATA(m) || getETA(m));
  if (ft === "LOC") return timeToMinutes(getATD(m) || getATA(m) || getETD(m));
  if (ft === "OVR") return timeToMinutes(getACT(m) || getECT(m));
  return timeToMinutes(getATD(m) || getETD(m));
}

/**
 * Get sort time for a movement based on status
 * @param {object} m - Movement object
 * @returns {number} Minutes since midnight for sorting
 */
function movementSortMinutes(m) {
  const s = (m.status || "").toUpperCase();
  if (s === "ACTIVE") return activeSortMinutes(m);
  if (s === "PLANNED") return plannedSortMinutes(m);
  return activeSortMinutes(m);
}

/**
 * Get DOF (Date of Flight) as comparable timestamp
 * @param {object} m - Movement object
 * @returns {number} Timestamp in milliseconds, or 0 if no DOF
 */
function getDOFTimestamp(m) {
  if (!m.dof) return 0; // No DOF = treat as earliest
  const date = new Date(m.dof + "T00:00:00Z"); // Parse as UTC midnight
  return date.getTime();
}

/**
 * Compare two movements for Live Board sorting
 * Sort order: Status (ACTIVE, PLANNED, others), DOF (nearest first), Time (earliest first), ID
 * @param {object} a - First movement
 * @param {object} b - Second movement
 * @returns {number} Comparison result (-1, 0, 1)
 */
function compareForLiveBoard(a, b) {
  // 1. Sort by status (ACTIVE first, then PLANNED) - prioritize status over date
  const ra = statusRank(a.status);
  const rb = statusRank(b.status);
  if (ra !== rb) return ra - rb;

  // 2. Sort by DOF (nearest date first within same status)
  const dofA = getDOFTimestamp(a);
  const dofB = getDOFTimestamp(b);
  if (dofA !== dofB) return dofA - dofB;

  // 3. Sort by time (earliest first within the same date and status)
  const ta = movementSortMinutes(a);
  const tb = movementSortMinutes(b);
  if (ta !== tb) return ta - tb;

  // 4. Sort by ID as tiebreaker
  return (a.id || 0) - (b.id || 0);
}

function flightTypeClass(ft) {
  const t = (ft || "").toUpperCase();
  if (t === "ARR") return "ft-arr";
  if (t === "DEP") return "ft-dep";
  if (t === "LOC") return "ft-loc";
  if (t === "OVR") return "ft-ovr";
  return "ft-unk";
}

/* -----------------------------
   Filters
------------------------------ */

function getStatusFilterValue() {
  const select = byId("statusFilter");
  return select ? select.value : "planned_active";
}

/**
 * Get the planned time for a movement as a Date object
 * Uses ETD/ETA/ECT based on flight type
 * @param {object} m - Movement object
 * @returns {Date|null} Parsed date or null if no valid time
 */
function getMovementPlannedTime(m) {
  const ft = (m.flightType || "").toUpperCase();
  let timeStr = null;

  // Get the appropriate planned time based on flight type
  if (ft === "DEP" || ft === "LOC") {
    timeStr = getETD(m);
  } else if (ft === "ARR") {
    timeStr = getETA(m);
  } else if (ft === "OVR") {
    timeStr = getECT(m);
  }

  if (!timeStr) return null;

  // Parse HH:MM format and create Date object for today
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const now = new Date();
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);

  const movementDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);

  // If the time is before current time, assume it's tomorrow
  if (movementDate < now) {
    movementDate.setDate(movementDate.getDate() + 1);
  }

  return movementDate;
}

function matchesFilters(m) {
  const statusFilter = getStatusFilterValue();

  if (statusFilter === "active" && m.status !== "ACTIVE") return false;

  if (
    statusFilter === "planned_active" &&
    !(m.status === "PLANNED" || m.status === "ACTIVE")
  ) {
    return false;
  }

  // Time window filter for PLANNED movements only
  if (m.status === "PLANNED" && state.plannedWindowHours < 999999) {
    const movementTime = getMovementPlannedTime(m);
    if (movementTime) {
      const now = new Date();
      const windowEnd = new Date(now.getTime() + state.plannedWindowHours * 60 * 60 * 1000);

      if (movementTime > windowEnd) {
        return false; // Movement is beyond the time window
      }
    }
  }

  const gq = state.globalFilter.trim().toLowerCase();
  if (gq) {
    const haystack = [
      m.callsignCode,
      m.callsignLabel,
      m.registration,
      m.type,
      m.depAd,
      m.depName,
      m.arrAd,
      m.arrName,
      m.egowCode,
      m.egowDesc
    ]
      .join(" ")
      .toLowerCase();

    if (!haystack.includes(gq)) return false;
  }

  return true;
}

/* -----------------------------
   Live Board rendering
------------------------------ */

function renderBadges(m) {
  const parts = [];
  parts.push(`<span class="badge">${escapeHtml(m.flightType)}</span>`);

  if (m.isLocal) parts.push(`<span class="badge badge-local">Local</span>`);
  if (m.tngCount) parts.push(`<span class="badge badge-tng">T&amp;G × ${escapeHtml(m.tngCount)}</span>`);
  if (m.osCount) parts.push(`<span class="badge badge-os">O/S × ${escapeHtml(m.osCount)}</span>`);
  if (m.fisCount) parts.push(`<span class="badge badge-fis">FIS × ${escapeHtml(m.fisCount)}</span>`);

  if (m.formation && Array.isArray(m.formation.elements)) {
    parts.push(
      `<span class="badge badge-formation">F×${escapeHtml(m.formation.elements.length)}</span>`
    );
  }

  return parts.join("\n");
}

/**
 * Get full flight type name
 * @param {string} flightType - Flight type abbreviation (DEP, ARR, LOC, OVR)
 * @returns {string} Full flight type name
 */
function getFullFlightType(flightType) {
  const ft = (flightType || "").toUpperCase();
  switch (ft) {
    case "DEP": return "DEPARTURE";
    case "ARR": return "ARRIVAL";
    case "LOC": return "LOCAL";
    case "OVR": return "OVERFLIGHT";
    default: return flightType || "—";
  }
}

/**
 * Get EGOW code description in plain text
 * @param {string} egowCode - EGOW code (BM, BC, VM, VC, etc.)
 * @returns {string} Plain text description
 */
function getEgowCodeDescription(egowCode) {
  const code = (egowCode || "").toUpperCase();
  switch (code) {
    case "BM": return "Based Military";
    case "BC": return "Based Civil";
    case "VM": return "Visiting Military";
    case "VMH": return "Visiting Military Helicopter";
    case "VC": return "Visiting Civil";
    default: return code || "—";
  }
}

/**
 * Get color for EGOW code indicator bar
 * @param {string} egowCode - EGOW code
 * @param {string} unitCode - Unit code (L, M, A)
 * @returns {string} CSS color value
 */
function getEgowIndicatorColor(egowCode, unitCode) {
  const code = (egowCode || "").toUpperCase();
  const unit = (unitCode || "").toUpperCase();

  if (code === "BM") {
    switch (unit) {
      case "L": return "#2196F3"; // Blue
      case "M": return "#f44336"; // Red
      case "A": return "#FFC107"; // Yellow
      default: return "#9E9E9E"; // Grey fallback
    }
  }

  switch (code) {
    case "BC": return "#000000"; // Black
    case "VM":
    case "VMH": return "#4CAF50"; // Green
    default: return "#9E9E9E"; // Grey fallback
  }
}

function renderFormationDetails(m) {
  if (!m.formation || !Array.isArray(m.formation.elements)) return "";

  const rows = m.formation.elements
    .map((el) => {
      return `
        <tr>
          <td>${escapeHtml(el.callsign)}</td>
          <td>${escapeHtml(el.reg || "—")}</td>
          <td>${escapeHtml(el.type || "—")}</td>
          <td>${escapeHtml(el.wtc || "—")}</td>
          <td>${escapeHtml(statusLabel(el.status))}</td>
          <td>${escapeHtml(el.depActual || "—")}</td>
          <td>${escapeHtml(el.arrActual || "—")}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="expand-subsection">
      <div class="expand-title">Formation</div>
      <div class="kv">
        <div class="kv-label">Label</div><div class="kv-value">${escapeHtml(m.formation.label)}</div>
        <div class="kv-label">Current WTC</div><div class="kv-value">${escapeHtml(m.formation.wtcCurrent)}</div>
        <div class="kv-label">Max WTC</div><div class="kv-value">${escapeHtml(m.formation.wtcMax)}</div>
      </div>
      <table class="formation-table">
        <thead>
          <tr>
            <th>Element</th>
            <th>Reg</th>
            <th>Type</th>
            <th>WTC</th>
            <th>Status</th>
            <th>Dep</th>
            <th>Arr</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Generate all active alerts for a movement
 * @param {Object} m - Movement object
 * @returns {Array} Array of alert objects {type, severity, message}
 */
function generateMovementAlerts(m) {
  const alerts = [];
  const now = new Date();
  const todayStr = getTodayDateString();
  const ft = (m.flightType || "").toUpperCase();

  // Check for stale movement (24+ hours old)
  if (m.dof && m.dof < todayStr) {
    const dofDate = new Date(m.dof + "T00:00:00Z");
    const hoursOld = Math.floor((now - dofDate) / (1000 * 60 * 60));
    if (hoursOld >= 24) {
      alerts.push({
        type: 'stale',
        severity: 'warning',
        message: `Movement is ${hoursOld} hours old - still relevant?`
      });
    }
  }

  // Check for overdue arrival (CAA 493 - ARR only)
  if (ft === "ARR" && m.status === "ACTIVE") {
    const eta = getETA(m);
    if (eta && eta !== "-" && m.dof) {
      const etaParts = eta.split(':');
      if (etaParts.length === 2) {
        const etaHours = parseInt(etaParts[0], 10);
        const etaMinutes = parseInt(etaParts[1], 10);

        const etaDate = new Date(m.dof + "T00:00:00Z");
        etaDate.setUTCHours(etaHours, etaMinutes, 0, 0);

        const minutesPastEta = Math.floor((now - etaDate) / (1000 * 60));

        if (minutesPastEta >= 60) {
          alerts.push({
            type: 'overdue_full',
            severity: 'critical',
            message: `FULL OVERDUE ACTION: Aircraft is ${minutesPastEta} minutes past ETA`
          });
        } else if (minutesPastEta >= 30) {
          alerts.push({
            type: 'overdue_preliminary',
            severity: 'warning',
            message: `PRELIMINARY OVERDUE ACTION: Aircraft is ${minutesPastEta} minutes past ETA`
          });
        }
      }
    }
  }

  // Check for emergency squawks (7500, 7600, 7700)
  const squawkCode = (m.squawk || '').replace('#', '');
  if (squawkCode === '7500') {
    alerts.push({
      type: 'emergency_hijack',
      severity: 'critical',
      message: 'EMERGENCY SQUAWK 7500 - Unlawful interference / Hijacking'
    });
  } else if (squawkCode === '7600') {
    alerts.push({
      type: 'emergency_radio',
      severity: 'critical',
      message: 'EMERGENCY SQUAWK 7600 - Radio failure / Lost communications'
    });
  } else if (squawkCode === '7700') {
    alerts.push({
      type: 'emergency_general',
      severity: 'critical',
      message: 'EMERGENCY SQUAWK 7700 - General emergency'
    });
  }

  // Check for wake turbulence category alert
  const config = getConfig();
  const wtcSystem = config.wtcSystem || "ICAO";
  const wtcThreshold = config.wtcAlertThreshold || "off";

  if (wtcThreshold !== "off" && m.wtc) {
    const wtcValue = (m.wtc || "").toUpperCase();
    let shouldAlert = false;
    let categoryName = "";

    if (wtcSystem === "ICAO") {
      // ICAO hierarchy: M=1, H=2, J=3 (L removed)
      const wtcHierarchy = { "M": 1, "H": 2, "J": 3 };
      const categoryNames = { "M": "Medium", "H": "Heavy", "J": "Super/Jumbo" };
      const threshold = wtcHierarchy[wtcThreshold];
      const current = wtcHierarchy[wtcValue];

      if (threshold && current && current >= threshold) {
        shouldAlert = true;
        categoryName = categoryNames[wtcValue] || wtcValue;
      }
    } else if (wtcSystem === "UK") {
      // UK RECAT-EU hierarchy: B=1, C=2, D=3, E=4, F=5 (A is largest, F is smallest, but we alert from threshold up)
      // Actually for UK RECAT: A is highest wake, F is lowest. Hierarchy should be A=6, B=5, C=4, D=3, E=2, F=1
      const wtcHierarchy = { "A": 6, "B": 5, "C": 4, "D": 3, "E": 2, "F": 1 };
      const categoryNames = { "A": "Cat A", "B": "Cat B", "C": "Cat C", "D": "Cat D", "E": "Cat E", "F": "Cat F" };
      const threshold = wtcHierarchy[wtcThreshold];
      const current = wtcHierarchy[wtcValue];

      if (threshold && current && current >= threshold) {
        shouldAlert = true;
        categoryName = categoryNames[wtcValue] || wtcValue;
      }
    }

    if (shouldAlert) {
      alerts.push({
        type: 'wtc_alert',
        severity: 'warning',
        message: `Wake turbulence category ${categoryName} (${wtcValue}) - Be aware of separation requirements`
      });
    }
  }

  // Check for callsign confusion risks
  // Self-exclusion helper
  const isSameMovement = (a, b) => {
    if (a === b) return true;
    if (a?.id != null && b?.id != null) return a.id === b.id;
    return false;
  };

  const allMovements = getMovements();
  const activeOrPlannedMovements = allMovements.filter(mov =>
    (mov.status === 'ACTIVE' || mov.status === 'PLANNED') && !isSameMovement(mov, m)
  );

  // Normalize callsign and registration
  const thisCallsignRaw = (m.callsignCode || '').toUpperCase().trim();
  const thisRegRaw = (m.registration || '').toUpperCase().trim();
  const thisCallsignNorm = thisCallsignRaw.replace(/[-\s]/g, '');
  const thisRegNorm = thisRegRaw.replace(/[-\s]/g, '');

  // Helper: compute registration abbreviation key using UK CAP 413 logic
  function getRegAbbrevKey(regNorm) {
    if (!regNorm) return '';
    // US N-number special case: N + last 3
    if (/^N[0-9A-Z]+$/.test(regNorm) && regNorm.length >= 4) {
      return 'N' + regNorm.slice(-3);
    }
    // Default: first + last 2
    if (regNorm.length >= 3) {
      return regNorm[0] + regNorm.slice(-2);
    }
    return regNorm; // fallback
  }

  // 1. Registration-based callsign confusion (UK CAP 413-aligned)
  if (thisRegNorm && thisCallsignNorm === thisRegNorm) {
    const thisKey = getRegAbbrevKey(thisRegNorm);

    // Check for conflicts with other registration-based callsigns
    const conflictingRegs = activeOrPlannedMovements.filter(mov => {
      const otherCallsignRaw = (mov.callsignCode || '').toUpperCase().trim();
      const otherRegRaw = (mov.registration || '').toUpperCase().trim();
      const otherCallsignNorm = otherCallsignRaw.replace(/[-\s]/g, '');
      const otherRegNorm = otherRegRaw.replace(/[-\s]/g, '');

      // Only consider if other also uses registration as callsign
      if (otherRegNorm && otherCallsignNorm === otherRegNorm) {
        const otherKey = getRegAbbrevKey(otherRegNorm);
        // Conflict if same abbreviation key but different registrations
        return thisKey === otherKey && thisRegNorm !== otherRegNorm;
      }
      return false;
    });

    if (conflictingRegs.length > 0) {
      const otherCallsigns = conflictingRegs.map(mov => mov.callsignCode).join(', ');
      alerts.push({
        type: 'callsign_confusion_reg',
        severity: 'warning',
        message: `Registration callsign conflict: ${m.callsignCode} and ${otherCallsigns} both abbreviate to "${thisKey}"`
      });
    }

    // Guardrail: check if abbreviation key collides with known VKB contractions
    if (thisKey.length === 3 && isKnownContraction(thisKey)) {
      alerts.push({
        type: 'callsign_confusion_contraction',
        severity: 'warning',
        message: `Abbrev collision: "${thisKey}" matches a callsign contraction. Avoid abbreviated registration callsign.`
      });
    }
  }

  // 2. University Air Squadron (UA_) abbreviated callsign confusion
  const uaCodes = ['UAA', 'UAD', 'UAF', 'UAH', 'UAI', 'UAJ', 'UAM', 'UAO', 'UAQ', 'UAS', 'UAT', 'UAU', 'UAV', 'UAW', 'UAX', 'UAY'];
  let thisUaCode = null;
  let thisUaNumber = null;

  for (const code of uaCodes) {
    if (thisCallsignNorm.startsWith(code)) {
      thisUaCode = code;
      thisUaNumber = thisCallsignNorm.substring(code.length);
      break;
    }
  }

  if (thisUaCode && thisUaNumber) {
    const conflictingUa = activeOrPlannedMovements.filter(mov => {
      if (isSameMovement(mov, m)) return false;
      const otherCallsignRaw = (mov.callsignCode || '').toUpperCase().trim();
      const otherCallsignNorm = otherCallsignRaw.replace(/[-\s]/g, '');
      for (const code of uaCodes) {
        if (code !== thisUaCode && otherCallsignNorm.startsWith(code)) {
          const otherNumber = otherCallsignNorm.substring(code.length);
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

  // 3. Military non-standard vs ICAO abbreviation confusion
  const knownConflicts = [
    { military: 'CRMSN', icao: 'OUA', phonetic: 'CRIMSON' }
    // Add more known conflicts here as needed
  ];

  for (const conflict of knownConflicts) {
    const conflictingMilitary = activeOrPlannedMovements.filter(mov => {
      if (isSameMovement(mov, m)) return false;
      const otherCallsignRaw = (mov.callsignCode || '').toUpperCase().trim();
      const otherCallsignNorm = otherCallsignRaw.replace(/[-\s]/g, '');
      return (thisCallsignNorm.startsWith(conflict.military) && otherCallsignNorm.startsWith(conflict.icao)) ||
             (thisCallsignNorm.startsWith(conflict.icao) && otherCallsignNorm.startsWith(conflict.military));
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

  return alerts;
}

function renderExpandedRow(tbody, m) {
  const expTr = document.createElement("tr");
  expTr.className = "expand-row";

  const expTd = document.createElement("td");

  // Dynamically calculate colspan to span the full table width
  const table = tbody.closest("table");
  const colCount =
    table?.querySelector("thead tr")?.children?.length ||
    table?.querySelector("tbody tr")?.children?.length ||
    12; // fallback

  expTd.colSpan = colCount;

  // Get aircraft type info
  const typeData = lookupAircraftType(m.type);
  const typeDisplay = m.type ? `${escapeHtml(m.type)}${typeData && typeData['Common Name'] ? ` (${escapeHtml(typeData['Common Name'])})` : ''}` : "—";

  // Format squawk display (always prepend # if not already present)
  let squawkDisplay = m.squawk || "—";
  if (m.squawk && m.squawk !== "—") {
    squawkDisplay = m.squawk.startsWith('#') ? escapeHtml(m.squawk) : `#${escapeHtml(m.squawk)}`;
  }

  // Generate alerts for this movement
  const alerts = generateMovementAlerts(m);

  // Render alerts section
  const alertsSection = alerts.length > 0 ? `
    <div class="expand-section expand-section-alerts">
      <div class="expand-subsection">
        <div class="expand-title">Alerts</div>
        <div class="alerts-list">
          ${alerts.map(alert => {
            let iconClass = '';
            let alertClass = '';
            if (alert.severity === 'critical') {
              iconClass = '🔴';
              alertClass = 'alert-critical';
            } else if (alert.severity === 'warning') {
              iconClass = '⚠️';
              alertClass = 'alert-warning';
            } else {
              iconClass = 'ℹ️';
              alertClass = 'alert-info';
            }
            return `<div class="alert-item ${alertClass}"><span class="alert-icon">${iconClass}</span> ${escapeHtml(alert.message)}</div>`;
          }).join('')}
        </div>
      </div>
    </div>
  ` : '';

  expTd.innerHTML = `
    <div class="expand-inner">
      <div class="expand-section">
        <div class="expand-subsection">
          <div class="expand-title">Movement Summary</div>
          <div class="kv">
            <div class="kv-label">Status</div><div class="kv-value">${escapeHtml(statusLabel(m.status))}</div>
            <div class="kv-label">Flight Type</div><div class="kv-value">${escapeHtml(getFullFlightType(m.flightType))}</div>
            <div class="kv-label">Departure</div><div class="kv-value">${escapeHtml(m.depAd)} – ${escapeHtml(m.depName)}</div>
            <div class="kv-label">Arrival</div><div class="kv-value">${escapeHtml(m.arrAd)} – ${escapeHtml(m.arrName)}</div>
            <div class="kv-label">Captain</div><div class="kv-value">${escapeHtml(m.captain || "—")}</div>
            <div class="kv-label">POB</div><div class="kv-value">${escapeHtml(m.pob ?? "—")}</div>
            <div class="kv-label">T&amp;Gs</div><div class="kv-value">${escapeHtml(m.tngCount ?? 0)}</div>
            <div class="kv-label">O/S count</div><div class="kv-value">${escapeHtml(m.osCount ?? 0)}</div>
            <div class="kv-label">FIS count</div><div class="kv-value">${escapeHtml(m.fisCount ?? 0)}</div>
          </div>
        </div>
        ${renderFormationDetails(m)}
      </div>

      <div class="expand-section">
        <div class="expand-subsection">
          <div class="expand-title">Coding &amp; Classification</div>
          <div class="kv">
            <div class="kv-label">ACFT TYPE</div><div class="kv-value">${typeDisplay}</div>
            <div class="kv-label">EGOW CODE</div><div class="kv-value">${escapeHtml(getEgowCodeDescription(m.egowCode))}</div>
            <div class="kv-label">EGOW UNIT</div><div class="kv-value">${escapeHtml(m.unitCode || "—")}</div>
            <div class="kv-label">UNIT</div><div class="kv-value">${escapeHtml(m.unitDesc || "—")}</div>
            <div class="kv-label">OPERATOR</div><div class="kv-value">${escapeHtml(m.operator || "—")}</div>
          </div>
        </div>
      </div>

      <div class="expand-section">
        <div class="expand-subsection">
          <div class="expand-title">Additional</div>
          <div class="kv">
            ${m.remarks && m.remarks !== '' && m.remarks !== '-' ? `<div class="kv-label">REMARKS EXTD</div><div class="kv-value">${escapeHtml(m.remarks)}</div>` : ''}
            ${m.warnings && m.warnings !== '' && m.warnings !== '-' ? `<div class="kv-label">WARNINGS</div><div class="kv-value" style="color: #d32f2f; font-weight: 600;">${escapeHtml(m.warnings)}</div>` : ''}
            ${m.notes && m.notes !== '' && m.notes !== '-' ? `<div class="kv-label">NOTES</div><div class="kv-value">${escapeHtml(m.notes)}</div>` : ''}
            ${m.squawk && m.squawk !== '' && m.squawk !== '-' && m.squawk !== '—' ? `<div class="kv-label">SQUAWK</div><div class="kv-value">${squawkDisplay}</div>` : ''}
            ${m.route && m.route !== '' && m.route !== '-' ? `<div class="kv-label">ROUTE</div><div class="kv-value">${escapeHtml(m.route)}</div>` : ''}
            ${m.clearance && m.clearance !== '' && m.clearance !== '-' ? `<div class="kv-label">CLEARANCE</div><div class="kv-value">${escapeHtml(m.clearance)}</div>` : ''}
          </div>
        </div>
      </div>

      ${alertsSection}
    </div>
  `;

  expTr.appendChild(expTd);
  tbody.appendChild(expTr);
}

/**
 * Auto-activate PLANNED arrivals when they reach the configured time before ETA
 */
function autoActivatePlannedArrivals() {
  const config = getConfig();

  // Check if auto-activation is enabled
  if (!config.autoActivateEnabled) {
    return;
  }

  const now = new Date();
  const minutesBeforeEta = Math.min(config.autoActivateMinutesBeforeEta || 30, 120); // Max 2 hours

  // Get all PLANNED arrivals
  const plannedArrivals = getMovements().filter(m =>
    m.status === 'PLANNED' &&
    (m.flightType === 'ARR' || m.flightType === 'LOC')
  );

  for (const movement of plannedArrivals) {
    const eta = getETA(movement);

    // Skip if no valid ETA or DOF
    if (!eta || eta === '-' || !movement.dof) {
      continue;
    }

    // Parse ETA time (HH:MM format)
    const etaParts = eta.split(':');
    if (etaParts.length !== 2) {
      continue;
    }

    const etaHours = parseInt(etaParts[0], 10);
    const etaMinutes = parseInt(etaParts[1], 10);

    // Create ETA date object
    const etaDate = new Date(movement.dof + 'T00:00:00Z');
    etaDate.setUTCHours(etaHours, etaMinutes, 0, 0);

    // Calculate minutes until ETA
    const minutesUntilEta = Math.floor((etaDate - now) / (1000 * 60));

    // Auto-activate if within the configured window
    if (minutesUntilEta <= minutesBeforeEta && minutesUntilEta >= -60) {
      // Don't auto-activate if more than 1 hour past ETA (probably stale)
      transitionToActive(movement.id);
    }
  }
}

export function renderLiveBoard() {
  const tbody = byId("liveBody");
  if (!tbody) return;

  // Auto-activate PLANNED arrivals before ETA if enabled
  autoActivatePlannedArrivals();

  tbody.innerHTML = "";

  const movements = getMovements().filter(matchesFilters).slice().sort(compareForLiveBoard);

  let previousStatus = null;

  for (const m of movements) {
    // Insert divider when transitioning from ACTIVE to PLANNED
    if (previousStatus === "ACTIVE" && m.status === "PLANNED") {
      const dividerTr = document.createElement("tr");
      dividerTr.className = "status-divider-row";
      dividerTr.innerHTML = `
        <td colspan="12" style="padding: 0;">
          <div style="height: 2px; background: linear-gradient(to right, transparent, #ccc, transparent); margin: 4px 0;"></div>
        </td>
      `;
      tbody.appendChild(dividerTr);
    }

    previousStatus = m.status;

    const tr = document.createElement("tr");
    tr.className = `strip strip-row ${flightTypeClass(m.flightType)}`;
    tr.dataset.id = String(m.id);

    // Use semantic time fields based on flight type
    const ft = (m.flightType || "").toUpperCase();
    let depDisplay = "-";
    let arrDisplay = "-";

    if (ft === "DEP" || ft === "LOC") {
      depDisplay = getATD(m) || getETD(m) || "-";
    }
    if (ft === "ARR" || ft === "LOC") {
      arrDisplay = getATA(m) || getETA(m) || "-";
    }
    if (ft === "OVR") {
      depDisplay = getACT(m) || getECT(m) || "-";
      arrDisplay = "-";
    }

    // Format date (DD/MM/YYYY)
    const dofFormatted = m.dof ? m.dof.split('-').reverse().join('/') : '';

    // Get rules display (single letter)
    let rulesDisplay = '';
    if (m.rules === 'VFR') rulesDisplay = 'V';
    else if (m.rules === 'IFR') rulesDisplay = 'I';
    else if (m.rules === 'Y') rulesDisplay = 'Y';
    else if (m.rules === 'Z') rulesDisplay = 'Z';
    else if (m.rules === 'SVFR') rulesDisplay = 'S';

    // Generate all alerts for this movement
    const alerts = generateMovementAlerts(m);
    const config = getConfig();
    const enableTooltips = config.enableAlertTooltips !== false;

    // Determine highlighting and tooltips based on alerts
    let overdueStyle = '';
    let tooltipTitle = '';
    const staleAlert = alerts.find(a => a.type === 'stale');
    const overdueFullAlert = alerts.find(a => a.type === 'overdue_full');
    const overduePrelimAlert = alerts.find(a => a.type === 'overdue_preliminary');
    const emergencyAlert = alerts.find(a => a.type === 'emergency_hijack' || a.type === 'emergency_radio' || a.type === 'emergency_general');

    // Emergency squawks take priority - red highlight
    if (emergencyAlert) {
      overdueStyle = 'background-color: #ffcccc;';
      if (enableTooltips) {
        tooltipTitle = ` title="${escapeHtml(emergencyAlert.message)}"`;
      }
    } else if (overdueFullAlert) {
      overdueStyle = 'background-color: #ffcccc;';
      if (enableTooltips) {
        tooltipTitle = ` title="${escapeHtml(overdueFullAlert.message)}"`;
      }
    } else if (overduePrelimAlert) {
      overdueStyle = 'background-color: #ffeb3b;';
      if (enableTooltips) {
        tooltipTitle = ` title="${escapeHtml(overduePrelimAlert.message)}"`;
      }
    }

    // Keep stale warning for date display
    const now = new Date();
    const todayStr = getTodayDateString();
    let staleWarning = '';
    if (staleAlert) {
      staleWarning = `⚠ ${staleAlert.message}`;
    }

    // Get indicator bar color
    const indicatorColor = getEgowIndicatorColor(m.egowCode, m.unitCode);
    const indicatorTitle = `${m.egowCode || ''}${m.unitCode ? ' - ' + m.unitCode : ''}`;

    // Check for callsign confusion alerts
    const hasCallsignConfusion = alerts.some(a =>
      a.type === 'callsign_confusion_reg' ||
      a.type === 'callsign_confusion_contraction' ||
      a.type === 'callsign_confusion_ua' ||
      a.type === 'callsign_confusion_military'
    );
    const callsignClass = hasCallsignConfusion ? 'call-main callsign-confusion' : 'call-main';

    // Check for WTC alert
    const hasWtcAlert = alerts.some(a => a.type === 'wtc_alert');
    const wtcDisplay = hasWtcAlert
      ? `<span class="wtc-alert">${escapeHtml(m.wtc || "—")}</span>`
      : escapeHtml(m.wtc || "—");

    tr.innerHTML = `
      <td><div class="status-strip" style="background-color: ${indicatorColor};" title="${escapeHtml(indicatorTitle)}"></div></td>
      <td>
        <div class="${callsignClass}">${escapeHtml(m.callsignCode)}</div>
        <div class="call-sub">${m.callsignVoice ? escapeHtml(m.callsignVoice) : "&nbsp;"}</div>
      </td>
      <td class="priority-cell" style="text-align: center; ${m.priorityLetter ? 'padding: 0 6px 0 4px;' : 'padding: 0; width: 0;'}">
        ${m.priorityLetter ? `<span class="priority-letter" title="Flight Priority ${escapeHtml(m.priorityLetter)}">${escapeHtml(m.priorityLetter)}</span>` : ''}
      </td>
      <td>
        <div class="cell-strong">${escapeHtml(m.registration || "—")}${m.type ? ` · <span title="${escapeHtml(m.popularName || '')}">${escapeHtml(m.type)}</span>` : ""}</div>
        <div class="cell-muted">WTC: ${wtcDisplay}</div>
      </td>
      <td>
        <div class="cell-strong"><span${m.depName && m.depName !== '' ? ` title="${m.depName}"` : ''}>${escapeHtml(m.depAd)}</span></div>
        <div class="cell-strong"><span${m.arrName && m.arrName !== '' ? ` title="${m.arrName}"` : ''}>${escapeHtml(m.arrAd)}</span></div>
      </td>
      <td style="text-align: center;">
        <div class="cell-strong">${rulesDisplay}</div>
      </td>
      <td style="${overdueStyle}"${tooltipTitle}>
        <div class="cell-strong">${escapeHtml(depDisplay)} / ${escapeHtml(arrDisplay)}</div>
        <div class="cell-muted">${staleWarning ? `<span class="stale-movement" title="${staleWarning}">${dofFormatted}</span>` : dofFormatted}<br>${escapeHtml(m.flightType)} · ${escapeHtml(statusLabel(m.status))}</div>
      </td>
      <td style="text-align: center;">
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;">
          <span style="min-width: 20px; text-align: center; font-weight: 600;">${m.tngCount || 0}</span>
          <div style="display: flex; gap: 4px;">
            <button class="counter-btn js-dec-tng" data-id="${m.id}" type="button" aria-label="Decrease T&G">◄</button>
            <button class="counter-btn js-inc-tng" data-id="${m.id}" type="button" aria-label="Increase T&G">►</button>
          </div>
        </div>
      </td>
      <td style="text-align: center;">
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;">
          <span style="min-width: 20px; text-align: center; font-weight: 600;">${m.osCount || 0}</span>
          <div style="display: flex; gap: 4px;">
            <button class="counter-btn js-dec-os" data-id="${m.id}" type="button" aria-label="Decrease O/S">◄</button>
            <button class="counter-btn js-inc-os" data-id="${m.id}" type="button" aria-label="Increase O/S">►</button>
          </div>
        </div>
      </td>
      <td style="text-align: center;">
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;">
          <span style="min-width: 20px; text-align: center; font-weight: 600;">${m.fisCount || 0}</span>
          <div style="display: flex; gap: 4px;">
            <button class="counter-btn js-dec-fis" data-id="${m.id}" type="button" aria-label="Decrease FIS">◄</button>
            <button class="counter-btn js-inc-fis" data-id="${m.id}" type="button" aria-label="Increase FIS">►</button>
          </div>
        </div>
      </td>
      <td>
        <div style="font-size: 12px;">${escapeHtml(m.remarks || '')}</div>
      </td>
      <td class="actions-cell">
        <div style="display: flex; gap: 6px; justify-content: flex-end;">
          <div style="display: flex; flex-direction: column; gap: 2px;">
            ${
              m.status === "PLANNED"
                ? '<button class="small-btn js-activate" type="button" aria-label="Activate movement">→ Active</button>'
                : m.status === "ACTIVE"
                ? '<button class="small-btn js-complete" type="button" aria-label="Complete movement">→ Complete</button>'
                : ""
            }
            <button class="small-btn js-edit-movement" type="button" aria-label="Edit movement ${escapeHtml(m.callsignCode)}">Edit</button>
          </div>
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <button class="small-btn js-duplicate" type="button" aria-label="Duplicate movement">Duplicate</button>
            <button class="small-btn js-toggle-details" type="button" aria-label="Toggle details for ${escapeHtml(m.callsignCode)}">Details ▾</button>
          </div>
        </div>
      </td>
    `;

    // Bind Edit button
    const editBtn = tr.querySelector(".js-edit-movement");
    safeOn(editBtn, "click", (e) => {
      e.stopPropagation();
      openEditMovementModal(m);
    });

    // Bind status transition buttons
    const activateBtn = tr.querySelector(".js-activate");
    safeOn(activateBtn, "click", (e) => {
      e.stopPropagation();
      transitionToActive(m.id);
    });

    const completeBtn = tr.querySelector(".js-complete");
    safeOn(completeBtn, "click", (e) => {
      e.stopPropagation();
      transitionToCompleted(m.id);
    });

    // Bind Duplicate button
    const duplicateBtn = tr.querySelector(".js-duplicate");
    safeOn(duplicateBtn, "click", (e) => {
      e.stopPropagation();
      openDuplicateMovementModal(m);
    });

    // Bind details toggle
    const toggleBtn = tr.querySelector(".js-toggle-details");
    safeOn(toggleBtn, "click", (e) => {
      e.stopPropagation();
      expandedId = expandedId === m.id ? null : m.id;
      renderLiveBoard();
    });

    // Bind counter increment/decrement buttons
    const incTng = tr.querySelector(".js-inc-tng");
    safeOn(incTng, "click", (e) => {
      e.stopPropagation();
      updateMovement(m.id, { tngCount: Math.min((m.tngCount || 0) + 1, 99) });
      renderLiveBoard();
      renderHistoryBoard();
    });

    const decTng = tr.querySelector(".js-dec-tng");
    safeOn(decTng, "click", (e) => {
      e.stopPropagation();
      updateMovement(m.id, { tngCount: Math.max((m.tngCount || 0) - 1, 0) });
      renderLiveBoard();
      renderHistoryBoard();
    });

    const incOs = tr.querySelector(".js-inc-os");
    safeOn(incOs, "click", (e) => {
      e.stopPropagation();
      updateMovement(m.id, { osCount: Math.min((m.osCount || 0) + 1, 99) });
      renderLiveBoard();
      renderHistoryBoard();
    });

    const decOs = tr.querySelector(".js-dec-os");
    safeOn(decOs, "click", (e) => {
      e.stopPropagation();
      updateMovement(m.id, { osCount: Math.max((m.osCount || 0) - 1, 0) });
      renderLiveBoard();
      renderHistoryBoard();
    });

    const incFis = tr.querySelector(".js-inc-fis");
    safeOn(incFis, "click", (e) => {
      e.stopPropagation();
      updateMovement(m.id, { fisCount: Math.min((m.fisCount || 0) + 1, 99) });
      renderLiveBoard();
      renderHistoryBoard();
    });

    const decFis = tr.querySelector(".js-dec-fis");
    safeOn(decFis, "click", (e) => {
      e.stopPropagation();
      updateMovement(m.id, { fisCount: Math.max((m.fisCount || 0) - 1, 0) });
      renderLiveBoard();
      renderHistoryBoard();
    });

    tbody.appendChild(tr);

    if (expandedId === m.id) {
      renderExpandedRow(tbody, m);
    }
  }

  if (!movements.length) {
    const empty = document.createElement("tr");
    empty.innerHTML = `
      <td colspan="12" style="padding:8px; font-size:12px; color:#777;">
        No demo movements match the current filters.
      </td>
    `;
    tbody.appendChild(empty);
  }
}

/* -----------------------------
   Modal helpers
------------------------------ */

/**
 * Get today's date in YYYY-MM-DD format
 * @returns {string} Date string
 */
function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function openModal(contentHtml) {
  const root = byId("modalRoot");
  if (!root) return;

  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        ${contentHtml}
      </div>
      <div class="modal-minimized-bar">
        <button class="js-restore-modal" type="button">
          <span class="modal-minimized-title"></span>
          <span class="modal-minimized-icon">▲</span>
        </button>
      </div>
    </div>
  `;

  const backdrop = root.querySelector(".modal-backdrop");
  const modal = root.querySelector(".modal");
  const minimizedBar = root.querySelector(".modal-minimized-bar");
  const minimizedTitle = root.querySelector(".modal-minimized-title");

  // Set minimized bar title from modal header
  const modalTitleEl = modal.querySelector(".modal-title");
  if (modalTitleEl && minimizedTitle) {
    minimizedTitle.textContent = modalTitleEl.textContent;
  }

  // Initialize autocomplete for modal inputs
  initModalAutocomplete(modal);

  const closeModal = () => {
    root.innerHTML = "";
    document.removeEventListener("keydown", keyHandler);
  };

  const keyHandler = (e) => {
    if (e.key === "Escape") {
      closeModal();
    } else if (e.key === "Enter" && !e.shiftKey) {
      // Enter-to-save: trigger the primary save button
      // Skip if focused on textarea (to allow multi-line input)
      const activeEl = document.activeElement;
      if (activeEl && activeEl.tagName === "TEXTAREA") {
        return;
      }

      // Find the primary save button
      const saveBtn = backdrop?.querySelector(".js-save-flight, .js-save-loc, .js-save-edit, .js-save-dup");
      if (saveBtn) {
        e.preventDefault();
        saveBtn.click();
      }
    }
  };

  // Click-outside-to-close removed - modal only closes via X button or Cancel button

  const minimizeModal = () => {
    backdrop.classList.add("minimized");
  };

  const restoreModal = () => {
    backdrop.classList.remove("minimized");
  };

  backdrop
    ?.querySelectorAll(".js-close-modal")
    .forEach((btn) => safeOn(btn, "click", closeModal));

  backdrop
    ?.querySelectorAll(".js-minimize-modal")
    .forEach((btn) => safeOn(btn, "click", minimizeModal));

  backdrop
    ?.querySelectorAll(".js-restore-modal")
    .forEach((btn) => safeOn(btn, "click", restoreModal));

  // Real save handler is bound after modal opens via specific save functions

  document.addEventListener("keydown", keyHandler);
}

/**
 * Enrich movement data with auto-populated fields
 * @param {Object} movement - Movement object to enrich
 * @returns {Object} Enriched movement object
 */
function enrichMovementData(movement) {
  const callsignCode = movement.callsignCode || '';
  const aircraftType = movement.type || '';

  // Auto-populate captain from EGOW codes
  if (!movement.captain || movement.captain === '') {
    const captain = lookupCaptainFromEgowCodes(callsignCode);
    if (captain) {
      movement.captain = captain;
    }
  }

  // Auto-populate POB = 2 for UAM callsigns
  if (callsignCode.toUpperCase().startsWith('UAM') && (movement.pob === undefined || movement.pob === null || movement.pob === 0)) {
    movement.pob = 2;
  }

  // Auto-populate unit code from EGOW codes
  if (!movement.unitCode || movement.unitCode === '') {
    const unitCode = lookupUnitCodeFromEgowCodes(callsignCode);
    if (unitCode) {
      movement.unitCode = unitCode;
    }
  }

  // Auto-populate unit description from callsign databases
  if (!movement.unitDesc || movement.unitDesc === '') {
    const unitDesc = lookupUnitFromCallsign(callsignCode, aircraftType);
    if (unitDesc && unitDesc !== '-') {
      movement.unitDesc = unitDesc;
    }
  }

  // Auto-populate operator from callsign databases (only if not already set from registration)
  if (!movement.operator || movement.operator === '' || movement.operator === '-') {
    const operator = lookupOperatorFromCallsign(callsignCode, aircraftType);
    if (operator && operator !== '-') {
      movement.operator = operator;
    }
  }

  return movement;
}

function openNewFlightModal(flightType = "DEP") {
  openModal(`
    <div class="modal-header">
      <div>
        <div class="modal-title">New ${flightType} Flight</div>
        <div class="modal-subtitle">Create a new movement</div>
      </div>
      <div class="modal-header-buttons">
        <button class="btn btn-ghost js-minimize-modal" type="button" title="Minimize">−</button>
        <button class="btn btn-ghost js-close-modal" type="button" title="Close">✕</button>
      </div>
    </div>
    <div class="modal-body modal-sectioned">
      <!-- Identity Section -->
      <section class="modal-section">
        <h3 class="modal-section-title">Identity</h3>
        <div class="modal-section-grid">
          <div class="modal-field">
            <label class="modal-label">Callsign Code</label>
            <input id="newCallsignCode" class="modal-input" placeholder="e.g. BAW, CONNECT, G-BYUN" />
          </div>
          <div class="modal-field">
            <label class="modal-label">Flight Number</label>
            <input id="newFlightNumber" class="modal-input" placeholder="e.g. 123, 01" />
          </div>
          <div class="modal-field">
            <label class="modal-label">Registration</label>
            <input id="newReg" class="modal-input" placeholder="e.g. ZM300, G-BYUN" />
          </div>
          <div class="modal-field">
            <label class="modal-label">Aircraft Type</label>
            <input id="newType" class="modal-input is-derived" placeholder="Auto-filled" />
          </div>
        </div>
      </section>

      <!-- Plan Section -->
      <section class="modal-section">
        <h3 class="modal-section-title">Plan</h3>
        <div class="modal-section-grid">
          <div class="modal-field">
            <label class="modal-label">Flight Type</label>
            <select id="newFlightType" class="modal-select">
              <option ${flightType === "ARR" ? "selected" : ""}>ARR</option>
              <option ${flightType === "DEP" ? "selected" : ""}>DEP</option>
              <option ${flightType === "LOC" ? "selected" : ""}>LOC</option>
              <option ${flightType === "OVR" ? "selected" : ""}>OVR</option>
            </select>
          </div>
          <div class="modal-field">
            <label class="modal-label">Flight Rules</label>
            <select id="newRules" class="modal-select">
              <option value="VFR" selected>VFR</option>
              <option value="IFR">IFR</option>
              <option value="Y">Y (IFR to VFR)</option>
              <option value="Z">Z (VFR to IFR)</option>
              <option value="SVFR">SVFR</option>
            </select>
          </div>
          <div class="modal-field">
            <label class="modal-label">Departure AD</label>
            <input id="newDepAd" class="modal-input" placeholder="EGOS or Shawbury" value="${flightType === "DEP" || flightType === "LOC" ? "EGOW" : ""}" />
          </div>
          <div class="modal-field">
            <label class="modal-label">Arrival AD</label>
            <input id="newArrAd" class="modal-input" placeholder="EGOW or Woodvale" value="${flightType === "ARR" || flightType === "LOC" ? "EGOW" : ""}" />
          </div>
          <div class="modal-field modal-field-priority">
            <label class="modal-label">
              <input type="checkbox" id="priorityEnabled" style="margin-right: 6px;" />
              Priority
            </label>
            <select id="priorityLetter" class="modal-select" disabled>
              <option value="">-</option>
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
              <option value="D">D</option>
              <option value="E">E</option>
              <option value="Z">Z</option>
            </select>
          </div>
        </div>
      </section>

      <!-- Times Section -->
      <section class="modal-section">
        <h3 class="modal-section-title">Times</h3>
        <div class="modal-section-grid">
          <div class="modal-field">
            <label class="modal-label">Date of Flight (DOF)</label>
            <input id="newDOF" type="date" class="modal-input" value="${getTodayDateString()}" />
          </div>
          <div class="modal-field">
            <label class="modal-label">
              <input type="checkbox" id="showLocalTimeToggle" style="margin-right: 4px;" />
              Times shown in: <strong id="timeDisplayMode">UTC</strong>
            </label>
          </div>
          <div class="modal-field">
            <label class="modal-label">Estimated Departure (ETD)</label>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input id="newDepPlanned" class="modal-input" placeholder="12:30" style="width: 80px;" />
              <span id="localDepTime" class="time-local"></span>
            </div>
          </div>
          <div class="modal-field">
            <label class="modal-label">Estimated Arrival (ETA)</label>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input id="newArrPlanned" class="modal-input" placeholder="13:05" style="width: 80px;" />
              <span id="localArrTime" class="time-local"></span>
            </div>
          </div>
        </div>
        <!-- Hidden checkboxes for compatibility -->
        <input type="checkbox" id="showLocalTimeDep" style="display: none;" />
        <input type="checkbox" id="showLocalTimeArr" style="display: none;" />
      </section>

      <!-- Operational Section -->
      <section class="modal-section">
        <h3 class="modal-section-title">Operational</h3>
        <div class="modal-section-grid">
          <div class="modal-field">
            <label class="modal-label">POB</label>
            <input id="newPob" class="modal-input" type="number" value="0" min="0" />
          </div>
          <div class="modal-field">
            <label class="modal-label">EGOW Code <span style="color: #d32f2f;">*</span></label>
            <input id="newEgowCode" class="modal-input is-derived" placeholder="e.g. BM, VM" list="egowCodeOptions" />
            <datalist id="egowCodeOptions">
              <option value="VC">VC</option>
              <option value="VM">VM</option>
              <option value="BC">BC</option>
              <option value="BM">BM</option>
              <option value="VCH">VCH</option>
              <option value="VMH">VMH</option>
              <option value="VNH">VNH</option>
            </datalist>
          </div>
          <div class="modal-field">
            <label class="modal-label">EGOW Unit</label>
            <input id="newUnitCode" class="modal-input is-derived" placeholder="e.g. L, M, A" />
          </div>
          <div class="modal-field">
            <label class="modal-label">T&amp;G</label>
            <input id="newTng" class="modal-input" type="number" value="0" min="0" />
          </div>
          <div class="modal-field">
            <label class="modal-label">O/S</label>
            <input id="newOsCount" class="modal-input" type="number" value="0" min="0" />
          </div>
          <div class="modal-field">
            <label class="modal-label">FIS</label>
            <input id="newFisCount" class="modal-input" type="number" value="${flightType === "OVR" ? "1" : "0"}" min="0" />
          </div>
        </div>
      </section>

      <!-- Collapsible: Remarks & Warnings -->
      <section class="modal-section modal-collapsible">
        <button type="button" class="modal-expander" aria-expanded="false" data-target="remarksWarnings">
          <span class="expander-icon">▶</span>
          Remarks &amp; Warnings
          <span class="expander-hint">(optional)</span>
        </button>
        <div id="remarksWarnings" class="modal-expander-panel" hidden>
          <div class="modal-section-grid">
            <div class="modal-field modal-field-full">
              <label class="modal-label">Remarks</label>
              <textarea id="rwRemarks" class="modal-textarea" rows="3" placeholder="Optional notes…"></textarea>
            </div>
            <div class="modal-field modal-field-full">
              <label class="modal-label">Warnings</label>
              <textarea id="rwWarnings" class="modal-textarea" rows="3" placeholder="Optional warnings…"></textarea>
            </div>
          </div>
        </div>
      </section>

      <!-- Collapsible: ATC Details -->
      <section class="modal-section modal-collapsible">
        <button type="button" class="modal-expander" aria-expanded="false" data-target="atcDetails">
          <span class="expander-icon">▶</span>
          ATC Details
          <span class="expander-hint">(optional)</span>
        </button>
        <div id="atcDetails" class="modal-expander-panel" hidden>
          <div class="modal-section-grid">
            <div class="modal-field">
              <label class="modal-label">Squawk</label>
              <input id="atcSquawk" class="modal-input" placeholder="e.g. 7000" maxlength="4" />
            </div>
            <div class="modal-field">
              <label class="modal-label">Route</label>
              <input id="atcRoute" class="modal-input" placeholder="e.g. DCT" />
            </div>
            <div class="modal-field modal-field-full">
              <label class="modal-label">Clearance</label>
              <textarea id="atcClearance" class="modal-textarea" rows="2" placeholder="Optional clearance details…"></textarea>
            </div>
          </div>
        </div>
      </section>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost js-close-modal" type="button">Cancel</button>
      <button class="btn btn-primary js-save-flight" type="button">Save</button>
    </div>
  `);

  // Bind registration and callsign field interactions with VKB
  const callsignCodeInput = document.getElementById("newCallsignCode");
  const flightNumberInput = document.getElementById("newFlightNumber");
  const regInput = document.getElementById("newReg");
  const typeInput = document.getElementById("newType");
  const pobInput = document.getElementById("newPob");
  const egowCodeInput = document.getElementById("newEgowCode");
  const unitCodeInput = document.getElementById("newUnitCode");
  const depAdInput = document.getElementById("newDepAd");
  const arrAdInput = document.getElementById("newArrAd");

  // Apply automatic uppercase conversion to aviation-related fields
  makeInputUppercase(callsignCodeInput);
  makeInputUppercase(flightNumberInput);
  makeInputUppercase(regInput);
  makeInputUppercase(typeInput);
  makeInputUppercase(egowCodeInput);
  makeInputUppercase(unitCodeInput);
  makeInputUppercase(depAdInput);
  makeInputUppercase(arrAdInput);

  // When registration is entered, auto-fill type, fixed callsign/flight number, and EGOW code
  if (regInput && typeInput) {
    regInput.addEventListener("input", () => {
      const regData = lookupRegistration(regInput.value);
      if (regData) {
        // Auto-fill aircraft type from VKB
        const vkbType = regData['TYPE'];
        if (vkbType && vkbType !== '-' && vkbType !== '') {
          typeInput.value = vkbType;
        }

        // Auto-fill EGOW Code from registration
        const egowFlightType = regData['EGOW FLIGHT TYPE'];
        if (egowFlightType && egowFlightType !== '-' && egowFlightType !== '' && egowCodeInput) {
          egowCodeInput.value = egowFlightType;
        }

        // Auto-fill fixed callsign and flight number if available
        const fixedCallsign = regData['FIXED C/S'];
        if (fixedCallsign && fixedCallsign !== '-' && fixedCallsign !== '') {
          // Try to split into callsign code and flight number
          // e.g., "UAM01" → "UAM" + "01"
          const match = fixedCallsign.match(/^([A-Z]+)(\d+.*)?$/);
          if (match && callsignCodeInput && (!callsignCodeInput.value || callsignCodeInput.value === '')) {
            callsignCodeInput.value = match[1]; // Code part
            if (match[2] && flightNumberInput && (!flightNumberInput.value || flightNumberInput.value === '')) {
              flightNumberInput.value = match[2]; // Number part
            }
          }
        }
      } else {
        // Fallback to hardcoded lookup if not in VKB
        const inferredType = inferTypeFromReg(regInput.value);
        if (inferredType) {
          typeInput.value = inferredType;
        }
      }
    });
  }

  // When callsign code or flight number changes, check for UAM pattern, lookup unit code, and auto-fill registration if fixed callsign
  const updateCallsignDerivedFields = () => {
    const code = callsignCodeInput?.value?.toUpperCase().trim() || '';
    const number = flightNumberInput?.value?.trim() || '';
    const fullCallsign = code + number;

    // UAM* pattern → POB = 2
    if (code.startsWith('UAM') && pobInput && (pobInput.value === '0' || !pobInput.value)) {
      pobInput.value = '2';
    }

    // Lookup unit code from full callsign
    if (fullCallsign && unitCodeInput) {
      const unitData = lookupCallsign(fullCallsign);
      if (unitData && unitData['UC'] && unitData['UC'] !== '-' && unitData['UC'] !== '') {
        unitCodeInput.value = unitData['UC'];
      }
    }

    // If callsign matches a fixed callsign, auto-fill registration (only if registration is empty)
    if (fullCallsign && regInput && (!regInput.value || regInput.value === '')) {
      const regData = lookupRegistrationByFixedCallsign(fullCallsign);
      if (regData) {
        const registration = regData['REGISTRATION'] || '';
        if (registration && registration !== '-') {
          regInput.value = registration;
          // Trigger registration input event to update dependent fields
          regInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    }
  };

  if (callsignCodeInput) {
    callsignCodeInput.addEventListener("input", updateCallsignDerivedFields);
  }
  if (flightNumberInput) {
    flightNumberInput.addEventListener("input", updateCallsignDerivedFields);
  }

  // Wire collapsible sections
  document.querySelectorAll('.modal-expander').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const panel = document.getElementById(targetId);
      const isExpanded = btn.getAttribute('aria-expanded') === 'true';

      btn.setAttribute('aria-expanded', !isExpanded);
      panel.hidden = isExpanded;
      btn.querySelector('.expander-icon').textContent = isExpanded ? '▶' : '▼';
    });
  });

  // Wire Priority checkbox/dropdown
  const priorityEnabled = document.getElementById('priorityEnabled');
  const priorityLetter = document.getElementById('priorityLetter');
  if (priorityEnabled && priorityLetter) {
    priorityEnabled.addEventListener('change', () => {
      priorityLetter.disabled = !priorityEnabled.checked;
      if (!priorityEnabled.checked) {
        priorityLetter.value = '';
      }
    });
  }

  // Auto-fill Remarks and Warnings from registration data (FDMS_REGISTRATIONS.csv col 15 & 16)
  const remarksInput = document.getElementById('rwRemarks');
  const warningsInput = document.getElementById('rwWarnings');

  if (regInput && remarksInput && warningsInput) {
    regInput.addEventListener("input", () => {
      const regData = lookupRegistration(regInput.value);
      if (regData) {
        // Auto-fill Warnings (column 15)
        const warningsText = regData['WARNINGS'] || '';
        if (warningsText && warningsText !== '-') {
          // Only auto-fill if field is empty OR still shows previous autofill
          const currentWarnings = warningsInput.value.trim();
          const lastAutofill = warningsInput.dataset.autofillValue || '';
          if (!currentWarnings || currentWarnings === lastAutofill) {
            warningsInput.value = warningsText;
            warningsInput.dataset.autofillValue = warningsText;
          }
        }

        // Auto-fill Remarks/Notes (column 16)
        const notesText = regData['NOTES'] || '';
        if (notesText && notesText !== '-') {
          // Only auto-fill if field is empty OR still shows previous autofill
          const currentRemarks = remarksInput.value.trim();
          const lastAutofill = remarksInput.dataset.autofillValue || '';
          if (!currentRemarks || currentRemarks === lastAutofill) {
            remarksInput.value = notesText;
            remarksInput.dataset.autofillValue = notesText;
          }
        }
      }
    });
  }

  // Bind local time display handlers
  const depTimeInput = document.getElementById("newDepPlanned");
  const arrTimeInput = document.getElementById("newArrPlanned");
  const showLocalDepCheck = document.getElementById("showLocalTimeDep");
  const showLocalArrCheck = document.getElementById("showLocalTimeArr");
  const showLocalToggle = document.getElementById("showLocalTimeToggle");
  const timeDisplayMode = document.getElementById("timeDisplayMode");
  const localDepSpan = document.getElementById("localDepTime");
  const localArrSpan = document.getElementById("localArrTime");

  function updateLocalDepTime() {
    if (showLocalDepCheck && showLocalDepCheck.checked && depTimeInput && localDepSpan) {
      const utcTime = depTimeInput.value;
      const localTime = convertUTCToLocal(utcTime);
      const offset = getTimezoneOffsetLabel();
      localDepSpan.textContent = localTime ? `${localTime} (${offset})` : "";
    } else if (localDepSpan) {
      localDepSpan.textContent = "";
    }
  }

  function updateLocalArrTime() {
    if (showLocalArrCheck && showLocalArrCheck.checked && arrTimeInput && localArrSpan) {
      const utcTime = arrTimeInput.value;
      const localTime = convertUTCToLocal(utcTime);
      const offset = getTimezoneOffsetLabel();
      localArrSpan.textContent = localTime ? `${localTime} (${offset})` : "";
    } else if (localArrSpan) {
      localArrSpan.textContent = "";
    }
  }

  // Wire single toggle to both hidden checkboxes
  if (showLocalToggle && showLocalDepCheck && showLocalArrCheck && timeDisplayMode) {
    showLocalToggle.addEventListener('change', () => {
      const isChecked = showLocalToggle.checked;
      showLocalDepCheck.checked = isChecked;
      showLocalArrCheck.checked = isChecked;
      timeDisplayMode.textContent = isChecked ? 'Local' : 'UTC';
      updateLocalDepTime();
      updateLocalArrTime();
    });
  }

  if (showLocalDepCheck) showLocalDepCheck.addEventListener("change", updateLocalDepTime);
  if (showLocalArrCheck) showLocalArrCheck.addEventListener("change", updateLocalArrTime);
  if (depTimeInput) depTimeInput.addEventListener("input", updateLocalDepTime);
  if (arrTimeInput) arrTimeInput.addEventListener("input", updateLocalArrTime);

  // Bind save handler with validation
  document.querySelector(".js-save-flight")?.addEventListener("click", () => {
    // Get form values
    const dof = document.getElementById("newDOF")?.value || getTodayDateString();
    let depPlanned = document.getElementById("newDepPlanned")?.value || "";
    let arrPlanned = document.getElementById("newArrPlanned")?.value || "";
    const pob = document.getElementById("newPob")?.value || "0";
    const tng = document.getElementById("newTng")?.value || "0";
    const callsignCode = document.getElementById("newCallsignCode")?.value || "";
    const flightNumber = document.getElementById("newFlightNumber")?.value || "";
    const callsign = callsignCode + flightNumber; // Combine for full callsign

    // Validate inputs
    const dofValidation = validateDate(dof);
    if (!dofValidation.valid) {
      showToast(dofValidation.error, 'error');
      return;
    }

    const depValidation = validateTime(depPlanned);
    if (!depValidation.valid) {
      showToast(`Departure time: ${depValidation.error}`, 'error');
      return;
    }

    // Use normalized time if provided
    if (depValidation.normalized) {
      depPlanned = depValidation.normalized;
      document.getElementById("newDepPlanned").value = depPlanned;
    }

    const arrValidation = validateTime(arrPlanned);
    if (!arrValidation.valid) {
      showToast(`Arrival time: ${arrValidation.error}`, 'error');
      return;
    }

    // Use normalized time if provided
    if (arrValidation.normalized) {
      arrPlanned = arrValidation.normalized;
      document.getElementById("newArrPlanned").value = arrPlanned;
    }

    // Check for past times and show warning
    if (depPlanned) {
      const depPastCheck = checkPastTime(depPlanned, dof);
      if (depPastCheck.isPast) {
        showToast(depPastCheck.warning, 'warning');
      }
    }

    if (arrPlanned) {
      const arrPastCheck = checkPastTime(arrPlanned, dof);
      if (arrPastCheck.isPast) {
        showToast(arrPastCheck.warning, 'warning');
      }
    }

    const pobValidation = validateNumberRange(pob, 0, 999, "POB");
    if (!pobValidation.valid) {
      showToast(pobValidation.error, 'error');
      return;
    }

    const tngValidation = validateNumberRange(tng, 0, 99, "T&G count");
    if (!tngValidation.valid) {
      showToast(tngValidation.error, 'error');
      return;
    }

    const callsignValidation = validateRequired(callsignCode, "Callsign Code");
    if (!callsignValidation.valid) {
      showToast(callsignValidation.error, 'error');
      return;
    }

    // Validate EGOW Code (mandatory with 7 valid options)
    const egowCode = document.getElementById("newEgowCode")?.value?.toUpperCase().trim() || "";
    const validEgowCodes = ["VC", "VM", "BC", "BM", "VCH", "VMH", "VNH"];
    if (!egowCode) {
      showToast("EGOW Code is required", 'error');
      return;
    }
    if (!validEgowCodes.includes(egowCode)) {
      showToast(`EGOW Code must be one of: ${validEgowCodes.join(', ')}`, 'error');
      return;
    }

    // Get operator and popular name from VKB registration data
    const regValue = document.getElementById("newReg")?.value || "";
    const regData = lookupRegistration(regValue);
    const operator = regData ? (regData['OPERATOR'] || "") : "";
    const popularName = regData ? (regData['POPULAR NAME'] || "") : "";

    // Get voice callsign for display (only if different from contraction/registration)
    const voiceCallsign = getVoiceCallsignForDisplay(callsign, regValue);

    // Get WTC based on aircraft type and flight type
    const aircraftType = document.getElementById("newType")?.value || "";
    const selectedFlightType = document.getElementById("newFlightType")?.value || flightType;
    const wtc = getWTC(aircraftType, selectedFlightType, "UK"); // TODO: Make "UK" configurable in admin

    // Get departure and arrival location names
    const depAd = document.getElementById("newDepAd")?.value || "";
    const arrAd = document.getElementById("newArrAd")?.value || "";
    const depName = getLocationName(depAd);
    const arrName = getLocationName(arrAd);

    // Get new optional fields
    const priorityEnabledCheck = document.getElementById("priorityEnabled")?.checked || false;
    const priorityLetterValue = priorityEnabledCheck ? (document.getElementById("priorityLetter")?.value || "") : "";
    const remarksValue = document.getElementById("rwRemarks")?.value || "";
    const warningsValue = document.getElementById("rwWarnings")?.value || "";
    const notesValue = regData ? (regData['NOTES'] || "") : ""; // Keep notes from VKB for backward compatibility
    const osCountValue = parseInt(document.getElementById("newOsCount")?.value || "0", 10);
    const fisCountValue = parseInt(document.getElementById("newFisCount")?.value || ((document.getElementById("newFlightType")?.value || flightType) === "OVR" ? "1" : "0"), 10);
    const squawkValue = document.getElementById("atcSquawk")?.value || "";
    const routeValue = document.getElementById("atcRoute")?.value || "";
    const clearanceValue = document.getElementById("atcClearance")?.value || "";

    // Create movement
    let movement = {
      status: "PLANNED",
      callsignCode: callsign,
      callsignLabel: "",
      callsignVoice: voiceCallsign,
      registration: regValue,
      operator: operator,
      type: aircraftType,
      popularName: popularName,
      wtc: wtc,
      depAd: depAd,
      depName: depName,
      arrAd: arrAd,
      arrName: arrName,
      depPlanned: depPlanned,
      depActual: "",
      arrPlanned: arrPlanned,
      arrActual: "",
      dof: dof,
      rules: document.getElementById("newRules")?.value || "VFR",
      flightType: document.getElementById("newFlightType")?.value || flightType,
      isLocal: (document.getElementById("newFlightType")?.value || flightType) === "LOC",
      tngCount: parseInt(tng, 10),
      osCount: osCountValue,
      fisCount: fisCountValue,
      egowCode: egowCode,
      egowDesc: "",
      unitCode: document.getElementById("newUnitCode")?.value || "",
      unitDesc: "",
      captain: "",
      pob: parseInt(pob, 10),
      priorityLetter: priorityLetterValue,
      remarks: remarksValue,
      warnings: warningsValue,
      notes: notesValue,
      squawk: squawkValue,
      route: routeValue,
      clearance: clearanceValue,
      formation: null
    };

    // Enrich with auto-populated fields
    movement = enrichMovementData(movement);

    createMovement(movement);
    renderLiveBoard();
    renderHistoryBoard();
    showToast("Movement created successfully", 'success');

    // Close modal
    const modalRoot = document.getElementById("modalRoot");
    if (modalRoot) modalRoot.innerHTML = "";
  });
}

function openNewLocalModal() {
  openModal(`
    <div class="modal-header">
      <div>
        <div class="modal-title">New Local Flight</div>
        <div class="modal-subtitle">Pre-configured for EGOW → EGOW VFR circuits</div>
      </div>
      <div class="modal-header-buttons">
        <button class="btn btn-ghost js-minimize-modal" type="button" title="Minimize">−</button>
        <button class="btn btn-ghost js-close-modal" type="button" title="Close">✕</button>
      </div>
    </div>
    <div class="modal-body">
      <div class="modal-field">
        <label class="modal-label">Callsign Code <span style="font-size: 11px; font-weight: normal;">(Contraction or tactical/registration callsign)</span></label>
        <input id="newLocCallsignCode" class="modal-input" placeholder="e.g. UAM, WOODVALE, G-BYUN" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Flight Number <span style="font-size: 11px; font-weight: normal;">(Optional - for numbered flights)</span></label>
        <input id="newLocFlightNumber" class="modal-input" placeholder="e.g. 11, 01" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Registration</label>
        <input id="newLocReg" class="modal-input" placeholder="e.g. G-VAIR" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Aircraft Type</label>
        <input id="newLocType" class="modal-input" placeholder="e.g. G115 (auto-filled from registration)" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Flight Type</label>
        <input class="modal-input" value="LOC (Local)" disabled />
      </div>
      <div class="modal-field">
        <label class="modal-label">Departure / Arrival AD</label>
        <input class="modal-input" value="EGOW · RAF Woodvale" disabled />
      </div>
      <div class="modal-field">
        <label class="modal-label">Date of Flight (DOF)</label>
        <input id="newLocDOF" type="date" class="modal-input" value="${getTodayDateString()}" />
      </div>
      <div class="modal-field">
        <label class="modal-label">
          Estimated Departure (ETD) - UTC
          <span style="font-size: 11px; font-weight: normal; margin-left: 8px;">
            <input type="checkbox" id="showLocalTimeLocDep" style="margin: 0 4px;"/>Show Local Time
          </span>
        </label>
        <div style="display: flex; gap: 8px; align-items: center;">
          <input id="newLocStart" class="modal-input" placeholder="12:30" style="width: 80px;" />
          <span id="localLocDepTime" style="font-size: 12px; color: #666;"></span>
        </div>
      </div>
      <div class="modal-field">
        <label class="modal-label">
          Estimated Arrival (ETA) - UTC
          <span style="font-size: 11px; font-weight: normal; margin-left: 8px;">
            <input type="checkbox" id="showLocalTimeLocArr" style="margin: 0 4px;"/>Show Local Time
          </span>
        </label>
        <div style="display: flex; gap: 8px; align-items: center;">
          <input id="newLocEnd" class="modal-input" placeholder="13:30" style="width: 80px;" />
          <span id="localLocArrTime" style="font-size: 12px; color: #666;"></span>
        </div>
      </div>
      <div class="modal-field">
        <label class="modal-label">Touch &amp; Go count</label>
        <input id="newLocTng" class="modal-input" type="number" value="0" />
      </div>
      <div class="modal-field">
        <label class="modal-label">POB</label>
        <input id="newLocPob" class="modal-input" type="number" value="0" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Remarks</label>
        <textarea id="newLocRemarks" class="modal-textarea" placeholder="Circuits RWY 21, left-hand."></textarea>
      </div>
      <div class="modal-field">
        <label class="modal-label">EGOW Code <span style="font-size: 11px; font-weight: normal;">(Auto-filled from registration)</span></label>
        <input id="newLocEgowCode" class="modal-input" placeholder="e.g. BM, VM, BC" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Unit Code <span style="font-size: 11px; font-weight: normal;">(Auto-filled from callsign)</span></label>
        <input id="newLocUnitCode" class="modal-input" placeholder="e.g. L, M, A" />
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost js-close-modal" type="button">Cancel</button>
      <button class="btn btn-primary js-save-loc" type="button">Save</button>
    </div>
  `);

  // Bind registration and callsign field interactions with VKB
  const callsignCodeInput = document.getElementById("newLocCallsignCode");
  const flightNumberInput = document.getElementById("newLocFlightNumber");
  const regInput = document.getElementById("newLocReg");
  const typeInput = document.getElementById("newLocType");
  const pobInput = document.getElementById("newLocPob");
  const egowCodeInput = document.getElementById("newLocEgowCode");
  const unitCodeInput = document.getElementById("newLocUnitCode");

  // Apply automatic uppercase conversion to aviation-related fields
  makeInputUppercase(callsignCodeInput);
  makeInputUppercase(flightNumberInput);
  makeInputUppercase(regInput);
  makeInputUppercase(typeInput);
  makeInputUppercase(egowCodeInput);
  makeInputUppercase(unitCodeInput);

  // When registration is entered, auto-fill type, fixed callsign/flight number, and EGOW code
  if (regInput && typeInput) {
    regInput.addEventListener("input", () => {
      const regData = lookupRegistration(regInput.value);
      if (regData) {
        // Auto-fill aircraft type from VKB
        const vkbType = regData['TYPE'];
        if (vkbType && vkbType !== '-' && vkbType !== '') {
          typeInput.value = vkbType;
        }

        // Auto-fill EGOW Code from registration
        const egowFlightType = regData['EGOW FLIGHT TYPE'];
        if (egowFlightType && egowFlightType !== '-' && egowFlightType !== '' && egowCodeInput) {
          egowCodeInput.value = egowFlightType;
        }

        // Auto-fill fixed callsign and flight number if available
        const fixedCallsign = regData['FIXED C/S'];
        if (fixedCallsign && fixedCallsign !== '-' && fixedCallsign !== '') {
          // Try to split into callsign code and flight number
          // e.g., "UAM01" → "UAM" + "01"
          const match = fixedCallsign.match(/^([A-Z]+)(\d+.*)?$/);
          if (match && callsignCodeInput && (!callsignCodeInput.value || callsignCodeInput.value === '')) {
            callsignCodeInput.value = match[1]; // Code part
            if (match[2] && flightNumberInput && (!flightNumberInput.value || flightNumberInput.value === '')) {
              flightNumberInput.value = match[2]; // Number part
            }
          }
        }
      } else {
        // Fallback to hardcoded lookup if not in VKB
        const inferredType = inferTypeFromReg(regInput.value);
        if (inferredType) {
          typeInput.value = inferredType;
        }
      }
    });
  }

  // When callsign code or flight number changes, check for UAM pattern, lookup unit code, and auto-fill registration if fixed callsign
  const updateCallsignDerivedFields = () => {
    const code = callsignCodeInput?.value?.toUpperCase().trim() || '';
    const number = flightNumberInput?.value?.trim() || '';
    const fullCallsign = code + number;

    // UAM* pattern → POB = 2
    if (code.startsWith('UAM') && pobInput && (pobInput.value === '0' || !pobInput.value)) {
      pobInput.value = '2';
    }

    // Lookup unit code from full callsign
    if (fullCallsign && unitCodeInput) {
      const unitData = lookupCallsign(fullCallsign);
      if (unitData && unitData['UC'] && unitData['UC'] !== '-' && unitData['UC'] !== '') {
        unitCodeInput.value = unitData['UC'];
      }
    }

    // If callsign matches a fixed callsign, auto-fill registration (only if registration is empty)
    if (fullCallsign && regInput && (!regInput.value || regInput.value === '')) {
      const regData = lookupRegistrationByFixedCallsign(fullCallsign);
      if (regData) {
        const registration = regData['REGISTRATION'] || '';
        if (registration && registration !== '-') {
          regInput.value = registration;
          // Trigger registration input event to update dependent fields
          regInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    }
  };

  if (callsignCodeInput) {
    callsignCodeInput.addEventListener("input", updateCallsignDerivedFields);
  }
  if (flightNumberInput) {
    flightNumberInput.addEventListener("input", updateCallsignDerivedFields);
  }

  // Bind local time display handlers
  const depTimeInput = document.getElementById("newLocStart");
  const arrTimeInput = document.getElementById("newLocEnd");
  const showLocalDepCheck = document.getElementById("showLocalTimeLocDep");
  const showLocalArrCheck = document.getElementById("showLocalTimeLocArr");
  const localDepSpan = document.getElementById("localLocDepTime");
  const localArrSpan = document.getElementById("localLocArrTime");

  function updateLocalLocDepTime() {
    if (showLocalDepCheck && showLocalDepCheck.checked && depTimeInput && localDepSpan) {
      const utcTime = depTimeInput.value;
      const localTime = convertUTCToLocal(utcTime);
      const offset = getTimezoneOffsetLabel();
      localDepSpan.textContent = localTime ? `Local: ${localTime} (${offset})` : "";
    } else if (localDepSpan) {
      localDepSpan.textContent = "";
    }
  }

  function updateLocalLocArrTime() {
    if (showLocalArrCheck && showLocalArrCheck.checked && arrTimeInput && localArrSpan) {
      const utcTime = arrTimeInput.value;
      const localTime = convertUTCToLocal(utcTime);
      const offset = getTimezoneOffsetLabel();
      localArrSpan.textContent = localTime ? `Local: ${localTime} (${offset})` : "";
    } else if (localArrSpan) {
      localArrSpan.textContent = "";
    }
  }

  if (showLocalDepCheck) showLocalDepCheck.addEventListener("change", updateLocalLocDepTime);
  if (showLocalArrCheck) showLocalArrCheck.addEventListener("change", updateLocalLocArrTime);
  if (depTimeInput) depTimeInput.addEventListener("input", updateLocalLocDepTime);
  if (arrTimeInput) arrTimeInput.addEventListener("input", updateLocalLocArrTime);

  // Bind save handler with validation
  document.querySelector(".js-save-loc")?.addEventListener("click", () => {
    // Get form values
    const dof = document.getElementById("newLocDOF")?.value || getTodayDateString();
    const depPlanned = document.getElementById("newLocStart")?.value || "";
    const arrPlanned = document.getElementById("newLocEnd")?.value || "";
    const pob = document.getElementById("newLocPob")?.value || "0";
    const tng = document.getElementById("newLocTng")?.value || "0";
    const callsignCode = document.getElementById("newLocCallsignCode")?.value || "";
    const flightNumber = document.getElementById("newLocFlightNumber")?.value || "";
    const callsign = callsignCode + flightNumber; // Combine for full callsign

    // Validate inputs
    const dofValidation = validateDate(dof);
    if (!dofValidation.valid) {
      showToast(dofValidation.error, 'error');
      return;
    }

    const depValidation = validateTime(depPlanned);
    if (!depValidation.valid) {
      showToast(`Departure time: ${depValidation.error}`, 'error');
      return;
    }

    const arrValidation = validateTime(arrPlanned);
    if (!arrValidation.valid) {
      showToast(`Arrival time: ${arrValidation.error}`, 'error');
      return;
    }

    const pobValidation = validateNumberRange(pob, 0, 999, "POB");
    if (!pobValidation.valid) {
      showToast(pobValidation.error, 'error');
      return;
    }

    const tngValidation = validateNumberRange(tng, 0, 99, "T&G count");
    if (!tngValidation.valid) {
      showToast(tngValidation.error, 'error');
      return;
    }

    const callsignValidation = validateRequired(callsign, "Callsign");
    if (!callsignValidation.valid) {
      showToast(callsignValidation.error, 'error');
      return;
    }

    // Get voice callsign for display (only if different from contraction/registration)
    const regValue = document.getElementById("newLocReg")?.value || "";
    const regData = lookupRegistration(regValue);
    const popularName = regData ? (regData['POPULAR NAME'] || "") : "";
    const voiceCallsign = getVoiceCallsignForDisplay(callsign, regValue);

    // Get WTC based on aircraft type (Local flights are always LOC)
    const aircraftType = document.getElementById("newLocType")?.value || "";
    const wtc = getWTC(aircraftType, "LOC", "UK");

    // Get warnings and notes from registration
    const warnings = regData ? (regData['WARNINGS'] || "") : "";
    const notes = regData ? (regData['NOTES'] || "") : "";
    const operator = regData ? (regData['OPERATOR'] || "") : "";

    // Create movement
    let movement = {
      status: "PLANNED",
      callsignCode: callsign,
      callsignLabel: "",
      callsignVoice: voiceCallsign,
      registration: regValue,
      operator: operator,
      type: aircraftType,
      popularName: popularName,
      wtc: wtc,
      depAd: "EGOW",
      depName: "RAF Woodvale",
      arrAd: "EGOW",
      arrName: "RAF Woodvale",
      depPlanned: depPlanned,
      depActual: "",
      arrPlanned: arrPlanned,
      arrActual: "",
      dof: dof,
      rules: "VFR", // Local flights are always VFR
      flightType: "LOC",
      isLocal: true,
      tngCount: parseInt(tng, 10),
      osCount: 0,
      fisCount: "LOC" === "OVR" ? 1 : 0,
      egowCode: document.getElementById("newLocEgowCode")?.value || "",
      egowDesc: "",
      unitCode: document.getElementById("newLocUnitCode")?.value || "",
      unitDesc: "",
      captain: "",
      pob: parseInt(pob, 10),
      remarks: document.getElementById("newLocRemarks")?.value || "",
      warnings: warnings,
      notes: notes,
      squawk: "",
      route: "",
      clearance: "",
      formation: null
    };

    // Enrich with auto-populated fields
    movement = enrichMovementData(movement);

    createMovement(movement);
    renderLiveBoard();
    renderHistoryBoard();
    showToast("Local flight created successfully", 'success');

    // Close modal
    const modalRoot = document.getElementById("modalRoot");
    if (modalRoot) modalRoot.innerHTML = "";
  });
}

/**
 * Open edit modal for an existing movement
 * Pre-fills all fields with current values
 */
function openEditMovementModal(m) {
  const flightType = m.flightType || "DEP";

  // Split callsign into code and number parts for editing
  const callsignMatch = (m.callsignCode || "").match(/^([A-Z]+)(\d+.*)?$/);
  const callsignCode = callsignMatch ? callsignMatch[1] : (m.callsignCode || "");
  const flightNumber = callsignMatch && callsignMatch[2] ? callsignMatch[2] : "";

  // Check if priority is enabled
  const hasPriority = m.priorityLetter && m.priorityLetter.length > 0;

  openModal(`
    <div class="modal-header">
      <div>
        <div class="modal-title">Edit ${flightType} Flight</div>
        <div class="modal-subtitle">Movement ID: ${m.id}</div>
      </div>
      <div class="modal-header-buttons">
        <button class="btn btn-ghost js-minimize-modal" type="button" title="Minimize">−</button>
        <button class="btn btn-ghost js-close-modal" type="button" title="Close">✕</button>
      </div>
    </div>
    <div class="modal-body modal-sectioned">
      <!-- Identity Section -->
      <section class="modal-section">
        <h3 class="modal-section-title">Identity</h3>
        <div class="modal-section-grid">
          <div class="modal-field">
            <label class="modal-label">Callsign Code</label>
            <input id="editCallsignCode" class="modal-input" value="${escapeHtml(callsignCode)}" placeholder="e.g. BAW, CONNECT, G-BYUN" />
          </div>
          <div class="modal-field">
            <label class="modal-label">Flight Number</label>
            <input id="editFlightNumber" class="modal-input" value="${escapeHtml(flightNumber)}" placeholder="e.g. 123, 01" />
          </div>
          <div class="modal-field">
            <label class="modal-label">Registration</label>
            <input id="editReg" class="modal-input" value="${escapeHtml(m.registration || "")}" />
          </div>
          <div class="modal-field">
            <label class="modal-label">Aircraft Type</label>
            <input id="editType" class="modal-input is-derived" value="${escapeHtml(m.type || "")}" />
          </div>
        </div>
      </section>

      <!-- Plan Section -->
      <section class="modal-section">
        <h3 class="modal-section-title">Plan</h3>
        <div class="modal-section-grid">
          <div class="modal-field">
            <label class="modal-label">Flight Type</label>
            <select id="editFlightType" class="modal-select">
              <option ${flightType === "ARR" ? "selected" : ""}>ARR</option>
              <option ${flightType === "DEP" ? "selected" : ""}>DEP</option>
              <option ${flightType === "LOC" ? "selected" : ""}>LOC</option>
              <option ${flightType === "OVR" ? "selected" : ""}>OVR</option>
            </select>
          </div>
          <div class="modal-field">
            <label class="modal-label">Flight Rules</label>
            <select id="editRules" class="modal-select">
              <option value="VFR" ${m.rules === "VFR" ? "selected" : ""}>VFR</option>
              <option value="IFR" ${m.rules === "IFR" ? "selected" : ""}>IFR</option>
              <option value="Y" ${m.rules === "Y" ? "selected" : ""}>Y (IFR to VFR)</option>
              <option value="Z" ${m.rules === "Z" ? "selected" : ""}>Z (VFR to IFR)</option>
              <option value="SVFR" ${m.rules === "SVFR" ? "selected" : ""}>SVFR</option>
            </select>
          </div>
          <div class="modal-field">
            <label class="modal-label">Departure AD</label>
            <input id="editDepAd" class="modal-input" value="${escapeHtml(m.depAd || "")}" />
          </div>
          <div class="modal-field">
            <label class="modal-label">Arrival AD</label>
            <input id="editArrAd" class="modal-input" value="${escapeHtml(m.arrAd || "")}" />
          </div>
          <div class="modal-field modal-field-priority">
            <label class="modal-label">
              <input type="checkbox" id="editPriorityEnabled" ${hasPriority ? "checked" : ""} style="margin-right: 6px;" />
              Priority
            </label>
            <select id="editPriorityLetter" class="modal-select" ${hasPriority ? "" : "disabled"}>
              <option value="">-</option>
              <option value="A" ${m.priorityLetter === "A" ? "selected" : ""}>A</option>
              <option value="B" ${m.priorityLetter === "B" ? "selected" : ""}>B</option>
              <option value="C" ${m.priorityLetter === "C" ? "selected" : ""}>C</option>
              <option value="D" ${m.priorityLetter === "D" ? "selected" : ""}>D</option>
              <option value="E" ${m.priorityLetter === "E" ? "selected" : ""}>E</option>
              <option value="Z" ${m.priorityLetter === "Z" ? "selected" : ""}>Z</option>
            </select>
          </div>
        </div>
      </section>

      <!-- Times Section -->
      <section class="modal-section">
        <h3 class="modal-section-title">Times</h3>
        <div class="modal-section-grid">
          <div class="modal-field">
            <label class="modal-label">Date of Flight (DOF)</label>
            <input id="editDOF" type="date" class="modal-input" value="${m.dof || getTodayDateString()}" />
          </div>
          <div class="modal-field"></div>
          <div class="modal-field">
            <label class="modal-label">ETD</label>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input id="editDepPlanned" class="modal-input" value="${m.depPlanned || ""}" style="width: 80px;" />
              <label style="font-size: 10px; color: #666; cursor: pointer;">
                <input type="checkbox" id="showLocalTimeEditDep" style="margin: 0 4px;" />
                <span id="localEditDepTime" class="time-local"></span>
              </label>
            </div>
          </div>
          <div class="modal-field">
            <label class="modal-label">ATD</label>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input id="editDepActual" class="modal-input" value="${m.depActual || ""}" style="width: 80px;" />
              <label style="font-size: 10px; color: #666; cursor: pointer;">
                <input type="checkbox" id="showLocalTimeEditDepActual" style="margin: 0 4px;" />
                <span id="localEditDepActualTime" class="time-local"></span>
              </label>
            </div>
          </div>
          <div class="modal-field">
            <label class="modal-label">ETA</label>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input id="editArrPlanned" class="modal-input" value="${m.arrPlanned || ""}" style="width: 80px;" />
              <label style="font-size: 10px; color: #666; cursor: pointer;">
                <input type="checkbox" id="showLocalTimeEditArr" style="margin: 0 4px;" />
                <span id="localEditArrTime" class="time-local"></span>
              </label>
            </div>
          </div>
          <div class="modal-field">
            <label class="modal-label">ATA</label>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input id="editArrActual" class="modal-input" value="${m.arrActual || ""}" style="width: 80px;" />
              <label style="font-size: 10px; color: #666; cursor: pointer;">
                <input type="checkbox" id="showLocalTimeEditArrActual" style="margin: 0 4px;" />
                <span id="localEditArrActualTime" class="time-local"></span>
              </label>
            </div>
          </div>
        </div>
      </section>

      <!-- Operational Section -->
      <section class="modal-section">
        <h3 class="modal-section-title">Operational</h3>
        <div class="modal-section-grid">
          <div class="modal-field">
            <label class="modal-label">POB</label>
            <input id="editPob" class="modal-input" type="number" value="${m.pob || 0}" min="0" />
          </div>
          <div class="modal-field">
            <label class="modal-label">EGOW Code <span style="color: #d32f2f;">*</span></label>
            <input id="editEgowCode" class="modal-input is-derived" value="${escapeHtml(m.egowCode || "")}" placeholder="e.g. BM, VM" />
          </div>
          <div class="modal-field">
            <label class="modal-label">EGOW Unit</label>
            <input id="editUnitCode" class="modal-input is-derived" value="${escapeHtml(m.unitCode || "")}" placeholder="e.g. L, M, A" />
          </div>
          <div class="modal-field">
            <label class="modal-label">T&amp;G</label>
            <input id="editTng" class="modal-input" type="number" value="${m.tngCount || 0}" min="0" />
          </div>
          <div class="modal-field">
            <label class="modal-label">O/S</label>
            <input id="editOsCount" class="modal-input" type="number" value="${m.osCount || 0}" min="0" />
          </div>
          <div class="modal-field">
            <label class="modal-label">FIS</label>
            <input id="editFisCount" class="modal-input" type="number" value="${m.fisCount || 0}" min="0" />
          </div>
        </div>
      </section>

      <!-- Collapsible: Remarks & Warnings -->
      <section class="modal-section modal-collapsible">
        <button type="button" class="modal-expander" aria-expanded="false" data-target="editRemarksWarnings">
          <span class="expander-icon">▶</span>
          Remarks &amp; Warnings
          <span class="expander-hint">(optional)</span>
        </button>
        <div id="editRemarksWarnings" class="modal-expander-panel" hidden>
          <div class="modal-section-grid">
            <div class="modal-field modal-field-full">
              <label class="modal-label">Remarks</label>
              <textarea id="editRwRemarks" class="modal-textarea" rows="3">${escapeHtml(m.remarks || "")}</textarea>
            </div>
            <div class="modal-field modal-field-full">
              <label class="modal-label">Warnings</label>
              <textarea id="editRwWarnings" class="modal-textarea" rows="3">${escapeHtml(m.warnings || "")}</textarea>
            </div>
          </div>
        </div>
      </section>

      <!-- Collapsible: ATC Details -->
      <section class="modal-section modal-collapsible">
        <button type="button" class="modal-expander" aria-expanded="false" data-target="editAtcDetails">
          <span class="expander-icon">▶</span>
          ATC Details
          <span class="expander-hint">(optional)</span>
        </button>
        <div id="editAtcDetails" class="modal-expander-panel" hidden>
          <div class="modal-section-grid">
            <div class="modal-field">
              <label class="modal-label">Squawk</label>
              <input id="editAtcSquawk" class="modal-input" value="${escapeHtml(m.squawk || "")}" placeholder="e.g. 7000" maxlength="4" />
            </div>
            <div class="modal-field">
              <label class="modal-label">Route</label>
              <input id="editAtcRoute" class="modal-input" value="${escapeHtml(m.route || "")}" placeholder="e.g. DCT" />
            </div>
            <div class="modal-field modal-field-full">
              <label class="modal-label">Clearance</label>
              <textarea id="editAtcClearance" class="modal-textarea" rows="2">${escapeHtml(m.clearance || "")}</textarea>
            </div>
          </div>
        </div>
      </section>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost js-close-modal" type="button">Cancel</button>
      <button class="btn btn-primary js-save-edit" type="button">Save Changes</button>
    </div>
  `);

  // Bind registration and callsign field interactions with VKB
  const callsignCodeInput = document.getElementById("editCallsignCode");
  const flightNumberInput = document.getElementById("editFlightNumber");
  const regInput = document.getElementById("editReg");
  const typeInput = document.getElementById("editType");
  const pobInput = document.getElementById("editPob");
  const egowCodeInput = document.getElementById("editEgowCode");
  const unitCodeInput = document.getElementById("editUnitCode");
  const depAdInput = document.getElementById("editDepAd");
  const arrAdInput = document.getElementById("editArrAd");

  // Apply automatic uppercase conversion to aviation-related fields
  makeInputUppercase(callsignCodeInput);
  makeInputUppercase(flightNumberInput);
  makeInputUppercase(regInput);
  makeInputUppercase(typeInput);
  makeInputUppercase(egowCodeInput);
  makeInputUppercase(unitCodeInput);
  makeInputUppercase(depAdInput);
  makeInputUppercase(arrAdInput);

  // When registration is entered, auto-fill type, fixed callsign/flight number, and EGOW code
  if (regInput && typeInput) {
    regInput.addEventListener("input", () => {
      const regData = lookupRegistration(regInput.value);
      if (regData) {
        // Auto-fill aircraft type from VKB
        const vkbType = regData['TYPE'];
        if (vkbType && vkbType !== '-' && vkbType !== '') {
          typeInput.value = vkbType;
        }

        // Auto-fill EGOW Code from registration
        const egowFlightType = regData['EGOW FLIGHT TYPE'];
        if (egowFlightType && egowFlightType !== '-' && egowFlightType !== '' && egowCodeInput) {
          egowCodeInput.value = egowFlightType;
        }

        // Auto-fill fixed callsign and flight number if available
        const fixedCallsign = regData['FIXED C/S'];
        if (fixedCallsign && fixedCallsign !== '-' && fixedCallsign !== '') {
          // Try to split into callsign code and flight number
          // e.g., "UAM01" → "UAM" + "01"
          const match = fixedCallsign.match(/^([A-Z]+)(\d+.*)?$/);
          if (match && callsignCodeInput && (!callsignCodeInput.value || callsignCodeInput.value === '')) {
            callsignCodeInput.value = match[1]; // Code part
            if (match[2] && flightNumberInput && (!flightNumberInput.value || flightNumberInput.value === '')) {
              flightNumberInput.value = match[2]; // Number part
            }
          }
        }
      } else {
        // Fallback to hardcoded lookup if not in VKB
        const inferredType = inferTypeFromReg(regInput.value);
        if (inferredType) {
          typeInput.value = inferredType;
        }
      }
    });
  }

  // When callsign code or flight number changes, check for UAM pattern, lookup unit code, and auto-fill registration if fixed callsign
  const updateCallsignDerivedFields = () => {
    const code = callsignCodeInput?.value?.toUpperCase().trim() || '';
    const number = flightNumberInput?.value?.trim() || '';
    const fullCallsign = code + number;

    // UAM* pattern → POB = 2
    if (code.startsWith('UAM') && pobInput && (pobInput.value === '0' || !pobInput.value)) {
      pobInput.value = '2';
    }

    // Lookup unit code from full callsign
    if (fullCallsign && unitCodeInput) {
      const unitData = lookupCallsign(fullCallsign);
      if (unitData && unitData['UC'] && unitData['UC'] !== '-' && unitData['UC'] !== '') {
        unitCodeInput.value = unitData['UC'];
      }
    }

    // If callsign matches a fixed callsign, auto-fill registration (only if registration is empty)
    if (fullCallsign && regInput && (!regInput.value || regInput.value === '')) {
      const regData = lookupRegistrationByFixedCallsign(fullCallsign);
      if (regData) {
        const registration = regData['REGISTRATION'] || '';
        if (registration && registration !== '-') {
          regInput.value = registration;
          // Trigger registration input event to update dependent fields
          regInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    }
  };

  if (callsignCodeInput) {
    callsignCodeInput.addEventListener("input", updateCallsignDerivedFields);
  }
  if (flightNumberInput) {
    flightNumberInput.addEventListener("input", updateCallsignDerivedFields);
  }

  // Wire collapsible sections
  document.querySelectorAll('.modal-expander').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const panel = document.getElementById(targetId);
      const isExpanded = btn.getAttribute('aria-expanded') === 'true';

      btn.setAttribute('aria-expanded', !isExpanded);
      panel.hidden = isExpanded;
      btn.querySelector('.expander-icon').textContent = isExpanded ? '▶' : '▼';
    });
  });

  // Wire Priority checkbox/dropdown
  const editPriorityEnabled = document.getElementById('editPriorityEnabled');
  const editPriorityLetter = document.getElementById('editPriorityLetter');
  if (editPriorityEnabled && editPriorityLetter) {
    editPriorityEnabled.addEventListener('change', () => {
      editPriorityLetter.disabled = !editPriorityEnabled.checked;
      if (!editPriorityEnabled.checked) {
        editPriorityLetter.value = '';
      }
    });
  }

  // Auto-fill Remarks and Warnings from registration data
  const editRemarksInput = document.getElementById('editRwRemarks');
  const editWarningsInput = document.getElementById('editRwWarnings');

  if (regInput && editRemarksInput && editWarningsInput) {
    regInput.addEventListener("input", () => {
      const regData = lookupRegistration(regInput.value);
      if (regData) {
        // Auto-fill Warnings (column 15)
        const warningsText = regData['WARNINGS'] || '';
        if (warningsText && warningsText !== '-') {
          const currentWarnings = editWarningsInput.value.trim();
          const lastAutofill = editWarningsInput.dataset.autofillValue || '';
          if (!currentWarnings || currentWarnings === lastAutofill) {
            editWarningsInput.value = warningsText;
            editWarningsInput.dataset.autofillValue = warningsText;
          }
        }

        // Auto-fill Remarks/Notes (column 16)
        const notesText = regData['NOTES'] || '';
        if (notesText && notesText !== '-') {
          const currentRemarks = editRemarksInput.value.trim();
          const lastAutofill = editRemarksInput.dataset.autofillValue || '';
          if (!currentRemarks || currentRemarks === lastAutofill) {
            editRemarksInput.value = notesText;
            editRemarksInput.dataset.autofillValue = notesText;
          }
        }
      }
    });
  }

  // Bind local time display handlers for all time fields
  const depPlannedInput = document.getElementById("editDepPlanned");
  const depActualInput = document.getElementById("editDepActual");
  const arrPlannedInput = document.getElementById("editArrPlanned");
  const arrActualInput = document.getElementById("editArrActual");

  const showLocalDepPlannedCheck = document.getElementById("showLocalTimeEditDep");
  const showLocalDepActualCheck = document.getElementById("showLocalTimeEditDepActual");
  const showLocalArrPlannedCheck = document.getElementById("showLocalTimeEditArr");
  const showLocalArrActualCheck = document.getElementById("showLocalTimeEditArrActual");

  const localDepPlannedSpan = document.getElementById("localEditDepTime");
  const localDepActualSpan = document.getElementById("localEditDepActualTime");
  const localArrPlannedSpan = document.getElementById("localEditArrTime");
  const localArrActualSpan = document.getElementById("localEditArrActualTime");

  function updateLocalTime(checkbox, input, span) {
    if (checkbox && checkbox.checked && input && span) {
      const utcTime = input.value;
      const localTime = convertUTCToLocal(utcTime);
      const offset = getTimezoneOffsetLabel();
      span.textContent = localTime ? `Local: ${localTime} (${offset})` : "";
    } else if (span) {
      span.textContent = "";
    }
  }

  if (showLocalDepPlannedCheck) {
    showLocalDepPlannedCheck.addEventListener("change", () =>
      updateLocalTime(showLocalDepPlannedCheck, depPlannedInput, localDepPlannedSpan));
  }
  if (depPlannedInput) {
    depPlannedInput.addEventListener("input", () =>
      updateLocalTime(showLocalDepPlannedCheck, depPlannedInput, localDepPlannedSpan));
  }

  if (showLocalDepActualCheck) {
    showLocalDepActualCheck.addEventListener("change", () =>
      updateLocalTime(showLocalDepActualCheck, depActualInput, localDepActualSpan));
  }
  if (depActualInput) {
    depActualInput.addEventListener("input", () =>
      updateLocalTime(showLocalDepActualCheck, depActualInput, localDepActualSpan));
  }

  if (showLocalArrPlannedCheck) {
    showLocalArrPlannedCheck.addEventListener("change", () =>
      updateLocalTime(showLocalArrPlannedCheck, arrPlannedInput, localArrPlannedSpan));
  }
  if (arrPlannedInput) {
    arrPlannedInput.addEventListener("input", () =>
      updateLocalTime(showLocalArrPlannedCheck, arrPlannedInput, localArrPlannedSpan));
  }

  if (showLocalArrActualCheck) {
    showLocalArrActualCheck.addEventListener("change", () =>
      updateLocalTime(showLocalArrActualCheck, arrActualInput, localArrActualSpan));
  }
  if (arrActualInput) {
    arrActualInput.addEventListener("input", () =>
      updateLocalTime(showLocalArrActualCheck, arrActualInput, localArrActualSpan));
  }

  // Bind save handler with validation
  document.querySelector(".js-save-edit")?.addEventListener("click", () => {
    // Get form values
    const dof = document.getElementById("editDOF")?.value || getTodayDateString();
    let depPlanned = document.getElementById("editDepPlanned")?.value || "";
    let depActual = document.getElementById("editDepActual")?.value || "";
    let arrPlanned = document.getElementById("editArrPlanned")?.value || "";
    let arrActual = document.getElementById("editArrActual")?.value || "";
    const pob = document.getElementById("editPob")?.value || "0";
    const tng = document.getElementById("editTng")?.value || "0";
    const callsignCode = document.getElementById("editCallsignCode")?.value || "";
    const flightNumber = document.getElementById("editFlightNumber")?.value || "";
    const callsign = callsignCode + flightNumber; // Combine for full callsign

    // Validate inputs
    const dofValidation = validateDate(dof);
    if (!dofValidation.valid) {
      showToast(dofValidation.error, 'error');
      return;
    }

    const depPlannedValidation = validateTime(depPlanned);
    const depActualValidation = validateTime(depActual);
    const arrPlannedValidation = validateTime(arrPlanned);
    const arrActualValidation = validateTime(arrActual);

    const validations = [
      { result: depPlannedValidation, label: "Planned departure time" },
      { result: depActualValidation, label: "Actual departure time" },
      { result: arrPlannedValidation, label: "Planned arrival time" },
      { result: arrActualValidation, label: "Actual arrival time" },
      { result: validateNumberRange(pob, 0, 999, "POB"), label: null },
      { result: validateNumberRange(tng, 0, 99, "T&G count"), label: null }
    ];

    for (const validation of validations) {
      if (!validation.result.valid) {
        const msg = validation.label ? `${validation.label}: ${validation.result.error}` : validation.result.error;
        showToast(msg, 'error');
        return;
      }
    }

    // Use normalized times if provided
    if (depPlannedValidation.normalized) {
      depPlanned = depPlannedValidation.normalized;
      document.getElementById("editDepPlanned").value = depPlanned;
    }
    if (depActualValidation.normalized) {
      depActual = depActualValidation.normalized;
      document.getElementById("editDepActual").value = depActual;
    }
    if (arrPlannedValidation.normalized) {
      arrPlanned = arrPlannedValidation.normalized;
      document.getElementById("editArrPlanned").value = arrPlanned;
    }
    if (arrActualValidation.normalized) {
      arrActual = arrActualValidation.normalized;
      document.getElementById("editArrActual").value = arrActual;
    }

    // Check for past times and show warning
    if (depPlanned) {
      const depPastCheck = checkPastTime(depPlanned, dof);
      if (depPastCheck.isPast) showToast(depPastCheck.warning, 'warning');
    }
    if (depActual) {
      const depActualPastCheck = checkPastTime(depActual, dof);
      if (depActualPastCheck.isPast) showToast(depActualPastCheck.warning, 'warning');
    }
    if (arrPlanned) {
      const arrPastCheck = checkPastTime(arrPlanned, dof);
      if (arrPastCheck.isPast) showToast(arrPastCheck.warning, 'warning');
    }
    if (arrActual) {
      const arrActualPastCheck = checkPastTime(arrActual, dof);
      if (arrActualPastCheck.isPast) showToast(arrActualPastCheck.warning, 'warning');
    }

    // Get WTC based on aircraft type and flight type
    const aircraftType = document.getElementById("editType")?.value || "";
    const selectedFlightType = document.getElementById("editFlightType")?.value || flightType;
    const wtc = getWTC(aircraftType, selectedFlightType, "UK");

    // Get voice callsign for display
    const regValue = document.getElementById("editReg")?.value || "";
    const regData = lookupRegistration(regValue);
    const popularName = regData ? (regData['POPULAR NAME'] || "") : "";
    const voiceCallsign = getVoiceCallsignForDisplay(callsign, regValue);

    // Get departure and arrival location names
    const depAd = document.getElementById("editDepAd")?.value || "";
    const arrAd = document.getElementById("editArrAd")?.value || "";
    const depName = getLocationName(depAd);
    const arrName = getLocationName(arrAd);

    // Get new optional fields
    const editPriorityEnabledCheck = document.getElementById("editPriorityEnabled")?.checked || false;
    const editPriorityLetterValue = editPriorityEnabledCheck ? (document.getElementById("editPriorityLetter")?.value || "") : "";
    const editRemarksValue = document.getElementById("editRwRemarks")?.value || "";
    const editWarningsValue = document.getElementById("editRwWarnings")?.value || "";
    const editOsCountValue = parseInt(document.getElementById("editOsCount")?.value || "0", 10);
    const editFisCountValue = parseInt(document.getElementById("editFisCount")?.value || "0", 10);
    const editSquawkValue = document.getElementById("editAtcSquawk")?.value || "";
    const editRouteValue = document.getElementById("editAtcRoute")?.value || "";
    const editClearanceValue = document.getElementById("editAtcClearance")?.value || "";

    // Update movement
    const updates = {
      callsignCode: callsign,
      callsignVoice: voiceCallsign,
      registration: regValue,
      type: aircraftType,
      popularName: popularName,
      wtc: wtc,
      flightType: selectedFlightType,
      rules: document.getElementById("editRules")?.value || "VFR",
      depAd: depAd,
      depName: depName,
      arrAd: arrAd,
      arrName: arrName,
      depPlanned: depPlanned,
      depActual: depActual,
      arrPlanned: arrPlanned,
      arrActual: arrActual,
      dof: dof,
      tngCount: parseInt(tng, 10),
      pob: parseInt(pob, 10),
      osCount: editOsCountValue,
      fisCount: editFisCountValue,
      egowCode: document.getElementById("editEgowCode")?.value || "",
      unitCode: document.getElementById("editUnitCode")?.value || "",
      priorityLetter: editPriorityLetterValue,
      remarks: editRemarksValue,
      warnings: editWarningsValue,
      squawk: editSquawkValue,
      route: editRouteValue,
      clearance: editClearanceValue
    };

    updateMovement(m.id, updates);
    renderLiveBoard();
    renderHistoryBoard();
    showToast("Movement updated successfully", 'success');

    // Close modal
    const modalRoot = document.getElementById("modalRoot");
    if (modalRoot) modalRoot.innerHTML = "";
  });
}

/**
 * Open duplicate modal - copy existing movement with pre-filled values
 * Creates new movement with PLANNED status
 */
function openDuplicateMovementModal(m) {
  const flightType = m.flightType || "DEP";

  openModal(`
    <div class="modal-header">
      <div>
        <div class="modal-title">Duplicate ${flightType} Flight</div>
        <div class="modal-subtitle">Creating copy of Movement ID: ${m.id}</div>
      </div>
      <div class="modal-header-buttons">
        <button class="btn btn-ghost js-minimize-modal" type="button" title="Minimize">−</button>
        <button class="btn btn-ghost js-close-modal" type="button" title="Close">✕</button>
      </div>
    </div>
    <div class="modal-body">
      <div class="modal-field">
        <label class="modal-label">Callsign</label>
        <input id="dupCallsign" class="modal-input" value="${escapeHtml(m.callsignCode || "")}" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Registration</label>
        <input id="dupReg" class="modal-input" value="${escapeHtml(m.registration || "")}" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Aircraft Type</label>
        <input id="dupType" class="modal-input" value="${escapeHtml(m.type || "")}" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Flight Type</label>
        <select id="dupFlightType" class="modal-select">
          <option ${flightType === "ARR" ? "selected" : ""}>ARR</option>
          <option ${flightType === "DEP" ? "selected" : ""}>DEP</option>
          <option ${flightType === "LOC" ? "selected" : ""}>LOC</option>
          <option ${flightType === "OVR" ? "selected" : ""}>OVR</option>
        </select>
      </div>
      <div class="modal-field">
        <label class="modal-label">Flight Rules</label>
        <select id="dupRules" class="modal-select">
          <option value="VFR" ${m.rules === "VFR" ? "selected" : ""}>VFR</option>
          <option value="IFR" ${m.rules === "IFR" ? "selected" : ""}>IFR</option>
          <option value="Y" ${m.rules === "Y" ? "selected" : ""}>Y (IFR to VFR)</option>
          <option value="Z" ${m.rules === "Z" ? "selected" : ""}>Z (VFR to IFR)</option>
          <option value="SVFR" ${m.rules === "SVFR" ? "selected" : ""}>SVFR</option>
        </select>
      </div>
      <div class="modal-field">
        <label class="modal-label">Departure AD</label>
        <input id="dupDepAd" class="modal-input" value="${escapeHtml(m.depAd || "")}" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Arrival AD</label>
        <input id="dupArrAd" class="modal-input" value="${escapeHtml(m.arrAd || "")}" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Date of Flight (DOF)</label>
        <input id="dupDOF" type="date" class="modal-input" value="${getTodayDateString()}" />
      </div>
      <div class="modal-field">
        <label class="modal-label">
          Estimated Departure (ETD / ECT) - UTC
          <span style="font-size: 11px; font-weight: normal; margin-left: 8px;">
            <input type="checkbox" id="showLocalTimeDupDep" style="margin: 0 4px;"/>Show Local Time
          </span>
        </label>
        <div style="display: flex; gap: 8px; align-items: center;">
          <input id="dupDepPlanned" class="modal-input" value="${m.depPlanned || ""}" style="width: 80px;" />
          <span id="localDupDepTime" style="font-size: 12px; color: #666;"></span>
        </div>
      </div>
      <div class="modal-field">
        <label class="modal-label">
          Estimated Arrival (ETA) - UTC
          <span style="font-size: 11px; font-weight: normal; margin-left: 8px;">
            <input type="checkbox" id="showLocalTimeDupArr" style="margin: 0 4px;"/>Show Local Time
          </span>
        </label>
        <div style="display: flex; gap: 8px; align-items: center;">
          <input id="dupArrPlanned" class="modal-input" value="${m.arrPlanned || ""}" style="width: 80px;" />
          <span id="localDupArrTime" style="font-size: 12px; color: #666;"></span>
        </div>
      </div>
      <div class="modal-field">
        <label class="modal-label">POB</label>
        <input id="dupPob" class="modal-input" type="number" value="${m.pob || 0}" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Touch &amp; Go count</label>
        <input id="dupTng" class="modal-input" type="number" value="${m.tngCount || 0}" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Remarks</label>
        <textarea id="dupRemarks" class="modal-textarea">${escapeHtml(m.remarks || "")}</textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost js-close-modal" type="button">Cancel</button>
      <button class="btn btn-primary js-save-dup" type="button">Create Duplicate</button>
    </div>
  `);

  // Bind type inference
  const regInput = document.getElementById("dupReg");
  const typeInput = document.getElementById("dupType");
  if (regInput && typeInput) {
    regInput.addEventListener("input", () => {
      const inferredType = inferTypeFromReg(regInput.value);
      if (inferredType) {
        typeInput.value = inferredType;
      }
    });
  }

  // Bind local time display handlers
  const depTimeInput = document.getElementById("dupDepPlanned");
  const arrTimeInput = document.getElementById("dupArrPlanned");
  const showLocalDepCheck = document.getElementById("showLocalTimeDupDep");
  const showLocalArrCheck = document.getElementById("showLocalTimeDupArr");
  const localDepSpan = document.getElementById("localDupDepTime");
  const localArrSpan = document.getElementById("localDupArrTime");

  function updateLocalDepTime() {
    if (showLocalDepCheck && showLocalDepCheck.checked && depTimeInput && localDepSpan) {
      const utcTime = depTimeInput.value;
      const localTime = convertUTCToLocal(utcTime);
      const offset = getTimezoneOffsetLabel();
      localDepSpan.textContent = localTime ? `Local: ${localTime} (${offset})` : "";
    } else if (localDepSpan) {
      localDepSpan.textContent = "";
    }
  }

  function updateLocalArrTime() {
    if (showLocalArrCheck && showLocalArrCheck.checked && arrTimeInput && localArrSpan) {
      const utcTime = arrTimeInput.value;
      const localTime = convertUTCToLocal(utcTime);
      const offset = getTimezoneOffsetLabel();
      localArrSpan.textContent = localTime ? `Local: ${localTime} (${offset})` : "";
    } else if (localArrSpan) {
      localArrSpan.textContent = "";
    }
  }

  if (showLocalDepCheck) showLocalDepCheck.addEventListener("change", updateLocalDepTime);
  if (showLocalArrCheck) showLocalArrCheck.addEventListener("change", updateLocalArrTime);
  if (depTimeInput) depTimeInput.addEventListener("input", updateLocalDepTime);
  if (arrTimeInput) arrTimeInput.addEventListener("input", updateLocalArrTime);

  // Bind save handler with validation
  document.querySelector(".js-save-dup")?.addEventListener("click", () => {
    // Get form values
    const dof = document.getElementById("dupDOF")?.value || getTodayDateString();
    const depPlanned = document.getElementById("dupDepPlanned")?.value || "";
    const arrPlanned = document.getElementById("dupArrPlanned")?.value || "";
    const pob = document.getElementById("dupPob")?.value || "0";
    const tng = document.getElementById("dupTng")?.value || "0";
    const callsign = document.getElementById("dupCallsign")?.value || "";

    // Validate inputs
    const dofValidation = validateDate(dof);
    if (!dofValidation.valid) {
      showToast(dofValidation.error, 'error');
      return;
    }

    const depValidation = validateTime(depPlanned);
    if (!depValidation.valid) {
      showToast(`Departure time: ${depValidation.error}`, 'error');
      return;
    }

    const arrValidation = validateTime(arrPlanned);
    if (!arrValidation.valid) {
      showToast(`Arrival time: ${arrValidation.error}`, 'error');
      return;
    }

    const pobValidation = validateNumberRange(pob, 0, 999, "POB");
    if (!pobValidation.valid) {
      showToast(pobValidation.error, 'error');
      return;
    }

    const tngValidation = validateNumberRange(tng, 0, 99, "T&G count");
    if (!tngValidation.valid) {
      showToast(tngValidation.error, 'error');
      return;
    }

    const callsignValidation = validateRequired(callsign, "Callsign");
    if (!callsignValidation.valid) {
      showToast(callsignValidation.error, 'error');
      return;
    }

    // Get voice callsign for display (only if different from contraction/registration)
    const regValue = document.getElementById("dupReg")?.value || "";
    const regData = lookupRegistration(regValue);
    const popularName = regData ? (regData['POPULAR NAME'] || "") : "";
    const voiceCallsign = getVoiceCallsignForDisplay(callsign, regValue);

    // Get WTC based on aircraft type and flight type
    const aircraftType = document.getElementById("dupType")?.value || "";
    const selectedFlightType = document.getElementById("dupFlightType")?.value || flightType;
    const wtc = getWTC(aircraftType, selectedFlightType, "UK");

    // Get departure and arrival location names
    const depAd = document.getElementById("dupDepAd")?.value || "";
    const arrAd = document.getElementById("dupArrAd")?.value || "";
    const depName = getLocationName(depAd);
    const arrName = getLocationName(arrAd);

    // Get warnings and notes from registration
    const warnings = regData ? (regData['WARNINGS'] || "") : "";
    const notes = regData ? (regData['NOTES'] || "") : "";
    const operator = regData ? (regData['OPERATOR'] || "") : "";

    // Create movement
    let movement = {
      status: "PLANNED",
      callsignCode: callsign,
      callsignLabel: m.callsignLabel || "",
      callsignVoice: voiceCallsign,
      registration: document.getElementById("dupReg")?.value || "",
      operator: operator || m.operator || "",
      type: aircraftType,
      popularName: popularName,
      wtc: wtc,
      depAd: depAd,
      depName: depName,
      arrAd: arrAd,
      arrName: arrName,
      depPlanned: depPlanned,
      depActual: "",
      arrPlanned: arrPlanned,
      arrActual: "",
      dof: dof,
      rules: document.getElementById("dupRules")?.value || m.rules || "VFR",
      flightType: document.getElementById("dupFlightType")?.value || flightType,
      isLocal: (document.getElementById("dupFlightType")?.value || flightType) === "LOC",
      tngCount: parseInt(tng, 10),
      osCount: m.osCount || 0,
      fisCount: (document.getElementById("dupFlightType")?.value || m.flightType) === "OVR" ? 1 : 0,
      egowCode: m.egowCode || "",
      egowDesc: m.egowDesc || "",
      unitCode: m.unitCode || "",
      unitDesc: m.unitDesc || "",
      captain: m.captain || "",
      pob: parseInt(pob, 10),
      remarks: document.getElementById("dupRemarks")?.value || "",
      warnings: warnings || m.warnings || "",
      notes: notes || m.notes || "",
      squawk: m.squawk || "",
      route: m.route || "",
      clearance: m.clearance || "",
      formation: null
    };

    // Enrich with auto-populated fields
    movement = enrichMovementData(movement);

    createMovement(movement);
    renderLiveBoard();
    renderHistoryBoard();
    showToast("Duplicate movement created successfully", 'success');

    // Close modal
    const modalRoot = document.getElementById("modalRoot");
    if (modalRoot) modalRoot.innerHTML = "";
  });
}

/**
 * Transition a PLANNED movement to ACTIVE
 * Sets ATD/ACT to current time
 * Auto-updates DOF to today if flight was planned for future date
 */
function transitionToActive(id) {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const currentTime = `${hours}:${minutes}`;

  // Get today's date in YYYY-MM-DD format
  const todayStr = getTodayDateString();

  // Get the movement to check its DOF
  const movement = getMovements().find(m => m.id === id);
  const updates = {
    status: "ACTIVE",
    depActual: currentTime
  };

  // If DOF is in the future, update it to today
  if (movement && movement.dof && movement.dof > todayStr) {
    updates.dof = todayStr;
    showToast(`Flight activated early - DOF updated from ${movement.dof.split('-').reverse().join('/')} to today`, 'info');
  }

  updateMovement(id, updates);

  renderLiveBoard();
  renderHistoryBoard();
}

/**
 * Transition an ACTIVE movement to COMPLETED
 * Sets ATA to current time if not already set
 */
function transitionToCompleted(id) {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const currentTime = `${hours}:${minutes}`;

  updateMovement(id, {
    status: "COMPLETED",
    arrActual: currentTime
  });

  renderLiveBoard();
  renderHistoryBoard();
}

/* -----------------------------
   Live Board init
------------------------------ */

/**
 * Initialise Live Board event listeners and initial render.
 * Supports both the current HTML IDs and legacy ones (for safety).
 */
/**
 * Initialize Live Board event listeners and render
 */
export function initLiveBoard() {
  // Elements
  const globalSearch = firstById(["globalSearch", "searchGlobal"]);
  const statusFilter = byId("statusFilter");
  const plannedWindowSelect = byId("plannedWindowHours");
  const btnNewLoc = document.getElementById("btnNewLoc");
  const btnNewDep = document.getElementById("btnNewDep");
  const btnNewArr = document.getElementById("btnNewArr");
  const btnNewOvr = document.getElementById("btnNewOvr");

  // Global search filter with debounce (150ms delay)
  const debouncedSearch = debounce((value) => {
    state.globalFilter = value;
    renderLiveBoard();
  }, 150);

  safeOn(globalSearch, "input", (e) => {
    debouncedSearch(e.target.value);
  });

  // Status filter
  safeOn(statusFilter, "change", () => renderLiveBoard());

  // Planned window filter
  safeOn(plannedWindowSelect, "change", (e) => {
    state.plannedWindowHours = parseInt(e.target.value, 10);
    renderLiveBoard();
  });

  // New movement buttons
  safeOn(btnNewLoc, "click", openNewLocalModal);
  safeOn(btnNewDep, "click", () => openNewFlightModal("DEP"));
  safeOn(btnNewArr, "click", () => openNewFlightModal("ARR"));
  safeOn(btnNewOvr, "click", () => openNewFlightModal("OVR"));

  renderLiveBoard();
}

/* -----------------------------
   Stubs for other panels (kept for app.js imports)
   If you already have implementations elsewhere in your file, keep those instead.
------------------------------ */

/* -----------------------------
   History Board
------------------------------ */

let historySortColumn = 'time';
let historySortDirection = 'desc'; // desc = most recent first

/**
 * Sort history movements by specified column
 * @param {Array} movements - Array of movements
 * @param {string} column - Column to sort by
 * @param {string} direction - 'asc' or 'desc'
 * @returns {Array} Sorted movements
 */
function sortHistoryMovements(movements, column, direction) {
  return movements.slice().sort((a, b) => {
    let valA, valB;

    switch (column) {
      case 'callsign':
        valA = (a.callsignCode || '').toLowerCase();
        valB = (b.callsignCode || '').toLowerCase();
        break;
      case 'regtype':
        valA = `${a.registration || ''} ${a.type || ''}`.toLowerCase();
        valB = `${b.registration || ''} ${b.type || ''}`.toLowerCase();
        break;
      case 'route':
        valA = `${a.depAd || ''} ${a.arrAd || ''}`.toLowerCase();
        valB = `${b.depAd || ''} ${b.arrAd || ''}`.toLowerCase();
        break;
      case 'time':
        // Sort by DOF first, then by completion time
        const dofA = getDOFTimestamp(a);
        const dofB = getDOFTimestamp(b);
        if (dofA !== dofB) return direction === 'asc' ? dofA - dofB : dofB - dofA;

        // Use actual times for completed movements
        valA = timeToMinutes(getATA(a) || getATD(a) || getACT(a) || getETA(a) || getETD(a) || getECT(a));
        valB = timeToMinutes(getATA(b) || getATD(b) || getACT(b) || getETA(b) || getETD(b) || getECT(b));
        break;
      case 'activity':
        valA = (a.flightType || '').toLowerCase();
        valB = (b.flightType || '').toLowerCase();
        break;
      case 'status':
        valA = (a.status || '').toLowerCase();
        valB = (b.status || '').toLowerCase();
        break;
      default:
        return 0;
    }

    if (valA === valB) return 0;
    const comparison = valA < valB ? -1 : 1;
    return direction === 'asc' ? comparison : -comparison;
  });
}

/**
 * Render the History Board table
 * Shows COMPLETED and CANCELLED movements
 */
export function renderHistoryBoard() {
  const tbody = byId("historyBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  // Get completed and cancelled movements
  const movements = getMovements().filter(m =>
    m.status === "COMPLETED" || m.status === "CANCELLED"
  );

  // Sort movements
  const sorted = sortHistoryMovements(movements, historySortColumn, historySortDirection);

  if (sorted.length === 0) {
    const empty = document.createElement("tr");
    empty.innerHTML = `
      <td colspan="7" style="padding:8px; font-size:12px; color:#777;">
        No completed or cancelled movements in this session.
      </td>
    `;
    tbody.appendChild(empty);
    return;
  }

  for (const m of sorted) {
    const tr = document.createElement("tr");
    tr.className = `strip strip-row ${flightTypeClass(m.flightType)}`;

    // Calculate times display
    const ft = (m.flightType || "").toUpperCase();
    let depDisplay = "-";
    let arrDisplay = "-";

    if (ft === "DEP" || ft === "LOC") {
      depDisplay = getATD(m) || getETD(m) || "-";
    }
    if (ft === "ARR" || ft === "LOC") {
      arrDisplay = getATA(m) || getETA(m) || "-";
    }
    if (ft === "OVR") {
      depDisplay = getACT(m) || getECT(m) || "-";
      arrDisplay = "-";
    }

    tr.innerHTML = `
      <td><div class="status-strip ${escapeHtml(statusClass(m.status))}" title="${escapeHtml(statusLabel(m.status))}"></div></td>
      <td>
        <div class="call-main">${escapeHtml(m.callsignCode)}</div>
        <div class="call-sub">${m.callsignVoice ? escapeHtml(m.callsignVoice) : "&nbsp;"}</div>
      </td>
      <td>
        <div class="cell-strong">${escapeHtml(m.registration || "—")}${m.type ? ` · <span title="${escapeHtml(m.popularName || '')}">${escapeHtml(m.type)}</span>` : ""}</div>
        <div class="cell-muted">WTC: ${escapeHtml(m.wtc || "—")}</div>
      </td>
      <td>
        <div class="cell-strong"><span${m.depName && m.depName !== '' ? ` title="${m.depName}"` : ''}>${escapeHtml(m.depAd)}</span></div>
        <div class="cell-strong"><span${m.arrName && m.arrName !== '' ? ` title="${m.arrName}"` : ''}>${escapeHtml(m.arrAd)}</span></div>
      </td>
      <td>
        <div class="cell-strong">${escapeHtml(depDisplay)} / ${escapeHtml(arrDisplay)}</div>
        <div class="cell-muted">${m.dof ? escapeHtml(m.dof) : "—"}</div>
      </td>
      <td>
        <div class="badge-row">
          ${renderBadges(m)}
        </div>
      </td>
      <td>
        <span class="badge ${m.status === 'COMPLETED' ? 'badge-success' : 'badge-cancelled'}">${escapeHtml(statusLabel(m.status))}</span>
      </td>
    `;

    tbody.appendChild(tr);
  }
}

/**
 * Initialize History board sorting
 */
export function initHistoryBoard() {
  const historyTable = byId("historyTable");
  if (!historyTable) return;

  // Bind sort headers
  const headers = historyTable.querySelectorAll("thead th[data-sort]");
  headers.forEach(header => {
    header.style.cursor = "pointer";
    header.addEventListener("click", () => {
      const column = header.dataset.sort;

      // Toggle direction if clicking same column
      if (historySortColumn === column) {
        historySortDirection = historySortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        historySortColumn = column;
        historySortDirection = 'desc'; // Default to descending for new column
      }

      // Update visual indicators
      headers.forEach(h => {
        h.textContent = h.textContent.replace(/ ▲| ▼/g, '');
      });
      const indicator = historySortDirection === 'asc' ? ' ▲' : ' ▼';
      header.textContent = header.textContent + indicator;

      renderHistoryBoard();
    });
  });

  renderHistoryBoard();
}

/* -----------------------------
   Reports
------------------------------ */

/**
 * Render the Reports summary panel
 * Shows statistics and breakdowns
 */
export function renderReportsSummary() {
  const container = byId("reportsSummary");
  if (!container) return;

  const movements = getMovements();

  // Calculate statistics
  const stats = {
    total: movements.length,
    byStatus: {},
    byFlightType: {},
    byUnit: {},
    byEgowCode: {},
    tngTotal: 0,
    fisTotal: 0,
    osTotal: 0,
    pobTotal: 0
  };

  movements.forEach(m => {
    // Status counts
    const status = m.status || 'UNKNOWN';
    stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;

    // Flight type counts
    const ft = m.flightType || 'UNKNOWN';
    stats.byFlightType[ft] = (stats.byFlightType[ft] || 0) + 1;

    // Unit counts
    if (m.unitCode) {
      const unit = `${m.unitCode}${m.unitDesc ? ' - ' + m.unitDesc : ''}`;
      stats.byUnit[unit] = (stats.byUnit[unit] || 0) + 1;
    }

    // EGOW code counts
    if (m.egowCode) {
      const code = `${m.egowCode}${m.egowDesc ? ' - ' + m.egowDesc : ''}`;
      stats.byEgowCode[code] = (stats.byEgowCode[code] || 0) + 1;
    }

    // Totals
    stats.tngTotal += m.tngCount || 0;
    stats.fisTotal += m.fisCount || 0;
    stats.osTotal += m.osCount || 0;
    stats.pobTotal += m.pob || 0;
  });

  // Build HTML
  let html = '<div class="reports-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;">';

  // Summary card
  html += `
    <div class="report-card">
      <div class="report-card-title">Total Movements</div>
      <div class="report-card-main">${stats.total}</div>
      <div class="report-card-breakdown">
        Session statistics
      </div>
    </div>
  `;

  // Status breakdown
  html += `
    <div class="report-card">
      <div class="report-card-title">By Status</div>
      <div class="report-card-main">${stats.total}</div>
      <div class="report-card-breakdown">
        ${Object.entries(stats.byStatus).map(([status, count]) =>
          `<div>${status}: ${count}</div>`
        ).join('')}
      </div>
    </div>
  `;

  // Flight type breakdown
  html += `
    <div class="report-card">
      <div class="report-card-title">By Flight Type</div>
      <div class="report-card-main">${stats.total}</div>
      <div class="report-card-breakdown">
        ${Object.entries(stats.byFlightType).map(([type, count]) =>
          `<div>${type}: ${count}</div>`
        ).join('')}
      </div>
    </div>
  `;

  // Activity totals
  html += `
    <div class="report-card">
      <div class="report-card-title">Activity Totals</div>
      <div class="report-card-main">${stats.tngTotal + stats.fisTotal + stats.osTotal}</div>
      <div class="report-card-breakdown">
        <div>T&G: ${stats.tngTotal}</div>
        <div>FIS: ${stats.fisTotal}</div>
        <div>O/S: ${stats.osTotal}</div>
        <div>Total POB: ${stats.pobTotal}</div>
      </div>
    </div>
  `;

  // Top units
  const topUnits = Object.entries(stats.byUnit)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (topUnits.length > 0) {
    html += `
      <div class="report-card">
        <div class="report-card-title">Top Units</div>
        <div class="report-card-main">${topUnits.length}</div>
        <div class="report-card-breakdown">
          ${topUnits.map(([unit, count]) =>
            `<div>${escapeHtml(unit)}: ${count}</div>`
          ).join('')}
        </div>
      </div>
    `;
  }

  // Top EGOW codes
  const topCodes = Object.entries(stats.byEgowCode)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (topCodes.length > 0) {
    html += `
      <div class="report-card">
        <div class="report-card-title">Top EGOW Codes</div>
        <div class="report-card-main">${topCodes.length}</div>
        <div class="report-card-breakdown">
          ${topCodes.map(([code, count]) =>
            `<div>${escapeHtml(code)}: ${count}</div>`
          ).join('')}
        </div>
      </div>
    `;
  }

  html += '</div>';

  container.innerHTML = html;
}

/* -----------------------------
   CSV Export
------------------------------ */

/**
 * Export history to CSV
 * Includes all relevant fields
 */
function exportHistoryCSV() {
  const movements = getMovements().filter(m =>
    m.status === "COMPLETED" || m.status === "CANCELLED"
  );

  if (movements.length === 0) {
    showToast("No history movements to export", 'warning');
    return;
  }

  // CSV headers
  const headers = [
    "ID",
    "Status",
    "Flight Type",
    "Rules",
    "Callsign",
    "Registration",
    "Type",
    "WTC",
    "Dep AD",
    "Arr AD",
    "DOF",
    "ETD/ECT",
    "ATD/ACT",
    "ETA",
    "ATA",
    "T&G Count",
    "O/S Count",
    "FIS Count",
    "POB",
    "EGOW Code",
    "Unit",
    "Remarks"
  ];

  // Build CSV rows
  const rows = movements.map(m => [
    m.id || '',
    m.status || '',
    m.flightType || '',
    m.rules || '',
    m.callsignCode || '',
    m.registration || '',
    m.type || '',
    m.wtc || '',
    m.depAd || '',
    m.arrAd || '',
    m.dof || '',
    getETD(m) || getECT(m) || '',
    getATD(m) || getACT(m) || '',
    getETA(m) || '',
    getATA(m) || '',
    m.tngCount || 0,
    m.osCount || 0,
    m.fisCount || 0,
    m.pob || 0,
    m.egowCode || '',
    m.unitCode || '',
    m.remarks || ''
  ]);

  // Escape CSV values (handle commas, quotes, newlines)
  const escapeCSV = (value) => {
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  // Build CSV content
  const csv = [
    headers.join(','),
    ...rows.map(row => row.map(escapeCSV).join(','))
  ].join('\n');

  // Download
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fdms-history-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  showToast(`Exported ${movements.length} movements to CSV`, 'success');
}

/**
 * Initialize history export button
 */
export function initHistoryExport() {
  const exportBtn = byId("btnExportHistoryCsv");
  if (exportBtn) {
    exportBtn.addEventListener("click", exportHistoryCSV);
  }
}

/* -----------------------------
   VKB Lookup
------------------------------ */

let vkbSearchQuery = '';
let vkbActiveCategory = 'all';

/**
 * Render empty state for a category
 */
function renderVkbEmpty(tbody, colspan, message) {
  tbody.innerHTML = "";
  const row = document.createElement("tr");
  row.innerHTML = `
    <td colspan="${colspan}" style="padding: 16px; text-align: center; color: #777;">
      ${escapeHtml(message)}
    </td>
  `;
  tbody.appendChild(row);
}

/**
 * Render "All Results" tab
 */
function renderVkbAll(results) {
  const tbody = byId("vkbBodyAll");
  if (!tbody) return;

  const allResults = [
    ...results.aircraftTypes.map(r => ({
      kind: 'Aircraft Type',
      code: r['ICAO Type Designator'] || '-',
      label: `${r['Manufacturer']} ${r['Model']}`,
      details: `WTC: ${r['ICAO WTC'] || '-'}, ${r['Common Name'] || ''}`.trim(),
      data: r
    })),
    ...results.callsigns.map(r => ({
      kind: 'Callsign',
      code: r['CALLSIGN'] || '-',
      label: r['COMMON NAME'] || '-',
      details: `${r['TRICODE'] || '-'} • ${r['COUNTRY'] || '-'}`,
      data: r
    })),
    ...results.locations.map(r => ({
      kind: 'Location',
      code: r['ICAO CODE'] || '-',
      label: r['AIRPORT'] || '-',
      details: `${r['LOCATION SERVED'] || '-'} • ${r['COUNTRY'] || '-'}`,
      data: r
    })),
    ...results.registrations.map(r => ({
      kind: 'Registration',
      code: r['REGISTRATION'] || '-',
      label: r['OPERATOR'] || '-',
      details: `${r['TYPE'] || '-'} • ${r['EGOW FLIGHT TYPE'] || '-'}`,
      data: r
    }))
  ];

  if (allResults.length === 0) {
    renderVkbEmpty(tbody, 5, vkbSearchQuery ? `No results found for "${vkbSearchQuery}"` : 'Enter a search term to query the VKB database');
    return;
  }

  tbody.innerHTML = "";
  allResults.forEach(result => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td style="padding: 8px; font-weight: 600; font-size: 11px; color: #666; text-transform: uppercase;">${escapeHtml(result.kind)}</td>
      <td style="padding: 8px; font-family: monospace; font-weight: 600;">${escapeHtml(result.code)}</td>
      <td style="padding: 8px;">${escapeHtml(result.label)}</td>
      <td style="padding: 8px; font-size: 12px; color: #666;">${escapeHtml(result.details)}</td>
      <td style="padding: 8px; text-align: right;">
        <button class="btn btn-sm btn-secondary js-vkb-use" data-kind="${escapeHtml(result.kind)}" data-code="${escapeHtml(result.code)}">Use</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

/**
 * Render "Aircraft Types" tab
 */
function renderVkbTypes(types) {
  const tbody = byId("vkbBodyTypes");
  if (!tbody) return;

  if (types.length === 0) {
    renderVkbEmpty(tbody, 6, vkbSearchQuery ? 'No aircraft types found' : 'Enter a search term');
    return;
  }

  tbody.innerHTML = "";
  types.forEach(t => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td style="padding: 8px; font-family: monospace; font-weight: 600;">${escapeHtml(t['ICAO Type Designator'] || '-')}</td>
      <td style="padding: 8px;">${escapeHtml(t['Manufacturer'] || '-')}</td>
      <td style="padding: 8px;">${escapeHtml(t['Model'] || '-')}</td>
      <td style="padding: 8px; text-align: center;">${escapeHtml(t['ICAO WTC'] || '-')}</td>
      <td style="padding: 8px; font-size: 12px; color: #666;">${escapeHtml(t['Common Name'] || '')}</td>
      <td style="padding: 8px; text-align: right;">
        <button class="btn btn-sm btn-secondary js-vkb-use" data-kind="type" data-code="${escapeHtml(t['ICAO Type Designator'] || '')}">Use</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

/**
 * Render "Callsigns" tab
 */
function renderVkbCallsigns(callsigns) {
  const tbody = byId("vkbBodyCallsigns");
  if (!tbody) return;

  if (callsigns.length === 0) {
    renderVkbEmpty(tbody, 5, vkbSearchQuery ? 'No callsigns found' : 'Enter a search term');
    return;
  }

  tbody.innerHTML = "";
  callsigns.forEach(c => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td style="padding: 8px; font-family: monospace; font-weight: 600;">${escapeHtml(c['CALLSIGN'] || '-')}</td>
      <td style="padding: 8px;">${escapeHtml(c['TRICODE'] || '-')}</td>
      <td style="padding: 8px;">${escapeHtml(c['COMMON NAME'] || '-')}</td>
      <td style="padding: 8px; font-size: 12px; color: #666;">${escapeHtml(c['COUNTRY'] || '-')}</td>
      <td style="padding: 8px; text-align: right;">
        <button class="btn btn-sm btn-secondary js-vkb-use" data-kind="callsign" data-code="${escapeHtml(c['CALLSIGN'] || '')}">Use</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

/**
 * Render "Locations" tab
 */
function renderVkbLocations(locations) {
  const tbody = byId("vkbBodyLocations");
  if (!tbody) return;

  if (locations.length === 0) {
    renderVkbEmpty(tbody, 6, vkbSearchQuery ? 'No locations found' : 'Enter a search term');
    return;
  }

  tbody.innerHTML = "";
  locations.forEach(l => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td style="padding: 8px; font-family: monospace; font-weight: 600;">${escapeHtml(l['ICAO CODE'] || '-')}</td>
      <td style="padding: 8px;">${escapeHtml(l['IATA CODE'] || '-')}</td>
      <td style="padding: 8px;">${escapeHtml(l['AIRPORT'] || '-')}</td>
      <td style="padding: 8px; font-size: 12px; color: #666;">${escapeHtml(l['LOCATION SERVED'] || '-')}</td>
      <td style="padding: 8px; font-size: 12px; color: #666;">${escapeHtml(l['COUNTRY'] || '-')}</td>
      <td style="padding: 8px; text-align: right;">
        <button class="btn btn-sm btn-secondary js-vkb-use" data-kind="location" data-code="${escapeHtml(l['ICAO CODE'] || '')}">Use</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

/**
 * Render "Registrations" tab
 */
function renderVkbRegistrations(regs) {
  const tbody = byId("vkbBodyRegistrations");
  if (!tbody) return;

  if (regs.length === 0) {
    renderVkbEmpty(tbody, 5, vkbSearchQuery ? 'No registrations found' : 'Enter a search term');
    return;
  }

  tbody.innerHTML = "";
  regs.forEach(r => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td style="padding: 8px; font-family: monospace; font-weight: 600;">${escapeHtml(r['REGISTRATION'] || '-')}</td>
      <td style="padding: 8px;">${escapeHtml(r['OPERATOR'] || '-')}</td>
      <td style="padding: 8px;">${escapeHtml(r['TYPE'] || '-')}</td>
      <td style="padding: 8px; font-size: 12px; color: #666;">${escapeHtml(r['EGOW FLIGHT TYPE'] || '-')}</td>
      <td style="padding: 8px; text-align: right;">
        <button class="btn btn-sm btn-secondary js-vkb-use" data-kind="registration" data-code="${escapeHtml(r['REGISTRATION'] || '')}">Use</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

/**
 * Render VKB lookup results for current category
 */
function renderVkbLookup() {
  const status = getVKBStatus();
  if (!status.loaded) {
    // Show error in all tables
    ['vkbBodyAll', 'vkbBodyTypes', 'vkbBodyCallsigns', 'vkbBodyLocations', 'vkbBodyRegistrations'].forEach(id => {
      const tbody = byId(id);
      if (tbody) {
        renderVkbEmpty(tbody, 5, status.error ? `Error: ${status.error}` : 'VKB data not loaded');
      }
    });
    return;
  }

  // Perform search
  const results = searchAll(vkbSearchQuery, 50);

  // Render all categories
  renderVkbAll(results);
  renderVkbTypes(results.aircraftTypes);
  renderVkbCallsigns(results.callsigns);
  renderVkbLocations(results.locations);
  renderVkbRegistrations(results.registrations);

  // Bind all "Use" buttons
  document.querySelectorAll('.js-vkb-use').forEach(btn => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.kind;
      const code = btn.dataset.code;
      showToast(`"${code}" ready to use (auto-fill coming soon)`, 'info', 3000);
    });
  });
}

/**
 * Switch VKB category tab
 */
function switchVkbCategory(category) {
  vkbActiveCategory = category;

  // Update tab buttons
  document.querySelectorAll('.vkb-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.category === category);
  });

  // Show/hide category content
  document.querySelectorAll('.vkb-category-content').forEach(content => {
    const contentId = content.id.replace('vkb-', '');
    content.classList.toggle('hidden', contentId !== category);
  });
}

/**
 * Initialize VKB lookup tab
 */
export function initVkbLookup() {
  const searchInput = byId("vkbSearch");
  if (!searchInput) return;

  // Debounced search
  const debouncedSearch = debounce((query) => {
    vkbSearchQuery = query;
    renderVkbLookup();
  }, 300);

  searchInput.addEventListener('input', (e) => {
    debouncedSearch(e.target.value);
  });

  // Bind category tabs
  document.querySelectorAll('.vkb-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchVkbCategory(tab.dataset.category);
    });
  });

  // Initial render
  renderVkbLookup();
}

/* -----------------------------
   Autocomplete
------------------------------ */

/**
 * Create autocomplete for an input field
 * @param {HTMLElement} input - Input element
 * @param {string} fieldType - 'type', 'callsign', 'location', 'registration'
 */
function createAutocomplete(input, fieldType) {
  if (!input) return;

  // Wrap input in container if not already wrapped
  let container = input.parentElement;
  if (!container.classList.contains('autocomplete-container')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'autocomplete-container';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);
    container = wrapper;
  }

  // Create suggestions dropdown
  let suggestionsDiv = container.querySelector('.autocomplete-suggestions');
  if (!suggestionsDiv) {
    suggestionsDiv = document.createElement('div');
    suggestionsDiv.className = 'autocomplete-suggestions';
    container.appendChild(suggestionsDiv);
  }

  let selectedIndex = -1;
  let currentSuggestions = [];

  // Update suggestions
  const updateSuggestions = (query) => {
    if (!query || query.length < 2) {
      suggestionsDiv.classList.remove('active');
      currentSuggestions = [];
      return;
    }

    const suggestions = getAutocompleteSuggestions(fieldType, query, 10);
    currentSuggestions = suggestions;

    if (suggestions.length === 0) {
      suggestionsDiv.innerHTML = '<div class="autocomplete-empty">No matches found</div>';
      suggestionsDiv.classList.add('active');
      return;
    }

    suggestionsDiv.innerHTML = suggestions
      .map((s, idx) => {
        const primary = typeof s === 'object' ? s.primary : s;
        const secondary = typeof s === 'object' ? s.secondary : '';
        return `
          <div class="autocomplete-item" data-index="${idx}" data-value="${escapeHtml(primary)}">
            <span class="autocomplete-item-primary">${escapeHtml(primary)}</span>
            ${secondary ? `<span class="autocomplete-item-secondary">${escapeHtml(secondary)}</span>` : ''}
          </div>
        `;
      })
      .join('');

    suggestionsDiv.classList.add('active');
    selectedIndex = -1;
  };

  // Debounced update
  const debouncedUpdate = debounce(updateSuggestions, 200);

  // Input event
  input.addEventListener('input', (e) => {
    debouncedUpdate(e.target.value);
  });

  // Keyboard navigation
  input.addEventListener('keydown', (e) => {
    const items = suggestionsDiv.querySelectorAll('.autocomplete-item');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length > 0) {
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        updateSelection(items);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length > 0) {
        selectedIndex = Math.max(selectedIndex - 1, -1);
        updateSelection(items);
      }
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      if (currentSuggestions[selectedIndex]) {
        const suggestion = currentSuggestions[selectedIndex];
        const value = typeof suggestion === 'object' ? suggestion.primary : suggestion;
        input.value = value;
        suggestionsDiv.classList.remove('active');
        selectedIndex = -1;

        // Auto-focus Flight Number field if this is a Callsign Code field
        focusFlightNumberIfCallsignCode(input);
      }
    } else if (e.key === 'Escape') {
      suggestionsDiv.classList.remove('active');
      selectedIndex = -1;
    }
  });

  // Update visual selection
  function updateSelection(items) {
    items.forEach((item, idx) => {
      item.classList.toggle('selected', idx === selectedIndex);
    });
    if (selectedIndex >= 0 && items[selectedIndex]) {
      items[selectedIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  // Helper: Focus Flight Number field if input is Callsign Code
  function focusFlightNumberIfCallsignCode(inputEl) {
    const inputId = inputEl.id || '';
    if (inputId.includes('CallsignCode') || inputId.includes('Callsign')) {
      // Find corresponding Flight Number field
      const flightNumberId = inputId.replace('CallsignCode', 'FlightNumber').replace('Callsign', 'FlightNumber');
      const flightNumberField = document.getElementById(flightNumberId);
      if (flightNumberField) {
        setTimeout(() => flightNumberField.focus(), 50);
      }
    }
  }

  // Click on suggestion
  suggestionsDiv.addEventListener('click', (e) => {
    const item = e.target.closest('.autocomplete-item');
    if (item) {
      const value = item.dataset.value;
      input.value = value;
      suggestionsDiv.classList.remove('active');
      selectedIndex = -1;

      // Auto-focus Flight Number field if this is a Callsign Code field
      focusFlightNumberIfCallsignCode(input);
    }
  });

  // Close on focus loss (with delay to allow click)
  input.addEventListener('blur', () => {
    setTimeout(() => {
      suggestionsDiv.classList.remove('active');
      selectedIndex = -1;
    }, 200);
  });

  // Focus opens suggestions if there's text
  input.addEventListener('focus', () => {
    if (input.value.length >= 2) {
      updateSuggestions(input.value);
    }
  });
}

/**
 * Add autocomplete to modal input fields
 * Call this after a modal is created
 */
export function initModalAutocomplete(modal) {
  if (!modal) return;

  // Find autocomplete fields (updated for split callsign fields)
  const callsignInputs = modal.querySelectorAll('#newCallsignCode, #newLocCallsignCode, #editCallsignCode, #dupCallsignCode, #newCallsign, #editCallsign, #dupCallsign');
  const typeInputs = modal.querySelectorAll('#newType, #newLocType, #editType, #dupType');
  const regInputs = modal.querySelectorAll('#newReg, #newLocReg, #editReg, #dupReg');
  const depAdInputs = modal.querySelectorAll('#newDepAd, #editDepAd, #dupDepAd');
  const arrAdInputs = modal.querySelectorAll('#newArrAd, #editArrAd, #dupArrAd');

  // Create autocomplete for each field type
  callsignInputs.forEach(input => createAutocomplete(input, 'callsign'));
  typeInputs.forEach(input => createAutocomplete(input, 'type'));
  regInputs.forEach(input => createAutocomplete(input, 'registration'));
  depAdInputs.forEach(input => createAutocomplete(input, 'location'));
  arrAdInputs.forEach(input => createAutocomplete(input, 'location'));
}

export function initAdminPanel() {
  // No-op stub: implement if needed in this file.
}

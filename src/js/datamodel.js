// datamodel.js
// Storage-backed demo data + helpers for statuses and basic querying.
// Movements persist in localStorage between page reloads.

const STORAGE_KEY = "vectair_fdms_movements_v3";
const STORAGE_KEY_V2 = "vectair_fdms_movements_v2";
const STORAGE_KEY_V1 = "vectair_fdms_movements_v1";
const SCHEMA_VERSION = 3;
const CONFIG_KEY = "vectair_fdms_config";

// Default configuration
const defaultConfig = {
  defaultTimeOffsetMinutes: 10, // Legacy - kept for backwards compatibility
  depOffsetMinutes: 10,   // DEP: ETD = now + this
  arrOffsetMinutes: 90,   // ARR: ETA = now + this
  locOffsetMinutes: 10,   // LOC: ETD = now + this
  locFlightDurationMinutes: 40, // LOC: ETA = ETD + this (default flight duration)
  depFlightDurationMinutes: 60, // DEP: Default flight duration for timeline display
  arrFlightDurationMinutes: 60, // ARR: Default flight duration for timeline display
  ovrFlightDurationMinutes: 5,  // OVR: ELFT = EOFT + this (time on frequency, default 5 min)
  ovrOffsetMinutes: 0,          // OVR: EOFT = now + this (when creating new OVR)
  ovrAutoActivateMinutes: 30,   // Legacy - kept for backwards compatibility
  timezoneOffsetHours: 0, // Legacy/manual timezone offset field retained for compatibility
  showLocalTime: false,   // Show local time conversions alongside UTC
  hideLocalTimeInBannerIfSame: false, // Hide local time in banner when same as UTC
  alwaysHideLocalTimeInBanner: false, // Never show local time in banner
  enableAlertTooltips: true, // Show alert tooltips on hover over highlighted strips
  wtcSystem: "ICAO",        // Wake turbulence system: "ICAO", "UK", or "RECAT"
  wtcAlertThreshold: "off", // ICAO: "off","M","H" | UK: "off","S","LM","UM","H","J" | RECAT: "off","E","D","C","B","A"
  autoActivateEnabled: true, // Legacy - kept for backwards compatibility
  autoActivateMinutesBeforeEta: 30, // Legacy - kept for backwards compatibility
  // Auto-activation settings per flight type
  autoActivateDepEnabled: false,  // DEP: Auto-activate before ETD (off by default - usually manual)
  autoActivateDepMinutes: 30,     // DEP: Minutes before ETD to auto-activate
  autoActivateArrEnabled: true,   // ARR: Auto-activate before ETA (on by default)
  autoActivateArrMinutes: 30,     // ARR: Minutes before ETA to auto-activate
  autoActivateLocEnabled: false,  // LOC: Auto-activate before ETD (off by default - usually manual)
  autoActivateLocMinutes: 30,     // LOC: Minutes before ETD to auto-activate
  autoActivateOvrEnabled: true,   // OVR: Auto-activate before EOFT (on by default)
  autoActivateOvrMinutes: 30,     // OVR: Minutes before EOFT to auto-activate
  // History tab alert visibility settings
  historyShowTimeAlerts: false,      // Show time-based alerts (stale, overdue) in History - off by default
  historyShowEmergencyAlerts: true,  // Show emergency alerts (7500/7600/7700) in History
  historyShowCallsignAlerts: false,  // Show callsign confusion alerts in History - off by default
  historyShowWtcAlerts: false,       // Show WTC threshold alerts in History - off by default
  // Timeline settings
  timelineEnabled: true,             // Show timeline on Live Board
  timelineStartHour: 6,              // Timeline start hour (UTC)
  timelineEndHour: 22,               // Timeline end hour (UTC)
  // ARR/DEP Timeline display policy (Ticket 3a)
  timelineArrDepShared: true,           // true = share one display policy for both ARR and DEP
  timelineSharedMode: "token",          // Shared display mode: "token" | "full"
  timelineSharedTokenMinutes: 10,       // Shared token window duration (minutes)
  timelineDepMode: "token",             // DEP display mode when separate: "token" | "full"
  timelineDepTokenMinutes: 10,          // DEP token window minutes when not shared
  timelineArrMode: "token",             // ARR display mode when separate: "token" | "full"
  timelineArrTokenMinutes: 10,          // ARR token window minutes when not shared
  // Timeline ruler display settings
  timelineShowLocalRuler: true,         // Show secondary local ruler below UTC ruler
  timelineHideLocalRulerIfSame: true,   // Hide local ruler when operationally identical to UTC
  timelineSwapUtcLocalRulers: false,    // When true: local ruler on top, UTC on bottom
  // Reciprocal strip creation settings
  depToArrOffsetMinutes: 180,        // DEP→ARR: Arrival time = ETD/ATD + this (default 3 hours)
  arrToDepOffsetMinutes: 30,         // ARR→DEP: Departure time = ETA/ATA + this (default 30 min)
  inlineEditIdleMs: 120000,          // Inline-edit idle timeout before auto-cancel (ms); min enforced 5000
  timeInputMode: "UTC",              // Time input display mode in modals: "UTC" or "LOCAL"
  newFormUtcLocalTogglePolicy: "auto", // UTC/Local toggle visibility in new-strip forms: "auto" | "show" | "hide"
  showTimeLabelsOnStrip: true,       // Show ETD/ATD/ETA/ATA labels on Live Board time cells (label on own line above time)
  showEstimatedTimesOnStrip: true,   // Legacy global flag — kept for backward-compat migration; prefer per-type flags below
  showDepEstimatedTimesOnStrip: true, // DEP: show ETA/ATA on strip when no actual yet
  showArrEstimatedTimesOnStrip: true, // ARR: show ETD/ETA on strip when no actual yet
  showLocEstimatedTimesOnStrip: true, // LOC: show ETA/ATA on strip when no actual yet
  showOvrEstimatedTimesOnStrip: true  // OVR: show ELFT on strip when no actual yet
};

// Configuration state
let config = { ...defaultConfig };

// The original hard-coded demo data
const demoMovementsSeed = [
  {
    id: 1,
    status: "ACTIVE",
    callsignCode: "SYS22",
    callsignLabel: "SHAWBURY 22",
    callsignVoice: "Shawbury two-two",
    registration: "ZM300",
    type: "JUNO",
    wtc: "M (ICAO)",
    depAd: "EGOS",
    depName: "RAF Shawbury",
    arrAd: "EGOW",
    arrName: "RAF Woodvale",
    depPlanned: "11:35",
    depActual: "11:39",
    arrPlanned: "12:10",
    arrActual: "",
    dof: new Date().toISOString().split('T')[0], // Today's date in YYYY-MM-DD
    rules: "VFR",
    flightType: "ARR",
    isLocal: false,
    tngCount: 0,
    osCount: 0,
    fisCount: 0,
    egowCode: "VM",
    egowDesc: "Visiting Military Fixed-Wing",
    unitCode: "M",
    unitDesc: "MASUAS",
    captain: "Flt Lt Example",
    pob: 3,
    remarks: "Inbound Shawbury detail from Valley",
    formation: null
  },
  {
    id: 2,
    status: "PLANNED",
    callsignCode: "UAM11",
    callsignLabel: "WOODVALE 11",
    callsignVoice: "Woodvale one-one",
    registration: "G-VAIR",
    type: "G115",
    wtc: "L (ICAO)",
    depAd: "EGOW",
    depName: "RAF Woodvale",
    arrAd: "EGOW",
    arrName: "RAF Woodvale",
    depPlanned: "12:30",
    depActual: "",
    arrPlanned: "13:30",
    arrActual: "",
    dof: new Date().toISOString().split('T')[0],
    rules: "VFR",
    flightType: "LOC",
    isLocal: true,
    tngCount: 6,
    osCount: 0,
    fisCount: 0,
    egowCode: "BC",
    egowDesc: "Based Civil Fixed-Wing",
    unitCode: "L",
    unitDesc: "LUAS",
    captain: "Flt Lt Student",
    pob: 2,
    remarks: "UAS basic circuits RWY 21",
    formation: null
  },
  {
    id: 3,
    status: "ACTIVE",
    callsignCode: "CNNCT",
    callsignLabel: "CONNECT FLIGHT",
    callsignVoice: "Connect",
    registration: "",
    type: "Mixed (EH10 / LYNX)",
    wtc: "M (current)",
    depAd: "EGOW",
    depName: "RAF Woodvale",
    arrAd: "EGOS",
    arrName: "RAF Shawbury",
    depPlanned: "13:10",
    depActual: "13:15",
    arrPlanned: "13:50",
    arrActual: "",
    dof: new Date().toISOString().split('T')[0],
    rules: "VFR",
    flightType: "DEP",
    isLocal: false,
    tngCount: 0,
    osCount: 1,
    fisCount: 0,
    egowCode: "VMH",
    egowDesc: "Visiting Military Helicopter",
    unitCode: "ARMY",
    unitDesc: "Army detachment",
    captain: "Det Comd Example",
    pob: 7,
    remarks: "Formation departure to Shawbury, one a/c to remain O/S",
    formation: {
      baseCallsign: "CNNCT",
      shared: {
        depAd:      "EGOW",
        arrAd:      "EGOS",
        flightType: "DEP",
        tngCount:   0,
        osCount:    0,
        fisCount:   0
      },
      label: "CNNCT flight of 3",
      wtcCurrent: "M",
      wtcMax: "M",
      elements: [
        {
          ordinal:   1,
          callsign:  "CNNCT 1",
          reg:       "ZZ400",
          type:      "EH10",
          wtc:       "M",
          status:    "ACTIVE",
          depAd:     "EGOW",
          arrAd:     "EGOS",
          depActual: "13:15",
          arrActual: "",
          overrides: {}
        },
        {
          ordinal:   2,
          callsign:  "CNNCT 2",
          reg:       "ZZ401",
          type:      "LYNX",
          wtc:       "L",
          status:    "ACTIVE",
          depAd:     "EGOW",
          arrAd:     "EGOS",
          depActual: "13:15",
          arrActual: "",
          overrides: {}
        },
        {
          ordinal:   3,
          callsign:  "CNNCT 3",
          reg:       "ZZ402",
          type:      "LYNX",
          wtc:       "L",
          status:    "PLANNED",
          depAd:     "EGOW",
          arrAd:     "EGOS",
          depActual: "",
          arrActual: "",
          overrides: {}
        }
      ]
    }
  },
  {
    id: 4,
    status: "COMPLETED",
    callsignCode: "BA133",
    callsignLabel: "SPEEDBIRD 133",
    callsignVoice: "Speedbird one-three-three",
    registration: "G-ABCD",
    type: "A320",
    wtc: "M (ICAO)",
    depAd: "EGLL",
    depName: "London Heathrow",
    arrAd: "FAOR",
    arrName: "Johannesburg",
    depPlanned: "09:20",
    depActual: "09:26",
    arrPlanned: "19:40",
    arrActual: "",
    dof: new Date().toISOString().split('T')[0],
    rules: "IFR",
    flightType: "OVR",
    isLocal: false,
    tngCount: 0,
    osCount: 0,
    fisCount: 1,
    egowCode: "VC",
    egowDesc: "Visiting Civil Fixed-Wing",
    unitCode: "",
    unitDesc: "",
    captain: "Capt Example",
    pob: 168,
    remarks: "En-route FIS provided FL300-320 (5 min)",
    formation: null
  },
  {
    id: 5,
    status: "ACTIVE",
    callsignCode: "MEMORIAL",
    callsignLabel: "MEMORIAL FLIGHT",
    callsignVoice: "Memorial",
    registration: "",
    type: "Mixed (SPIT / HURI / LANC)",
    wtc: "M (current, max M)",
    depAd: "EGOW",
    depName: "RAF Woodvale",
    arrAd: "EGOW",
    arrName: "RAF Woodvale",
    depPlanned: "15:00",
    depActual: "15:05",
    arrPlanned: "15:40",
    arrActual: "",
    dof: new Date().toISOString().split('T')[0],
    rules: "VFR",
    flightType: "LOC",
    isLocal: true,
    tngCount: 0,
    osCount: 0,
    fisCount: 0,
    egowCode: "VM",
    egowDesc: "Visiting Military Fixed-Wing",
    unitCode: "BBMF",
    unitDesc: "Battle of Britain Memorial Flight",
    captain: "",
    pob: 6,
    remarks: "Three-ship display detail",
    formation: {
      baseCallsign: "MEMORIAL",
      shared: {
        depAd:      "EGOW",
        arrAd:      "EGOW",
        flightType: "LOC",
        tngCount:   0,
        osCount:    0,
        fisCount:   0
      },
      label: "MEMORIAL flight of 3",
      wtcCurrent: "M",
      wtcMax: "M",
      elements: [
        {
          ordinal:   1,
          callsign:  "MEMORIAL 1",
          reg:       "AB910",
          type:      "SPIT",
          wtc:       "L",
          status:    "ACTIVE",
          depAd:     "EGOW",
          arrAd:     "EGOW",
          depActual: "15:05",
          arrActual: "",
          overrides: {}
        },
        {
          ordinal:   2,
          callsign:  "MEMORIAL 2",
          reg:       "LF363",
          type:      "HURI",
          wtc:       "L",
          status:    "ACTIVE",
          depAd:     "EGOW",
          arrAd:     "EGOW",
          depActual: "15:05",
          arrActual: "",
          overrides: {}
        },
        {
          ordinal:   3,
          callsign:  "MEMORIAL 3",
          reg:       "PA474",
          type:      "LANC",
          wtc:       "M",
          status:    "ACTIVE",
          depAd:     "EGOW",
          arrAd:     "EGOW",
          depActual: "15:05",
          arrActual: "",
          overrides: {}
        }
      ]
    }
  }
];

// Working state (initialised lazily)
let movements = [];
let nextId = 1;
let movementsInitialised = false;

function cloneDemoMovements() {
  // Shallow clone each object so we don't mutate the seed
  return demoMovementsSeed.map((m) => ({ ...m }));
}

/**
 * Migrate from v1 schema (array) to current schema
 * @returns {Array|null} Migrated movements array or null
 */
function migrateFromV1() {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_V1);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    console.log("FDMS: Migrating data from v1 to v3 schema");
    // Add missing fields to v1 data
    const migrated = parsed.map(m => ({
      ...m,
      dof: m.dof || new Date().toISOString().split('T')[0],
      rules: m.rules || "VFR"
    }));
    // Remove old key after successful migration
    window.localStorage.removeItem(STORAGE_KEY_V1);
    return migrated;
  } catch (e) {
    console.warn("FDMS: failed to migrate from v1", e);
    return null;
  }
}

/**
 * Migrate from v2 schema to v3 schema
 * Adds DOF and rules fields if missing
 * @returns {Array|null} Migrated movements array or null
 */
function migrateFromV2() {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_V2);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || parsed.version !== 2) return null;
    if (!Array.isArray(parsed.movements)) return null;

    console.log("FDMS: Migrating data from v2 to v3 schema");
    // Add DOF and rules fields to v2 data
    const migrated = parsed.movements.map(m => ({
      ...m,
      dof: m.dof || new Date().toISOString().split('T')[0],
      rules: m.rules || "VFR"
    }));
    // Remove old key after successful migration
    window.localStorage.removeItem(STORAGE_KEY_V2);
    return migrated;
  } catch (e) {
    console.warn("FDMS: failed to migrate from v2", e);
    return null;
  }
}

/**
 * Load movements from localStorage with schema migration support
 * Tries v3 -> v2 -> v1 in order
 * @returns {Array|null} Movements array or null
 */
function loadFromStorage() {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    // Try loading v3 schema first
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // v3 schema: { version, timestamp, movements }
      if (parsed && typeof parsed === "object" && parsed.version === SCHEMA_VERSION) {
        return Array.isArray(parsed.movements) ? parsed.movements : null;
      }
    }

    // Try v2 migration
    const v2Data = migrateFromV2();
    if (v2Data) return v2Data;

    // Fall back to v1 migration
    return migrateFromV1();
  } catch (e) {
    console.warn("FDMS: failed to load movements from storage", e);
    return null;
  }
}

function saveToStorage() {
  if (typeof window === "undefined" || !window.localStorage) return;
  // Guard: never persist an undefined/null movements array.  If somehow the
  // module-level array is corrupted, bail out rather than overwrite good data.
  if (!Array.isArray(movements)) {
    console.error("FDMS: saveToStorage aborted — movements is not an array", movements);
    return;
  }
  try {
    // v2 schema: wrap movements with version and timestamp
    const payload = JSON.stringify({
      version: SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      movements: movements
    });
    window.localStorage.setItem(STORAGE_KEY, payload);
  } catch (e) {
    console.warn("FDMS: failed to save movements to storage", e);
  }
}

function loadConfig() {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      config = { ...defaultConfig, ...parsed };
      // Sprint 10.1 migration: if per-type estimated-time flags are absent,
      // derive them from the legacy global flag so existing OFF configs stay OFF.
      if (parsed.showDepEstimatedTimesOnStrip === undefined) {
        const globalVal = parsed.showEstimatedTimesOnStrip !== false;
        config.showDepEstimatedTimesOnStrip = globalVal;
        config.showArrEstimatedTimesOnStrip = globalVal;
        config.showLocEstimatedTimesOnStrip = globalVal;
        config.showOvrEstimatedTimesOnStrip = globalVal;
      }
    } else {
      config = { ...defaultConfig };
    }
  } catch (e) {
    console.warn("FDMS: failed to load config from storage", e);
    config = { ...defaultConfig };
  }
}

function saveConfig() {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch (e) {
    console.warn("FDMS: failed to save config to storage", e);
  }
}

function computeNextId() {
  if (!movements.length) return 1;
  return (
    movements.reduce((max, m) => {
      const id = typeof m.id === "number" ? m.id : 0;
      return id > max ? id : max;
    }, 0) + 1
  );
}

function ensureInitialised() {
  if (movementsInitialised) return;

  // Load config first
  loadConfig();

  const loaded = loadFromStorage();
  if (loaded) {
    // Use stored data (may be empty array)
    movements = loaded;
    // Normalize any formation objects (backward compat + WTC recompute)
    // Also apply Sprint 9 migration defaults for new fields.
    let needsSave = false;
    movements.forEach(m => {
      if (m.formation) { m.formation = normalizeFormation(m.formation); needsSave = true; }
      // Sprint 9: ZZZZ companion text fields
      if (m.depAdText === undefined)       { m.depAdText       = ''; needsSave = true; }
      if (m.arrAdText === undefined)       { m.arrAdText       = ''; needsSave = true; }
      if (m.aircraftTypeText === undefined){ m.aircraftTypeText = ''; needsSave = true; }
      // Sprint 9: lightweight outcome model
      if (m.outcomeStatus === undefined)         { m.outcomeStatus         = 'NORMAL'; needsSave = true; }
      if (m.outcomeReason === undefined)         { m.outcomeReason         = '';       needsSave = true; }
      if (m.actualDestinationAd === undefined)   { m.actualDestinationAd   = '';       needsSave = true; }
      if (m.actualDestinationText === undefined) { m.actualDestinationText = '';       needsSave = true; }
      if (m.outcomeTime === undefined)           { m.outcomeTime           = '';       needsSave = true; }
      // Sprint 9: PIC field — uses existing captain; no migration needed but ensure defined
      if (m.captain === undefined) { m.captain = ''; needsSave = true; }
      // Ticket 4: exact WTC timestamp companion — HH:MM:SS set by Active button alongside
      // the rounded operational depActual. Absent for old records; treated as "no exact time".
      if (m.depActualExact === undefined) { m.depActualExact = ''; needsSave = true; }
      // Sprint 10.1: recalculate derived ETA for ACTIVE DEP/LOC/OVR strips where ATD exists
      // but arrPlanned may be stale (ETD-based). Apply canonical timing model forward from ATD.
      if (m.status === 'ACTIVE') {
        const mft = (m.flightType || '').toUpperCase();
        const hasAtd = !!(m.depActual && String(m.depActual).trim());
        if (hasAtd && (mft === 'DEP' || mft === 'LOC' || mft === 'OVR') && !m.arrActual) {
          const patch = recalculateTimingModel(m, 'depActual');
          const isWeak = patch._weakPrediction;
          delete patch._weakPrediction;
          if (Object.keys(patch).length > 0 && !isWeak) {
            Object.assign(m, patch);
            needsSave = true;
          }
        }
      }
    });
    if (needsSave) saveToStorage();
  } else {
    // No stored data - start fresh with empty movements
    movements = [];
    saveToStorage();
  }

  nextId = computeNextId();
  movementsInitialised = true;
}

export function getMovements() {
  ensureInitialised();
  return movements;
}

/* -----------------------------
   Registration → Type Inference
------------------------------ */

// Lightweight lookup table: registration prefix → aircraft type
// In Phase E, this will be replaced with full VKB integration
const registrationTypeLookup = {
  // UK Civil (G- prefix)
  "G-VAIR": "G115",
  "G-BYUL": "A109",
  // UK Military (ZM, ZJ, ZK, etc.)
  "ZM300": "JUNO",
  "ZJ": "MERLIN",
  "ZK": "SEA KING",
  // Prefix-based inference
  "G-B": "Various UK Civil",
  "G-C": "Various UK Civil"
};

/**
 * Infer aircraft type from registration.
 * Returns type if known, null otherwise.
 * Always allow manual override.
 */
export function inferTypeFromReg(registration) {
  if (!registration) return null;
  const reg = registration.toUpperCase().trim();

  // Try exact match first
  if (registrationTypeLookup[reg]) {
    return registrationTypeLookup[reg];
  }

  // Try prefix match (first 3-4 chars)
  for (let len = 4; len >= 2; len--) {
    const prefix = reg.substring(0, len);
    if (registrationTypeLookup[prefix]) {
      return registrationTypeLookup[prefix];
    }
  }

  return null;
}

/* -----------------------------
   Time Offset Helpers
------------------------------ */

/**
 * Get current time plus offset in HH:MM format
 * @param {number} offsetMinutes - Minutes to add to current time
 * @returns {string} Time in HH:MM format
 */
function getTimeWithOffset(offsetMinutes) {
  const now = new Date();
  const base = now.getUTCHours() * 60 + now.getUTCMinutes() + offsetMinutes;
  const totalMinutes = ((base % 1440) + 1440) % 1440;
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const minutes = String(totalMinutes % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Add minutes to a time string (HH:MM)
 * @param {string} timeStr - Time string in HH:MM format
 * @param {number} minutesToAdd - Minutes to add
 * @returns {string} New time string in HH:MM format
 */
function addMinutesToTime(timeStr, minutesToAdd) {
  if (!timeStr) return getTimeWithOffset(minutesToAdd);

  const [hoursStr, minutesStr] = timeStr.split(':');
  const hours = parseInt(hoursStr, 10);
  const minutes = parseInt(minutesStr, 10);

  if (isNaN(hours) || isNaN(minutes)) {
    return getTimeWithOffset(minutesToAdd);
  }

  const base = hours * 60 + minutes + minutesToAdd;
  const totalMinutes = ((base % 1440) + 1440) % 1440;
  const newHours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const newMinutes = String(totalMinutes % 60).padStart(2, '0');
  return `${newHours}:${newMinutes}`;
}

/**
 * Apply default times to a movement based on flight type
 * @param {object} movement - Movement object (may have blank time fields)
 * @returns {object} Movement with default times applied
 */
function applyDefaultTimes(movement) {
  const ft = (movement.flightType || "").toUpperCase();

  // DEP: default ETD to now + depOffsetMinutes
  if (ft === "DEP" && !movement.depPlanned) {
    movement.depPlanned = getTimeWithOffset(config.depOffsetMinutes);
  }

  // ARR: default ETA to now + arrOffsetMinutes
  if (ft === "ARR" && !movement.arrPlanned) {
    movement.arrPlanned = getTimeWithOffset(config.arrOffsetMinutes);
  }

  // LOC: default ETD to now + locOffsetMinutes, ETA to ETD + locFlightDurationMinutes
  if (ft === "LOC") {
    if (!movement.depPlanned) {
      movement.depPlanned = getTimeWithOffset(config.locOffsetMinutes);
    }
    if (!movement.arrPlanned) {
      // ETA = ETD + flight duration
      const etd = movement.depPlanned || getTimeWithOffset(config.locOffsetMinutes);
      movement.arrPlanned = addMinutesToTime(etd, config.locFlightDurationMinutes);
    }
  }

  // OVR: default ECT to now + ovrOffsetMinutes
  if (ft === "OVR" && !movement.depPlanned) {
    movement.depPlanned = getTimeWithOffset(config.ovrOffsetMinutes);
  }

  return movement;
}

/* -----------------------------
   Semantic Time Field Helpers
------------------------------ */

/**
 * Get Estimated Time of Departure (ETD)
 * For DEP/LOC: uses depPlanned
 * For ARR/OVR: not applicable (returns null)
 */
export function getETD(movement) {
  const ft = (movement.flightType || "").toUpperCase();
  if (ft === "DEP" || ft === "LOC") return movement.depPlanned || null;
  return null;
}

/**
 * Get Actual Time of Departure (ATD)
 * For DEP/LOC: uses depActual
 * For ARR/OVR: not applicable (returns null)
 */
export function getATD(movement) {
  const ft = (movement.flightType || "").toUpperCase();
  if (ft === "DEP" || ft === "LOC") return movement.depActual || null;
  return null;
}

/**
 * Get Estimated Time of Arrival (ETA)
 * For ARR/LOC: uses arrPlanned
 * For DEP/OVR: not applicable (returns null)
 */
export function getETA(movement) {
  const ft = (movement.flightType || "").toUpperCase();
  if (ft === "ARR" || ft === "LOC") return movement.arrPlanned || null;
  return null;
}

/**
 * Get Actual Time of Arrival (ATA)
 * For ARR/LOC: uses arrActual
 * For DEP/OVR: not applicable (returns null)
 */
export function getATA(movement) {
  const ft = (movement.flightType || "").toUpperCase();
  if (ft === "ARR" || ft === "LOC") return movement.arrActual || null;
  return null;
}

/**
 * Get Estimated Crossing Time (ECT)
 * For OVR: uses depPlanned as placeholder
 */
export function getECT(movement) {
  const ft = (movement.flightType || "").toUpperCase();
  if (ft === "OVR") return movement.depPlanned || null;
  return null;
}

/**
 * Get Actual Crossing Time (ACT)
 * For OVR: uses depActual as placeholder
 */
export function getACT(movement) {
  const ft = (movement.flightType || "").toUpperCase();
  if (ft === "OVR") return movement.depActual || null;
  return null;
}

/* -----------------------------------------------------------------------
   Canonical Timing Model — single authoritative timing layer
   Implements FDMS Timings Specifications.md

   Three distinct concepts:
     A. Governing root time  — used for recalculation logic
     B. Resolved start/end   — used for Timeline bar anchors
     C. Visible labels       — presentation only (ETD/ATD/ETA/ATA)

   Do NOT conflate these.  ARR planned: root=ETA, but bar start=ETD.
----------------------------------------------------------------------- */

/**
 * Private: convert HH:MM string to total minutes (midnight-anchored).
 * Returns NaN for invalid/empty input.
 */
function _tmToMins(t) {
  if (!t || typeof t !== 'string') return NaN;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * Private: convert total minutes to HH:MM string, wrapping within 24h.
 */
function _minsToTm(mins) {
  const totalMins = ((Math.round(mins) % 1440) + 1440) % 1440;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Return the effective duration in minutes and whether it is explicitly
 * user-entered vs. a fallback admin default.
 *
 * This distinction matters: for ARR in active state, ATD-driven ETA
 * recalculation is only trusted when duration is explicit.
 *
 * @param {object} movement
 * @returns {{ minutes: number, isExplicit: boolean }}
 */
export function getDurationSource(movement) {
  const ft = (movement.flightType || '').toUpperCase();
  if (Number.isFinite(movement.durationMinutes) && movement.durationMinutes > 0) {
    return { minutes: movement.durationMinutes, isExplicit: true };
  }
  const defaults = {
    DEP: config.depFlightDurationMinutes  || 60,
    ARR: config.arrFlightDurationMinutes  || 60,
    LOC: config.locFlightDurationMinutes  || 40,
    OVR: config.ovrFlightDurationMinutes  ||  5,
  };
  return { minutes: defaults[ft] || 60, isExplicit: false };
}

/**
 * Resolved start time — the LEFT anchor of the Timeline bar.
 *
 * This is always the departure/start side of the movement span.
 * It is NOT the calculation root for ARR in planned state (that is ETA).
 *
 *   DEP / LOC  planned: ETD (depPlanned)
 *   DEP / LOC  active:  ATD (depActual)
 *   ARR        active:  ATD (depActual)
 *   ARR        planned: ETD (depPlanned if stored; else computed as ETA − Duration)
 *   OVR        planned: EOFT (depPlanned)
 *   OVR        active:  ATOF (depActual)
 *
 * @param {object} movement
 * @returns {string|null} HH:MM or null
 */
export function resolvedStartTime(movement) {
  const ft = (movement.flightType || '').toUpperCase();

  if (ft === 'DEP' || ft === 'LOC' || ft === 'OVR') {
    return movement.depActual || movement.depPlanned || null;
  }

  if (ft === 'ARR') {
    // Active: ATD (depActual) is the bar start anchor
    if (movement.depActual) return movement.depActual;
    // Planned and ETD explicitly stored → use it
    if (movement.depPlanned) return movement.depPlanned;
    // No stored ETD: compute from ETA − Duration as fallback
    const etaMin = _tmToMins(movement.arrPlanned);
    if (Number.isFinite(etaMin)) {
      const { minutes } = getDurationSource(movement);
      if (minutes > 0) return _minsToTm(etaMin - minutes);
    }
    return null;
  }

  return null;
}

/**
 * Resolved end time — the RIGHT anchor of the Timeline bar.
 *
 *   DEP / LOC / ARR: ATA (arrActual) if present, else ETA (arrPlanned)
 *   OVR:             ALFT (arrActual) if present, else ELFT (arrPlanned)
 *
 * @param {object} movement
 * @returns {string|null} HH:MM or null
 */
export function resolvedEndTime(movement) {
  return movement.arrActual || movement.arrPlanned || null;
}

/**
 * Recalculate the dependent timing field after changedField was updated.
 *
 * Returns a patch object (may be empty {}) with fields to update.
 * Does NOT mutate the movement — caller must persist the patch.
 *
 * Governing rules by movement type and state:
 *
 *   DEP / LOC planned (no ATD):
 *     ETD or Duration changed → ETA = ETD + Duration
 *     ETA changed             → Duration = ETA − ETD
 *
 *   DEP / LOC active (ATD present):
 *     ATD or Duration changed → ETA = ATD + Duration
 *     ETA changed             → Duration = ETA − ATD
 *
 *   ARR planned (no ATD):
 *     ETA or Duration changed → ETD = ETA − Duration   ← root is ETA
 *     ETD changed             → Duration = ETA − ETD
 *
 *   ARR active (ATD present):
 *     ATD or Duration changed → ETA = ATD + Duration
 *                               (skipped if duration is not explicit AND
 *                                arrPlanned already exists — see safeguard)
 *     ETA changed             → Duration = ETA − ATD
 *
 *   OVR planned (no ATOF):
 *     EOFT or Duration changed → ELFT = EOFT + Duration
 *     ELFT changed             → Duration = ELFT − EOFT
 *
 *   OVR active (ATOF present):
 *     ATOF or Duration changed → ELFT = ATOF + Duration (only if ALFT not set)
 *     ELFT changed             → Duration = ELFT − ATOF
 *
 * Special patch marker: patch._weakPrediction = true when ARR active
 * recalculation was suppressed due to non-explicit duration + existing ETA.
 * Callers should inspect this before deciding whether to persist.
 *
 * @param {object} movement   — movement object AFTER the change was applied
 * @param {string} changedField — which field was just changed
 * @returns {object} patch to apply (never mutate movement directly)
 */
export function recalculateTimingModel(movement, changedField) {
  const ft  = (movement.flightType || '').toUpperCase();
  const dur = getDurationSource(movement);
  const patch = {};

  /* ── DEP / LOC ─────────────────────────────────────────────────────── */
  if (ft === 'DEP' || ft === 'LOC') {
    const hasAtd = !!(movement.depActual && movement.depActual.trim());

    if (hasAtd) {
      // Active: root = ATD (depActual)
      if (changedField === 'depActual' || changedField === 'durationMinutes') {
        const startMin = _tmToMins(movement.depActual);
        if (Number.isFinite(startMin) && dur.minutes > 0) {
          patch.arrPlanned = _minsToTm(startMin + dur.minutes);
        }
      } else if (changedField === 'arrPlanned') {
        const startMin = _tmToMins(movement.depActual);
        const endMin   = _tmToMins(movement.arrPlanned);
        if (Number.isFinite(startMin) && Number.isFinite(endMin)) {
          let diff = endMin - startMin;
          if (diff <= 0) diff += 1440;
          if (diff > 0 && diff <= 1440) patch.durationMinutes = diff;
        }
      }
    } else {
      // Planned: root = ETD (depPlanned)
      if (changedField === 'depPlanned' || changedField === 'durationMinutes') {
        const startMin = _tmToMins(movement.depPlanned);
        if (Number.isFinite(startMin) && dur.minutes > 0) {
          patch.arrPlanned = _minsToTm(startMin + dur.minutes);
        }
      } else if (changedField === 'arrPlanned') {
        const startMin = _tmToMins(movement.depPlanned);
        const endMin   = _tmToMins(movement.arrPlanned);
        if (Number.isFinite(startMin) && Number.isFinite(endMin)) {
          let diff = endMin - startMin;
          if (diff <= 0) diff += 1440;
          if (diff > 0 && diff <= 1440) patch.durationMinutes = diff;
        }
      }
    }
    return patch;
  }

  /* ── ARR ────────────────────────────────────────────────────────────── */
  if (ft === 'ARR') {
    const hasAtd = !!(movement.depActual && movement.depActual.trim());

    if (hasAtd) {
      // Active: root = ATD (depActual)
      if (changedField === 'depActual' || changedField === 'durationMinutes') {
        const startMin = _tmToMins(movement.depActual);
        if (Number.isFinite(startMin) && dur.minutes > 0) {
          // Safeguard: if duration is non-explicit AND an ETA already exists,
          // do not blindly overwrite the planned ETA with ATD+default.
          if (dur.isExplicit || !movement.arrPlanned) {
            patch.arrPlanned = _minsToTm(startMin + dur.minutes);
          } else {
            // Weak prediction — emit marker; caller decides whether to persist
            patch._weakPrediction = true;
          }
        }
      } else if (changedField === 'arrPlanned') {
        // User explicitly edited ETA → derive Duration
        const startMin = _tmToMins(movement.depActual);
        const endMin   = _tmToMins(movement.arrPlanned);
        if (Number.isFinite(startMin) && Number.isFinite(endMin)) {
          let diff = endMin - startMin;
          if (diff <= 0) diff += 1440;
          if (diff > 0 && diff <= 1440) patch.durationMinutes = diff;
        }
      }
    } else {
      // Planned: root = ETA (arrPlanned)
      if (changedField === 'arrPlanned' || changedField === 'durationMinutes') {
        const rootMin = _tmToMins(movement.arrPlanned);
        if (Number.isFinite(rootMin) && dur.minutes > 0) {
          patch.depPlanned = _minsToTm(rootMin - dur.minutes);
        }
      } else if (changedField === 'depPlanned') {
        // User manually edited ETD → derive Duration
        const rootMin  = _tmToMins(movement.arrPlanned);
        const startMin = _tmToMins(movement.depPlanned);
        if (Number.isFinite(rootMin) && Number.isFinite(startMin)) {
          let diff = rootMin - startMin;
          if (diff <= 0) diff += 1440;
          if (diff > 0 && diff <= 1440) patch.durationMinutes = diff;
        }
      }
    }
    return patch;
  }

  /* ── OVR ────────────────────────────────────────────────────────────── */
  if (ft === 'OVR') {
    const hasAtof = !!(movement.depActual && movement.depActual.trim());

    if (hasAtof) {
      // Active: root = ATOF (depActual)
      if (changedField === 'depActual' || changedField === 'durationMinutes') {
        // Only drive ELFT if ALFT is not yet set
        if (!movement.arrActual) {
          const startMin = _tmToMins(movement.depActual);
          if (Number.isFinite(startMin) && dur.minutes > 0) {
            patch.arrPlanned = _minsToTm(startMin + dur.minutes);
          }
        }
      } else if (changedField === 'arrPlanned') {
        const startMin = _tmToMins(movement.depActual);
        const endMin   = _tmToMins(movement.arrPlanned);
        if (Number.isFinite(startMin) && Number.isFinite(endMin)) {
          let diff = endMin - startMin;
          if (diff <= 0) diff += 1440;
          if (diff > 0 && diff <= 1440) patch.durationMinutes = diff;
        }
      }
    } else {
      // Planned: root = EOFT (depPlanned)
      if (changedField === 'depPlanned' || changedField === 'durationMinutes') {
        const startMin = _tmToMins(movement.depPlanned);
        if (Number.isFinite(startMin) && dur.minutes > 0) {
          patch.arrPlanned = _minsToTm(startMin + dur.minutes);
        }
      } else if (changedField === 'arrPlanned') {
        const startMin = _tmToMins(movement.depPlanned);
        const endMin   = _tmToMins(movement.arrPlanned);
        if (Number.isFinite(startMin) && Number.isFinite(endMin)) {
          let diff = endMin - startMin;
          if (diff <= 0) diff += 1440;
          if (diff > 0 && diff <= 1440) patch.durationMinutes = diff;
        }
      }
    }
    return patch;
  }

  return patch;
}

/* -----------------------------
   Formation WTC Helpers
------------------------------ */

// WTC ordering for ICAO L < S < M < H < J
// Used to determine max WTC across formation elements
const WTC_RANK = { L: 1, S: 2, M: 3, H: 4, J: 5 };

/**
 * Return the higher-ranked of two WTC strings.
 * Handles empty strings gracefully.
 */
function maxWtcString(a, b) {
  const ra = WTC_RANK[(a || "").toUpperCase()] || 0;
  const rb = WTC_RANK[(b || "").toUpperCase()] || 0;
  if (ra === 0 && rb === 0) return a || b || "";
  if (ra === 0) return b;
  if (rb === 0) return a;
  return ra >= rb ? a : b;
}

/**
 * Validation helpers for formation element fields (exported for UI use).
 */
export function isValidWtcChar(wtc) {
  return ["L", "S", "M", "H", "J"].includes((wtc || "").toUpperCase().trim());
}
export function isValidIcaoAd(ad) {
  const v = (ad || "").toUpperCase().trim();
  if (v === "") return true;                  // empty = unset, always valid
  return /^[A-Z0-9]{4}$/.test(v);
}
export function isValidElementStatus(status) {
  return ["PLANNED", "ACTIVE", "COMPLETED", "CANCELLED"].includes(status);
}

/* ------------------------------------------------------------------ *
 * Runway movement-equivalent helpers                                   *
 * ------------------------------------------------------------------ */

/**
 * Coerce a value to a non-negative integer (0 for null/NaN/negative).
 * @param {*} v
 * @returns {number}
 */
function asNonNegInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

/**
 * Runway movement-equivalent contribution of one movement.
 * NOMINAL (plan-based) counting — used by reporting.js for Monthly Return.
 * OVR returns 0 (overflights excluded from runway totals; counted separately).
 * DEP/ARR contribute 1 base + counter additions.
 * LOC contributes 2 base + counter additions.
 * Formula: base + (2 × tngCount) + (1 × osCount)
 *
 * NOTE: For Live Board daily totals use egowRunwayContribution() instead,
 * which only counts realized EGOW events.
 *
 * @param {object} m - Movement object
 * @returns {number}
 */
export function runwayMovementContribution(m) {
  const ft = String(m.flightType || "").toUpperCase();
  const tng = asNonNegInt(m.tngCount);
  const os  = asNonNegInt(m.osCount);

  const base =
    ft === "LOC" ? 2 :
    ft === "DEP" ? 1 :
    ft === "ARR" ? 1 :
    ft === "OVR" ? 0 :
    0;

  return base + (2 * tng) + os;
}

/**
 * Event-based runway contribution for Live Board daily totals.
 * Only counts EGOW events that have actually occurred.
 *
 * Rules:
 *   DEP  = 1 if depActual exists, else 0
 *   ARR  = 1 if arrActual exists, else 0
 *   LOC  = (depActual ? 1 : 0) + (2 × tngCount) + osCount + (arrActual ? 1 : 0)
 *   OVR  = 0 always
 *
 * T&G and O/S contribute regardless of actual times (they are discrete logged events).
 *
 * @param {object} m - Movement object
 * @returns {number}
 */
export function egowRunwayContribution(m) {
  const ft  = String(m.flightType || "").toUpperCase();
  const tng = asNonNegInt(m.tngCount);
  const os  = asNonNegInt(m.osCount);
  const hasDep = !!(m.depActual && String(m.depActual).trim());
  const hasArr = !!(m.arrActual && String(m.arrActual).trim());

  if (ft === "OVR") return 0;
  if (ft === "DEP") return hasDep ? 1 : 0;
  if (ft === "ARR") return hasArr ? 1 : 0;
  if (ft === "LOC") return (hasDep ? 1 : 0) + (2 * tng) + os + (hasArr ? 1 : 0);
  return 0;
}

/**
 * Returns true when movement is an overflight (OVR flight type).
 * OVR movements are counted separately and excluded from runway totals.
 *
 * @param {object} m - Movement object
 * @returns {boolean}
 */
export function isOverflight(m) {
  return String(m.flightType || "").toUpperCase() === "OVR";
}

/**
 * Compute wtcCurrent and wtcMax from a formation elements array.
 * wtcCurrent = max WTC among PLANNED or ACTIVE elements only.
 * wtcMax     = max WTC across all elements regardless of status.
 * @param {Array} elements - Formation element objects
 * @returns {{ wtcCurrent: string, wtcMax: string }}
 */
export function computeFormationWTC(elements) {
  if (!Array.isArray(elements) || elements.length === 0) {
    return { wtcCurrent: "", wtcMax: "" };
  }
  let current = "";
  let max = "";
  for (const el of elements) {
    const wtc = (el.wtc || "").toUpperCase().trim();
    if (!wtc) continue;
    max = maxWtcString(max, wtc);
    const st = (el.status || "").toUpperCase();
    if (st === "PLANNED" || st === "ACTIVE") {
      current = maxWtcString(current, wtc);
    }
  }
  return { wtcCurrent: current, wtcMax: max };
}

/**
 * Normalize a formation object loaded from storage.
 * Ensures required fields exist and recomputes WTC.
 * Returns null if the argument is falsy.
 * @param {object|null} formation
 * @returns {object|null}
 */
function normalizeFormation(formation) {
  if (!formation || typeof formation !== "object") return null;
  if (!Array.isArray(formation.elements)) formation.elements = [];

  // Migration: ensure baseCallsign exists (infer from label or first element).
  if (!formation.baseCallsign) {
    const labelMatch = (formation.label || "").match(/^(\S+)\s+flight of/i);
    if (labelMatch) {
      formation.baseCallsign = labelMatch[1];
    } else if (formation.elements.length > 0 && formation.elements[0].callsign) {
      formation.baseCallsign = formation.elements[0].callsign.replace(/\s*\d+$/, "").trim();
    } else {
      formation.baseCallsign = "";
    }
  }

  // Migration: ensure shared defaults layer exists.
  if (!formation.shared || typeof formation.shared !== "object") {
    const firstEl = formation.elements[0] || {};
    formation.shared = {
      depAd:      firstEl.depAd      || "",
      arrAd:      firstEl.arrAd      || "",
      flightType: "",
      tngCount:   0,
      osCount:    0,
      fisCount:   0
    };
  } else {
    // Forward-compat: fill any missing shared fields.
    formation.shared.depAd      = formation.shared.depAd      ?? "";
    formation.shared.arrAd      = formation.shared.arrAd      ?? "";
    formation.shared.flightType = formation.shared.flightType ?? "";
    formation.shared.tngCount   = formation.shared.tngCount   ?? 0;
    formation.shared.osCount    = formation.shared.osCount    ?? 0;
    formation.shared.fisCount   = formation.shared.fisCount   ?? 0;
  }

  // Ensure each element has required fields; add ordinal and overrides.
  formation.elements = formation.elements.map((el, idx) => {
    const normalized = {
      ordinal:    el.ordinal    || idx + 1,
      callsign:   el.callsign   || `ELEMENT ${idx + 1}`,
      reg:        el.reg        || "",
      type:       el.type       || "",
      wtc:        el.wtc        || "",
      status:     el.status     || "PLANNED",
      depAd:      el.depAd      || "",
      arrAd:      el.arrAd      || "",
      depActual:  el.depActual  || "",
      arrActual:  el.arrActual  || "",
      overrides:  el.overrides  || {}
    };
    return normalized;
  });

  // Recompute derived WTC fields
  const { wtcCurrent, wtcMax } = computeFormationWTC(formation.elements);
  formation.label      = formation.label || `Formation of ${formation.elements.length}`;
  formation.wtcCurrent = wtcCurrent;
  formation.wtcMax     = wtcMax;
  return formation;
}

/**
 * Update a single element within a movement's formation and recompute WTC.
 * @param {number} id           - Movement ID
 * @param {number} elementIndex - 0-based index into formation.elements
 * @param {object} patch        - Fields to update on the element
 * @returns {object|null} Updated movement, or null if not found / invalid
 */
export function updateFormationElement(id, elementIndex, patch) {
  ensureInitialised();
  const movement = movements.find(m => m.id === id);
  if (!movement || !movement.formation || !Array.isArray(movement.formation.elements)) {
    return null;
  }
  if (elementIndex < 0 || elementIndex >= movement.formation.elements.length) {
    return null;
  }

  Object.assign(movement.formation.elements[elementIndex], patch);

  // Recompute formation WTC
  const { wtcCurrent, wtcMax } = computeFormationWTC(movement.formation.elements);
  movement.formation.wtcCurrent = wtcCurrent;
  movement.formation.wtcMax     = wtcMax;

  // Update metadata
  const now = new Date().toISOString();
  movement.updatedAtUtc = now;
  movement.updatedBy = "local user";
  if (!movement.changeLog) movement.changeLog = [];
  movement.changeLog.push({
    timestamp: now,
    user: "local user",
    action: "updated",
    changes: { [`formation.elements[${elementIndex}]`]: patch }
  });

  saveToStorage();
  return movement;
}

/**
 * Cascade a master status change (COMPLETED or CANCELLED) to formation elements.
 * COMPLETED → sets PLANNED/ACTIVE elements to COMPLETED.
 * CANCELLED → sets all elements to CANCELLED.
 * Recomputes WTC and persists if any elements were changed.
 * No-op for other statuses or movements without a formation.
 * @param {number} id        - Movement ID
 * @param {string} newStatus - New master status
 */
export function cascadeFormationStatus(id, newStatus) {
  if (newStatus !== "COMPLETED" && newStatus !== "CANCELLED") return;
  ensureInitialised();
  const movement = movements.find(m => m.id === id);
  if (!movement?.formation?.elements?.length) return;

  let changed = false;
  movement.formation.elements.forEach(el => {
    if (newStatus === "COMPLETED") {
      if (el.status === "PLANNED" || el.status === "ACTIVE") {
        el.status = "COMPLETED";
        changed = true;
      }
    } else { // CANCELLED
      if (el.status !== "CANCELLED") {
        el.status = "CANCELLED";
        changed = true;
      }
    }
  });

  if (changed) {
    const { wtcCurrent, wtcMax } = computeFormationWTC(movement.formation.elements);
    movement.formation.wtcCurrent = wtcCurrent;
    movement.formation.wtcMax     = wtcMax;
    saveToStorage();
  }
}

/* -----------------------------
   CRUD Operations
------------------------------ */

export function statusClass(status) {
  switch (status) {
    case "PLANNED":
      return "status-planned";
    case "ACTIVE":
      return "status-active";
    case "COMPLETED":
      return "status-completed";
    case "CANCELLED":
      return "status-cancelled";
    default:
      return "status-planned";
  }
}

export function statusLabel(status) {
  switch (status) {
    case "PLANNED":
      return "Planned";
    case "ACTIVE":
      return "Active";
    case "COMPLETED":
      return "Completed";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}

export function createMovement(partial) {
  ensureInitialised();
  const now = new Date().toISOString();

  // Apply default times if not provided
  const withDefaults = applyDefaultTimes({ ...partial });

  // If planned time is already past on today's dof, start as ACTIVE immediately
  if (withDefaults.status === 'PLANNED') {
    const today = new Date().toISOString().split('T')[0];
    if (withDefaults.dof === today) {
      const ft = (withDefaults.flightType || '').toUpperCase();
      const checkTime = (ft === 'DEP' || ft === 'LOC') ? withDefaults.depPlanned
                      : (ft === 'ARR')                 ? withDefaults.arrPlanned
                      : (ft === 'OVR')                 ? withDefaults.depPlanned
                      : null;
      if (checkTime) {
        const { isPast } = checkPastTime(checkTime, withDefaults.dof);
        if (isPast) withDefaults.status = 'ACTIVE';
      }
    }
  }

  const movement = {
    id: nextId++,
    ...withDefaults,
    createdAtUtc: now,
    updatedAtUtc: now,
    updatedBy: "local user",
    changeLog: [
      {
        timestamp: now,
        user: "local user",
        action: "created",
        changes: {}
      }
    ]
  };
  movements.push(movement);
  saveToStorage();
  return movement;
}

export function updateMovement(id, patch) {
  ensureInitialised();
  const movement = movements.find((m) => m.id === id);
  if (!movement) return null;

  // Track what changed
  const changes = {};
  for (const key in patch) {
    if (patch[key] !== movement[key]) {
      changes[key] = { from: movement[key], to: patch[key] };
    }
  }

  // Update movement
  const now = new Date().toISOString();
  Object.assign(movement, patch);
  movement.updatedAtUtc = now;
  movement.updatedBy = "local user";

  // Append to change log
  if (!movement.changeLog) movement.changeLog = [];
  movement.changeLog.push({
    timestamp: now,
    user: "local user",
    action: "updated",
    changes
  });

  saveToStorage();
  return movement;
}

/**
 * Permanently delete a movement from storage.
 * Unlike cancel (soft delete), this removes the record entirely.
 * @param {number} id - Movement ID to delete
 * @returns {boolean} True if movement was found and deleted
 */
export function deleteMovement(id) {
  ensureInitialised();
  const index = movements.findIndex((m) => m.id === id);
  if (index === -1) return false;
  movements.splice(index, 1);
  saveToStorage();
  return true;
}

export function resetMovementsToDemo() {
  movements = cloneDemoMovements();
  nextId = computeNextId();
  movementsInitialised = true;
  saveToStorage();
}

export function exportSessionJSON() {
  ensureInitialised();
  return {
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    movements: movements.map(m => ({ ...m }))
  };
}

export function importSessionJSON(data) {
  try {
    if (!data || typeof data !== "object") {
      throw new Error("Invalid import data");
    }

    // Support both v1 (array) and v2 (object with version) formats
    let importedMovements;
    if (Array.isArray(data)) {
      // v1 format
      importedMovements = data;
    } else if (data.version && Array.isArray(data.movements)) {
      // v2 format
      importedMovements = data.movements;
    } else {
      throw new Error("Unrecognized import format");
    }

    movements = importedMovements.map(m => ({ ...m }));
    nextId = computeNextId();
    movementsInitialised = true;
    saveToStorage();
    return { success: true, count: movements.length };
  } catch (e) {
    console.error("FDMS: import failed", e);
    return { success: false, error: e.message };
  }
}

export function getStorageInfo() {
  return {
    key: STORAGE_KEY,
    version: SCHEMA_VERSION,
    movementCount: movementsInitialised ? movements.length : 0
  };
}

export function getDataCounts() {
  function countKey(key) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return 0;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch (e) {
      return 0;
    }
  }
  return {
    movements:        movementsInitialised ? movements.length : 0,
    calendarEvents:   countKey('vectair_fdms_calendar_events_v1'),
    bookingProfiles:  countKey('fdms_booking_profiles_v1'),
    cancelledSorties: countKey('vectair_fdms_cancelled_sorties_v1'),
    deletedStrips:    countKey('vectair_fdms_deleted_strips_v1'),
  };
}

/* -----------------------------
   Configuration Management
------------------------------ */

/**
 * Get current configuration
 * @returns {object} Configuration object
 */
export function getConfig() {
  ensureInitialised(); // Ensures config is loaded
  return { ...config };
}

/**
 * Update configuration
 * @param {object} updates - Partial config updates
 */
export function updateConfig(updates) {
  ensureInitialised();
  config = { ...config, ...updates };
  saveConfig();
}

/**
 * Get the UTC instant for 01:00 on the last Sunday of a given month.
 * Month is 0-indexed (0=Jan ... 11=Dec).
 * Used for Europe/London DST boundary calculation.
 *
 * BST runs from:
 *   last Sunday in March at 01:00 UTC
 * to
 *   last Sunday in October at 01:00 UTC
 *
 * @param {number} year
 * @param {number} monthIndex
 * @returns {Date}
 */
function getLastSundayAt0100UTC(year, monthIndex) {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0, 1, 0, 0));
  const dayOfWeek = lastDay.getUTCDay(); // 0=Sunday
  lastDay.setUTCDate(lastDay.getUTCDate() - dayOfWeek);
  return lastDay;
}

/**
 * Canonical Europe/London seasonal offset helper.
 * Returns 1 during BST, otherwise 0.
 *
 * @param {Date} [atDate]
 * @returns {number}
 */
function getEuropeLondonSeasonalOffsetHours(atDate = new Date()) {
  const year = atDate.getUTCFullYear();
  const bstStart = getLastSundayAt0100UTC(year, 2);  // March
  const bstEnd   = getLastSundayAt0100UTC(year, 9);  // October
  return (atDate >= bstStart && atDate < bstEnd) ? 1 : 0;
}

/**
 * Canonical operational timezone offset for the app.
 *
 * Behaviour:
 * - explicit non-UK style offsets (e.g. -5, +3) are respected directly
 * - UK-style values (0 or +1) are treated as "Europe/London operational mode"
 *   and resolved seasonally from the current date
 *
 * This preserves the existing schema while removing the brittle
 * "raw non-zero configured offset" dependency for local-time behaviour.
 *
 * @returns {number}
 */
export function getOperationalTimezoneOffsetHours() {
  const configured = Number(config.timezoneOffsetHours);
  if (Number.isFinite(configured) && Math.abs(configured) > 1) {
    return configured;
  }
  return getEuropeLondonSeasonalOffsetHours();
}

/**
 * Convert UTC time to local time based on canonical operational offset.
 * @param {string} utcTime - Time in HH:MM format (UTC)
 * @returns {string} Time in HH:MM format (Local)
 */
export function convertUTCToLocal(utcTime) {
  if (!utcTime) return "";
  const match = utcTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return utcTime;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const offsetHours = getOperationalTimezoneOffsetHours();

  let localHours = hours + offsetHours;

  // Handle day wraparound
  if (localHours < 0) localHours += 24;
  if (localHours >= 24) localHours -= 24;

  return `${String(localHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Convert local time to UTC time based on canonical operational offset.
 * @param {string} localTime - Time in HH:MM format (Local)
 * @returns {string} Time in HH:MM format (UTC)
 */
export function convertLocalToUTC(localTime) {
  if (!localTime) return "";
  const match = localTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return localTime;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const offsetHours = getOperationalTimezoneOffsetHours();

  let utcHours = hours - offsetHours;

  // Handle day wraparound
  if (utcHours < 0) utcHours += 24;
  if (utcHours >= 24) utcHours -= 24;

  return `${String(utcHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Get timezone offset label (e.g., "+1", "-5", "UTC")
 * Uses canonical operational offset, not raw stored config.
 * @returns {string} Offset label
 */
export function getTimezoneOffsetLabel() {
  const offset = getOperationalTimezoneOffsetHours();
  if (offset === 0) return "UTC";
  const sign = offset > 0 ? "+" : "";
  return `${sign}${offset}`;
}

/**
 * Returns true when local time is operationally distinct from UTC under the
 * canonical app timing model.
 *
 * This is the single source of truth for whether local time is actually
 * meaningful to operators at the current moment.
 */
function isLocalTimeOperationallyDistinct() {
  return getOperationalTimezoneOffsetHours() !== 0;
}

/**
 * Canonical helper: should the UTC/Local toggle be shown in new-strip forms?
 *
 * Policy meanings (config.newFormUtcLocalTogglePolicy):
 *   "show" → always render the toggle
 *   "hide" → never render the toggle
 *   "auto" → render when local time is operationally distinct from UTC
 *
 * Callers must not reinterpret config values themselves; use this function only.
 *
 * @returns {boolean}
 */
export function shouldShowUtcLocalToggleForNewForms() {
  const policy = config.newFormUtcLocalTogglePolicy || "auto";
  if (policy === "show") return true;
  if (policy === "hide") return false;
  return isLocalTimeOperationallyDistinct();
}

/* -----------------------------
   Input Validation Utilities
------------------------------ */

/**
 * Validate time format (HH:MM or HHMM)
 * @param {string} timeStr - Time string to validate
 * @returns {{valid: boolean, error: string|null, normalized: string|null}} Validation result
 */
export function validateTime(timeStr) {
  if (!timeStr || timeStr.trim() === "") {
    return { valid: true, error: null, normalized: null }; // Empty is acceptable (optional field)
  }

  const trimmed = timeStr.trim();

  // Check if already in HH:MM format
  let match = trimmed.match(/^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/);
  if (match) {
    const hours = match[1].padStart(2, '0');
    const minutes = match[2].padStart(2, '0');
    return { valid: true, error: null, normalized: `${hours}:${minutes}` };
  }

  // Check if in HHMM format (4 digits without colon)
  match = trimmed.match(/^([0-2][0-9])([0-5][0-9])$/);
  if (match) {
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);

    // Validate hours are 00-23
    if (hours > 23) {
      return { valid: false, error: "Hours must be between 00 and 23", normalized: null };
    }

    return { valid: true, error: null, normalized: `${match[1]}:${match[2]}` };
  }

  return { valid: false, error: "Time must be in HH:MM or HHMM format (e.g., 09:30, 0930, 14:45, or 1445)", normalized: null };
}

/**
 * Check if a time is in the past compared to current UTC time
 * @param {string} timeStr - Time string in HH:MM format
 * @param {string} dateStr - Date string in YYYY-MM-DD format (optional, defaults to today)
 * @returns {{isPast: boolean, warning: string|null}} Check result
 */
export function checkPastTime(timeStr, dateStr = null) {
  if (!timeStr || timeStr.trim() === "") {
    return { isPast: false, warning: null };
  }

  const now = new Date();
  const match = timeStr.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return { isPast: false, warning: null };
  }

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);

  // Use provided date or today's date
  let checkDate;
  if (dateStr && dateStr.trim() !== "") {
    const dateMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateMatch) {
      checkDate = new Date(Date.UTC(
        parseInt(dateMatch[1], 10),
        parseInt(dateMatch[2], 10) - 1,
        parseInt(dateMatch[3], 10),
        hours,
        minutes
      ));
    } else {
      return { isPast: false, warning: null };
    }
  } else {
    checkDate = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hours,
      minutes
    ));
  }

  if (checkDate < now) {
    return {
      isPast: true,
      warning: "Warning: This time is in the past. Continue if you are backfilling or correcting data."
    };
  }

  return { isPast: false, warning: null };
}

/**
 * Validate date format (YYYY-MM-DD)
 * @param {string} dateStr - Date string to validate
 * @returns {{valid: boolean, error: string|null}} Validation result
 */
export function validateDate(dateStr) {
  if (!dateStr || dateStr.trim() === "") {
    return { valid: true, error: null }; // Empty is acceptable (will default to today)
  }

  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return { valid: false, error: "Date must be in YYYY-MM-DD format" };
  }

  // Check if date is valid
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (month < 1 || month > 12) {
    return { valid: false, error: "Month must be between 01 and 12" };
  }

  if (day < 1 || day > 31) {
    return { valid: false, error: "Day must be between 01 and 31" };
  }

  // Check if date exists
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { valid: false, error: "Invalid date" };
  }

  return { valid: true, error: null };
}

/**
 * Validate number range
 * @param {string|number} value - Value to validate
 * @param {number} min - Minimum value (inclusive)
 * @param {number} max - Maximum value (inclusive)
 * @param {string} fieldName - Field name for error message
 * @returns {{valid: boolean, error: string|null}} Validation result
 */
export function validateNumberRange(value, min, max, fieldName = "Value") {
  if (value === "" || value === null || value === undefined) {
    return { valid: true, error: null }; // Empty is acceptable
  }

  const num = Number(value);
  if (isNaN(num)) {
    return { valid: false, error: `${fieldName} must be a number` };
  }

  if (num < min || num > max) {
    return { valid: false, error: `${fieldName} must be between ${min} and ${max}` };
  }

  return { valid: true, error: null };
}

/**
 * Validate required field
 * @param {string} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @returns {{valid: boolean, error: string|null}} Validation result
 */
export function validateRequired(value, fieldName = "Field") {
  if (!value || value.trim() === "") {
    return { valid: false, error: `${fieldName} is required` };
  }
  return { valid: true, error: null };
}

/* -----------------------------
   Storage Quota Monitoring
------------------------------ */

/**
 * Get localStorage usage information
 * @returns {{used: number, available: number, percentage: number, quota: number}} Storage info
 */
export function getStorageQuota() {
  if (typeof window === "undefined" || !window.localStorage) {
    return { used: 0, available: 0, percentage: 0, quota: 0 };
  }

  try {
    // Calculate current usage
    let used = 0;
    for (let key in window.localStorage) {
      if (window.localStorage.hasOwnProperty(key)) {
        used += window.localStorage[key].length + key.length;
      }
    }

    // localStorage quota is typically 5-10MB, assume 5MB as conservative estimate
    const quota = 5 * 1024 * 1024; // 5MB in bytes
    const available = quota - used;
    const percentage = (used / quota) * 100;

    return {
      used,
      available,
      percentage: Math.round(percentage * 10) / 10, // Round to 1 decimal
      quota
    };
  } catch (e) {
    console.warn("FDMS: failed to get storage quota", e);
    return { used: 0, available: 0, percentage: 0, quota: 0 };
  }
}

/**
 * Check if there's enough space to save data
 * @param {number} estimatedSize - Estimated size of data to save
 * @returns {boolean} True if there's enough space
 */
export function hasEnoughStorageSpace(estimatedSize = 100000) {
  const quota = getStorageQuota();
  return quota.available > estimatedSize;
}

/* -----------------------------
   Generic Overflights Counter
   (Free callers not on strip bay)
------------------------------ */

const GENERIC_OVR_STORAGE_KEY = "fdms_generic_overflights";

/**
 * Get the storage key for today's generic overflights
 */
function getGenericOvrKeyForDate(dateStr = null) {
  if (!dateStr) {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    dateStr = `${yyyy}-${mm}-${dd}`;
  }
  return `${GENERIC_OVR_STORAGE_KEY}_${dateStr}`;
}

/**
 * Get generic overflights count for a specific date (default: today)
 * @param {string} dateStr - Date in YYYY-MM-DD format (optional, defaults to today UTC)
 * @returns {number} The count of generic overflights
 */
export function getGenericOverflightsCount(dateStr = null) {
  const key = getGenericOvrKeyForDate(dateStr);
  const stored = localStorage.getItem(key);
  return stored ? parseInt(stored, 10) : 0;
}

/**
 * Set generic overflights count for a specific date (default: today)
 * @param {number} count - The count to set
 * @param {string} dateStr - Date in YYYY-MM-DD format (optional, defaults to today UTC)
 */
export function setGenericOverflightsCount(count, dateStr = null) {
  const key = getGenericOvrKeyForDate(dateStr);
  localStorage.setItem(key, String(Math.max(0, count)));
}

/**
 * Increment generic overflights count for today
 * @returns {number} The new count
 */
export function incrementGenericOverflights() {
  const current = getGenericOverflightsCount();
  const newCount = current + 1;
  setGenericOverflightsCount(newCount);
  return newCount;
}

/**
 * Decrement generic overflights count for today (min 0)
 * @returns {number} The new count
 */
export function decrementGenericOverflights() {
  const current = getGenericOverflightsCount();
  const newCount = Math.max(0, current - 1);
  setGenericOverflightsCount(newCount);
  return newCount;
}

/* ----------------------------------------
   Cancelled Sorties Log
   Immutable audit trail for cancelled strips
   (Ticket 6)
---------------------------------------- */

const CANCELLED_SORTIES_KEY = "vectair_fdms_cancelled_sorties_v1";

/**
 * Initialise cancelled sorties store if absent or corrupt.
 * Safe to call on every app load.
 */
export function ensureCancelledSortiesInitialised() {
  try {
    const raw = localStorage.getItem(CANCELLED_SORTIES_KEY);
    if (raw === null) {
      localStorage.setItem(CANCELLED_SORTIES_KEY, JSON.stringify([]));
      return;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn('[FDMS] Cancelled sorties store corrupt — resetting to []');
      localStorage.setItem(CANCELLED_SORTIES_KEY, JSON.stringify([]));
    }
  } catch (e) {
    console.warn('[FDMS] Cancelled sorties store repair:', e);
    localStorage.setItem(CANCELLED_SORTIES_KEY, JSON.stringify([]));
  }
}

/**
 * Get the full cancelled sorties log.
 * @returns {Array<Object>}
 */
export function getCancelledSorties() {
  ensureCancelledSortiesInitialised();
  try {
    const raw = localStorage.getItem(CANCELLED_SORTIES_KEY);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

/**
 * Save the full cancelled sorties list (overwrites).
 * @param {Array<Object>} list
 */
export function saveCancelledSorties(list) {
  localStorage.setItem(CANCELLED_SORTIES_KEY, JSON.stringify(Array.isArray(list) ? list : []));
}

/**
 * Append a single cancelled sortie entry to the log.
 * Guards against duplicate entries for the same sourceMovementId.
 * @param {Object} entry
 */
export function appendCancelledSortie(entry) {
  const list = getCancelledSorties();
  // Guard: do not create a duplicate log entry for the same source movement,
  // UNLESS the existing entry has been reinstated (strip was reinstated then cancelled again).
  if (entry.sourceMovementId !== undefined && entry.sourceMovementId !== null &&
      list.some(e => e.sourceMovementId === entry.sourceMovementId && !e.reinstated)) {
    return;
  }
  list.push(entry);
  saveCancelledSorties(list);
}

/* ----------------------------------------
   Deleted Strips Log
   Soft-delete retention store (Ticket 6a.3)
   Retention default: 24 hours.
   Future configurability: deferred — hardcoded constant below.
---------------------------------------- */

export const DELETED_STRIPS_RETENTION_HOURS = 24;
const DELETED_STRIPS_KEY = "vectair_fdms_deleted_strips_v1";

export function ensureDeletedStripsInitialised() {
  try {
    const raw = localStorage.getItem(DELETED_STRIPS_KEY);
    if (raw === null) {
      localStorage.setItem(DELETED_STRIPS_KEY, JSON.stringify([]));
      return;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn('[FDMS] Deleted strips store corrupt — resetting to []');
      localStorage.setItem(DELETED_STRIPS_KEY, JSON.stringify([]));
    }
  } catch (e) {
    console.warn('[FDMS] Deleted strips store repair:', e);
    localStorage.setItem(DELETED_STRIPS_KEY, JSON.stringify([]));
  }
}

export function getDeletedStrips() {
  ensureDeletedStripsInitialised();
  try {
    const raw = localStorage.getItem(DELETED_STRIPS_KEY);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

export function saveDeletedStrips(list) {
  localStorage.setItem(DELETED_STRIPS_KEY, JSON.stringify(Array.isArray(list) ? list : []));
}

/**
 * Append a single deleted-strip entry to the retention store.
 * @param {Object} entry
 */
export function appendDeletedStrip(entry) {
  const list = getDeletedStrips();
  list.push(entry);
  saveDeletedStrips(list);
}

/**
 * Purge all entries whose expiresAt has passed.
 * Safe to call on every render/load.
 * @returns {number} count of entries purged
 */
export function purgeExpiredDeletedStrips() {
  const list = getDeletedStrips();
  const now = Date.now();
  const live = list.filter(e => {
    if (!e.expiresAt) return false; // no expiry = treat as expired
    return new Date(e.expiresAt).getTime() > now;
  });
  const purged = list.length - live.length;
  if (purged > 0) saveDeletedStrips(live);
  return purged;
}

/**
 * Re-insert a movement snapshot back into the active movements store.
 * Used to restore a soft-deleted strip.
 * If the original ID is already in use (rare), logs a warning and returns false.
 * @param {Object} snapshot - full movement snapshot (with .id)
 * @returns {boolean} true if inserted
 */
export function insertRestoredMovement(snapshot) {
  ensureInitialised();
  if (!snapshot || snapshot.id === undefined || snapshot.id === null) return false;
  // Guard: don't insert if ID already in use
  if (movements.some(m => m.id === snapshot.id)) {
    console.warn('[FDMS] insertRestoredMovement: ID', snapshot.id, 'already in use — skipping');
    return false;
  }
  const now = new Date().toISOString();
  const restored = {
    ...snapshot,
    updatedAtUtc: now,
    updatedBy: 'local user (restored)',
  };
  if (!restored.changeLog) restored.changeLog = [];
  restored.changeLog.push({ timestamp: now, user: 'local user', action: 'restored from deleted strips', changes: {} });
  movements.push(restored);
  // Keep nextId ahead of any restored IDs
  if (typeof restored.id === 'number' && restored.id >= nextId) {
    nextId = restored.id + 1;
  }
  saveToStorage();
  return true;
}
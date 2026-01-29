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
  locFlightDurationMinutes: 40, // LOC: ETA = ETD + this
  ovrOffsetMinutes: 0,    // OVR: ECT = now + this
  timezoneOffsetHours: 0, // Local time offset from UTC (e.g., 0 for UTC, +1 for BST, -5 for EST)
  showLocalTime: false,   // Show local time conversions alongside UTC
  hideLocalTimeInBannerIfSame: false, // Hide local time in banner when same as UTC
  alwaysHideLocalTimeInBanner: false, // Never show local time in banner
  enableAlertTooltips: true, // Show alert tooltips on hover over highlighted strips
  wtcSystem: "ICAO",        // Wake turbulence system: "ICAO", "UK", or "RECAT"
  wtcAlertThreshold: "off", // ICAO: "off","M","H" | UK: "off","S","LM","UM","H","J" | RECAT: "off","E","D","C","B","A"
  autoActivateEnabled: true, // Automatically activate PLANNED arrivals before ETA
  autoActivateMinutesBeforeEta: 30, // Minutes before ETA to auto-activate (max: 120)
  // History tab alert visibility settings
  historyShowTimeAlerts: false,      // Show time-based alerts (stale, overdue) in History - off by default
  historyShowEmergencyAlerts: true,  // Show emergency alerts (7500/7600/7700) in History
  historyShowCallsignAlerts: false,  // Show callsign confusion alerts in History - off by default
  historyShowWtcAlerts: false        // Show WTC threshold alerts in History - off by default
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
      label: "CNNCT flight of 3",
      wtcCurrent: "M",
      wtcMax: "M",
      elements: [
        {
          callsign: "CNNCT 1",
          reg: "ZZ400",
          type: "EH10",
          wtc: "M",
          status: "ACTIVE",
          depActual: "13:15",
          arrActual: ""
        },
        {
          callsign: "CNNCT 2",
          reg: "ZZ401",
          type: "LYNX",
          wtc: "L",
          status: "ACTIVE",
          depActual: "13:15",
          arrActual: ""
        },
        {
          callsign: "CNNCT 3",
          reg: "ZZ402",
          type: "LYNX",
          wtc: "L",
          status: "PLANNED",
          depActual: "",
          arrActual: ""
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
      label: "MEMORIAL flight of 3",
      wtcCurrent: "M",
      wtcMax: "M",
      elements: [
        {
          callsign: "MEMORIAL 1",
          reg: "AB910",
          type: "SPIT",
          wtc: "L",
          status: "ACTIVE",
          depActual: "15:05",
          arrActual: ""
        },
        {
          callsign: "MEMORIAL 2",
          reg: "LF363",
          type: "HURI",
          wtc: "L",
          status: "ACTIVE",
          depActual: "15:05",
          arrActual: ""
        },
        {
          callsign: "MEMORIAL 3",
          reg: "PA474",
          type: "LANC",
          wtc: "M",
          status: "ACTIVE",
          depActual: "15:05",
          arrActual: ""
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
  if (loaded && loaded.length) {
    movements = loaded;
  } else {
    movements = cloneDemoMovements();
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
  now.setMinutes(now.getMinutes() + offsetMinutes);
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
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

  const date = new Date();
  date.setHours(hours);
  date.setMinutes(minutes + minutesToAdd);

  const newHours = String(date.getHours()).padStart(2, '0');
  const newMinutes = String(date.getMinutes()).padStart(2, '0');
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
 * Convert UTC time to local time based on configured offset
 * @param {string} utcTime - Time in HH:MM format (UTC)
 * @returns {string} Time in HH:MM format (Local)
 */
export function convertUTCToLocal(utcTime) {
  if (!utcTime) return "";
  const match = utcTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return utcTime;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const offsetHours = config.timezoneOffsetHours;

  let localHours = hours + offsetHours;

  // Handle day wraparound
  if (localHours < 0) localHours += 24;
  if (localHours >= 24) localHours -= 24;

  return `${String(localHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Get timezone offset label (e.g., "+1", "-5", "UTC")
 * @returns {string} Offset label
 */
export function getTimezoneOffsetLabel() {
  const offset = config.timezoneOffsetHours;
  if (offset === 0) return "UTC";
  const sign = offset > 0 ? "+" : "";
  return `${sign}${offset}`;
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

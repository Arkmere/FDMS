// datamodel.js
// Storage-backed demo data + helpers for statuses and basic querying.
// Movements persist in localStorage between page reloads.

const STORAGE_KEY = "vectair_fdms_movements_v2";
const STORAGE_KEY_V1 = "vectair_fdms_movements_v1";
const SCHEMA_VERSION = 2;

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

function migrateFromV1() {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_V1);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    console.log("FDMS: Migrating data from v1 to v2 schema");
    // Remove old key after successful migration
    window.localStorage.removeItem(STORAGE_KEY_V1);
    return parsed;
  } catch (e) {
    console.warn("FDMS: failed to migrate from v1", e);
    return null;
  }
}

function loadFromStorage() {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    // Try loading v2 schema first
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // v2 schema: { version, timestamp, movements }
      if (parsed && typeof parsed === "object" && parsed.version === SCHEMA_VERSION) {
        return Array.isArray(parsed.movements) ? parsed.movements : null;
      }
    }

    // Fall back to v1 migration if v2 not found
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
  const movement = {
    id: nextId++,
    ...partial,
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

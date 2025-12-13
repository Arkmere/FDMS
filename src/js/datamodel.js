// datamodel.js
// Storage-backed demo data + helpers for statuses and basic querying.
// Movements persist in localStorage between page reloads.

const STORAGE_KEY = "vectair_fdms_movements_v1";

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

function loadFromStorage() {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch (e) {
    console.warn("FDMS: failed to load movements from storage", e);
    return null;
  }
}

function saveToStorage() {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const payload = JSON.stringify(movements);
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
  const movement = { id: nextId++, ...partial };
  movements.push(movement);
  saveToStorage();
  return movement;
}

export function updateMovement(id, patch) {
  ensureInitialised();
  const movement = movements.find((m) => m.id === id);
  if (!movement) return null;
  Object.assign(movement, patch);
  saveToStorage();
  return movement;
}

export function resetMovementsToDemo() {
  movements = cloneDemoMovements();
  nextId = computeNextId();
  movementsInitialised = true;
  saveToStorage();
}

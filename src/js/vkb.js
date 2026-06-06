// vkb.js
// Vectair Knowledge Base - CSV data loading and management

import {
  auditEntityChange,
  appendAuditEvent,
  getAuditSummary,
  getAuditEventsForEntity
} from './audit.js';

/**
 * VKB Data Store
 * Holds all loaded CSV data in memory for fast lookups and autocomplete.
 * egowCodes and registrations reflect the EFFECTIVE (post-override) data;
 * use vkbBaselineData for the immutable bundled CSV originals.
 */
const vkbData = {
  aircraftTypes: [],
  callsignsStandard: [],
  callsignsNonstandard: [],
  locations: [],
  registrations: [],
  egowCodes: [],
  callsignKey: [],
  aircraftPilots: [],
  loaded: false,
  loadError: null
};

/**
 * Immutable bundled CSV rows for egowCodes and registrations.
 * Populated once by loadVKBData(). Used by the override layer as the baseline.
 * Never modified after load — overrides are applied on top, not written here.
 */
const vkbBaselineData = {
  egowCodes: [],
  registrations: []
};

/**
 * Parse CSV text into array of objects
 * @param {string} csvText - Raw CSV text
 * @returns {Array} Array of objects with headers as keys
 */
function parseCSV(csvText) {
  const lines = csvText.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];

  // Remove BOM if present
  let headers = lines[0].replace(/^\uFEFF/, '');
  headers = headers.split(',').map(h => h.trim());

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0) continue;

    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }
    rows.push(row);
  }

  return rows;
}

/**
 * Parse a single CSV line, handling quoted values with commas
 * @param {string} line - CSV line
 * @returns {Array} Array of values
 */
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        current += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // End of value
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  // Add last value
  values.push(current.trim());

  return values;
}

/**
 * Load a CSV file from the server
 * @param {string} path - Path to CSV file
 * @returns {Promise<Array>} Parsed CSV data
 */
async function loadCSV(path) {
  try {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const text = await response.text();
    return parseCSV(text);
  } catch (error) {
    console.error(`Failed to load ${path}:`, error);
    throw error;
  }
}

/**
 * Load all VKB CSV files
 * @returns {Promise<void>}
 */
export async function loadVKBData() {
  if (vkbData.loaded) {
    console.log('VKB: Data already loaded');
    return;
  }

  console.log('VKB: Loading CSV data...');
  const startTime = performance.now();

  try {
    // Load all CSV files in parallel
    const [
      aircraftTypes,
      callsignsStandard,
      callsignsNonstandard,
      locations,
      registrations,
      egowCodes,
      callsignKey,
      aircraftPilots
    ] = await Promise.all([
      loadCSV('./data/FDMS_AIRCRAFT_TYPES.csv'),
      loadCSV('./data/FDMS_CALLSIGNS_STANDARD.csv'),
      loadCSV('./data/FDMS_CALLSIGNS_NONSTANDARD CALLSIGNS.csv'),
      loadCSV('./data/FDMS_LOCATIONS_B_E_L.csv'),
      loadCSV('./data/FDMS_REGISTRATIONS.csv'),
      loadCSV('./data/FDMS_EGOW_CODES.csv'),
      loadCSV('./data/CALLSIGN_KEY.csv'),
      loadCSV('./data/FDMS_AIRCRAFT_PILOTS.csv')
    ]);

    vkbData.aircraftTypes = aircraftTypes;
    vkbData.callsignsStandard = callsignsStandard;
    vkbData.callsignsNonstandard = callsignsNonstandard;
    vkbData.locations = locations;
    vkbData.callsignKey = callsignKey;
    vkbData.aircraftPilots = aircraftPilots;
    vkbData.loaded = true;
    vkbData.loadError = null;

    // Store bundled originals before applying overrides
    vkbBaselineData.egowCodes = egowCodes;
    vkbBaselineData.registrations = registrations;

    // Set effective arrays (overrides applied on top of baseline)
    vkbData.egowCodes = getEffectiveEgowCodes();
    vkbData.registrations = getEffectiveRegistrations();

    const endTime = performance.now();
    const loadTime = (endTime - startTime).toFixed(0);

    console.log(`VKB: Loaded ${aircraftTypes.length} aircraft types`);
    console.log(`VKB: Loaded ${callsignsStandard.length} standard callsigns`);
    console.log(`VKB: Loaded ${callsignsNonstandard.length} nonstandard callsigns`);
    console.log(`VKB: Loaded ${locations.length} locations`);
    console.log(`VKB: Loaded ${registrations.length} registrations`);
    console.log(`VKB: Loaded ${egowCodes.length} EGOW codes`);
    console.log(`VKB: Loaded ${aircraftPilots.length} aircraft pilot rows`);
    console.log(`VKB: Load complete in ${loadTime}ms`);

  } catch (error) {
    vkbData.loadError = error.message;
    console.error('VKB: Failed to load data:', error);
    throw error;
  }
}

/**
 * Get VKB data status
 * @returns {Object} Status object
 */
export function getVKBStatus() {
  return {
    loaded: vkbData.loaded,
    error: vkbData.loadError,
    counts: {
      aircraftTypes: vkbData.aircraftTypes.length,
      callsignsStandard: vkbData.callsignsStandard.length,
      callsignsNonstandard: vkbData.callsignsNonstandard.length,
      locations: vkbData.locations.length,
      registrations: vkbData.registrations.length,
      egowCodes: vkbData.egowCodes.length,
      aircraftPilots: vkbData.aircraftPilots.length
    }
  };
}

/**
 * Get VKB registrations data
 * @returns {Array} Registrations array
 */
export function getVKBRegistrations() {
  return vkbData.registrations || [];
}

/**
 * Search aircraft types
 * @param {string} query - Search query
 * @param {number} limit - Max results (default 50)
 * @returns {Array} Matching aircraft types
 */
export function searchAircraftTypes(query, limit = 50) {
  if (!vkbData.loaded) return [];

  const q = query.toLowerCase().trim();
  if (!q) return vkbData.aircraftTypes.slice(0, limit);

  return vkbData.aircraftTypes
    .filter(type => {
      const icao = (type['ICAO Type Designator'] || '').toLowerCase();
      const model = (type['Model'] || '').toLowerCase();
      const manufacturer = (type['Manufacturer'] || '').toLowerCase();
      const commonName = (type['Common Name'] || '').toLowerCase();

      return icao.includes(q) ||
             model.includes(q) ||
             manufacturer.includes(q) ||
             commonName.includes(q);
    })
    .slice(0, limit);
}

/**
 * Search callsigns (standard and nonstandard)
 * @param {string} query - Search query
 * @param {number} limit - Max results (default 50)
 * @returns {Array} Matching callsigns
 */
export function searchCallsigns(query, limit = 50) {
  if (!vkbData.loaded) return [];

  const q = query.toLowerCase().trim();
  if (!q) return [...vkbData.callsignsStandard, ...vkbData.callsignsNonstandard].slice(0, limit);

  const results = [];
  const seen = new Set(); // Track unique contractions to avoid duplicates

  // Search standard callsigns first (higher priority)
  for (const cs of vkbData.callsignsStandard) {
    if (results.length >= limit) break;

    const callsign = (cs['CALLSIGN'] || '').toLowerCase();
    const tricode = (cs['TRICODE'] || '').toLowerCase();
    const commonName = (cs['COMMON NAME'] || '').toLowerCase();

    if (callsign.includes(q) || tricode.includes(q) || commonName.includes(q)) {
      const record = { ...cs, _source: 'standard' };
      const contraction = getCallsignContraction(record);
      if (!seen.has(contraction)) {
        results.push(record);
        seen.add(contraction);
      }
    }
  }

  // Search nonstandard callsigns - prioritize approved contractions
  const approved = [];
  const other = [];

  for (const cs of vkbData.callsignsNonstandard) {
    const callsign = (cs['CALLSIGN'] || '').toLowerCase();
    const icao3ld = (cs['ICAO 3LD'] || '').toLowerCase();
    const ssrIndication = (cs['SSR INDICATION'] || '').toLowerCase();
    const commonName = (cs['COMMON NAME'] || '').toLowerCase();

    if (callsign.includes(q) || icao3ld.includes(q) || ssrIndication.includes(q) || commonName.includes(q)) {
      const record = { ...cs, _source: 'nonstandard' };
      const isApproved = cs['APPROVED CONTRACTION'] === 'Y';

      if (isApproved) {
        approved.push(record);
      } else {
        other.push(record);
      }
    }
  }

  // Add approved contractions first, then others
  for (const record of [...approved, ...other]) {
    if (results.length >= limit) break;
    const contraction = getCallsignContraction(record);
    if (!seen.has(contraction)) {
      results.push(record);
      seen.add(contraction);
    }
  }

  return results;
}

/**
 * Search locations
 * @param {string} query - Search query
 * @param {number} limit - Max results (default 50)
 * @returns {Array} Matching locations
 */
export function searchLocations(query, limit = 50) {
  if (!vkbData.loaded) return [];

  const q = query.toLowerCase().trim();
  if (!q) return vkbData.locations.slice(0, limit);

  return vkbData.locations
    .filter(loc => {
      const icao = (loc['ICAO CODE'] || '').toLowerCase();
      const iata = (loc['IATA CODE'] || '').toLowerCase();
      const airport = (loc['AIRPORT'] || '').toLowerCase();
      const served = (loc['LOCATION SERVED'] || '').toLowerCase();

      return icao.includes(q) ||
             iata.includes(q) ||
             airport.includes(q) ||
             served.includes(q);
    })
    .slice(0, limit);
}

/**
 * Search registrations
 * @param {string} query - Search query
 * @param {number} limit - Max results (default 50)
 * @returns {Array} Matching registrations
 */
export function searchRegistrations(query, limit = 50) {
  if (!vkbData.loaded) return [];

  const effective = getEffectiveRegistrations();
  const q = query.toLowerCase().trim().replace(/-/g, ''); // Remove dashes from query
  if (!q) return effective.slice(0, limit);

  return effective
    .filter(reg => {
      const registration = (reg['REGISTRATION'] || '').toLowerCase().replace(/-/g, ''); // Remove dashes
      const operator = (reg['OPERATOR'] || '').toLowerCase();
      const type = (reg['TYPE'] || '').toLowerCase();

      return registration.includes(q) ||
             operator.includes(q) ||
             type.includes(q);
    })
    .slice(0, limit);
}

/**
 * Search all VKB data
 * @param {string} query - Search query
 * @param {number} limit - Max results per category (default 10)
 * @returns {Object} Results grouped by category
 */
export function searchAll(query, limit = 10) {
  return {
    aircraftTypes: searchAircraftTypes(query, limit),
    callsigns: searchCallsigns(query, limit),
    locations: searchLocations(query, limit),
    registrations: searchRegistrations(query, limit)
  };
}

/**
 * Extract the contraction from a callsign record
 * Priority: TRICODE (standard) > ICAO 3LD (nonstandard) > SSR INDICATION (nonstandard)
 * For nonstandard, prioritize entries where APPROVED CONTRACTION = 'Y'
 * @param {Object} callsignRecord - Callsign record from VKB
 * @returns {string} Contraction to display
 */
function getCallsignContraction(callsignRecord) {
  // Standard callsigns: Use TRICODE
  if (callsignRecord._source === 'standard') {
    const tricode = callsignRecord['TRICODE'];
    return tricode && tricode !== '-' ? tricode : callsignRecord['CALLSIGN'] || '';
  }

  // Nonstandard callsigns: Use ICAO 3LD > SSR INDICATION
  const icao3ld = callsignRecord['ICAO 3LD'];
  const ssrIndication = callsignRecord['SSR INDICATION'];

  if (icao3ld && icao3ld !== '-' && icao3ld !== 'N/A') {
    return icao3ld;
  }

  if (ssrIndication && ssrIndication !== '-' && ssrIndication !== 'N/A') {
    return ssrIndication;
  }

  // Fallback to voice callsign
  return callsignRecord['CALLSIGN'] || '';
}

/**
 * Get autocomplete suggestions for a field
 * @param {string} fieldType - 'type', 'callsign', 'location', 'registration'
 * @param {string} query - Partial input
 * @param {number} limit - Max suggestions (default 10)
 * @returns {Array} Suggestion objects with primary and secondary text
 */
export function getAutocompleteSuggestions(fieldType, query, limit = 10) {
  if (!vkbData.loaded || !query) return [];

  const q = query.toLowerCase().trim();

  switch (fieldType) {
    case 'type':
      return searchAircraftTypes(q, limit).map(t => ({
        primary: t['ICAO Type Designator'] || '',
        secondary: t['Common Name'] || t['Model'] || ''
      }));

    case 'callsign':
      return searchCallsigns(q, limit).map(c => ({
        primary: getCallsignContraction(c),
        secondary: c['CALLSIGN'] || ''
      }));

    case 'location':
      return searchLocations(q, limit).map(l => ({
        primary: l['ICAO CODE'] || '',
        secondary: l['AIRPORT'] || l['LOCATION SERVED'] || ''
      }));

    case 'registration':
      return searchRegistrations(q, limit).map(r => ({
        primary: r['REGISTRATION'] || '',
        secondary: r['OPERATOR'] || ''
      }));

    default:
      return [];
  }
}

/**
 * Look up a registration in the VKB database
 * @param {string} registration - Registration to look up (e.g., "G-BYUN")
 * @returns {Object|null} Registration data or null if not found
 */
export function lookupRegistration(registration) {
  if (!vkbData.loaded || !registration) return null;

  const normalized = registration.toUpperCase().trim().replace(/[-\s]/g, '');

  return getEffectiveRegistrations().find(reg => {
    const regNormalized = (reg['REGISTRATION'] || '').toUpperCase().replace(/[-\s]/g, '');
    return regNormalized === normalized;
  }) || null;
}

/**
 * Look up a registration by its fixed callsign
 * @param {string} callsign - Fixed callsign to look up (e.g., "GCLBT")
 * @returns {Object|null} Registration data or null if not found
 */
export function lookupRegistrationByFixedCallsign(callsign) {
  if (!vkbData.loaded || !callsign) return null;

  const normalized = callsign.toUpperCase().trim();

  return getEffectiveRegistrations().find(reg => {
    const fixedCs = (reg['FIXED C/S'] || '').toUpperCase().trim();
    return fixedCs && fixedCs !== '-' && fixedCs === normalized;
  }) || null;
}

/**
 * Normalise a callsign token for EGOW lookup matching only.
 * Uppercase, trim, collapse internal whitespace.
 * Does NOT alter stored or displayed callsigns.
 */
function normalizeCallsignToken(value) {
  return String(value ?? '').toUpperCase().trim().replace(/\s+/g, '');
}

/**
 * Normalise a flight number for EGOW lookup matching only.
 * Strips leading zeroes by parsing as integer so "02", "2", "002" all match.
 * Blank input stays blank (not 0) — blank FLIGHT_NUMBER is the base-strip fallback.
 * Does NOT alter stored or displayed callsigns.
 */
function normalizeFlightNumber(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? String(n) : s.toUpperCase();
}

/**
 * Look up expanded EGOW attribution from a callsign code.
 * Handles base callsigns, approved contractions, and numeric suffixes.
 * Flight-number normalisation is lookup-only. It does not alter stored/displayed callsigns.
 * @param {string} callsignCode - Full callsign (e.g. "UAM03", "MERSY", "MERSY1", "MERSY 1")
 * @returns {Object|null} Attribution object or null if not found
 */
export function lookupEgowAttributionFromCallsign(callsignCode) {
  if (!vkbData.loaded || !callsignCode) return null;

  // Use effective dataset (bundled CSV + local overrides applied)
  const egowCodes = getEffectiveEgowCodes();

  // Normalise input for matching: uppercase, trim, remove internal whitespace
  const norm = normalizeCallsignToken(callsignCode);

  // Split trailing numeric suffix: "UAM03" → base="UAM", flightNum="03"
  const splitMatch = norm.match(/^([A-Z]+)(\d+)?$/);
  if (!splitMatch) return null;

  const base = splitMatch[1];
  // Normalise flight number for comparison only (strips leading zeroes)
  const flightNum = normalizeFlightNumber(splitMatch[2] || '');

  // Priority 1: CALLSIGN_BASE + FLIGHT_NUMBER exact normalised match.
  // Domain rule: individual-pilot callsign families (e.g. UAM) use leading-zero
  // format for single-digit numbers (UAM01..UAM09). If the operator enters a
  // bare single digit without a leading zero (e.g. "UAM3"), do NOT silently
  // resolve it as UAM03. The check is skipped for formation families whose
  // highest flight number is < 10 (e.g. VITAL1, MERSY1 — those families do
  // not pad single digits). Formation element callsigns whose base has an
  // APPROVED_CONTRACTION are reached via Priority 2 anyway (e.g. MERSY2).
  let row = null;
  let malformedInput = false;
  if (flightNum) {
    // Detect whether the raw input suffix was a single digit with no leading zero.
    const rawSuffix = splitMatch[2] || '';
    const inputIsSingleDigitNoLeadingZero = /^\d$/.test(rawSuffix); // exactly one digit

    row = egowCodes.find(ec => {
      const csBase = normalizeCallsignToken(ec['CALLSIGN_BASE']);
      const fNum = normalizeFlightNumber(ec['FLIGHT_NUMBER']);
      return csBase === base && fNum === flightNum;
    });

    // If we found a match but the input was a bare single digit, check whether
    // this base family contains multi-digit flight numbers (>= 10). If it does,
    // the family uses leading-zero protocol for 1-9 and the input is malformed.
    // Set malformedInput to prevent fallthrough to base-strip (Priority 3/4) rows.
    if (row && inputIsSingleDigitNoLeadingZero) {
      const familyHasMultiDigit = egowCodes.some(ec => {
        const csBase = normalizeCallsignToken(ec['CALLSIGN_BASE']);
        return csBase === base && parseInt(ec['FLIGHT_NUMBER'] || '0', 10) >= 10;
      });
      if (familyHasMultiDigit) {
        row = null;
        malformedInput = true;
      }
    }
  }

  // Priority 2: APPROVED_CONTRACTION + FLIGHT_NUMBER exact normalised match
  if (!row && flightNum) {
    row = egowCodes.find(ec => {
      // Support corrected spelling; fall back to old typo for any legacy files
      const csContr = normalizeCallsignToken(ec['APPROVED_CONTRACTION'] || ec['APPROVED_CONTRATION']);
      const fNum = normalizeFlightNumber(ec['FLIGHT_NUMBER']);
      return csContr && csContr === base && fNum === flightNum;
    });
  }

  // Malformed input (e.g. bare single digit where leading-zero is required):
  // do not fall through to base-strip fallbacks — no attribution is better than wrong attribution.
  if (malformedInput) return null;

  // Priority 3: CALLSIGN_BASE + blank FLIGHT_NUMBER fallback
  if (!row) {
    row = egowCodes.find(ec => {
      const csBase = normalizeCallsignToken(ec['CALLSIGN_BASE']);
      const fNum = normalizeFlightNumber(ec['FLIGHT_NUMBER']);
      return csBase === base && fNum === '';
    });
  }

  // Priority 4: APPROVED_CONTRACTION + blank FLIGHT_NUMBER fallback
  if (!row) {
    row = egowCodes.find(ec => {
      const csContr = normalizeCallsignToken(ec['APPROVED_CONTRACTION'] || ec['APPROVED_CONTRATION']);
      const fNum = normalizeFlightNumber(ec['FLIGHT_NUMBER']);
      return csContr && csContr === base && fNum === '';
    });
  }

  // Legacy fallback: old-schema 'Callsign' column
  if (!row) {
    row = egowCodes.find(ec =>
      normalizeCallsignToken(ec['Callsign']) === norm
    );
  }

  if (!row) return null;

  return {
    callsignBase: (row['CALLSIGN_BASE'] || '').trim(),
    approvedContraction: (row['APPROVED_CONTRACTION'] || row['APPROVED_CONTRATION'] || '').trim(),
    flightNumber: (row['FLIGHT_NUMBER'] || '').trim(),
    egowCode: (row['EGOW_CODE'] || row['EGOW Code'] || '').trim(),
    unit: (row['UNIT'] || '').trim(),
    unitCode: (row['UNIT_CODE'] || row['UC'] || '').trim(),
    name: (row['NAME'] || row['Name'] || '').trim(),
    position: (row['POSITION'] || row['Position'] || '').trim(),
    notes: (row['NOTES'] || '').trim(),
    source: 'egowCodes'
  };
}

/**
 * Look up a callsign in the VKB database
 * @param {string} callsign - Callsign to look up
 * @returns {Object|null} Callsign data or null if not found
 */
export function lookupCallsign(callsign) {
  if (!vkbData.loaded || !callsign) return null;

  const normalized = callsign.toUpperCase().trim();

  // First check EGOW codes using expanded schema resolver
  const egowAttrib = lookupEgowAttributionFromCallsign(normalized);
  if (egowAttrib) {
    // Return normalized object with UC field for backward compat with existing callers
    return {
      'Callsign': normalized,
      'UC': egowAttrib.unitCode,
      'Name': egowAttrib.name,
      'Unit': egowAttrib.unit,
      'EGOW_CODE': egowAttrib.egowCode,
      '_source': 'egowCodes',
      '_egowAttrib': egowAttrib
    };
  }

  // Search both standard and nonstandard callsigns
  let result = vkbData.callsignsStandard.find(cs =>
    (cs['CALLSIGN'] || '').toUpperCase() === normalized
  );

  if (!result) {
    result = vkbData.callsignsNonstandard.find(cs =>
      (cs['CALLSIGN'] || '').toUpperCase() === normalized
    );
  }

  return result || null;
}

/**
 * Look up aircraft pilots by registration or fixed callsign.
 * @param {string} registration - Aircraft registration (e.g. "G-CKSR" or "GCKSR")
 * @param {string} fixedCallsign - Fixed callsign (e.g. "STEARMAN28")
 * @returns {Array} Sorted array of pilot objects
 */
export function lookupAircraftPilots(registration = '', fixedCallsign = '') {
  if (!vkbData.loaded) return [];

  const normReg = registration.toUpperCase().trim().replace(/-/g, '');
  const normCs = fixedCallsign.toUpperCase().trim();

  if (!normReg && !normCs) return [];

  const matches = vkbData.aircraftPilots.filter(row => {
    const rowReg = (row['REGISTRATION'] || '').toUpperCase().trim().replace(/-/g, '');
    const rowCs = (row['FIXED_CALLSIGN'] || '').toUpperCase().trim();
    return (normReg && rowReg === normReg) || (normCs && rowCs === normCs);
  });

  if (matches.length === 0) return [];

  // Count last names to detect duplicates for disambiguation
  const lastNameCounts = {};
  for (const row of matches) {
    const last = (row['PILOT_NAME_LAST'] || '').trim().toUpperCase();
    lastNameCounts[last] = (lastNameCounts[last] || 0) + 1;
  }

  // Sort alphabetically by last name then first name
  const sorted = [...matches].sort((a, b) => {
    const lastA = (a['PILOT_NAME_LAST'] || '').toUpperCase();
    const lastB = (b['PILOT_NAME_LAST'] || '').toUpperCase();
    if (lastA !== lastB) return lastA.localeCompare(lastB);
    return (a['PILOT_NAME_FIRST'] || '').toUpperCase().localeCompare(
      (b['PILOT_NAME_FIRST'] || '').toUpperCase()
    );
  });

  return sorted.map(row => {
    const lastName = (row['PILOT_NAME_LAST'] || '').trim();
    const firstName = (row['PILOT_NAME_FIRST'] || '').trim();
    const isDuplicate = lastNameCounts[lastName.toUpperCase()] > 1;

    let displayName = lastName;
    if (isDuplicate && firstName) {
      displayName = `${lastName} ${firstName.charAt(0)}`;
    }
    const fullName = firstName ? `${lastName} ${firstName}` : lastName;

    return {
      registration: (row['REGISTRATION'] || '').trim(),
      fixedCallsign: (row['FIXED_CALLSIGN'] || '').trim(),
      lastName,
      firstName,
      displayName,
      fullName
    };
  });
}

/**
 * Look up location by ICAO code
 * @param {string} icaoCode - ICAO airport code (e.g., "EGOW", "EGCC")
 * @returns {Object|null} Location data or null if not found
 */
export function lookupLocation(icaoCode) {
  if (!vkbData.loaded || !icaoCode) return null;

  const normalized = icaoCode.toUpperCase().trim();

  return vkbData.locations.find(loc => {
    const icao = (loc['ICAO CODE'] || '').toUpperCase().trim();
    return icao === normalized;
  }) || null;
}

/**
 * Get location name for display
 * @param {string} icaoCode - ICAO airport code
 * @returns {string} Location name (AIRPORT or LOCATION SERVED)
 */
export function getLocationName(icaoCode) {
  const locationData = lookupLocation(icaoCode);
  if (!locationData) return '';

  // Prefer AIRPORT, fall back to LOCATION SERVED
  const airport = (locationData['AIRPORT'] || '').trim();
  const locationServed = (locationData['LOCATION SERVED'] || '').trim();

  return airport || locationServed || '';
}

/**
 * Look up aircraft type data by ICAO Type Designator
 * @param {string} icaoType - ICAO Type Designator (e.g., "A400", "G115")
 * @returns {Object|null} Aircraft type data or null if not found
 */
export function lookupAircraftType(icaoType) {
  if (!vkbData.loaded || !icaoType) return null;

  const normalized = icaoType.toUpperCase().trim();

  return vkbData.aircraftTypes.find(type => {
    const typeDesignator = (type['ICAO Type Designator'] || '').toUpperCase().trim();
    return typeDesignator === normalized;
  }) || null;
}

/**
 * Derive RECAT-EU category from MCTOM (Maximum Certified Take-Off Mass)
 * RECAT-EU categories: A (Super Heavy) to F (Light)
 * @param {number} mctom - MCTOM in kg
 * @returns {string} RECAT-EU category letter
 */
function deriveRecatFromMctom(mctom) {
  if (!mctom || isNaN(mctom)) return "F"; // Default to Light
  if (mctom >= 560000) return "A"; // Super Heavy (A380 class)
  if (mctom >= 136000) return "B"; // Upper Heavy (B747, A350, etc.)
  if (mctom >= 100000) return "C"; // Lower Heavy (B767, A300, etc.)
  if (mctom >= 18000) return "D";  // Upper Medium (A320, B737, etc.)
  if (mctom >= 8600) return "E";   // Lower Medium (Regional jets, turboprops)
  return "F";                       // Light (<8,600 kg)
}

/**
 * Get Wake Turbulence Category for an aircraft type and movement
 * Supports three WTC standards:
 * - ICAO: L/M/H (global baseline by MTOM)
 * - UK: L/S/LM/UM/H/J (CAP 493, uses different categories for DEP vs ARR)
 * - RECAT: A/B/C/D/E/F (RECAT-EU standard)
 *
 * @param {string} icaoType - ICAO Type Designator (e.g., "A400")
 * @param {string} flightType - Flight type: DEP, ARR, LOC, OVR
 * @param {string} wtcStandard - WTC standard: "ICAO", "UK", or "RECAT" (default "ICAO")
 * @returns {string} WTC string (e.g., "H (UK)" or "M (ICAO)" or "C (RECAT)")
 */
export function getWTC(icaoType, flightType, wtcStandard = "ICAO") {
  const typeData = lookupAircraftType(icaoType);
  if (!typeData) return "L (ICAO)"; // Default fallback

  let wtc = "";

  if (wtcStandard === "UK") {
    // UK CAP 493: Uses different categories for departures vs arrivals
    // DEP/OVR use 5 categories: L, S, M, H, J
    // ARR/LOC use 6 categories: L, S, LM, UM, H, J
    if (flightType === "DEP" || flightType === "OVR") {
      wtc = typeData['UK Departure WTC'] || typeData['ICAO WTC'] || "L";
    } else {
      wtc = typeData['UK Arrival WTC'] || typeData['ICAO WTC'] || "L";
    }
    return `${wtc} (UK)`;
  } else if (wtcStandard === "RECAT") {
    // RECAT-EU: Derive from MCTOM if no specific RECAT column exists
    const mctom = parseFloat(typeData['MCTOM (Kg)']) || 0;
    wtc = deriveRecatFromMctom(mctom);
    return `${wtc} (RECAT)`;
  } else {
    // ICAO: L (< 7t), M (7-136t), H (≥ 136t)
    wtc = typeData['ICAO WTC'] || "L";
    return `${wtc} (ICAO)`;
  }
}

/**
 * Look up a callsign by its contraction (TRICODE, ICAO 3LD, or SSR INDICATION)
 * @param {string} contraction - Contraction to look up (e.g., "PLMTR", "BAW")
 * @returns {Object|null} Callsign data or null if not found
 */
export function lookupCallsignByContraction(contraction) {
  if (!vkbData.loaded || !contraction) return null;

  const normalized = contraction.toUpperCase().trim();

  // Search standard callsigns by TRICODE
  let result = vkbData.callsignsStandard.find(cs => {
    const tricode = (cs['TRICODE'] || '').toUpperCase().trim();
    return tricode && tricode !== '-' && tricode === normalized;
  });

  if (result) return result;

  // Search nonstandard callsigns by ICAO 3LD or SSR INDICATION
  result = vkbData.callsignsNonstandard.find(cs => {
    const icao3ld = (cs['ICAO 3LD'] || '').toUpperCase().trim();
    const ssrIndication = (cs['SSR INDICATION'] || '').toUpperCase().trim();

    return (icao3ld && icao3ld !== '-' && icao3ld !== 'N/A' && icao3ld === normalized) ||
           (ssrIndication && ssrIndication !== '-' && ssrIndication !== 'N/A' && ssrIndication === normalized);
  });

  return result || null;
}

/**
 * Check if a code matches a known VKB contraction (TRICODE, ICAO 3LD, or SSR INDICATION)
 * @param {string} code - The code to check (e.g., "BAW", "EOM")
 * @returns {boolean} True if code matches a known contraction
 */
export function isKnownContraction(code) {
  return lookupCallsignByContraction(code) !== null;
}

/**
 * Get voice callsign for display on strip (only if different from contraction and registration)
 * @param {string} contraction - The callsign contraction (e.g., "BAW")
 * @param {string} registration - The aircraft registration (e.g., "G-BYUN")
 * @returns {string} Voice callsign to display, or empty string if shouldn't be shown
 */
export function getVoiceCallsignForDisplay(contraction, registration) {
  if (!vkbData.loaded || !contraction) return '';

  // Look up the callsign (strip flight number to get base callsign)
  const baseCallsign = contraction.replace(/\d+$/, '').trim();
  if (!baseCallsign) return '';

  const csData = lookupCallsignByContraction(baseCallsign);
  if (!csData || !csData['CALLSIGN']) return '';

  const voiceCallsign = csData['CALLSIGN'].toUpperCase().trim();
  const contractionNormalized = baseCallsign.toUpperCase().trim();
  const registrationNormalized = (registration || '').toUpperCase().trim().replace(/-/g, '');

  // Don't show if voice callsign is same as contraction (base only, without flight number)
  if (voiceCallsign === contractionNormalized) {
    return '';
  }

  // Don't show if voice callsign is just the registration (with or without dash)
  if (voiceCallsign === registrationNormalized || voiceCallsign.replace(/-/g, '') === registrationNormalized) {
    return '';
  }

  return voiceCallsign;
}

/**
 * Look up captain name from EGOW codes
 * @param {string} callsignCode - Full callsign code (e.g., "UAM11", "MERSY1")
 * @returns {string} Captain name or empty string
 */
export function lookupCaptainFromEgowCodes(callsignCode) {
  if (!vkbData.loaded || !callsignCode) return '';
  const attrib = lookupEgowAttributionFromCallsign(callsignCode);
  return attrib ? attrib.name : '';
}

/**
 * Look up unit code from EGOW codes
 * @param {string} callsignCode - Full callsign code (e.g., "UAM11", "MERSY1")
 * @returns {string} Unit code (L, M, A) or empty string
 */
export function lookupUnitCodeFromEgowCodes(callsignCode) {
  if (!vkbData.loaded || !callsignCode) return '';
  const attrib = lookupEgowAttributionFromCallsign(callsignCode);
  return attrib ? attrib.unitCode : '';
}

/**
 * Look up unit description from callsign databases
 * @param {string} callsignCode - Full callsign code (e.g., "BAW123", "UAM11")
 * @param {string} acftType - Aircraft type for disambiguation
 * @returns {string} Unit description or '-'
 */
export function lookupUnitFromCallsign(callsignCode, acftType = '') {
  if (!vkbData.loaded || !callsignCode) return '-';

  // Extract tricode/contraction from callsign (remove flight number)
  const baseCallsign = callsignCode.replace(/\d+$/, '').trim().toUpperCase();

  // First try standard callsigns by TRICODE
  const standardMatch = vkbData.callsignsStandard.find(cs => {
    const tricode = (cs['TRICODE'] || '').toUpperCase().trim();
    return tricode && tricode !== '-' && tricode === baseCallsign;
  });

  if (standardMatch) {
    return (standardMatch['COMMON NAME'] || '').trim() || '-';
  }

  // Try nonstandard callsigns by SSR INDICATION
  const ssrMatches = vkbData.callsignsNonstandard.filter(cs => {
    const ssrIndication = (cs['SSR INDICATION'] || '').toUpperCase().trim();
    return ssrIndication && ssrIndication !== '-' && ssrIndication !== 'N/A' && ssrIndication === baseCallsign;
  });

  if (ssrMatches.length === 0) return '-';

  // If multiple matches, try to disambiguate by aircraft type
  if (ssrMatches.length > 1 && acftType) {
    const typeNormalized = acftType.toUpperCase().trim();
    const typeMatch = ssrMatches.find(cs => {
      const csType = (cs['ACFT TYPE'] || '').toUpperCase().trim();
      return csType === typeNormalized;
    });
    if (typeMatch) {
      return (typeMatch['UNIT OR OPERATOR'] || '').trim() || '-';
    }
  }

  // Return first match or best guess
  return (ssrMatches[0]['UNIT OR OPERATOR'] || '').trim() || '-';
}

/**
 * Look up operator from callsign databases
 * @param {string} callsignCode - Full callsign code (e.g., "BAW123", "UAM11")
 * @param {string} acftType - Aircraft type for disambiguation
 * @returns {string} Operator name or '-'
 */
export function lookupOperatorFromCallsign(callsignCode, acftType = '') {
  if (!vkbData.loaded || !callsignCode) return '-';

  // Extract tricode/contraction from callsign (remove flight number)
  const baseCallsign = callsignCode.replace(/\d+$/, '').trim().toUpperCase();

  // First try standard callsigns by TRICODE
  const standardMatch = vkbData.callsignsStandard.find(cs => {
    const tricode = (cs['TRICODE'] || '').toUpperCase().trim();
    return tricode && tricode !== '-' && tricode === baseCallsign;
  });

  if (standardMatch) {
    return (standardMatch['COMPANY/CORPORATE NAME'] || '').trim() || '-';
  }

  // Try nonstandard callsigns by SSR INDICATION
  const ssrMatches = vkbData.callsignsNonstandard.filter(cs => {
    const ssrIndication = (cs['SSR INDICATION'] || '').toUpperCase().trim();
    return ssrIndication && ssrIndication !== '-' && ssrIndication !== 'N/A' && ssrIndication === baseCallsign;
  });

  if (ssrMatches.length === 0) return '-';

  // If multiple matches, try to disambiguate by aircraft type
  if (ssrMatches.length > 1 && acftType) {
    const typeNormalized = acftType.toUpperCase().trim();
    const typeMatch = ssrMatches.find(cs => {
      const csType = (cs['ACFT TYPE'] || '').toUpperCase().trim();
      return csType === typeNormalized;
    });
    if (typeMatch) {
      return (typeMatch['FORCE'] || '').trim() || '-';
    }
  }

  // Return first match or best guess
  return (ssrMatches[0]['FORCE'] || '').trim() || '-';
}

/**
 * Validate squawk code
 * @param {string} squawk - Squawk code to validate (with or without #)
 * @returns {Object} {valid: boolean, errors: string[]}
 */
export function validateSquawkCode(squawk) {
  const errors = [];

  if (!squawk || squawk === '—' || squawk === '-') {
    return { valid: true, errors: [] };
  }

  // Remove # if present for validation
  const code = squawk.replace('#', '').trim();

  // Check if it's exactly 4 digits
  if (!/^\d{4}$/.test(code)) {
    if (code.length < 4) {
      errors.push('Squawk code must be exactly 4 digits (currently too few)');
    } else if (code.length > 4) {
      errors.push('Squawk code must be exactly 4 digits (currently too many)');
    } else {
      errors.push('Squawk code must contain only digits');
    }
  }

  // Check for 8 or 9
  if (/[89]/.test(code)) {
    errors.push('Squawk code cannot contain 8 or 9');
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

// ─── VKB Override Storage ──────────────────────────────────────────────────
//
// The override layer answers "what is the current local VKB value?"
// It sits on top of the bundled CSV baseline and is separate from the audit layer.
// Storage key is included in SESSION_BACKUP_KEYS for backup/restore.
//
// Storage shape (v1):
// {
//   version: 1,
//   updatedAt: "ISO",
//   datasets: {
//     egowCodes:     { "CALLSIGN_BASE|APPROVED_CONTRACTION|FLIGHT_NUMBER": { ... } },
//     registrations: { "CANONICAL_NOREG": { ... } }
//   }
// }

export const VKB_OVERRIDES_KEY = 'vectair_fdms_vkb_overrides_v1';

// ── Canonical key builders ────────────────────────────────────────────────

/**
 * Canonical EGOW key: CALLSIGN_BASE|APPROVED_CONTRACTION|FLIGHT_NUMBER
 * All parts trimmed; APPROVED_CONTRATION is the legacy typo fallback.
 */
function egowVKBKey(row) {
  const base  = (row['CALLSIGN_BASE'] || '').trim();
  const contr = (row['APPROVED_CONTRACTION'] || row['APPROVED_CONTRATION'] || '').trim();
  const flt   = (row['FLIGHT_NUMBER'] || '').trim();
  return `${base}|${contr}|${flt}`;
}

/**
 * Canonical registration key: uppercase, trimmed, hyphens and spaces removed.
 * "G-TEST", "G TEST", "GTEST" all resolve to "GTEST".
 */
function registrationVKBKey(reg) {
  return String(reg || '').toUpperCase().trim().replace(/[-\s]/g, '');
}

// ── Override read / write ─────────────────────────────────────────────────

function _emptyOverrides() {
  return { version: 1, updatedAt: null, datasets: { egowCodes: {}, registrations: {} } };
}

/**
 * Migrate legacy top-level shape { egowCodes, registrations } to
 * new datasets wrapper, re-keying to canonical format.
 * EGOW keys: try to resolve via baseline (requires VKB data loaded);
 *            fall back to old key if baseline not available.
 * Registration keys: always re-keyed to canonical form.
 */
function _migrateOverrides(parsed) {
  const oldEgow = parsed.egowCodes || {};
  const oldReg  = parsed.registrations || {};

  const newReg = {};
  for (const [oldKey, override] of Object.entries(oldReg)) {
    const newKey = registrationVKBKey(oldKey);
    if (newKey) newReg[newKey] = { ...override, key: newKey };
  }

  const newEgow = {};
  for (const [oldKey, override] of Object.entries(oldEgow)) {
    let newKey = oldKey; // safe default — matches for rows with empty contraction
    if (vkbBaselineData.egowCodes.length > 0) {
      // Old key format: CALLSIGN_BASE||FLIGHT_NUMBER (double pipe, no contraction slot)
      const sep = oldKey.indexOf('||');
      if (sep >= 0) {
        const base = oldKey.slice(0, sep);
        const flt  = oldKey.slice(sep + 2);
        const row = vkbBaselineData.egowCodes.find(r =>
          (r['CALLSIGN_BASE'] || '').trim() === base &&
          (r['FLIGHT_NUMBER'] || '').trim() === flt
        );
        if (row) newKey = egowVKBKey(row);
      }
    }
    newEgow[newKey] = { ...override, key: newKey };
  }

  return {
    version: parsed.version || 1,
    updatedAt: null,
    datasets: { egowCodes: newEgow, registrations: newReg }
  };
}

function getVKBOverrides() {
  try {
    const raw = localStorage.getItem(VKB_OVERRIDES_KEY);
    if (!raw) return _emptyOverrides();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return _emptyOverrides();

    // Migrate legacy top-level shape (no datasets wrapper)
    if (!parsed.datasets && (parsed.egowCodes !== undefined || parsed.registrations !== undefined)) {
      const migrated = _migrateOverrides(parsed);
      saveVKBOverrides(migrated);
      return migrated;
    }

    const result = {
      version: parsed.version || 1,
      updatedAt: parsed.updatedAt || null,
      datasets: {
        egowCodes:     parsed.datasets?.egowCodes     || {},
        registrations: parsed.datasets?.registrations || {}
      }
    };

    // Normalise registration override fields saved before this fix was in place.
    // Re-keys to canonical form (e.g. 'n620ha' → 'N620HA') and normalises
    // field values so the table and lookups see correct casing without the user
    // having to re-save every record.
    let regChanged = false;
    const normReg = {};
    for (const [storedKey, ov] of Object.entries(result.datasets.registrations)) {
      if (!ov?.fields) { normReg[storedKey] = ov; continue; }
      const nf = normalizeRegistrationFields(ov.fields);
      const ck = registrationVKBKey(nf['REGISTRATION'] || '') || storedKey;
      if (ck !== storedKey || JSON.stringify(nf) !== JSON.stringify(ov.fields)) {
        normReg[ck] = { ...ov, key: ck, fields: nf };
        regChanged = true;
      } else {
        normReg[storedKey] = ov;
      }
    }
    if (regChanged) {
      result.datasets.registrations = normReg;
      saveVKBOverrides(result);
    }

    return result;
  } catch (_) {
    return _emptyOverrides();
  }
}

function saveVKBOverrides(data) {
  localStorage.setItem(VKB_OVERRIDES_KEY, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }));
}

// ── Baseline + effective helpers ──────────────────────────────────────────

/**
 * Find the immutable bundled row for a given canonical key.
 */
function getBundledRow(datasetName, key) {
  if (datasetName === 'egowCodes') {
    return vkbBaselineData.egowCodes.find(row => egowVKBKey(row) === key) || null;
  }
  if (datasetName === 'registrations') {
    return vkbBaselineData.registrations.find(row => registrationVKBKey(row['REGISTRATION']) === key) || null;
  }
  return null;
}

/**
 * Resolve the current effective row (baseline merged with any override).
 */
function resolveCurrentEffective(datasetName, key) {
  const ov = getVKBOverrides().datasets[datasetName] || {};
  const existing = ov[key];
  const bundled  = getBundledRow(datasetName, key);
  if (!existing)                  return bundled ? { ...bundled } : {};
  if (existing.action === 'add')  return { ...(existing.fields || {}) };
  if (existing.action === 'edit') return bundled ? { ...bundled, ...(existing.fields || {}) } : { ...(existing.fields || {}) };
  return bundled ? { ...bundled } : {};
}

/**
 * Build the effective EGOW codes array (baseline + overrides).
 * Called by lookupEgowAttributionFromCallsign and loadVKBData.
 */
function getEffectiveEgowCodes() {
  if (vkbBaselineData.egowCodes.length === 0) return [];
  const egowOverrides = getVKBOverrides().datasets.egowCodes || {};
  const effective = [];
  for (const row of vkbBaselineData.egowCodes) {
    const key = egowVKBKey(row);
    const ov  = egowOverrides[key];
    if (ov?.action === 'hide') continue;
    effective.push(ov?.action === 'edit' ? { ...row, ...(ov.fields || {}) } : row);
  }
  for (const [, ov] of Object.entries(egowOverrides)) {
    if (ov.action === 'add') effective.push(ov.fields);
  }
  return effective;
}

/**
 * Build the effective registrations array (baseline + overrides).
 * Called by lookupRegistration, searchRegistrations, and loadVKBData.
 */
function getEffectiveRegistrations() {
  const regOverrides = getVKBOverrides().datasets.registrations || {};
  const effective = [];
  for (const row of vkbBaselineData.registrations) {
    const key = registrationVKBKey(row['REGISTRATION']);
    const ov  = regOverrides[key];
    if (ov?.action === 'hide') continue;
    effective.push(ov?.action === 'edit' ? { ...row, ...(ov.fields || {}) } : row);
  }
  // Always include locally-added rows even when baseline CSV is empty
  for (const [, ov] of Object.entries(regOverrides)) {
    if (ov.action === 'add') effective.push(ov.fields);
  }
  return effective;
}

/**
 * Rebuild vkbData.egowCodes and vkbData.registrations to reflect
 * current overrides. Call after any override mutation.
 */
function _rebuildEffectiveArrays() {
  if (!vkbData.loaded) return;
  vkbData.egowCodes    = getEffectiveEgowCodes();
  vkbData.registrations = getEffectiveRegistrations();
}

// ─── VKB Override Mutations ────────────────────────────────────────────────

/**
 * Insert or update a local VKB override for a specific record.
 * fields = full proposed row values from the edit form.
 * Returns the stored override entry, or null if no change was detected.
 */
export function upsertVKBOverride(datasetName, key, fields, note = '', effectiveFrom = new Date().toISOString().slice(0, 10)) {
  // Normalise registration fields at the mutation layer so every caller benefits,
  // regardless of whether the modal save handler has already normalised or not.
  const normFields = datasetName === 'registrations'
    ? normalizeRegistrationFields(fields)
    : { ...fields };

  // For registrations, derive the canonical key from the normalised REGISTRATION
  // so a row saved before normalisation (e.g. key='n620ha') is automatically
  // migrated to its canonical form (key='N620HA').
  let canonicalKey = key;
  if (datasetName === 'registrations') {
    const derivedKey = registrationVKBKey(normFields['REGISTRATION'] || '');
    if (derivedKey) canonicalKey = derivedKey;
  }

  const overrides = getVKBOverrides();
  if (!overrides.datasets[datasetName]) overrides.datasets[datasetName] = {};

  // Remove stale pre-normalisation entry so no duplicate keys remain
  if (canonicalKey !== key && overrides.datasets[datasetName][key]) {
    delete overrides.datasets[datasetName][key];
  }

  const existing = overrides.datasets[datasetName][canonicalKey];
  const bundled  = getBundledRow(datasetName, canonicalKey);
  const action   = (!bundled && (!existing || existing.action === 'add')) ? 'add' : 'edit';

  const currentEffective = resolveCurrentEffective(datasetName, canonicalKey);
  const proposedRow = normFields;

  const auditEvent = auditEntityChange({
    domain: 'vkb',
    dataset: datasetName,
    entityId: canonicalKey,
    label: canonicalKey,
    action: `vkb.${action}`,
    before: action === 'add' ? {} : currentEffective,
    after: proposedRow,
    source: { module: 'admin-vkb-editor', uiAction: 'save-local-override' },
    reason: { code: 'operational-reference-update', note: note || '' },
    effectiveFrom
  });

  if (!auditEvent && action === 'edit') return null;

  let storedFields;
  if (action === 'add') {
    storedFields = { ...proposedRow };
  } else {
    storedFields = {};
    for (const [k, v] of Object.entries(proposedRow)) {
      const bundledVal = bundled ? (bundled[k] ?? '') : '';
      if (String(v ?? '') !== String(bundledVal)) storedFields[k] = v;
    }
    if (Object.keys(storedFields).length === 0) {
      delete overrides.datasets[datasetName][canonicalKey];
      saveVKBOverrides(overrides);
      _rebuildEffectiveArrays();
      return null;
    }
  }

  overrides.datasets[datasetName][canonicalKey] = { action, key: canonicalKey, fields: storedFields, note, updatedAt: new Date().toISOString() };
  saveVKBOverrides(overrides);
  _rebuildEffectiveArrays();
  return overrides.datasets[datasetName][canonicalKey];
}

/**
 * Hide a bundled record or delete a locally-added record.
 * Bundled row → vkb.hide override stored; locally added row → override removed.
 */
export function hideVKBRecord(datasetName, key, note = '', effectiveFrom = new Date().toISOString().slice(0, 10)) {
  const overrides = getVKBOverrides();
  if (!overrides.datasets[datasetName]) overrides.datasets[datasetName] = {};

  const existing        = overrides.datasets[datasetName][key];
  const currentEffective = resolveCurrentEffective(datasetName, key);

  if (existing?.action === 'add') {
    appendAuditEvent({
      effectiveFrom, effectiveTo: null,
      source: { module: 'admin-vkb-editor', uiAction: 'delete-local' },
      entity: { domain: 'vkb', dataset: datasetName, type: 'reference-record', id: key, label: key },
      action: 'vkb.delete-local',
      before: currentEffective, after: {},
      changedFields: Object.keys(currentEffective).filter(k => String(currentEffective[k] ?? '') !== ''),
      reason: { code: 'operational-reference-update', note: note || '' },
      reversible: true
    });
    delete overrides.datasets[datasetName][key];
    saveVKBOverrides(overrides);
    _rebuildEffectiveArrays();
    return { action: 'delete-local' };
  }

  appendAuditEvent({
    effectiveFrom, effectiveTo: null,
    source: { module: 'admin-vkb-editor', uiAction: 'hide' },
    entity: { domain: 'vkb', dataset: datasetName, type: 'reference-record', id: key, label: key },
    action: 'vkb.hide',
    before: currentEffective, after: { _hidden: true },
    changedFields: ['_hidden'],
    reason: { code: 'operational-reference-update', note: note || '' },
    reversible: true
  });

  overrides.datasets[datasetName][key] = { action: 'hide', key, fields: {}, note, updatedAt: new Date().toISOString() };
  saveVKBOverrides(overrides);
  _rebuildEffectiveArrays();
  return overrides.datasets[datasetName][key];
}

/**
 * Remove a local override and revert to the bundled baseline.
 * Audits the change before removing.
 */
export function resetVKBOverride(datasetName, key, effectiveFrom = new Date().toISOString().slice(0, 10)) {
  const overrides = getVKBOverrides();
  if (!overrides.datasets[datasetName]?.[key]) return null;

  const currentEffective = resolveCurrentEffective(datasetName, key);
  const bundled   = getBundledRow(datasetName, key);
  const afterState = bundled ? { ...bundled } : {};

  auditEntityChange({
    domain: 'vkb', dataset: datasetName,
    entityId: key, label: key,
    action: 'vkb.reset',
    before: currentEffective, after: afterState,
    source: { module: 'admin-vkb-editor', uiAction: 'reset-to-baseline' },
    reason: { code: 'operational-reference-update', note: '' },
    effectiveFrom
  });

  delete overrides.datasets[datasetName][key];
  saveVKBOverrides(overrides);
  _rebuildEffectiveArrays();
  return { action: 'reset' };
}

// ─── Live Board VKB Quick-Update Helper ───────────────────────────────────

/**
 * Build a VKB registration update candidate from movement form data.
 * Returns null when no useful VKB update is possible (no reg, no diff,
 * or new registration without the minimum three fields).
 *
 * formData shape:
 *   registration   – normalised registration string (e.g. "G-FPEH")
 *   type           – aircraft type from form (maps to VKB 'TYPE')
 *   egowFlightType – EGOW code from form (maps to VKB 'EGOW FLIGHT TYPE')
 *   warnings       – warnings textarea value (maps to VKB 'WARNINGS')
 *   notes          – remarks textarea value (maps to VKB 'NOTES')
 *
 * Return shape:
 *   { action, registration, key, before, after, changedFields, fieldsToSave }
 *   action       – 'add' (new VKB profile) or 'edit' (update existing)
 *   before/after – display-only diff (only changed fields)
 *   fieldsToSave – full row to pass to upsertVKBOverride
 */
export function buildRegistrationVkbUpdateCandidate(formData) {
  const reg = (formData.registration || '').trim();
  if (!reg) return null;

  const key = registrationVKBKey(reg);
  if (!key) return null;

  const currentRow = lookupRegistration(reg);

  const SUPPORTED_FIELDS = [
    ['REGISTRATION',     formData.registration],
    ['TYPE',             formData.type],
    ['EGOW FLIGHT TYPE', formData.egowFlightType],
    ['WARNINGS',         formData.warnings],
    ['NOTES',            formData.notes],
  ];

  if (!currentRow) {
    // New registration – require the three minimum fields before offering an add
    const proposed = {};
    for (const [field, val] of SUPPORTED_FIELDS) {
      const v = (val || '').trim();
      if (v) proposed[field] = v;
    }
    const MIN_FIELDS = ['REGISTRATION', 'TYPE', 'EGOW FLIGHT TYPE'];
    if (!MIN_FIELDS.every(f => proposed[f])) return null;

    return {
      action: 'add',
      registration: reg,
      key,
      before: {},
      after: proposed,
      changedFields: Object.keys(proposed),
      fieldsToSave: proposed,
    };
  }

  // Existing registration – find fields that differ from the current effective row
  const changedFields = [];
  const beforeDisplay = {};
  const afterDisplay = {};

  for (const [field, formVal] of SUPPORTED_FIELDS) {
    const v = (formVal || '').trim();
    if (!v) continue; // blank form value → don't offer to blank out VKB
    const currentVal = (currentRow[field] || '').trim();
    if (v !== currentVal) {
      changedFields.push(field);
      beforeDisplay[field] = currentVal;
      afterDisplay[field] = v;
    }
  }

  if (changedFields.length === 0) return null;

  // Full row for upsert so the audit event has a complete before/after picture
  const fieldsToSave = { ...currentRow, ...afterDisplay };

  return {
    action: 'edit',
    registration: reg,
    key,
    before: beforeDisplay,
    after: afterDisplay,
    changedFields,
    fieldsToSave,
  };
}

// ─── EGOW Config Store (Movement Codes + Unit Codes) ─────────────────────
//
// Separate from the VKB callsign-attribution CSV/override layer.
// Manages the shorter lists that populate movement form dropdowns and drive validation.
//
// Storage shape (v1):
// {
//   version: 1,
//   updatedAt: "ISO",
//   egowCodes: [{ code, label, active, sortOrder }],
//   unitCodes: [{ code, label, active, sortOrder }]
// }

export const EGOW_CONFIG_KEY = 'vectair_fdms_egow_config_v1';

const _DEFAULT_EGOW_MOVEMENT_CODES = [
  { code: 'VC',  label: 'Visiting Civil',                active: true, sortOrder: 1 },
  { code: 'VM',  label: 'Visiting Military',             active: true, sortOrder: 2 },
  { code: 'BC',  label: 'Based Civil',                   active: true, sortOrder: 3 },
  { code: 'BM',  label: 'Based Military',                active: true, sortOrder: 4 },
  { code: 'VCH', label: 'Visiting Civil Helicopter',     active: true, sortOrder: 5 },
  { code: 'VMH', label: 'Visiting Military Helicopter',  active: true, sortOrder: 6 },
  { code: 'VNH', label: 'Visiting NATO Helicopter',      active: true, sortOrder: 7 },
];

const _DEFAULT_EGOW_UNIT_CODES = [
  { code: 'A', label: '10 AEF',   active: true, sortOrder: 1 },
  { code: 'L', label: 'LUAS',     active: true, sortOrder: 2 },
  { code: 'M', label: 'MASUAS',   active: true, sortOrder: 3 },
];

function _emptyEgowConfig() {
  return {
    version: 1,
    updatedAt: null,
    egowCodes: _DEFAULT_EGOW_MOVEMENT_CODES.map(c => ({ ...c })),
    unitCodes: _DEFAULT_EGOW_UNIT_CODES.map(c => ({ ...c })),
  };
}

function _getEgowConfig() {
  try {
    const raw = localStorage.getItem(EGOW_CONFIG_KEY);
    if (!raw) return _emptyEgowConfig();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return _emptyEgowConfig();
    return {
      version: parsed.version || 1,
      updatedAt: parsed.updatedAt || null,
      egowCodes: Array.isArray(parsed.egowCodes) ? parsed.egowCodes : _DEFAULT_EGOW_MOVEMENT_CODES.map(c => ({ ...c })),
      unitCodes: Array.isArray(parsed.unitCodes) ? parsed.unitCodes : _DEFAULT_EGOW_UNIT_CODES.map(c => ({ ...c })),
    };
  } catch (_) {
    return _emptyEgowConfig();
  }
}

function _saveEgowConfig(data) {
  localStorage.setItem(EGOW_CONFIG_KEY, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }));
}

/**
 * Return the configured EGOW Movement Code list, sorted by sortOrder.
 * @param {boolean} includeInactive - If true, include inactive/hidden codes
 */
export function getEgowMovementCodes(includeInactive = false) {
  const cfg = _getEgowConfig();
  const codes = cfg.egowCodes || [];
  return [...(includeInactive ? codes : codes.filter(c => c.active !== false))]
    .sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99));
}

/**
 * Return the configured EGOW Unit Code list, sorted by sortOrder.
 * @param {boolean} includeInactive - If true, include inactive/hidden codes
 */
export function getEgowUnitCodes(includeInactive = false) {
  const cfg = _getEgowConfig();
  const codes = cfg.unitCodes || [];
  return [...(includeInactive ? codes : codes.filter(c => c.active !== false))]
    .sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99));
}

function _upsertEgowMovementCode(codeObj) {
  const cfg = _getEgowConfig();
  const idx = cfg.egowCodes.findIndex(c => c.code === codeObj.code);
  if (idx >= 0) {
    cfg.egowCodes[idx] = { ...cfg.egowCodes[idx], ...codeObj };
  } else {
    const maxOrder = cfg.egowCodes.reduce((m, c) => Math.max(m, c.sortOrder || 0), 0);
    cfg.egowCodes.push({ active: true, sortOrder: maxOrder + 1, ...codeObj });
  }
  _saveEgowConfig(cfg);
}

function _deactivateEgowMovementCode(code) {
  const cfg = _getEgowConfig();
  const idx = cfg.egowCodes.findIndex(c => c.code === code);
  if (idx >= 0) {
    cfg.egowCodes[idx] = { ...cfg.egowCodes[idx], active: false };
    _saveEgowConfig(cfg);
    return true;
  }
  return false;
}

function _reactivateEgowMovementCode(code) {
  const cfg = _getEgowConfig();
  const idx = cfg.egowCodes.findIndex(c => c.code === code);
  if (idx >= 0) {
    cfg.egowCodes[idx] = { ...cfg.egowCodes[idx], active: true };
    _saveEgowConfig(cfg);
    return true;
  }
  return false;
}

function _upsertEgowUnitCode(codeObj) {
  const cfg = _getEgowConfig();
  const idx = cfg.unitCodes.findIndex(c => c.code === codeObj.code);
  if (idx >= 0) {
    cfg.unitCodes[idx] = { ...cfg.unitCodes[idx], ...codeObj };
  } else {
    const maxOrder = cfg.unitCodes.reduce((m, c) => Math.max(m, c.sortOrder || 0), 0);
    cfg.unitCodes.push({ active: true, sortOrder: maxOrder + 1, ...codeObj });
  }
  _saveEgowConfig(cfg);
}

function _deactivateEgowUnitCode(code) {
  const cfg = _getEgowConfig();
  const idx = cfg.unitCodes.findIndex(c => c.code === code);
  if (idx >= 0) {
    cfg.unitCodes[idx] = { ...cfg.unitCodes[idx], active: false };
    _saveEgowConfig(cfg);
    return true;
  }
  return false;
}

function _reactivateEgowUnitCode(code) {
  const cfg = _getEgowConfig();
  const idx = cfg.unitCodes.findIndex(c => c.code === code);
  if (idx >= 0) {
    cfg.unitCodes[idx] = { ...cfg.unitCodes[idx], active: true };
    _saveEgowConfig(cfg);
    return true;
  }
  return false;
}

// ─── VKB Admin Editor UI ───────────────────────────────────────────────────

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function _flashAdminNotice(msg) {
  const el = document.getElementById('vkbAdminSummary');
  if (!el) return;
  const prev = el.textContent;
  el.textContent = msg;
  el.style.color = '#1a6e2e';
  setTimeout(() => { el.style.color = ''; _renderVkbAdminSummary(); }, 2500);
}

function _renderVkbAdminSummary() {
  const el = document.getElementById('vkbAdminSummary');
  if (!el) return;
  const summary  = getAuditSummary();
  const datasets = getVKBOverrides().datasets;
  const egowCount = Object.keys(datasets.egowCodes     || {}).length;
  const regCount  = Object.keys(datasets.registrations || {}).length;
  const movCodes  = getEgowMovementCodes(true).length;
  const unitCodes = getEgowUnitCodes(true).length;
  el.textContent = `Overrides: ${egowCount} callsign, ${regCount} reg  ·  Codes: ${movCodes} movement, ${unitCodes} unit  ·  Audit: ${summary.totalEvents}`;
}

function _currentAdminDataset() {
  return document.querySelector('.vkb-dataset-tab.active')?.dataset.ds || 'egowCodes';
}

function _refreshVkbAdminTable() {
  const dataset = _currentAdminDataset();
  const search  = (document.getElementById('vkbAdminSearch')?.value || '').toLowerCase().trim();
  if      (dataset === 'egowCodes')          _renderEgowAdminTable(search);
  else if (dataset === 'registrations')      _renderRegAdminTable(search);
  else if (dataset === 'egowMovementCodes')  _renderEgowMovementCodesTable(search);
  else if (dataset === 'egowUnitCodes')      _renderEgowUnitCodesTable(search);
}

function _renderEgowAdminTable(search) {
  const thead = document.getElementById('vkbAdminTableHead');
  const tbody = document.getElementById('vkbAdminTableBody');
  if (!tbody) return;

  if (thead) thead.innerHTML = `<tr>
    <th style="width:68px;">Status</th>
    <th>Callsign Base</th>
    <th>Flt #</th>
    <th>EGOW Code</th>
    <th>Unit Code</th>
    <th>Name</th>
    <th style="width:190px;text-align:right;">Actions</th>
  </tr>`;

  const egowOverrides = getVKBOverrides().datasets.egowCodes || {};
  const allRows = [];

  // Bundled rows with any overrides applied
  for (const row of vkbBaselineData.egowCodes) {
    const key = egowVKBKey(row);
    const ov  = egowOverrides[key];
    let status = 'bundled', effectiveRow = { ...row };
    if (ov?.action === 'hide')       { status = 'hidden'; }
    else if (ov?.action === 'edit')  { status = 'edited'; effectiveRow = { ...row, ...(ov.fields || {}) }; }
    allRows.push({ key, status, effectiveRow });
  }
  // Locally-added rows
  for (const [key, ov] of Object.entries(egowOverrides)) {
    if (ov.action === 'add') allRows.push({ key, status: 'local-add', effectiveRow: ov.fields || {} });
  }

  const filtered = search
    ? allRows.filter(r => Object.values(r.effectiveRow).join(' ').toLowerCase().includes(search) || r.key.toLowerCase().includes(search))
    : allRows;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#999;padding:12px;">No records match the filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(({ key, status, effectiveRow }) => {
    const badge = status === 'hidden'    ? '<span class="vkb-badge vkb-badge-hidden">Hidden</span>'
                : status === 'local-add' ? '<span class="vkb-badge vkb-badge-local">Local</span>'
                : status === 'edited'    ? '<span class="vkb-badge vkb-badge-edited">Edited</span>'
                : '';
    const ek = _esc(key);
    const editBtn  = status !== 'hidden'                           ? `<button class="small-btn" data-va="edit"    data-key="${ek}" data-ds="egowCodes" type="button">Edit</button>`    : '';
    const histBtn  =                                                 `<button class="small-btn" data-va="history" data-key="${ek}" data-ds="egowCodes" type="button">History</button>`;
    const hideBtn  = (status === 'bundled' || status === 'edited') ? `<button class="small-btn" data-va="hide"    data-key="${ek}" data-ds="egowCodes" type="button">Hide</button>`    : '';
    const delBtn   = status === 'local-add'                        ? `<button class="small-btn" data-va="hide"    data-key="${ek}" data-ds="egowCodes" type="button">Delete</button>` : '';
    const resetBtn = (status === 'edited' || status === 'hidden')  ? `<button class="small-btn" data-va="reset"   data-key="${ek}" data-ds="egowCodes" type="button">Reset</button>`   : '';
    return `<tr class="${status === 'hidden' ? 'vkb-row-hidden' : ''}">
      <td>${badge}</td>
      <td>${_esc(effectiveRow['CALLSIGN_BASE'] || '')}</td>
      <td>${_esc(effectiveRow['FLIGHT_NUMBER'] || '')}</td>
      <td>${_esc(effectiveRow['EGOW_CODE'] || effectiveRow['EGOW Code'] || '')}</td>
      <td>${_esc(effectiveRow['UNIT_CODE']  || effectiveRow['UC'] || '')}</td>
      <td>${_esc(effectiveRow['NAME']       || effectiveRow['Name'] || '')}</td>
      <td class="vkb-actions-cell">${editBtn}${histBtn}${hideBtn}${delBtn}${resetBtn}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-va]').forEach(btn => {
    btn.addEventListener('click', () => _handleVkbAction(btn.dataset.va, btn.dataset.ds, btn.dataset.key));
  });
}

function _renderRegAdminTable(search) {
  const thead = document.getElementById('vkbAdminTableHead');
  const tbody = document.getElementById('vkbAdminTableBody');
  if (!tbody) return;

  if (thead) thead.innerHTML = `<tr>
    <th style="width:60px;">Status</th>
    <th>Registration</th>
    <th>Type</th>
    <th>Operator</th>
    <th>Popular Name</th>
    <th>Fixed C/S</th>
    <th>EGOW Flt Type</th>
    <th>Op Type</th>
    <th>Warnings</th>
    <th>Notes</th>
    <th style="width:190px;text-align:right;">Actions</th>
  </tr>`;

  const regOverrides = getVKBOverrides().datasets.registrations || {};
  const allRows = [];

  for (const row of vkbBaselineData.registrations) {
    const key = registrationVKBKey(row['REGISTRATION']);
    const ov  = regOverrides[key];
    let status = 'bundled', effectiveRow = { ...row };
    if (ov?.action === 'hide')      { status = 'hidden'; }
    else if (ov?.action === 'edit') { status = 'edited'; effectiveRow = { ...row, ...(ov.fields || {}) }; }
    allRows.push({ key, status, effectiveRow });
  }
  for (const [key, ov] of Object.entries(regOverrides)) {
    if (ov.action === 'add') allRows.push({ key, status: 'local-add', effectiveRow: ov.fields || {} });
  }

  const filtered = search
    ? allRows.filter(r => Object.values(r.effectiveRow).join(' ').toLowerCase().includes(search) || r.key.toLowerCase().includes(search))
    : allRows;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;color:#999;padding:12px;">No records match the filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(({ key, status, effectiveRow }) => {
    const badge = status === 'hidden'    ? '<span class="vkb-badge vkb-badge-hidden">Hidden</span>'
                : status === 'local-add' ? '<span class="vkb-badge vkb-badge-local">Local</span>'
                : status === 'edited'    ? '<span class="vkb-badge vkb-badge-edited">Edited</span>'
                : '';
    const ek = _esc(key);
    const editBtn  = status !== 'hidden'                           ? `<button class="small-btn" data-va="edit"    data-key="${ek}" data-ds="registrations" type="button">Edit</button>`    : '';
    const histBtn  =                                                 `<button class="small-btn" data-va="history" data-key="${ek}" data-ds="registrations" type="button">History</button>`;
    const hideBtn  = (status === 'bundled' || status === 'edited') ? `<button class="small-btn" data-va="hide"    data-key="${ek}" data-ds="registrations" type="button">Hide</button>`    : '';
    const delBtn   = status === 'local-add'                        ? `<button class="small-btn" data-va="hide"    data-key="${ek}" data-ds="registrations" type="button">Delete</button>` : '';
    const resetBtn = (status === 'edited' || status === 'hidden')  ? `<button class="small-btn" data-va="reset"   data-key="${ek}" data-ds="registrations" type="button">Reset</button>`   : '';
    return `<tr class="${status === 'hidden' ? 'vkb-row-hidden' : ''}">
      <td>${badge}</td>
      <td>${_esc(effectiveRow['REGISTRATION']     || '')}</td>
      <td>${_esc(effectiveRow['TYPE']             || '')}</td>
      <td>${_esc(effectiveRow['OPERATOR']         || '')}</td>
      <td>${_esc(effectiveRow['POPULAR NAME']     || '')}</td>
      <td>${_esc(effectiveRow['FIXED C/S']        || '')}</td>
      <td>${_esc(effectiveRow['EGOW FLIGHT TYPE'] || '')}</td>
      <td>${_esc(effectiveRow['OPERATION TYPE']   || '')}</td>
      <td>${_esc(effectiveRow['WARNINGS']         || '')}</td>
      <td>${_esc(effectiveRow['NOTES']            || '')}</td>
      <td class="vkb-actions-cell">${editBtn}${histBtn}${hideBtn}${delBtn}${resetBtn}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-va]').forEach(btn => {
    btn.addEventListener('click', () => _handleVkbAction(btn.dataset.va, btn.dataset.ds, btn.dataset.key));
  });
}

function _renderEgowMovementCodesTable(search) {
  const thead = document.getElementById('vkbAdminTableHead');
  const tbody = document.getElementById('vkbAdminTableBody');
  if (!tbody) return;

  if (thead) thead.innerHTML = `<tr>
    <th style="width:68px;">Status</th>
    <th>Code</th>
    <th>Description / Label</th>
    <th style="width:80px;">Sort</th>
    <th style="width:170px;text-align:right;">Actions</th>
  </tr>`;

  const all = getEgowMovementCodes(true);
  const filtered = search
    ? all.filter(c => c.code.toLowerCase().includes(search) || (c.label || '').toLowerCase().includes(search))
    : all;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#999;padding:12px;">No EGOW Movement Codes configured.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(c => {
    const active = c.active !== false;
    const badge  = active ? '' : '<span class="vkb-badge vkb-badge-hidden">Hidden</span>';
    const ec = _esc(c.code);
    const editBtn     = `<button class="small-btn" data-emc="edit"       data-code="${ec}" type="button">Edit</button>`;
    const deactBtn    = active ? `<button class="small-btn" data-emc="deactivate" data-code="${ec}" type="button">Hide</button>` : '';
    const reactBtn    = !active ? `<button class="small-btn" data-emc="reactivate" data-code="${ec}" type="button">Restore</button>` : '';
    return `<tr class="${active ? '' : 'vkb-row-hidden'}">
      <td>${badge}</td>
      <td><strong>${ec}</strong></td>
      <td>${_esc(c.label || '')}</td>
      <td>${_esc(String(c.sortOrder ?? ''))}</td>
      <td class="vkb-actions-cell">${editBtn}${deactBtn}${reactBtn}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-emc]').forEach(btn => {
    btn.addEventListener('click', () => _handleEgowMovementCodeAction(btn.dataset.emc, btn.dataset.code));
  });
}

function _renderEgowUnitCodesTable(search) {
  const thead = document.getElementById('vkbAdminTableHead');
  const tbody = document.getElementById('vkbAdminTableBody');
  if (!tbody) return;

  if (thead) thead.innerHTML = `<tr>
    <th style="width:68px;">Status</th>
    <th>Code</th>
    <th>Description / Label</th>
    <th style="width:80px;">Sort</th>
    <th style="width:170px;text-align:right;">Actions</th>
  </tr>`;

  const all = getEgowUnitCodes(true);
  const filtered = search
    ? all.filter(c => c.code.toLowerCase().includes(search) || (c.label || '').toLowerCase().includes(search))
    : all;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#999;padding:12px;">No EGOW Unit Codes configured.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(c => {
    const active = c.active !== false;
    const badge  = active ? '' : '<span class="vkb-badge vkb-badge-hidden">Hidden</span>';
    const ec = _esc(c.code);
    const editBtn     = `<button class="small-btn" data-euc="edit"       data-code="${ec}" type="button">Edit</button>`;
    const deactBtn    = active ? `<button class="small-btn" data-euc="deactivate" data-code="${ec}" type="button">Hide</button>` : '';
    const reactBtn    = !active ? `<button class="small-btn" data-euc="reactivate" data-code="${ec}" type="button">Restore</button>` : '';
    return `<tr class="${active ? '' : 'vkb-row-hidden'}">
      <td>${badge}</td>
      <td><strong>${ec}</strong></td>
      <td>${_esc(c.label || '')}</td>
      <td>${_esc(String(c.sortOrder ?? ''))}</td>
      <td class="vkb-actions-cell">${editBtn}${deactBtn}${reactBtn}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-euc]').forEach(btn => {
    btn.addEventListener('click', () => _handleEgowUnitCodeAction(btn.dataset.euc, btn.dataset.code));
  });
}

function _openEgowCodeEditModal(existingCode) {
  const isNew  = !existingCode;
  const cfg    = _getEgowConfig();
  const current = isNew ? null : cfg.egowCodes.find(c => c.code === existingCode);
  const title  = isNew ? 'Add EGOW Movement Code' : `Edit EGOW Movement Code: ${existingCode}`;

  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.style.zIndex = '3000';
  bd.innerHTML = `<div class="modal" style="max-width:420px;">
    <div class="modal-header">
      <span class="modal-title">${_esc(title)}</span>
      <span class="modal-subtitle">EGOW Movement Codes</span>
    </div>
    <div class="modal-body" style="display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;">
      <div class="modal-field">
        <label class="modal-label" for="_emcCode">Code</label>
        <input type="text" id="_emcCode" class="modal-input" value="${_esc(current?.code || '')}"
          ${!isNew ? 'readonly style="background:#f5f5f5;"' : ''} maxlength="10" style="text-transform:uppercase;" />
      </div>
      <div class="modal-field">
        <label class="modal-label" for="_emcSort">Sort Order</label>
        <input type="number" id="_emcSort" class="modal-input" value="${_esc(String(current?.sortOrder ?? ''))}" min="1" />
      </div>
      <div class="modal-field" style="grid-column:1/-1;">
        <label class="modal-label" for="_emcLabel">Description / Label</label>
        <input type="text" id="_emcLabel" class="modal-input" value="${_esc(current?.label || '')}" />
      </div>
    </div>
    <div id="_emcError" style="color:#c62828;font-size:11px;min-height:16px;margin-top:4px;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
      <button class="btn btn-secondary" id="_emcCancel" type="button">Cancel</button>
      <button class="btn btn-primary"   id="_emcSave"   type="button">Save</button>
    </div>
  </div>`;

  document.body.appendChild(bd);
  const cleanup = () => { if (bd.parentNode) document.body.removeChild(bd); };
  bd.querySelector('#_emcCancel').addEventListener('click', cleanup);
  bd.addEventListener('click', e => { if (e.target === bd) cleanup(); });
  bd.querySelector('#_emcCode').addEventListener('input', function() { this.value = this.value.toUpperCase(); });

  bd.querySelector('#_emcSave').addEventListener('click', () => {
    const code  = (bd.querySelector('#_emcCode')?.value || '').trim().toUpperCase();
    const label = (bd.querySelector('#_emcLabel')?.value || '').trim();
    const sort  = parseInt(bd.querySelector('#_emcSort')?.value || '0', 10) || undefined;
    const errEl = bd.querySelector('#_emcError');

    if (!code) { errEl.textContent = 'Code is required.'; return; }
    if (isNew) {
      const exists = cfg.egowCodes.find(c => c.code === code);
      if (exists) { errEl.textContent = `Code "${code}" already exists.`; return; }
    }

    _upsertEgowMovementCode({ code, label, sortOrder: sort });
    cleanup();
    _refreshVkbAdminTable();
    _flashAdminNotice(`Saved EGOW Movement Code: ${code}`);
  });
}

function _openUnitCodeEditModal(existingCode) {
  const isNew  = !existingCode;
  const cfg    = _getEgowConfig();
  const current = isNew ? null : cfg.unitCodes.find(c => c.code === existingCode);
  const title  = isNew ? 'Add EGOW Unit Code' : `Edit EGOW Unit Code: ${existingCode}`;

  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.style.zIndex = '3000';
  bd.innerHTML = `<div class="modal" style="max-width:420px;">
    <div class="modal-header">
      <span class="modal-title">${_esc(title)}</span>
      <span class="modal-subtitle">EGOW Unit Codes</span>
    </div>
    <div class="modal-body" style="display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;">
      <div class="modal-field">
        <label class="modal-label" for="_eucCode">Code</label>
        <input type="text" id="_eucCode" class="modal-input" value="${_esc(current?.code || '')}"
          ${!isNew ? 'readonly style="background:#f5f5f5;"' : ''} maxlength="10" style="text-transform:uppercase;" />
      </div>
      <div class="modal-field">
        <label class="modal-label" for="_eucSort">Sort Order</label>
        <input type="number" id="_eucSort" class="modal-input" value="${_esc(String(current?.sortOrder ?? ''))}" min="1" />
      </div>
      <div class="modal-field" style="grid-column:1/-1;">
        <label class="modal-label" for="_eucLabel">Description / Label</label>
        <input type="text" id="_eucLabel" class="modal-input" value="${_esc(current?.label || '')}" />
      </div>
    </div>
    <div id="_eucError" style="color:#c62828;font-size:11px;min-height:16px;margin-top:4px;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
      <button class="btn btn-secondary" id="_eucCancel" type="button">Cancel</button>
      <button class="btn btn-primary"   id="_eucSave"   type="button">Save</button>
    </div>
  </div>`;

  document.body.appendChild(bd);
  const cleanup = () => { if (bd.parentNode) document.body.removeChild(bd); };
  bd.querySelector('#_eucCancel').addEventListener('click', cleanup);
  bd.addEventListener('click', e => { if (e.target === bd) cleanup(); });
  bd.querySelector('#_eucCode').addEventListener('input', function() { this.value = this.value.toUpperCase(); });

  bd.querySelector('#_eucSave').addEventListener('click', () => {
    const code  = (bd.querySelector('#_eucCode')?.value || '').trim().toUpperCase();
    const label = (bd.querySelector('#_eucLabel')?.value || '').trim();
    const sort  = parseInt(bd.querySelector('#_eucSort')?.value || '0', 10) || undefined;
    const errEl = bd.querySelector('#_eucError');

    if (!code) { errEl.textContent = 'Code is required.'; return; }
    if (isNew) {
      const exists = cfg.unitCodes.find(c => c.code === code);
      if (exists) { errEl.textContent = `Code "${code}" already exists.`; return; }
    }

    _upsertEgowUnitCode({ code, label, sortOrder: sort });
    cleanup();
    _refreshVkbAdminTable();
    _flashAdminNotice(`Saved EGOW Unit Code: ${code}`);
  });
}

function _handleEgowMovementCodeAction(action, code) {
  if (action === 'edit') {
    _openEgowCodeEditModal(code);
  } else if (action === 'deactivate') {
    _simpleConfirm(`Hide EGOW Movement Code "${code}"?\n\nIt will no longer appear in dropdown lists. Existing movements using this code are not affected.`, () => {
      _deactivateEgowMovementCode(code);
      _refreshVkbAdminTable();
      _flashAdminNotice(`Hidden: ${code}`);
    });
  } else if (action === 'reactivate') {
    _reactivateEgowMovementCode(code);
    _refreshVkbAdminTable();
    _flashAdminNotice(`Restored: ${code}`);
  }
}

function _handleEgowUnitCodeAction(action, code) {
  if (action === 'edit') {
    _openUnitCodeEditModal(code);
  } else if (action === 'deactivate') {
    _simpleConfirm(`Hide EGOW Unit Code "${code}"?\n\nIt will no longer appear in dropdown lists. Existing movements using this code are not affected.`, () => {
      _deactivateEgowUnitCode(code);
      _refreshVkbAdminTable();
      _flashAdminNotice(`Hidden: ${code}`);
    });
  } else if (action === 'reactivate') {
    _reactivateEgowUnitCode(code);
    _refreshVkbAdminTable();
    _flashAdminNotice(`Restored: ${code}`);
  }
}

function _handleVkbAction(action, dataset, key) {
  if (action === 'edit')    _openVkbEditModal(dataset, key);
  else if (action === 'history') _openVkbHistoryModal(dataset, key);
  else if (action === 'hide')    _confirmVkbHide(dataset, key);
  else if (action === 'reset')   _confirmVkbReset(dataset, key);
}

// ─── Registry lookup aid ──────────────────────────────────────────────────────

/**
 * Detect the national register for a registration string.
 * Returns a descriptor object or null for unsupported formats.
 * Only used as a manual lookup aid — does not fetch or populate fields.
 */
function detectAircraftRegistry(registration) {
  const raw = String(registration || '').toUpperCase().trim().replace(/\s+/g, ' ');
  if (!raw) return null;

  // UK G-register: G + optional separator + 1–5 letters
  const ukMatch = raw.match(/^G[-\s]?([A-Z]{1,5})$/);
  if (ukMatch) {
    const token = ukMatch[1];
    return {
      jurisdiction: 'UK',
      label: 'UK CAA G-INFO',
      normalizedRegistration: `G-${token}`,
      lookupToken: token,
      url: 'https://www.caa.co.uk/aircraft-register/g-info/search-g-info/'
    };
  }

  // US N-register: N + optional separator + digits then alphanumeric
  const usMatch = raw.match(/^N[-\s]?([0-9][A-Z0-9]{0,5})$/);
  if (usMatch) {
    const token = usMatch[1];
    return {
      jurisdiction: 'US',
      label: 'FAA Registry',
      normalizedRegistration: `N${token}`,
      lookupToken: token,
      url: 'https://registry.faa.gov/aircraftinquiry/Search/NNumberInquiry'
    };
  }

  return null;
}

/**
 * Normalise registration record fields before saving to overrides.
 * Applies canonical casing and formatting so stored/displayed values
 * are consistent with the bundled VKB dataset style.
 */
function normalizeRegistrationFields(fields) {
  const out = { ...fields };

  // REGISTRATION: use detectAircraftRegistry for canonical form (G-TEST, N73ST);
  // otherwise uppercase + trim + collapse spaces (no hyphen added for unknown formats).
  if (out['REGISTRATION'] !== undefined) {
    const info = detectAircraftRegistry(out['REGISTRATION']);
    if (info) {
      out['REGISTRATION'] = info.normalizedRegistration;
    } else {
      out['REGISTRATION'] = String(out['REGISTRATION'] || '').toUpperCase().trim().replace(/\s+/g, '');
    }
  }

  // Uppercase operational fields that must match VKB dataset conventions
  for (const f of ['TYPE', 'EGOW FLIGHT TYPE', 'FIXED C/S', 'OPERATION TYPE', 'OPERATOR', 'WARNINGS']) {
    if (out[f] !== undefined) out[f] = String(out[f] || '').toUpperCase().trim();
  }

  // Preserve-case fields — trim only
  for (const f of ['POPULAR NAME', 'NOTES']) {
    if (out[f] !== undefined) out[f] = String(out[f] || '').trim();
  }

  return out;
}

function _clipboardFallback(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* ignore */ }
  document.body.removeChild(ta);
}

function _copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => _clipboardFallback(text));
  } else {
    _clipboardFallback(text);
  }
}

function _updateVkbRegistryAid(value, aidEl) {
  if (!aidEl) return;
  const info = detectAircraftRegistry(value);
  if (!info) {
    aidEl.innerHTML = value.trim()
      ? `<span class="vkb-reg-aid-none">No supported registry detected.</span>`
      : '';
    return;
  }
  aidEl.innerHTML = `
    <div class="vkb-reg-aid">
      <span class="vkb-reg-aid-label">${_esc(info.label)}</span>
      <span class="vkb-reg-aid-token">Token: <strong>${_esc(info.lookupToken)}</strong></span>
      <button class="small-btn" id="_vkbRegCopy" type="button">Copy token</button>
      <button class="small-btn" id="_vkbRegOpen" type="button">Open registry ↗</button>
    </div>`;
  aidEl.querySelector('#_vkbRegCopy')?.addEventListener('click', () => _copyToClipboard(info.lookupToken));
  aidEl.querySelector('#_vkbRegOpen')?.addEventListener('click', () => window.open(info.url, '_blank', 'noopener'));
}

function _simpleConfirm(message, onConfirm) {
  const bd = document.createElement('div');
  bd.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:3000;display:flex;align-items:center;justify-content:center;';
  const dlg = document.createElement('div');
  dlg.style.cssText = 'background:#fff;border-radius:6px;padding:20px 24px 16px;max-width:420px;width:90%;box-shadow:0 4px 24px rgba(0,0,0,0.25);';
  const msgEl = document.createElement('div');
  msgEl.style.cssText = 'font-size:13px;line-height:1.5;margin-bottom:16px;white-space:pre-wrap;';
  msgEl.textContent = message;
  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
  btns.innerHTML = '<button class="btn btn-secondary" type="button">Cancel</button><button class="btn btn-danger" type="button">Confirm</button>';
  dlg.appendChild(msgEl);
  dlg.appendChild(btns);
  bd.appendChild(dlg);
  document.body.appendChild(bd);
  const cleanup = () => { if (bd.parentNode) document.body.removeChild(bd); };
  btns.children[0].addEventListener('click', cleanup);
  btns.children[1].addEventListener('click', () => { cleanup(); onConfirm(); });
  bd.addEventListener('click', e => { if (e.target === bd) cleanup(); });
}

function _confirmVkbHide(dataset, key) {
  const ov = getVKBOverrides().datasets[dataset] || {};
  const isLocalAdd = ov[key]?.action === 'add';
  const label = isLocalAdd ? 'Delete this locally-added record' : 'Hide this record from lookups';
  _simpleConfirm(`${label}?\n\n"${key}"`, () => {
    hideVKBRecord(dataset, key, '', _todayISO());
    _renderVkbAdminSummary();
    _refreshVkbAdminTable();
  });
}

function _confirmVkbReset(dataset, key) {
  _simpleConfirm(`Reset "${key}" back to the bundled baseline? Your local override will be removed.`, () => {
    resetVKBOverride(dataset, key, _todayISO());
    _renderVkbAdminSummary();
    _refreshVkbAdminTable();
  });
}

function _openVkbHistoryModal(dataset, key) {
  const events = getAuditEventsForEntity('vkb', key);

  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.style.zIndex = '3000';

  let rows = '';
  if (!events.length) {
    rows = '<tr><td colspan="5" style="text-align:center;color:#999;padding:12px;">No audit events recorded for this record.</td></tr>';
  } else {
    rows = [...events].reverse().map(ev => {
      const changedAt = ev.changedAt ? new Date(ev.changedAt).toLocaleString() : '—';
      const act    = _esc(ev.action || '—');
      const fields = Array.isArray(ev.changedFields) ? _esc(ev.changedFields.join(', ')) : '—';
      const note   = _esc(ev.reason?.note || '');
      return `<tr>
        <td>${_esc(changedAt)}</td>
        <td>${_esc(ev.effectiveFrom || '—')}</td>
        <td><strong>${act}</strong></td>
        <td style="font-size:11px;">${fields}</td>
        <td style="font-size:11px;color:#555;">${note}</td>
      </tr>`;
    }).join('');
  }

  bd.innerHTML = `<div class="modal" style="max-width:720px;">
    <div class="modal-header">
      <span class="modal-title">Audit History</span>
      <span class="modal-subtitle">${_esc(dataset)} / ${_esc(key)}</span>
    </div>
    <div style="max-height:360px;overflow-y:auto;">
      <table style="width:100%;font-size:12px;border-collapse:collapse;">
        <thead><tr style="background:#f0f0f0;">
          <th style="padding:6px;text-align:left;">Changed At</th>
          <th style="padding:6px;text-align:left;">Effective From</th>
          <th style="padding:6px;text-align:left;">Action</th>
          <th style="padding:6px;text-align:left;">Changed Fields</th>
          <th style="padding:6px;text-align:left;">Note</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px;">
      <button class="btn btn-secondary" id="_vhClose" type="button">Close</button>
    </div>
  </div>`;

  document.body.appendChild(bd);
  const cleanup = () => { if (bd.parentNode) document.body.removeChild(bd); };
  bd.querySelector('#_vhClose').addEventListener('click', cleanup);
  bd.addEventListener('click', e => { if (e.target === bd) cleanup(); });
}

function _openVkbEditModal(dataset, key) {
  const overrides = getVKBOverrides();
  const existing  = overrides.datasets[dataset]?.[key];
  const bundled   = key ? getBundledRow(dataset, key) : null;
  const isNew     = !key;
  const current   = isNew ? {} : resolveCurrentEffective(dataset, key);

  const egowFields = [
    { id: 'CALLSIGN_BASE',        label: 'Callsign Base',        readonly: !isNew && !!bundled },
    { id: 'APPROVED_CONTRACTION', label: 'Approved Contraction', readonly: false },
    { id: 'FLIGHT_NUMBER',        label: 'Flight Number',        readonly: !isNew && !!bundled },
    { id: 'EGOW_CODE',            label: 'EGOW Code',            readonly: false },
    { id: 'UNIT',                 label: 'Unit',                 readonly: false },
    { id: 'UNIT_CODE',            label: 'Unit Code',            readonly: false },
    { id: 'NAME',                 label: 'Name',                 readonly: false },
    { id: 'POSITION',             label: 'Position',             readonly: false },
    { id: 'NOTES',                label: 'Notes',                readonly: false },
  ];
  const regFields = [
    { id: 'REGISTRATION',     label: 'Registration',     readonly: !isNew && !!bundled },
    { id: 'TYPE',             label: 'Type',             readonly: false },
    { id: 'OPERATOR',         label: 'Operator',         readonly: false },
    { id: 'POPULAR NAME',     label: 'Popular Name',     readonly: false },
    { id: 'EGOW FLIGHT TYPE', label: 'EGOW Flight Type', readonly: false },
    { id: 'OPERATION TYPE',   label: 'Operation Type',   readonly: false },
    { id: 'FIXED C/S',        label: 'Fixed C/S',        readonly: false },
    { id: 'WARNINGS',         label: 'Warnings',         readonly: false },
    { id: 'NOTES',            label: 'Notes',            readonly: false },
  ];

  const fieldDefs = dataset === 'egowCodes' ? egowFields : regFields;
  const safeId = id => 'vkbEd_' + id.replace(/[^a-zA-Z0-9_]/g, '_');

  const fieldsHtml = fieldDefs.map(f => `
    <div class="modal-field">
      <label class="modal-label" for="${safeId(f.id)}">${_esc(f.label)}</label>
      <input type="text" id="${safeId(f.id)}" class="modal-input"
        value="${_esc(current[f.id] || '')}"
        ${f.readonly ? 'readonly style="background:#f5f5f5;"' : ''} />
    </div>`).join('');

  const title = isNew
    ? `Add ${dataset === 'egowCodes' ? 'EGOW Code Row' : 'Registration'}`
    : `Edit ${key}`;

  const regAidHtml = dataset === 'registrations'
    ? `<div id="vkbRegAid" class="vkb-reg-aid-container"></div>`
    : '';

  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.style.zIndex = '3000';
  bd.innerHTML = `<div class="modal" style="max-width:540px;">
    <div class="modal-header">
      <span class="modal-title">${_esc(title)}</span>
      <span class="modal-subtitle">${_esc(dataset === 'egowCodes' ? 'EGOW Codes' : 'Registrations')}</span>
    </div>
    <div class="modal-body" style="display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;">
      ${fieldsHtml}
      <div class="modal-field">
        <label class="modal-label" for="vkbEditEffectiveFrom">Effective From</label>
        <input type="date" id="vkbEditEffectiveFrom" class="modal-input" value="${_todayISO()}" />
      </div>
      <div class="modal-field">
        <label class="modal-label" for="vkbEditNote">Reason Note</label>
        <input type="text" id="vkbEditNote" class="modal-input" placeholder="Optional reason…" />
      </div>
    </div>
    ${regAidHtml}
    <div id="vkbEditError" style="color:#c62828;font-size:11px;min-height:16px;margin-top:4px;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
      <button class="btn btn-secondary" id="_veCancel" type="button">Cancel</button>
      <button class="btn btn-primary"   id="_veSave"   type="button">Save</button>
    </div>
  </div>`;

  document.body.appendChild(bd);
  const cleanup = () => { if (bd.parentNode) document.body.removeChild(bd); };
  bd.querySelector('#_veCancel').addEventListener('click', cleanup);
  bd.addEventListener('click', e => { if (e.target === bd) cleanup(); });

  if (dataset === 'registrations') {
    const regInput = bd.querySelector('#vkbEd_REGISTRATION');
    const aidEl    = bd.querySelector('#vkbRegAid');
    _updateVkbRegistryAid(regInput?.value || '', aidEl);
    regInput?.addEventListener('input', () => _updateVkbRegistryAid(regInput.value, aidEl));
  }

  bd.querySelector('#_veSave').addEventListener('click', () => {
    const formFields = {};
    for (const f of fieldDefs) {
      const input = bd.querySelector(`#${safeId(f.id)}`);
      if (input) formFields[f.id] = input.value.trim();
    }

    const effectiveFrom = bd.querySelector('#vkbEditEffectiveFrom')?.value || _todayISO();
    const note = bd.querySelector('#vkbEditNote')?.value?.trim() || '';

    // Normalise registration fields before save
    const savedFields = dataset === 'registrations'
      ? normalizeRegistrationFields(formFields)
      : formFields;

    // Build canonical key from (normalised) form fields for new rows
    let editKey;
    if (key) {
      editKey = key; // editing existing row — key is already canonical
    } else if (dataset === 'egowCodes') {
      editKey = egowVKBKey(savedFields);
    } else {
      editKey = registrationVKBKey(savedFields['REGISTRATION'] || '');
    }

    if (!editKey || editKey === '||') {
      bd.querySelector('#vkbEditError').textContent = 'Key field(s) required.';
      return;
    }

    const result = upsertVKBOverride(dataset, editKey, savedFields, note, effectiveFrom);
    cleanup();
    _renderVkbAdminSummary();
    _refreshVkbAdminTable();
    _flashAdminNotice(result ? `Saved — ${editKey}` : 'No changes detected.');
  });
}

/**
 * Initialise the Admin → VKB / Reference Data section.
 * Call once from app.js bootstrap after VKB data is loaded.
 */
export function initVkbAdmin() {
  const tabBtns     = document.querySelectorAll('.vkb-dataset-tab');
  const searchInput = document.getElementById('vkbAdminSearch');
  const addBtn      = document.getElementById('vkbAdminAddRow');
  if (!tabBtns.length) return;

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _refreshVkbAdminTable();
    });
  });
  searchInput?.addEventListener('input', _refreshVkbAdminTable);
  addBtn?.addEventListener('click', () => {
    const ds = _currentAdminDataset();
    if      (ds === 'egowMovementCodes') _openEgowCodeEditModal(null);
    else if (ds === 'egowUnitCodes')     _openUnitCodeEditModal(null);
    else                                 _openVkbEditModal(ds, null);
  });

  _renderVkbAdminSummary();
  _refreshVkbAdminTable();
}

/**
 * Refresh the VKB admin summary line and table (e.g. after an external restore).
 * Also rebuilds the effective vkbData arrays so lookups stay current.
 */
export function refreshVkbAdminDisplay() {
  _rebuildEffectiveArrays();
  _renderVkbAdminSummary();
  _refreshVkbAdminTable();
}

/**
 * Refresh EGOW config admin tables after an external backup restore.
 * Call alongside refreshVkbAdminDisplay when restoring session data.
 */
export function refreshEgowConfigDisplay() {
  _refreshVkbAdminTable();
}

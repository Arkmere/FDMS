// vkb.js
// Vectair Knowledge Base - CSV data loading and management

/**
 * VKB Data Store
 * Holds all loaded CSV data in memory for fast lookups and autocomplete
 */
const vkbData = {
  aircraftTypes: [],
  callsignsStandard: [],
  callsignsNonstandard: [],
  locations: [],
  registrations: [],
  egowCodes: [],
  callsignKey: [],
  loaded: false,
  loadError: null
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
      callsignKey
    ] = await Promise.all([
      loadCSV('./data/FDMS_AIRCRAFT_TYPES.csv'),
      loadCSV('./data/FDMS_CALLSIGNS_STANDARD.csv'),
      loadCSV('./data/FDMS_CALLSIGNS_NONSTANDARD CALLSIGNS.csv'),
      loadCSV('./data/FDMS_LOCATIONS_B_E_L.csv'),
      loadCSV('./data/FDMS_REGISTRATIONS.csv'),
      loadCSV('./data/FDMS_EGOW_CODES.csv'),
      loadCSV('./data/CALLSIGN_KEY.csv')
    ]);

    vkbData.aircraftTypes = aircraftTypes;
    vkbData.callsignsStandard = callsignsStandard;
    vkbData.callsignsNonstandard = callsignsNonstandard;
    vkbData.locations = locations;
    vkbData.registrations = registrations;
    vkbData.egowCodes = egowCodes;
    vkbData.callsignKey = callsignKey;
    vkbData.loaded = true;
    vkbData.loadError = null;

    const endTime = performance.now();
    const loadTime = (endTime - startTime).toFixed(0);

    console.log(`VKB: Loaded ${aircraftTypes.length} aircraft types`);
    console.log(`VKB: Loaded ${callsignsStandard.length} standard callsigns`);
    console.log(`VKB: Loaded ${callsignsNonstandard.length} nonstandard callsigns`);
    console.log(`VKB: Loaded ${locations.length} locations`);
    console.log(`VKB: Loaded ${registrations.length} registrations`);
    console.log(`VKB: Loaded ${egowCodes.length} EGOW codes`);
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
      egowCodes: vkbData.egowCodes.length
    }
  };
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

  const q = query.toLowerCase().trim().replace(/-/g, ''); // Remove dashes from query
  if (!q) return vkbData.registrations.slice(0, limit);

  return vkbData.registrations
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

  const normalized = registration.toUpperCase().trim().replace(/-/g, '');

  return vkbData.registrations.find(reg => {
    const regNormalized = (reg['REGISTRATION'] || '').toUpperCase().replace(/-/g, '');
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

  return vkbData.registrations.find(reg => {
    const fixedCs = (reg['FIXED C/S'] || '').toUpperCase().trim();
    return fixedCs && fixedCs !== '-' && fixedCs === normalized;
  }) || null;
}

/**
 * Look up a callsign in the VKB database
 * @param {string} callsign - Callsign to look up
 * @returns {Object|null} Callsign data or null if not found
 */
export function lookupCallsign(callsign) {
  if (!vkbData.loaded || !callsign) return null;

  const normalized = callsign.toUpperCase().trim();

  // First check EGOW codes (for unit code lookup)
  const egowResult = vkbData.egowCodes.find(ec =>
    (ec['Callsign'] || '').toUpperCase() === normalized
  );

  if (egowResult) {
    return egowResult;
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

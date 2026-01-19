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
 * Get Wake Turbulence Category for an aircraft type and movement
 * @param {string} icaoType - ICAO Type Designator (e.g., "A400")
 * @param {string} flightType - Flight type: DEP, ARR, LOC, OVR
 * @param {string} wtcStandard - WTC standard to use: "ICAO" or "UK" (default "UK")
 * @returns {string} WTC string (e.g., "H (UK)" or "M (ICAO)")
 */
export function getWTC(icaoType, flightType, wtcStandard = "UK") {
  const typeData = lookupAircraftType(icaoType);
  if (!typeData) return "L (ICAO)"; // Default fallback

  let wtc = "";

  if (wtcStandard === "UK") {
    // Use UK Departure WTC for DEP and OVR
    // Use UK Arrival WTC for ARR and LOC
    if (flightType === "DEP" || flightType === "OVR") {
      wtc = typeData['UK Departure WTC'] || typeData['ICAO WTC'] || "L";
    } else {
      wtc = typeData['UK Arrival WTC'] || typeData['ICAO WTC'] || "L";
    }
    return `${wtc} (UK)`;
  } else {
    // Use ICAO WTC
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
 * @param {string} callsignCode - Full callsign code (e.g., "UAM11")
 * @returns {string} Captain name or empty string
 */
export function lookupCaptainFromEgowCodes(callsignCode) {
  if (!vkbData.loaded || !callsignCode) return '';

  const normalized = callsignCode.toUpperCase().trim();
  const egowRecord = vkbData.egowCodes.find(ec =>
    (ec['Callsign'] || '').toUpperCase().trim() === normalized
  );

  return egowRecord ? (egowRecord['Name'] || '').trim() : '';
}

/**
 * Look up unit code from EGOW codes
 * @param {string} callsignCode - Full callsign code (e.g., "UAM11")
 * @returns {string} Unit code (L, M, A) or empty string
 */
export function lookupUnitCodeFromEgowCodes(callsignCode) {
  if (!vkbData.loaded || !callsignCode) return '';

  const normalized = callsignCode.toUpperCase().trim();
  const egowRecord = vkbData.egowCodes.find(ec =>
    (ec['Callsign'] || '').toUpperCase().trim() === normalized
  );

  return egowRecord ? (egowRecord['UC'] || '').trim() : '';
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

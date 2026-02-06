// ui_booking.js
// Handles the Booking page: form, charges calculation, strip preview, and submission.
// Also handles Calendar page functionality.
// ES module, no framework, DOM-contract driven.

import {
  createMovement,
  updateMovement,
  getMovements,
  getConfig
} from "./datamodel.js";

import { showToast } from "./app.js";

import { clearStripLinks } from "./services/bookingSync.js";

import * as bookingsStore from "./stores/bookingsStore.js";

// VKB imports for autofill functionality
import {
  lookupRegistration,
  lookupAircraftType,
  getLocationName
} from "./vkb.js";

/* -----------------------------
   Storage for Bookings
------------------------------ */

const CALENDAR_EVENTS_STORAGE_KEY = "vectair_fdms_calendar_events_v1";
const BOOKING_PROFILES_STORAGE_KEY = "fdms_booking_profiles_v1";

// Calendar events storage
let calendarEvents = [];
let calendarEventsInitialised = false;
let nextCalendarEventId = 1;

/* -----------------------------
   Booking Profiles Storage
   Saves contact/aircraft info per registration for repeat visitors
   Precedence: saved profile > VKB registrations DB
------------------------------ */

let bookingProfiles = {};
let bookingProfilesInitialised = false;

/**
 * Normalize registration for profile lookup
 * Uppercase, trim, remove spaces/hyphens
 * @param {string} reg - Registration string
 * @returns {string} Normalized registration
 */
function normalizeRegistration(reg) {
  if (!reg) return '';
  return reg.toUpperCase().trim().replace(/[-\s]/g, '');
}

/**
 * Load booking profiles from localStorage
 */
function loadBookingProfiles() {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const raw = window.localStorage.getItem(BOOKING_PROFILES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.profiles && typeof parsed.profiles === 'object') {
        bookingProfiles = parsed.profiles;
      }
    }
  } catch (e) {
    console.warn("FDMS Booking: failed to load profiles from storage", e);
  }
  bookingProfilesInitialised = true;
}

/**
 * Save booking profiles to localStorage
 */
function saveBookingProfiles() {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const payload = JSON.stringify({
      schema_version: 1,
      timestamp: new Date().toISOString(),
      profiles: bookingProfiles
    });
    window.localStorage.setItem(BOOKING_PROFILES_STORAGE_KEY, payload);
  } catch (e) {
    console.warn("FDMS Booking: failed to save profiles to storage", e);
  }
}

/**
 * Ensure profiles are initialized
 */
function ensureProfilesInitialised() {
  if (bookingProfilesInitialised) return;
  loadBookingProfiles();
}

/**
 * Get a booking profile by registration
 * @param {string} reg - Registration
 * @returns {Object|null} Profile data or null
 */
export function getBookingProfile(reg) {
  ensureProfilesInitialised();
  const normalized = normalizeRegistration(reg);
  return bookingProfiles[normalized] || null;
}

/**
 * Save a booking profile for a registration
 * @param {string} reg - Registration
 * @param {Object} profileData - Profile fields to save
 */
export function saveBookingProfile(reg, profileData) {
  ensureProfilesInitialised();
  const normalized = normalizeRegistration(reg);
  bookingProfiles[normalized] = {
    ...profileData,
    registration_display: reg.toUpperCase().trim(),
    last_saved: new Date().toISOString(),
    schema_version: 1
  };
  saveBookingProfiles();
}

/**
 * Delete a booking profile
 * @param {string} reg - Registration
 */
export function deleteBookingProfile(reg) {
  ensureProfilesInitialised();
  const normalized = normalizeRegistration(reg);
  if (bookingProfiles[normalized]) {
    delete bookingProfiles[normalized];
    saveBookingProfiles();
    return true;
  }
  return false;
}

/**
 * Get all booking profiles
 * @returns {Object} All profiles keyed by normalized registration
 */
export function getAllBookingProfiles() {
  ensureProfilesInitialised();
  return { ...bookingProfiles };
}

/**
 * Import booking profiles from JSON data (merges with existing, import wins on conflict)
 * @param {Object} importData - Imported JSON data
 * @returns {Object} Result with counts
 */
export function importBookingProfiles(importData) {
  ensureProfilesInitialised();
  let imported = 0;
  let skipped = 0;

  try {
    const profiles = importData.profiles || importData;
    if (typeof profiles !== 'object') {
      throw new Error('Invalid import format');
    }

    for (const [key, profile] of Object.entries(profiles)) {
      if (profile && typeof profile === 'object') {
        const normalized = normalizeRegistration(key);
        bookingProfiles[normalized] = {
          ...profile,
          last_saved: profile.last_saved || new Date().toISOString(),
          schema_version: profile.schema_version || 1
        };
        imported++;
      } else {
        skipped++;
      }
    }

    saveBookingProfiles();
    return { success: true, imported, skipped };
  } catch (e) {
    console.error("Failed to import profiles:", e);
    return { success: false, error: e.message, imported: 0, skipped: 0 };
  }
}

/**
 * Export all booking profiles as JSON
 * @returns {string} JSON string of all profiles
 */
export function exportBookingProfiles() {
  ensureProfilesInitialised();
  return JSON.stringify({
    schema_version: 1,
    exported_at: new Date().toISOString(),
    profiles: bookingProfiles
  }, null, 2);
}

/* -----------------------------
   Autofill State Tracking
   Tracks last autofilled values to prevent stomping user edits
------------------------------ */

const autofillState = {
  // Field ID -> { value: lastAutofilledValue, source: 'profile'|'vkb' }
  lastAutofill: {}
};

/**
 * Set autofill value for a field and track it
 * @param {HTMLElement} field - Input element
 * @param {string} value - Value to set
 * @param {string} source - Source of value ('profile' or 'vkb')
 */
function setAutofillValue(field, value, source) {
  if (!field) return;
  const currentValue = field.value.trim();
  const lastAutofill = autofillState.lastAutofill[field.id];

  // Anti-stomp: Only autofill if field is empty OR still shows previous autofill
  if (!currentValue || (lastAutofill && currentValue === lastAutofill.value)) {
    field.value = value;
    autofillState.lastAutofill[field.id] = { value, source };
    field.dataset.autofillValue = value;
    field.dataset.autofillSource = source;
  }
}

/**
 * Clear autofill tracking for a field
 * @param {string} fieldId - Field ID to clear
 */
function clearAutofillTracking(fieldId) {
  delete autofillState.lastAutofill[fieldId];
  const field = byId(fieldId);
  if (field) {
    delete field.dataset.autofillValue;
    delete field.dataset.autofillSource;
  }
}

/**
 * Check if a field was user-edited (value differs from last autofill)
 * @param {HTMLElement} field - Input element
 * @returns {boolean} True if user edited the field
 */
function isFieldUserEdited(field) {
  if (!field) return false;
  const currentValue = field.value.trim();
  const lastAutofill = autofillState.lastAutofill[field.id];

  // If no autofill tracking, and field has value, treat as user-edited
  if (!lastAutofill) return currentValue !== '';

  // User edited if current value differs from last autofill
  return currentValue !== lastAutofill.value;
}

// Bookings now delegated to bookingsStore

/* -----------------------------
   Storage for Calendar Events
------------------------------ */

function loadCalendarEventsFromStorage() {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(CALENDAR_EVENTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.events)) {
        return parsed;
      }
    }
    return null;
  } catch (e) {
    console.warn("FDMS: failed to load calendar events from storage", e);
    return null;
  }
}

function saveCalendarEventsToStorage() {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const payload = JSON.stringify({
      version: 1,
      timestamp: new Date().toISOString(),
      events: calendarEvents
    });
    window.localStorage.setItem(CALENDAR_EVENTS_STORAGE_KEY, payload);
  } catch (e) {
    console.warn("FDMS: failed to save calendar events to storage", e);
  }
}

function ensureCalendarEventsInitialised() {
  if (calendarEventsInitialised) return;
  const loaded = loadCalendarEventsFromStorage();
  if (loaded && loaded.events) {
    calendarEvents = loaded.events;
    nextCalendarEventId = calendarEvents.reduce((max, e) => Math.max(max, e.id || 0), 0) + 1;
  } else {
    calendarEvents = [];
    nextCalendarEventId = 1;
  }
  calendarEventsInitialised = true;
}

export function getCalendarEvents() {
  ensureCalendarEventsInitialised();
  return calendarEvents;
}

export function getCalendarEventsForDate(dateStr) {
  ensureCalendarEventsInitialised();
  return calendarEvents.filter(e => e.date === dateStr);
}

export function createCalendarEvent(eventData) {
  ensureCalendarEventsInitialised();
  const now = new Date().toISOString();
  const event = {
    id: nextCalendarEventId++,
    createdAt: now,
    updatedAt: now,
    date: eventData.date || '',
    endDate: eventData.endDate || eventData.date || '',
    time: eventData.time || '',
    endTime: eventData.endTime || '',
    title: eventData.title || '',
    description: eventData.description || '',
    type: eventData.type || 'general',
    allDay: eventData.allDay || false,
    repeat: eventData.repeat || 'none',
    repeatEndDate: eventData.repeatEndDate || '',
    notification: eventData.notification || 'none'
  };
  calendarEvents.push(event);
  saveCalendarEventsToStorage();
  return event;
}

export function deleteCalendarEvent(id) {
  ensureCalendarEventsInitialised();
  const index = calendarEvents.findIndex(e => e.id === id);
  if (index !== -1) {
    calendarEvents.splice(index, 1);
    saveCalendarEventsToStorage();
    return true;
  }
  return false;
}

export function updateCalendarEvent(id, patch) {
  ensureCalendarEventsInitialised();
  const event = calendarEvents.find(e => e.id === id);
  if (!event) return null;
  Object.assign(event, patch);
  event.updatedAt = new Date().toISOString();
  saveCalendarEventsToStorage();
  return event;
}

export function updateBooking(bookingId, patch) {
  return bookingsStore.updateBookingById(bookingId, patch);
}

export function deleteBooking(bookingId) {
  return bookingsStore.deleteBookingById(bookingId);
}

export function getBookings() {
  return bookingsStore.loadBookings();
}

export function getBookingById(id) {
  return bookingsStore.getBookingById(id);
}

export function createBooking(bookingData) {
  return bookingsStore.createBooking(bookingData);
}

/* -----------------------------
   Charges Calculator

   Landing fees:
   - £12 per metric tonne up to 4 tonnes or part thereof
   - Over 4 tonnes: £16 per tonne or part thereof for the excess
   - Total landing fees = per-landing fee × number_of_landings
   - Training rate: if training flag checked, total = 25% of computed landing total

   Parking fees:
   - First 2 hours free
   - After 2 hours: flat fee of £16.67 + 20% VAT per 24h period (or part thereof)
   - Periods = CEILING((stay_hours - 2)/24), minimum 1 if stay_hours > 2

   CUIW (Civil User Indemnity Waiver):
   - If aircraft does NOT have CUIW, a fee is charged
   - Default: £25 per visit (configurable)
------------------------------ */

const LANDING_RATE_PER_TONNE_UP_TO_4 = 12.00;
const LANDING_RATE_PER_TONNE_OVER_4 = 16.00;
const PARKING_NET_PER_24H = 16.67;
const PARKING_VAT_RATE = 0.20;
const TRAINING_DISCOUNT = 0.25;
const CUIW_FEE = 25.00; // Fee when aircraft does not have CUIW

/**
 * Calculate landing fee for a single landing based on MTOW
 * @param {number} mtowTonnes - MTOW in metric tonnes
 * @returns {number} Landing fee in GBP
 */
export function calculateLandingFeePerLanding(mtowTonnes) {
  if (!mtowTonnes || mtowTonnes <= 0) return 0;

  const tonnes = Math.max(0, mtowTonnes);

  if (tonnes <= 4) {
    // £12 per tonne or part thereof up to 4t
    return Math.ceil(tonnes) * LANDING_RATE_PER_TONNE_UP_TO_4;
  } else {
    // First 4t at £12/t = £48
    // Excess at £16/t (ceiled)
    const baseFee = 4 * LANDING_RATE_PER_TONNE_UP_TO_4;
    const excess = tonnes - 4;
    const excessFee = Math.ceil(excess) * LANDING_RATE_PER_TONNE_OVER_4;
    return baseFee + excessFee;
  }
}

/**
 * Calculate total landing fees
 * @param {number} mtowTonnes - MTOW in metric tonnes
 * @param {number} landingsCount - Number of landings
 * @param {boolean} isTraining - Whether training rate applies
 * @returns {{perLanding: number, total: number, trainingApplied: boolean}}
 */
export function calculateLandingFees(mtowTonnes, landingsCount, isTraining) {
  const perLanding = calculateLandingFeePerLanding(mtowTonnes);
  let total = perLanding * (landingsCount || 1);

  if (isTraining) {
    total = total * TRAINING_DISCOUNT;
  }

  return {
    perLanding,
    total,
    trainingApplied: isTraining
  };
}

/**
 * Calculate parking fees
 * @param {number} stayHours - Length of stay in hours
 * @param {boolean} parkingRequired - Whether parking is required
 * @returns {{net: number, vat: number, gross: number, periods: number}}
 */
export function calculateParkingFees(stayHours, parkingRequired) {
  if (!parkingRequired || stayHours <= 2) {
    return { net: 0, vat: 0, gross: 0, periods: 0 };
  }

  // Calculate 24h periods after the free 2 hours
  const chargeableHours = stayHours - 2;
  const periods = Math.ceil(chargeableHours / 24);

  const net = periods * PARKING_NET_PER_24H;
  const vat = net * PARKING_VAT_RATE;
  const gross = net + vat;

  return {
    net: Math.round(net * 100) / 100,
    vat: Math.round(vat * 100) / 100,
    gross: Math.round(gross * 100) / 100,
    periods
  };
}

/**
 * Calculate CUIW fee
 * @param {boolean} hasCuiw - Whether aircraft has Civil User Indemnity Waiver
 * @returns {number} CUIW fee (0 if has waiver, fee amount if not)
 */
export function calculateCuiwFee(hasCuiw) {
  return hasCuiw ? 0 : CUIW_FEE;
}

/**
 * Calculate all charges for a booking
 * @param {object} params - Booking parameters
 * @returns {object} Charges breakdown
 */
export function calculateAllCharges(params) {
  const {
    mtowTonnes = 0,
    landingsCount = 1,
    isTraining = false,
    stayHours = 0,
    parkingRequired = false,
    fuelRequired = false,
    visitingCarsRequired = false,
    hasCuiw = true
  } = params;

  const landing = calculateLandingFees(mtowTonnes, landingsCount, isTraining);
  const parking = calculateParkingFees(stayHours, parkingRequired);
  const cuiwFee = calculateCuiwFee(hasCuiw);

  // Total: landing fees (no VAT) + parking (with VAT) + CUIW (no VAT)
  const totalGross = landing.total + parking.gross + cuiwFee;

  return {
    landing: {
      perLanding: landing.perLanding,
      net: landing.total,
      trainingApplied: landing.trainingApplied
    },
    parking: {
      net: parking.net,
      vat: parking.vat,
      gross: parking.gross,
      periods: parking.periods
    },
    cuiw: {
      fee: cuiwFee,
      hasWaiver: hasCuiw
    },
    totalGross: Math.round(totalGross * 100) / 100,
    breakdown: [
      { label: 'Landing fees', amount: landing.total, vatIncluded: false },
      ...(parking.gross > 0 ? [{ label: 'Parking', amount: parking.gross, vatIncluded: true }] : []),
      ...(cuiwFee > 0 ? [{ label: 'CUIW fee', amount: cuiwFee, vatIncluded: false }] : [])
    ],
    extras: {
      fuelRequired,
      visitingCarsRequired
    }
  };
}

/**
 * Run test cases for charges calculation
 * Can be called from console: testChargesCalculation()
 */
export function testChargesCalculation() {
  const testCases = [
    // Example from spec: 3.2t -> ceil(3.2)=4 at £12/t => £48 per landing
    { mtow: 3.2, expected: 48, desc: "3.2t -> £48" },
    // Example from spec: 4.1t -> first 4t at £12/t (=£48) + ceil(0.1)=1 at £16/t (=£16) => £64
    { mtow: 4.1, expected: 64, desc: "4.1t -> £64" },
    // Edge cases
    { mtow: 1.0, expected: 12, desc: "1.0t -> £12" },
    { mtow: 4.0, expected: 48, desc: "4.0t -> £48" },
    { mtow: 5.0, expected: 64, desc: "5.0t -> £64 (4x£12 + 1x£16)" },
    { mtow: 2.5, expected: 36, desc: "2.5t -> £36 (ceil to 3)" },
  ];

  console.log("=== Charges Calculation Tests ===");
  let allPassed = true;

  testCases.forEach(tc => {
    const result = calculateLandingFeePerLanding(tc.mtow);
    const passed = result === tc.expected;
    console.log(`${passed ? '✓' : '✗'} ${tc.desc}: got £${result}, expected £${tc.expected}`);
    if (!passed) allPassed = false;
  });

  // Parking tests
  console.log("\n=== Parking Tests ===");
  const parkingTests = [
    { hours: 2, expected: 0, desc: "2h -> free" },
    { hours: 3, expected: 20.00, desc: "3h -> 1 period (£16.67 + £3.33 VAT)" },
    { hours: 26, expected: 20.00, desc: "26h -> 1 period" },
    { hours: 27, expected: 40.01, desc: "27h -> 2 periods" },
  ];

  parkingTests.forEach(tc => {
    const result = calculateParkingFees(tc.hours, true);
    const passed = Math.abs(result.gross - tc.expected) < 0.02;
    console.log(`${passed ? '✓' : '✗'} ${tc.desc}: got £${result.gross.toFixed(2)}, expected £${tc.expected.toFixed(2)}`);
    if (!passed) allPassed = false;
  });

  // CUIW tests
  console.log("\n=== CUIW Tests ===");
  console.log(`${calculateCuiwFee(true) === 0 ? '✓' : '✗'} Has CUIW -> £0`);
  console.log(`${calculateCuiwFee(false) === CUIW_FEE ? '✓' : '✗'} No CUIW -> £${CUIW_FEE}`);

  console.log(`\n${allPassed ? 'All tests passed!' : 'Some tests failed.'}`);
  return allPassed;
}

// Make test function available globally for console debugging
if (typeof window !== 'undefined') {
  window.testChargesCalculation = testChargesCalculation;
}

/* -----------------------------
   Format Helpers
------------------------------ */

function formatCurrency(amount) {
  return `£${(amount || 0).toFixed(2)}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function formatDateLong(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

/* -----------------------------
   DOM Helpers
------------------------------ */

function byId(id) {
  return document.getElementById(id);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* -----------------------------
   Form State & Validation
------------------------------ */

function getFormData() {
  const mtowValue = parseFloat(byId('bookingMtow')?.value) || 0;
  const mtowUnit = byId('bookingMtowUnit')?.value || 't';
  const mtowTonnes = mtowUnit === 'kg' ? mtowValue / 1000 : mtowValue;

  const departureAd = (byId('bookingDepartureAd')?.value || '').toUpperCase().trim();
  const departureName = byId('bookingDepartureName')?.value.trim() || '';

  return {
    contact: {
      name: byId('bookingContactName')?.value.trim() || '',
      phone: byId('bookingContactPhone')?.value.trim() || ''
    },
    schedule: {
      dof: byId('bookingDof')?.value || '',
      arrivalTime: byId('bookingArrivalTime')?.value || '',
      stayHours: parseFloat(byId('bookingStayHours')?.value) || 0
    },
    aircraft: {
      registration: (byId('bookingRegistration')?.value || '').toUpperCase().trim(),
      callsign: (byId('bookingCallsign')?.value || '').toUpperCase().trim(),
      type: (byId('bookingAircraftType')?.value || '').toUpperCase().trim(),
      mtowValue: mtowValue,
      mtowUnit: mtowUnit,
      mtowTonnes: mtowTonnes,
      pob: parseInt(byId('bookingPob')?.value) || 0,
      hasCuiw: byId('bookingHasCuiw')?.checked ?? true
    },
    ops: {
      departureAd: departureAd,
      departureName: departureName,
      landingsCount: parseInt(byId('bookingLandingsCount')?.value) || 1,
      arrivalType: byId('bookingArrivalType')?.value || 'ARR',
      isTraining: byId('bookingTrainingRate')?.checked || false,
      parkingRequired: byId('bookingParkingRequired')?.checked || false,
      fuelRequired: byId('bookingFuelRequired')?.checked || false,
      visitingCarsRequired: byId('bookingVisitingCars')?.checked || false,
      notes: byId('bookingNotes')?.value.trim() || ''
    }
  };
}

function validateForm() {
  const data = getFormData();
  const errors = [];

  // Required fields
  if (!data.contact.name) errors.push('Contact name is required');
  if (!data.contact.phone) errors.push('Contact number is required');
  if (!data.schedule.dof) errors.push('Date of flight is required');
  if (!data.schedule.arrivalTime) errors.push('Time of arrival is required');
  if (!data.schedule.stayHours || data.schedule.stayHours <= 0) errors.push('Length of stay is required');
  if (!data.aircraft.registration) errors.push('Aircraft registration is required');
  if (!data.aircraft.type) errors.push('Aircraft type is required');
  if (!data.aircraft.mtowTonnes || data.aircraft.mtowTonnes <= 0) errors.push('MTOW is required');
  if (!data.aircraft.pob || data.aircraft.pob < 1) errors.push('Persons on board is required');
  if (!data.ops.departureAd) errors.push('Departure aerodrome is required');
  if (!data.ops.landingsCount || data.ops.landingsCount < 1) errors.push('Number of landings is required');

  // ZZZZ requires location name
  if (data.ops.departureAd === 'ZZZZ' && !data.ops.departureName) {
    errors.push('Location name is required for ZZZZ');
  }

  return {
    valid: errors.length === 0,
    errors,
    data
  };
}

/* -----------------------------
   UI Update Functions
------------------------------ */

function updateZzzzField() {
  const depAd = (byId('bookingDepartureAd')?.value || '').toUpperCase().trim();
  const zzzzField = byId('bookingDepNameField');

  if (zzzzField) {
    zzzzField.style.display = depAd === 'ZZZZ' ? '' : 'none';
  }
}

function updateChargesDisplay() {
  const data = getFormData();

  const charges = calculateAllCharges({
    mtowTonnes: data.aircraft.mtowTonnes,
    landingsCount: data.ops.landingsCount,
    isTraining: data.ops.isTraining,
    stayHours: data.schedule.stayHours,
    parkingRequired: data.ops.parkingRequired,
    fuelRequired: data.ops.fuelRequired,
    visitingCarsRequired: data.ops.visitingCarsRequired,
    hasCuiw: data.aircraft.hasCuiw
  });

  // Update display elements
  byId('chargeLandingNet').textContent = formatCurrency(charges.landing.net);
  byId('chargeParkingGross').textContent = formatCurrency(charges.parking.gross);
  byId('chargeParkingVat').textContent = formatCurrency(charges.parking.vat);
  byId('chargeTotalGross').textContent = formatCurrency(charges.totalGross);

  // Update CUIW line
  const cuiwLine = byId('chargeCuiwLine');
  const cuiwValue = byId('chargeCuiw');
  if (cuiwLine && cuiwValue) {
    if (charges.cuiw.fee > 0) {
      cuiwLine.style.display = '';
      cuiwValue.textContent = formatCurrency(charges.cuiw.fee);
    } else {
      cuiwLine.style.display = 'none';
    }
  }

  // Update notes
  byId('chargeNoteLandingRate').textContent = formatCurrency(charges.landing.perLanding);
  byId('chargeNoteParkingPeriods').textContent = `${charges.parking.periods}`;

  // Show/hide fuel note
  const fuelNote = byId('chargeNoteFuel');
  if (fuelNote) {
    fuelNote.style.display = data.ops.fuelRequired ? '' : 'none';
  }

  return charges;
}

function updateStripPreview() {
  const data = getFormData();

  // Registration / Callsign
  const displayReg = data.aircraft.registration || 'G-ABCD';
  byId('stripPreviewReg').textContent = displayReg;

  // Type
  byId('stripPreviewType').textContent = data.aircraft.type || 'TYPE';

  // Time and date
  const timeStr = data.schedule.arrivalTime || '00:00';
  const dateStr = formatDate(data.schedule.dof) || 'DD/MM/YY';
  byId('stripPreviewTime').textContent = `${timeStr} / ${dateStr}`;

  // Route - show ZZZZ with name if applicable
  let depAd = data.ops.departureAd || 'XXXX';
  byId('stripPreviewRoute').textContent = `${depAd} → EGOW`;

  // Details
  byId('stripPreviewPob').textContent = data.aircraft.pob || '0';
  byId('stripPreviewStay').textContent = data.schedule.stayHours ? `${data.schedule.stayHours}h` : '0h';
  byId('stripPreviewLandings').textContent = data.ops.landingsCount || '0';

  // Requirements summary
  const reqs = [];
  if (data.ops.parkingRequired) reqs.push('Parking');
  if (data.ops.fuelRequired) reqs.push('Fuel');
  if (data.ops.visitingCarsRequired) reqs.push('Cars');
  byId('stripPreviewReqs').textContent = reqs.length > 0 ? reqs.join(', ') : 'None';
}

function updateSubmitButton() {
  const validation = validateForm();
  const btn = byId('btnCreateBooking');
  if (btn) {
    btn.disabled = !validation.valid;
  }
}

/* -----------------------------
   Registration-driven Autofill Chain
   Precedence: Saved Profile > VKB Registrations DB > VKB Aircraft Types

   Chain:
   1. Registration entered
   2. Check saved booking profile first (repeat visitor)
   3. If no profile, lookup VKB registrations for: callsign, type, warnings, notes
   4. Type -> MTOW lookup from VKB aircraft types
   5. System notes updated with WARNINGS/NOTES from either source
------------------------------ */

// Track last processed registration to avoid redundant lookups
let lastProcessedRegistration = '';

// Track current system notes from VKB lookup (for saving with profile)
let currentSystemWarnings = '';
let currentSystemNotes = '';

/**
 * Main autofill chain triggered when registration changes
 * Implements precedence: profile > VKB
 */
function runRegistrationAutofill() {
  const regInput = byId('bookingRegistration');
  if (!regInput) return;

  const reg = regInput.value.toUpperCase().trim();
  const normalizedReg = normalizeRegistration(reg);

  // Skip if registration unchanged
  if (normalizedReg === lastProcessedRegistration) return;
  lastProcessedRegistration = normalizedReg;

  // Clear system notes if registration cleared
  if (!normalizedReg) {
    updateSystemNotes('', '');
    return;
  }

  // Get references to form fields
  const callsignInput = byId('bookingCallsign');
  const typeInput = byId('bookingAircraftType');
  const mtowInput = byId('bookingMtow');
  const mtowUnitSelect = byId('bookingMtowUnit');
  const cuiwCheckbox = byId('bookingHasCuiw');
  const contactNameInput = byId('bookingContactName');
  const contactPhoneInput = byId('bookingContactPhone');
  const departureAdInput = byId('bookingDepartureAd');
  const notesInput = byId('bookingNotes');

  // System notes variables
  let systemWarnings = '';
  let systemNotes = '';

  // 1. Check for saved booking profile first (highest precedence)
  const profile = getBookingProfile(reg);

  if (profile) {
    // Profile found - use profile data with anti-stomp
    if (profile.callsign) {
      setAutofillValue(callsignInput, profile.callsign, 'profile');
    }
    if (profile.aircraftType) {
      setAutofillValue(typeInput, profile.aircraftType, 'profile');
    }
    if (profile.mtow) {
      setAutofillValue(mtowInput, String(profile.mtow), 'profile');
      if (mtowUnitSelect && profile.mtowUnit) {
        mtowUnitSelect.value = profile.mtowUnit;
      }
    }
    if (cuiwCheckbox && profile.hasCuiw !== undefined) {
      cuiwCheckbox.checked = profile.hasCuiw;
    }
    if (profile.contactName) {
      setAutofillValue(contactNameInput, profile.contactName, 'profile');
    }
    if (profile.contactPhone) {
      setAutofillValue(contactPhoneInput, profile.contactPhone, 'profile');
    }
    if (profile.departureAd) {
      setAutofillValue(departureAdInput, profile.departureAd, 'profile');
    }
    if (profile.notes) {
      setAutofillValue(notesInput, profile.notes, 'profile');
    }

    // Profile may also have system notes from original VKB lookup
    systemWarnings = profile.systemWarnings || '';
    systemNotes = profile.systemNotes || '';

    // Store for potential profile save later
    currentSystemWarnings = systemWarnings;
    currentSystemNotes = systemNotes;

    // Show indicator that profile was loaded
    showProfileLoadedIndicator('profile', profile.last_saved);
  } else {
    // No profile - use VKB registration lookup
    const regData = lookupRegistration(reg);
    let vkbUsed = false;

    if (regData) {
      // Auto-fill fixed callsign if different from registration
      const fixedCallsign = regData['FIXED C/S'];
      if (fixedCallsign && fixedCallsign !== '-' && fixedCallsign !== '' &&
          fixedCallsign.toUpperCase() !== normalizedReg) {
        setAutofillValue(callsignInput, fixedCallsign, 'vkb');
        vkbUsed = true;
      }

      // Auto-fill aircraft type
      const regType = regData['TYPE'];
      if (regType && regType !== '-') {
        setAutofillValue(typeInput, regType, 'vkb');
        vkbUsed = true;
      }

      // Extract warnings and notes for system notes block
      systemWarnings = regData['WARNINGS'] || '';
      if (systemWarnings === '-') systemWarnings = '';

      systemNotes = regData['NOTES'] || '';
      if (systemNotes === '-') systemNotes = '';

      if (systemWarnings || systemNotes) vkbUsed = true;

      // Store for potential profile save later
      currentSystemWarnings = systemWarnings;
      currentSystemNotes = systemNotes;
    }

    // Show VKB indicator if data was found, otherwise hide
    showProfileLoadedIndicator(vkbUsed ? 'vkb' : false);
  }

  // 2. Type -> MTOW chain (runs after type is set from profile or VKB)
  runTypeMtowAutofill();

  // 3. Update system notes display
  updateSystemNotes(systemWarnings, systemNotes);
}

/**
 * Type -> MTOW autofill from VKB aircraft types
 * Only runs if MTOW field is empty or still shows previous autofill
 */
function runTypeMtowAutofill() {
  const typeInput = byId('bookingAircraftType');
  const mtowInput = byId('bookingMtow');
  const mtowUnitSelect = byId('bookingMtowUnit');

  if (!typeInput || !mtowInput) return;

  const aircraftType = typeInput.value.toUpperCase().trim();
  if (!aircraftType) return;

  // Lookup MTOW from aircraft types
  const typeData = lookupAircraftType(aircraftType);
  if (typeData) {
    const mctomKg = parseFloat(typeData['MCTOM (Kg)']) || 0;
    if (mctomKg > 0) {
      // Only autofill if MTOW is empty or shows previous autofill
      setAutofillValue(mtowInput, String(Math.round(mctomKg)), 'vkb');

      // Set unit to kg when autofilling from MCTOM
      if (mtowUnitSelect) {
        mtowUnitSelect.value = 'kg';
      }
    }
  }
}

/**
 * Update the system notes display block
 * Shows WARNINGS and NOTES from VKB or profile
 * Does not overwrite user's notes/special requirements
 */
function updateSystemNotes(warnings, notes) {
  const systemNotesBlock = byId('bookingSystemNotes');
  const systemNotesContainer = byId('bookingSystemNotesContainer');
  if (!systemNotesBlock || !systemNotesContainer) return;

  let html = '';
  if (warnings) {
    html += `<div class="system-notes-item note-warning">
      <span class="system-notes-label label-warning">WARNING:</span>${escapeHtml(warnings)}
    </div>`;
  }
  if (notes) {
    html += `<div class="system-notes-item note-info">
      <span class="system-notes-label label-info">NOTE:</span>${escapeHtml(notes)}
    </div>`;
  }

  if (html) {
    systemNotesBlock.innerHTML = html;
    systemNotesContainer.style.display = '';
  } else {
    systemNotesBlock.innerHTML = '';
    systemNotesContainer.style.display = 'none';
  }
}

/**
 * Show/hide indicator that a saved profile was loaded or VKB was used
 * @param {boolean|string} source - false to hide, 'profile' for saved profile, 'vkb' for VKB data
 * @param {string|null} lastSavedDate - ISO date string for profile
 */
function showProfileLoadedIndicator(source, lastSavedDate = null) {
  const indicator = byId('profileLoadedIndicator');
  if (!indicator) return;

  // Reset classes
  indicator.className = 'profile-indicator';

  if (source === 'profile' || source === true) {
    let text = ' Profile loaded';
    if (lastSavedDate) {
      const date = new Date(lastSavedDate);
      text += ` (${date.toLocaleDateString()})`;
    }
    indicator.textContent = text;
    indicator.classList.add('profile-loaded');
    indicator.style.display = 'inline-flex';
  } else if (source === 'vkb') {
    indicator.textContent = ' VKB data';
    indicator.classList.add('vkb-autofill');
    indicator.style.display = 'inline-flex';
  } else {
    indicator.textContent = '';
    indicator.style.display = 'none';
  }
}

/**
 * Save current form data as booking profile
 * @param {boolean} silent - If true, don't show toast notification
 */
function saveCurrentAsProfile(silent = false) {
  const regInput = byId('bookingRegistration');
  if (!regInput || !regInput.value.trim()) {
    if (!silent) showToast('Enter a registration to save profile', 'error');
    return false;
  }

  const reg = regInput.value.toUpperCase().trim();
  const data = getFormData();

  const profileData = {
    callsign: data.aircraft.callsign,
    aircraftType: data.aircraft.type,
    mtow: data.aircraft.mtowValue,
    mtowUnit: data.aircraft.mtowUnit,
    hasCuiw: data.aircraft.hasCuiw,
    contactName: data.contact.name,
    contactPhone: data.contact.phone,
    departureAd: data.ops.departureAd,
    notes: data.ops.notes,
    // Use tracked system notes from VKB/profile lookup
    systemWarnings: currentSystemWarnings,
    systemNotes: currentSystemNotes
  };

  saveBookingProfile(reg, profileData);
  if (!silent) {
    showToast(`Profile saved for ${reg}`, 'success');
  }
  showProfileLoadedIndicator('profile', new Date().toISOString());
  return true;
}

/**
 * Handle profile export - downloads JSON file
 */
function handleProfileExport() {
  const json = exportBookingProfiles();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fdms_booking_profiles_${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Profiles exported', 'success');
}

/**
 * Handle profile import - opens file picker
 */
function handleProfileImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';

  input.onchange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        const result = importBookingProfiles(data);

        if (result.success) {
          showToast(`Imported ${result.imported} profiles`, 'success');
        } else {
          showToast(`Import failed: ${result.error}`, 'error');
        }
      } catch (err) {
        showToast('Invalid JSON file', 'error');
      }
    };
    reader.readAsText(file);
  };

  input.click();
}

function updateAll() {
  updateZzzzField();
  runRegistrationAutofill();
  updateChargesDisplay();
  updateStripPreview();
  updateSubmitButton();
}

/* -----------------------------
   Registry Lookup Functions
------------------------------ */

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => {
      fallbackCopyToClipboard(text);
    });
  } else {
    fallbackCopyToClipboard(text);
  }
}

function fallbackCopyToClipboard(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  document.body.appendChild(textArea);
  textArea.select();
  try {
    document.execCommand('copy');
  } catch (err) {
    console.warn('Fallback copy failed:', err);
  }
  document.body.removeChild(textArea);
}

/**
 * Normalize registration for registry URL lookup (strips G- prefix for CAA)
 */
function normalizeRegistrationForRegistry(reg) {
  let normalized = (reg || '').toUpperCase().trim();
  if (normalized.startsWith('G-')) {
    return normalized.substring(2);
  }
  return normalized;
}

function openCaaGinfo() {
  const reg = byId('bookingRegistration')?.value || '';
  const searchKey = normalizeRegistrationForRegistry(reg);

  if (searchKey) {
    copyToClipboard(searchKey);
    showToast(`Copied '${searchKey}' - paste into G-INFO search`, 'info', 4000);
  }

  window.open('https://www.caa.co.uk/aircraft-register/g-info/search-g-info/', '_blank');
}

function openFaaRegistry() {
  const reg = byId('bookingRegistration')?.value || '';
  let searchKey = (reg || '').toUpperCase().trim();

  if (searchKey.startsWith('N')) {
    searchKey = searchKey.substring(1);
  }

  if (searchKey) {
    copyToClipboard(searchKey);
    showToast(`Copied '${searchKey}' - paste into FAA search`, 'info', 4000);
  }

  window.open('https://registry.faa.gov/aircraftinquiry/Search/NNumberInquiry', '_blank');
}

/* -----------------------------
   Booking Submission
------------------------------ */

function resetForm() {
  const form = document.querySelector('#tab-booking');
  if (form) {
    form.querySelectorAll('input[type="text"], input[type="tel"], input[type="date"], input[type="time"], input[type="number"], textarea').forEach(el => {
      el.value = '';
      // Clear autofill tracking
      delete el.dataset.autofillValue;
      delete el.dataset.autofillSource;
    });
    form.querySelectorAll('input[type="checkbox"]').forEach(el => {
      if (el.id === 'bookingParkingRequired' || el.id === 'bookingHasCuiw') {
        el.checked = true;
      } else {
        el.checked = false;
      }
    });
    form.querySelectorAll('select').forEach(el => {
      el.selectedIndex = 0;
    });
  }

  // Reset autofill tracking state
  Object.keys(autofillState.lastAutofill).forEach(key => {
    delete autofillState.lastAutofill[key];
  });
  lastProcessedRegistration = '';
  currentSystemWarnings = '';
  currentSystemNotes = '';

  // Hide profile indicator and system notes
  showProfileLoadedIndicator(false);
  updateSystemNotes('', '');

  const dofInput = byId('bookingDof');
  if (dofInput) {
    const today = new Date().toISOString().split('T')[0];
    dofInput.value = today;
  }

  updateAll();
  showToast('Form reset', 'info', 2000);
}

function createBookingAndStrip() {
  const validation = validateForm();

  if (!validation.valid) {
    showToast(`Please fix errors: ${validation.errors.join(', ')}`, 'error', 5000);
    return;
  }

  const data = validation.data;
  const charges = calculateAllCharges({
    mtowTonnes: data.aircraft.mtowTonnes,
    landingsCount: data.ops.landingsCount,
    isTraining: data.ops.isTraining,
    stayHours: data.schedule.stayHours,
    parkingRequired: data.ops.parkingRequired,
    fuelRequired: data.ops.fuelRequired,
    visitingCarsRequired: data.ops.visitingCarsRequired,
    hasCuiw: data.aircraft.hasCuiw
  });

  // Create booking record
  const booking = createBooking({
    contact: data.contact,
    schedule: {
      dateISO: data.schedule.dof,
      plannedTimeLocalHHMM: data.schedule.arrivalTime,
      plannedTimeKind: 'ARR',
      arrivalTimeLocalHHMM: data.schedule.arrivalTime,
      stayHours: data.schedule.stayHours
    },
    aircraft: {
      registration: data.aircraft.registration,
      callsign: data.aircraft.callsign || data.aircraft.registration,
      type: data.aircraft.type,
      pob: data.aircraft.pob,
      mtowTonnes: data.aircraft.mtowTonnes,
      hasCuiw: data.aircraft.hasCuiw
    },
    movement: {
      departure: data.ops.departureAd,
      departureName: data.ops.departureName,
      destination: 'EGOW'
    },
    ops: {
      landingsCount: data.ops.landingsCount,
      arrivalType: data.ops.arrivalType,
      isTraining: data.ops.isTraining,
      parkingRequired: data.ops.parkingRequired,
      fuelRequired: data.ops.fuelRequired,
      visitingCarsRequired: data.ops.visitingCarsRequired,
      notes: data.ops.notes
    },
    charges: {
      landingNet: charges.landing.net,
      landingTrainingApplied: charges.landing.trainingApplied,
      parkingNet: charges.parking.net,
      parkingVat: charges.parking.vat,
      parkingGross: charges.parking.gross,
      cuiwFee: charges.cuiw.fee,
      totalGross: charges.totalGross,
      breakdown: charges.breakdown
    }
  });

  // Build remarks string
  const remarksParts = [];

  // Add ZZZZ location name first if applicable
  if (data.ops.departureAd === 'ZZZZ' && data.ops.departureName) {
    remarksParts.push(data.ops.departureName);
  }

  if (data.ops.landingsCount > 1) {
    remarksParts.push(`${data.ops.landingsCount} landings`);
  }
  if (data.ops.isTraining) {
    remarksParts.push('training');
  }
  if (data.ops.parkingRequired && data.schedule.stayHours > 0) {
    remarksParts.push(`parking ${data.schedule.stayHours}h`);
  }
  if (data.ops.fuelRequired) {
    remarksParts.push('fuel req');
  }
  if (!data.aircraft.hasCuiw) {
    remarksParts.push('no CUIW');
  }
  if (data.ops.notes) {
    remarksParts.push(data.ops.notes);
  }
  const remarks = remarksParts.join('; ') || `Booking #${booking.id}`;

  // Create planned movement strip
  const flightType = data.ops.arrivalType;
  const isLocal = flightType === 'LOC';

  createMovement({
    status: 'PLANNED',
    callsignCode: data.aircraft.callsign || data.aircraft.registration,
    callsignLabel: data.aircraft.callsign || data.aircraft.registration,
    callsignVoice: '',
    registration: data.aircraft.registration,
    type: data.aircraft.type,
    wtc: 'L (ICAO)',
    depAd: isLocal ? 'EGOW' : data.ops.departureAd,
    depName: data.ops.departureName || '',
    arrAd: 'EGOW',
    arrName: 'RAF Woodvale',
    depPlanned: isLocal ? data.schedule.arrivalTime : '',
    depActual: '',
    arrPlanned: data.schedule.arrivalTime,
    arrActual: '',
    dof: data.schedule.dof,
    rules: 'VFR',
    flightType: flightType,
    isLocal: isLocal,
    tngCount: data.ops.isTraining ? data.ops.landingsCount : 0,
    osCount: 0,
    fisCount: 0,
    egowCode: 'VC',
    egowDesc: 'Visiting Civil Fixed-Wing',
    unitCode: '',
    unitDesc: '',
    captain: data.contact.name,
    pob: data.aircraft.pob,
    remarks: remarks,
    formation: null,
    bookingId: booking.id
  });

  // Auto-save profile if checkbox is checked
  const saveProfileCheckbox = byId('bookingSaveProfile');
  if (saveProfileCheckbox?.checked) {
    saveCurrentAsProfile(true); // Silent save
  }

  showToast(`Booking created! Strip added to Live Board.`, 'success', 5000);

  window.dispatchEvent(new CustomEvent("fdms:data-changed", { detail: { source: "booking" } }));
  renderCalendar();

  const liveTab = document.querySelector('[data-tab="tab-live"]');
  if (liveTab) {
    liveTab.click();
  }

  resetForm();
}

/* -----------------------------
   Calendar Functions
------------------------------ */

let calendarCurrentDate = new Date();
let calendarViewMode = 'month'; // 'week' | 'month' | 'year'

function getCalendarMonth() {
  return {
    year: calendarCurrentDate.getFullYear(),
    month: calendarCurrentDate.getMonth()
  };
}

function setCalendarMonth(year, month) {
  calendarCurrentDate = new Date(year, month, 1);
  renderCalendar();
}

function getBookingsForDate(dateStr) {
  ensureBookingsInitialised();
  return bookings.filter(b => b.schedule?.dateISO === dateStr && b.status !== 'CANCELLED');
}

function getMovementsForDate(dateStr) {
  const movements = getMovements();
  return movements.filter(m => m.dof === dateStr);
}

/**
 * Bind click handlers on all .calendar-event elements inside the grid.
 * Handles bookings, movements, and general calendar events.
 */
function bindCalendarEventClicks(container) {
  if (!container) return;
  container.querySelectorAll('.calendar-event').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const bookingId = el.dataset.bookingId;
      const movementId = el.dataset.movementId;
      const eventId = el.dataset.eventId;

      if (bookingId) {
        openBookingDrawer(parseInt(bookingId));
      } else if (movementId && window.openEditMovementModal) {
        const m = getMovements().find(mv => mv.id === parseInt(movementId));
        if (m) window.openEditMovementModal(m);
      } else if (eventId) {
        openEditCalendarEventModal(parseInt(eventId));
      }
    });
  });
}

export function renderCalendar() {
  const grid = byId('calendarGrid');
  if (!grid) return;

  // Sync view-mode buttons
  document.querySelectorAll('.cal-view-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === calendarViewMode);
  });

  switch (calendarViewMode) {
    case 'week':  renderCalendarWeek(grid); break;
    case 'year':  renderCalendarYear(grid); break;
    default:      renderCalendarMonth(grid); break;
  }

  bindCalendarEventClicks(grid);
}

/* --- Month view (original grid) --- */
function renderCalendarMonth(grid) {
  const monthLabel = byId('calendarMonthLabel');
  const { year, month } = getCalendarMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  if (monthLabel) {
    monthLabel.textContent = firstDay.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }

  let html = '';
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  dayNames.forEach(day => { html += `<div class="calendar-header-cell">${day}</div>`; });

  let startDayOfWeek = firstDay.getDay() - 1;
  if (startDayOfWeek < 0) startDayOfWeek = 6;

  const prevMonthLastDay = new Date(year, month, 0);
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const day = prevMonthLastDay.getDate() - i;
    const dateStr = new Date(year, month - 1, day).toISOString().split('T')[0];
    html += renderCalendarDay(day, dateStr, true, false);
  }

  for (let day = 1; day <= lastDay.getDate(); day++) {
    const dateStr = new Date(year, month, day).toISOString().split('T')[0];
    html += renderCalendarDay(day, dateStr, false, dateStr === todayStr);
  }

  const totalCells = Math.ceil((startDayOfWeek + lastDay.getDate()) / 7) * 7;
  const remainingCells = totalCells - (startDayOfWeek + lastDay.getDate());
  for (let day = 1; day <= remainingCells; day++) {
    const dateStr = new Date(year, month + 1, day).toISOString().split('T')[0];
    html += renderCalendarDay(day, dateStr, true, false);
  }

  grid.style.gridTemplateColumns = 'repeat(7, 1fr)';
  grid.innerHTML = html;
}

/* --- Week view: Mon–Sun of the week containing calendarCurrentDate --- */
function renderCalendarWeek(grid) {
  const monthLabel = byId('calendarMonthLabel');
  const ref = new Date(calendarCurrentDate);
  // Find Monday of this week
  const dow = ref.getDay(); // 0=Sun
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(ref);
  monday.setDate(ref.getDate() + mondayOffset);

  const todayStr = new Date().toISOString().split('T')[0];

  // Label: "Week of DD Mon YYYY"
  if (monthLabel) {
    monthLabel.textContent = 'Week of ' + monday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  let html = '';
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  dayNames.forEach(d => { html += `<div class="calendar-header-cell">${d}</div>`; });

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    html += renderCalendarDay(d.getDate(), dateStr, false, dateStr === todayStr);
  }

  grid.style.gridTemplateColumns = 'repeat(7, 1fr)';
  grid.innerHTML = html;
}

/* --- Year view: 12-month compact grid; clicking a month switches to that month --- */
function renderCalendarYear(grid) {
  const monthLabel = byId('calendarMonthLabel');
  const year = calendarCurrentDate.getFullYear();

  if (monthLabel) {
    monthLabel.textContent = String(year);
  }

  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const today = new Date();
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth();

  let html = '';
  for (let m = 0; m < 12; m++) {
    // Count items in this month
    const firstOfMonth = new Date(year, m, 1);
    const lastOfMonth = new Date(year, m + 1, 0);
    let itemCount = 0;
    for (let d = 1; d <= lastOfMonth.getDate(); d++) {
      const ds = new Date(year, m, d).toISOString().split('T')[0];
      itemCount += getBookingsForDate(ds).length + getCalendarEventsForDate(ds).length;
    }

    const isCurrentMonth = (year === todayYear && m === todayMonth);
    const cls = isCurrentMonth ? ' is-today' : '';
    html += `<div class="calendar-year-month${cls}" data-year="${year}" data-month="${m}" style="cursor:pointer;">
      <div class="calendar-year-month-name">${monthNames[m]}</div>
      ${itemCount > 0 ? `<div class="calendar-year-month-count">${itemCount} item${itemCount !== 1 ? 's' : ''}</div>` : ''}
    </div>`;
  }

  grid.style.gridTemplateColumns = 'repeat(4, 1fr)';
  grid.innerHTML = html;

  // Click a month → switch to month view for that month
  grid.querySelectorAll('.calendar-year-month').forEach(el => {
    el.addEventListener('click', () => {
      calendarViewMode = 'month';
      calendarCurrentDate = new Date(parseInt(el.dataset.year), parseInt(el.dataset.month), 1);
      renderCalendar();
    });
  });
}

function renderCalendarDay(day, dateStr, isOtherMonth, isToday) {
  const bkgs = getBookingsForDate(dateStr);
  const mvts = getMovementsForDate(dateStr);
  const evts = getCalendarEventsForDate(dateStr);

  let classes = 'calendar-day-cell';
  if (isOtherMonth) classes += ' other-month';
  if (isToday) classes += ' is-today';

  let eventsHtml = '<div class="calendar-events">';

  bkgs.forEach(b => {
    const time = b.schedule?.arrivalTimeLocalHHMM || '';
    const reg = b.aircraft?.registration || 'Unknown';
    eventsHtml += `<div class="calendar-event event-booking" data-booking-id="${b.id}" title="${escapeHtml(reg)} - ${time}">${time} ${escapeHtml(reg)}</div>`;
  });

  evts.forEach(e => {
    const time = e.time || '';
    const title = e.title || 'Event';
    eventsHtml += `<div class="calendar-event event-general" data-event-id="${e.id}" title="${escapeHtml(title)}" style="cursor:pointer;">${time ? time + ' ' : ''}${escapeHtml(title)}</div>`;
  });

  // Show movements linked to bookings (they already show via booking entry) AND movements with showOnCalendar
  mvts.filter(m => m.showOnCalendar && !m.bookingId).forEach(m => {
    const time = m.arrPlanned || m.depPlanned || '';
    const callsign = m.callsignCode || m.registration || 'Unknown';
    const ftClass = `event-${(m.flightType || 'loc').toLowerCase()}`;
    eventsHtml += `<div class="calendar-event event-movement ${ftClass}" data-movement-id="${m.id}" title="${escapeHtml(callsign)} - ${time} (${m.flightType || ''})" style="cursor:pointer;">${time} ${escapeHtml(callsign)}</div>`;
  });

  eventsHtml += '</div>';

  return `
    <div class="${classes}" data-date="${dateStr}">
      <div class="day-number">${day}</div>
      ${eventsHtml}
    </div>
  `;
}

function openBookingDrawer(bookingId) {
  const booking = getBookingById(bookingId);
  if (!booking) return;

  const drawer = byId('bookingDetailsDrawer');
  const content = byId('drawerContent');

  if (!drawer || !content) return;

  content.innerHTML = renderBookingDetails(booking);
  drawer.classList.add('open');
  drawer.style.display = 'flex';
  bindDrawerActions();
}

function closeBookingDrawer() {
  const drawer = byId('bookingDetailsDrawer');
  if (drawer) {
    drawer.classList.remove('open');
    setTimeout(() => {
      drawer.style.display = 'none';
    }, 300);
  }
}

function renderBookingDetails(booking) {
  const contact = booking.contact || {};
  const schedule = booking.schedule || {};
  const aircraft = booking.aircraft || {};
  const movement = booking.movement || {};
  const ops = booking.ops || {};
  const charges = booking.charges || {};
  const status = booking.status || 'CONFIRMED';

  const departureDisplay = movement.departure === 'ZZZZ' && movement.departureName
    ? `ZZZZ (${escapeHtml(movement.departureName)})`
    : escapeHtml(movement.departure || '');

  // Find linked strip(s)
  const linkedStrips = getMovements().filter(m => m.bookingId === booking.id);
  const linkedStripHtml = linkedStrips.length > 0
    ? linkedStrips.map(s => `<span class="drawer-linked-strip" style="display:inline-block;background:#eef2f7;border-radius:3px;padding:2px 6px;font-size:11px;margin:2px 2px 2px 0;">Strip #${s.id} ${escapeHtml(s.callsignCode || '')} [${s.status}]</span>`).join('')
    : '<span style="font-size:11px;color:#999;">None</span>';

  // Action buttons – hide if already cancelled
  const actionsHtml = status !== 'CANCELLED' ? `
    <div class="drawer-section" style="display:flex;gap:8px;flex-wrap:wrap;">
      <button type="button" class="btn btn-secondary btn-small js-drawer-edit-booking" data-booking-id="${booking.id}">Edit</button>
      <button type="button" class="btn btn-secondary btn-small js-drawer-cancel-booking" data-booking-id="${booking.id}" style="color:#d32f2f;">Cancel</button>
      <button type="button" class="btn btn-ghost btn-small js-drawer-delete-booking" data-booking-id="${booking.id}" style="color:#d32f2f;">Delete</button>
    </div>
  ` : '<div class="drawer-section" style="font-size:12px;color:#d32f2f;font-weight:600;">This booking has been cancelled.</div>';

  return `
    ${actionsHtml}

    <div class="drawer-section">
      <div class="drawer-section-title">Status</div>
      <div class="drawer-field">
        <span class="drawer-field-label">Booking status</span>
        <span class="drawer-field-value" style="font-weight:600;">${escapeHtml(status)}</span>
      </div>
      <div class="drawer-field">
        <span class="drawer-field-label">Linked strip(s)</span>
        <span class="drawer-field-value" style="flex-wrap:wrap;">${linkedStripHtml}</span>
      </div>
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">Contact</div>
      <div class="drawer-field">
        <span class="drawer-field-label">Name</span>
        <span class="drawer-field-value">${escapeHtml(contact.name || '-')}</span>
      </div>
      <div class="drawer-field">
        <span class="drawer-field-label">Phone</span>
        <span class="drawer-field-value">${escapeHtml(contact.phone || '-')}</span>
      </div>
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">Schedule</div>
      <div class="drawer-field">
        <span class="drawer-field-label">Date</span>
        <span class="drawer-field-value">${formatDateLong(schedule.dateISO)}</span>
      </div>
      <div class="drawer-field">
        <span class="drawer-field-label">Arrival Time</span>
        <span class="drawer-field-value">${escapeHtml(schedule.arrivalTimeLocalHHMM || '-')}</span>
      </div>
      <div class="drawer-field">
        <span class="drawer-field-label">Stay Duration</span>
        <span class="drawer-field-value">${schedule.stayHours || 0} hours</span>
      </div>
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">Aircraft</div>
      <div class="drawer-field">
        <span class="drawer-field-label">Registration</span>
        <span class="drawer-field-value">${escapeHtml(aircraft.registration || '-')}</span>
      </div>
      <div class="drawer-field">
        <span class="drawer-field-label">Type</span>
        <span class="drawer-field-value">${escapeHtml(aircraft.type || '-')}</span>
      </div>
      <div class="drawer-field">
        <span class="drawer-field-label">MTOW</span>
        <span class="drawer-field-value">${aircraft.mtowTonnes?.toFixed(2) || '-'} t</span>
      </div>
      <div class="drawer-field">
        <span class="drawer-field-label">POB</span>
        <span class="drawer-field-value">${aircraft.pob || '-'}</span>
      </div>
      <div class="drawer-field">
        <span class="drawer-field-label">CUIW</span>
        <span class="drawer-field-value">${aircraft.hasCuiw ? 'Yes' : 'No'}</span>
      </div>
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">Operational</div>
      <div class="drawer-field">
        <span class="drawer-field-label">From</span>
        <span class="drawer-field-value">${departureDisplay}</span>
      </div>
      <div class="drawer-field">
        <span class="drawer-field-label">To</span>
        <span class="drawer-field-value">${escapeHtml(movement.destination || 'EGOW')}</span>
      </div>
      <div class="drawer-field">
        <span class="drawer-field-label">Landings</span>
        <span class="drawer-field-value">${ops.landingsCount || 1}</span>
      </div>
      <div class="drawer-field">
        <span class="drawer-field-label">Training</span>
        <span class="drawer-field-value">${ops.isTraining ? 'Yes' : 'No'}</span>
      </div>
      <div class="drawer-field">
        <span class="drawer-field-label">Requirements</span>
        <span class="drawer-field-value">
          ${[
            ops.parkingRequired ? 'Parking' : '',
            ops.fuelRequired ? 'Fuel' : '',
            ops.visitingCarsRequired ? 'Cars' : ''
          ].filter(Boolean).join(', ') || 'None'}
        </span>
      </div>
      ${ops.notes ? `
      <div class="drawer-field" style="flex-direction: column; align-items: flex-start;">
        <span class="drawer-field-label">Notes</span>
        <span class="drawer-field-value" style="text-align: left; margin-top: 4px;">${escapeHtml(ops.notes)}</span>
      </div>
      ` : ''}
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">Charges</div>
      <div class="drawer-charges">
        <div class="charge-line">
          <span class="charge-label">Landing fees</span>
          <span class="charge-value">${formatCurrency(charges.landingNet)}</span>
        </div>
        ${charges.parkingGross > 0 ? `
        <div class="charge-line">
          <span class="charge-label">Parking (incl VAT)</span>
          <span class="charge-value">${formatCurrency(charges.parkingGross)}</span>
        </div>
        ` : ''}
        ${charges.cuiwFee > 0 ? `
        <div class="charge-line">
          <span class="charge-label">CUIW fee</span>
          <span class="charge-value">${formatCurrency(charges.cuiwFee)}</span>
        </div>
        ` : ''}
        <div class="charge-line charge-total" style="margin: 8px 0 0; padding: 8px 0 0; border-top: 2px solid var(--va-accent-brown);">
          <span class="charge-label" style="font-weight: 700;">Total</span>
          <span class="charge-value" style="font-size: 14px;">${formatCurrency(charges.totalGross)}</span>
        </div>
      </div>
    </div>

    <div class="drawer-section" style="font-size: 10px; color: #999;">
      Booking #${booking.id} created ${new Date(booking.createdAtUtc).toLocaleString()}
    </div>
  `;
}

/* -----------------------------
   Booking Drawer Action Handlers
------------------------------ */

/**
 * Bind action-button click handlers inside the booking details drawer.
 * Called each time the drawer content is refreshed.
 */
function bindDrawerActions() {
  const drawer = byId('bookingDetailsDrawer');
  if (!drawer) return;

  drawer.querySelectorAll('.js-drawer-edit-booking').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.bookingId);
      openEditBookingModal(id);
    });
  });

  drawer.querySelectorAll('.js-drawer-cancel-booking').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.bookingId);
      handleCancelBooking(id);
    });
  });

  drawer.querySelectorAll('.js-drawer-delete-booking').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.bookingId);
      handleDeleteBooking(id);
    });
  });
}

/**
 * Open an edit modal pre-filled with booking data.
 */
function openEditBookingModal(bookingId) {
  const booking = getBookingById(bookingId);
  if (!booking) return;

  const modalRoot = byId('modalRoot');
  if (!modalRoot) return;

  const schedule = booking.schedule || {};
  const aircraft = booking.aircraft || {};
  const contact = booking.contact || {};
  const movement = booking.movement || {};
  const ops = booking.ops || {};

  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" style="max-width: 520px;">
        <div class="modal-header">
          <div>
            <div class="modal-title">Edit Booking #${bookingId}</div>
            <div class="modal-subtitle">${escapeHtml(aircraft.registration || '')}</div>
          </div>
          <button class="btn btn-ghost js-close-modal" type="button" title="Close">&#x2715;</button>
        </div>
        <div class="modal-body">
          <div class="modal-field">
            <label class="modal-label">Contact name</label>
            <input id="ebContactName" class="modal-input" value="${escapeHtml(contact.name || '')}" />
          </div>
          <div class="modal-field">
            <label class="modal-label">Contact phone</label>
            <input id="ebContactPhone" class="modal-input" value="${escapeHtml(contact.phone || '')}" />
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;">
            <div class="modal-field" style="flex:1;min-width:140px;">
              <label class="modal-label">Date of flight</label>
              <input id="ebDof" type="date" class="modal-input" value="${escapeHtml(schedule.dateISO || '')}" />
            </div>
            <div class="modal-field" style="flex:0 0 100px;">
              <label class="modal-label">Arrival time</label>
              <input id="ebArrTime" type="time" class="modal-input" value="${escapeHtml(schedule.arrivalTimeLocalHHMM || '')}" />
            </div>
          </div>
          <div class="modal-field">
            <label class="modal-label">Stay (hours)</label>
            <input id="ebStayHours" type="number" class="modal-input" step="0.5" min="0" value="${schedule.stayHours || 0}" />
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;">
            <div class="modal-field" style="flex:1;">
              <label class="modal-label">Registration</label>
              <input id="ebReg" class="modal-input" value="${escapeHtml(aircraft.registration || '')}" style="text-transform:uppercase;" />
            </div>
            <div class="modal-field" style="flex:1;">
              <label class="modal-label">Type</label>
              <input id="ebType" class="modal-input" value="${escapeHtml(aircraft.type || '')}" style="text-transform:uppercase;" />
            </div>
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;">
            <div class="modal-field" style="flex:1;">
              <label class="modal-label">Callsign</label>
              <input id="ebCallsign" class="modal-input" value="${escapeHtml(aircraft.callsign || '')}" style="text-transform:uppercase;" />
            </div>
            <div class="modal-field" style="flex:0 0 80px;">
              <label class="modal-label">POB</label>
              <input id="ebPob" type="number" class="modal-input" min="1" value="${aircraft.pob || 1}" />
            </div>
          </div>
          <div class="modal-field">
            <label class="modal-label">Departure aerodrome</label>
            <input id="ebDepAd" class="modal-input" value="${escapeHtml(movement.departure || '')}" style="text-transform:uppercase;" />
          </div>
          <div class="modal-field">
            <label class="modal-label">Notes</label>
            <textarea id="ebNotes" class="modal-textarea" rows="2">${escapeHtml(ops.notes || '')}</textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost js-close-modal" type="button">Cancel</button>
          <button class="btn btn-primary js-save-edit-booking" type="button" data-booking-id="${bookingId}">Save</button>
        </div>
      </div>
    </div>
  `;

  // Close handlers
  modalRoot.querySelectorAll('.js-close-modal').forEach(btn => {
    btn.addEventListener('click', () => { modalRoot.innerHTML = ''; });
  });

  // Save handler
  modalRoot.querySelector('.js-save-edit-booking')?.addEventListener('click', () => {
    const patch = {
      contact: {
        name: document.getElementById('ebContactName')?.value?.trim() || '',
        phone: document.getElementById('ebContactPhone')?.value?.trim() || ''
      },
      schedule: {
        dateISO: document.getElementById('ebDof')?.value || schedule.dateISO,
        plannedTimeLocalHHMM: document.getElementById('ebArrTime')?.value || schedule.plannedTimeLocalHHMM || schedule.arrivalTimeLocalHHMM,
        plannedTimeKind: schedule.plannedTimeKind || 'ARR',
        arrivalTimeLocalHHMM: document.getElementById('ebArrTime')?.value || schedule.arrivalTimeLocalHHMM,
        stayHours: parseFloat(document.getElementById('ebStayHours')?.value) || 0
      },
      aircraft: {
        registration: (document.getElementById('ebReg')?.value || '').toUpperCase().trim(),
        type: (document.getElementById('ebType')?.value || '').toUpperCase().trim(),
        callsign: (document.getElementById('ebCallsign')?.value || '').toUpperCase().trim(),
        pob: parseInt(document.getElementById('ebPob')?.value) || 1
      },
      movement: {
        departure: (document.getElementById('ebDepAd')?.value || '').toUpperCase().trim()
      },
      ops: {
        notes: document.getElementById('ebNotes')?.value?.trim() || ''
      }
    };

    updateBooking(bookingId, patch);

    // Sync shared fields to linked strip(s)
    const linkedStrips = getMovements().filter(m => m.bookingId === bookingId);
    linkedStrips.forEach(strip => {
      const stripPatch = {
        registration: patch.aircraft.registration || strip.registration,
        type: patch.aircraft.type || strip.type,
        callsignCode: patch.aircraft.callsign || strip.callsignCode,
        callsignLabel: patch.aircraft.callsign || strip.callsignLabel,
        pob: patch.aircraft.pob,
        dof: patch.schedule.dateISO || strip.dof,
        depAd: (patch.movement.departure || strip.depAd)
      };
      // Sync time based on flight type
      // Prefer canonical plannedTimeLocalHHMM, fallback to arrivalTimeLocalHHMM for backward compat
      const plannedTime = patch.schedule.plannedTimeLocalHHMM || patch.schedule.arrivalTimeLocalHHMM;
      const ft = (strip.flightType || '').toUpperCase();
      if (ft === 'ARR' || ft === 'LOC') {
        stripPatch.arrPlanned = plannedTime || strip.arrPlanned;
      }
      if (ft === 'LOC' || ft === 'DEP') {
        stripPatch.depPlanned = plannedTime || strip.depPlanned;
      }
      // Append booking notes to remarks without clobbering controller notes
      if (patch.ops.notes) {
        const remarksBase = (strip.remarks || '').replace(/; ?Booking #\d+.*$/, '').trim();
        stripPatch.remarks = remarksBase ? `${remarksBase}; ${patch.ops.notes}` : patch.ops.notes;
      }
      updateMovement(strip.id, stripPatch);
    });

    showToast('Booking updated', 'success');
    modalRoot.innerHTML = '';
    // Refresh drawer if still open
    openBookingDrawer(bookingId);
    renderCalendar();
    window.dispatchEvent(new CustomEvent("fdms:data-changed", { detail: { source: "booking" } }));
  });
}

/**
 * Cancel a booking – prompts whether to also cancel linked strip(s).
 */
function handleCancelBooking(bookingId) {
  const booking = getBookingById(bookingId);
  if (!booking) return;

  const linkedStrips = getMovements().filter(m => m.bookingId === bookingId);
  const cancelStrips = linkedStrips.length > 0
    ? confirm('Also cancel linked strip(s)? (default: Yes)')
    : false;

  updateBooking(bookingId, { status: 'CANCELLED', cancelledAt: new Date().toISOString() });

  if (cancelStrips) {
    linkedStrips.forEach(strip => {
      if (strip.status !== 'CANCELLED' && strip.status !== 'COMPLETED') {
        updateMovement(strip.id, { status: 'CANCELLED' });
      }
    });
  } else {
    clearStripLinks(bookingId);
  }

  showToast('Booking cancelled', 'info');
  openBookingDrawer(bookingId); // refresh drawer
  renderCalendar();
  window.dispatchEvent(new CustomEvent("fdms:data-changed", { detail: { source: "booking" } }));
}

/**
 * Delete a booking – prompts whether to also cancel linked strip(s) (default YES = cancel, not hard-delete).
 */
function handleDeleteBooking(bookingId) {
  const booking = getBookingById(bookingId);
  if (!booking) return;

  if (!confirm(`Delete Booking #${bookingId}? This cannot be undone.`)) return;

  const linkedStrips = getMovements().filter(m => m.bookingId === bookingId);
  const cancelStrips = linkedStrips.length > 0
    ? confirm('Cancel linked strip(s)? Strips will remain as CANCELLED in history.')
    : false;

  if (cancelStrips) {
    linkedStrips.forEach(strip => {
      if (strip.status !== 'CANCELLED' && strip.status !== 'COMPLETED') {
        updateMovement(strip.id, { status: 'CANCELLED' });
      }
    });
  } else {
    clearStripLinks(bookingId);
  }

  deleteBooking(bookingId);
  showToast('Booking deleted', 'info');
  closeBookingDrawer();
  renderCalendar();
  window.dispatchEvent(new CustomEvent("fdms:data-changed", { detail: { source: "booking" } }));
}

/* -----------------------------
   Calendar Event Edit Modal
------------------------------ */

function openEditCalendarEventModal(eventId) {
  ensureCalendarEventsInitialised();
  const event = calendarEvents.find(e => e.id === eventId);
  if (!event) return;

  const modalRoot = byId('modalRoot');
  if (!modalRoot) return;

  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" style="max-width: 480px;">
        <div class="modal-header">
          <div>
            <div class="modal-title">Edit Calendar Event</div>
          </div>
          <button class="btn btn-ghost js-close-modal" type="button" title="Close">&#x2715;</button>
        </div>
        <div class="modal-body">
          <div class="modal-field">
            <label class="modal-label">Title</label>
            <input id="eeTitle" class="modal-input" value="${escapeHtml(event.title || '')}" />
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;">
            <div class="modal-field" style="flex:1;min-width:140px;">
              <label class="modal-label">Date</label>
              <input id="eeDate" type="date" class="modal-input" value="${escapeHtml(event.date || '')}" />
            </div>
            <div class="modal-field" style="flex:0 0 90px;">
              <label class="modal-label">Time</label>
              <input id="eeTime" type="time" class="modal-input" value="${escapeHtml(event.time || '')}" />
            </div>
          </div>
          <div class="modal-field">
            <label class="modal-label">Description</label>
            <textarea id="eeDescription" class="modal-textarea" rows="2">${escapeHtml(event.description || '')}</textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost js-close-modal" type="button">Cancel</button>
          <button class="btn btn-ghost btn-small js-delete-calendar-event" type="button" style="color:#d32f2f;" data-event-id="${eventId}">Delete</button>
          <button class="btn btn-primary js-save-calendar-event" type="button" data-event-id="${eventId}">Save</button>
        </div>
      </div>
    </div>
  `;

  modalRoot.querySelectorAll('.js-close-modal').forEach(btn => {
    btn.addEventListener('click', () => { modalRoot.innerHTML = ''; });
  });

  modalRoot.querySelector('.js-save-calendar-event')?.addEventListener('click', () => {
    updateCalendarEvent(eventId, {
      title: document.getElementById('eeTitle')?.value?.trim() || event.title,
      date: document.getElementById('eeDate')?.value || event.date,
      time: document.getElementById('eeTime')?.value || event.time,
      description: document.getElementById('eeDescription')?.value?.trim() || ''
    });
    showToast('Event updated', 'success');
    modalRoot.innerHTML = '';
    renderCalendar();
  });

  modalRoot.querySelector('.js-delete-calendar-event')?.addEventListener('click', () => {
    if (confirm('Delete this calendar event?')) {
      deleteCalendarEvent(eventId);
      showToast('Event deleted', 'info');
      modalRoot.innerHTML = '';
      renderCalendar();
    }
  });
}

/* -----------------------------
   Initialization
------------------------------ */

export function initBookingPage() {
  // Initialize booking profiles
  ensureProfilesInitialised();

  // Set default date to today
  const dofInput = byId('bookingDof');
  if (dofInput) {
    const today = new Date().toISOString().split('T')[0];
    dofInput.value = today;
  }

  // Set default CUIW checkbox
  const cuiwCheckbox = byId('bookingHasCuiw');
  if (cuiwCheckbox) {
    cuiwCheckbox.checked = false;
  }

  // Add input listeners for live updates
  const inputIds = [
    'bookingContactName', 'bookingContactPhone',
    'bookingDof', 'bookingArrivalTime', 'bookingStayHours',
    'bookingRegistration', 'bookingCallsign', 'bookingAircraftType',
    'bookingMtow', 'bookingMtowUnit', 'bookingPob',
    'bookingDepartureAd', 'bookingDepartureName', 'bookingLandingsCount', 'bookingArrivalType',
    'bookingTrainingRate', 'bookingHasCuiw', 'bookingParkingRequired', 'bookingFuelRequired',
    'bookingVisitingCars', 'bookingNotes'
  ];

  inputIds.forEach(id => {
    const el = byId(id);
    if (el) {
      el.addEventListener('input', updateAll);
      el.addEventListener('change', updateAll);
    }
  });

  // Registration input - add special handler for autofill on blur
  // This ensures autofill runs when user tabs away from registration field
  const regInput = byId('bookingRegistration');
  if (regInput) {
    regInput.addEventListener('blur', () => {
      lastProcessedRegistration = ''; // Force re-process on blur
      runRegistrationAutofill();
    });
  }

  // Type input - trigger MTOW autofill when type changes manually
  const typeInput = byId('bookingAircraftType');
  if (typeInput) {
    typeInput.addEventListener('blur', runTypeMtowAutofill);
  }

  // Registry lookup buttons
  byId('btnCaaGinfo')?.addEventListener('click', openCaaGinfo);
  byId('btnFaaRegistry')?.addEventListener('click', openFaaRegistry);

  // Profile export/import buttons
  byId('btnExportProfiles')?.addEventListener('click', handleProfileExport);
  byId('btnImportProfiles')?.addEventListener('click', handleProfileImport);

  // Action buttons
  byId('btnResetBooking')?.addEventListener('click', resetForm);
  byId('btnCreateBooking')?.addEventListener('click', createBookingAndStrip);

  // Initial update
  updateAll();
}

export function initCalendarPage() {
  // View mode selector buttons
  document.querySelectorAll('.cal-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      calendarViewMode = btn.dataset.view;
      renderCalendar();
    });
  });

  // Calendar navigation – behaviour depends on current view
  byId('btnCalendarPrev')?.addEventListener('click', () => {
    if (calendarViewMode === 'week') {
      calendarCurrentDate.setDate(calendarCurrentDate.getDate() - 7);
    } else if (calendarViewMode === 'year') {
      calendarCurrentDate.setFullYear(calendarCurrentDate.getFullYear() - 1);
    } else {
      const { year, month } = getCalendarMonth();
      calendarCurrentDate = new Date(year, month - 1, 1);
    }
    renderCalendar();
  });

  byId('btnCalendarNext')?.addEventListener('click', () => {
    if (calendarViewMode === 'week') {
      calendarCurrentDate.setDate(calendarCurrentDate.getDate() + 7);
    } else if (calendarViewMode === 'year') {
      calendarCurrentDate.setFullYear(calendarCurrentDate.getFullYear() + 1);
    } else {
      const { year, month } = getCalendarMonth();
      calendarCurrentDate = new Date(year, month + 1, 1);
    }
    renderCalendar();
  });

  byId('btnCalendarToday')?.addEventListener('click', () => {
    calendarCurrentDate = new Date();
    renderCalendar();
  });

  // Add Event button
  byId('btnAddCalendarEvent')?.addEventListener('click', () => {
    openAddEventModal();
  });

  // Drawer close button
  byId('btnCloseDrawer')?.addEventListener('click', closeBookingDrawer);

  // Initial render
  renderCalendar();
}

/* -----------------------------
   Booking Profiles Admin Panel
------------------------------ */

export function initBookingProfilesAdmin() {
  const panel = byId('bookingProfilesPanel');
  if (!panel) return;

  renderProfilesTable();

  byId('btnNewProfile')?.addEventListener('click', () => {
    openProfileModal(null);
  });

  byId('profileSearchInput')?.addEventListener('input', () => {
    renderProfilesTable();
  });
}

function renderProfilesTable() {
  const tbody = byId('profilesTableBody');
  if (!tbody) return;

  ensureProfilesInitialised();
  const searchVal = (byId('profileSearchInput')?.value || '').toLowerCase().trim();
  const profiles = getAllBookingProfiles();

  const entries = Object.entries(profiles).filter(([key, p]) => {
    if (!searchVal) return true;
    const haystack = `${key} ${p.aircraftType || ''} ${p.callsign || ''} ${p.contactName || ''}`.toLowerCase();
    return haystack.includes(searchVal);
  });

  if (entries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:#999;padding:12px;text-align:center;">No profiles found.</td></tr>';
    return;
  }

  tbody.innerHTML = entries.map(([key, p]) => {
    const saved = p.last_saved ? new Date(p.last_saved).toLocaleDateString() : '-';
    return `<tr>
      <td>${escapeHtml(p.registration_display || key)}</td>
      <td>${escapeHtml(p.aircraftType || '-')}</td>
      <td>${escapeHtml(p.callsign || '-')}</td>
      <td>${escapeHtml(p.contactName || '-')}</td>
      <td>${saved}</td>
      <td style="text-align:right;white-space:nowrap;">
        <button type="button" class="btn btn-ghost btn-small js-edit-profile" data-reg="${escapeHtml(key)}">Edit</button>
        <button type="button" class="btn btn-ghost btn-small js-delete-profile" data-reg="${escapeHtml(key)}" style="color:#d32f2f;">Delete</button>
      </td>
    </tr>`;
  }).join('');

  // Bind edit/delete
  tbody.querySelectorAll('.js-edit-profile').forEach(btn => {
    btn.addEventListener('click', () => openProfileModal(btn.dataset.reg));
  });
  tbody.querySelectorAll('.js-delete-profile').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm(`Delete profile for ${btn.dataset.reg}?`)) {
        deleteBookingProfile(btn.dataset.reg);
        showToast('Profile deleted', 'info');
        renderProfilesTable();
      }
    });
  });
}

function openProfileModal(reg) {
  const modalRoot = byId('modalRoot');
  if (!modalRoot) return;

  const profile = reg ? (getBookingProfile(reg) || {}) : {};
  const isNew = !reg;
  const title = isNew ? 'New Booking Profile' : `Edit Profile – ${reg}`;

  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" style="max-width: 480px;">
        <div class="modal-header">
          <div><div class="modal-title">${escapeHtml(title)}</div></div>
          <button class="btn btn-ghost js-close-modal" type="button" title="Close">&#x2715;</button>
        </div>
        <div class="modal-body">
          <div class="modal-field">
            <label class="modal-label">Registration <span class="required-mark">*</span></label>
            <input id="ppReg" class="modal-input" value="${escapeHtml(reg || '')}" ${!isNew ? 'readonly style="background:#f5f5f5;"' : 'style="text-transform:uppercase;"'} />
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;">
            <div class="modal-field" style="flex:1;">
              <label class="modal-label">Callsign</label>
              <input id="ppCallsign" class="modal-input" value="${escapeHtml(profile.callsign || '')}" style="text-transform:uppercase;" />
            </div>
            <div class="modal-field" style="flex:1;">
              <label class="modal-label">Aircraft type</label>
              <input id="ppType" class="modal-input" value="${escapeHtml(profile.aircraftType || '')}" style="text-transform:uppercase;" />
            </div>
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;">
            <div class="modal-field" style="flex:1;">
              <label class="modal-label">MTOW</label>
              <input id="ppMtow" type="number" class="modal-input" value="${profile.mtow || ''}" step="1" />
            </div>
            <div class="modal-field" style="flex:0 0 80px;">
              <label class="modal-label">Unit</label>
              <select id="ppMtowUnit" class="modal-input">
                <option value="kg" ${profile.mtowUnit === 'kg' ? 'selected' : ''}>kg</option>
                <option value="t" ${profile.mtowUnit === 't' ? 'selected' : ''}>tonnes</option>
              </select>
            </div>
          </div>
          <div class="modal-field">
            <label class="booking-checkbox-label">
              <input type="checkbox" id="ppCuiw" ${profile.hasCuiw ? 'checked' : ''} />
              <span>Has CUIW</span>
            </label>
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;">
            <div class="modal-field" style="flex:1;">
              <label class="modal-label">Contact name</label>
              <input id="ppContactName" class="modal-input" value="${escapeHtml(profile.contactName || '')}" />
            </div>
            <div class="modal-field" style="flex:1;">
              <label class="modal-label">Contact phone</label>
              <input id="ppContactPhone" class="modal-input" value="${escapeHtml(profile.contactPhone || '')}" />
            </div>
          </div>
          <div class="modal-field">
            <label class="modal-label">Departure AD</label>
            <input id="ppDepAd" class="modal-input" value="${escapeHtml(profile.departureAd || '')}" style="text-transform:uppercase;" />
          </div>
          <div class="modal-field">
            <label class="modal-label">Notes</label>
            <textarea id="ppNotes" class="modal-textarea" rows="2">${escapeHtml(profile.notes || '')}</textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost js-close-modal" type="button">Cancel</button>
          <button class="btn btn-primary js-save-profile" type="button">Save</button>
        </div>
      </div>
    </div>
  `;

  modalRoot.querySelectorAll('.js-close-modal').forEach(btn => {
    btn.addEventListener('click', () => { modalRoot.innerHTML = ''; });
  });

  modalRoot.querySelector('.js-save-profile')?.addEventListener('click', () => {
    const regVal = (document.getElementById('ppReg')?.value || '').toUpperCase().trim();
    if (!regVal) { showToast('Registration is required', 'error'); return; }

    saveBookingProfile(regVal, {
      callsign: (document.getElementById('ppCallsign')?.value || '').toUpperCase().trim(),
      aircraftType: (document.getElementById('ppType')?.value || '').toUpperCase().trim(),
      mtow: parseFloat(document.getElementById('ppMtow')?.value) || 0,
      mtowUnit: document.getElementById('ppMtowUnit')?.value || 'kg',
      hasCuiw: document.getElementById('ppCuiw')?.checked || false,
      contactName: document.getElementById('ppContactName')?.value?.trim() || '',
      contactPhone: document.getElementById('ppContactPhone')?.value?.trim() || '',
      departureAd: (document.getElementById('ppDepAd')?.value || '').toUpperCase().trim(),
      notes: document.getElementById('ppNotes')?.value?.trim() || ''
    });

    showToast(`Profile saved for ${regVal}`, 'success');
    modalRoot.innerHTML = '';
    renderProfilesTable();
  });
}

/**
 * Open modal to add a calendar event
 */
function openAddEventModal(presetDate = null) {
  const today = presetDate || new Date().toISOString().split('T')[0];

  const modalRoot = document.getElementById('modalRoot');
  if (!modalRoot) return;

  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" style="max-width: 500px;">
        <div class="modal-header">
          <div>
            <div class="modal-title">Add Calendar Event</div>
            <div class="modal-subtitle">Create a new event on the calendar</div>
          </div>
          <button class="btn btn-ghost js-close-modal" type="button" title="Close">✕</button>
        </div>
        <div class="modal-body">
          <div class="modal-field">
            <label class="modal-label">Title</label>
            <input id="eventTitle" class="modal-input" placeholder="Event title" />
          </div>

          <div class="modal-field">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="eventAllDay" style="cursor: pointer;" />
              <span class="modal-label" style="margin: 0;">All-day event</span>
            </label>
          </div>

          <div style="display: flex; gap: 12px; flex-wrap: wrap;">
            <div class="modal-field" style="flex: 1; min-width: 140px;">
              <label class="modal-label">Start Date</label>
              <input id="eventStartDate" type="date" class="modal-input" value="${today}" />
            </div>
            <div class="modal-field js-time-field" style="flex: 0 0 80px;">
              <label class="modal-label">Start Time</label>
              <input id="eventStartTime" class="modal-input" placeholder="HHMM" maxlength="4" />
            </div>
          </div>

          <div style="display: flex; gap: 12px; flex-wrap: wrap;">
            <div class="modal-field" style="flex: 1; min-width: 140px;">
              <label class="modal-label">End Date <span style="font-size: 11px; font-weight: normal;">(optional)</span></label>
              <input id="eventEndDate" type="date" class="modal-input" />
            </div>
            <div class="modal-field js-time-field" style="flex: 0 0 80px;">
              <label class="modal-label">End Time</label>
              <input id="eventEndTime" class="modal-input" placeholder="HHMM" maxlength="4" />
            </div>
          </div>

          <div class="modal-field">
            <label class="modal-label">Repeat</label>
            <select id="eventRepeat" class="modal-input">
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="annually">Annually</option>
            </select>
          </div>

          <div class="modal-field js-repeat-end-field" style="display: none;">
            <label class="modal-label">Repeat until</label>
            <input id="eventRepeatEndDate" type="date" class="modal-input" />
          </div>

          <div class="modal-field">
            <label class="modal-label">Notification</label>
            <select id="eventNotification" class="modal-input">
              <option value="none">None</option>
              <option value="15">15 minutes before</option>
              <option value="30">30 minutes before</option>
              <option value="45" selected>45 minutes before</option>
              <option value="60">1 hour before</option>
              <option value="120">2 hours before</option>
              <option value="1440">1 day before</option>
            </select>
          </div>

          <div class="modal-field">
            <label class="modal-label">Event Type</label>
            <select id="eventType" class="modal-input">
              <option value="general">General</option>
              <option value="meeting">Meeting</option>
              <option value="maintenance">Maintenance</option>
              <option value="closure">Closure</option>
              <option value="training">Training</option>
            </select>
          </div>

          <div class="modal-field">
            <label class="modal-label">Description (optional)</label>
            <textarea id="eventDescription" class="modal-textarea" placeholder="Additional details..."></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost js-close-modal" type="button">Cancel</button>
          <button class="btn btn-primary js-save-event" type="button">Add Event</button>
        </div>
      </div>
    </div>
  `;

  // Toggle time fields based on all-day checkbox
  const allDayCheckbox = document.getElementById('eventAllDay');
  const timeFields = modalRoot.querySelectorAll('.js-time-field');
  allDayCheckbox?.addEventListener('change', () => {
    timeFields.forEach(field => {
      field.style.display = allDayCheckbox.checked ? 'none' : 'block';
    });
  });

  // Toggle repeat end date field based on repeat selection
  const repeatSelect = document.getElementById('eventRepeat');
  const repeatEndField = modalRoot.querySelector('.js-repeat-end-field');
  repeatSelect?.addEventListener('change', () => {
    if (repeatEndField) {
      repeatEndField.style.display = repeatSelect.value === 'none' ? 'none' : 'block';
    }
  });

  // Close handlers
  modalRoot.querySelectorAll('.js-close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
      modalRoot.innerHTML = '';
    });
  });

  // Save handler
  modalRoot.querySelector('.js-save-event')?.addEventListener('click', () => {
    const title = document.getElementById('eventTitle')?.value?.trim() || '';
    const allDay = document.getElementById('eventAllDay')?.checked || false;
    const startDate = document.getElementById('eventStartDate')?.value || '';
    const startTimeRaw = document.getElementById('eventStartTime')?.value || '';
    const endDate = document.getElementById('eventEndDate')?.value || '';
    const endTimeRaw = document.getElementById('eventEndTime')?.value || '';
    const repeat = document.getElementById('eventRepeat')?.value || 'none';
    const repeatEndDate = document.getElementById('eventRepeatEndDate')?.value || '';
    const notification = document.getElementById('eventNotification')?.value || 'none';
    const eventType = document.getElementById('eventType')?.value || 'general';
    const description = document.getElementById('eventDescription')?.value?.trim() || '';

    if (!startDate) {
      showToast('Please select a start date', 'error');
      return;
    }

    if (!title) {
      showToast('Please enter a title', 'error');
      return;
    }

    // Format times if provided and not all-day
    const formatTime = (raw) => {
      if (!raw) return '';
      const digits = raw.replace(/\D/g, '');
      if (digits.length === 4) {
        const hours = parseInt(digits.slice(0, 2), 10);
        const mins = parseInt(digits.slice(2, 4), 10);
        if (hours >= 0 && hours <= 23 && mins >= 0 && mins <= 59) {
          return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
        }
      }
      return null; // Invalid
    };

    let startTime = '';
    let endTime = '';

    if (!allDay) {
      if (startTimeRaw) {
        startTime = formatTime(startTimeRaw);
        if (startTime === null) {
          showToast('Invalid start time format (use HHMM)', 'error');
          return;
        }
      }
      if (endTimeRaw) {
        endTime = formatTime(endTimeRaw);
        if (endTime === null) {
          showToast('Invalid end time format (use HHMM)', 'error');
          return;
        }
      }
    }

    createCalendarEvent({
      date: startDate,
      endDate: endDate || startDate,
      time: startTime,
      endTime: endTime,
      title: title,
      description: description,
      type: eventType,
      allDay: allDay,
      repeat: repeat,
      repeatEndDate: repeatEndDate,
      notification: notification
    });

    showToast('Calendar event added', 'success');
    renderCalendar();
    modalRoot.innerHTML = '';
  });
}

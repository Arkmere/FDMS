// ui_booking.js
// Handles the Booking page: form, charges calculation, strip preview, and submission.
// ES module, no framework, DOM-contract driven.

import {
  createMovement,
  getConfig
} from "./datamodel.js";

import { showToast } from "./app.js";

import { renderLiveBoard, renderTimeline } from "./ui_liveboard.js";

/* -----------------------------
   Storage for Bookings
------------------------------ */

const BOOKINGS_STORAGE_KEY = "vectair_fdms_bookings_v1";

let bookings = [];
let bookingsInitialised = false;
let nextBookingId = 1;

function loadBookingsFromStorage() {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(BOOKINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.bookings)) {
        return parsed;
      }
    }
    return null;
  } catch (e) {
    console.warn("FDMS Booking: failed to load bookings from storage", e);
    return null;
  }
}

function saveBookingsToStorage() {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const payload = JSON.stringify({
      version: 1,
      timestamp: new Date().toISOString(),
      bookings: bookings
    });
    window.localStorage.setItem(BOOKINGS_STORAGE_KEY, payload);
  } catch (e) {
    console.warn("FDMS Booking: failed to save bookings to storage", e);
  }
}

function ensureBookingsInitialised() {
  if (bookingsInitialised) return;
  const loaded = loadBookingsFromStorage();
  if (loaded && loaded.bookings) {
    bookings = loaded.bookings;
    nextBookingId = bookings.reduce((max, b) => Math.max(max, b.id || 0), 0) + 1;
  } else {
    bookings = [];
    nextBookingId = 1;
  }
  bookingsInitialised = true;
}

export function getBookings() {
  ensureBookingsInitialised();
  return bookings;
}

export function createBooking(bookingData) {
  ensureBookingsInitialised();
  const now = new Date().toISOString();
  const booking = {
    id: nextBookingId++,
    ...bookingData,
    createdAtUtc: now,
    updatedAtUtc: now
  };
  bookings.push(booking);
  saveBookingsToStorage();
  return booking;
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
------------------------------ */

const LANDING_RATE_PER_TONNE_UP_TO_4 = 12.00;
const LANDING_RATE_PER_TONNE_OVER_4 = 16.00;
const PARKING_NET_PER_24H = 16.67;
const PARKING_VAT_RATE = 0.20;
const TRAINING_DISCOUNT = 0.25;

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
    visitingCarsRequired = false
  } = params;

  const landing = calculateLandingFees(mtowTonnes, landingsCount, isTraining);
  const parking = calculateParkingFees(stayHours, parkingRequired);

  // Total: landing fees (no VAT) + parking (with VAT)
  const totalGross = landing.total + parking.gross;

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
    totalGross: Math.round(totalGross * 100) / 100,
    breakdown: [
      { label: 'Landing fees', amount: landing.total, vatIncluded: false },
      ...(parking.gross > 0 ? [{ label: 'Parking', amount: parking.gross, vatIncluded: true }] : [])
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
      pob: parseInt(byId('bookingPob')?.value) || 0
    },
    ops: {
      departureAd: (byId('bookingDepartureAd')?.value || '').toUpperCase().trim(),
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

  return {
    valid: errors.length === 0,
    errors,
    data
  };
}

/* -----------------------------
   UI Update Functions
------------------------------ */

function updateChargesDisplay() {
  const data = getFormData();

  const charges = calculateAllCharges({
    mtowTonnes: data.aircraft.mtowTonnes,
    landingsCount: data.ops.landingsCount,
    isTraining: data.ops.isTraining,
    stayHours: data.schedule.stayHours,
    parkingRequired: data.ops.parkingRequired,
    fuelRequired: data.ops.fuelRequired,
    visitingCarsRequired: data.ops.visitingCarsRequired
  });

  // Update display elements
  byId('chargeLandingNet').textContent = formatCurrency(charges.landing.net);
  byId('chargeParkingGross').textContent = formatCurrency(charges.parking.gross);
  byId('chargeParkingVat').textContent = formatCurrency(charges.parking.vat);
  byId('chargeTotalGross').textContent = formatCurrency(charges.totalGross);

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

  // Route
  const depAd = data.ops.departureAd || 'XXXX';
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

function updateAll() {
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
      // Fallback for older browsers
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

function normalizeRegistration(reg) {
  // Remove common prefixes and normalize
  let normalized = (reg || '').toUpperCase().trim();
  // For G-INFO, remove the G- prefix for search
  if (normalized.startsWith('G-')) {
    return normalized.substring(2); // e.g., G-ABCD -> ABCD
  }
  return normalized;
}

function openCaaGinfo() {
  const reg = byId('bookingRegistration')?.value || '';
  const searchKey = normalizeRegistration(reg);

  if (searchKey) {
    copyToClipboard(searchKey);
    showToast(`Copied '${searchKey}' - paste into G-INFO search`, 'info', 4000);
  }

  window.open('https://www.caa.co.uk/aircraft-register/g-info/search-g-info/', '_blank');
}

function openFaaRegistry() {
  const reg = byId('bookingRegistration')?.value || '';
  let searchKey = (reg || '').toUpperCase().trim();

  // For FAA, N-numbers - keep or remove the N as appropriate
  if (searchKey.startsWith('N')) {
    searchKey = searchKey.substring(1); // Remove N for search
  }

  if (searchKey) {
    copyToClipboard(searchKey);
    showToast(`Copied '${searchKey}' - paste into FAA search`, 'info', 4000);
  }

  window.open('https://registry.faa.gov/aircraftinquiry/Search/NNumberInquiry', '_blank');
}

function copyRegistration() {
  const reg = byId('bookingRegistration')?.value || '';
  const normalized = (reg || '').toUpperCase().trim();

  if (normalized) {
    copyToClipboard(normalized);
    showToast(`Copied '${normalized}' to clipboard`, 'success', 3000);
  } else {
    showToast('No registration to copy', 'warning', 3000);
  }
}

function openRegistration() {
  const reg = byId('bookingRegistration')?.value || '';
  const normalized = (reg || '').toUpperCase().trim();

  if (!normalized) {
    showToast('Enter a registration first', 'warning', 3000);
    return;
  }

  // Detect registry type and open appropriate page
  if (normalized.startsWith('G-')) {
    openCaaGinfo();
  } else if (normalized.startsWith('N')) {
    openFaaRegistry();
  } else if (normalized.startsWith('M-')) {
    // Manx (Isle of Man) registry
    copyToClipboard(normalized);
    showToast(`Copied '${normalized}' - paste into search`, 'info', 4000);
    window.open('https://ardis.iomaircraftregistry.com/register/search', '_blank');
  } else {
    // Generic - just copy and show info
    copyToClipboard(normalized);
    showToast(`Copied '${normalized}' - check appropriate registry`, 'info', 4000);
  }
}

/* -----------------------------
   Booking Submission
------------------------------ */

function resetForm() {
  // Reset all form fields
  const form = document.querySelector('#tab-booking');
  if (form) {
    form.querySelectorAll('input[type="text"], input[type="tel"], input[type="date"], input[type="time"], input[type="number"], textarea').forEach(el => {
      el.value = '';
    });
    form.querySelectorAll('input[type="checkbox"]').forEach(el => {
      // Reset to defaults
      if (el.id === 'bookingParkingRequired') {
        el.checked = true;
      } else {
        el.checked = false;
      }
    });
    form.querySelectorAll('select').forEach(el => {
      el.selectedIndex = 0;
    });
  }

  // Set default date to today
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
    visitingCarsRequired: data.ops.visitingCarsRequired
  });

  // Create booking record
  const booking = createBooking({
    contact: data.contact,
    schedule: {
      dateISO: data.schedule.dof,
      arrivalTimeLocalHHMM: data.schedule.arrivalTime,
      stayHours: data.schedule.stayHours
    },
    aircraft: {
      registration: data.aircraft.registration,
      callsign: data.aircraft.callsign || data.aircraft.registration,
      type: data.aircraft.type,
      pob: data.aircraft.pob,
      mtowTonnes: data.aircraft.mtowTonnes
    },
    movement: {
      departure: data.ops.departureAd,
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
      totalGross: charges.totalGross,
      breakdown: charges.breakdown
    }
  });

  // Build remarks string
  const remarksParts = [];
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
  if (data.ops.notes) {
    remarksParts.push(data.ops.notes);
  }
  const remarks = remarksParts.join('; ') || `Booking #${booking.id}`;

  // Create planned movement strip
  const flightType = data.ops.arrivalType;
  const isLocal = flightType === 'LOC';

  const movement = createMovement({
    status: 'PLANNED',
    callsignCode: data.aircraft.callsign || data.aircraft.registration,
    callsignLabel: data.aircraft.callsign || data.aircraft.registration,
    callsignVoice: '',
    registration: data.aircraft.registration,
    type: data.aircraft.type,
    wtc: 'L (ICAO)', // Default; user can update later
    depAd: isLocal ? 'EGOW' : data.ops.departureAd,
    depName: '',
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
    egowCode: 'VC', // Visiting Civil by default
    egowDesc: 'Visiting Civil Fixed-Wing',
    unitCode: '',
    unitDesc: '',
    captain: data.contact.name,
    pob: data.aircraft.pob,
    remarks: remarks,
    formation: null,
    bookingId: booking.id // Link to booking
  });

  // Success!
  showToast(`Booking created! Strip added to Live Board.`, 'success', 5000);

  // Re-render Live Board
  renderLiveBoard();
  renderTimeline();

  // Navigate to Live Board tab
  const liveTab = document.querySelector('[data-tab="tab-live"]');
  if (liveTab) {
    liveTab.click();
  }

  // Reset the form for next booking
  resetForm();
}

/* -----------------------------
   Initialization
------------------------------ */

export function initBookingPage() {
  // Set default date to today
  const dofInput = byId('bookingDof');
  if (dofInput) {
    const today = new Date().toISOString().split('T')[0];
    dofInput.value = today;
  }

  // Add input listeners for live updates
  const inputIds = [
    'bookingContactName', 'bookingContactPhone',
    'bookingDof', 'bookingArrivalTime', 'bookingStayHours',
    'bookingRegistration', 'bookingCallsign', 'bookingAircraftType',
    'bookingMtow', 'bookingMtowUnit', 'bookingPob',
    'bookingDepartureAd', 'bookingLandingsCount', 'bookingArrivalType',
    'bookingTrainingRate', 'bookingParkingRequired', 'bookingFuelRequired',
    'bookingVisitingCars', 'bookingNotes'
  ];

  inputIds.forEach(id => {
    const el = byId(id);
    if (el) {
      el.addEventListener('input', updateAll);
      el.addEventListener('change', updateAll);
    }
  });

  // Registry lookup buttons
  byId('btnCaaGinfo')?.addEventListener('click', openCaaGinfo);
  byId('btnFaaRegistry')?.addEventListener('click', openFaaRegistry);
  byId('btnCopyReg')?.addEventListener('click', copyRegistration);
  byId('btnOpenReg')?.addEventListener('click', openRegistration);

  // Action buttons
  byId('btnResetBooking')?.addEventListener('click', resetForm);
  byId('btnCreateBooking')?.addEventListener('click', createBookingAndStrip);

  // Initial update
  updateAll();
}

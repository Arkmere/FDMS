// stores/bookingsStore.js
// UI-agnostic booking persistence helpers.
// No imports from ui_booking.js or ui_liveboard.js.

const BOOKINGS_STORAGE_KEY = "vectair_fdms_bookings_v1";

let bookings = [];
let bookingsInitialised = false;
let nextBookingId = 1;

function ensureInitialised() {
  if (bookingsInitialised) return;
  const loaded = loadFromStorage();
  if (loaded && loaded.bookings) {
    bookings = loaded.bookings;

    // Migration: populate plannedTimeLocalHHMM from arrivalTimeLocalHHMM if missing
    let migrated = false;
    bookings.forEach(b => {
      if (b.schedule && !b.schedule.plannedTimeLocalHHMM && b.schedule.arrivalTimeLocalHHMM) {
        b.schedule.plannedTimeLocalHHMM = b.schedule.arrivalTimeLocalHHMM;
        // Infer kind if possible (default to ARR for backward compatibility)
        if (!b.schedule.plannedTimeKind) {
          b.schedule.plannedTimeKind = 'ARR';
        }
        migrated = true;
      }
    });

    if (migrated) {
      saveToStorage(); // Persist migration
    }

    nextBookingId = bookings.reduce((max, b) => Math.max(max, b.id || 0), 0) + 1;
  } else {
    bookings = [];
    nextBookingId = 1;
  }
  bookingsInitialised = true;
}

function loadFromStorage() {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(BOOKINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed && Array.isArray(parsed.bookings)) ? parsed : null;
  } catch (e) {
    console.warn("FDMS bookingsStore: failed to load", e);
    return null;
  }
}

function saveToStorage() {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const payload = JSON.stringify({
      version: 1,
      timestamp: new Date().toISOString(),
      bookings
    });
    window.localStorage.setItem(BOOKINGS_STORAGE_KEY, payload);
  } catch (e) {
    console.warn("FDMS bookingsStore: failed to save", e);
  }
}

export function loadBookings() {
  ensureInitialised();
  return bookings;
}

export function saveBookings(newBookings) {
  ensureInitialised();
  bookings = newBookings;
  saveToStorage();
}

export function getBookingById(id) {
  ensureInitialised();
  return bookings.find(b => b.id === id) || null;
}

/**
 * Update a booking by ID with a patch object.
 * Deep-merges known nested keys, then shallow-assigns the rest.
 * @param {number} id – Booking ID
 * @param {object} patch – Partial booking update
 * @returns {object|null} Updated booking or null if not found
 */
export function updateBookingById(id, patch) {
  ensureInitialised();
  const booking = bookings.find(b => b.id === id);
  if (!booking) return null;

  // Deep-merge nested objects
  const nestedKeys = ['contact', 'schedule', 'aircraft', 'movement', 'ops', 'charges'];
  const flatPatch = { ...patch };
  for (const key of nestedKeys) {
    if (flatPatch[key] && typeof flatPatch[key] === 'object' && booking[key] && typeof booking[key] === 'object') {
      booking[key] = { ...booking[key], ...flatPatch[key] };
      delete flatPatch[key];
    }
  }
  Object.assign(booking, flatPatch);
  booking.updatedAtUtc = new Date().toISOString();
  saveToStorage();
  return booking;
}

export function deleteBookingById(id) {
  ensureInitialised();
  const index = bookings.findIndex(b => b.id === id);
  if (index === -1) return false;
  bookings.splice(index, 1);
  saveToStorage();
  return true;
}

export function createBooking(data) {
  ensureInitialised();
  const now = new Date().toISOString();
  const booking = {
    id: nextBookingId++,
    createdAtUtc: now,
    updatedAtUtc: now,
    ...data
  };
  bookings.push(booking);
  saveToStorage();
  return booking;
}

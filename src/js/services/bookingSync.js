// services/bookingSync.js
// Centralised booking↔strip sync and referential-integrity helpers.
// Imports only from datamodel.js and bookingsStore.js — free of UI-module cycles.

import { getMovements, updateMovement } from "../datamodel.js";
import { loadBookings, updateBookingById, getBookingById } from "../stores/bookingsStore.js";

/* ──────────────────────────────────────────────
   Public API
───────────────────────────────────────────── */

/**
 * Called after a strip (movement) is edited and saved.
 * Builds the booking patch from the movement's current (post-update) state
 * and dispatches it so ui_booking.js can apply it without a direct dependency.
 * @param {object} movement – The movement object AFTER updateMovement has been called
 *                             (same object reference, already mutated via Object.assign).
 */
export function onMovementUpdated(movement) {
  if (!movement?.bookingId) return;

  const patch = {};
  patch.schedule = { dateISO: movement.dof };

  const ft = (movement.flightType || '').toUpperCase();
  if (ft === 'ARR' || ft === 'LOC') {
    patch.schedule.arrivalTimeLocalHHMM = movement.arrPlanned;
  } else if (ft === 'DEP') {
    patch.schedule.arrivalTimeLocalHHMM = movement.depPlanned;
  }

  patch.aircraft = {
    registration: movement.registration,
    type: movement.type,
    callsign: movement.callsignCode,
    pob: movement.pob
  };

  patch.movement = {
    departure: movement.depAd,
    departureName: movement.depName
  };

  patch.ops = { notesFromStrip: movement.remarks };

  _dispatchBookingPatch(movement.bookingId, patch);
}

/**
 * Called after a strip transitions to COMPLETED or CANCELLED.
 * Syncs the new status to the linked booking via event dispatch.
 * @param {object} movement – Movement object (bookingId must be present)
 * @param {string} newStatus – "COMPLETED" or "CANCELLED"
 */
export function onMovementStatusChanged(movement, newStatus) {
  if (!movement?.bookingId) return;

  const now = new Date().toISOString();
  const patch = newStatus === 'COMPLETED'
    ? { status: 'COMPLETED', completedAt: now }
    : { status: 'CANCELLED', cancelledAt: now };

  _dispatchBookingPatch(movement.bookingId, patch);
}

/**
 * Clear the bookingId pointer on every strip linked to the given booking.
 * Call this when a booking is deleted or cancelled WITHOUT also
 * cancelling/deleting the strips, to prevent orphaned references.
 * @param {string|number} bookingId
 */
export function clearStripLinks(bookingId) {
  const strips = getMovements().filter(m => m.bookingId === bookingId);
  strips.forEach(strip => {
    updateMovement(strip.id, { bookingId: null });
  });
}

/**
 * One-time startup reconciliation.
 * Enforces referential integrity: clears any movement.bookingId pointing to
 * a non-existent booking.
 * Safe to call repeatedly – only fixes actual inconsistencies.
 * @returns {object} Summary: { movementsFixed: number }
 */
export function reconcileLinks() {
  const movements = getMovements();
  const bookings = loadBookings();
  const bookingIds = new Set(bookings.map(b => b.id));

  let movementsFixed = 0;

  movements.forEach(m => {
    if (m.bookingId && !bookingIds.has(m.bookingId)) {
      updateMovement(m.id, { bookingId: null });
      movementsFixed++;
    }
  });

  return { movementsFixed };
}

/* ──────────────────────────────────────────────
   Internal
───────────────────────────────────────────── */

let _patchInProgress = false;

function _dispatchBookingPatch(bookingId, patch) {
  // Reentrancy guard: prevent event storms
  if (_patchInProgress) return;

  _patchInProgress = true;
  try {
    const updated = updateBookingById(bookingId, patch);
    if (updated) {
      // Trigger UI refresh (calendar, booking drawer, etc.)
      window.dispatchEvent(new CustomEvent("fdms:data-changed", {
        detail: { source: "bookingSync" }
      }));
    }
  } finally {
    _patchInProgress = false;
  }
}

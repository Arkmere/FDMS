// services/bookingSync.js
// Centralised booking↔strip sync and referential-integrity helpers.
// Imports only from datamodel.js — keeps this module free of UI-module cycles.
// Communication back to ui_booking.js is via synchronous CustomEvents,
// so no import of that module is required.

import { getMovements, updateMovement } from "../datamodel.js";

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
 * Dispatches fdms:reconcile-links; ui_booking.js listens and clears any
 * movement.bookingId that points to a booking that no longer exists.
 * Safe to call repeatedly – is a no-op when data is already consistent.
 */
export function reconcileLinks() {
  window.dispatchEvent(new CustomEvent("fdms:reconcile-links"));
}

/* ──────────────────────────────────────────────
   Internal
───────────────────────────────────────────── */

function _dispatchBookingPatch(bookingId, patch) {
  window.dispatchEvent(new CustomEvent("fdms:booking-patch", {
    detail: { bookingId, patch }
  }));
}

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
  let plannedTime = null;
  let plannedKind = null;

  if (ft === 'ARR') {
    plannedTime = movement.arrPlanned;
    plannedKind = 'ARR';
  } else if (ft === 'LOC') {
    plannedTime = movement.arrPlanned;
    plannedKind = 'LOC';
  } else if (ft === 'DEP') {
    plannedTime = movement.depPlanned;
    plannedKind = 'DEP';
  }

  // Canonical planned time fields
  if (plannedTime) {
    patch.schedule.plannedTimeLocalHHMM = plannedTime;
    patch.schedule.plannedTimeKind = plannedKind;

    // Backward compatibility: only write arrivalTimeLocalHHMM for ARR/LOC
    if (plannedKind === 'ARR' || plannedKind === 'LOC') {
      patch.schedule.arrivalTimeLocalHHMM = plannedTime;
    }
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
 * Enforces bidirectional referential integrity between bookings and strips.
 * Deterministic conflict resolution (conservative: clear stale pointers).
 * Safe to call repeatedly – only fixes actual inconsistencies.
 * @returns {object} Summary: { clearedMovementBookingId, clearedBookingLinkedStripId, repairedBookingLinkedStripId, conflicts }
 */
export function reconcileLinks() {
  const movements = getMovements();
  const bookings = loadBookings();
  const bookingIds = new Set(bookings.map(b => b.id));
  const movementIds = new Set(movements.map(m => m.id));

  let clearedMovementBookingId = 0;
  let clearedBookingLinkedStripId = 0;
  let repairedBookingLinkedStripId = 0;
  let conflicts = 0;

  // Pass 1: Clear movement.bookingId if booking missing
  movements.forEach(m => {
    if (m.bookingId && !bookingIds.has(m.bookingId)) {
      updateMovement(m.id, { bookingId: null });
      clearedMovementBookingId++;
    }
  });

  // Pass 2: Handle booking.linkedStripId integrity and mismatches
  // Build map of bookingId -> [movements claiming it]
  const bookingIdToMovements = new Map();
  movements.forEach(m => {
    if (m.bookingId) {
      if (!bookingIdToMovements.has(m.bookingId)) {
        bookingIdToMovements.set(m.bookingId, []);
      }
      bookingIdToMovements.get(m.bookingId).push(m);
    }
  });

  bookings.forEach(b => {
    if (!b.linkedStripId) {
      // Booking has no linkedStripId but strips may claim it
      const claimingMovements = bookingIdToMovements.get(b.id) || [];
      if (claimingMovements.length === 1) {
        // Repair: single strip claims this booking, set linkedStripId
        updateBookingById(b.id, { linkedStripId: claimingMovements[0].id });
        repairedBookingLinkedStripId++;
      } else if (claimingMovements.length > 1) {
        // Conflict: multiple strips claim same booking, cannot determine truth
        conflicts++;
      }
    } else {
      // Booking has linkedStripId
      if (!movementIds.has(b.linkedStripId)) {
        // linkedStripId points to non-existent movement
        updateBookingById(b.id, { linkedStripId: null });
        clearedBookingLinkedStripId++;
      } else {
        // linkedStripId exists; check if it points back
        const linkedMovement = movements.find(m => m.id === b.linkedStripId);
        if (linkedMovement && linkedMovement.bookingId !== b.id) {
          // Mismatch: booking points to strip, but strip points elsewhere or nowhere
          updateBookingById(b.id, { linkedStripId: null });
          clearedBookingLinkedStripId++;
        }
      }
    }
  });

  return {
    clearedMovementBookingId,
    clearedBookingLinkedStripId,
    repairedBookingLinkedStripId,
    conflicts
  };
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
      if (window.__FDMS_DIAGNOSTICS__ && window.__fdmsDiag) window.__fdmsDiag.dataChangedDispatched++;
      // Trigger UI refresh (calendar, booking drawer, etc.)
      window.dispatchEvent(new CustomEvent("fdms:data-changed", {
        detail: { source: "bookingSync" }
      }));
    }
  } finally {
    _patchInProgress = false;
  }
}

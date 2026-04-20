// ui_liveboard.js
// Handles rendering and interactions for the Live Board, History, Reports, VKB, and Admin panels.
// ES module, no framework, DOM-contract driven.

import {
  getMovements,
  statusClass,
  statusLabel,
  createMovement,
  updateMovement,
  deleteMovement,
  inferTypeFromReg,
  getETD,
  getATD,
  getETA,
  getATA,
  getECT,
  getACT,
  getConfig,
  updateConfig,
  convertUTCToLocal,
  convertLocalToUTC,
  getTimezoneOffsetLabel,
  validateTime,
  validateDate,
  validateNumberRange,
  validateRequired,
  checkPastTime,
  computeFormationWTC,
  updateFormationElement,
  cascadeFormationStatus,
  isValidWtcChar,
  isValidIcaoAd,
  getDurationSource,
  resolvedStartTime,
  resolvedEndTime,
  recalculateTimingModel,
  getCancelledSorties,
  saveCancelledSorties,
  appendCancelledSortie,
  ensureCancelledSortiesInitialised,
  getDeletedStrips,
  saveDeletedStrips,
  appendDeletedStrip,
  purgeExpiredDeletedStrips,
  insertRestoredMovement,
  ensureDeletedStripsInitialised,
  DELETED_STRIPS_RETENTION_HOURS
} from "./datamodel.js";

import { showToast } from "./app.js";

import { onMovementUpdated, onMovementStatusChanged, clearStripLinks } from "./services/bookingSync.js";
import { getBookingById, updateBookingById } from "./stores/bookingsStore.js";

import {
  searchAll,
  getVKBStatus,
  getAutocompleteSuggestions,
  lookupRegistration,
  lookupRegistrationByFixedCallsign,
  lookupCallsign,
  lookupLocation,
  getLocationName,
  lookupAircraftType,
  getWTC,
  getVoiceCallsignForDisplay,
  lookupCaptainFromEgowCodes,
  lookupUnitCodeFromEgowCodes,
  lookupUnitFromCallsign,
  lookupOperatorFromCallsign,
  validateSquawkCode,
  isKnownContraction
} from "./vkb.js";

/* -----------------------------
   State
------------------------------ */

let expandedId = null;
let historyExpandedId = null;

// Tracks the active modal keyboard handler so it can always be cleaned up,
// even when the modal is closed via modalRoot.innerHTML = "" rather than the
// X-button path that calls closeModal().  This prevents keyHandler leaks that
// accumulate over the session and cause toast storms on every Enter keypress.
let _modalKeyHandler = null;
// Invariant: _modalOpen === true iff a keyHandler is registered on document.
// Checked by _checkModalInvariant() when __FDMS_DIAGNOSTICS__ is active.
let _modalOpen = false;

/**
 * Diagnostics-gated modal state invariant checker.
 * Only runs when window.__FDMS_DIAGNOSTICS__ is truthy.
 * Records violations to window.__fdmsDiag.modalInvariantViolations[].
 * @param {string} context - Call site label for the log message.
 */
function _checkModalInvariant(context) {
  if (!window.__FDMS_DIAGNOSTICS__ || !window.__fdmsDiag) return;
  const root = byId("modalRoot");
  const hasContent = !!(root && root.children.length > 0);
  const violations = window.__fdmsDiag.modalInvariantViolations =
    window.__fdmsDiag.modalInvariantViolations || [];
  if (_modalOpen && !_modalKeyHandler) {
    console.warn(`[FDMS diag] Modal invariant @${context}: _modalOpen=true but _modalKeyHandler=null`);
    violations.push({ context, violation: "open-no-handler", ts: Date.now() });
  }
  if (!_modalOpen && _modalKeyHandler) {
    console.warn(`[FDMS diag] Modal invariant @${context}: _modalOpen=false but _modalKeyHandler is set (leaked)`);
    violations.push({ context, violation: "closed-leaked-handler", ts: Date.now() });
  }
  if (_modalOpen && !hasContent) {
    console.warn(`[FDMS diag] Modal invariant @${context}: _modalOpen=true but modalRoot is empty`);
    violations.push({ context, violation: "open-no-content", ts: Date.now() });
  }
  // Expose as callable for console inspection
  window.__fdmsDiag.checkModalInvariants = () => _checkModalInvariant("manual");
}

const state = {
  globalFilter: "",
  plannedWindowHours: 24, // Show PLANNED movements within this many hours
  showLocalTimeInModals: false // Show local time conversions in modals
};

/* -----------------------------
   Portal dropdown – overflow-proof
   Menus are reparented to document.body (position:fixed) while open so they
   escape any ancestor with overflow:auto/hidden (e.g. .table-container).
   On close the menu node is moved back to its original parent.
------------------------------ */

let _portalMenu       = null;   // menu element currently portalled, or null
let _portalOrigParent = null;   // original parentNode, saved for restore
let _portalTrigger    = null;   // the trigger button that opened it

function openDropdownPortal(menuEl, triggerBtn) {
  if (_portalMenu) closeDropdownPortal();               // close any open menu first

  _portalOrigParent = menuEl.parentNode;                // remember where it came from
  _portalTrigger    = triggerBtn;

  document.body.appendChild(menuEl);                    // reparent – escapes overflow
  _portalMenu = menuEl;

  // Arm for fixed positioning
  menuEl.style.position  = 'fixed';
  menuEl.style.display   = 'block';
  menuEl.style.right     = 'auto';
  menuEl.style.left      = 'auto';
  menuEl.style.maxHeight = 'none';
  menuEl.style.overflowY = 'visible';
  menuEl.style.marginTop = '0';
  menuEl.style.marginBottom = '0';

  // --- measure natural height off-screen, then position ---
  const btn       = triggerBtn.getBoundingClientRect();
  const viewportH = window.innerHeight;
  const headerEl  = document.querySelector('.header');
  const headerH   = headerEl ? headerEl.getBoundingClientRect().bottom : 0;

  menuEl.style.top = '-9999px';                         // hide while measuring
  const menuH = menuEl.offsetHeight;

  const spaceBelow = viewportH - btn.bottom - 4;
  const spaceAbove = btn.top - headerH - 4;

  let top;
  if (spaceBelow >= menuH) {
    top = btn.bottom + 2;                               // open down
  } else if (spaceAbove >= menuH) {
    top = btn.top - menuH - 2;                          // flip up
  } else if (spaceAbove > spaceBelow) {
    top = headerH + 4;                                  // above is larger – scroll
    menuEl.style.maxHeight = spaceAbove + 'px';
    menuEl.style.overflowY = 'auto';
  } else {
    top = btn.bottom + 2;                               // below is larger – scroll
    menuEl.style.maxHeight = spaceBelow + 'px';
    menuEl.style.overflowY = 'auto';
  }

  menuEl.style.top   = top + 'px';
  menuEl.style.right = (window.innerWidth - btn.right) + 'px';

  // Attach close listeners (removed in closeDropdownPortal)
  document.addEventListener('click',  _portalClickOutside);
  document.addEventListener('keydown', _portalEscape);
  window.addEventListener('resize',   closeDropdownPortal);
  document.addEventListener('scroll',  closeDropdownPortal, true); // capture – catches scroll on any element
}

function closeDropdownPortal() {
  if (!_portalMenu) return;

  const menu   = _portalMenu;
  const parent = _portalOrigParent;

  // Restore into original parent; if that node was destroyed by a re-render just drop it
  if (parent && parent.isConnected) {
    parent.appendChild(menu);
  } else {
    menu.remove();
  }

  menu.style.display    = 'none';
  menu.style.position   = '';
  menu.style.top        = '';
  menu.style.right      = '';
  menu.style.left       = '';
  menu.style.maxHeight  = '';
  menu.style.overflowY  = '';
  menu.style.marginTop  = '';
  menu.style.marginBottom = '';

  _portalMenu       = null;
  _portalOrigParent = null;
  _portalTrigger    = null;

  document.removeEventListener('click',  _portalClickOutside);
  document.removeEventListener('keydown', _portalEscape);
  window.removeEventListener('resize',   closeDropdownPortal);
  document.removeEventListener('scroll',  closeDropdownPortal, true);
}

function _portalClickOutside(e) {
  if (_portalTrigger && _portalTrigger.contains(e.target)) return; // toggle handler owns this
  if (_portalMenu    && _portalMenu.contains(e.target))    return; // click inside menu
  closeDropdownPortal();
}

function _portalEscape(e) {
  if (e.key === 'Escape') closeDropdownPortal();
}

/* -----------------------------
   Small DOM helpers
------------------------------ */

function byId(id) {
  return document.getElementById(id);
}

function firstById(ids) {
  for (const id of ids) {
    const el = byId(id);
    if (el) return el;
  }
  return null;
}

function safeOn(el, eventName, handler) {
  if (!el) return;
  el.addEventListener(eventName, handler);
}

/**
 * Escape HTML to prevent XSS attacks
 * @param {string} s - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(s) {
  // Defensive; most values are demo data, but keep rendering resilient.
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ------------------------------------------------------------------ *
 * EU Civil Registration Normaliser                                     *
 *                                                                      *
 * Inserts a hyphen after known European nationality-mark prefixes when *
 * the user omits it.  Example: GBYUF → G-BYUF, EIFAT → EI-FAT.       *
 * Military serials are intentionally ignored.                          *
 * ------------------------------------------------------------------ */

/**
 * European civil nationality-mark prefixes.
 * Listed longest-first so a 2-char prefix is not consumed by a 1-char one.
 */
const EURO_HYPHEN_PREFIXES = [
  "ZJ", "T7", "3A", "4K", "4L", "4O", "5B", "9A", "9H", "Z3", "Z6",
  "CS", "EI", "EJ", "ER", "ES", "EW", "HA", "HB", "LN", "LX", "OE", "OH", "OK", "OM", "OY",
  "PH", "SE", "S5", "SP", "SX", "TC", "TF", "UR", "YU", "YR", "YL", "LY", "ZA", "GL", "LZ",
  "D", "F", "G", "I", "M", "2",
];

/**
 * Normalise a raw registration string to its hyphenated canonical form.
 *
 * - Uppercases and strips whitespace / stray punctuation (.\/\_).
 * - If already hyphenated in `prefix-suffix` form, returns as-is.
 * - Inserts hyphen after the first matching EURO_HYPHEN_PREFIXES entry
 *   when suffix is 2–6 alphanumeric characters.
 * - Falls back to plain uppercase/trim when no prefix matches.
 *
 * @param {string} raw - User-typed registration string
 * @returns {string} Normalised registration
 */
function normalizeEuCivilRegistration(raw) {
  if (!raw) return "";
  let s = String(raw).trim().toUpperCase();
  s = s.replace(/\s+/g, "");
  // Remove stray punctuation the user might type; preserve existing hyphens
  s = s.replace(/[.\/\\_]/g, "");

  // Already has a hyphen in prefix-suffix form — return as-is
  if (/^[A-Z0-9]{1,3}-[A-Z0-9]{2,6}$/.test(s)) return s;

  // Insert hyphen after known prefix if absent
  if (!s.includes("-")) {
    for (const p of EURO_HYPHEN_PREFIXES) {
      if (s.startsWith(p)) {
        const rest = s.slice(p.length);
        // Only apply when suffix length is plausible (2–6 alphanum chars)
        if (rest.length >= 2 && rest.length <= 6 && /^[A-Z0-9]+$/.test(rest)) {
          return `${p}-${rest}`;
        }
      }
    }
  }

  return s;
}

/* -----------------------------
   Inline Edit Helpers
------------------------------ */

/* ------------------------------------------------------------------ *
 * Inline-edit session management                                       *
 *                                                                      *
 * Tracks the active inline-editor session so that:                     *
 *   1) An idle timeout auto-CANCELS (never commits) the edit.          *
 *   2) Background re-renders triggered by fdms:data-changed are        *
 *      deferred until after the editor closes, preventing the editor   *
 *      row from being wiped mid-session.                               *
 * ------------------------------------------------------------------ */

/** @type {{ idleMs:number, timer:ReturnType<typeof setTimeout>|null, cancelFn:Function, cleanupFn:Function|null, resetTimer:Function, stopTimer:Function }|null} */
let _activeInlineSession = null;

/** True when a rerender was requested while an inline editor was open. */
let _pendingRerenderWhileInline = false;

// ------------------------------------------------------------------
// Inline time-mode state
// Per-strip, per-side toggle: 'estimate' | 'actual'
// Stored in-memory only (UI session state, not persisted to movement record).
// Operator-explicit toggles are preserved across re-renders.
// Non-explicit (default) modes re-derive from actual-field presence on each
// render, so the strip automatically shows ATD after Active is pressed etc.
// ------------------------------------------------------------------

/** @type {Map<string, 'estimate'|'actual'>} key = `${movementId}:dep` or `${movementId}:arr` */
const _inlineTimeModeMap = new Map();

/** Keys that have been explicitly toggled by the operator this session. */
const _inlineTimeModeExplicit = new Set();

/**
 * Resolve the active time mode for one side of a strip.
 * If the operator explicitly toggled this side, preserve their choice.
 * Otherwise auto-derive from actual-field presence (actual mode when actual exists).
 * @param {string|number} movementId
 * @param {'dep'|'arr'} side
 * @param {boolean} hasActual - whether the relevant actual field is populated
 * @returns {'estimate'|'actual'}
 */
function _resolveInlineTimeMode(movementId, side, hasActual) {
  const key = `${movementId}:${side}`;
  if (_inlineTimeModeExplicit.has(key)) {
    return _inlineTimeModeMap.get(key) || 'estimate';
  }
  const mode = hasActual ? 'actual' : 'estimate';
  _inlineTimeModeMap.set(key, mode);
  return mode;
}

/**
 * Read the current mode for a side (does not re-derive defaults).
 * @param {string|number} movementId
 * @param {'dep'|'arr'} side
 * @returns {'estimate'|'actual'}
 */
function _getInlineTimeMode(movementId, side) {
  return _inlineTimeModeMap.get(`${movementId}:${side}`) || 'estimate';
}

/**
 * Set the mode explicitly (operator toggle).
 * @param {string|number} movementId
 * @param {'dep'|'arr'} side
 * @param {'estimate'|'actual'} mode
 */
function _setInlineTimeModeExplicit(movementId, side, mode) {
  const key = `${movementId}:${side}`;
  _inlineTimeModeMap.set(key, mode);
  _inlineTimeModeExplicit.add(key);
}

/**
 * Return the data-model field name for a time cell based on flight type, side, and mode.
 * Explicit field-ownership table:
 *   DEP/LOC dep-side  estimate → depPlanned   actual → depActual
 *   DEP/LOC arr-side  estimate → arrPlanned   actual → arrActual
 *   ARR     dep-side  always depActual (ATD from origin – no estimate/actual pair)
 *   ARR     arr-side  estimate → arrPlanned   actual → arrActual
 *   OVR     dep-side  estimate → depPlanned   actual → depActual  (EOFT/AOFT)
 *   OVR     arr-side  estimate → arrPlanned   actual → arrActual  (ELFT/ALFT)
 * @param {string} ft   - flight type (DEP|LOC|ARR|OVR)
 * @param {'dep'|'arr'} side
 * @param {'estimate'|'actual'} mode
 * @returns {string|null}
 */
function _inlineTimeFieldForMode(ft, side, mode) {
  if (side === 'dep') {
    if (ft === 'ARR') return 'depActual'; // always ATD
    return mode === 'actual' ? 'depActual' : 'depPlanned';
  }
  if (side === 'arr') {
    return mode === 'actual' ? 'arrActual' : 'arrPlanned';
  }
  return null;
}

/**
 * Return the display label for a time cell based on flight type, side, and mode.
 * @param {string} ft   - flight type (DEP|LOC|ARR|OVR)
 * @param {'dep'|'arr'} side
 * @param {'estimate'|'actual'} mode
 * @returns {string}
 */
function _inlineTimeLabelForMode(ft, side, mode) {
  if (side === 'dep') {
    if (ft === 'ARR') return 'ATD'; // always ATD for ARR dep-side
    if (ft === 'OVR') return mode === 'actual' ? 'AOFT' : 'EOFT';
    return mode === 'actual' ? 'ATD' : 'ETD'; // DEP/LOC
  }
  if (side === 'arr') {
    if (ft === 'OVR') return mode === 'actual' ? 'ALFT' : 'ELFT';
    return mode === 'actual' ? 'ATA' : 'ETA'; // DEP/LOC/ARR
  }
  return '';
}

/**
 * Read the idle-timeout value from config (floor: 5 s safety net).
 * @returns {number} milliseconds
 */
function _getInlineIdleMs() {
  try {
    const cfg = (typeof getConfig === 'function') ? getConfig() : null;
    const v = cfg && Number.isFinite(Number(cfg.inlineEditIdleMs))
      ? Number(cfg.inlineEditIdleMs)
      : 120000;
    return Math.max(5000, Math.trunc(v));
  } catch {
    return 120000;
  }
}

/**
 * Start a new inline-edit session. If one is already active it is ended first.
 *
 * @param {{ cancelFn: Function, cleanupFn?: Function|null }} opts
 * @returns {object} The session object (call .resetTimer() on user input).
 */
function _startInlineSession({ cancelFn, cleanupFn = null }) {
  _endInlineSession(); // Safety: end any previous session
  const idleMs = _getInlineIdleMs();

  const session = {
    idleMs,
    timer: null,
    cancelFn,
    cleanupFn,
    resetTimer() {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        // Idle timeout → CANCEL (never commit)
        try { this.cancelFn(); } finally { _endInlineSession(true); }
      }, this.idleMs);
    },
    stopTimer() {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
    },
  };

  session.resetTimer();
  _activeInlineSession = session;
  return session;
}

/**
 * End the active inline-edit session, applying any deferred rerenders.
 *
 * @param {boolean} [fromIdle] - True when called by the idle timeout itself.
 */
function _endInlineSession(fromIdle = false) {
  if (!_activeInlineSession) return;
  try {
    _activeInlineSession.stopTimer();
    if (_activeInlineSession.cleanupFn) _activeInlineSession.cleanupFn();
  } finally {
    _activeInlineSession = null;
    if (_pendingRerenderWhileInline) {
      _pendingRerenderWhileInline = false;
      renderLiveBoard();
      if (typeof renderTimeline === 'function') renderTimeline();
      if (typeof renderTimelineTracks === 'function') renderTimelineTracks();
      if (typeof window.updateDailyStats === 'function') window.updateDailyStats();
      if (typeof window.updateFisCounters === 'function') window.updateFisCounters();
    }
  }
}

/**
 * Returns true while an inline editor is open.
 * Used to defer fdms:data-changed rerenders.
 *
 * @returns {boolean}
 */
function _isInlineEditingActive() {
  return !!_activeInlineSession;
}

/* -----------------------------
   Inline-edit Tab order
------------------------------ */

/**
 * Maps data-model fieldName → CSS selector for the inline-editable cell.
 * Time fields (dep/arr) have two possible fieldNames (planned vs actual)
 * that both map to the same cell selector.
 */
const _INLINE_FIELD_TO_SELECTOR = {
  callsignCode:  '.js-edit-callsign',
  callsignVoice: '.js-edit-voice',
  registration:  '.js-edit-reg',
  type:          '.js-edit-type',
  wtc:           '.js-edit-wtc',
  depAd:         '.js-edit-dep-ad',
  arrAd:         '.js-edit-arr-ad',
  rules:         '.js-edit-rules',
  depActual:     '.js-edit-dep-time',
  depPlanned:    '.js-edit-dep-time',
  arrActual:     '.js-edit-arr-time',
  arrPlanned:    '.js-edit-arr-time',
  tngCount:      '.js-edit-tng',
  osCount:       '.js-edit-os',
  fisCount:      '.js-edit-fis',
  remarks:       '.js-edit-remarks',
};

/**
 * Build the ordered list of applicable tab stops for a row + movement.
 * Returns only entries whose selector resolves to an element in rowEl.
 */
function _buildTabOrder(rowEl, movement) {
  const ft = (movement.flightType || '').toUpperCase();
  const slots = [
    { selector: '.js-edit-callsign',  inputType: 'text',
      fieldName: () => 'callsignCode',  applicable: true },
    { selector: '.js-edit-voice',     inputType: 'text',
      fieldName: () => 'callsignVoice', applicable: true },
    { selector: '.js-edit-reg',       inputType: 'text',
      fieldName: () => 'registration',  applicable: true },
    { selector: '.js-edit-type',      inputType: 'text',
      fieldName: () => 'type',          applicable: true },
    { selector: '.js-edit-wtc',       inputType: 'text',
      fieldName: () => 'wtc',           applicable: true },
    // Dep AD: editable for OVR (origin can be updated) and ARR (where they came from)
    { selector: '.js-edit-dep-ad',    inputType: 'text',
      fieldName: () => 'depAd',         applicable: ft === 'OVR' || ft === 'ARR' },
    // Arr AD: editable for OVR and DEP (destination)
    { selector: '.js-edit-arr-ad',    inputType: 'text',
      fieldName: () => 'arrAd',         applicable: ft === 'OVR' || ft === 'DEP' },
    { selector: '.js-edit-rules',     inputType: 'text',
      fieldName: () => 'rules',         applicable: true },
    { selector: '.js-edit-dep-time',  inputType: 'time',
      fieldName: (m) => ft === 'ARR'
        ? 'depActual'
        : _inlineTimeFieldForMode(ft, 'dep', _getInlineTimeMode(m.id, 'dep')),
      applicable: ft === 'DEP' || ft === 'LOC' || ft === 'OVR' },
    { selector: '.js-edit-arr-time',  inputType: 'time',
      fieldName: (m) => _inlineTimeFieldForMode(ft, 'arr', _getInlineTimeMode(m.id, 'arr')),
      applicable: ft === 'ARR' || ft === 'LOC' || ft === 'DEP' || ft === 'OVR' },
    // field 11 is NOT inline-editable — skipped
    { selector: '.js-edit-tng',       inputType: 'number',
      fieldName: () => 'tngCount',      applicable: true },
    { selector: '.js-edit-os',        inputType: 'number',
      fieldName: () => 'osCount',       applicable: true },
    { selector: '.js-edit-fis',       inputType: 'number',
      fieldName: () => 'fisCount',      applicable: true },
    { selector: '.js-edit-remarks',   inputType: 'text',
      fieldName: () => 'remarks',       applicable: true },
  ];
  return slots
    .filter(s => s.applicable)
    .map(s => ({ ...s, el: rowEl.querySelector(s.selector) || null,
                        resolvedFieldName: s.fieldName(movement) }))
    .filter(s => s.el !== null);
}

/**
 * After a successful Tab-commit, re-query the (newly rendered) DOM and open
 * the next (or previous, for Shift+Tab) applicable inline-edit field.
 * Wraps from last→first and first→last.
 *
 * @param {string|number} movementId - ID of the movement being edited
 * @param {string}        currentFieldName - fieldName that was just committed
 * @param {'forward'|'backward'} direction
 */
function advanceInlineEditor(movementId, currentFieldName, direction) {
  // renderLiveBoard() has already run, so we must re-query the new DOM.
  const rowEl = document.querySelector(`#liveBody tr[data-id="${movementId}"]`);
  if (!rowEl) return;

  const movement = getMovements().find(m => String(m.id) === String(movementId));
  if (!movement) return;

  const tabs = _buildTabOrder(rowEl, movement);
  if (tabs.length === 0) return;

  const currentSelector = _INLINE_FIELD_TO_SELECTOR[currentFieldName];
  const currentIdx = currentSelector
    ? tabs.findIndex(t => t.selector === currentSelector)
    : -1;

  const len = tabs.length;
  const delta = direction === 'backward' ? -1 : 1;
  const nextIdx = currentIdx === -1
    ? 0
    : ((currentIdx + delta) % len + len) % len;

  const next = tabs[nextIdx];
  next.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  startInlineEdit(next.el, movementId, next.resolvedFieldName, next.inputType, null);
}

/**
 * Create inline edit functionality for a field
 * @param {HTMLElement} el - The element to make editable
 * @param {string} movementId - The movement ID
 * @param {string} fieldName - The field name to update
 * @param {string} inputType - Type of input ('text', 'time')
 * @param {function} onSave - Callback after save (optional)
 */
function enableInlineEdit(el, movementId, fieldName, inputType = 'text', onSave = null, tooltipText = null) {
  if (!el || el.dataset.inlineEditEnabled) return;
  el.dataset.inlineEditEnabled = 'true';
  el.style.cursor = 'pointer';
  el.title = tooltipText || 'Double-click to edit';

  el.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    e.preventDefault();
    startInlineEdit(el, movementId, fieldName, inputType, onSave);
  });
}

/**
 * Start inline editing for an element
 */
/** WTC category options per wtcSystem. */
const _WTC_OPTIONS = {
  UK:    ['L','S','LM','UM','H','J'],
  ICAO:  ['L','S','M','H','J'],
  RECAT: ['A','B','C','D','E','F'],
};

function startInlineEdit(el, movementId, fieldName, inputType, onSave) {
  // Don't start if already editing (covers both input and select editors)
  if (el.querySelector('input, select')) return;

  const originalContent = el.innerHTML;
  const currentValue = el.textContent.trim();
  const displayValue = currentValue === '—' || currentValue === '-' ? '' : currentValue;

  // ── WTC: create a <select> constrained to the active wtcSystem ────────────
  let input;
  if (fieldName === 'wtc') {
    const wtcSystem = getConfig().wtcSystem || 'ICAO';
    const wtcOpts = _WTC_OPTIONS[wtcSystem] || _WTC_OPTIONS.ICAO;
    // Seed from cell text: strip alert markup and take leading uppercase letters only
    const rawSeed = (currentValue.match(/^[A-Za-z]+/) || [''])[0].toUpperCase();
    input = document.createElement('select');
    input.className = 'inline-edit-input';
    input.style.cssText = `
      padding: 2px 4px;
      font-size: inherit;
      font-family: inherit;
      border: 1px solid #4a90d9;
      border-radius: 3px;
      background: #fff;
      box-shadow: 0 0 3px rgba(74, 144, 217, 0.5);
      outline: none;
    `;
    wtcOpts.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = opt;
      if (opt === rawSeed) option.selected = true;
      input.appendChild(option);
    });
    // Default to first option if seed not in list
    if (!wtcOpts.includes(rawSeed) && wtcOpts.length > 0) {
      input.value = wtcOpts[0];
    }
  } else {
    // ── All other fields: plain <input type="text"> ─────────────────────────
    input = document.createElement('input');
    input.type = 'text';
    // For time inputs, extract HH:MM from the cell text (cell may contain a label
    // like "ETD 12:00"), then strip the colon for the bare-HHMM input convention.
    input.value = inputType === 'time'
      ? (currentValue.match(/\d{2}:\d{2}/) || [''])[0].replace(':', '')
      : displayValue;
    input.className = 'inline-edit-input';

    // Time inputs get a narrower width
    const inputWidth = inputType === 'time' ? '50px' : '100%';
    input.style.cssText = `
      width: ${inputWidth};
      padding: 2px 4px;
      font-size: inherit;
      font-family: inherit;
      border: 1px solid #4a90d9;
      border-radius: 3px;
      background: #fff;
      box-shadow: 0 0 3px rgba(74, 144, 217, 0.5);
      outline: none;
      text-align: ${inputType === 'time' ? 'center' : 'left'};
    `;

    if (inputType === 'time') {
      input.placeholder = 'HHMM';
      input.maxLength = 4;
      // Auto-format time input - only allow digits
      input.addEventListener('input', (e) => {
        const cursorPos = e.target.selectionStart;
        const digitsOnly = e.target.value.replace(/\D/g, '').slice(0, 4);
        e.target.value = digitsOnly;
        // Restore cursor position
        const newPos = Math.min(cursorPos, digitsOnly.length);
        e.target.setSelectionRange(newPos, newPos);
      });
    } else if (inputType === 'number') {
      input.placeholder = '0';
      // Only allow digits for counter fields
      input.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, '');
      });
    }
  }

  // Clear element and add editor (input or select)
  el.innerHTML = '';
  el.appendChild(input);
  input.focus();
  // input.select() only valid on <input> elements (not <select>)
  if (input.tagName === 'INPUT' && typeof input.select === 'function') input.select();

  // Guard: prevent double-fire from Enter + blur race.  Once saved or
  // definitively cancelled, further calls to saveEdit()/cancelEdit() are no-ops.
  // Session management is wired below — _startInlineSession() is called after
  // cancelEdit/saveEdit are defined so the cancelFn closure captures them.
  let saved = false;
  // Tracks whether the last save attempt failed validation (suppresses blur
  // auto-save while the input is still shown for retry, without resetting the
  // saved flag in a way that re-opens a race window).
  let _lastSaveFailed = false;

  // Save function
  // saveEdit returns true on success, false on any validation or data-model failure.
  // Tab navigation checks this return value: if false, focus stays on the current cell.
  const saveEdit = () => {
    if (saved) return false;

    if (window.__FDMS_DIAGNOSTICS__ && window.__fdmsDiag) {
      window.__fdmsDiag.inlineEditSaveAttempts = (window.__fdmsDiag.inlineEditSaveAttempts || 0) + 1;
      console.debug('[FDMS-diag] saveEdit called', { movementId, fieldName, inputType, value: input.value || '' });
    }

    saved = true;
    _lastSaveFailed = false;

    let newValue = input.value.trim();

    // ── Required-field guard ───────────────────────────────────────────────
    const requiredFields = ['callsignCode'];
    if (requiredFields.includes(fieldName) && !newValue) {
      showToast(`${fieldName === 'callsignCode' ? 'Callsign Code' : fieldName} cannot be blank`, 'error');
      el.innerHTML = originalContent;
      return false;
    }

    // ── Time format validation ─────────────────────────────────────────────
    if (inputType === 'time' && newValue) {
      const validation = validateTime(newValue);
      if (!validation.valid) {
        showToast(validation.error || 'Invalid time format', 'error');
        saved = false;
        _lastSaveFailed = true;
        input.focus();
        return false;
      }
      newValue = validation.normalized || newValue;
    }

    // ── Flight rules normalisation ─────────────────────────────────────────
    if (fieldName === 'rules' && newValue) {
      const rulesMap = { I: 'IFR', V: 'VFR', S: 'SVFR', Y: 'Y', Z: 'Z',
                         IFR: 'IFR', VFR: 'VFR', SVFR: 'SVFR' };
      const normalised = rulesMap[newValue.toUpperCase()];
      if (!normalised) {
        showToast('Invalid flight rules — use IFR, VFR, SVFR, Y or Z', 'error');
        saved = false;
        _lastSaveFailed = true;
        input.focus();
        return false;
      }
      newValue = normalised;
    }

    // ── Registration normalisation (EU civil hyphen insertion) ────────────────
    if (fieldName === 'registration' && newValue) {
      newValue = normalizeEuCivilRegistration(newValue);
    }

    // ── Counter validation (tngCount, osCount, fisCount) ───────────────────
    const counterFields = ['tngCount', 'osCount', 'fisCount'];
    let storedValue = newValue || null;
    if (counterFields.includes(fieldName)) {
      const num = parseInt(newValue || '0', 10);
      if (isNaN(num) || num < 0) {
        showToast('Must be a non-negative number', 'error');
        saved = false;
        _lastSaveFailed = true;
        input.focus();
        return false;
      }
      storedValue = num;
    }

    // ── Historical dep-actual redirect ────────────────────────────────────
    // When the operator edits the dep-side estimate cell (depPlanned) on a
    // PLANNED DEP/LOC strip to a past time they are recording the actual
    // departure, not adjusting the plan.  Redirect the write to depActual so
    // the timing model and Part F promotion logic handle it correctly.
    // depPlanned is intentionally left unchanged — the ETD is preserved.
    // ARR strips are excluded: their dep-side cell is always depActual already.
    let effectiveFieldName = fieldName;
    if (fieldName === 'depPlanned' && inputType === 'time' && storedValue) {
      const preSaveMvt = getMovements().find(m => String(m.id) === String(movementId));
      const preFt = (preSaveMvt?.flightType || '').toUpperCase();
      if ((preFt === 'DEP' || preFt === 'LOC') && preSaveMvt?.status === 'PLANNED') {
        if (checkPastTime(storedValue, preSaveMvt.dof).isPast) {
          effectiveFieldName = 'depActual';
        }
      }
    }

    // ── Transactional update ───────────────────────────────────────────────
    const updateData = {};
    updateData[effectiveFieldName] = storedValue;

    const updatedMovement = updateMovement(movementId, updateData);
    if (!updatedMovement) {
      el.innerHTML = originalContent;
      return false;
    }

    // ── Canonical timing model: recalculate dependent side after time/duration changes ──
    // This is the single authoritative recalculation path for inline edits.
    // Modal edits use bindPlannedTimesSync for live UI feedback and save the
    // already-computed values; inline edits must trigger recalc here on commit.
    const timingFields = ['depPlanned', 'arrPlanned', 'depActual', 'arrActual', 'durationMinutes'];
    if (timingFields.includes(effectiveFieldName)) {
      const timingPatch = recalculateTimingModel(updatedMovement, effectiveFieldName);
      const isWeak = timingPatch._weakPrediction;
      delete timingPatch._weakPrediction;
      if (Object.keys(timingPatch).length > 0 && !isWeak) {
        updateMovement(movementId, timingPatch);
      }
      // isWeak: ARR active with non-explicit duration + existing ETA — no overwrite
    }

    onMovementUpdated(updatedMovement);

    // Part E: For time field edits on ACTIVE strips, re-evaluate whether status
    // should revert to PLANNED (if the new time is now outside the activate window).
    const isTimeField = ['depPlanned', 'arrPlanned', 'depActual', 'arrActual'].includes(effectiveFieldName);
    if (isTimeField) {
      reEvaluateStatusAfterTimeChange(movementId);
    }

    // Part F: Operator entered a dep-actual time on a PLANNED strip (either via
    // the actual-mode cell directly, or via the estimate-mode cell redirected
    // above).  Promote to ACTIVE immediately.
    // Only depActual triggers this; arrActual does not fabricate a dep stamp.
    const freshMovement = getMovements().find(m => m.id === movementId);
    if (effectiveFieldName === 'depActual' && freshMovement && freshMovement.status === 'PLANNED') {
      updateMovement(movementId, { status: 'ACTIVE' });
    }

    // Re-render — renderLiveBoard already calls renderTimeline at its end, but
    // renderTimelineTracks is also called explicitly so timeline always stays
    // in sync with the committed edit (guards against future refactors).
    renderLiveBoard();
    renderHistoryBoard();
    renderTimelineTracks();
    if (window.updateDailyStats) window.updateDailyStats();
    if (window.updateFisCounters) window.updateFisCounters();

    if (onSave) onSave();
    _endInlineSession(false);
    return true;
  };

  // Cancel function — also used as cancelFn for the idle-timeout session
  const cancelEdit = () => {
    if (saved) return;
    saved = true;
    el.innerHTML = originalContent;
    _endInlineSession(false);
  };

  // ── Inline-session idle watchdog ──────────────────────────────────────────
  // cancelEdit is defined above and used as the cancelFn.
  const _sess = _startInlineSession({ cancelFn: cancelEdit });

  // Reset the idle timer on any user activity on the editor element
  input.addEventListener('input',   () => _sess.resetTimer());
  input.addEventListener('paste',   () => _sess.resetTimer());
  // keydown listener for timer reset (separate from the main keydown handler below)
  input.addEventListener('keydown', () => _sess.resetTimer());

  // Clear _lastSaveFailed when the user changes the value, allowing blur-save
  // to resume after the user corrects a bad time entry.
  input.addEventListener('input', () => { _lastSaveFailed = false; });

  // Event handlers
  input.addEventListener('blur', () => {
    // Small delay to allow click events to register first
    setTimeout(() => {
      // Do not auto-save on blur if the last attempt failed validation and
      // the user has not yet typed a new value — the error toast was already
      // shown and the input might still be visible for retry.
      if (!saved && !_lastSaveFailed && document.activeElement !== input) {
        saveEdit();
      }
    }, 100);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      // stopPropagation prevents the event from reaching document-level handlers
      // (e.g. the modal keyHandler) so that inline-edit Enter never accidentally
      // triggers an open modal's save button at the same time.
      e.preventDefault();
      e.stopPropagation();
      saveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelEdit();
    } else if (e.key === 'Tab') {
      // Tab / Shift+Tab: commit the current edit then advance to next/prev field.
      // stopPropagation keeps this from triggering document-level handlers.
      e.preventDefault();
      e.stopPropagation();
      const direction = e.shiftKey ? 'backward' : 'forward';
      const committed = saveEdit();
      // advanceInlineEditor re-queries the DOM after renderLiveBoard(), so it
      // always operates on fresh elements even though the old row was replaced.
      if (committed) {
        advanceInlineEditor(movementId, fieldName, direction);
      }
    }
  });

  // Prevent row click events
  input.addEventListener('click', (e) => e.stopPropagation());
}

/**
 * Convert text input to uppercase on input event
 * Applies to aviation-related fields that should always be uppercase
 * @param {HTMLInputElement} inputElement - Input element to make uppercase
 */
function makeInputUppercase(inputElement) {
  if (!inputElement) return;

  inputElement.addEventListener("input", (e) => {
    const start = e.target.selectionStart;
    const end = e.target.selectionEnd;
    e.target.value = e.target.value.toUpperCase();
    // Restore cursor position after transformation
    e.target.setSelectionRange(start, end);
  });
}

/**
 * Bind ZZZZ companion field show/hide behaviour.
 * When codeInput equals "ZZZZ" the companionInput is shown; otherwise hidden.
 * Sets required attribute when shown and removes it when hidden.
 * @param {HTMLInputElement} codeInput     - The ICAO code field (e.g. depAd, type)
 * @param {HTMLInputElement} companionInput - The free-text companion field
 */
function bindZzzzCompanion(codeInput, companionInput) {
  if (!codeInput || !companionInput) return;
  const update = () => {
    const isZzzz = codeInput.value.trim().toUpperCase() === 'ZZZZ';
    companionInput.style.display = isZzzz ? '' : 'none';
    if (isZzzz) {
      companionInput.setAttribute('required', '');
    } else {
      companionInput.removeAttribute('required');
    }
  };
  codeInput.addEventListener('input', update);
  codeInput.addEventListener('change', update);
  update(); // run once on bind in case value already set
}

/**
 * Debounce a function call
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/* -----------------------------
   Sorting
------------------------------ */

/**
 * Convert HH:MM time string to minutes since midnight
 * @param {string} t - Time string in HH:MM format
 * @returns {number} Minutes since midnight, or Infinity if invalid
 */
function timeToMinutes(t) {
  const s = (t || "").trim();
  if (!s) return Number.POSITIVE_INFINITY;
  const m = s.match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return Number.POSITIVE_INFINITY;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return Number.POSITIVE_INFINITY;
  return hh * 60 + mm;
}

/**
 * Convert minutes since midnight to HH:MM time string
 * @param {number} minutes - Minutes since midnight
 * @returns {string} Time string in HH:MM format
 */
function minutesToTime(minutes) {
  if (!Number.isFinite(minutes)) return "";
  const totalMinutes = minutes % 1440; // Wrap to 24-hour period
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Add minutes to a time string
 * @param {string} time - Time string in HH:MM format
 * @param {number} minutesToAdd - Number of minutes to add
 * @returns {string} New time string in HH:MM format
 */
function addMinutesToTime(time, minutesToAdd) {
  const mins = timeToMinutes(time);
  if (!Number.isFinite(mins)) return "";
  return minutesToTime(mins + minutesToAdd);
}

/**
 * Bind bidirectional sync between the planned-start, planned-end, and duration
 * fields in a Times section.
 *
 * DEP / LOC mode (default):
 *   Duration edited  → end = start + duration
 *   End-time edited  → duration = end − start
 *   Start edited     → recomputes whichever side was last touched
 *   endEl disabled   → only Duration→end direction is bound (e.g. OVR ELFT)
 *
 * ARR mode (opts.arrMode = true):
 *   ETA (endEl) is the governing root; ETD (startEl) is the dependent side.
 *   Duration edited  → ETD = ETA − duration
 *   ETA edited       → ETD = ETA − duration
 *   ETD edited       → duration = ETA − ETD   (user explicitly set ETD)
 *
 * Works in any display mode (UTC or local) because it operates on whatever
 * values the inputs currently show — conversion to/from UTC happens in save.
 *
 * @param {string} startId   - Element ID for ETD / EOFT input
 * @param {string} endId     - Element ID for ETA / ELFT input
 * @param {string} durationId - Element ID for Duration input
 * @param {object} [opts]    - Options
 * @param {boolean} [opts.arrMode=false] - ARR mode: ETA is root, ETD is dependent
 */
function bindPlannedTimesSync(startId, endId, durationId, opts = {}) {
  const arrMode = !!(opts && opts.arrMode);
  const startEl = document.getElementById(startId);
  const endEl   = document.getElementById(endId);
  const durEl   = document.getElementById(durationId);
  if (!startEl || !durEl) return;

  if (arrMode) {
    /* ── ARR mode: ETA (endEl) = root, ETD (startEl) = dependent ─────── */

    // Compute ETD = ETA − Duration and write into startEl
    const applyToStart = () => {
      if (!endEl) return;
      const endMin = timeToMinutes(endEl.value);
      const dur    = parseInt(durEl.value, 10);
      if (!Number.isFinite(endMin) || !(dur > 0)) return;
      startEl.value = minutesToTime(endMin - dur);
    };

    // Compute Duration = ETA − ETD and write into durEl
    const applyStartToDuration = () => {
      if (!endEl) return;
      const endMin   = timeToMinutes(endEl.value);
      const startMin = timeToMinutes(startEl.value);
      if (!Number.isFinite(endMin) || !Number.isFinite(startMin)) return;
      let diff = endMin - startMin;
      if (diff <= 0) diff += 1440;
      if (diff > 0 && diff <= 1440) durEl.value = String(diff);
    };

    // Duration changed → update ETD
    durEl.addEventListener('input', () => {
      if (!durEl.value.trim() || !(parseInt(durEl.value, 10) > 0)) return;
      applyToStart();
    });

    // ETA changed → update ETD
    if (endEl && !endEl.disabled) {
      endEl.addEventListener('input', applyToStart);
      endEl.addEventListener('blur',  applyToStart);
    }

    // ETD manually changed → update Duration (ETD is user-driven in this case)
    startEl.addEventListener('input', applyStartToDuration);
    startEl.addEventListener('blur',  applyStartToDuration);

  } else {
    /* ── DEP / LOC / OVR mode: ETD (startEl) = root, ETA (endEl) = dependent */

    // 'duration' | 'end' | null — which field the user last explicitly edited
    let _lastTouched = null;

    const applyDurationToEnd = () => {
      if (!endEl) return;
      const startMin = timeToMinutes(startEl.value);
      const dur = parseInt(durEl.value, 10);
      if (!Number.isFinite(startMin) || !(dur > 0)) return;
      endEl.value = minutesToTime(startMin + dur);
    };

    const applyEndToDuration = () => {
      if (!endEl) return;
      const startMin = timeToMinutes(startEl.value);
      const endMin   = timeToMinutes(endEl.value);
      if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return;
      let diff = endMin - startMin;
      if (diff <= 0) diff += 1440; // overnight wrap
      if (diff > 0 && diff <= 1440) durEl.value = String(diff);
    };

    // Duration changed → update end-time
    durEl.addEventListener('input', () => {
      const dur = parseInt(durEl.value, 10);
      if (!durEl.value.trim() || !(dur > 0)) {
        _lastTouched = null; // cleared — stop overriding end until re-entered
        return;
      }
      _lastTouched = 'duration';
      applyDurationToEnd();
    });

    // End-time changed → update duration (skip for disabled fields, e.g. OVR ELFT)
    if (endEl && !endEl.disabled) {
      const onEndEdit = () => {
        if (!endEl.value.trim()) {
          if (_lastTouched === 'end') _lastTouched = null;
          return;
        }
        _lastTouched = 'end';
        applyEndToDuration();
      };
      endEl.addEventListener('input', onEndEdit);
      endEl.addEventListener('blur',  onEndEdit);
    }

    // Start changed → recompute the last-touched counterpart
    const onStartChange = () => {
      if (_lastTouched === 'duration') applyDurationToEnd();
      else if (_lastTouched === 'end') applyEndToDuration();
    };
    startEl.addEventListener('input', onStartChange);
    startEl.addEventListener('blur',  onStartChange);
  }
}

/* -----------------------------------------------------------------------
   Times grid helpers — shared across all create/edit/duplicate modals
----------------------------------------------------------------------- */

/**
 * Render the shared 2×2 times grid (ETD | ETA / ATD | ATA).
 * Returns HTML fragment of four .modal-field divs to be placed inside
 * an existing .modal-section-grid container.
 *
 * Stored values are always canonical UTC HH:MM strings.  If the current
 * timeInputMode is "LOCAL" they are converted for display here so the
 * initial HTML reflects the user's chosen mode.
 *
 * @param {object} opts
 *   etdId, etaId, atdId, ataId  — element IDs for the four inputs
 *   etdLabel, etaLabel, atdLabel, ataLabel — display labels (defaults ETD/ETA/ATD/ATA)
 *   etdVal, etaVal, atdVal, ataVal — canonical UTC values (empty string if none)
 *   etaDisabled, ataDisabled — boolean; disables the input (OVR arrival fields)
 * @returns {string} HTML string
 */
function renderTimesGrid({ etdId, etaId, atdId, ataId, durationId,
    etdLabel = "ETD", etaLabel = "ETA", atdLabel = "ATD", ataLabel = "ATA",
    etdVal = "", etaVal = "", atdVal = "", ataVal = "",
    durationVal = "",
    etaDisabled = false, ataDisabled = false }) {

  const mode = (getConfig().timeInputMode || "UTC").toUpperCase();

  const toDisplay = (utcVal) => {
    if (!utcVal) return "";
    return mode === "LOCAL" ? convertUTCToLocal(utcVal) : utcVal;
  };

  const etaDis = etaDisabled ? " disabled" : "";
  const ataDis = ataDisabled ? " disabled" : "";
  const durVal = (durationVal != null && durationVal !== "") ? escapeHtml(String(durationVal)) : "";

  // 6 cells for a modal-section-grid-3 wrapper (3 cols):
  // Row 1: ETD | Duration | ETA
  // Row 2: ATD | spacer   | ATA
  return `
    <div class="modal-field">
      <label class="modal-label">${escapeHtml(etdLabel)}</label>
      <input id="${etdId}" class="modal-input" placeholder="HH:MM" style="width: 80px;" value="${escapeHtml(toDisplay(etdVal))}" />
    </div>
    <div class="modal-field">
      <label class="modal-label">Duration</label>
      <input id="${durationId}" class="modal-input" type="number" min="1" max="720" placeholder="default" style="width: 80px;" value="${durVal}" />
      <span style="font-size: 11px; color: #888; display: block; margin-top: 2px;">min (timeline only)</span>
    </div>
    <div class="modal-field">
      <label class="modal-label">${escapeHtml(etaLabel)}</label>
      <input id="${etaId}" class="modal-input" placeholder="HH:MM" style="width: 80px;" value="${escapeHtml(toDisplay(etaVal))}"${etaDis} />
    </div>
    <div class="modal-field">
      <label class="modal-label">${escapeHtml(atdLabel)}</label>
      <input id="${atdId}" class="modal-input" placeholder="HH:MM" style="width: 80px;" value="${escapeHtml(toDisplay(atdVal))}" />
    </div>
    <div class="modal-field"></div>
    <div class="modal-field">
      <label class="modal-label">${escapeHtml(ataLabel)}</label>
      <input id="${ataId}" class="modal-input" placeholder="HH:MM" style="width: 80px;" value="${escapeHtml(toDisplay(ataVal))}"${ataDis} />
    </div>`;
}

/**
 * Bind the UTC/Local mode toggle button for a modal's times section.
 *
 * On open: reads cfg.timeInputMode, sets button label, converts existing
 * input values to the correct display mode.
 * On click: validates all non-empty inputs, converts values, persists new
 * mode to config via updateConfig(), updates button label.
 *
 * @param {string}   toggleBtnId  — ID of the <button> element
 * @param {string[]} inputIds     — IDs of the four time inputs (ETD,ETA,ATD,ATA)
 */
function bindTimeModeToggle(toggleBtnId, inputIds) {
  const toggleBtn = document.getElementById(toggleBtnId);
  if (!toggleBtn) return;

  const cfg = getConfig();
  let currentMode = (cfg.timeInputMode || "UTC").toUpperCase();

  const inputs = inputIds.map(id => document.getElementById(id)).filter(Boolean);

  // Set initial button label (values already converted at render time)
  toggleBtn.textContent = currentMode === "LOCAL" ? "Local" : "UTC";

  toggleBtn.addEventListener("click", () => {
    // Validate all non-empty inputs before converting
    for (const inp of inputs) {
      if (!inp || !inp.value || inp.value.trim() === "") continue;
      const v = validateTime(inp.value);
      if (!v.valid) {
        showToast(`Cannot switch time mode: invalid time "${inp.value}" in ${inp.id}`, 'error');
        return;
      }
    }

    const newMode = currentMode === "UTC" ? "LOCAL" : "UTC";

    // Convert all non-empty values
    inputs.forEach(inp => {
      if (!inp || !inp.value || inp.value.trim() === "") return;
      const norm = validateTime(inp.value).normalized || inp.value;
      inp.value = newMode === "LOCAL" ? convertUTCToLocal(norm) : convertLocalToUTC(norm);
    });

    currentMode = newMode;
    updateConfig({ timeInputMode: newMode });
    toggleBtn.textContent = newMode === "LOCAL" ? "Local" : "UTC";
  });
}

/**
 * Bind the Planned/Active timing mode toggle for a new-movement modal.
 *
 * Elements with data-timing-group="planned" are shown only in Planned mode;
 * elements with data-timing-group="actual" are shown only in Active mode.
 * The Save & Complete button is hidden in Planned mode and shown in Active mode.
 *
 * Default state: Planned.
 *
 * @param {string} toggleBtnId        — ID of the Planned/Active toggle <button>
 * @param {string} saveCompleteBtnSel — CSS selector for the Save & Complete button
 */
function bindNewFormTimingToggle(toggleBtnId, saveCompleteBtnSel) {
  const toggleBtn = document.getElementById(toggleBtnId);
  if (!toggleBtn) return;
  const saveCompleteBtn = document.querySelector(saveCompleteBtnSel);

  const applyMode = (mode) => {
    document.querySelectorAll('[data-timing-group="planned"]').forEach(el => {
      el.style.display = mode === "planned" ? "" : "none";
    });
    document.querySelectorAll('[data-timing-group="actual"]').forEach(el => {
      el.style.display = mode === "active" ? "" : "none";
    });
    if (saveCompleteBtn) {
      saveCompleteBtn.style.display = mode === "active" ? "" : "none";
    }
    toggleBtn.textContent = mode === "planned" ? "Planned" : "Active";
    toggleBtn.dataset.timingMode = mode;
  };

  // Initialise to Planned (default)
  applyMode("planned");

  toggleBtn.addEventListener("click", () => {
    const newMode = (toggleBtn.dataset.timingMode || "planned") === "planned" ? "active" : "planned";
    applyMode(newMode);
  });
}

/**
 * Get status rank for sorting (ACTIVE first, then PLANNED, then others)
 * @param {string} status - Movement status
 * @returns {number} Rank value (lower = higher priority)
 */
function statusRank(status) {
  const s = (status || "").toUpperCase();
  if (s === "ACTIVE") return 1;
  if (s === "PLANNED") return 2;
  return 3;
}

/**
 * Get planned time in minutes for a movement
 * @param {object} m - Movement object
 * @returns {number} Minutes since midnight for planned time
 */
function plannedSortMinutes(m) {
  const ft = (m.flightType || "").toUpperCase();
  if (ft === "ARR") return timeToMinutes(getETA(m));
  if (ft === "OVR") return timeToMinutes(getECT(m));
  return timeToMinutes(getETD(m));
}

/**
 * Get actual/active time in minutes for a movement
 * @param {object} m - Movement object
 * @returns {number} Minutes since midnight for actual time (or planned if not set)
 */
function activeSortMinutes(m) {
  const ft = (m.flightType || "").toUpperCase();
  if (ft === "ARR") return timeToMinutes(getATA(m) || getETA(m));
  if (ft === "LOC") return timeToMinutes(getATD(m) || getATA(m) || getETD(m));
  if (ft === "OVR") return timeToMinutes(getACT(m) || getECT(m));
  return timeToMinutes(getATD(m) || getETD(m));
}

/**
 * Get sort time for a movement based on status
 * @param {object} m - Movement object
 * @returns {number} Minutes since midnight for sorting
 */
function movementSortMinutes(m) {
  const s = (m.status || "").toUpperCase();
  if (s === "ACTIVE") return activeSortMinutes(m);
  if (s === "PLANNED") return plannedSortMinutes(m);
  return activeSortMinutes(m);
}

/**
 * Get DOF (Date of Flight) as comparable timestamp
 * @param {object} m - Movement object
 * @returns {number} Timestamp in milliseconds, or 0 if no DOF
 */
function getDOFTimestamp(m) {
  if (!m.dof) return 0; // No DOF = treat as earliest
  const date = new Date(m.dof + "T00:00:00Z"); // Parse as UTC midnight
  return date.getTime();
}

/**
 * Compare two movements for Live Board sorting
 * Sort order: Status (ACTIVE, PLANNED, others), DOF (nearest first), Time (earliest first), ID
 * @param {object} a - First movement
 * @param {object} b - Second movement
 * @returns {number} Comparison result (-1, 0, 1)
 */
function compareForLiveBoard(a, b) {
  // 1. Sort by status (ACTIVE first, then PLANNED) - prioritize status over date
  const ra = statusRank(a.status);
  const rb = statusRank(b.status);
  if (ra !== rb) return ra - rb;

  // 2. Sort by DOF (nearest date first within same status)
  const dofA = getDOFTimestamp(a);
  const dofB = getDOFTimestamp(b);
  if (dofA !== dofB) return dofA - dofB;

  // 3. Sort by time (earliest first within the same date and status)
  const ta = movementSortMinutes(a);
  const tb = movementSortMinutes(b);
  if (ta !== tb) return ta - tb;

  // 4. Sort by ID as tiebreaker
  return (a.id || 0) - (b.id || 0);
}

function flightTypeClass(ft) {
  const t = (ft || "").toUpperCase();
  if (t === "ARR") return "ft-arr";
  if (t === "DEP") return "ft-dep";
  if (t === "LOC") return "ft-loc";
  if (t === "OVR") return "ft-ovr";
  return "ft-unk";
}

/* -----------------------------
   Filters
------------------------------ */

function getStatusFilterValue() {
  const select = byId("statusFilter");
  return select ? select.value : "planned_active";
}

/**
 * Get the planned time for a movement as a Date object
 * Uses ETD/ETA/ECT based on flight type
 * @param {object} m - Movement object
 * @returns {Date|null} Parsed date or null if no valid time
 */
function getMovementPlannedTime(m) {
  const ft = (m.flightType || "").toUpperCase();
  let timeStr = null;

  // Get the appropriate planned time based on flight type
  if (ft === "DEP" || ft === "LOC") {
    timeStr = getETD(m);
  } else if (ft === "ARR") {
    timeStr = getETA(m);
  } else if (ft === "OVR") {
    timeStr = getECT(m);
  }

  if (!timeStr) return null;

  // Parse HH:MM format and create Date object for today
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const now = new Date();
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);

  const movementDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);

  // If the time is before current time, assume it's tomorrow
  if (movementDate < now) {
    movementDate.setDate(movementDate.getDate() + 1);
  }

  return movementDate;
}

function matchesFilters(m) {
  // Always exclude COMPLETED and CANCELLED from Live Board
  if (m.status === "COMPLETED" || m.status === "CANCELLED") {
    return false;
  }

  const statusFilter = getStatusFilterValue();

  if (statusFilter === "active" && m.status !== "ACTIVE") return false;

  if (
    statusFilter === "planned_active" &&
    !(m.status === "PLANNED" || m.status === "ACTIVE")
  ) {
    return false;
  }

  // Time window filter for PLANNED movements only
  if (m.status === "PLANNED" && state.plannedWindowHours < 999999) {
    const movementTime = getMovementPlannedTime(m);
    if (movementTime) {
      const now = new Date();
      const windowEnd = new Date(now.getTime() + state.plannedWindowHours * 60 * 60 * 1000);

      if (movementTime > windowEnd) {
        return false; // Movement is beyond the time window
      }
    }
  }

  const gq = state.globalFilter.trim().toLowerCase();
  if (gq) {
    const haystack = [
      m.callsignCode,
      m.callsignLabel,
      m.registration,
      m.type,
      m.depAd,
      m.depName,
      m.arrAd,
      m.arrName,
      m.egowCode,
      m.egowDesc
    ]
      .join(" ")
      .toLowerCase();

    if (!haystack.includes(gq)) return false;
  }

  return true;
}

/* -----------------------------
   Formation UI Helpers
------------------------------ */

/**
 * Build formation element input rows inside a container element.
 * Called whenever the element count or base callsign changes in a modal.
 * @param {number} count           - Number of elements to render
 * @param {string} baseCallsign    - Lead callsign (e.g. "CNNCT")
 * @param {string} containerId     - ID of the container div
 * @param {Array}  existingElements - Pre-populate from existing formation
 */
function buildFormationElementRows(count, baseCallsign, containerId, existingElements) {
  const container = document.getElementById(containerId);
  if (!container) return;
  // Formation requires >= 2 elements; clamp to [2, 12]
  const clamped = Math.min(Math.max(count || 0, 0), 12);
  if (clamped < 2) { container.innerHTML = ""; return; }

  const existing = Array.isArray(existingElements) ? existingElements : [];
  let html = `<div class="formation-table-wrap"><table class="formation-table" style="margin-top:6px;">
    <thead>
      <tr>
        <th>Callsign</th>
        <th>Reg</th>
        <th>Type</th>
        <th>WTC</th>
        <th>Dep AD</th>
        <th>Arr AD</th>
      </tr>
    </thead>
    <tbody>`;

  for (let i = 0; i < clamped; i++) {
    const el = existing[i] || {};
    const defaultCallsign = baseCallsign ? `${baseCallsign} ${i + 1}` : `ELEMENT ${i + 1}`;
    html += `<tr>
      <td><input class="fmn-el-input" data-el-callsign="${i}" value="${escapeHtml(el.callsign || defaultCallsign)}" placeholder="Callsign" style="width:90px;" /></td>
      <td><input class="fmn-el-input" data-el-reg="${i}"      value="${escapeHtml(el.reg      || "")}" placeholder="Reg" /></td>
      <td><input class="fmn-el-input" data-el-type="${i}"     value="${escapeHtml(el.type     || "")}" placeholder="Type" /></td>
      <td><input class="fmn-el-input" data-el-wtc="${i}"      value="${escapeHtml(el.wtc      || "")}" placeholder="L/M/H" style="width:52px;" /></td>
      <td><input class="fmn-el-input fmn-el-ad" data-el-dep-ad="${i}" value="${escapeHtml(el.depAd || "")}" placeholder="ICAO" maxlength="4" /></td>
      <td><input class="fmn-el-input fmn-el-ad" data-el-arr-ad="${i}" value="${escapeHtml(el.arrAd || "")}" placeholder="ICAO" maxlength="4" /></td>
    </tr>`;
  }
  html += `</tbody></table></div>`;
  container.innerHTML = html;

  // Apply uppercase to all new inputs
  container.querySelectorAll("[data-el-wtc], [data-el-dep-ad], [data-el-arr-ad]").forEach(inp => {
    inp.addEventListener("input", () => { inp.value = inp.value.toUpperCase(); });
  });
}

/**
 * Read formation data from a modal's formation inputs.
 * Returns null if count < 2 or no rows rendered (no formation).
 * Returns { _error, message } if a validation error is found.
 */
function readFormationFromModal(baseCallsign, countInputId, containerId) {
  const countInput = document.getElementById(countInputId);
  const rawCount = parseInt(countInput?.value || "0", 10);
  const count = Math.min(Math.max(rawCount, 0), 12);
  if (count < 2) return null;

  // Return null if no element rows have been rendered (section never expanded/used)
  const container = document.getElementById(containerId);
  if (!container || !container.querySelector('[data-el-callsign="0"]')) return null;

  const elements = [];
  for (let i = 0; i < count; i++) {
    const defaultCallsign = baseCallsign ? `${baseCallsign} ${i + 1}` : `ELEMENT ${i + 1}`;
    const callsign = container?.querySelector(`[data-el-callsign="${i}"]`)?.value?.trim() || defaultCallsign;
    const reg    = container?.querySelector(`[data-el-reg="${i}"]`)?.value?.trim()   || "";
    const type   = container?.querySelector(`[data-el-type="${i}"]`)?.value?.trim()  || "";
    const wtcRaw = container?.querySelector(`[data-el-wtc="${i}"]`)?.value?.trim().toUpperCase() || "";
    const depAdRaw = container?.querySelector(`[data-el-dep-ad="${i}"]`)?.value?.trim().toUpperCase() || "";
    const arrAdRaw = container?.querySelector(`[data-el-arr-ad="${i}"]`)?.value?.trim().toUpperCase() || "";

    // Validate WTC — must be one of L/S/M/H/J or empty
    if (wtcRaw && !isValidWtcChar(wtcRaw)) {
      return { _error: true, message: `Element ${i + 1}: WTC "${wtcRaw}" is invalid. Use L, S, M, H, or J.` };
    }
    // Validate depAd/arrAd — "" or 4-char ICAO
    if (!isValidIcaoAd(depAdRaw)) {
      return { _error: true, message: `Element ${i + 1}: Dep AD "${depAdRaw}" must be a 4-character ICAO code (A–Z, 0–9).` };
    }
    if (!isValidIcaoAd(arrAdRaw)) {
      return { _error: true, message: `Element ${i + 1}: Arr AD "${arrAdRaw}" must be a 4-character ICAO code (A–Z, 0–9).` };
    }

    elements.push({
      callsign,
      reg, type,
      wtc: wtcRaw,
      status: "PLANNED",
      depAd: depAdRaw, arrAd: arrAdRaw,
      depActual: "", arrActual: ""
    });
  }
  const { wtcCurrent, wtcMax } = computeFormationWTC(elements);
  return {
    label:      `${baseCallsign || "Formation"} flight of ${count}`,
    wtcCurrent,
    wtcMax,
    elements
  };
}

/**
 * Wire the formation count input so that element rows rebuild whenever
 * the count or the base callsign changes.
 * @param {string} countInputId    - ID of the aircraft count input
 * @param {string} containerId     - ID of the element rows container
 * @param {function} getCallsign   - Returns current base callsign string
 * @param {Array}  existingElements - Existing elements (for pre-population)
 */
function wireFormationCountInput(countInputId, containerId, getCallsign, existingElements) {
  const countInput = document.getElementById(countInputId);
  if (!countInput) return;
  countInput.addEventListener("input", () => {
    let count = parseInt(countInput.value || "0", 10);
    // Clamp to [2, 12]; values < 2 clear rows (no formation)
    count = Math.min(Math.max(count, 0), 12);
    buildFormationElementRows(count, getCallsign(), containerId, existingElements);
  });
}

/* -----------------------------
   Live Board rendering
------------------------------ */

function renderBadges(m) {
  const parts = [];
  parts.push(`<span class="badge">${escapeHtml(m.flightType)}</span>`);

  if (m.isLocal) parts.push(`<span class="badge badge-local">Local</span>`);
  if (m.tngCount) parts.push(`<span class="badge badge-tng">T&amp;G × ${escapeHtml(m.tngCount)}</span>`);
  if (m.osCount) parts.push(`<span class="badge badge-os">O/S × ${escapeHtml(m.osCount)}</span>`);
  if (m.fisCount) parts.push(`<span class="badge badge-fis">FIS × ${escapeHtml(m.fisCount)}</span>`);

  if (m.formation && Array.isArray(m.formation.elements)) {
    parts.push(
      `<span class="badge badge-formation">F×${escapeHtml(m.formation.elements.length)}</span>`
    );
  }

  return parts.join("\n");
}

/**
 * Get full flight type name
 * @param {string} flightType - Flight type abbreviation (DEP, ARR, LOC, OVR)
 * @returns {string} Full flight type name
 */
function getFullFlightType(flightType) {
  const ft = (flightType || "").toUpperCase();
  switch (ft) {
    case "DEP": return "DEPARTURE";
    case "ARR": return "ARRIVAL";
    case "LOC": return "LOCAL";
    case "OVR": return "OVERFLIGHT";
    default: return flightType || "—";
  }
}

/**
 * Get EGOW code description in plain text
 * @param {string} egowCode - EGOW code (BM, BC, VM, VC, etc.)
 * @returns {string} Plain text description
 */
function getEgowCodeDescription(egowCode) {
  const code = (egowCode || "").toUpperCase();
  switch (code) {
    case "BM": return "Based Military";
    case "BC": return "Based Civil";
    case "VM": return "Visiting Military";
    case "VMH": return "Visiting Military Helicopter";
    case "VC": return "Visiting Civil";
    default: return code || "—";
  }
}

/**
 * Get color for EGOW code indicator bar
 * @param {string} egowCode - EGOW code
 * @param {string} unitCode - Unit code (L, M, A)
 * @returns {string} CSS color value
 */
function getEgowIndicatorColor(egowCode, unitCode) {
  const code = (egowCode || "").toUpperCase();
  const unit = (unitCode || "").toUpperCase();

  if (code === "BM") {
    switch (unit) {
      case "L": return "#2196F3"; // Blue
      case "M": return "#f44336"; // Red
      case "A": return "#FFC107"; // Yellow
      default: return "#9E9E9E"; // Grey fallback
    }
  }

  switch (code) {
    case "BC": return "#000000"; // Black
    case "VM":
    case "VMH": return "#4CAF50"; // Green
    default: return "#9E9E9E"; // Grey fallback
  }
}

function renderFormationDetails(m) {
  if (!m.formation || !Array.isArray(m.formation.elements)) return "";

  const mvId = m.id;
  const masterDepAd = escapeHtml(m.depAd || "");
  const masterArrAd = escapeHtml(m.arrAd || "");

  const rows = m.formation.elements
    .map((el, idx) => {
      const statusOptions = ["PLANNED", "ACTIVE", "COMPLETED", "CANCELLED"]
        .map(s => `<option value="${s}"${el.status === s ? " selected" : ""}>${statusLabel(s)}</option>`)
        .join("");

      // Dep AD / Arr AD: show element value or master fallback (muted) when empty
      const elDepAd = el.depAd || "";
      const elArrAd = el.arrAd || "";
      const depAdDisplay = elDepAd
        ? escapeHtml(elDepAd)
        : `<span class="fmn-fallback" title="Inherited from master strip">${masterDepAd}</span>`;
      const arrAdDisplay = elArrAd
        ? escapeHtml(elArrAd)
        : `<span class="fmn-fallback" title="Inherited from master strip">${masterArrAd}</span>`;

      return `
        <tr>
          <td>${escapeHtml(el.callsign)}</td>
          <td>${escapeHtml(el.reg || "—")}</td>
          <td>${escapeHtml(el.type || "—")}</td>
          <td>${escapeHtml(el.wtc || "—")}</td>
          <td>
            <select class="fmn-el-select" data-mv-id="${mvId}" data-el-idx="${idx}" aria-label="Status for ${escapeHtml(el.callsign)}">
              ${statusOptions}
            </select>
          </td>
          <td class="fmn-ad-cell">
            <input class="fmn-el-input fmn-el-ad" type="text"
              value="${escapeHtml(elDepAd)}"
              placeholder="${masterDepAd || "ICAO"}" maxlength="4"
              data-mv-id="${mvId}" data-el-idx="${idx}"
              aria-label="Dep AD for ${escapeHtml(el.callsign)}" />
            ${!elDepAd && masterDepAd ? `<span class="fmn-fallback">${masterDepAd}</span>` : ""}
          </td>
          <td class="fmn-ad-cell">
            <input class="fmn-el-input fmn-el-ad" type="text"
              value="${escapeHtml(elArrAd)}"
              placeholder="${masterArrAd || "ICAO"}" maxlength="4"
              data-mv-id="${mvId}" data-el-idx="${idx}"
              aria-label="Arr AD for ${escapeHtml(el.callsign)}" />
            ${!elArrAd && masterArrAd ? `<span class="fmn-fallback">${masterArrAd}</span>` : ""}
          </td>
          <td>
            <input class="fmn-el-input fmn-el-dep" type="text"
              value="${escapeHtml(el.depActual || "")}"
              placeholder="HHMM" maxlength="5"
              data-mv-id="${mvId}" data-el-idx="${idx}"
              aria-label="Dep actual for ${escapeHtml(el.callsign)}" />
          </td>
          <td>
            <input class="fmn-el-input fmn-el-arr" type="text"
              value="${escapeHtml(el.arrActual || "")}"
              placeholder="HHMM" maxlength="5"
              data-mv-id="${mvId}" data-el-idx="${idx}"
              aria-label="Arr actual for ${escapeHtml(el.callsign)}" />
          </td>
          <td>
            <button class="small-btn fmn-el-save" data-mv-id="${mvId}" data-el-idx="${idx}"
              aria-label="Save element ${idx + 1} (${escapeHtml(el.callsign)})">Save</button>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="expand-subsection">
      <div class="expand-title">Formation</div>
      <div class="kv">
        <div class="kv-label">Label</div><div class="kv-value">${escapeHtml(m.formation.label || "—")}</div>
        <div class="kv-label">Current WTC</div><div class="kv-value">${escapeHtml(m.formation.wtcCurrent || "—")}</div>
        <div class="kv-label">Max WTC</div><div class="kv-value">${escapeHtml(m.formation.wtcMax || "—")}</div>
      </div>
      <div class="formation-table-wrap">
        <table class="formation-table">
          <thead>
            <tr>
              <th>Element</th>
              <th>Reg</th>
              <th>Type</th>
              <th>WTC</th>
              <th>Status</th>
              <th>Dep AD</th>
              <th>Arr AD</th>
              <th>Dep</th>
              <th>Arr</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * Generate all active alerts for a movement
 * @param {Object} m - Movement object
 * @returns {Array} Array of alert objects {type, severity, message}
 */
function generateMovementAlerts(m) {
  const alerts = [];
  const now = new Date();
  const todayStr = getTodayDateString();
  const ft = (m.flightType || "").toUpperCase();

  // Check for stale movement (24+ hours old)
  if (m.dof && m.dof < todayStr) {
    const dofDate = new Date(m.dof + "T00:00:00Z");
    const hoursOld = Math.floor((now - dofDate) / (1000 * 60 * 60));
    if (hoursOld >= 24) {
      alerts.push({
        type: 'stale',
        severity: 'warning',
        message: `Movement is ${hoursOld} hours old - still relevant?`
      });
    }
  }

  // Check for overdue arrival (CAA 493 - ARR only)
  if (ft === "ARR" && m.status === "ACTIVE") {
    const eta = getETA(m);
    if (eta && eta !== "-" && m.dof) {
      const etaParts = eta.split(':');
      if (etaParts.length === 2) {
        const etaHours = parseInt(etaParts[0], 10);
        const etaMinutes = parseInt(etaParts[1], 10);

        const etaDate = new Date(m.dof + "T00:00:00Z");
        etaDate.setUTCHours(etaHours, etaMinutes, 0, 0);

        const minutesPastEta = Math.floor((now - etaDate) / (1000 * 60));

        if (minutesPastEta >= 60) {
          alerts.push({
            type: 'overdue_full',
            severity: 'critical',
            message: `FULL OVERDUE ACTION: Aircraft is ${minutesPastEta} minutes past ETA`
          });
        } else if (minutesPastEta >= 30) {
          alerts.push({
            type: 'overdue_preliminary',
            severity: 'warning',
            message: `PRELIMINARY OVERDUE ACTION: Aircraft is ${minutesPastEta} minutes past ETA`
          });
        }
      }
    }
  }

  // Check for emergency squawks (7500, 7600, 7700)
  const squawkCode = (m.squawk || '').replace('#', '');
  if (squawkCode === '7500') {
    alerts.push({
      type: 'emergency_hijack',
      severity: 'critical',
      message: 'EMERGENCY SQUAWK 7500 - Unlawful interference / Hijacking'
    });
  } else if (squawkCode === '7600') {
    alerts.push({
      type: 'emergency_radio',
      severity: 'critical',
      message: 'EMERGENCY SQUAWK 7600 - Radio failure / Lost communications'
    });
  } else if (squawkCode === '7700') {
    alerts.push({
      type: 'emergency_general',
      severity: 'critical',
      message: 'EMERGENCY SQUAWK 7700 - General emergency'
    });
  }

  // Check for wake turbulence category alert
  const config = getConfig();
  const wtcSystem = config.wtcSystem || "ICAO";
  const wtcThreshold = config.wtcAlertThreshold || "off";

  if (wtcThreshold !== "off" && m.wtc) {
    // Extract WTC category from value like "M (ICAO)" or "LM (UK)" or "C (RECAT)"
    const wtcRaw = (m.wtc || "").toUpperCase();
    const wtcMatch = wtcRaw.match(/^([A-Z]+)/);
    const wtcValue = wtcMatch ? wtcMatch[1] : "";
    let shouldAlert = false;
    let categoryName = "";

    if (wtcSystem === "ICAO") {
      // ICAO hierarchy: L < M < H (by MTOM)
      const wtcHierarchy = { "L": 1, "M": 2, "H": 3 };
      const categoryNames = { "L": "Light", "M": "Medium", "H": "Heavy" };
      const threshold = wtcHierarchy[wtcThreshold];
      const current = wtcHierarchy[wtcValue];

      if (threshold && current && current >= threshold) {
        shouldAlert = true;
        categoryName = categoryNames[wtcValue] || wtcValue;
      }
    } else if (wtcSystem === "UK") {
      // UK CAP 493 hierarchy: L < S < LM < UM < H < J
      const wtcHierarchy = { "L": 1, "S": 2, "LM": 3, "UM": 4, "H": 5, "J": 6 };
      const categoryNames = {
        "L": "Light", "S": "Small", "LM": "Lower Medium",
        "UM": "Upper Medium", "H": "Heavy", "J": "Super"
      };
      const threshold = wtcHierarchy[wtcThreshold];
      const current = wtcHierarchy[wtcValue];

      if (threshold && current && current >= threshold) {
        shouldAlert = true;
        categoryName = categoryNames[wtcValue] || wtcValue;
      }
    } else if (wtcSystem === "RECAT") {
      // RECAT-EU hierarchy: F < E < D < C < B < A
      const wtcHierarchy = { "F": 1, "E": 2, "D": 3, "C": 4, "B": 5, "A": 6 };
      const categoryNames = {
        "F": "Light", "E": "Lower Medium", "D": "Upper Medium",
        "C": "Lower Heavy", "B": "Upper Heavy", "A": "Super Heavy"
      };
      const threshold = wtcHierarchy[wtcThreshold];
      const current = wtcHierarchy[wtcValue];

      if (threshold && current && current >= threshold) {
        shouldAlert = true;
        categoryName = categoryNames[wtcValue] || wtcValue;
      }
    }

    if (shouldAlert) {
      alerts.push({
        type: 'wtc_alert',
        severity: 'warning',
        message: `Wake turbulence category ${categoryName} (${wtcValue}) - Be aware of separation requirements`
      });
    }
  }

  // Check for callsign confusion risks
  // Self-exclusion helper
  const isSameMovement = (a, b) => {
    if (a === b) return true;
    if (a?.id != null && b?.id != null) return a.id === b.id;
    return false;
  };

  const allMovements = getMovements();
  const activeOrPlannedMovements = allMovements.filter(mov =>
    (mov.status === 'ACTIVE' || mov.status === 'PLANNED') && !isSameMovement(mov, m)
  );

  // Normalize callsign and registration
  const thisCallsignRaw = (m.callsignCode || '').toUpperCase().trim();
  const thisRegRaw = (m.registration || '').toUpperCase().trim();
  const thisCallsignNorm = thisCallsignRaw.replace(/[-\s]/g, '');
  const thisRegNorm = thisRegRaw.replace(/[-\s]/g, '');

  // Helper: compute registration abbreviation key using UK CAP 413 logic
  function getRegAbbrevKey(regNorm) {
    if (!regNorm) return '';
    // US N-number special case: N + last 3
    if (/^N[0-9A-Z]+$/.test(regNorm) && regNorm.length >= 4) {
      return 'N' + regNorm.slice(-3);
    }
    // Default: first + last 2
    if (regNorm.length >= 3) {
      return regNorm[0] + regNorm.slice(-2);
    }
    return regNorm; // fallback
  }

  // Helper: compute predicted ACTIVE window [startMin, endMin] for a movement.
  // Uses resolved timing model for start/end anchors (canonical spec).
  // Returns null if window cannot be determined.
  function getMovementWindow(mov) {
    const startStr = resolvedStartTime(mov);
    if (!startStr) return null;
    let startMin = timeToMinutes(startStr);
    if (!Number.isFinite(startMin)) return null;

    const endStr = resolvedEndTime(mov);
    let endMin = timeToMinutes(endStr);
    if (!Number.isFinite(endMin)) {
      const ft = (mov.flightType || '').toUpperCase();
      const { minutes } = getDurationSource(mov);
      endMin = startMin + minutes;
    }

    // Handle overnight wrap
    if (endMin < startMin) endMin += 24 * 60;
    return { start: startMin, end: endMin };
  }

  // Overlap test: A.start <= B.end AND B.start <= A.end
  function windowsOverlap(movA, movB) {
    const winA = getMovementWindow(movA);
    const winB = getMovementWindow(movB);
    if (!winA || !winB) return false;
    return winA.start <= winB.end && winB.start <= winA.end;
  }

  // 1. Registration-based callsign confusion (UK CAP 413-aligned)
  // Two severity levels:
  //   RED (callsign_collision_reg): both this movement AND ≥1 conflict are ACTIVE right now.
  //   YELLOW (callsign_confusion_reg): predicted ACTIVE windows overlap, but no live collision.
  if (thisRegNorm && thisCallsignNorm === thisRegNorm) {
    const thisKey = getRegAbbrevKey(thisRegNorm);

    // Find all other ACTIVE/PLANNED movements that share the same abbreviation key
    const conflictingRegs = activeOrPlannedMovements.filter(mov => {
      const otherCallsignRaw = (mov.callsignCode || '').toUpperCase().trim();
      const otherRegRaw = (mov.registration || '').toUpperCase().trim();
      const otherCallsignNorm = otherCallsignRaw.replace(/[-\s]/g, '');
      const otherRegNorm = otherRegRaw.replace(/[-\s]/g, '');
      if (otherRegNorm && otherCallsignNorm === otherRegNorm) {
        const otherKey = getRegAbbrevKey(otherRegNorm);
        return thisKey === otherKey && thisRegNorm !== otherRegNorm;
      }
      return false;
    });

    if (conflictingRegs.length > 0) {
      // RED: this movement is ACTIVE and at least one conflicting movement is also ACTIVE
      const activeConflicts = conflictingRegs.filter(mov => mov.status === 'ACTIVE');
      if (m.status === 'ACTIVE' && activeConflicts.length > 0) {
        const otherCallsigns = activeConflicts.map(mov => mov.callsignCode).join(', ');
        alerts.push({
          type: 'callsign_collision_reg',
          severity: 'critical',
          message: `Abbreviated callsign collision: ${m.callsignCode} and ${otherCallsigns} are both ACTIVE and abbreviate to "${thisKey}"`
        });
      } else {
        // YELLOW: check for overlapping predicted windows (no live collision)
        const overlapConflicts = conflictingRegs.filter(mov => windowsOverlap(m, mov));
        if (overlapConflicts.length > 0) {
          const otherCallsigns = overlapConflicts.map(mov => mov.callsignCode).join(', ');
          alerts.push({
            type: 'callsign_confusion_reg',
            severity: 'warning',
            message: `Potential abbreviated callsign overlap: ${m.callsignCode} and ${otherCallsigns} may be active concurrently (abbrev "${thisKey}")`
          });
        }
      }
    }

  }

  // 2. University Air Squadron (UA_) abbreviated callsign confusion
  // Same two-level logic: RED for live ACTIVE collision, YELLOW for window overlap.
  const uaCodes = ['UAA', 'UAD', 'UAF', 'UAH', 'UAI', 'UAJ', 'UAM', 'UAO', 'UAQ', 'UAS', 'UAT', 'UAU', 'UAV', 'UAW', 'UAX', 'UAY'];
  let thisUaCode = null;
  let thisUaNumber = null;

  for (const code of uaCodes) {
    if (thisCallsignNorm.startsWith(code)) {
      thisUaCode = code;
      thisUaNumber = thisCallsignNorm.substring(code.length);
      break;
    }
  }

  if (thisUaCode && thisUaNumber) {
    const conflictingUa = activeOrPlannedMovements.filter(mov => {
      if (isSameMovement(mov, m)) return false;
      const otherCallsignRaw = (mov.callsignCode || '').toUpperCase().trim();
      const otherCallsignNorm = otherCallsignRaw.replace(/[-\s]/g, '');
      for (const code of uaCodes) {
        if (code !== thisUaCode && otherCallsignNorm.startsWith(code)) {
          const otherNumber = otherCallsignNorm.substring(code.length);
          return otherNumber === thisUaNumber;
        }
      }
      return false;
    });

    if (conflictingUa.length > 0) {
      const activeConflicts = conflictingUa.filter(mov => mov.status === 'ACTIVE');
      if (m.status === 'ACTIVE' && activeConflicts.length > 0) {
        const otherCallsigns = activeConflicts.map(mov => mov.callsignCode).join(', ');
        alerts.push({
          type: 'callsign_collision_ua',
          severity: 'critical',
          message: `Abbreviated callsign collision: ${m.callsignCode} and ${otherCallsigns} are both ACTIVE and abbreviate to "UNIFORM${thisUaNumber}"`
        });
      } else {
        const overlapConflicts = conflictingUa.filter(mov => windowsOverlap(m, mov));
        if (overlapConflicts.length > 0) {
          const otherCallsigns = overlapConflicts.map(mov => mov.callsignCode).join(', ');
          alerts.push({
            type: 'callsign_confusion_ua',
            severity: 'warning',
            message: `Potential abbreviated callsign overlap: ${m.callsignCode} and ${otherCallsigns} may be active concurrently (abbrev "UNIFORM${thisUaNumber}")`
          });
        }
      }
    }
  }

  // 3. Military non-standard vs ICAO abbreviation confusion (unchanged — no collision level needed)
  const knownConflicts = [
    { military: 'CRMSN', icao: 'OUA', phonetic: 'CRIMSON' }
    // Add more known conflicts here as needed
  ];

  for (const conflict of knownConflicts) {
    const conflictingMilitary = activeOrPlannedMovements.filter(mov => {
      if (isSameMovement(mov, m)) return false;
      const otherCallsignRaw = (mov.callsignCode || '').toUpperCase().trim();
      const otherCallsignNorm = otherCallsignRaw.replace(/[-\s]/g, '');
      return (thisCallsignNorm.startsWith(conflict.military) && otherCallsignNorm.startsWith(conflict.icao)) ||
             (thisCallsignNorm.startsWith(conflict.icao) && otherCallsignNorm.startsWith(conflict.military));
    });

    if (conflictingMilitary.length > 0) {
      const otherCallsigns = conflictingMilitary.map(mov => mov.callsignCode).join(', ');
      alerts.push({
        type: 'callsign_confusion_military',
        severity: 'warning',
        message: `Military/ICAO callsign conflict: ${m.callsignCode} and ${otherCallsigns} may both use "${conflict.phonetic}"`
      });
    }
  }

  return alerts;
}

function renderExpandedRow(tbody, m, context = 'live') {
  const expTr = document.createElement("tr");
  expTr.className = "expand-row";

  const expTd = document.createElement("td");

  // Dynamically calculate colspan to span the full table width
  const table = tbody.closest("table");
  const colCount =
    table?.querySelector("thead tr")?.children?.length ||
    table?.querySelector("tbody tr")?.children?.length ||
    12; // fallback

  expTd.colSpan = colCount;

  // Get aircraft type info; prefer ZZZZ text when type is ZZZZ
  const typeData = lookupAircraftType(m.type);
  const typeDisplay = (m.type === 'ZZZZ' && m.aircraftTypeText)
    ? `${escapeHtml(m.aircraftTypeText)} <small style="color:#888">(ZZZZ)</small>`
    : m.type ? `${escapeHtml(m.type)}${typeData && typeData['Common Name'] ? ` (${escapeHtml(typeData['Common Name'])})` : ''}` : "—";

  // Format squawk display (always prepend # if not already present)
  let squawkDisplay = m.squawk || "—";
  if (m.squawk && m.squawk !== "—") {
    squawkDisplay = m.squawk.startsWith('#') ? escapeHtml(m.squawk) : `#${escapeHtml(m.squawk)}`;
  }

  // Generate alerts for this movement
  let alerts = generateMovementAlerts(m);

  // Filter alerts based on History settings when in history context
  if (context === 'history') {
    const config = getConfig();
    alerts = alerts.filter(alert => {
      // Time-based alerts: stale, overdue_full, overdue_preliminary
      const isTimeAlert = ['stale', 'overdue_full', 'overdue_preliminary'].includes(alert.type);
      if (isTimeAlert && !config.historyShowTimeAlerts) return false;

      // Emergency alerts: emergency_hijack, emergency_radio, emergency_general
      const isEmergencyAlert = ['emergency_hijack', 'emergency_radio', 'emergency_general'].includes(alert.type);
      if (isEmergencyAlert && !config.historyShowEmergencyAlerts) return false;

      // Callsign confusion/collision alerts
      const isCallsignAlert = ['callsign_collision_reg', 'callsign_collision_ua', 'callsign_confusion_reg', 'callsign_confusion_ua', 'callsign_confusion_military'].includes(alert.type);
      if (isCallsignAlert && !config.historyShowCallsignAlerts) return false;

      // WTC alerts
      if (alert.type === 'wtc_alert' && !config.historyShowWtcAlerts) return false;

      return true;
    });
  }

  // Render alerts section
  const alertsSection = alerts.length > 0 ? `
    <div class="expand-section expand-section-alerts">
      <div class="expand-subsection">
        <div class="expand-title">Alerts</div>
        <div class="alerts-list">
          ${alerts.map(alert => {
            let iconClass = '';
            let alertClass = '';
            if (alert.severity === 'critical') {
              iconClass = '🔴';
              alertClass = 'alert-critical';
            } else if (alert.severity === 'warning') {
              iconClass = '⚠️';
              alertClass = 'alert-warning';
            } else {
              iconClass = 'ℹ️';
              alertClass = 'alert-info';
            }
            return `<div class="alert-item ${alertClass}"><span class="alert-icon">${iconClass}</span> ${escapeHtml(alert.message)}</div>`;
          }).join('')}
        </div>
      </div>
    </div>
  ` : '';

  expTd.innerHTML = `
    <div class="expand-inner">
      <div class="expand-section">
        <div class="expand-subsection">
          <div class="expand-title">Movement Summary</div>
          <div class="kv">
            <div class="kv-label">Status</div><div class="kv-value">${escapeHtml(statusLabel(m.status))}</div>
            <div class="kv-label">Flight Type</div><div class="kv-value">${escapeHtml(getFullFlightType(m.flightType))}</div>
            <div class="kv-label">Departure</div><div class="kv-value">${m.depAd === 'ZZZZ' && m.depAdText ? escapeHtml(m.depAdText) + ' <small style="color:#888">(ZZZZ)</small>' : escapeHtml(m.depAd) + (m.depName ? ' – ' + escapeHtml(m.depName) : '')}</div>
            <div class="kv-label">Arrival</div><div class="kv-value">${m.arrAd === 'ZZZZ' && m.arrAdText ? escapeHtml(m.arrAdText) + ' <small style="color:#888">(ZZZZ)</small>' : escapeHtml(m.arrAd) + (m.arrName ? ' – ' + escapeHtml(m.arrName) : '')}</div>
            <div class="kv-label">PIC</div><div class="kv-value">${escapeHtml(m.captain || "—")}</div>
            <div class="kv-label">POB</div><div class="kv-value">${escapeHtml(m.pob ?? "—")}</div>
            <div class="kv-label">T&amp;Gs</div><div class="kv-value">${escapeHtml(m.tngCount ?? 0)}</div>
            <div class="kv-label">O/S count</div><div class="kv-value">${escapeHtml(m.osCount ?? 0)}</div>
            <div class="kv-label">FIS count</div><div class="kv-value">${escapeHtml(m.fisCount ?? 0)}</div>
            ${(m.outcomeStatus && m.outcomeStatus !== 'NORMAL') ? `<div class="kv-label">Outcome</div><div class="kv-value outcome-badge outcome-${escapeHtml(m.outcomeStatus.toLowerCase())}">${escapeHtml(m.outcomeStatus)}</div>` : ''}
            ${(m.outcomeReason) ? `<div class="kv-label">Outcome Reason</div><div class="kv-value">${escapeHtml(m.outcomeReason)}</div>` : ''}
            ${(m.actualDestinationAd) ? `<div class="kv-label">Actual Dest.</div><div class="kv-value">${m.actualDestinationAd === 'ZZZZ' && m.actualDestinationText ? escapeHtml(m.actualDestinationText) + ' <small style="color:#888">(ZZZZ)</small>' : escapeHtml(m.actualDestinationAd)}</div>` : ''}
          </div>
        </div>
        ${renderFormationDetails(m)}
      </div>

      <div class="expand-section">
        <div class="expand-subsection">
          <div class="expand-title">Coding &amp; Classification</div>
          <div class="kv">
            <div class="kv-label">ACFT TYPE</div><div class="kv-value">${typeDisplay}</div>
            <div class="kv-label">EGOW CODE</div><div class="kv-value">${escapeHtml(getEgowCodeDescription(m.egowCode))}</div>
            <div class="kv-label">EGOW UNIT</div><div class="kv-value">${escapeHtml(m.unitCode || "—")}</div>
            <div class="kv-label">UNIT</div><div class="kv-value">${escapeHtml(m.unitDesc || "—")}</div>
            <div class="kv-label">OPERATOR</div><div class="kv-value">${escapeHtml(m.operator || "—")}</div>
          </div>
        </div>
      </div>

      <div class="expand-section">
        <div class="expand-subsection">
          <div class="expand-title">Additional</div>
          <div class="kv">
            ${m.remarks && m.remarks !== '' && m.remarks !== '-' ? `<div class="kv-label">REMARKS EXTD</div><div class="kv-value" style="text-transform: uppercase;">${escapeHtml(m.remarks)}</div>` : ''}
            ${m.warnings && m.warnings !== '' && m.warnings !== '-' ? `<div class="kv-label">WARNINGS</div><div class="kv-value" style="color: #d32f2f; font-weight: 600;">${escapeHtml(m.warnings)}</div>` : ''}
            ${m.notes && m.notes !== '' && m.notes !== '-' ? `<div class="kv-label">NOTES</div><div class="kv-value">${escapeHtml(m.notes)}</div>` : ''}
            ${m.squawk && m.squawk !== '' && m.squawk !== '-' && m.squawk !== '—' ? `<div class="kv-label">SQUAWK</div><div class="kv-value">${squawkDisplay}</div>` : ''}
            ${m.route && m.route !== '' && m.route !== '-' ? `<div class="kv-label">ROUTE</div><div class="kv-value">${escapeHtml(m.route)}</div>` : ''}
            ${m.clearance && m.clearance !== '' && m.clearance !== '-' ? `<div class="kv-label">CLEARANCE</div><div class="kv-value">${escapeHtml(m.clearance)}</div>` : ''}
          </div>
        </div>
      </div>

      ${alertsSection}
    </div>
  `;

  expTr.appendChild(expTd);
  tbody.appendChild(expTr);
}

/**
 * Determine initial status for a new movement based on whether its time is in the past
 * Movements with times already past are set to ACTIVE immediately
 * @param {string} flightType - Flight type (DEP, ARR, LOC, OVR)
 * @param {string} dof - Date of flight (YYYY-MM-DD)
 * @param {string} depPlanned - Planned departure time (HH:MM)
 * @param {string} arrPlanned - Planned arrival time (HH:MM)
 * @returns {string} 'ACTIVE' if time is past, otherwise 'PLANNED'
 */
function determineInitialStatus(flightType, dof, depPlanned, arrPlanned) {
  const ft = (flightType || '').toUpperCase();
  let timeToCheck = '';

  // Determine which time field to check based on flight type
  if (ft === 'DEP' || ft === 'LOC') {
    timeToCheck = depPlanned;
  } else if (ft === 'ARR' || ft === 'OVR') {
    timeToCheck = arrPlanned;
  }

  // If no time provided, default to PLANNED
  if (!timeToCheck || timeToCheck.trim() === '') {
    return 'PLANNED';
  }

  // Check if time is in the past
  const { isPast } = checkPastTime(timeToCheck, dof);
  return isPast ? 'ACTIVE' : 'PLANNED';
}

/**
 * Re-evaluate status after a time field change.
 * If a movement is ACTIVE (no actual completion time recorded) and its primary planned
 * time has been moved outside the auto-activate window, revert it to PLANNED.
 * @param {number|string} movementId
 * @returns {boolean} true if status was reverted
 */
function reEvaluateStatusAfterTimeChange(movementId) {
  const movement = getMovements().find(m => String(m.id) === String(movementId));
  if (!movement || movement.status !== 'ACTIVE') return false;

  const ft = (movement.flightType || '').toUpperCase();

  // Do not revert if actual completion is already recorded
  if (ft === 'ARR' || ft === 'LOC') {
    if (movement.arrActual && String(movement.arrActual).trim()) return false;
  }
  if (ft === 'DEP' || ft === 'LOC') {
    if (movement.depActual && String(movement.depActual).trim()) return false;
  }
  if (ft === 'OVR') {
    if (movement.depActual && String(movement.depActual).trim()) return false;
  }

  const config = getConfig();
  const activationSettings = {
    DEP: { enabled: config.autoActivateDepEnabled ?? false,
           minutes: Math.min(config.autoActivateDepMinutes || 30, 120) },
    ARR: { enabled: config.autoActivateArrEnabled ?? config.autoActivateEnabled ?? true,
           minutes: Math.min(config.autoActivateArrMinutes || config.autoActivateMinutesBeforeEta || 30, 120) },
    LOC: { enabled: config.autoActivateLocEnabled ?? false,
           minutes: Math.min(config.autoActivateLocMinutes || 30, 120) },
    OVR: { enabled: config.autoActivateOvrEnabled ?? config.autoActivateEnabled ?? true,
           minutes: Math.min(config.autoActivateOvrMinutes || config.ovrAutoActivateMinutes || 30, 120) }
  };

  const settings = activationSettings[ft];
  if (!settings || !settings.enabled) return false; // auto-activation is off for this type

  // Get the primary planned time
  let timeStr;
  if (ft === 'DEP' || ft === 'LOC') timeStr = getETD(movement);
  else if (ft === 'OVR') timeStr = getECT(movement);
  else timeStr = getETA(movement);

  if (!timeStr || !movement.dof) return false;

  const timeParts = timeStr.split(':');
  if (timeParts.length !== 2) return false;

  const plannedDate = new Date(movement.dof + 'T00:00:00Z');
  plannedDate.setUTCHours(parseInt(timeParts[0], 10), parseInt(timeParts[1], 10), 0, 0);
  const minutesUntil = Math.floor((plannedDate - new Date()) / (1000 * 60));

  // Revert to PLANNED if more than the configured activation window away
  if (minutesUntil > settings.minutes) {
    updateMovement(movement.id, { status: 'PLANNED' });
    return true;
  }
  return false;
}

/**
 * Auto-activate PLANNED movements when they reach the configured time before their planned time
 * Supports all 4 flight types with individual enable/minutes config:
 * - DEP: Activates before ETD (useful for pre-departure checks)
 * - ARR: Activates before ETA (default enabled)
 * - LOC: Activates before ETD (useful for local flights)
 * - OVR: Activates before EOFT (default enabled)
 */
function autoActivatePlannedMovements() {
  const config = getConfig();
  const now = new Date();

  // Get activation settings for each flight type (with fallback to legacy settings)
  const activationSettings = {
    DEP: {
      enabled: config.autoActivateDepEnabled ?? false,
      minutes: Math.min(config.autoActivateDepMinutes || 30, 120)
    },
    ARR: {
      enabled: config.autoActivateArrEnabled ?? config.autoActivateEnabled ?? true,
      minutes: Math.min(config.autoActivateArrMinutes || config.autoActivateMinutesBeforeEta || 30, 120)
    },
    LOC: {
      enabled: config.autoActivateLocEnabled ?? false,
      minutes: Math.min(config.autoActivateLocMinutes || 30, 120)
    },
    OVR: {
      enabled: config.autoActivateOvrEnabled ?? config.autoActivateEnabled ?? true,
      minutes: Math.min(config.autoActivateOvrMinutes || config.ovrAutoActivateMinutes || 30, 120)
    }
  };

  // Get all PLANNED movements
  const plannedMovements = getMovements().filter(m => m.status === 'PLANNED');

  for (const movement of plannedMovements) {
    const ft = (movement.flightType || '').toUpperCase();
    const settings = activationSettings[ft];

    // Skip if this flight type's auto-activation is not enabled
    if (!settings || !settings.enabled) {
      continue;
    }

    // Get the appropriate time field based on flight type
    // DEP/LOC use ETD (depPlanned), ARR uses ETA (arrPlanned), OVR uses ECT/EOFT (depPlanned)
    let timeStr;
    if (ft === 'DEP' || ft === 'LOC') {
      timeStr = getETD(movement);
    } else if (ft === 'OVR') {
      timeStr = getECT(movement);
    } else {
      timeStr = getETA(movement);
    }

    // Skip if no valid time or DOF
    if (!timeStr || timeStr === '-' || !movement.dof) {
      continue;
    }

    // Parse time (HH:MM format)
    const timeParts = timeStr.split(':');
    if (timeParts.length !== 2) {
      continue;
    }

    const hours = parseInt(timeParts[0], 10);
    const minutes = parseInt(timeParts[1], 10);

    // Create date object for the planned time
    const plannedDate = new Date(movement.dof + 'T00:00:00Z');
    plannedDate.setUTCHours(hours, minutes, 0, 0);

    // Calculate minutes until planned time
    const minutesUntil = Math.floor((plannedDate - now) / (1000 * 60));

    // Auto-activate if within the configured window
    // Don't auto-activate if more than 1 hour past (probably stale)
    if (minutesUntil <= settings.minutes && minutesUntil >= -60) {
      transitionToActive(movement.id);
    }
  }
}

// Legacy alias for backwards compatibility
function autoActivatePlannedArrivals() {
  autoActivatePlannedMovements();
}

export function renderLiveBoard() {
  if (window.__FDMS_DIAGNOSTICS__ && window.__fdmsDiag) window.__fdmsDiag.renderLiveBoardCount++;
  const tbody = byId("liveBody");
  if (!tbody) return;

  // Auto-activate PLANNED movements before their planned time if enabled
  autoActivatePlannedMovements();

  closeDropdownPortal();                                // restore any portalled menu before wiping DOM
  tbody.innerHTML = "";

  const movements = getMovements().filter(matchesFilters).slice().sort(compareForLiveBoard);

  let previousStatus = null;

  for (const m of movements) {
    // Insert divider when transitioning from ACTIVE to PLANNED
    if (previousStatus === "ACTIVE" && m.status === "PLANNED") {
      const dividerTr = document.createElement("tr");
      dividerTr.className = "status-divider-row";
      dividerTr.innerHTML = `
        <td colspan="12" style="padding: 0;">
          <div style="height: 2px; background: linear-gradient(to right, transparent, #ccc, transparent); margin: 4px 0;"></div>
        </td>
      `;
      tbody.appendChild(dividerTr);
    }

    previousStatus = m.status;

    const tr = document.createElement("tr");
    tr.className = `strip strip-row ${flightTypeClass(m.flightType)}`;
    tr.dataset.id = String(m.id);

    // Use semantic time fields based on flight type.
    // Every displayed time is explicitly labeled (ETD/ATD/ETA/ATA/EOFT/AOFT/ELFT/ALFT).
    // The label itself is the mode selector: clicking it toggles between estimate and actual.
    // Estimated times carry class "time-estimated"; actual times carry "time-actual".
    const ft = (m.flightType || "").toUpperCase();
    let depDisplay = "-";
    let arrDisplay = "-";
    let depLabel = "";
    let arrLabel = "";
    let depIsActual = false;
    let arrIsActual = false;

    // Resolve dep-side mode (auto-derives from actual presence unless operator toggled).
    // ARR dep-side (ATD from origin) has no estimate/actual pair — always shown as ATD when present.
    const depHasActual = !!(m.depActual && String(m.depActual).trim());
    const arrHasActual = !!(m.arrActual && String(m.arrActual).trim());

    if (ft === "DEP" || ft === "LOC" || ft === "OVR") {
      const depMode = _resolveInlineTimeMode(m.id, 'dep', depHasActual);
      const depField = _inlineTimeFieldForMode(ft, 'dep', depMode);
      const rawVal = m[depField] && String(m[depField]).trim();
      depDisplay = rawVal || "-";
      depLabel = _inlineTimeLabelForMode(ft, 'dep', depMode); // always show — label is the mode selector
      depIsActual = depMode === 'actual';
    } else if (ft === "ARR" && depHasActual) {
      // ARR dep-side: show ATD from origin when populated (no toggle — always depActual)
      depDisplay = String(m.depActual).trim();
      depLabel = "ATD";
      depIsActual = true;
    }

    // arr-side: all types — label always shown so operator can see/toggle mode
    {
      const arrMode = _resolveInlineTimeMode(m.id, 'arr', arrHasActual);
      const arrField = _inlineTimeFieldForMode(ft, 'arr', arrMode);
      const rawVal = m[arrField] && String(m[arrField]).trim();
      arrDisplay = rawVal || "-";
      arrLabel = _inlineTimeLabelForMode(ft, 'arr', arrMode);
      arrIsActual = arrMode === 'actual';
    }

    // Format date (DD/MM/YYYY)
    const dofFormatted = m.dof ? m.dof.split('-').reverse().join('/') : '';

    // Get rules display (single letter)
    let rulesDisplay = '';
    if (m.rules === 'VFR') rulesDisplay = 'V';
    else if (m.rules === 'IFR') rulesDisplay = 'I';
    else if (m.rules === 'Y') rulesDisplay = 'Y';
    else if (m.rules === 'Z') rulesDisplay = 'Z';
    else if (m.rules === 'SVFR') rulesDisplay = 'S';

    // Generate all alerts for this movement
    const alerts = generateMovementAlerts(m);
    const config = getConfig();
    const enableTooltips = config.enableAlertTooltips !== false;
    const showLabels = config.showTimeLabelsOnStrip !== false;
    const showDepEstimated = config.showDepEstimatedTimesOnStrip !== false;
    const showArrEstimated = config.showArrEstimatedTimesOnStrip !== false;
    const showLocEstimated = config.showLocEstimatedTimesOnStrip !== false;
    const showOvrEstimated = config.showOvrEstimatedTimesOnStrip !== false;
    const showEstimated = ft === "ARR" ? showArrEstimated
      : ft === "LOC" ? showLocEstimated
      : ft === "OVR" ? showOvrEstimated
      : showDepEstimated;

    // Determine highlighting and tooltips based on alerts
    let overdueClass = '';
    let tooltipTitle = '';
    const staleAlert = alerts.find(a => a.type === 'stale');
    const overdueFullAlert = alerts.find(a => a.type === 'overdue_full');
    const overduePrelimAlert = alerts.find(a => a.type === 'overdue_preliminary');
    const emergencyAlert = alerts.find(a => a.type === 'emergency_hijack' || a.type === 'emergency_radio' || a.type === 'emergency_general');

    // Emergency squawks and overdue alerts - set class for time highlighting
    if (emergencyAlert) {
      overdueClass = 'overdue-full';
      if (enableTooltips) {
        tooltipTitle = ` title="${escapeHtml(emergencyAlert.message)}"`;
      }
    } else if (overdueFullAlert) {
      overdueClass = 'overdue-full';
      if (enableTooltips) {
        tooltipTitle = ` title="${escapeHtml(overdueFullAlert.message)}"`;
      }
    } else if (overduePrelimAlert) {
      overdueClass = 'overdue-preliminary';
      if (enableTooltips) {
        tooltipTitle = ` title="${escapeHtml(overduePrelimAlert.message)}"`;
      }
    }

    // Keep stale warning for date display
    const now = new Date();
    const todayStr = getTodayDateString();
    let staleWarning = '';
    if (staleAlert) {
      staleWarning = `⚠ ${staleAlert.message}`;
    }

    // Get indicator bar color
    const indicatorColor = getEgowIndicatorColor(m.egowCode, m.unitCode);
    const indicatorTitle = `${m.egowCode || ''}${m.unitCode ? ' - ' + m.unitCode : ''}`;

    // Check for callsign confusion/collision alerts (two levels)
    const hasCallsignCollision = alerts.some(a =>
      a.type === 'callsign_collision_reg' ||
      a.type === 'callsign_collision_ua'
    );
    const hasCallsignConfusion = alerts.some(a =>
      a.type === 'callsign_confusion_reg' ||
      a.type === 'callsign_confusion_ua' ||
      a.type === 'callsign_confusion_military'
    );
    const callsignClass = hasCallsignCollision
      ? 'call-main callsign-confusion callsign-collision'
      : hasCallsignConfusion ? 'call-main callsign-confusion' : 'call-main';

    // Check for WTC alert
    const hasWtcAlert = alerts.some(a => a.type === 'wtc_alert');
    const wtcDisplay = hasWtcAlert
      ? `<span class="wtc-alert">${escapeHtml(m.wtc || "—")}</span>`
      : escapeHtml(m.wtc || "—");

    // WTC exact-time display — own line below WTC category, shown only when WTC alert
    // threshold is met and an exact Active-button timestamp is available.
    const wtcExactHtml = (hasWtcAlert && m.depActualExact)
      ? `<div class="wtc-exact-time">${escapeHtml(m.depActualExact)}</div>`
      : '';

    tr.innerHTML = `
      <td><div class="status-strip" style="background-color: ${indicatorColor};" title="${escapeHtml(indicatorTitle)}"></div></td>
      <td>
        <div class="${callsignClass} js-edit-callsign">${escapeHtml(m.callsignCode)}</div>
        <div class="call-sub js-edit-voice">${m.callsignVoice ? escapeHtml(m.callsignVoice) : "&nbsp;"}</div>
        ${m.formation && Array.isArray(m.formation.elements) && m.formation.elements.length > 0 ? `<span class="badge badge-formation">F×${m.formation.elements.length}</span>` : ""}
      </td>
      <td class="priority-cell" style="text-align: center; ${m.priorityLetter ? 'padding: 0 6px 0 4px;' : 'padding: 0; width: 0;'}">
        ${m.priorityLetter ? `<span class="priority-letter" title="Flight Priority ${escapeHtml(m.priorityLetter)}">${escapeHtml(m.priorityLetter)}</span>` : ''}
      </td>
      <td>
        <div class="cell-strong"><span class="js-edit-reg">${escapeHtml(m.registration || "—")}</span>${m.type ? ` · <span class="js-edit-type" title="${escapeHtml(m.popularName || '')}">${escapeHtml(m.type)}</span>` : ""}</div>
        <div class="cell-muted">WTC: <span class="js-edit-wtc">${wtcDisplay}</span></div>
        ${wtcExactHtml}
      </td>
      <td>
        <div class="cell-strong"><span class="js-edit-dep-ad"${m.depName && m.depName !== '' ? ` title="${m.depName}"` : ''}>${escapeHtml(m.depAd)}</span></div>
        <div class="cell-strong"><span class="js-edit-arr-ad"${m.arrName && m.arrName !== '' ? ` title="${m.arrName}"` : ''}>${escapeHtml(m.arrAd)}</span></div>
      </td>
      <td style="text-align: center;">
        <div class="cell-strong"><span class="js-edit-rules">${rulesDisplay}</span></div>
      </td>
      <td${tooltipTitle}>${(() => {
        // Apply display toggles
        const depShowTime = depIsActual ? depDisplay : (showEstimated ? depDisplay : '-');
        const arrShowTime = arrIsActual ? arrDisplay : (showEstimated ? arrDisplay : '-');
        // dep label: toggleable for DEP/LOC/OVR; inert span for ARR dep-side (no estimate/actual pair)
        const depLabelHtml = (showLabels && depLabel)
          ? (ft !== 'ARR'
              ? `<span class="time-label js-time-label-toggle${depIsActual ? ' mode-actual' : ''}" data-id="${m.id}" data-side="dep" title="Click to toggle ${depIsActual ? 'estimate' : 'actual'} mode">${depLabel}</span>`
              : `<span class="time-label">${depLabel}</span>`)
          : '';
        // arr label: always toggleable (all types have estimate/actual arr pair)
        const arrLabelHtml = (showLabels && arrLabel)
          ? `<span class="time-label js-time-label-toggle${arrIsActual ? ' mode-actual' : ''}" data-id="${m.id}" data-side="arr" title="Click to toggle ${arrIsActual ? 'estimate' : 'actual'} mode">${arrLabel}</span>`
          : '';
        const depClass = depLabel ? (depIsActual ? ' time-actual' : ' time-estimated') : '';
        const arrClass = arrLabel ? (arrIsActual ? ' time-actual' : ' time-estimated') : '';
        const depSpan = `<span class="js-edit-dep-time${depClass}">${depLabelHtml}${escapeHtml(depShowTime)}</span>`;
        const arrSpan = overdueClass
          ? `<span class="js-edit-arr-time ${overdueClass}${arrClass}">${arrLabelHtml}${escapeHtml(arrShowTime)}</span>`
          : `<span class="js-edit-arr-time${arrClass}">${arrLabelHtml}${escapeHtml(arrShowTime)}</span>`;
        return `
        <div class="cell-strong time-display-cell">
          ${depSpan}
          <span class="time-sep"> / </span>
          ${arrSpan}
        </div>
        <div class="cell-muted">${staleWarning ? `<span class="stale-movement" title="${staleWarning}">${dofFormatted}</span>` : dofFormatted}<br>${escapeHtml(m.flightType)} · ${escapeHtml(statusLabel(m.status))}</div>`;
      })()}
      </td>
      <td style="text-align: center;">
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;">
          <span class="js-edit-tng" style="min-width: 20px; text-align: center; font-weight: 600;">${m.tngCount || 0}</span>
          <div style="display: flex; gap: 4px;">
            <button class="counter-btn js-dec-tng" data-id="${m.id}" type="button" aria-label="Decrease T&G">◄</button>
            <button class="counter-btn js-inc-tng" data-id="${m.id}" type="button" aria-label="Increase T&G">►</button>
          </div>
        </div>
      </td>
      <td style="text-align: center;">
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;">
          <span class="js-edit-os" style="min-width: 20px; text-align: center; font-weight: 600;">${m.osCount || 0}</span>
          <div style="display: flex; gap: 4px;">
            <button class="counter-btn js-dec-os" data-id="${m.id}" type="button" aria-label="Decrease O/S">◄</button>
            <button class="counter-btn js-inc-os" data-id="${m.id}" type="button" aria-label="Increase O/S">►</button>
          </div>
        </div>
      </td>
      <td style="text-align: center;">
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;">
          <span class="js-edit-fis" style="min-width: 20px; text-align: center; font-weight: 600;">${m.fisCount || 0}</span>
          <div style="display: flex; gap: 4px;">
            <button class="counter-btn js-dec-fis" data-id="${m.id}" type="button" aria-label="Decrease FIS">◄</button>
            <button class="counter-btn js-inc-fis" data-id="${m.id}" type="button" aria-label="Increase FIS">►</button>
          </div>
        </div>
      </td>
      <td>
        <div class="js-edit-remarks" style="font-size: 12px; text-transform: uppercase;">${escapeHtml(m.remarks || '')}</div>
      </td>
      <td class="actions-cell">
        <div style="display: flex; flex-direction: column; gap: 2px; align-items: flex-end;">
          ${
            m.status === "PLANNED"
              ? '<button class="small-btn js-activate" type="button" aria-label="Activate movement">→ Active</button>'
              : m.status === "ACTIVE"
              ? '<button class="small-btn js-complete" type="button" aria-label="Complete movement">→ Complete</button>'
              : ""
          }
          <div style="position: relative; display: inline-block; z-index: 1;">
            <button class="small-btn js-edit-dropdown" type="button" aria-label="Edit menu">Edit ▾</button>
            <div class="js-edit-menu" style="display: none; position: absolute; right: 0; top: 100%; background: white; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); z-index: 9999; min-width: 120px; margin-top: 2px;">
              <button class="js-edit-details" type="button" style="display: block; width: 100%; padding: 8px 12px; border: none; background: none; text-align: left; cursor: pointer; font-size: 14px; white-space: nowrap;" onmouseover="this.style.backgroundColor='#f0f0f0'" onmouseout="this.style.backgroundColor='transparent'">Details</button>
              <button class="js-duplicate" type="button" style="display: block; width: 100%; padding: 8px 12px; border: none; background: none; text-align: left; cursor: pointer; font-size: 14px; white-space: nowrap;" onmouseover="this.style.backgroundColor='#f0f0f0'" onmouseout="this.style.backgroundColor='transparent'">Duplicate</button>
              ${
                ft === "DEP"
                  ? '<button class="js-produce-arr" type="button" style="display: block; width: 100%; padding: 8px 12px; border: none; background: none; text-align: left; cursor: pointer; font-size: 14px; white-space: nowrap;" onmouseover="this.style.backgroundColor=\'#f0f0f0\'" onmouseout="this.style.backgroundColor=\'transparent\'">Arrival</button>'
                  : ft === "ARR"
                    ? '<button class="js-produce-dep" type="button" style="display: block; width: 100%; padding: 8px 12px; border: none; background: none; text-align: left; cursor: pointer; font-size: 14px; white-space: nowrap;" onmouseover="this.style.backgroundColor=\'#f0f0f0\'" onmouseout="this.style.backgroundColor=\'transparent\'">Departure</button>'
                    : ""
              }
              ${
                m.status === "PLANNED" || m.status === "ACTIVE"
                  ? '<button class="js-cancel" type="button" style="display: block; width: 100%; padding: 8px 12px; border: none; background: none; text-align: left; cursor: pointer; font-size: 14px; color: #dc3545; white-space: nowrap;" onmouseover="this.style.backgroundColor=\'#f0f0f0\'" onmouseout="this.style.backgroundColor=\'transparent\'">Cancel</button>'
                  : ""
              }
              <button class="js-delete-strip" type="button" style="display: block; width: 100%; padding: 8px 12px; border: none; background: none; text-align: left; cursor: pointer; font-size: 14px; color: #dc3545; font-weight: 600; white-space: nowrap; border-top: 1px solid #eee;" onmouseover="this.style.backgroundColor='#f0f0f0'" onmouseout="this.style.backgroundColor='transparent'">Delete</button>
            </div>
          </div>
          <button class="small-btn js-toggle-details" type="button" aria-label="Toggle details for ${escapeHtml(m.callsignCode)}">Info ▾</button>
        </div>
      </td>
    `;

    // Bind Edit dropdown toggle (portal-based – escapes overflow)
    const editDropdownBtn = tr.querySelector(".js-edit-dropdown");
    const editMenu = tr.querySelector(".js-edit-menu");
    safeOn(editDropdownBtn, "click", (e) => {
      e.stopPropagation();
      if (_portalMenu === editMenu) {
        closeDropdownPortal();
      } else {
        openDropdownPortal(editMenu, editDropdownBtn);
      }
    });

    // Bind Edit Details option (opens edit modal)
    const editDetailsBtn = tr.querySelector(".js-edit-details");
    safeOn(editDetailsBtn, "click", (e) => {
      e.stopPropagation();
      closeDropdownPortal();
      openEditMovementModal(m);
    });

    // Bind Duplicate option
    const duplicateBtn = tr.querySelector(".js-duplicate");
    safeOn(duplicateBtn, "click", (e) => {
      e.stopPropagation();
      closeDropdownPortal();
      openDuplicateMovementModal(m);
    });

    // Bind Produce Arrival option (for DEP strips)
    const produceArrBtn = tr.querySelector(".js-produce-arr");
    safeOn(produceArrBtn, "click", (e) => {
      e.stopPropagation();
      closeDropdownPortal();
      openReciprocalStripModal(m, "ARR");
    });

    // Bind Produce Departure option (for ARR strips)
    const produceDepBtn = tr.querySelector(".js-produce-dep");
    safeOn(produceDepBtn, "click", (e) => {
      e.stopPropagation();
      closeDropdownPortal();
      openReciprocalStripModal(m, "DEP");
    });

    // Bind Cancel option
    const cancelBtn = tr.querySelector(".js-cancel");
    safeOn(cancelBtn, "click", (e) => {
      e.stopPropagation();
      closeDropdownPortal();
      transitionToCancelled(m.id);
    });

    // Bind Delete option (hard delete)
    const deleteBtn = tr.querySelector(".js-delete-strip");
    safeOn(deleteBtn, "click", (e) => {
      e.stopPropagation();
      closeDropdownPortal();
      performDeleteStrip(m);
    });

    // Bind status transition buttons
    const activateBtn = tr.querySelector(".js-activate");
    safeOn(activateBtn, "click", (e) => {
      e.stopPropagation();
      transitionToActive(m.id);
    });

    const completeBtn = tr.querySelector(".js-complete");
    safeOn(completeBtn, "click", (e) => {
      e.stopPropagation();
      transitionToCompleted(m.id);
    });

    // Bind info toggle (formerly details)
    const toggleBtn = tr.querySelector(".js-toggle-details");
    safeOn(toggleBtn, "click", (e) => {
      e.stopPropagation();
      expandedId = expandedId === m.id ? null : m.id;
      renderLiveBoard();
    });

    // Bind counter increment/decrement buttons
    const incTng = tr.querySelector(".js-inc-tng");
    safeOn(incTng, "click", (e) => {
      e.stopPropagation();
      updateMovement(m.id, { tngCount: Math.min((m.tngCount || 0) + 1, 99) });
      renderLiveBoard();
      renderHistoryBoard();
    });

    const decTng = tr.querySelector(".js-dec-tng");
    safeOn(decTng, "click", (e) => {
      e.stopPropagation();
      updateMovement(m.id, { tngCount: Math.max((m.tngCount || 0) - 1, 0) });
      renderLiveBoard();
      renderHistoryBoard();
    });

    const incOs = tr.querySelector(".js-inc-os");
    safeOn(incOs, "click", (e) => {
      e.stopPropagation();
      updateMovement(m.id, { osCount: Math.min((m.osCount || 0) + 1, 99) });
      renderLiveBoard();
      renderHistoryBoard();
    });

    const decOs = tr.querySelector(".js-dec-os");
    safeOn(decOs, "click", (e) => {
      e.stopPropagation();
      updateMovement(m.id, { osCount: Math.max((m.osCount || 0) - 1, 0) });
      renderLiveBoard();
      renderHistoryBoard();
    });

    const incFis = tr.querySelector(".js-inc-fis");
    safeOn(incFis, "click", (e) => {
      e.stopPropagation();
      updateMovement(m.id, { fisCount: Math.min((m.fisCount || 0) + 1, 99) });
      renderLiveBoard();
      renderHistoryBoard();
      if (window.updateFisCounters) window.updateFisCounters();
      if (window.updateDailyStats) window.updateDailyStats();
    });

    const decFis = tr.querySelector(".js-dec-fis");
    safeOn(decFis, "click", (e) => {
      e.stopPropagation();
      updateMovement(m.id, { fisCount: Math.max((m.fisCount || 0) - 1, 0) });
      renderLiveBoard();
      renderHistoryBoard();
      if (window.updateFisCounters) window.updateFisCounters();
      if (window.updateDailyStats) window.updateDailyStats();
    });

    // Build field-specific tooltips for inline editable cells
    const _tt = (() => {
      const WTC_FULL = {
        L: 'LIGHT', M: 'MEDIUM', H: 'HEAVY', J: 'SUPER',
        S: 'SMALL', LM: 'LOWER MEDIUM', UM: 'UPPER MEDIUM',
        A: 'SUPER HEAVY', B: 'UPPER HEAVY', C: 'LOWER HEAVY',
        D: 'UPPER MEDIUM (RECAT)', E: 'LOWER MEDIUM (RECAT)', F: 'LIGHT (RECAT)'
      };
      const RULES_FULL = {
        VFR: 'VFR – Visual Flight Rules', IFR: 'IFR – Instrument Flight Rules',
        SVFR: 'SVFR – Special VFR', Y: 'Y – IFR departing, changing to VFR',
        Z: 'Z – VFR departing, changing to IFR'
      };
      const unitInfo = (() => {
        const unit = lookupUnitFromCallsign(m.callsignCode || '', m.type || '');
        const op   = lookupOperatorFromCallsign(m.callsignCode || '', m.type || '');
        return [unit, op].filter(v => v && v !== '-').join(' / ');
      })();
      const regNationality = (() => {
        const reg = (m.registration || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!reg) return '';
        // ICAO registration prefix → nationality/state (ordered longest-first where ambiguous)
        const PREFIX_MAP = [
          // Military / special
          ['ZZ',  'UK Military'],
          // Two-letter prefixes (must be checked before single-letter overlaps)
          ['AP',  'Pakistan'],       ['A2',  'Botswana'],        ['A3',  'Tonga'],
          ['A5',  'Bhutan'],         ['A6',  'United Arab Emirates'], ['A7', 'Qatar'],
          ['A9C', 'Bahrain'],
          ['B',   'China / Taiwan'], // catch-all for B
          ['C2',  'Nauru'],          ['C3',  'Andorra'],         ['C5',  'Gambia'],
          ['C6',  'Bahamas'],        ['C9',  'Mozambique'],      ['CC',  'Chile'],
          ['CN',  'Morocco'],        ['CP',  'Bolivia'],         ['CS',  'Portugal'],
          ['CU',  'Cuba'],           ['CX',  'Uruguay'],         ['CY',  'Cyprus (abandoned)'],
          ['D2',  'Angola'],         ['D4',  'Cape Verde'],      ['D6',  'Comoros'],
          ['DQ',  'Fiji'],           ['DU',  'Philippines'],
          ['E3',  'Eritrea'],        ['E7',  'Bosnia and Herzegovina'],
          ['EC',  'Spain'],          ['EI',  'Ireland'],         ['EK',  'Armenia'],
          ['EL',  'Liberia'],        ['EP',  'Iran'],            ['ER',  'Moldova'],
          ['ES',  'Estonia'],        ['ET',  'Ethiopia'],        ['EW',  'Belarus'],
          ['EX',  'Kyrgyzstan'],     ['EY',  'Tajikistan'],      ['EZ',  'Turkmenistan'],
          ['F',   'France'],
          ['G',   'United Kingdom'],
          ['HA',  'Hungary'],        ['HB',  'Switzerland'],     ['HC',  'Ecuador'],
          ['HD',  'Ecuador'],        ['HH',  'Haiti'],           ['HI',  'Dominican Republic'],
          ['HK',  'Colombia'],       ['HL',  'South Korea'],     ['HP',  'Panama'],
          ['HR',  'Honduras'],       ['HS',  'Thailand'],        ['HV',  'Vatican'],
          ['HZ',  'Saudi Arabia'],
          ['I',   'Italy'],
          ['J2',  'Djibouti'],       ['J3',  'Grenada'],         ['J5',  'Guinea-Bissau'],
          ['J6',  'Saint Lucia'],    ['J7',  'Dominica'],        ['J8',  'Saint Vincent'],
          ['JA',  'Japan'],          ['JY',  'Jordan'],
          ['LN',  'Norway'],         ['LQ',  'Bosnia'],          ['LV',  'Argentina'],
          ['LX',  'Luxembourg'],     ['LY',  'Lithuania'],       ['LZ',  'Bulgaria'],
          ['N',   'United States'],
          ['OB',  'Peru'],           ['OD',  'Lebanon'],         ['OE',  'Austria'],
          ['OH',  'Finland'],        ['OK',  'Czech Republic'],  ['OM',  'Slovakia'],
          ['OO',  'Belgium'],        ['OY',  'Denmark'],
          ['P',   'North Korea'],    ['P2',  'Papua New Guinea'], ['P4', 'Aruba'],
          ['PH',  'Netherlands'],    ['PJ',  'Sint Maarten'],    ['PK',  'Indonesia'],
          ['PP',  'Brazil'],         ['PR',  'Brazil'],          ['PT',  'Brazil'],
          ['PU',  'Brazil'],         ['PZ',  'Suriname'],
          ['RA',  'Russia'],         ['RK',  'South Korea'],     ['RP',  'Philippines'],
          ['S2',  'Bangladesh'],     ['S5',  'Slovenia'],        ['S7',  'Seychelles'],
          ['S9',  'São Tomé and Príncipe'],
          ['SE',  'Sweden'],         ['SN',  'Poland'],          ['SO',  'Senegal'],
          ['SP',  'Poland'],         ['ST',  'Sudan'],           ['SU',  'Egypt'],
          ['SX',  'Greece'],
          ['T2',  'Tuvalu'],         ['T3',  'Kiribati'],        ['T7',  'San Marino'],
          ['T9',  'Bosnia'],         ['TC',  'Turkey'],          ['TF',  'Iceland'],
          ['TG',  'Guatemala'],      ['TI',  'Costa Rica'],      ['TJ',  'Cameroon'],
          ['TL',  'Central African Republic'], ['TN', 'Republic of Congo'],
          ['TR',  'Gabon'],          ['TS',  'Tunisia'],         ['TT',  'Trinidad and Tobago'],
          ['TU',  'Ivory Coast'],    ['TY',  'Benin'],           ['TZ',  'Mali'],
          ['UK',  'Uzbekistan'],     ['UN',  'Kazakhstan'],      ['UR',  'Ukraine'],
          ['V2',  'Antigua and Barbuda'], ['V3', 'Belize'],      ['V4',  'Saint Kitts and Nevis'],
          ['V5',  'Namibia'],        ['V6',  'Micronesia'],      ['V7',  'Marshall Islands'],
          ['V8',  'Brunei'],         ['VH',  'Australia'],       ['VN',  'Vietnam'],
          ['VP',  'British Territories'], ['VQ', 'British Territories'],
          ['VT',  'India'],
          ['XA',  'Mexico'],         ['XB',  'Mexico'],          ['XC',  'Mexico'],
          ['XT',  'Burkina Faso'],   ['XU',  'Cambodia'],        ['XV',  'Vietnam'],
          ['XY',  'Myanmar'],        ['XZ',  'Myanmar'],
          ['YA',  'Afghanistan'],    ['YI',  'Iraq'],            ['YJ',  'Vanuatu'],
          ['YK',  'Syria'],          ['YL',  'Latvia'],          ['YM',  'Turkey'],
          ['YN',  'Nicaragua'],      ['YO',  'Romania'],         ['YR',  'Romania'],
          ['YS',  'El Salvador'],    ['YU',  'Serbia'],          ['YV',  'Venezuela'],
          ['Z',   'Zimbabwe'],
          ['ZA',  'Albania'],        ['ZK',  'New Zealand'],     ['ZL',  'New Zealand'],
          ['ZM',  'New Zealand'],    ['ZP',  'Paraguay'],        ['ZS',  'South Africa'],
          ['ZU',  'South Africa'],   ['ZW',  'Zimbabwe'],
        ];
        for (const [prefix, nation] of PREFIX_MAP) {
          if (reg.startsWith(prefix)) return nation;
        }
        return '';
      })();
      const typeName = (() => {
        if (m.type === 'ZZZZ' && m.aircraftTypeText) return m.aircraftTypeText;
        const td = lookupAircraftType(m.type || '');
        return td ? ((td['Common Name'] || td['Model'] || '')).trim() : '';
      })();
      const wtcCat = (() => {
        const raw = (m.wtc || '').toUpperCase().match(/^([A-Z]+)/);
        return raw ? raw[1] : '';
      })();
      const depAdName = m.depAd === 'ZZZZ' && m.depAdText ? `${m.depAdText} (ZZZZ)` : getLocationName(m.depAd || '');
      const arrAdName = m.arrAd === 'ZZZZ' && m.arrAdText ? `${m.arrAdText} (ZZZZ)` : getLocationName(m.arrAd || '');
      return {
        callsignCode: (unitInfo || 'Callsign'),
        callsignVoice: 'Voice callsign',
        registration:  (regNationality || 'Registration'),
        type:          (typeName || 'Aircraft type'),
        wtc:           (wtcCat && WTC_FULL[wtcCat] ? `WTC ${wtcCat} – ${WTC_FULL[wtcCat]}` : 'Wake Turbulence Category'),
        depAd:         (depAdName || 'Departure aerodrome'),
        arrAd:         (arrAdName || 'Arrival aerodrome'),
        rules:         (RULES_FULL[m.rules] || 'Flight rules'),
        tngCount:      'T&G – Touch and Go count',
        osCount:       'O/S – Overshoot count',
        fisCount:      'FIS – Flight Information Service count',
        remarks:       'REMARKS',
        depActual:     'ATD – Actual Time of Departure',
        depPlanned:    'ETD – Estimated Time of Departure',
        arrActual:     'ATA – Actual Time of Arrival',
        arrPlanned:    'ETA – Estimated Time of Arrival',
        eoft:          'EOFT – Estimated On-Frequency Time',
        aoft:          'AOFT – Actual On-Frequency Time',
        elft:          'ELFT – Estimated Last Frequency Time',
        alft:          'ALFT – Actual Last Frequency Time',
      };
    })();

    // Bind inline edit handlers (double-click to edit)
    enableInlineEdit(tr.querySelector(".js-edit-callsign"), m.id, "callsignCode", "text", null, _tt.callsignCode);
    enableInlineEdit(tr.querySelector(".js-edit-voice"),    m.id, "callsignVoice", "text", null, _tt.callsignVoice);
    enableInlineEdit(tr.querySelector(".js-edit-reg"),      m.id, "registration",  "text", null, _tt.registration);
    enableInlineEdit(tr.querySelector(".js-edit-type"),     m.id, "type",          "text", null, _tt.type);
    enableInlineEdit(tr.querySelector(".js-edit-wtc"),      m.id, "wtc",           "text", null, _tt.wtc);
    // depAd editable only for OVR and ARR (not DEP or LOC)
    if (ft === "OVR" || ft === "ARR") {
      enableInlineEdit(tr.querySelector(".js-edit-dep-ad"), m.id, "depAd", "text", null, _tt.depAd);
    }
    // arrAd editable only for OVR and DEP (not ARR or LOC)
    if (ft === "OVR" || ft === "DEP") {
      enableInlineEdit(tr.querySelector(".js-edit-arr-ad"), m.id, "arrAd", "text", null, _tt.arrAd);
    }
    enableInlineEdit(tr.querySelector(".js-edit-rules"),   m.id, "rules",    "text",   null, _tt.rules);
    enableInlineEdit(tr.querySelector(".js-edit-tng"),     m.id, "tngCount", "number", null, _tt.tngCount);
    enableInlineEdit(tr.querySelector(".js-edit-os"),      m.id, "osCount",  "number", null, _tt.osCount);
    enableInlineEdit(tr.querySelector(".js-edit-fis"),     m.id, "fisCount", "number", null, _tt.fisCount);
    enableInlineEdit(tr.querySelector(".js-edit-remarks"), m.id, "remarks",  "text",   null, _tt.remarks);

    // Time field binding: mode-driven — field determined by the per-strip per-side
    // mode toggle, not inferred from actual-field presence.
    const depTimeEl = tr.querySelector(".js-edit-dep-time");
    const arrTimeEl = tr.querySelector(".js-edit-arr-time");

    if (ft === "DEP" || ft === "LOC") {
      const depField = _inlineTimeFieldForMode(ft, 'dep', _getInlineTimeMode(m.id, 'dep'));
      enableInlineEdit(depTimeEl, m.id, depField, "time", null, _tt[depField]);
    }
    if (ft === "ARR") {
      // ARR dep-time cell: always editable for depActual (ATD from origin — no estimate/actual pair).
      enableInlineEdit(depTimeEl, m.id, "depActual", "time", null, _tt.depActual);
    }
    if (ft === "ARR" || ft === "LOC" || ft === "DEP") {
      const arrField = _inlineTimeFieldForMode(ft, 'arr', _getInlineTimeMode(m.id, 'arr'));
      enableInlineEdit(arrTimeEl, m.id, arrField, "time", null, _tt[arrField]);
    }
    if (ft === "OVR") {
      const ovrDepMode = _getInlineTimeMode(m.id, 'dep');
      const ovrDepField = _inlineTimeFieldForMode('OVR', 'dep', ovrDepMode);
      enableInlineEdit(depTimeEl, m.id, ovrDepField, "time", null, _tt[ovrDepMode === 'actual' ? 'aoft' : 'eoft']);
      const ovrArrMode = _getInlineTimeMode(m.id, 'arr');
      const ovrArrField = _inlineTimeFieldForMode('OVR', 'arr', ovrArrMode);
      enableInlineEdit(arrTimeEl, m.id, ovrArrField, "time", null, _tt[ovrArrMode === 'actual' ? 'alft' : 'elft']);
    }

    // Time label toggle: clicking the label (ETD/ATD/ETA/ATA/EOFT/AOFT/ELFT/ALFT)
    // switches estimate vs actual mode for that side.
    tr.querySelectorAll('.js-time-label-toggle').forEach(labelEl => {
      labelEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const sid = labelEl.dataset.id;
        const side = labelEl.dataset.side;
        const currentMode = _getInlineTimeMode(sid, side);
        _setInlineTimeModeExplicit(sid, side, currentMode === 'estimate' ? 'actual' : 'estimate');
        renderLiveBoard();
      });
    });

    // Hover sync with timeline bar
    tr.addEventListener('mouseenter', () => {
      const timelineBar = document.querySelector(`.timeline-movement-bar[data-movement-id="${m.id}"]`);
      if (timelineBar) timelineBar.classList.add('highlight');
    });
    tr.addEventListener('mouseleave', () => {
      const timelineBar = document.querySelector(`.timeline-movement-bar[data-movement-id="${m.id}"]`);
      if (timelineBar) timelineBar.classList.remove('highlight');
    });

    tbody.appendChild(tr);

    if (expandedId === m.id) {
      renderExpandedRow(tbody, m);
    }
  }

  if (!movements.length) {
    const empty = document.createElement("tr");
    empty.innerHTML = `
      <td colspan="12" style="padding:8px; font-size:12px; color:#777;">
        No demo movements match the current filters.
      </td>
    `;
    tbody.appendChild(empty);
  }

  // Update timeline when movements change
  renderTimeline();
}

/* -----------------------------
   Modal helpers
------------------------------ */

/**
 * Get today's date in YYYY-MM-DD format
 * @returns {string} Date string
 */
function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Close the currently active modal and remove its document keydown handler.
 * All save-handler paths that close the modal by clearing modalRoot must call
 * this instead of setting modalRoot.innerHTML = "" directly, so the keyHandler
 * is always removed and never leaks onto the document.
 *
 * Exported so that ui_booking.js (and any future modal owner) can call the same
 * cleanup path regardless of which module opened the modal.
 */
export function closeActiveModal() {
  if (_modalKeyHandler) {
    document.removeEventListener("keydown", _modalKeyHandler);
    _modalKeyHandler = null;
    if (window.__FDMS_DIAGNOSTICS__ && window.__fdmsDiag) {
      window.__fdmsDiag.modalKeyHandlerLeaksFixed = (window.__fdmsDiag.modalKeyHandlerLeaksFixed || 0) + 1;
    }
  }
  _modalOpen = false;
  const root = byId("modalRoot");
  if (root) root.innerHTML = "";
  _checkModalInvariant("closeActiveModal");
}

function openModal(contentHtml) {
  // Remove any previous keyHandler before opening a new modal.
  // This guards against the case where a prior modal was closed without going
  // through closeModal() (e.g. by a save handler that used modalRoot.innerHTML
  // directly before this fix was applied).
  if (_modalKeyHandler) {
    document.removeEventListener("keydown", _modalKeyHandler);
    _modalKeyHandler = null;
    if (window.__FDMS_DIAGNOSTICS__ && window.__fdmsDiag) {
      window.__fdmsDiag.modalKeyHandlerLeaksPrevented = (window.__fdmsDiag.modalKeyHandlerLeaksPrevented || 0) + 1;
    }
  }

  const root = byId("modalRoot");
  if (!root) return;

  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        ${contentHtml}
      </div>
      <div class="modal-minimized-bar">
        <button class="js-restore-modal" type="button">
          <span class="modal-minimized-title"></span>
          <span class="modal-minimized-icon">▲</span>
        </button>
      </div>
    </div>
  `;

  const backdrop = root.querySelector(".modal-backdrop");
  const modal = root.querySelector(".modal");
  const minimizedBar = root.querySelector(".modal-minimized-bar");
  const minimizedTitle = root.querySelector(".modal-minimized-title");

  // Set minimized bar title from modal header
  const modalTitleEl = modal.querySelector(".modal-title");
  if (modalTitleEl && minimizedTitle) {
    minimizedTitle.textContent = modalTitleEl.textContent;
  }

  // Initialize autocomplete for modal inputs
  initModalAutocomplete(modal);

  const closeModal = () => {
    root.innerHTML = "";
    document.removeEventListener("keydown", _modalKeyHandler);
    _modalKeyHandler = null;
    _modalOpen = false;
    _checkModalInvariant("closeModal");
  };

  const keyHandler = (e) => {
    if (e.key === "Escape") {
      closeModal();
    } else if (e.key === "Enter" && !e.shiftKey) {
      // Enter-to-save: trigger the primary save button.
      // Skip if focused on a textarea (to allow multi-line input) or an inline-
      // edit input (those handle Enter themselves and stop propagation).
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === "TEXTAREA" || activeEl.classList.contains("inline-edit-input"))) {
        return;
      }

      // Only act if the save button is in a CONNECTED (live) modal, not in a
      // detached/stale backdrop captured in a leaked closure.
      if (!backdrop || !backdrop.isConnected) return;

      // Find the primary save button
      const saveBtn = backdrop?.querySelector(".js-save-flight, .js-save-loc, .js-save-edit, .js-save-dup");
      if (saveBtn) {
        e.preventDefault();
        saveBtn.click();
      }
    }
  };

  // Register and track the handler so it can always be cleaned up.
  _modalKeyHandler = keyHandler;
  _modalOpen = true;

  const minimizeModal = () => {
    backdrop.classList.add("minimized");
  };

  const restoreModal = () => {
    backdrop.classList.remove("minimized");
  };

  backdrop
    ?.querySelectorAll(".js-close-modal")
    .forEach((btn) => safeOn(btn, "click", closeModal));

  backdrop
    ?.querySelectorAll(".js-minimize-modal")
    .forEach((btn) => safeOn(btn, "click", minimizeModal));

  backdrop
    ?.querySelectorAll(".js-restore-modal")
    .forEach((btn) => safeOn(btn, "click", restoreModal));

  // Real save handler is bound after modal opens via specific save functions

  document.addEventListener("keydown", keyHandler);
  _checkModalInvariant("openModal");
}

/**
 * Enrich movement data with auto-populated fields
 * @param {Object} movement - Movement object to enrich
 * @returns {Object} Enriched movement object
 */
function enrichMovementData(movement) {
  const callsignCode = movement.callsignCode || '';
  const aircraftType = movement.type || '';

  // Auto-populate captain from EGOW codes
  if (!movement.captain || movement.captain === '') {
    const captain = lookupCaptainFromEgowCodes(callsignCode);
    if (captain) {
      movement.captain = captain;
    }
  }

  // Auto-populate POB = 2 for UAM callsigns
  if (callsignCode.toUpperCase().startsWith('UAM') && (movement.pob === undefined || movement.pob === null || movement.pob === 0)) {
    movement.pob = 2;
  }

  // Auto-populate unit code from EGOW codes
  if (!movement.unitCode || movement.unitCode === '') {
    const unitCode = lookupUnitCodeFromEgowCodes(callsignCode);
    if (unitCode) {
      movement.unitCode = unitCode;
    }
  }

  // Auto-populate unit description from callsign databases
  if (!movement.unitDesc || movement.unitDesc === '') {
    const unitDesc = lookupUnitFromCallsign(callsignCode, aircraftType);
    if (unitDesc && unitDesc !== '-') {
      movement.unitDesc = unitDesc;
    }
  }

  // Auto-populate operator from callsign databases (only if not already set from registration)
  if (!movement.operator || movement.operator === '' || movement.operator === '-') {
    const operator = lookupOperatorFromCallsign(callsignCode, aircraftType);
    if (operator && operator !== '-') {
      movement.operator = operator;
    }
  }

  return movement;
}

/**
 * Returns true if the UTC/Local time-mode toggle should be shown in new-strip forms.
 * Controlled by Admin tri-state policy config.newFormUtcLocalTogglePolicy:
 *   "show"  — always visible
 *   "hide"  — never visible
 *   "auto"  — visible only when timezoneOffsetHours !== 0 (i.e. local ≠ UTC)
 */
function shouldShowNewFormTimeModeToggle() {
  const cfg = getConfig();
  const policy = cfg.newFormUtcLocalTogglePolicy || "auto";
  if (policy === "show") return true;
  if (policy === "hide") return false;
  return (cfg.timezoneOffsetHours || 0) !== 0;
}

function openNewFlightModal(flightType = "DEP", prefill = null) {
  openModal(`
    <div class="modal-header">
      <div>
        <div class="modal-title">New ${flightType} Flight</div>
        <div class="modal-subtitle">Create a new movement</div>
      </div>
      <div class="modal-header-buttons">
        <button class="btn btn-ghost js-minimize-modal" type="button" title="Minimize">−</button>
        <button class="btn btn-ghost js-close-modal" type="button" title="Close">✕</button>
      </div>
    </div>
    <div class="modal-body modal-sectioned">
      <!-- Identity Section -->
      <section class="modal-section">
        <h3 class="modal-section-title">Identity</h3>
        <div class="modal-grid-identity">
          <div class="modal-field">
            <label class="modal-label">Callsign Code</label>
            <input id="newCallsignCode" class="modal-input" placeholder="SYS, GBNKV" />
          </div>
          <div class="modal-field">
            <label class="modal-label">Flight Number</label>
            <input id="newFlightNumber" class="modal-input" placeholder="106, 67VM" />
          </div>
          <div class="modal-field">
            <label class="modal-label">Registration</label>
            <input id="newReg" class="modal-input" placeholder="ZM520, G-BNKV" />
          </div>
          <div class="modal-field">
            <label class="modal-label">Aircraft Type</label>
            <input id="newType" class="modal-input is-derived" placeholder="EC35, C152" />
            <input id="newAircraftTypeText" class="modal-input zzzz-companion" placeholder="Aircraft description (required for ZZZZ)" style="display:none; margin-top:4px;" />
          </div>
          <div class="modal-field">
            <label class="modal-label">WTC</label>
            <select id="newWtc" class="modal-input"></select>
          </div>
          <div class="modal-field">
            <label class="modal-label">PIC</label>
            <input id="newCaptain" class="modal-input" placeholder="Pilot in Command" />
          </div>
          <div class="modal-field">
            <label class="modal-label">Priority</label>
            <select id="priorityLetter" class="modal-select">
              <option value="">-</option>
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
              <option value="D">D</option>
              <option value="E">E</option>
              <option value="Z">Z</option>
            </select>
          </div>
        </div>
      </section>

      <!-- Plan Section -->
      <section class="modal-section">
        <h3 class="modal-section-title">Plan</h3>
        <div class="modal-section-grid-3">
          <div class="modal-field">
            <label class="modal-label">Flight Type</label>
            <select id="newFlightType" class="modal-select">
              <option ${flightType === "ARR" ? "selected" : ""}>ARR</option>
              <option ${flightType === "DEP" ? "selected" : ""}>DEP</option>
              <option ${flightType === "LOC" ? "selected" : ""}>LOC</option>
              <option ${flightType === "OVR" ? "selected" : ""}>OVR</option>
            </select>
          </div>
          <div class="modal-field">
            <label class="modal-label">Flight Rules</label>
            <select id="newRules" class="modal-select">
              <option value="VFR" selected>VFR</option>
              <option value="IFR">IFR</option>
              <option value="Y">Y (IFR to VFR)</option>
              <option value="Z">Z (VFR to IFR)</option>
              <option value="SVFR">SVFR</option>
            </select>
          </div>
          <div class="modal-field">
            <label class="modal-label">POB</label>
            <input id="newPob" class="modal-input" type="number" value="0" min="0" />
          </div>
        </div>
        <div class="modal-section-grid modal-subgrid-gap">
          <div class="modal-field">
            <label class="modal-label">Departure AD</label>
            <input id="newDepAd" class="modal-input" placeholder="EGOS" value="${flightType === "DEP" || flightType === "LOC" ? "EGOW" : ""}" />
            <input id="newDepAdText" class="modal-input zzzz-companion" placeholder="Location name (required for ZZZZ)" style="display:none; margin-top:4px;" />
          </div>
          <div class="modal-field">
            <label class="modal-label">Arrival AD</label>
            <input id="newArrAd" class="modal-input" placeholder="EGOS" value="${flightType === "ARR" || flightType === "LOC" ? "EGOW" : ""}" />
            <input id="newArrAdText" class="modal-input zzzz-companion" placeholder="Location name (required for ZZZZ)" style="display:none; margin-top:4px;" />
          </div>
        </div>
      </section>

      <!-- Times Section -->
      <section class="modal-section">
        <h3 class="modal-section-title">Times</h3>
        <!-- Row 0: DOF + mode controls -->
        <div class="modal-section-grid">
          <div class="modal-field">
            <label class="modal-label">Date of Flight</label>
            <input id="newDOF" type="date" class="modal-input" value="${getTodayDateString()}" />
          </div>
          <div class="modal-field">
            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-start;">
              ${shouldShowNewFormTimeModeToggle() ? `<div>
                <label class="modal-label">Times shown in:</label>
                <button type="button" id="newFlightTimeModeToggle" class="btn btn-ghost" style="padding: 2px 10px; font-size: 12px; margin-top: 2px;">UTC</button>
              </div>` : ''}
              <div>
                <label class="modal-label">Mode:</label>
                <button type="button" id="newFlightTimingToggle" class="btn btn-ghost" data-timing-mode="planned" style="padding: 2px 10px; font-size: 12px; margin-top: 2px;">Planned</button>
              </div>
            </div>
          </div>
        </div>
        <!-- Rows 1–2: ETD|Duration|ETA / ATD|spacer|ATA
             Explicit grid-column/row keeps Duration stable when planned/actual toggle fires. -->
        <div class="modal-section-grid-3 modal-subgrid-gap">
          <div class="modal-field" data-timing-group="planned" style="grid-column:1;grid-row:1">
            <label class="modal-label">${flightType === "OVR" ? "EOFT" : "ETD"}</label>
            <input id="newDepPlanned" class="modal-input" placeholder="HH:MM" style="width: 80px;" value="" />
          </div>
          <div class="modal-field" style="grid-column:2;grid-row:1">
            <label class="modal-label">Duration</label>
            <input id="newDuration" class="modal-input" type="number" min="1" max="720" placeholder="default" style="width: 80px;" />
            <span style="font-size: 11px; color: #888; display: block; margin-top: 2px;">min (timeline only)</span>
          </div>
          <div class="modal-field" data-timing-group="planned" style="grid-column:3;grid-row:1">
            <label class="modal-label">${flightType === "OVR" ? "ELFT" : "ETA"}</label>
            <input id="newArrPlanned" class="modal-input" placeholder="HH:MM" style="width: 80px;" value="" />
          </div>
          <div class="modal-field" data-timing-group="actual" style="display:none;grid-column:1;grid-row:1">
            <label class="modal-label">${flightType === "OVR" ? "AOFT" : "ATD"}</label>
            <input id="newDepActual" class="modal-input" placeholder="HH:MM" style="width: 80px;" value="" />
          </div>
          <div class="modal-field" data-timing-group="actual" style="display:none;grid-column:3;grid-row:1">
            <label class="modal-label">${flightType === "OVR" ? "ALFT" : "ATA"}</label>
            <input id="newArrActual" class="modal-input" placeholder="HH:MM" style="width: 80px;" value="" />
          </div>
        </div>
      </section>

      <!-- Operational Section -->
      <section class="modal-section">
        <h3 class="modal-section-title">Operational</h3>
        <div class="modal-section-grid-3">
          <div class="modal-field">
            <label class="modal-label">T&amp;G</label>
            <input id="newTng" class="modal-input" type="number" value="0" min="0" />
          </div>
          <div class="modal-field">
            <label class="modal-label">O/S</label>
            <input id="newOsCount" class="modal-input" type="number" value="0" min="0" />
          </div>
          <div class="modal-field">
            <label class="modal-label">FIS</label>
            <input id="newFisCount" class="modal-input" type="number" value="${flightType === "OVR" ? "1" : "0"}" min="0" />
          </div>
        </div>
        <div class="modal-section-grid modal-subgrid-gap">
          <div class="modal-field">
            <label class="modal-label">EGOW Code <span style="color: #d32f2f;">*</span></label>
            <input id="newEgowCode" class="modal-input is-derived" placeholder="" list="egowCodeOptions" />
            <datalist id="egowCodeOptions">
              <option value="VC">VC</option>
              <option value="VM">VM</option>
              <option value="BC">BC</option>
              <option value="BM">BM</option>
              <option value="VCH">VCH</option>
              <option value="VMH">VMH</option>
              <option value="VNH">VNH</option>
            </datalist>
          </div>
          <div class="modal-field">
            <label class="modal-label">EGOW Unit</label>
            <input id="newUnitCode" class="modal-input is-derived" placeholder="" />
          </div>
        </div>
      </section>

      <!-- Collapsible: Remarks & Warnings -->
      <section class="modal-section modal-collapsible">
        <button type="button" class="modal-expander" aria-expanded="false" data-target="remarksWarnings">
          <span class="expander-icon">▶</span>
          Remarks &amp; Warnings
          <span class="expander-hint">(optional)</span>
        </button>
        <div id="remarksWarnings" class="modal-expander-panel" hidden>
          <div class="modal-section-grid">
            <div class="modal-field modal-field-full">
              <label class="modal-label">Remarks</label>
              <textarea id="rwRemarks" class="modal-textarea" rows="3" placeholder=""></textarea>
            </div>
            <div class="modal-field modal-field-full">
              <label class="modal-label">Warnings</label>
              <textarea id="rwWarnings" class="modal-textarea" rows="3" placeholder=""></textarea>
            </div>
          </div>
        </div>
      </section>

      <!-- Collapsible: ATC Details -->
      <section class="modal-section modal-collapsible">
        <button type="button" class="modal-expander" aria-expanded="false" data-target="atcDetails">
          <span class="expander-icon">▶</span>
          ATC Details
          <span class="expander-hint">(optional)</span>
        </button>
        <div id="atcDetails" class="modal-expander-panel" hidden>
          <div class="modal-section-grid">
            <div class="modal-field">
              <label class="modal-label">Squawk</label>
              <input id="atcSquawk" class="modal-input" placeholder="e.g. 7375" maxlength="4" />
            </div>
            <div class="modal-field">
              <label class="modal-label">Route</label>
              <input id="atcRoute" class="modal-input" placeholder="WAL GODPA MIDJO SWB" />
            </div>
            <div class="modal-field modal-field-full">
              <label class="modal-label">Clearance</label>
              <textarea id="atcClearance" class="modal-textarea" rows="2" placeholder="DCT WAL ↑ A020 128.050"></textarea>
            </div>
          </div>
        </div>
      </section>

      <!-- Collapsible: Formation -->
      <section class="modal-section modal-collapsible">
        <button type="button" class="modal-expander" aria-expanded="false" data-target="newFormationSection">
          <span class="expander-icon">▶</span>
          Formation
          <span class="expander-hint">(optional – multi-aircraft)</span>
        </button>
        <div id="newFormationSection" class="modal-expander-panel" hidden>
          <div class="modal-section-grid">
            <div class="modal-field">
              <label class="modal-label">Number of Aircraft</label>
              <input id="newFormationCount" class="modal-input" type="number" value="2" min="2" max="12" style="width:80px;" />
              <div style="font-size:11px;color:#666;margin-top:4px;">2–12 aircraft. Callsigns default to auto-generated but are editable.</div>
            </div>
          </div>
          <div id="newFormationElementsContainer"></div>
        </div>
      </section>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost js-close-modal" type="button">Cancel</button>
      <div style="display: flex; gap: 8px;">
        <button class="btn btn-secondary-modal js-save-complete-flight" type="button" style="display: none;">Save &amp; Complete</button>
        <button class="btn btn-primary js-save-flight" type="button">Save</button>
      </div>
    </div>
  `);

  // Bind registration and callsign field interactions with VKB
  const callsignCodeInput = document.getElementById("newCallsignCode");
  const flightNumberInput = document.getElementById("newFlightNumber");
  const regInput = document.getElementById("newReg");
  const typeInput = document.getElementById("newType");
  const pobInput = document.getElementById("newPob");
  const egowCodeInput = document.getElementById("newEgowCode");
  const unitCodeInput = document.getElementById("newUnitCode");
  const depAdInput = document.getElementById("newDepAd");
  const arrAdInput = document.getElementById("newArrAd");

  // Apply automatic uppercase conversion to aviation-related fields
  makeInputUppercase(callsignCodeInput);
  makeInputUppercase(flightNumberInput);
  makeInputUppercase(regInput);
  makeInputUppercase(typeInput);
  makeInputUppercase(egowCodeInput);
  makeInputUppercase(unitCodeInput);
  makeInputUppercase(depAdInput);
  makeInputUppercase(arrAdInput);

  // ZZZZ companion field visibility
  bindZzzzCompanion(depAdInput, document.getElementById("newDepAdText"));
  bindZzzzCompanion(arrAdInput, document.getElementById("newArrAdText"));
  bindZzzzCompanion(typeInput, document.getElementById("newAircraftTypeText"));

  // EU civil registration normalisation — insert hyphen on blur (hard) and
  // after 250 ms of typing (soft, only if it would add a hyphen).
  if (regInput) {
    regInput.addEventListener("blur", () => {
      regInput.value = normalizeEuCivilRegistration(regInput.value);
    });
    let _regNormDebounce = null;
    regInput.addEventListener("input", () => {
      if (_regNormDebounce) clearTimeout(_regNormDebounce);
      _regNormDebounce = setTimeout(() => {
        const before = regInput.value;
        const after  = normalizeEuCivilRegistration(before);
        // Only apply when the normaliser adds a hyphen (minimises cursor jump)
        if (after !== before && !before.includes("-") && after.includes("-")) {
          regInput.value = after;
        }
      }, 250);
    });
  }

  // When registration is entered, auto-fill type, fixed callsign/flight number, and EGOW code
  if (regInput && typeInput) {
    const applyNewRegAutofill = () => {
      const regData = lookupRegistration(regInput.value);
      if (regData) {
        // Auto-fill aircraft type from VKB
        const vkbType = regData['TYPE'];
        if (vkbType && vkbType !== '-' && vkbType !== '') {
          typeInput.value = vkbType;
          // Programmatic type set does not fire input; trigger WTC autofill manually
          maybeAutofillWtc();
        }

        // Auto-fill EGOW Code from registration
        const egowFlightType = regData['EGOW FLIGHT TYPE'];
        if (egowFlightType && egowFlightType !== '-' && egowFlightType !== '' && egowCodeInput) {
          egowCodeInput.value = egowFlightType;
        }

        // Auto-fill fixed callsign and flight number if available
        const fixedCallsign = regData['FIXED C/S'];
        if (fixedCallsign && fixedCallsign !== '-' && fixedCallsign !== '') {
          // Try to split into callsign code and flight number
          // e.g., "UAM01" → "UAM" + "01"
          const match = fixedCallsign.match(/^([A-Z]+)(\d+.*)?$/);
          if (match && callsignCodeInput && (!callsignCodeInput.value || callsignCodeInput.value === '')) {
            callsignCodeInput.value = match[1]; // Code part
            if (match[2] && flightNumberInput && (!flightNumberInput.value || flightNumberInput.value === '')) {
              flightNumberInput.value = match[2]; // Number part
            }
          }
        }
      } else {
        // Fallback to hardcoded lookup if not in VKB
        const inferredType = inferTypeFromReg(regInput.value);
        if (inferredType) {
          typeInput.value = inferredType;
        }
      }
    };
    regInput.addEventListener("input", applyNewRegAutofill);
    regInput.addEventListener("change", applyNewRegAutofill);
    regInput.addEventListener("blur", applyNewRegAutofill);
  }

  // When callsign code or flight number changes, check for UAM pattern, lookup unit code, and auto-fill registration if fixed callsign
  const updateCallsignDerivedFields = () => {
    const code = callsignCodeInput?.value?.toUpperCase().trim() || '';
    const number = flightNumberInput?.value?.trim() || '';
    const fullCallsign = code + number;

    // UAM* pattern → POB = 2
    if (code.startsWith('UAM') && pobInput && (pobInput.value === '0' || !pobInput.value)) {
      pobInput.value = '2';
    }

    // Lookup unit code from full callsign
    if (fullCallsign && unitCodeInput) {
      const unitData = lookupCallsign(fullCallsign);
      if (unitData && unitData['UC'] && unitData['UC'] !== '-' && unitData['UC'] !== '') {
        unitCodeInput.value = unitData['UC'];
      }
    }

    // If callsign matches a fixed callsign, auto-fill registration (only if registration is empty)
    if (fullCallsign && regInput && (!regInput.value || regInput.value === '')) {
      const regData = lookupRegistrationByFixedCallsign(fullCallsign);
      if (regData) {
        const registration = regData['REGISTRATION'] || '';
        if (registration && registration !== '-') {
          regInput.value = normalizeEuCivilRegistration(registration);
          // Trigger registration input event to update dependent fields
          regInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    }
  };

  if (callsignCodeInput) {
    callsignCodeInput.addEventListener("input", updateCallsignDerivedFields);
  }
  if (flightNumberInput) {
    flightNumberInput.addEventListener("input", updateCallsignDerivedFields);
  }

  // Wire collapsible sections
  document.querySelectorAll('.modal-expander').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const panel = document.getElementById(targetId);
      const isExpanded = btn.getAttribute('aria-expanded') === 'true';

      btn.setAttribute('aria-expanded', !isExpanded);
      panel.hidden = isExpanded;
      btn.querySelector('.expander-icon').textContent = isExpanded ? '▶' : '▼';
    });
  });

  // WTC select: constrained to wtcSystem, with autofill + manual-override support
  const wtcSelect = document.getElementById('newWtc');
  let wtcDirty = false;

  function wtcSystemKey() {
    return String((getConfig().wtcSystem || 'ICAO')).toUpperCase();
  }

  function wtcOpts() {
    const key = wtcSystemKey();
    return (_WTC_OPTIONS && _WTC_OPTIONS[key]) ? _WTC_OPTIONS[key] : ['L','S','M','H','J'];
  }

  function setWtcOptions() {
    if (!wtcSelect) return;
    const opts = wtcOpts();
    wtcSelect.innerHTML =
      `<option value=""></option>` +
      opts.map(o => `<option value="${o}">${o}</option>`).join('');
  }

  function extractLeadingToken(s) {
    const m = String(s || '').trim().toUpperCase().match(/^[A-Z]+/);
    return m ? m[0] : '';
  }

  function computeWtcFromCurrentForm() {
    const type = document.getElementById('newType')?.value || '';
    const ft   = document.getElementById('newFlightType')?.value || flightType;
    if (!type) return '';
    const sys = (getConfig().wtcSystem || 'ICAO');
    const w = getWTC(type, ft, sys) || '';
    return extractLeadingToken(w);
  }

  function maybeAutofillWtc() {
    if (!wtcSelect) return;
    if (wtcDirty && wtcSelect.value) return; // user manual override wins
    const raw = computeWtcFromCurrentForm();
    const allowed = new Set(wtcOpts());
    wtcSelect.value = allowed.has(raw) ? raw : '';
  }

  setWtcOptions();
  maybeAutofillWtc();

  wtcSelect?.addEventListener('change', () => { wtcDirty = true; });
  document.getElementById('newType')?.addEventListener('input', maybeAutofillWtc);
  document.getElementById('newFlightType')?.addEventListener('change', maybeAutofillWtc);

  // Wire formation count input — rebuild element rows when count or base callsign changes
  const getNewFlightCallsign = () =>
    (document.getElementById("newCallsignCode")?.value?.trim() || "") +
    (document.getElementById("newFlightNumber")?.value?.trim() || "");
  wireFormationCountInput("newFormationCount", "newFormationElementsContainer", getNewFlightCallsign, []);
  // Also rebuild rows when callsign code changes (element labels update)
  // Only rebuild if rows have already been rendered (formation section was explicitly used)
  callsignCodeInput?.addEventListener("input", () => {
    const container = document.getElementById("newFormationElementsContainer");
    if (!container?.querySelector('[data-el-callsign="0"]')) return;
    const count = parseInt(document.getElementById("newFormationCount")?.value || "2", 10);
    if (count >= 2) buildFormationElementRows(count, getNewFlightCallsign(), "newFormationElementsContainer", []);
  });

  // Auto-fill Remarks and Warnings from registration data (FDMS_REGISTRATIONS.csv col 15 & 16)
  const remarksInput = document.getElementById('rwRemarks');
  const warningsInput = document.getElementById('rwWarnings');

  if (regInput && remarksInput && warningsInput) {
    regInput.addEventListener("input", () => {
      const regData = lookupRegistration(regInput.value);
      if (regData) {
        // Auto-fill Warnings (column 15)
        const warningsText = regData['WARNINGS'] || '';
        if (warningsText && warningsText !== '-') {
          // Only auto-fill if field is empty OR still shows previous autofill
          const currentWarnings = warningsInput.value.trim();
          const lastAutofill = warningsInput.dataset.autofillValue || '';
          if (!currentWarnings || currentWarnings === lastAutofill) {
            warningsInput.value = warningsText;
            warningsInput.dataset.autofillValue = warningsText;
          }
        }

        // Auto-fill Remarks/Notes (column 16)
        const notesText = regData['NOTES'] || '';
        if (notesText && notesText !== '-') {
          // Only auto-fill if field is empty OR still shows previous autofill
          const currentRemarks = remarksInput.value.trim();
          const lastAutofill = remarksInput.dataset.autofillValue || '';
          if (!currentRemarks || currentRemarks === lastAutofill) {
            remarksInput.value = notesText;
            remarksInput.dataset.autofillValue = notesText;
          }
        }
      }
    });
  }

  // Bind UTC/Local time mode toggle (persistent, single toggle)
  bindTimeModeToggle("newFlightTimeModeToggle",
    ["newDepPlanned", "newArrPlanned", "newDepActual", "newArrActual"]);

  // Bind Planned/Active timing mode toggle (gates field visibility and Save & Complete)
  bindNewFormTimingToggle("newFlightTimingToggle", ".js-save-complete-flight");

  // Bind bidirectional Duration ↔ planned-end sync
  // ARR mode: ETA (arrPlanned) is the calculation root; ETD (depPlanned) is derived.
  bindPlannedTimesSync("newDepPlanned", "newArrPlanned", "newDuration",
    { arrMode: flightType === 'ARR' });

  // Pre-populate fields from prefill data (used by reciprocal strip workflow)
  if (prefill) {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el && val != null) el.value = val;
    };
    set('newCallsignCode', prefill.callsignCode || '');
    set('newFlightNumber', prefill.flightNumber  || '');
    set('newReg',          prefill.registration  || '');
    set('newType',         prefill.type          || '');
    set('newDepAd',        prefill.depAd         || '');
    set('newArrAd',        prefill.arrAd         || '');
    set('newDOF',          prefill.dof           || getTodayDateString());
    set('newDepPlanned',   prefill.depPlanned    || '');
    set('newArrPlanned',   prefill.arrPlanned    || '');
    set('newPob',          prefill.pob != null ? String(prefill.pob) : '');
    set('rwRemarks',       prefill.remarks       || '');
    set('newCaptain',      prefill.captain       || '');
    set('newEgowCode',     prefill.egowCode      || '');
    set('newUnitCode',     prefill.unitCode      || '');
    const rulesEl = document.getElementById('newRules');
    if (rulesEl && prefill.rules) rulesEl.value = prefill.rules;
    if (wtcSelect && prefill.wtc) {
      wtcSelect.value = prefill.wtc;
      wtcDirty = true;
    }
  }

  // Bind save handler with validation
  document.querySelector(".js-save-flight")?.addEventListener("click", () => {
    // Get form values
    const dof = document.getElementById("newDOF")?.value || getTodayDateString();
    let depPlanned = document.getElementById("newDepPlanned")?.value || "";
    let arrPlanned = document.getElementById("newArrPlanned")?.value || "";
    let depActual  = document.getElementById("newDepActual")?.value  || "";
    let arrActual  = document.getElementById("newArrActual")?.value  || "";
    const pob = document.getElementById("newPob")?.value || "0";
    const tng = document.getElementById("newTng")?.value || "0";
    const callsignCode = document.getElementById("newCallsignCode")?.value || "";
    const flightNumber = document.getElementById("newFlightNumber")?.value || "";
    const callsign = callsignCode + flightNumber; // Combine for full callsign

    // Determine which field group is active (planned or actual)
    const _timingMode = document.getElementById("newFlightTimingToggle")?.dataset.timingMode || "planned";
    // Zero-out the hidden group so only visible fields are written
    if (_timingMode === "planned") {
      depActual = ""; arrActual = "";
    } else {
      depPlanned = ""; arrPlanned = "";
    }

    // Validate inputs
    const dofValidation = validateDate(dof);
    if (!dofValidation.valid) {
      showToast(dofValidation.error, 'error');
      return;
    }

    if (_timingMode === "planned") {
      // Validate planned time fields only
      const depValidation = validateTime(depPlanned);
      if (!depValidation.valid) {
        showToast(`Departure time: ${depValidation.error}`, 'error');
        return;
      }
      if (depValidation.normalized) {
        depPlanned = depValidation.normalized;
        document.getElementById("newDepPlanned").value = depPlanned;
      }

      const arrValidation = validateTime(arrPlanned);
      if (!arrValidation.valid) {
        showToast(`Arrival time: ${arrValidation.error}`, 'error');
        return;
      }
      if (arrValidation.normalized) {
        arrPlanned = arrValidation.normalized;
        document.getElementById("newArrPlanned").value = arrPlanned;
      }
    } else {
      // Validate actual time fields only
      const depActualValidation = validateTime(depActual);
      if (!depActualValidation.valid) {
        showToast(`Actual departure time: ${depActualValidation.error}`, 'error');
        return;
      }
      if (depActualValidation.normalized) { depActual = depActualValidation.normalized; document.getElementById("newDepActual").value = depActual; }

      const arrActualValidation = validateTime(arrActual);
      if (!arrActualValidation.valid) {
        showToast(`Actual arrival time: ${arrActualValidation.error}`, 'error');
        return;
      }
      if (arrActualValidation.normalized) { arrActual = arrActualValidation.normalized; document.getElementById("newArrActual").value = arrActual; }
    }

    // Convert Local→UTC if currently in LOCAL display mode (only for the active field group)
    const _newSaveMode = (getConfig().timeInputMode || "UTC").toUpperCase();
    if (_newSaveMode === "LOCAL") {
      if (_timingMode === "planned") {
        if (depPlanned) depPlanned = convertLocalToUTC(depPlanned);
        if (arrPlanned) arrPlanned = convertLocalToUTC(arrPlanned);
      } else {
        if (depActual)  depActual  = convertLocalToUTC(depActual);
        if (arrActual)  arrActual  = convertLocalToUTC(arrActual);
      }
    }

    // Check for past times and show warning
    if (depPlanned) {
      const depPastCheck = checkPastTime(depPlanned, dof);
      if (depPastCheck.isPast) {
        showToast(depPastCheck.warning, 'warning');
      }
    }

    if (arrPlanned) {
      const arrPastCheck = checkPastTime(arrPlanned, dof);
      if (arrPastCheck.isPast) {
        showToast(arrPastCheck.warning, 'warning');
      }
    }

    const pobValidation = validateNumberRange(pob, 0, 999, "POB");
    if (!pobValidation.valid) {
      showToast(pobValidation.error, 'error');
      return;
    }

    const tngValidation = validateNumberRange(tng, 0, 99, "T&G count");
    if (!tngValidation.valid) {
      showToast(tngValidation.error, 'error');
      return;
    }

    const callsignValidation = validateRequired(callsignCode, "Callsign Code");
    if (!callsignValidation.valid) {
      showToast(callsignValidation.error, 'error');
      return;
    }

    // Validate EGOW Code (mandatory with 7 valid options)
    const egowCode = document.getElementById("newEgowCode")?.value?.toUpperCase().trim() || "";
    const validEgowCodes = ["VC", "VM", "BC", "BM", "VCH", "VMH", "VNH"];
    if (!egowCode) {
      showToast("EGOW Code is required", 'error');
      return;
    }
    if (!validEgowCodes.includes(egowCode)) {
      showToast(`EGOW Code must be one of: ${validEgowCodes.join(', ')}`, 'error');
      return;
    }
    if (egowCode === 'BM') {
      const unitCodeVal = (document.getElementById("newUnitCode")?.value || "").trim();
      if (!unitCodeVal) {
        showToast("EGOW Unit code is required for BM flights", 'error');
        return;
      }
    }

    // Get operator and popular name from VKB registration data
    const regValue = document.getElementById("newReg")?.value || "";
    const regData = lookupRegistration(regValue);
    const operator = regData ? (regData['OPERATOR'] || "") : "";
    const popularName = regData ? (regData['POPULAR NAME'] || "") : "";

    // Get voice callsign for display (only if different from contraction/registration)
    const voiceCallsign = getVoiceCallsignForDisplay(callsign, regValue);

    // WTC: manual select override wins; fall back to computed value
    const aircraftType = document.getElementById("newType")?.value || "";
    const selectedFlightType = document.getElementById("newFlightType")?.value || flightType;
    const wtcManual = (document.getElementById("newWtc")?.value || "").trim().toUpperCase();
    const wtcComputed = (() => {
      const w = getWTC(aircraftType, selectedFlightType, getConfig().wtcSystem || "ICAO") || "";
      const m2 = w.trim().toUpperCase().match(/^[A-Z]+/);
      return m2 ? m2[0] : "";
    })();
    const wtc = wtcManual || wtcComputed;

    // Get departure and arrival location names
    const depAd = document.getElementById("newDepAd")?.value || "";
    const arrAd = document.getElementById("newArrAd")?.value || "";
    const depName = getLocationName(depAd);
    const arrName = getLocationName(arrAd);

    // ZZZZ companion field validation
    const newDepAdText = document.getElementById("newDepAdText")?.value?.trim() || "";
    const newArrAdText = document.getElementById("newArrAdText")?.value?.trim() || "";
    const newAircraftTypeText = document.getElementById("newAircraftTypeText")?.value?.trim() || "";
    if (depAd.trim().toUpperCase() === 'ZZZZ' && !newDepAdText) {
      showToast("Departure AD is ZZZZ — location name is required", 'error'); return;
    }
    if (arrAd.trim().toUpperCase() === 'ZZZZ' && !newArrAdText) {
      showToast("Arrival AD is ZZZZ — location name is required", 'error'); return;
    }
    if (aircraftType.trim().toUpperCase() === 'ZZZZ' && !newAircraftTypeText) {
      showToast("Aircraft Type is ZZZZ — aircraft description is required", 'error'); return;
    }

    // Priority is now a plain select; empty string or "-" means no priority
    const priorityLetterRaw = document.getElementById("priorityLetter")?.value || "";
    const priorityLetterValue = priorityLetterRaw === "-" ? "" : priorityLetterRaw;
    const remarksValue = document.getElementById("rwRemarks")?.value || "";
    const warningsValue = document.getElementById("rwWarnings")?.value || "";
    const notesValue = regData ? (regData['NOTES'] || "") : ""; // Keep notes from VKB for backward compatibility
    const osCountValue = parseInt(document.getElementById("newOsCount")?.value || "0", 10);
    const fisCountValue = parseInt(document.getElementById("newFisCount")?.value || ((document.getElementById("newFlightType")?.value || flightType) === "OVR" ? "1" : "0"), 10);
    const squawkValue = document.getElementById("atcSquawk")?.value || "";
    const routeValue = document.getElementById("atcRoute")?.value || "";
    const clearanceValue = document.getElementById("atcClearance")?.value || "";

    // Active mode: force ACTIVE status and infer missing actual time(s) from system clock
    if (_timingMode === "active") {
      const _now = new Date();
      const _nowUtc = `${String(_now.getUTCHours()).padStart(2, '0')}:${String(_now.getUTCMinutes()).padStart(2, '0')}`;
      if (selectedFlightType === "ARR") {
        if (!arrActual) arrActual = _nowUtc;
      } else {
        // DEP and OVR: depActual is the primary actual time (ACT for OVR)
        if (!depActual) depActual = _nowUtc;
      }
    }

    // OVR-specific: if EOFT (depPlanned) is blank in planned mode, treat as an
    // immediate/now crossing — create as ACTIVE and stamp ACT (depActual) = now.
    // If EOFT is provided, keep normal planned-mode behavior.
    const _ovrImmediateActive = selectedFlightType === "OVR"
      && _timingMode === "planned"
      && !depPlanned;
    if (_ovrImmediateActive) {
      const _now = new Date();
      depActual = `${String(_now.getUTCHours()).padStart(2, '0')}:${String(_now.getUTCMinutes()).padStart(2, '0')}`;
    }

    // Create movement - determine initial status based on whether time is past
    const initialStatus = (_timingMode === "active" || _ovrImmediateActive)
      ? "ACTIVE"
      : determineInitialStatus(selectedFlightType, dof, depPlanned, arrPlanned);
    let movement = {
      status: initialStatus,
      callsignCode: callsign,
      callsignLabel: "",
      callsignVoice: voiceCallsign,
      registration: regValue,
      operator: operator,
      type: aircraftType,
      popularName: popularName,
      wtc: wtc,
      depAd: depAd,
      depName: depName,
      arrAd: arrAd,
      arrName: arrName,
      depPlanned: depPlanned,
      depActual: depActual,
      arrPlanned: arrPlanned,
      arrActual: arrActual,
      dof: dof,
      rules: document.getElementById("newRules")?.value || "VFR",
      flightType: document.getElementById("newFlightType")?.value || flightType,
      isLocal: (document.getElementById("newFlightType")?.value || flightType) === "LOC",
      tngCount: parseInt(tng, 10),
      osCount: osCountValue,
      fisCount: fisCountValue,
      egowCode: egowCode,
      egowDesc: "",
      unitCode: document.getElementById("newUnitCode")?.value || "",
      unitDesc: "",
      captain: document.getElementById("newCaptain")?.value || "",
      pob: parseInt(pob, 10),
      priorityLetter: priorityLetterValue,
      remarks: remarksValue,
      warnings: warningsValue,
      notes: notesValue,
      squawk: squawkValue,
      route: routeValue,
      clearance: clearanceValue,
      durationMinutes: (() => { const v = parseInt(document.getElementById("newDuration")?.value || "", 10); return v > 0 ? v : null; })(),
      depAdText: document.getElementById("newDepAdText")?.value || "",
      arrAdText: document.getElementById("newArrAdText")?.value || "",
      aircraftTypeText: document.getElementById("newAircraftTypeText")?.value || "",
      outcomeStatus: 'NORMAL',
      outcomeReason: '',
      actualDestinationAd: '',
      actualDestinationText: '',
      outcomeTime: '',
    };

    // Validate and read formation (must happen before enrichMovementData)
    const newFormationBase = (document.getElementById("newCallsignCode")?.value?.trim() || "") +
                             (document.getElementById("newFlightNumber")?.value?.trim() || "");
    const newFormation = readFormationFromModal(newFormationBase, "newFormationCount", "newFormationElementsContainer");
    if (newFormation?._error) { showToast(newFormation.message, 'error'); return; }
    movement.formation = newFormation;

    // Enrich with auto-populated fields
    movement = enrichMovementData(movement);

    createMovement(movement);
    renderLiveBoard();
    renderHistoryBoard();
    if (window.updateDailyStats) window.updateDailyStats();
    if (window.updateFisCounters) window.updateFisCounters();
    showToast("Movement created successfully", 'success');

    // Close modal (also removes the document keydown handler to prevent leaks)
    closeActiveModal();
  });

  // Bind "Save & Complete" handler - creates movement and immediately marks as completed
  document.querySelector(".js-save-complete-flight")?.addEventListener("click", () => {
    // Simulate click on save button first to run validation
    const saveBtn = document.querySelector(".js-save-flight");
    if (!saveBtn) return;

    // Get current time for actual times
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // Get form values for validation
    const dof = document.getElementById("newDOF")?.value || getTodayDateString();
    let depPlanned = document.getElementById("newDepPlanned")?.value || "";
    let arrPlanned = document.getElementById("newArrPlanned")?.value || "";
    const callsignCode = document.getElementById("newCallsignCode")?.value || "";

    // Run basic validation
    const dofValidation = validateDate(dof);
    if (!dofValidation.valid) {
      showToast(dofValidation.error, 'error');
      return;
    }

    const callsignValidation = validateRequired(callsignCode, "Callsign Code");
    if (!callsignValidation.valid) {
      showToast(callsignValidation.error, 'error');
      return;
    }

    // Validate EGOW Code
    const egowCode = document.getElementById("newEgowCode")?.value?.toUpperCase().trim() || "";
    const validEgowCodes = ["VC", "VM", "BC", "BM", "VCH", "VMH", "VNH"];
    if (!egowCode || !validEgowCodes.includes(egowCode)) {
      showToast("Valid EGOW Code is required", 'error');
      return;
    }
    if (egowCode === 'BM') {
      const unitCodeVal = (document.getElementById("newUnitCode")?.value || "").trim();
      if (!unitCodeVal) {
        showToast("EGOW Unit code is required for BM flights", 'error');
        return;
      }
    }

    // Validate and normalize times
    const depValidation = validateTime(depPlanned);
    if (depValidation.normalized) depPlanned = depValidation.normalized;
    const arrValidation = validateTime(arrPlanned);
    if (arrValidation.normalized) arrPlanned = arrValidation.normalized;
    let scDepActual = document.getElementById("newDepActual")?.value || "";
    let scArrActual = document.getElementById("newArrActual")?.value || "";
    const scDepActualValidation = validateTime(scDepActual);
    if (scDepActualValidation.normalized) scDepActual = scDepActualValidation.normalized;
    const scArrActualValidation = validateTime(scArrActual);
    if (scArrActualValidation.normalized) scArrActual = scArrActualValidation.normalized;

    // Convert Local→UTC if in LOCAL display mode
    const _scMode = (getConfig().timeInputMode || "UTC").toUpperCase();
    if (_scMode === "LOCAL") {
      if (depPlanned) depPlanned = convertLocalToUTC(depPlanned);
      if (arrPlanned) arrPlanned = convertLocalToUTC(arrPlanned);
      if (scDepActual) scDepActual = convertLocalToUTC(scDepActual);
      if (scArrActual) scArrActual = convertLocalToUTC(scArrActual);
    }

    // Get all other form values (same as save handler)
    const pob = document.getElementById("newPob")?.value || "0";
    const tng = document.getElementById("newTng")?.value || "0";
    const flightNumber = document.getElementById("newFlightNumber")?.value || "";
    const callsign = callsignCode + flightNumber;
    const regValue = document.getElementById("newReg")?.value || "";
    const regData = lookupRegistration(regValue);
    const operator = regData ? (regData['OPERATOR'] || "") : "";
    const popularName = regData ? (regData['POPULAR NAME'] || "") : "";
    const voiceCallsign = getVoiceCallsignForDisplay(callsign, regValue);
    const aircraftType = document.getElementById("newType")?.value || "";
    const selectedFlightType = document.getElementById("newFlightType")?.value || flightType;
    const wtc = getWTC(aircraftType, selectedFlightType, getConfig().wtcSystem || "ICAO");
    const depAd = document.getElementById("newDepAd")?.value || "";
    const arrAd = document.getElementById("newArrAd")?.value || "";
    const depName = getLocationName(depAd);
    const arrName = getLocationName(arrAd);
    const priorityLetterRaw = document.getElementById("priorityLetter")?.value || "";
    const priorityLetterValue = priorityLetterRaw === "-" ? "" : priorityLetterRaw;
    const remarksValue = document.getElementById("rwRemarks")?.value || "";
    const warningsValue = document.getElementById("rwWarnings")?.value || "";
    const notesValue = regData ? (regData['NOTES'] || "") : "";
    const osCountValue = parseInt(document.getElementById("newOsCount")?.value || "0", 10);
    const fisCountValue = parseInt(document.getElementById("newFisCount")?.value || (selectedFlightType === "OVR" ? "1" : "0"), 10);
    const squawkValue = document.getElementById("atcSquawk")?.value || "";
    const routeValue = document.getElementById("atcRoute")?.value || "";
    const clearanceValue = document.getElementById("atcClearance")?.value || "";

    // Create movement with COMPLETED status and actual times
    let movement = {
      status: "COMPLETED",
      callsignCode: callsign,
      callsignLabel: "",
      callsignVoice: voiceCallsign,
      registration: regValue,
      operator: operator,
      type: aircraftType,
      popularName: popularName,
      wtc: wtc,
      depAd: depAd,
      depName: depName,
      arrAd: arrAd,
      arrName: arrName,
      depPlanned: depPlanned,
      depActual: scDepActual || depPlanned || currentTime,
      arrPlanned: arrPlanned,
      arrActual: scArrActual || arrPlanned || currentTime,
      dof: dof,
      rules: document.getElementById("newRules")?.value || "VFR",
      flightType: selectedFlightType,
      isLocal: selectedFlightType === "LOC",
      tngCount: parseInt(tng, 10),
      osCount: osCountValue,
      fisCount: fisCountValue,
      egowCode: egowCode,
      egowDesc: "",
      unitCode: document.getElementById("newUnitCode")?.value || "",
      unitDesc: "",
      captain: "",
      pob: parseInt(pob, 10),
      priorityLetter: priorityLetterValue,
      remarks: remarksValue,
      warnings: warningsValue,
      notes: notesValue,
      squawk: squawkValue,
      route: routeValue,
      clearance: clearanceValue,
      durationMinutes: (() => { const v = parseInt(document.getElementById("newDuration")?.value || "", 10); return v > 0 ? v : null; })(),
      formation: null
    };

    // Enrich with auto-populated fields
    movement = enrichMovementData(movement);

    createMovement(movement);
    renderLiveBoard();
    renderHistoryBoard();
    if (window.updateDailyStats) window.updateDailyStats();
    if (window.updateFisCounters) window.updateFisCounters();
    showToast("Movement created and completed", 'success');

    // Close modal (also removes the document keydown handler to prevent leaks)
    closeActiveModal();
  });
}

/**
 * Open "New LOC Flight" modal using the standard movement modal structure.
 * Flight type is locked to LOC; Dep AD and Arr AD are locked to EGOW.
 * Element IDs use the newLoc* prefix for backward compatibility with existing
 * regression tests (sprint6_loc_formation_verify.mjs).
 */
function openNewLocFlightModal() {
  openModal(`
    <div class="modal-header">
      <div>
        <div class="modal-title">New LOC Flight</div>
        <div class="modal-subtitle">Create a new local movement</div>
      </div>
      <div class="modal-header-buttons">
        <button class="btn btn-ghost js-minimize-modal" type="button" title="Minimize">−</button>
        <button class="btn btn-ghost js-close-modal" type="button" title="Close">✕</button>
      </div>
    </div>
    <div class="modal-body modal-sectioned">
      <!-- IDENTITY Section -->
      <section class="modal-section">
        <h3 class="modal-section-title">Identity</h3>
        <div class="modal-grid-identity">
          <div class="modal-field">
            <label class="modal-label">Callsign</label>
            <input id="newLocCallsignCode" class="modal-input" placeholder="SYS, GBNKV " />
          </div>
          <div class="modal-field">
            <label class="modal-label">Flight Number</label>
            <input id="newLocFlightNumber" class="modal-input" placeholder="106, 67VM" />
          </div>
          <div class="modal-field">
            <label class="modal-label">Registration</label>
            <input id="newLocReg" class="modal-input" placeholder="ZM520, G-BNKV" />
          </div>
          <div class="modal-field">
            <label class="modal-label">Aircraft Type</label>
            <input id="newLocType" class="modal-input is-derived" placeholder="EC35, C152" />
          </div>
          <div class="modal-field">
            <label class="modal-label">WTC</label>
            <select id="newLocWtc" class="modal-input"></select>
          </div>
          <div class="modal-field">
            <label class="modal-label">Priority</label>
            <select id="locPriorityLetter" class="modal-select">
              <option value="">-</option>
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
              <option value="D">D</option>
              <option value="E">E</option>
              <option value="Z">Z</option>
            </select>
          </div>
        </div>
      </section>

      <!-- PLAN Section -->
      <section class="modal-section">
        <h3 class="modal-section-title">Plan</h3>
        <div class="modal-section-grid-3">
          <div class="modal-field">
            <label class="modal-label">Flight Type</label>
            <input class="modal-input" value="LOC" disabled />
          </div>
          <div class="modal-field">
            <label class="modal-label">Flight Rules</label>
            <select id="newLocRules" class="modal-select">
              <option value="VFR" selected>VFR</option>
              <option value="IFR">IFR</option>
              <option value="Y">Y (IFR to VFR)</option>
              <option value="Z">Z (VFR to IFR)</option>
              <option value="SVFR">SVFR</option>
            </select>
          </div>
          <div class="modal-field">
            <label class="modal-label">POB</label>
            <input id="newLocPob" class="modal-input" type="number" value="0" min="0" />
          </div>
        </div>
        <div class="modal-section-grid modal-subgrid-gap">
          <div class="modal-field">
            <label class="modal-label">Departure AD</label>
            <input class="modal-input" value="EGOW" disabled />
          </div>
          <div class="modal-field">
            <label class="modal-label">Arrival AD</label>
            <input class="modal-input" value="EGOW" disabled />
          </div>
        </div>
      </section>

      <!-- TIMES Section -->
      <section class="modal-section">
        <h3 class="modal-section-title">Times</h3>
        <!-- Row 0: DOF + mode controls -->
        <div class="modal-section-grid">
          <div class="modal-field">
            <label class="modal-label">Date of Flight</label>
            <input id="newLocDOF" type="date" class="modal-input" value="${getTodayDateString()}" />
          </div>
          <div class="modal-field">
            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-start;">
              ${shouldShowNewFormTimeModeToggle() ? `<div>
                <label class="modal-label">Times shown in:</label>
                <button type="button" id="newLocTimeModeToggle" class="btn btn-ghost" style="padding: 2px 10px; font-size: 12px; margin-top: 2px;">UTC</button>
              </div>` : ''}
              <div>
                <label class="modal-label">Mode:</label>
                <button type="button" id="newLocTimingToggle" class="btn btn-ghost" data-timing-mode="planned" style="padding: 2px 10px; font-size: 12px; margin-top: 2px;">Planned</button>
              </div>
            </div>
          </div>
        </div>
        <!-- Rows 1–2: ETD|Duration|ETA / ATD|spacer|ATA
             Explicit grid-column/row keeps Duration stable when planned/actual toggle fires. -->
        <div class="modal-section-grid-3 modal-subgrid-gap">
          <div class="modal-field" data-timing-group="planned" style="grid-column:1;grid-row:1">
            <label class="modal-label">ETD</label>
            <input id="newLocStart" class="modal-input" placeholder="HH:MM" style="width: 80px;" value="" />
          </div>
          <div class="modal-field" style="grid-column:2;grid-row:1">
            <label class="modal-label">Duration</label>
            <input id="newLocDuration" class="modal-input" type="number" min="1" max="720" placeholder="default" style="width: 80px;" />
            <span style="font-size: 11px; color: #888; display: block; margin-top: 2px;">min (timeline only)</span>
          </div>
          <div class="modal-field" data-timing-group="planned" style="grid-column:3;grid-row:1">
            <label class="modal-label">ETA</label>
            <input id="newLocEnd" class="modal-input" placeholder="HH:MM" style="width: 80px;" value="" />
          </div>
          <div class="modal-field" data-timing-group="actual" style="display:none;grid-column:1;grid-row:1">
            <label class="modal-label">ATD</label>
            <input id="newLocStartActual" class="modal-input" placeholder="HH:MM" style="width: 80px;" value="" />
          </div>
          <div class="modal-field" data-timing-group="actual" style="display:none;grid-column:3;grid-row:1">
            <label class="modal-label">ATA</label>
            <input id="newLocEndActual" class="modal-input" placeholder="HH:MM" style="width: 80px;" value="" />
          </div>
        </div>
      </section>

      <!-- OPERATIONAL Section -->
      <section class="modal-section">
        <h3 class="modal-section-title">Operational</h3>
        <div class="modal-section-grid-3">
          <div class="modal-field">
            <label class="modal-label">T&amp;G</label>
            <input id="newLocTng" class="modal-input" type="number" value="0" min="0" />
          </div>
          <div class="modal-field">
            <label class="modal-label">O/S</label>
            <input id="newLocOsCount" class="modal-input" type="number" value="0" min="0" />
          </div>
          <div class="modal-field">
            <label class="modal-label">FIS</label>
            <input id="newLocFisCount" class="modal-input" type="number" value="0" min="0" />
          </div>
        </div>
        <div class="modal-section-grid modal-subgrid-gap">
          <div class="modal-field">
            <label class="modal-label">EGOW Code <span style="color: #d32f2f;">*</span></label>
            <input id="newLocEgowCode" class="modal-input is-derived" placeholder="" list="locEgowCodeOptions" />
            <datalist id="locEgowCodeOptions">
              <option value="VC">VC</option>
              <option value="VM">VM</option>
              <option value="BC">BC</option>
              <option value="BM">BM</option>
              <option value="VCH">VCH</option>
              <option value="VMH">VMH</option>
              <option value="VNH">VNH</option>
            </datalist>
          </div>
          <div class="modal-field">
            <label class="modal-label">EGOW Unit</label>
            <input id="newLocUnitCode" class="modal-input is-derived" placeholder="e.g. L, M, A" />
          </div>
        </div>
      </section>

      <!-- Collapsible: Remarks & Warnings -->
      <section class="modal-section modal-collapsible">
        <button type="button" class="modal-expander" aria-expanded="false" data-target="locRemarksWarnings">
          <span class="expander-icon">▶</span>
          Remarks &amp; Warnings
          <span class="expander-hint">(optional)</span>
        </button>
        <div id="locRemarksWarnings" class="modal-expander-panel" hidden>
          <div class="modal-section-grid">
            <div class="modal-field modal-field-full">
              <label class="modal-label">Remarks</label>
              <textarea id="newLocRemarks" class="modal-textarea" rows="3" placeholder=""></textarea>
            </div>
            <div class="modal-field modal-field-full">
              <label class="modal-label">Warnings</label>
              <textarea id="newLocWarnings" class="modal-textarea" rows="3" placeholder=""></textarea>
            </div>
          </div>
        </div>
      </section>

      <!-- Collapsible: ATC Details -->
      <section class="modal-section modal-collapsible">
        <button type="button" class="modal-expander" aria-expanded="false" data-target="locAtcDetails">
          <span class="expander-icon">▶</span>
          ATC Details
          <span class="expander-hint">(optional)</span>
        </button>
        <div id="locAtcDetails" class="modal-expander-panel" hidden>
          <div class="modal-section-grid">
            <div class="modal-field">
              <label class="modal-label">Squawk</label>
              <input id="newLocSquawk" class="modal-input" placeholder="e.g. 7375" maxlength="4" />
            </div>
            <div class="modal-field">
              <label class="modal-label">Route</label>
              <input id="newLocRoute" class="modal-input" placeholder="e.g. WAL L151 PEPUL Y322 BUGUP BUGU1S" />
            </div>
            <div class="modal-field modal-field-full">
              <label class="modal-label">Clearance</label>
              <textarea id="newLocClearance" class="modal-textarea" rows="2" placeholder="DCT WAL ↑ A2000 128.050"></textarea>
            </div>
          </div>
        </div>
      </section>

      <!-- Collapsible: Formation -->
      <section class="modal-section modal-collapsible">
        <button type="button" class="modal-expander" aria-expanded="false" data-target="newLocFormationSection">
          <span class="expander-icon">▶</span>
          Formation
          <span class="expander-hint">(optional – multi-aircraft)</span>
        </button>
        <div id="newLocFormationSection" class="modal-expander-panel" hidden>
          <div class="modal-section-grid">
            <div class="modal-field">
              <label class="modal-label">Number of Aircraft</label>
              <input id="newLocFormationCount" class="modal-input" type="number" value="2" min="2" max="12" style="width:80px;" />
              <div style="font-size:11px;color:#666;margin-top:4px;">2–12 aircraft. Callsigns default to auto-generated but are editable.</div>
            </div>
          </div>
          <div id="newLocFormationElementsContainer"></div>
        </div>
      </section>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost js-close-modal" type="button">Cancel</button>
      <div style="display: flex; gap: 8px;">
        <button class="btn btn-secondary-modal js-save-complete-loc" type="button" style="display: none;">Save &amp; Complete</button>
        <button class="btn btn-primary js-save-loc" type="button">Save</button>
      </div>
    </div>
  `);

  // Bind registration and callsign field interactions with VKB
  const callsignCodeInput = document.getElementById("newLocCallsignCode");
  const flightNumberInput = document.getElementById("newLocFlightNumber");
  const regInput = document.getElementById("newLocReg");
  const typeInput = document.getElementById("newLocType");
  const pobInput = document.getElementById("newLocPob");
  const egowCodeInput = document.getElementById("newLocEgowCode");
  const unitCodeInput = document.getElementById("newLocUnitCode");

  // LOC WTC select: constrained to wtcSystem, with autofill + manual-override support
  const locWtcSelect = document.getElementById('newLocWtc');
  let locWtcDirty = false;

  function locWtcOpts() {
    const key = String((getConfig().wtcSystem || 'ICAO')).toUpperCase();
    return (_WTC_OPTIONS && _WTC_OPTIONS[key]) ? _WTC_OPTIONS[key] : ['L','S','M','H','J'];
  }

  function setLocWtcOptions() {
    if (!locWtcSelect) return;
    const opts = locWtcOpts();
    locWtcSelect.innerHTML =
      `<option value=""></option>` +
      opts.map(o => `<option value="${o}">${o}</option>`).join('');
  }

  function extractLeadingToken(s) {
    const m = String(s || '').trim().toUpperCase().match(/^[A-Za-z]+/);
    return m ? m[0] : '';
  }

  function computeLocWtcFromCurrentForm() {
    const type = document.getElementById('newLocType')?.value || '';
    if (!type) return '';
    const sys = (getConfig().wtcSystem || 'ICAO');
    const w = getWTC(type, 'LOC', sys) || '';
    return extractLeadingToken(w);
  }

  function maybeAutofillLocWtc() {
    if (!locWtcSelect) return;
    if (locWtcDirty && locWtcSelect.value) return; // user manual override wins
    const raw = computeLocWtcFromCurrentForm();
    const allowed = new Set(locWtcOpts());
    locWtcSelect.value = allowed.has(raw) ? raw : '';
  }

  setLocWtcOptions();
  maybeAutofillLocWtc();

  locWtcSelect?.addEventListener('change', () => { locWtcDirty = true; });
  typeInput?.addEventListener('input', maybeAutofillLocWtc);

  // Apply automatic uppercase conversion to aviation-related fields
  makeInputUppercase(callsignCodeInput);
  makeInputUppercase(flightNumberInput);
  makeInputUppercase(regInput);
  makeInputUppercase(typeInput);
  makeInputUppercase(egowCodeInput);
  makeInputUppercase(unitCodeInput);

  // When registration is entered, auto-fill type, fixed callsign/flight number, and EGOW code
  if (regInput && typeInput) {
    const applyLocRegAutofill = () => {
      const regData = lookupRegistration(regInput.value);
      if (regData) {
        const vkbType = regData['TYPE'];
        if (vkbType && vkbType !== '-' && vkbType !== '') {
          typeInput.value = vkbType;
          // Programmatic type set doesn't fire 'input'; trigger LOC WTC autofill manually
          maybeAutofillLocWtc();
        }
        const egowFlightType = regData['EGOW FLIGHT TYPE'];
        if (egowFlightType && egowFlightType !== '-' && egowFlightType !== '' && egowCodeInput) {
          egowCodeInput.value = egowFlightType;
        }
        const fixedCallsign = regData['FIXED C/S'];
        if (fixedCallsign && fixedCallsign !== '-' && fixedCallsign !== '') {
          const match = fixedCallsign.match(/^([A-Z]+)(\d+.*)?$/);
          if (match && callsignCodeInput && (!callsignCodeInput.value || callsignCodeInput.value === '')) {
            callsignCodeInput.value = match[1];
            if (match[2] && flightNumberInput && (!flightNumberInput.value || flightNumberInput.value === '')) {
              flightNumberInput.value = match[2];
            }
          }
        }
        // Auto-fill Remarks/Warnings from registration data
        const remarksInput = document.getElementById('newLocRemarks');
        const warningsInput = document.getElementById('newLocWarnings');
        const warningsText = regData['WARNINGS'] || '';
        if (warningsText && warningsText !== '-' && warningsInput) {
          const currentWarnings = warningsInput.value.trim();
          const lastAutofill = warningsInput.dataset.autofillValue || '';
          if (!currentWarnings || currentWarnings === lastAutofill) {
            warningsInput.value = warningsText;
            warningsInput.dataset.autofillValue = warningsText;
          }
        }
        const notesText = regData['NOTES'] || '';
        if (notesText && notesText !== '-' && remarksInput) {
          const currentRemarks = remarksInput.value.trim();
          const lastAutofill = remarksInput.dataset.autofillValue || '';
          if (!currentRemarks || currentRemarks === lastAutofill) {
            remarksInput.value = notesText;
            remarksInput.dataset.autofillValue = notesText;
          }
        }
      } else {
        const inferredType = inferTypeFromReg(regInput.value);
        if (inferredType) {
          typeInput.value = inferredType;
          // Programmatic fallback type set; trigger LOC WTC autofill manually
          maybeAutofillLocWtc();
        }
      }
    };
    regInput.addEventListener("input", applyLocRegAutofill);
    regInput.addEventListener("change", applyLocRegAutofill);
    regInput.addEventListener("blur", applyLocRegAutofill);
  }

  // When callsign code or flight number changes, lookup unit code and auto-fill registration if fixed callsign
  const updateCallsignDerivedFields = () => {
    const code = callsignCodeInput?.value?.toUpperCase().trim() || '';
    const number = flightNumberInput?.value?.trim() || '';
    const fullCallsign = code + number;

    if (code.startsWith('UAM') && pobInput && (pobInput.value === '0' || !pobInput.value)) {
      pobInput.value = '2';
    }
    if (fullCallsign && unitCodeInput) {
      const unitData = lookupCallsign(fullCallsign);
      if (unitData && unitData['UC'] && unitData['UC'] !== '-' && unitData['UC'] !== '') {
        unitCodeInput.value = unitData['UC'];
      }
    }
    if (fullCallsign && regInput && (!regInput.value || regInput.value === '')) {
      const regData = lookupRegistrationByFixedCallsign(fullCallsign);
      if (regData) {
        const registration = regData['REGISTRATION'] || '';
        if (registration && registration !== '-') {
          regInput.value = registration;
          regInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    }
  };

  if (callsignCodeInput) callsignCodeInput.addEventListener("input", updateCallsignDerivedFields);
  if (flightNumberInput) flightNumberInput.addEventListener("input", updateCallsignDerivedFields);

  // Wire formation section
  const getLocCallsign = () =>
    (document.getElementById("newLocCallsignCode")?.value?.trim() || "") +
    (document.getElementById("newLocFlightNumber")?.value?.trim() || "");
  wireFormationCountInput("newLocFormationCount", "newLocFormationElementsContainer", getLocCallsign, []);
  callsignCodeInput?.addEventListener("input", () => {
    const container = document.getElementById("newLocFormationElementsContainer");
    if (!container?.querySelector('[data-el-callsign="0"]')) return;
    const count = parseInt(document.getElementById("newLocFormationCount")?.value || "2", 10);
    if (count >= 2) buildFormationElementRows(count, getLocCallsign(), "newLocFormationElementsContainer", []);
  });

  // Wire collapsible section expanders
  document.querySelectorAll('.modal-expander').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const panel = document.getElementById(targetId);
      if (!panel) return;
      const isExpanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', !isExpanded);
      panel.hidden = isExpanded;
      btn.querySelector('.expander-icon').textContent = isExpanded ? '▶' : '▼';
    });
  });

  // Bind UTC/Local time mode toggle (persistent, single toggle)
  bindTimeModeToggle("newLocTimeModeToggle",
    ["newLocStart", "newLocEnd", "newLocStartActual", "newLocEndActual"]);

  // Bind Planned/Active timing mode toggle (gates field visibility and Save & Complete)
  bindNewFormTimingToggle("newLocTimingToggle", ".js-save-complete-loc");

  // Bind bidirectional Duration ↔ planned-end sync
  bindPlannedTimesSync("newLocStart", "newLocEnd", "newLocDuration");

  // Bind save handler
  document.querySelector(".js-save-loc")?.addEventListener("click", () => {
    const dof = document.getElementById("newLocDOF")?.value || getTodayDateString();
    let depPlanned = document.getElementById("newLocStart")?.value || "";
    let arrPlanned = document.getElementById("newLocEnd")?.value || "";
    let depActual  = document.getElementById("newLocStartActual")?.value || "";
    let arrActual  = document.getElementById("newLocEndActual")?.value  || "";
    const pob = document.getElementById("newLocPob")?.value || "0";
    const tng = document.getElementById("newLocTng")?.value || "0";
    const callsignCode = document.getElementById("newLocCallsignCode")?.value || "";
    const flightNumber = document.getElementById("newLocFlightNumber")?.value || "";
    const callsign = callsignCode + flightNumber;

    // Determine which field group is active (planned or actual)
    const _locTimingMode = document.getElementById("newLocTimingToggle")?.dataset.timingMode || "planned";
    // Zero-out the hidden group so only visible fields are written
    if (_locTimingMode === "planned") {
      depActual = ""; arrActual = "";
    } else {
      depPlanned = ""; arrPlanned = "";
    }

    const dofValidation = validateDate(dof);
    if (!dofValidation.valid) { showToast(dofValidation.error, 'error'); return; }

    if (_locTimingMode === "planned") {
      const depValidation = validateTime(depPlanned);
      if (!depValidation.valid) { showToast(`Departure time: ${depValidation.error}`, 'error'); return; }
      if (depValidation.normalized) { depPlanned = depValidation.normalized; document.getElementById("newLocStart").value = depPlanned; }

      const arrValidation = validateTime(arrPlanned);
      if (!arrValidation.valid) { showToast(`Arrival time: ${arrValidation.error}`, 'error'); return; }
      if (arrValidation.normalized) { arrPlanned = arrValidation.normalized; document.getElementById("newLocEnd").value = arrPlanned; }
    } else {
      const depActualValidation = validateTime(depActual);
      if (!depActualValidation.valid) { showToast(`Actual departure time: ${depActualValidation.error}`, 'error'); return; }
      if (depActualValidation.normalized) { depActual = depActualValidation.normalized; document.getElementById("newLocStartActual").value = depActual; }

      const arrActualValidation = validateTime(arrActual);
      if (!arrActualValidation.valid) { showToast(`Actual arrival time: ${arrActualValidation.error}`, 'error'); return; }
      if (arrActualValidation.normalized) { arrActual = arrActualValidation.normalized; document.getElementById("newLocEndActual").value = arrActual; }
    }

    // Convert Local→UTC if in LOCAL display mode (only for the active field group)
    const _locSaveMode = (getConfig().timeInputMode || "UTC").toUpperCase();
    if (_locSaveMode === "LOCAL") {
      if (_locTimingMode === "planned") {
        if (depPlanned) depPlanned = convertLocalToUTC(depPlanned);
        if (arrPlanned) arrPlanned = convertLocalToUTC(arrPlanned);
      } else {
        if (depActual)  depActual  = convertLocalToUTC(depActual);
        if (arrActual)  arrActual  = convertLocalToUTC(arrActual);
      }
    }

    const pobValidation = validateNumberRange(pob, 0, 999, "POB");
    if (!pobValidation.valid) { showToast(pobValidation.error, 'error'); return; }

    const tngValidation = validateNumberRange(tng, 0, 99, "T&G count");
    if (!tngValidation.valid) { showToast(tngValidation.error, 'error'); return; }

    const callsignValidation = validateRequired(callsignCode, "Callsign Code");
    if (!callsignValidation.valid) { showToast(callsignValidation.error, 'error'); return; }

    const egowCode = document.getElementById("newLocEgowCode")?.value?.toUpperCase().trim() || "";
    const validEgowCodes = ["VC", "VM", "BC", "BM", "VCH", "VMH", "VNH"];
    if (egowCode && !validEgowCodes.includes(egowCode)) { showToast(`EGOW Code must be one of: ${validEgowCodes.join(', ')}`, 'error'); return; }
    if (egowCode === 'BM') {
      const unitCodeVal = (document.getElementById("newLocUnitCode")?.value || "").trim();
      if (!unitCodeVal) { showToast("EGOW Unit code is required for BM flights", 'error'); return; }
    }

    const locFormation = readFormationFromModal(callsign, "newLocFormationCount", "newLocFormationElementsContainer");
    if (locFormation?._error) { showToast(locFormation.message, 'error'); return; }

    const regValue = document.getElementById("newLocReg")?.value || "";
    const regData = lookupRegistration(regValue);
    const popularName = regData ? (regData['POPULAR NAME'] || "") : "";
    const voiceCallsign = getVoiceCallsignForDisplay(callsign, regValue);
    const aircraftType = document.getElementById("newLocType")?.value || "";
    // WTC: manual select override wins; fall back to computed value
    const wtcManual = (document.getElementById("newLocWtc")?.value || "").trim().toUpperCase();
    const wtcComputed = (() => {
      const w = getWTC(aircraftType, "LOC", getConfig().wtcSystem || "ICAO") || "";
      const m = w.trim().toUpperCase().match(/^[A-Z]+/);
      return m ? m[0] : "";
    })();
    const wtcAllowed = new Set(
      (_WTC_OPTIONS && _WTC_OPTIONS[String((getConfig().wtcSystem || 'ICAO')).toUpperCase()])
      || ['L','S','M','H','J']
    );
    const wtc = wtcManual || wtcComputed;
    if (wtc && !wtcAllowed.has(wtc)) {
      showToast('Invalid WTC category', 'error');
      return;
    }
    const operator = regData ? (regData['OPERATOR'] || "") : "";
    const notes = regData ? (regData['NOTES'] || "") : "";

    const priorityLetterRaw = document.getElementById("locPriorityLetter")?.value || "";
    const priorityLetterValue = priorityLetterRaw === "-" ? "" : priorityLetterRaw;
    const remarksValue = document.getElementById("newLocRemarks")?.value || "";
    const warningsValue = document.getElementById("newLocWarnings")?.value || "";
    const osCountValue = parseInt(document.getElementById("newLocOsCount")?.value || "0", 10);
    const fisCountValue = parseInt(document.getElementById("newLocFisCount")?.value || "0", 10);
    const squawkValue = document.getElementById("newLocSquawk")?.value || "";
    const routeValue = document.getElementById("newLocRoute")?.value || "";
    const clearanceValue = document.getElementById("newLocClearance")?.value || "";

    // Active mode: force ACTIVE status and infer missing actual time(s) from system clock
    if (_locTimingMode === "active") {
      const _now = new Date();
      const _nowUtc = `${String(_now.getUTCHours()).padStart(2, '0')}:${String(_now.getUTCMinutes()).padStart(2, '0')}`;
      if (!depActual) depActual = _nowUtc;
      if (!arrActual) {
        // Infer ATA = ATD + configured LOC flight duration (UTC arithmetic, wraps at midnight)
        const _locDur = getConfig().locFlightDurationMinutes || 40;
        const [_h, _m] = depActual.split(':').map(Number);
        const _totMins = _h * 60 + _m + _locDur;
        const _arrH = Math.floor(((_totMins % 1440) + 1440) % 1440 / 60);
        const _arrM = ((_totMins % 1440) + 1440) % 1440 % 60;
        arrActual = `${String(_arrH).padStart(2, '0')}:${String(_arrM).padStart(2, '0')}`;
      }
    }

    const initialStatus = _locTimingMode === "active"
      ? "ACTIVE"
      : determineInitialStatus("LOC", dof, depPlanned, arrPlanned);
    let movement = {
      status: initialStatus,
      callsignCode: callsign,
      callsignLabel: "",
      callsignVoice: voiceCallsign,
      registration: regValue,
      operator: operator,
      type: aircraftType,
      popularName: popularName,
      wtc: wtc,
      depAd: "EGOW",
      depName: getLocationName("EGOW"),
      arrAd: "EGOW",
      arrName: getLocationName("EGOW"),
      depPlanned: depPlanned,
      depActual: depActual,
      arrPlanned: arrPlanned,
      arrActual: arrActual,
      dof: dof,
      rules: document.getElementById("newLocRules")?.value || "VFR",
      flightType: "LOC",
      isLocal: true,
      tngCount: parseInt(tng, 10),
      osCount: osCountValue,
      fisCount: fisCountValue,
      egowCode: egowCode,
      egowDesc: "",
      unitCode: document.getElementById("newLocUnitCode")?.value || "",
      unitDesc: "",
      captain: "",
      pob: parseInt(pob, 10),
      priorityLetter: priorityLetterValue,
      remarks: remarksValue,
      warnings: warningsValue,
      notes: notes,
      squawk: squawkValue,
      route: routeValue,
      clearance: clearanceValue,
      durationMinutes: (() => { const v = parseInt(document.getElementById("newLocDuration")?.value || "", 10); return v > 0 ? v : null; })(),
      formation: locFormation || null
    };

    movement = enrichMovementData(movement);

    createMovement(movement);
    renderLiveBoard();
    renderHistoryBoard();
    if (window.updateDailyStats) window.updateDailyStats();
    if (window.updateFisCounters) window.updateFisCounters();
    showToast("Local flight created successfully", 'success');

    closeActiveModal();
  });

  // Bind "Save & Complete" handler
  document.querySelector(".js-save-complete-loc")?.addEventListener("click", () => {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const dof = document.getElementById("newLocDOF")?.value || getTodayDateString();
    let depPlanned = document.getElementById("newLocStart")?.value || "";
    let arrPlanned = document.getElementById("newLocEnd")?.value || "";
    const pob = document.getElementById("newLocPob")?.value || "0";
    const tng = document.getElementById("newLocTng")?.value || "0";
    const callsignCode = document.getElementById("newLocCallsignCode")?.value || "";
    const flightNumber = document.getElementById("newLocFlightNumber")?.value || "";
    const callsign = callsignCode + flightNumber;

    const dofValidation = validateDate(dof);
    if (!dofValidation.valid) { showToast(dofValidation.error, 'error'); return; }

    const callsignValidation = validateRequired(callsignCode, "Callsign Code");
    if (!callsignValidation.valid) { showToast(callsignValidation.error, 'error'); return; }

    const egowCode = document.getElementById("newLocEgowCode")?.value?.toUpperCase().trim() || "";
    const validEgowCodes = ["VC", "VM", "BC", "BM", "VCH", "VMH", "VNH"];
    if (egowCode && !validEgowCodes.includes(egowCode)) { showToast(`EGOW Code must be one of: ${validEgowCodes.join(', ')}`, 'error'); return; }
    if (egowCode === 'BM') {
      const unitCodeVal = (document.getElementById("newLocUnitCode")?.value || "").trim();
      if (!unitCodeVal) { showToast("EGOW Unit code is required for BM flights", 'error'); return; }
    }

    const depValidation = validateTime(depPlanned);
    if (depValidation.normalized) depPlanned = depValidation.normalized;
    const arrValidation = validateTime(arrPlanned);
    if (arrValidation.normalized) arrPlanned = arrValidation.normalized;
    let locScDepActual = document.getElementById("newLocStartActual")?.value || "";
    let locScArrActual = document.getElementById("newLocEndActual")?.value  || "";
    const locScDepActualV = validateTime(locScDepActual);
    if (locScDepActualV.normalized) locScDepActual = locScDepActualV.normalized;
    const locScArrActualV = validateTime(locScArrActual);
    if (locScArrActualV.normalized) locScArrActual = locScArrActualV.normalized;

    // Convert Local→UTC if in LOCAL display mode
    const _locCpMode = (getConfig().timeInputMode || "UTC").toUpperCase();
    if (_locCpMode === "LOCAL") {
      if (depPlanned) depPlanned = convertLocalToUTC(depPlanned);
      if (arrPlanned) arrPlanned = convertLocalToUTC(arrPlanned);
      if (locScDepActual) locScDepActual = convertLocalToUTC(locScDepActual);
      if (locScArrActual) locScArrActual = convertLocalToUTC(locScArrActual);
    }

    const locCpFormation = readFormationFromModal(callsign, "newLocFormationCount", "newLocFormationElementsContainer");
    if (locCpFormation?._error) { showToast(locCpFormation.message, 'error'); return; }

    const regValue = document.getElementById("newLocReg")?.value || "";
    const regData = lookupRegistration(regValue);
    const popularName = regData ? (regData['POPULAR NAME'] || "") : "";
    const voiceCallsign = getVoiceCallsignForDisplay(callsign, regValue);
    const aircraftType = document.getElementById("newLocType")?.value || "";
    // WTC: manual select override wins; fall back to computed value
    const wtcManual = (document.getElementById("newLocWtc")?.value || "").trim().toUpperCase();
    const wtcComputed = (() => {
      const w = getWTC(aircraftType, "LOC", getConfig().wtcSystem || "ICAO") || "";
      const m = w.trim().toUpperCase().match(/^[A-Z]+/);
      return m ? m[0] : "";
    })();
    const wtcAllowed = new Set(
      (_WTC_OPTIONS && _WTC_OPTIONS[String((getConfig().wtcSystem || 'ICAO')).toUpperCase()])
      || ['L','S','M','H','J']
    );
    const wtc = wtcManual || wtcComputed;
    if (wtc && !wtcAllowed.has(wtc)) {
      showToast('Invalid WTC category', 'error');
      return;
    }
    const operator = regData ? (regData['OPERATOR'] || "") : "";
    const notes = regData ? (regData['NOTES'] || "") : "";

    const locCpPriorityRaw = document.getElementById("locPriorityLetter")?.value || "";
    const priorityLetterValue = locCpPriorityRaw === "-" ? "" : locCpPriorityRaw;
    const remarksValue = document.getElementById("newLocRemarks")?.value || "";
    const warningsValue = document.getElementById("newLocWarnings")?.value || "";
    const osCountValue = parseInt(document.getElementById("newLocOsCount")?.value || "0", 10);
    const fisCountValue = parseInt(document.getElementById("newLocFisCount")?.value || "0", 10);
    const squawkValue = document.getElementById("newLocSquawk")?.value || "";
    const routeValue = document.getElementById("newLocRoute")?.value || "";
    const clearanceValue = document.getElementById("newLocClearance")?.value || "";

    let movement = {
      status: "COMPLETED",
      callsignCode: callsign,
      callsignLabel: "",
      callsignVoice: voiceCallsign,
      registration: regValue,
      operator: operator,
      type: aircraftType,
      popularName: popularName,
      wtc: wtc,
      depAd: "EGOW",
      depName: getLocationName("EGOW"),
      arrAd: "EGOW",
      arrName: getLocationName("EGOW"),
      depPlanned: depPlanned,
      depActual: locScDepActual || depPlanned || currentTime,
      arrPlanned: arrPlanned,
      arrActual: locScArrActual || arrPlanned || currentTime,
      dof: dof,
      rules: document.getElementById("newLocRules")?.value || "VFR",
      flightType: "LOC",
      isLocal: true,
      tngCount: parseInt(tng, 10),
      osCount: osCountValue,
      fisCount: fisCountValue,
      egowCode: egowCode,
      egowDesc: "",
      unitCode: document.getElementById("newLocUnitCode")?.value || "",
      unitDesc: "",
      captain: "",
      pob: parseInt(pob, 10),
      priorityLetter: priorityLetterValue,
      remarks: remarksValue,
      warnings: warningsValue,
      notes: notes,
      squawk: squawkValue,
      route: routeValue,
      clearance: clearanceValue,
      formation: locCpFormation || null
    };

    movement = enrichMovementData(movement);

    const createdLoc = createMovement(movement);
    if (createdLoc?.id && locCpFormation) cascadeFormationStatus(createdLoc.id, "COMPLETED");
    renderLiveBoard();
    renderHistoryBoard();
    if (window.updateDailyStats) window.updateDailyStats();
    if (window.updateFisCounters) window.updateFisCounters();
    showToast("Local flight created and completed", 'success');

    closeActiveModal();
  });
}

/**
 * Open edit modal for an existing movement
 * Pre-fills all fields with current values
 */
function openEditMovementModal(m) {
  const flightType = m.flightType || "DEP";

  // Split callsign into code and number parts for editing
  const callsignMatch = (m.callsignCode || "").match(/^([A-Z]+)(\d+.*)?$/);
  const callsignCode = callsignMatch ? callsignMatch[1] : (m.callsignCode || "");
  const flightNumber = callsignMatch && callsignMatch[2] ? callsignMatch[2] : "";

  // Check if priority is enabled
  const hasPriority = m.priorityLetter && m.priorityLetter.length > 0;

  openModal(`
    <div class="modal-header">
      <div>
        <div class="modal-title">Edit ${flightType} Flight</div>
        <div class="modal-subtitle">Movement ID: ${m.id}</div>
      </div>
      <div class="modal-header-buttons">
        <button class="btn btn-ghost js-minimize-modal" type="button" title="Minimize">−</button>
        <button class="btn btn-ghost js-close-modal" type="button" title="Close">✕</button>
      </div>
    </div>
    <div class="modal-body modal-sectioned">
      <!-- Identity Section -->
      <section class="modal-section">
        <h3 class="modal-section-title">Identity</h3>
        <div class="modal-grid-identity">
          <div class="modal-field">
            <label class="modal-label">Callsign Code</label>
            <input id="editCallsignCode" class="modal-input" value="${escapeHtml(callsignCode)}" placeholder="e.g. BAW, CONNECT, G-BYUN" />
          </div>
          <div class="modal-field">
            <label class="modal-label">Flight Number</label>
            <input id="editFlightNumber" class="modal-input" value="${escapeHtml(flightNumber)}" placeholder="e.g. 123, 01" />
          </div>
          <div class="modal-field">
            <label class="modal-label">Registration</label>
            <input id="editReg" class="modal-input" value="${escapeHtml(m.registration || "")}" />
          </div>
          <div class="modal-field">
            <label class="modal-label">Aircraft Type</label>
            <input id="editType" class="modal-input is-derived" value="${escapeHtml(m.type || "")}" />
            <input id="editAircraftTypeText" class="modal-input zzzz-companion" placeholder="Aircraft description (required for ZZZZ)" style="display:none; margin-top:4px;" value="${escapeHtml(m.aircraftTypeText || "")}" />
          </div>
          <div class="modal-field">
            <label class="modal-label">WTC</label>
            <input id="editWtcDisplay" class="modal-input is-derived" value="${escapeHtml(m.wtc || "")}" disabled />
          </div>
          <div class="modal-field">
            <label class="modal-label">PIC</label>
            <input id="editCaptain" class="modal-input" value="${escapeHtml(m.captain || "")}" placeholder="Pilot in Command" />
          </div>
          <div class="modal-field">
            <label class="modal-label">Priority</label>
            <select id="editPriorityLetter" class="modal-select">
              <option value="" ${!hasPriority ? "selected" : ""}>-</option>
              <option value="A" ${m.priorityLetter === "A" ? "selected" : ""}>A</option>
              <option value="B" ${m.priorityLetter === "B" ? "selected" : ""}>B</option>
              <option value="C" ${m.priorityLetter === "C" ? "selected" : ""}>C</option>
              <option value="D" ${m.priorityLetter === "D" ? "selected" : ""}>D</option>
              <option value="E" ${m.priorityLetter === "E" ? "selected" : ""}>E</option>
              <option value="Z" ${m.priorityLetter === "Z" ? "selected" : ""}>Z</option>
            </select>
          </div>
        </div>
      </section>

      <!-- Plan Section -->
      <section class="modal-section">
        <h3 class="modal-section-title">Plan</h3>
        <div class="modal-section-grid-3">
          <div class="modal-field">
            <label class="modal-label">Flight Type</label>
            <select id="editFlightType" class="modal-select" ${flightType === "LOC" ? "disabled" : ""}>
              <option ${flightType === "ARR" ? "selected" : ""}>ARR</option>
              <option ${flightType === "DEP" ? "selected" : ""}>DEP</option>
              <option ${flightType === "LOC" ? "selected" : ""}>LOC</option>
              <option ${flightType === "OVR" ? "selected" : ""}>OVR</option>
            </select>
          </div>
          <div class="modal-field">
            <label class="modal-label">Flight Rules</label>
            <select id="editRules" class="modal-select">
              <option value="VFR" ${m.rules === "VFR" ? "selected" : ""}>VFR</option>
              <option value="IFR" ${m.rules === "IFR" ? "selected" : ""}>IFR</option>
              <option value="Y" ${m.rules === "Y" ? "selected" : ""}>Y (IFR to VFR)</option>
              <option value="Z" ${m.rules === "Z" ? "selected" : ""}>Z (VFR to IFR)</option>
              <option value="SVFR" ${m.rules === "SVFR" ? "selected" : ""}>SVFR</option>
            </select>
          </div>
          <div class="modal-field">
            <label class="modal-label">POB</label>
            <input id="editPob" class="modal-input" type="number" value="${m.pob || 0}" min="0" />
          </div>
        </div>
        <div class="modal-section-grid modal-subgrid-gap">
          <div class="modal-field">
            <label class="modal-label">Departure AD</label>
            <input id="editDepAd" class="modal-input" value="${escapeHtml(m.depAd || "")}" ${flightType === "LOC" ? "disabled" : ""} />
            <input id="editDepAdText" class="modal-input zzzz-companion" placeholder="Location name (required for ZZZZ)" style="display:none; margin-top:4px;" value="${escapeHtml(m.depAdText || "")}" />
          </div>
          <div class="modal-field">
            <label class="modal-label">Arrival AD</label>
            <input id="editArrAd" class="modal-input" value="${escapeHtml(m.arrAd || "")}" ${flightType === "LOC" ? "disabled" : ""} />
            <input id="editArrAdText" class="modal-input zzzz-companion" placeholder="Location name (required for ZZZZ)" style="display:none; margin-top:4px;" value="${escapeHtml(m.arrAdText || "")}" />
          </div>
        </div>
      </section>

      <!-- Times Section -->
      <section class="modal-section">
        <h3 class="modal-section-title">Times</h3>
        <!-- Row 0: DOF + UTC toggle (policy-gated) -->
        <div class="modal-section-grid">
          <div class="modal-field">
            <label class="modal-label">Date of Flight (DOF)</label>
            <input id="editDOF" type="date" class="modal-input" value="${m.dof || getTodayDateString()}" />
          </div>
          ${shouldShowNewFormTimeModeToggle() ? `<div class="modal-field">
            <label class="modal-label">Times shown in:</label>
            <button type="button" id="editTimeModeToggle" class="btn btn-ghost" style="padding: 2px 10px; font-size: 12px; margin-top: 2px;">UTC</button>
          </div>` : ''}
        </div>
        <!-- Rows 1–2: ETD|Duration|ETA / ATD|spacer|ATA -->
        <div class="modal-section-grid-3 modal-subgrid-gap">
          ${renderTimesGrid({
            etdId: "editDepPlanned", etaId: "editArrPlanned",
            atdId: "editDepActual",  ataId: "editArrActual",
            durationId: "editDuration",
            etdLabel: flightType === "OVR" ? "EOFT" : "ETD",
            etaLabel: flightType === "OVR" ? "ELFT" : "ETA",
            atdLabel: flightType === "OVR" ? "AOFT" : "ATD",
            ataLabel: flightType === "OVR" ? "ALFT" : "ATA",
            etdVal: m.depPlanned || "", etaVal: m.arrPlanned || "",
            atdVal: m.depActual  || "", ataVal: m.arrActual  || "",
            durationVal: m.durationMinutes || "",
            etaDisabled: false,
            ataDisabled: false
          })}
        </div>
      </section>

      <!-- Operational Section -->
      <section class="modal-section">
        <h3 class="modal-section-title">Operational</h3>
        <div class="modal-section-grid-3">
          <div class="modal-field">
            <label class="modal-label">T&amp;G</label>
            <input id="editTng" class="modal-input" type="number" value="${m.tngCount || 0}" min="0" />
          </div>
          <div class="modal-field">
            <label class="modal-label">O/S</label>
            <input id="editOsCount" class="modal-input" type="number" value="${m.osCount || 0}" min="0" />
          </div>
          <div class="modal-field">
            <label class="modal-label">FIS</label>
            <input id="editFisCount" class="modal-input" type="number" value="${m.fisCount || 0}" min="0" />
          </div>
        </div>
        <div class="modal-section-grid modal-subgrid-gap">
          <div class="modal-field">
            <label class="modal-label">EGOW Code <span style="color: #d32f2f;">*</span></label>
            <input id="editEgowCode" class="modal-input is-derived" value="${escapeHtml(m.egowCode || "")}" placeholder="e.g. BM, VM" />
          </div>
          <div class="modal-field">
            <label class="modal-label">EGOW Unit</label>
            <input id="editUnitCode" class="modal-input is-derived" value="${escapeHtml(m.unitCode || "")}" placeholder="e.g. L, M, A" />
          </div>
        </div>
      </section>

      <!-- Collapsible: Remarks & Warnings -->
      <section class="modal-section modal-collapsible">
        <button type="button" class="modal-expander" aria-expanded="false" data-target="editRemarksWarnings">
          <span class="expander-icon">▶</span>
          Remarks &amp; Warnings
          <span class="expander-hint">(optional)</span>
        </button>
        <div id="editRemarksWarnings" class="modal-expander-panel" hidden>
          <div class="modal-section-grid">
            <div class="modal-field modal-field-full">
              <label class="modal-label">Remarks</label>
              <textarea id="editRwRemarks" class="modal-textarea" rows="3">${escapeHtml(m.remarks || "")}</textarea>
            </div>
            <div class="modal-field modal-field-full">
              <label class="modal-label">Warnings</label>
              <textarea id="editRwWarnings" class="modal-textarea" rows="3">${escapeHtml(m.warnings || "")}</textarea>
            </div>
          </div>
        </div>
      </section>

      <!-- Collapsible: ATC Details -->
      <section class="modal-section modal-collapsible">
        <button type="button" class="modal-expander" aria-expanded="false" data-target="editAtcDetails">
          <span class="expander-icon">▶</span>
          ATC Details
          <span class="expander-hint">(optional)</span>
        </button>
        <div id="editAtcDetails" class="modal-expander-panel" hidden>
          <div class="modal-section-grid">
            <div class="modal-field">
              <label class="modal-label">Squawk</label>
              <input id="editAtcSquawk" class="modal-input" value="${escapeHtml(m.squawk || "")}" placeholder="e.g. 7000" maxlength="4" />
            </div>
            <div class="modal-field">
              <label class="modal-label">Route</label>
              <input id="editAtcRoute" class="modal-input" value="${escapeHtml(m.route || "")}" placeholder="e.g. DCT" />
            </div>
            <div class="modal-field modal-field-full">
              <label class="modal-label">Clearance</label>
              <textarea id="editAtcClearance" class="modal-textarea" rows="2">${escapeHtml(m.clearance || "")}</textarea>
            </div>
          </div>
        </div>
      </section>

      <!-- Collapsible: Formation -->
      <section class="modal-section modal-collapsible">
        <button type="button" class="modal-expander"
          aria-expanded="${m.formation ? "true" : "false"}"
          data-target="editFormationSection">
          <span class="expander-icon">${m.formation ? "▼" : "▶"}</span>
          Formation
          <span class="expander-hint">${m.formation ? `(${m.formation.elements?.length || 0} aircraft)` : "(optional – multi-aircraft)"}</span>
        </button>
        <div id="editFormationSection" class="modal-expander-panel" ${m.formation ? "" : "hidden"}>
          <div class="modal-section-grid">
            <div class="modal-field">
              <label class="modal-label">Number of Aircraft</label>
              <input id="editFormationCount" class="modal-input" type="number"
                value="${m.formation?.elements?.length || 2}" min="2" max="12" style="width:80px;" />
              <div style="font-size:11px;color:#666;margin-top:4px;">2–12 aircraft. Set below 2 or use Remove to clear formation.</div>
            </div>
            ${m.formation ? `<div class="modal-field" style="display:flex;align-items:flex-end;">
              <button type="button" class="btn btn-ghost js-remove-formation" style="color:#d32f2f;font-size:12px;">Remove Formation</button>
            </div>` : ""}
          </div>
          <div id="editFormationElementsContainer"></div>
        </div>
      </section>

      <!-- Collapsible: Outcome -->
      <section class="modal-section modal-collapsible">
        <button type="button" class="modal-expander" aria-expanded="${(m.outcomeStatus && m.outcomeStatus !== 'NORMAL') ? "true" : "false"}" data-target="editOutcomeSection">
          <span class="expander-icon">${(m.outcomeStatus && m.outcomeStatus !== 'NORMAL') ? "▼" : "▶"}</span>
          Outcome
          <span class="expander-hint">${(m.outcomeStatus && m.outcomeStatus !== 'NORMAL') ? `(${escapeHtml(m.outcomeStatus)})` : "(optional – for non-normal endings)"}</span>
        </button>
        <div id="editOutcomeSection" class="modal-expander-panel" ${(m.outcomeStatus && m.outcomeStatus !== 'NORMAL') ? "" : "hidden"}>
          <div class="modal-section-grid-3 modal-subgrid-gap">
            <div class="modal-field">
              <label class="modal-label">Outcome Status</label>
              <select id="editOutcomeStatus" class="modal-select">
                <option value="NORMAL"    ${(!m.outcomeStatus || m.outcomeStatus === 'NORMAL')    ? "selected" : ""}>Normal</option>
                <option value="DIVERTED"  ${m.outcomeStatus === 'DIVERTED'  ? "selected" : ""}>Diverted</option>
                <option value="CHANGED"   ${m.outcomeStatus === 'CHANGED'   ? "selected" : ""}>Changed</option>
                <option value="CANCELLED" ${m.outcomeStatus === 'CANCELLED' ? "selected" : ""}>Cancelled</option>
              </select>
            </div>
            <div class="modal-field js-outcome-dest" style="${(m.outcomeStatus === 'DIVERTED' || m.outcomeStatus === 'CHANGED') ? '' : 'display:none'}">
              <label class="modal-label">Actual Dest. AD</label>
              <input id="editActualDestAd" class="modal-input" value="${escapeHtml(m.actualDestinationAd || "")}" placeholder="e.g. EGGP" />
              <input id="editActualDestText" class="modal-input zzzz-companion" placeholder="Location name (required for ZZZZ)" style="display:none; margin-top:4px;" value="${escapeHtml(m.actualDestinationText || "")}" />
            </div>
            <div class="modal-field js-outcome-time" style="${(m.outcomeStatus === 'DIVERTED' || m.outcomeStatus === 'CHANGED') ? '' : 'display:none'}">
              <label class="modal-label">Outcome Time</label>
              <input id="editOutcomeTime" class="modal-input" value="${escapeHtml(m.outcomeTime || "")}" placeholder="HH:MM" style="width:80px;" />
            </div>
          </div>
          <div class="modal-section-grid modal-subgrid-gap">
            <div class="modal-field modal-field-full">
              <label class="modal-label">Reason / Notes</label>
              <input id="editOutcomeReason" class="modal-input" value="${escapeHtml(m.outcomeReason || "")}" placeholder="Optional reason or notes" />
            </div>
          </div>
        </div>
      </section>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost js-close-modal" type="button">Cancel</button>
      <div style="display: flex; gap: 8px;">
        <button class="btn btn-secondary-modal js-save-complete-edit" type="button">Save &amp; Complete</button>
        <button class="btn btn-primary js-save-edit" type="button">Save Changes</button>
      </div>
    </div>
  `);

  // Bind registration and callsign field interactions with VKB
  const callsignCodeInput = document.getElementById("editCallsignCode");
  const flightNumberInput = document.getElementById("editFlightNumber");
  const regInput = document.getElementById("editReg");
  const typeInput = document.getElementById("editType");
  const pobInput = document.getElementById("editPob");
  const egowCodeInput = document.getElementById("editEgowCode");
  const unitCodeInput = document.getElementById("editUnitCode");
  const depAdInput = document.getElementById("editDepAd");
  const arrAdInput = document.getElementById("editArrAd");

  // Apply automatic uppercase conversion to aviation-related fields
  makeInputUppercase(callsignCodeInput);
  makeInputUppercase(flightNumberInput);
  makeInputUppercase(regInput);
  makeInputUppercase(typeInput);
  makeInputUppercase(egowCodeInput);
  makeInputUppercase(unitCodeInput);
  makeInputUppercase(depAdInput);
  makeInputUppercase(arrAdInput);

  // ZZZZ companion field visibility
  bindZzzzCompanion(depAdInput, document.getElementById("editDepAdText"));
  bindZzzzCompanion(arrAdInput, document.getElementById("editArrAdText"));
  bindZzzzCompanion(typeInput,  document.getElementById("editAircraftTypeText"));

  // Outcome status show/hide for destination/time fields
  const outcomeStatusSel = document.getElementById("editOutcomeStatus");
  const outcomeDestEls = document.querySelectorAll("#editOutcomeSection .js-outcome-dest");
  const outcomeTimeEls = document.querySelectorAll("#editOutcomeSection .js-outcome-time");
  const actualDestAdInput = document.getElementById("editActualDestAd");
  const actualDestTextInput = document.getElementById("editActualDestText");
  if (outcomeStatusSel) {
    const updateOutcomeFields = () => {
      const v = outcomeStatusSel.value;
      const showDest = v === 'DIVERTED' || v === 'CHANGED';
      outcomeDestEls.forEach(el => { el.style.display = showDest ? '' : 'none'; });
      outcomeTimeEls.forEach(el => { el.style.display = showDest ? '' : 'none'; });
    };
    outcomeStatusSel.addEventListener('change', updateOutcomeFields);
    // Also wire ZZZZ companion for actual destination
    if (actualDestAdInput && actualDestTextInput) {
      makeInputUppercase(actualDestAdInput);
      bindZzzzCompanion(actualDestAdInput, actualDestTextInput);
    }
  }

  // When registration is entered, auto-fill type, fixed callsign/flight number, and EGOW code
  if (regInput && typeInput) {
    const applyRegAutofill = () => {
      const regData = lookupRegistration(regInput.value);
      if (regData) {
        // Auto-fill aircraft type from VKB
        const vkbType = regData['TYPE'];
        if (vkbType && vkbType !== '-' && vkbType !== '') {
          typeInput.value = vkbType;
        }

        // Auto-fill EGOW Code from registration
        const egowFlightType = regData['EGOW FLIGHT TYPE'];
        if (egowFlightType && egowFlightType !== '-' && egowFlightType !== '' && egowCodeInput) {
          egowCodeInput.value = egowFlightType;
        }

        // Auto-fill fixed callsign and flight number if available
        const fixedCallsign = regData['FIXED C/S'];
        if (fixedCallsign && fixedCallsign !== '-' && fixedCallsign !== '') {
          // Try to split into callsign code and flight number
          // e.g., "UAM01" → "UAM" + "01"
          const match = fixedCallsign.match(/^([A-Z]+)(\d+.*)?$/);
          if (match && callsignCodeInput && (!callsignCodeInput.value || callsignCodeInput.value === '')) {
            callsignCodeInput.value = match[1]; // Code part
            if (match[2] && flightNumberInput && (!flightNumberInput.value || flightNumberInput.value === '')) {
              flightNumberInput.value = match[2]; // Number part
            }
          }
        }
      } else {
        // Fallback to hardcoded lookup if not in VKB
        const inferredType = inferTypeFromReg(regInput.value);
        if (inferredType) {
          typeInput.value = inferredType;
        }
      }
    };
    regInput.addEventListener("input", applyRegAutofill);
    regInput.addEventListener("change", applyRegAutofill);
    regInput.addEventListener("blur", applyRegAutofill);
  }

  // When callsign code or flight number changes, check for UAM pattern, lookup unit code, and auto-fill registration if fixed callsign
  const updateCallsignDerivedFields = () => {
    const code = callsignCodeInput?.value?.toUpperCase().trim() || '';
    const number = flightNumberInput?.value?.trim() || '';
    const fullCallsign = code + number;

    // UAM* pattern → POB = 2
    if (code.startsWith('UAM') && pobInput && (pobInput.value === '0' || !pobInput.value)) {
      pobInput.value = '2';
    }

    // Lookup unit code from full callsign
    if (fullCallsign && unitCodeInput) {
      const unitData = lookupCallsign(fullCallsign);
      if (unitData && unitData['UC'] && unitData['UC'] !== '-' && unitData['UC'] !== '') {
        unitCodeInput.value = unitData['UC'];
      }
    }

    // If callsign matches a fixed callsign, auto-fill registration (only if registration is empty)
    if (fullCallsign && regInput && (!regInput.value || regInput.value === '')) {
      const regData = lookupRegistrationByFixedCallsign(fullCallsign);
      if (regData) {
        const registration = regData['REGISTRATION'] || '';
        if (registration && registration !== '-') {
          regInput.value = registration;
          // Trigger registration input event to update dependent fields
          regInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    }
  };

  if (callsignCodeInput) {
    callsignCodeInput.addEventListener("input", updateCallsignDerivedFields);
  }
  if (flightNumberInput) {
    flightNumberInput.addEventListener("input", updateCallsignDerivedFields);
  }

  // WTC display auto-update
  const editWtcDisplay = document.getElementById('editWtcDisplay');
  const updateEditWtcDisplay = () => {
    if (!editWtcDisplay) return;
    const t = document.getElementById('editType')?.value || '';
    const ft = document.getElementById('editFlightType')?.value || flightType;
    editWtcDisplay.value = t ? (getWTC(t, ft, getConfig().wtcSystem || 'ICAO') || '') : '';
  };
  document.getElementById('editType')?.addEventListener('input', updateEditWtcDisplay);
  document.getElementById('editFlightType')?.addEventListener('change', updateEditWtcDisplay);

  // Wire collapsible sections
  document.querySelectorAll('.modal-expander').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const panel = document.getElementById(targetId);
      const isExpanded = btn.getAttribute('aria-expanded') === 'true';

      btn.setAttribute('aria-expanded', !isExpanded);
      panel.hidden = isExpanded;
      btn.querySelector('.expander-icon').textContent = isExpanded ? '▶' : '▼';
    });
  });

  // Wire formation section — pre-populate element rows and bind count input
  const getEditCallsign = () =>
    (document.getElementById("editCallsignCode")?.value?.trim() || "") +
    (document.getElementById("editFlightNumber")?.value?.trim() || "");
  const existingElements = m.formation?.elements || [];
  const initialEditCount = existingElements.length || 1;
  buildFormationElementRows(initialEditCount, getEditCallsign(), "editFormationElementsContainer", existingElements);
  wireFormationCountInput("editFormationCount", "editFormationElementsContainer", getEditCallsign, existingElements);
  callsignCodeInput?.addEventListener("input", () => {
    const count = parseInt(document.getElementById("editFormationCount")?.value || "1", 10);
    if (count > 1) buildFormationElementRows(count, getEditCallsign(), "editFormationElementsContainer", existingElements);
  });

  // "Remove Formation" button — set count to 1 and clear container
  document.querySelector(".js-remove-formation")?.addEventListener("click", () => {
    const countInput = document.getElementById("editFormationCount");
    if (countInput) countInput.value = "1";
    buildFormationElementRows(1, getEditCallsign(), "editFormationElementsContainer", []);
    showToast("Formation removed — click Save Changes to persist", "info");
  });

  // Auto-fill Remarks and Warnings from registration data
  const editRemarksInput = document.getElementById('editRwRemarks');
  const editWarningsInput = document.getElementById('editRwWarnings');

  if (regInput && editRemarksInput && editWarningsInput) {
    regInput.addEventListener("input", () => {
      const regData = lookupRegistration(regInput.value);
      if (regData) {
        // Auto-fill Warnings (column 15)
        const warningsText = regData['WARNINGS'] || '';
        if (warningsText && warningsText !== '-') {
          const currentWarnings = editWarningsInput.value.trim();
          const lastAutofill = editWarningsInput.dataset.autofillValue || '';
          if (!currentWarnings || currentWarnings === lastAutofill) {
            editWarningsInput.value = warningsText;
            editWarningsInput.dataset.autofillValue = warningsText;
          }
        }

        // Auto-fill Remarks/Notes (column 16)
        const notesText = regData['NOTES'] || '';
        if (notesText && notesText !== '-') {
          const currentRemarks = editRemarksInput.value.trim();
          const lastAutofill = editRemarksInput.dataset.autofillValue || '';
          if (!currentRemarks || currentRemarks === lastAutofill) {
            editRemarksInput.value = notesText;
            editRemarksInput.dataset.autofillValue = notesText;
          }
        }
      }
    });
  }

  // Bind UTC/Local time mode toggle (only when visible per policy)
  if (shouldShowNewFormTimeModeToggle()) {
    bindTimeModeToggle("editTimeModeToggle",
      ["editDepPlanned", "editArrPlanned", "editDepActual", "editArrActual"]);
  }

  // Bind bidirectional Duration ↔ planned-end sync
  // ARR mode: ETA (arrPlanned) is the calculation root; ETD (depPlanned) is derived.
  bindPlannedTimesSync("editDepPlanned", "editArrPlanned", "editDuration",
    { arrMode: m.flightType === 'ARR' });

  // Bind save handler with validation
  document.querySelector(".js-save-edit")?.addEventListener("click", () => {
    // Get form values
    const dof = document.getElementById("editDOF")?.value || getTodayDateString();
    let depPlanned = document.getElementById("editDepPlanned")?.value || "";
    let depActual = document.getElementById("editDepActual")?.value || "";
    let arrPlanned = document.getElementById("editArrPlanned")?.value || "";
    let arrActual = document.getElementById("editArrActual")?.value || "";
    const pob = document.getElementById("editPob")?.value || "0";
    const tng = document.getElementById("editTng")?.value || "0";
    const callsignCode = document.getElementById("editCallsignCode")?.value || "";
    const flightNumber = document.getElementById("editFlightNumber")?.value || "";
    const callsign = callsignCode + flightNumber; // Combine for full callsign

    // Validate inputs
    const dofValidation = validateDate(dof);
    if (!dofValidation.valid) {
      showToast(dofValidation.error, 'error');
      return;
    }

    const depPlannedValidation = validateTime(depPlanned);
    const depActualValidation = validateTime(depActual);
    const arrPlannedValidation = validateTime(arrPlanned);
    const arrActualValidation = validateTime(arrActual);

    const validations = [
      { result: depPlannedValidation, label: "Planned departure time" },
      { result: depActualValidation, label: "Actual departure time" },
      { result: arrPlannedValidation, label: "Planned arrival time" },
      { result: arrActualValidation, label: "Actual arrival time" },
      { result: validateNumberRange(pob, 0, 999, "POB"), label: null },
      { result: validateNumberRange(tng, 0, 99, "T&G count"), label: null }
    ];

    for (const validation of validations) {
      if (!validation.result.valid) {
        const msg = validation.label ? `${validation.label}: ${validation.result.error}` : validation.result.error;
        showToast(msg, 'error');
        return;
      }
    }

    // Use normalized times if provided
    if (depPlannedValidation.normalized) {
      depPlanned = depPlannedValidation.normalized;
      document.getElementById("editDepPlanned").value = depPlanned;
    }
    if (depActualValidation.normalized) {
      depActual = depActualValidation.normalized;
      document.getElementById("editDepActual").value = depActual;
    }
    if (arrPlannedValidation.normalized) {
      arrPlanned = arrPlannedValidation.normalized;
      document.getElementById("editArrPlanned").value = arrPlanned;
    }
    if (arrActualValidation.normalized) {
      arrActual = arrActualValidation.normalized;
      document.getElementById("editArrActual").value = arrActual;
    }

    // Convert Local→UTC if currently in LOCAL display mode
    const _editSaveMode = (getConfig().timeInputMode || "UTC").toUpperCase();
    if (_editSaveMode === "LOCAL") {
      if (depPlanned) depPlanned = convertLocalToUTC(depPlanned);
      if (depActual)  depActual  = convertLocalToUTC(depActual);
      if (arrPlanned) arrPlanned = convertLocalToUTC(arrPlanned);
      if (arrActual)  arrActual  = convertLocalToUTC(arrActual);
    }

    // Check for past times and show warning
    if (depPlanned) {
      const depPastCheck = checkPastTime(depPlanned, dof);
      if (depPastCheck.isPast) showToast(depPastCheck.warning, 'warning');
    }
    if (depActual) {
      const depActualPastCheck = checkPastTime(depActual, dof);
      if (depActualPastCheck.isPast) showToast(depActualPastCheck.warning, 'warning');
    }
    if (arrPlanned) {
      const arrPastCheck = checkPastTime(arrPlanned, dof);
      if (arrPastCheck.isPast) showToast(arrPastCheck.warning, 'warning');
    }
    if (arrActual) {
      const arrActualPastCheck = checkPastTime(arrActual, dof);
      if (arrActualPastCheck.isPast) showToast(arrActualPastCheck.warning, 'warning');
    }

    // Validate callsign
    const editCallsignValidation = validateRequired(callsignCode, "Callsign Code");
    if (!editCallsignValidation.valid) { showToast(editCallsignValidation.error, 'error'); return; }

    // Validate EGOW Code
    const editEgowCode = document.getElementById("editEgowCode")?.value?.toUpperCase().trim() || "";
    const editValidEgowCodes = ["VC", "VM", "BC", "BM", "VCH", "VMH", "VNH"];
    if (!editEgowCode || !editValidEgowCodes.includes(editEgowCode)) {
      showToast("Valid EGOW Code is required", 'error');
      return;
    }
    if (editEgowCode === 'BM') {
      const unitCodeVal = (document.getElementById("editUnitCode")?.value || "").trim();
      if (!unitCodeVal) {
        showToast("EGOW Unit code is required for BM flights", 'error');
        return;
      }
    }

    // Get WTC based on aircraft type and flight type
    const aircraftType = document.getElementById("editType")?.value || "";
    const selectedFlightType = document.getElementById("editFlightType")?.value || flightType;
    const wtc = getWTC(aircraftType, selectedFlightType, getConfig().wtcSystem || "ICAO");

    // Get voice callsign for display
    const regValue = document.getElementById("editReg")?.value || "";
    const regData = lookupRegistration(regValue);
    const popularName = regData ? (regData['POPULAR NAME'] || "") : "";
    const voiceCallsign = getVoiceCallsignForDisplay(callsign, regValue);

    // Get departure and arrival location names
    const depAd = document.getElementById("editDepAd")?.value || "";
    const arrAd = document.getElementById("editArrAd")?.value || "";
    const depName = getLocationName(depAd);
    const arrName = getLocationName(arrAd);

    // Get new optional fields
    const editPriorityLetterRaw = document.getElementById("editPriorityLetter")?.value || "";
    const editPriorityLetterValue = editPriorityLetterRaw === "-" ? "" : editPriorityLetterRaw;
    const editRemarksValue = document.getElementById("editRwRemarks")?.value || "";
    const editWarningsValue = document.getElementById("editRwWarnings")?.value || "";
    const editOsCountValue = parseInt(document.getElementById("editOsCount")?.value || "0", 10);
    const editFisCountValue = parseInt(document.getElementById("editFisCount")?.value || "0", 10);
    const editSquawkValue = document.getElementById("editAtcSquawk")?.value || "";
    const editRouteValue = document.getElementById("editAtcRoute")?.value || "";
    const editClearanceValue = document.getElementById("editAtcClearance")?.value || "";

    // Auto-activate strip when ATD is entered for PLANNED DEP/LOC flights
    let newStatus = m.status;
    if (m.status === "PLANNED" && depActual && depActual.trim() !== "") {
      if (selectedFlightType === "DEP" || selectedFlightType === "LOC") {
        newStatus = "ACTIVE";
      }
    }

    // Update movement
    const editDurationRaw = parseInt(document.getElementById("editDuration")?.value || "", 10);
    const updates = {
      status: newStatus,
      callsignCode: callsign,
      callsignVoice: voiceCallsign,
      registration: regValue,
      type: aircraftType,
      popularName: popularName,
      wtc: wtc,
      flightType: selectedFlightType,
      rules: document.getElementById("editRules")?.value || "VFR",
      depAd: depAd,
      depName: depName,
      arrAd: arrAd,
      arrName: arrName,
      depPlanned: depPlanned,
      depActual: depActual,
      arrPlanned: arrPlanned,
      arrActual: arrActual,
      dof: dof,
      durationMinutes: Number.isFinite(editDurationRaw) && editDurationRaw > 0 ? editDurationRaw : null,
      tngCount: parseInt(tng, 10),
      pob: parseInt(pob, 10),
      osCount: editOsCountValue,
      fisCount: editFisCountValue,
      egowCode: document.getElementById("editEgowCode")?.value || "",
      unitCode: document.getElementById("editUnitCode")?.value || "",
      captain: document.getElementById("editCaptain")?.value || "",
      priorityLetter: editPriorityLetterValue,
      remarks: editRemarksValue,
      warnings: editWarningsValue,
      squawk: editSquawkValue,
      route: editRouteValue,
      clearance: editClearanceValue,
      depAdText: document.getElementById("editDepAdText")?.value?.trim() || "",
      arrAdText: document.getElementById("editArrAdText")?.value?.trim() || "",
      aircraftTypeText: document.getElementById("editAircraftTypeText")?.value?.trim() || "",
      outcomeStatus: document.getElementById("editOutcomeStatus")?.value || 'NORMAL',
      outcomeReason: document.getElementById("editOutcomeReason")?.value || "",
      actualDestinationAd: document.getElementById("editActualDestAd")?.value || "",
      actualDestinationText: document.getElementById("editActualDestText")?.value?.trim() || "",
      outcomeTime: document.getElementById("editOutcomeTime")?.value || "",
    };

    // Validate ZZZZ companion fields
    if (updates.depAd?.trim().toUpperCase() === 'ZZZZ' && !updates.depAdText) {
      showToast("Departure AD is ZZZZ — location name is required", 'error'); return;
    }
    if (updates.arrAd?.trim().toUpperCase() === 'ZZZZ' && !updates.arrAdText) {
      showToast("Arrival AD is ZZZZ — location name is required", 'error'); return;
    }
    if (updates.type?.trim().toUpperCase() === 'ZZZZ' && !updates.aircraftTypeText) {
      showToast("Aircraft Type is ZZZZ — aircraft description is required", 'error'); return;
    }
    if ((updates.actualDestinationAd || "").trim().toUpperCase() === 'ZZZZ' && !updates.actualDestinationText) {
      showToast("Actual Destination is ZZZZ — location name is required", 'error'); return;
    }

    // Validate and read formation
    const editFmBase = (document.getElementById("editCallsignCode")?.value?.trim() || "") +
                       (document.getElementById("editFlightNumber")?.value?.trim() || "");
    const editFm = readFormationFromModal(editFmBase, "editFormationCount", "editFormationElementsContainer");
    if (editFm?._error) { showToast(editFm.message, 'error'); return; }
    updates.formation = editFm;

    const savedMovement = updateMovement(m.id, updates);

    // If ATD was changed in the edit, propagate canonical timing recalculation
    if (savedMovement && updates.depActual !== undefined) {
      const timingPatch = recalculateTimingModel(savedMovement, 'depActual');
      const isWeak = timingPatch._weakPrediction;
      delete timingPatch._weakPrediction;
      if (Object.keys(timingPatch).length > 0 && !isWeak) updateMovement(m.id, timingPatch);
    }

    // Sync back to booking if this strip is linked
    onMovementUpdated(m);

    renderLiveBoard();
    renderHistoryBoard();
    renderCancelledSortiesLog();
    if (window.updateDailyStats) window.updateDailyStats();
    if (window.updateFisCounters) window.updateFisCounters();
    showToast("Movement updated successfully", 'success');

    // Close modal (also removes the document keydown handler to prevent leaks)
    closeActiveModal();
  });

  // Bind "Save & Complete" handler for edit modal
  document.querySelector(".js-save-complete-edit")?.addEventListener("click", () => {
    // Get current time for actual times if not set
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // Get form values
    const dof = document.getElementById("editDOF")?.value || getTodayDateString();
    let depPlanned = document.getElementById("editDepPlanned")?.value || "";
    let depActual = document.getElementById("editDepActual")?.value || "";
    let arrPlanned = document.getElementById("editArrPlanned")?.value || "";
    let arrActual = document.getElementById("editArrActual")?.value || "";
    const pob = document.getElementById("editPob")?.value || "0";
    const tng = document.getElementById("editTng")?.value || "0";
    const callsignCode = document.getElementById("editCallsignCode")?.value || "";
    const flightNumber = document.getElementById("editFlightNumber")?.value || "";
    const callsign = callsignCode + flightNumber;

    // Basic validation
    const callsignValidation = validateRequired(callsignCode, "Callsign Code");
    if (!callsignValidation.valid) {
      showToast(callsignValidation.error, 'error');
      return;
    }

    // Validate EGOW Code
    const egowCode = document.getElementById("editEgowCode")?.value?.toUpperCase().trim() || "";
    const validEgowCodes = ["VC", "VM", "BC", "BM", "VCH", "VMH", "VNH"];
    if (!egowCode || !validEgowCodes.includes(egowCode)) {
      showToast("Valid EGOW Code is required", 'error');
      return;
    }
    if (egowCode === 'BM') {
      const unitCodeVal = (document.getElementById("editUnitCode")?.value || "").trim();
      if (!unitCodeVal) {
        showToast("EGOW Unit code is required for BM flights", 'error');
        return;
      }
    }

    // Normalize times
    const depPlannedValidation = validateTime(depPlanned);
    if (depPlannedValidation.normalized) depPlanned = depPlannedValidation.normalized;
    const depActualValidation = validateTime(depActual);
    if (depActualValidation.normalized) depActual = depActualValidation.normalized;
    const arrPlannedValidation = validateTime(arrPlanned);
    if (arrPlannedValidation.normalized) arrPlanned = arrPlannedValidation.normalized;
    const arrActualValidation = validateTime(arrActual);
    if (arrActualValidation.normalized) arrActual = arrActualValidation.normalized;

    // Convert Local→UTC if in LOCAL display mode
    const _editCpMode = (getConfig().timeInputMode || "UTC").toUpperCase();
    if (_editCpMode === "LOCAL") {
      if (depPlanned) depPlanned = convertLocalToUTC(depPlanned);
      if (depActual)  depActual  = convertLocalToUTC(depActual);
      if (arrPlanned) arrPlanned = convertLocalToUTC(arrPlanned);
      if (arrActual)  arrActual  = convertLocalToUTC(arrActual);
    }

    // Read outcome fields — these govern whether actual times are required/invented
    const scOutcomeStatus     = document.getElementById("editOutcomeStatus")?.value || 'NORMAL';
    const scOutcomeReason     = document.getElementById("editOutcomeReason")?.value || "";
    const scActualDestAd      = document.getElementById("editActualDestAd")?.value || "";
    const scActualDestText    = document.getElementById("editActualDestText")?.value?.trim() || "";
    const scOutcomeTime       = document.getElementById("editOutcomeTime")?.value || "";
    const scDepAdText         = document.getElementById("editDepAdText")?.value?.trim() || "";
    const scArrAdText         = document.getElementById("editArrAdText")?.value?.trim() || "";
    const scAircraftTypeText  = document.getElementById("editAircraftTypeText")?.value?.trim() || "";

    // Abnormal closure rules — only fill in actual times for NORMAL outcome
    // DIVERTED / CHANGED / CANCELLED: do not fabricate EGOW arrival times
    const isAbnormal = scOutcomeStatus !== 'NORMAL';

    if (!isAbnormal) {
      // Normal completion: fill in actual times from plan or clock if not already set
      if (!depActual) depActual = depPlanned || currentTime;
      if (!arrActual) arrActual = arrPlanned || currentTime;
    }
    // For abnormal outcomes: leave depActual/arrActual as whatever was entered (may be blank)

    // Get VKB data
    const regValue = document.getElementById("editReg")?.value || "";
    const regData = lookupRegistration(regValue);
    const operator = regData ? (regData['OPERATOR'] || "") : "";
    const popularName = regData ? (regData['POPULAR NAME'] || "") : "";
    const voiceCallsign = getVoiceCallsignForDisplay(callsign, regValue);
    const aircraftType = document.getElementById("editType")?.value || "";
    const selectedFlightType = document.getElementById("editFlightType")?.value || m.flightType;
    const wtc = getWTC(aircraftType, selectedFlightType, getConfig().wtcSystem || "ICAO");
    const depAd = document.getElementById("editDepAd")?.value || "";
    const arrAd = document.getElementById("editArrAd")?.value || "";
    const depName = getLocationName(depAd);
    const arrName = getLocationName(arrAd);

    const editCpPriorityRaw = document.getElementById("editPriorityLetter")?.value || "";
    const editPriorityLetterValue = editCpPriorityRaw === "-" ? "" : editCpPriorityRaw;
    const editRemarksValue = document.getElementById("editRwRemarks")?.value || "";
    const editWarningsValue = document.getElementById("editRwWarnings")?.value || "";
    const editOsCountValue = parseInt(document.getElementById("editOsCount")?.value || "0", 10);
    const editFisCountValue = parseInt(document.getElementById("editFisCount")?.value || "0", 10);
    const editSquawkValue = document.getElementById("editAtcSquawk")?.value || "";
    const editRouteValue = document.getElementById("editAtcRoute")?.value || "";
    const editClearanceValue = document.getElementById("editAtcClearance")?.value || "";

    const saveCpDurationRaw = parseInt(document.getElementById("editDuration")?.value || "", 10);
    const updates = {
      status: "COMPLETED",
      callsignCode: callsign,
      callsignVoice: voiceCallsign,
      registration: regValue,
      operator: operator,
      type: aircraftType,
      popularName: popularName,
      wtc: wtc,
      flightType: selectedFlightType,
      rules: document.getElementById("editRules")?.value || "VFR",
      depAd: depAd,
      depName: depName,
      arrAd: arrAd,
      arrName: arrName,
      depPlanned: depPlanned,
      depActual: depActual,
      arrPlanned: arrPlanned,
      arrActual: arrActual,
      dof: dof,
      durationMinutes: Number.isFinite(saveCpDurationRaw) && saveCpDurationRaw > 0 ? saveCpDurationRaw : null,
      tngCount: parseInt(tng, 10),
      pob: parseInt(pob, 10),
      osCount: editOsCountValue,
      fisCount: editFisCountValue,
      egowCode: egowCode,
      unitCode: document.getElementById("editUnitCode")?.value || "",
      captain: document.getElementById("editCaptain")?.value || "",
      priorityLetter: editPriorityLetterValue,
      remarks: editRemarksValue,
      warnings: editWarningsValue,
      squawk: editSquawkValue,
      route: editRouteValue,
      clearance: editClearanceValue,
      depAdText: scDepAdText,
      arrAdText: scArrAdText,
      aircraftTypeText: scAircraftTypeText,
      outcomeStatus: scOutcomeStatus,
      outcomeReason: scOutcomeReason,
      actualDestinationAd: scActualDestAd,
      actualDestinationText: scActualDestText,
      outcomeTime: scOutcomeTime,
    };

    // ZZZZ companion validation
    if (updates.depAd?.trim().toUpperCase() === 'ZZZZ' && !updates.depAdText) {
      showToast("Departure AD is ZZZZ — location name is required", 'error'); return;
    }
    if (updates.arrAd?.trim().toUpperCase() === 'ZZZZ' && !updates.arrAdText) {
      showToast("Arrival AD is ZZZZ — location name is required", 'error'); return;
    }
    if (updates.type?.trim().toUpperCase() === 'ZZZZ' && !updates.aircraftTypeText) {
      showToast("Aircraft Type is ZZZZ — aircraft description is required", 'error'); return;
    }
    if ((scActualDestAd).trim().toUpperCase() === 'ZZZZ' && !scActualDestText) {
      showToast("Actual Destination is ZZZZ — location name is required", 'error'); return;
    }

    // Validate and read formation
    const saveCpFmBase = (document.getElementById("editCallsignCode")?.value?.trim() || "") +
                         (document.getElementById("editFlightNumber")?.value?.trim() || "");
    const saveCpFm = readFormationFromModal(saveCpFmBase, "editFormationCount", "editFormationElementsContainer");
    if (saveCpFm?._error) { showToast(saveCpFm.message, 'error'); return; }
    updates.formation = saveCpFm;

    updateMovement(m.id, updates);
    // Cascade formation elements on complete
    cascadeFormationStatus(m.id, "COMPLETED");
    renderLiveBoard();
    renderHistoryBoard();
    renderCancelledSortiesLog();
    if (window.updateDailyStats) window.updateDailyStats();
    if (window.updateFisCounters) window.updateFisCounters();
    const completionMsg = isAbnormal
      ? `Movement closed (${scOutcomeStatus})`
      : "Movement saved and completed";
    showToast(completionMsg, 'success');

    closeActiveModal();
  });
}

/**
 * Open duplicate modal - copy existing movement with pre-filled values
 * Creates new movement with PLANNED status
 */
function openDuplicateMovementModal(m) {
  const flightType = m.flightType || "DEP";

  // Calculate new ETD and ETA based on original strip's ETA/ATA
  // ETD = ETA/ATA + 10 minutes
  // ETA = ETD + 20 minutes
  let newETD = "";
  let newETA = "";

  const originalETA = m.arrActual || m.arrPlanned || "";
  if (originalETA) {
    newETD = addMinutesToTime(originalETA, 10);
    newETA = addMinutesToTime(newETD, 20);
  }

  openModal(`
    <div class="modal-header">
      <div>
        <div class="modal-title">Duplicate ${flightType} Flight</div>
        <div class="modal-subtitle">Creating copy of Movement ID: ${m.id}</div>
      </div>
      <div class="modal-header-buttons">
        <button class="btn btn-ghost js-minimize-modal" type="button" title="Minimize">−</button>
        <button class="btn btn-ghost js-close-modal" type="button" title="Close">✕</button>
      </div>
    </div>
    <div class="modal-body">
      <div class="modal-field">
        <label class="modal-label">Callsign</label>
        <input id="dupCallsign" class="modal-input" value="${escapeHtml(m.callsignCode || "")}" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Registration</label>
        <input id="dupReg" class="modal-input" value="${escapeHtml(m.registration || "")}" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Aircraft Type</label>
        <input id="dupType" class="modal-input" value="${escapeHtml(m.type || "")}" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Flight Type</label>
        <select id="dupFlightType" class="modal-select">
          <option ${flightType === "ARR" ? "selected" : ""}>ARR</option>
          <option ${flightType === "DEP" ? "selected" : ""}>DEP</option>
          <option ${flightType === "LOC" ? "selected" : ""}>LOC</option>
          <option ${flightType === "OVR" ? "selected" : ""}>OVR</option>
        </select>
      </div>
      <div class="modal-field">
        <label class="modal-label">Flight Rules</label>
        <select id="dupRules" class="modal-select">
          <option value="VFR" ${m.rules === "VFR" ? "selected" : ""}>VFR</option>
          <option value="IFR" ${m.rules === "IFR" ? "selected" : ""}>IFR</option>
          <option value="Y" ${m.rules === "Y" ? "selected" : ""}>Y (IFR to VFR)</option>
          <option value="Z" ${m.rules === "Z" ? "selected" : ""}>Z (VFR to IFR)</option>
          <option value="SVFR" ${m.rules === "SVFR" ? "selected" : ""}>SVFR</option>
        </select>
      </div>
      <div class="modal-field">
        <label class="modal-label">Departure AD</label>
        <input id="dupDepAd" class="modal-input" value="${escapeHtml(m.depAd || "")}" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Arrival AD</label>
        <input id="dupArrAd" class="modal-input" value="${escapeHtml(m.arrAd || "")}" />
      </div>
      <!-- Times: Row 0 DOF + UTC toggle (policy-gated) -->
      <div class="modal-section-grid" style="margin-top: 8px;">
        <div class="modal-field">
          <label class="modal-label">Date of Flight (DOF)</label>
          <input id="dupDOF" type="date" class="modal-input" value="${getTodayDateString()}" />
        </div>
        ${shouldShowNewFormTimeModeToggle() ? `<div class="modal-field">
          <label class="modal-label">Times shown in:</label>
          <button type="button" id="dupTimeModeToggle" class="btn btn-ghost" style="padding: 2px 10px; font-size: 12px; margin-top: 2px;">UTC</button>
        </div>` : ''}
      </div>
      <!-- Times: Rows 1–2: ETD|Duration|ETA / ATD|spacer|ATA -->
      <div class="modal-section-grid-3 modal-subgrid-gap">
        ${renderTimesGrid({
          etdId: "dupDepPlanned", etaId: "dupArrPlanned",
          atdId: "dupDepActual",  ataId: "dupArrActual",
          durationId: "dupDuration",
          etdLabel: flightType === "OVR" ? "EOFT" : "ETD",
          etaLabel: flightType === "OVR" ? "ELFT" : "ETA",
          atdLabel: flightType === "OVR" ? "AOFT" : "ATD",
          ataLabel: flightType === "OVR" ? "ALFT" : "ATA",
          etaDisabled: false,
          ataDisabled: false,
          etdVal: newETD, etaVal: newETA,
          durationVal: m.durationMinutes || ""
        })}
      </div>
      <div class="modal-field">
        <label class="modal-label">POB</label>
        <input id="dupPob" class="modal-input" type="number" value="${m.pob || 0}" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Touch &amp; Go count</label>
        <input id="dupTng" class="modal-input" type="number" value="${m.tngCount || 0}" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Remarks</label>
        <textarea id="dupRemarks" class="modal-textarea">${escapeHtml(m.remarks || "")}</textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost js-close-modal" type="button">Cancel</button>
      <button class="btn btn-primary js-save-dup" type="button">Create Duplicate</button>
    </div>
  `);

  // Bind type inference
  const regInput = document.getElementById("dupReg");
  const typeInput = document.getElementById("dupType");
  if (regInput && typeInput) {
    regInput.addEventListener("input", () => {
      const inferredType = inferTypeFromReg(regInput.value);
      if (inferredType) {
        typeInput.value = inferredType;
      }
    });
  }

  // Bind UTC/Local time mode toggle (only when visible per policy)
  if (shouldShowNewFormTimeModeToggle()) {
    bindTimeModeToggle("dupTimeModeToggle",
      ["dupDepPlanned", "dupArrPlanned", "dupDepActual", "dupArrActual"]);
  }

  // Bind bidirectional Duration ↔ planned-end sync
  // ARR mode: ETA (arrPlanned) is the calculation root; ETD (depPlanned) is derived.
  bindPlannedTimesSync("dupDepPlanned", "dupArrPlanned", "dupDuration",
    { arrMode: flightType === 'ARR' });

  // Bind save handler with validation
  document.querySelector(".js-save-dup")?.addEventListener("click", () => {
    // Get form values
    const dof = document.getElementById("dupDOF")?.value || getTodayDateString();
    let depPlanned = document.getElementById("dupDepPlanned")?.value || "";
    let arrPlanned = document.getElementById("dupArrPlanned")?.value || "";
    let depActual  = document.getElementById("dupDepActual")?.value  || "";
    let arrActual  = document.getElementById("dupArrActual")?.value  || "";
    const pob = document.getElementById("dupPob")?.value || "0";
    const tng = document.getElementById("dupTng")?.value || "0";
    const callsign = document.getElementById("dupCallsign")?.value || "";

    // Validate inputs
    const dofValidation = validateDate(dof);
    if (!dofValidation.valid) {
      showToast(dofValidation.error, 'error');
      return;
    }

    const depValidation = validateTime(depPlanned);
    if (!depValidation.valid) {
      showToast(`Departure time: ${depValidation.error}`, 'error');
      return;
    }
    if (depValidation.normalized) depPlanned = depValidation.normalized;

    const arrValidation = validateTime(arrPlanned);
    if (!arrValidation.valid) {
      showToast(`Arrival time: ${arrValidation.error}`, 'error');
      return;
    }
    if (arrValidation.normalized) arrPlanned = arrValidation.normalized;

    const depActualValidation = validateTime(depActual);
    if (!depActualValidation.valid) {
      showToast(`Actual departure time: ${depActualValidation.error}`, 'error');
      return;
    }
    if (depActualValidation.normalized) depActual = depActualValidation.normalized;

    const arrActualValidation = validateTime(arrActual);
    if (!arrActualValidation.valid) {
      showToast(`Actual arrival time: ${arrActualValidation.error}`, 'error');
      return;
    }
    if (arrActualValidation.normalized) arrActual = arrActualValidation.normalized;

    // Convert Local→UTC if in LOCAL display mode
    const _dupSaveMode = (getConfig().timeInputMode || "UTC").toUpperCase();
    if (_dupSaveMode === "LOCAL") {
      if (depPlanned) depPlanned = convertLocalToUTC(depPlanned);
      if (arrPlanned) arrPlanned = convertLocalToUTC(arrPlanned);
      if (depActual)  depActual  = convertLocalToUTC(depActual);
      if (arrActual)  arrActual  = convertLocalToUTC(arrActual);
    }

    const pobValidation = validateNumberRange(pob, 0, 999, "POB");
    if (!pobValidation.valid) {
      showToast(pobValidation.error, 'error');
      return;
    }

    const tngValidation = validateNumberRange(tng, 0, 99, "T&G count");
    if (!tngValidation.valid) {
      showToast(tngValidation.error, 'error');
      return;
    }

    const callsignValidation = validateRequired(callsign, "Callsign");
    if (!callsignValidation.valid) {
      showToast(callsignValidation.error, 'error');
      return;
    }

    // Get voice callsign for display (only if different from contraction/registration)
    const regValue = document.getElementById("dupReg")?.value || "";
    const regData = lookupRegistration(regValue);
    const popularName = regData ? (regData['POPULAR NAME'] || "") : "";
    const voiceCallsign = getVoiceCallsignForDisplay(callsign, regValue);

    // Get WTC based on aircraft type and flight type
    const aircraftType = document.getElementById("dupType")?.value || "";
    const selectedFlightType = document.getElementById("dupFlightType")?.value || flightType;
    const wtc = getWTC(aircraftType, selectedFlightType, getConfig().wtcSystem || "ICAO");

    // Get departure and arrival location names
    const depAd = document.getElementById("dupDepAd")?.value || "";
    const arrAd = document.getElementById("dupArrAd")?.value || "";
    const depName = getLocationName(depAd);
    const arrName = getLocationName(arrAd);

    // Get warnings and notes from registration
    const warnings = regData ? (regData['WARNINGS'] || "") : "";
    const notes = regData ? (regData['NOTES'] || "") : "";
    const operator = regData ? (regData['OPERATOR'] || "") : "";

    // Create movement - determine initial status based on whether time is past
    const initialStatus = determineInitialStatus(selectedFlightType, dof, depPlanned, arrPlanned);
    const dupDurationRaw = parseInt(document.getElementById("dupDuration")?.value || "", 10);
    let movement = {
      status: initialStatus,
      callsignCode: callsign,
      callsignLabel: m.callsignLabel || "",
      callsignVoice: voiceCallsign,
      registration: document.getElementById("dupReg")?.value || "",
      operator: operator || m.operator || "",
      type: aircraftType,
      popularName: popularName,
      wtc: wtc,
      depAd: depAd,
      depName: depName,
      arrAd: arrAd,
      arrName: arrName,
      depPlanned: depPlanned,
      depActual: depActual,
      arrPlanned: arrPlanned,
      arrActual: arrActual,
      dof: dof,
      durationMinutes: Number.isFinite(dupDurationRaw) && dupDurationRaw > 0 ? dupDurationRaw : null,
      rules: document.getElementById("dupRules")?.value || m.rules || "VFR",
      flightType: selectedFlightType,
      isLocal: (document.getElementById("dupFlightType")?.value || flightType) === "LOC",
      tngCount: parseInt(tng, 10),
      osCount: m.osCount || 0,
      fisCount: (document.getElementById("dupFlightType")?.value || m.flightType) === "OVR" ? 1 : 0,
      egowCode: m.egowCode || "",
      egowDesc: m.egowDesc || "",
      unitCode: m.unitCode || "",
      unitDesc: m.unitDesc || "",
      captain: m.captain || "",
      pob: parseInt(pob, 10),
      remarks: document.getElementById("dupRemarks")?.value || "",
      warnings: warnings || m.warnings || "",
      notes: notes || m.notes || "",
      squawk: m.squawk || "",
      route: m.route || "",
      clearance: m.clearance || "",
      // Copy formation structure but reset all elements to PLANNED with no actual times
      formation: m.formation && Array.isArray(m.formation.elements) && m.formation.elements.length > 0
        ? (() => {
            const resetElements = m.formation.elements.map(el => ({
              ...el,
              status: "PLANNED",
              depActual: "",
              arrActual: ""
            }));
            const { wtcCurrent, wtcMax } = computeFormationWTC(resetElements);
            return { ...m.formation, elements: resetElements, wtcCurrent, wtcMax };
          })()
        : null
    };

    // Enrich with auto-populated fields
    movement = enrichMovementData(movement);

    createMovement(movement);
    renderLiveBoard();
    renderHistoryBoard();
    if (window.updateDailyStats) window.updateDailyStats();
    if (window.updateFisCounters) window.updateFisCounters();
    showToast("Duplicate movement created successfully", 'success');

    // Close modal (also removes the document keydown handler to prevent leaks)
    closeActiveModal();
  });
}

/**
 * Open reciprocal strip creation - create ARR from DEP or DEP from ARR
 * Swaps aerodromes and calculates time based on config
 * @param {Object} m - Source movement
 * @param {string} targetType - "ARR" or "DEP"
 */
function openReciprocalStripModal(m, targetType) {
  const config = getConfig();
  const sourceFT = (m.flightType || "").toUpperCase();

  // Calculate the reciprocal time using configured offsets
  let newTime = "";
  if (sourceFT === "DEP" && targetType === "ARR") {
    const sourceTime = m.depActual || m.depPlanned || "";
    if (sourceTime) {
      newTime = addMinutesToTime(sourceTime, config.depToArrOffsetMinutes || 180);
    }
  } else if (sourceFT === "ARR" && targetType === "DEP") {
    const sourceTime = m.arrActual || m.arrPlanned || "";
    if (sourceTime) {
      newTime = addMinutesToTime(sourceTime, config.arrToDepOffsetMinutes || 30);
    }
  }

  // Swap aerodromes
  const newDepAd = m.arrAd || "";
  const newArrAd = m.depAd || "";

  // Split the combined callsign into code and flight-number parts
  const rawCallsign = m.callsignCode || "";
  const csMatch = rawCallsign.match(/^([A-Z]+)(\d+.*)?$/);
  const splitCallsignCode = csMatch ? csMatch[1] : rawCallsign;
  const splitFlightNumber = (csMatch && csMatch[2]) ? csMatch[2] : "";

  // Get WTC and normalise to the leading token expected by the WTC select
  const wtcRaw = getWTC(m.type || "", targetType, config.wtcSystem || "ICAO");
  const wtcToken = String(wtcRaw || "").trim().toUpperCase().match(/^[A-Z]+/)?.[0] || "";

  // Build prefill for the creation modal — no movement is created yet
  const prefill = {
    callsignCode: splitCallsignCode,
    flightNumber: splitFlightNumber,
    registration: m.registration || "",
    type:         m.type         || "",
    wtc:          wtcToken,
    rules:        m.rules        || "VFR",
    depAd:        newDepAd,
    arrAd:        newArrAd,
    dof:          getTodayDateString(),
    depPlanned:   targetType === "DEP" ? newTime : "",
    arrPlanned:   targetType === "ARR" ? newTime : "",
    pob:          m.pob || 0,
    captain:      m.captain || "",
    egowCode:     m.egowCode    || "",
    unitCode:     m.unitCode    || "",
    remarks:      `Reciprocal of ${rawCallsign} ${sourceFT}`,
  };

  // Open the standard creation modal pre-filled; strip is only persisted on Save
  openNewFlightModal(targetType, prefill);
}

/**
 * Round a Date to the nearest operational minute for Active-button stamping.
 * Rule: 00–29 seconds → round down (keep HH:MM); 30–59 seconds → round up (+1 min).
 * Returns HH:MM string (UTC wall-clock, matching the rest of the time model).
 */
function roundActiveStampToMinute(date) {
  const d = new Date(date.getTime());
  if (d.getSeconds() >= 30) {
    d.setMinutes(d.getMinutes() + 1);
  }
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Return the exact second-bearing timestamp for WTC timing logic.
 * Returns HH:MM:SS string (UTC wall-clock).
 * Stored separately from the rounded operational actual so WTC calculations
 * are not degraded by minute-level rounding.
 */
function getExactActiveTimestamp(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

/**
 * Transition a PLANNED movement to ACTIVE
 * Sets ATD/ACT to current time (rounded to nearest minute for operational display)
 * Retains exact second-bearing timestamp in depActualExact for WTC logic
 * Auto-updates DOF to today if flight was planned for future date
 */
function transitionToActive(id) {
  const now = new Date();
  const currentTime = roundActiveStampToMinute(now);   // operational rounded display
  const exactTime = getExactActiveTimestamp(now);       // exact WTC anchor

  // Get today's date in YYYY-MM-DD format
  const todayStr = getTodayDateString();

  // Get the movement to check its DOF and type
  const movement = getMovements().find(m => m.id === id);
  const ft = (movement?.flightType || '').toUpperCase();

  // ARR: status-only transition — do NOT fabricate ATD.
  // ATD for ARR is the departure time from the origin; it is unknown until
  // the operator explicitly enters it. Auto-activation (or even manual button
  // press) does not constitute evidence of an actual departure event.
  // DEP/LOC/OVR: stamp depActual = now only if not already present.
  // (Preserve manual ATD/ACT if the operator entered it before clicking Active.)
  // depActualExact stores the exact second-bearing timestamp alongside the rounded
  // operational actual so that WTC spacing logic is not degraded by rounding.
  const updates = { status: "ACTIVE" };
  if (ft !== 'ARR' && !(movement?.depActual && String(movement.depActual).trim())) {
    updates.depActual = currentTime;         // rounded to nearest minute for operational display
    updates.depActualExact = exactTime;      // exact HH:MM:SS for WTC timing anchor
  }

  // If DOF is in the future, update it to today
  if (movement && movement.dof && movement.dof > todayStr) {
    updates.dof = todayStr;
    showToast(`Flight activated early - DOF updated from ${movement.dof.split('-').reverse().join('/')} to today`, 'info');
  }

  const updatedMovement = updateMovement(id, updates);

  // Canonical timing model: after ATD is set, recalculate ETA = ATD + Duration.
  // For ARR: ATD was not set above, so this patch is a no-op; included for
  // completeness in case depActual was already present before activation.
  if (updatedMovement && ft !== 'ARR') {
    const timingPatch = recalculateTimingModel(updatedMovement, 'depActual');
    const isWeak = timingPatch._weakPrediction;
    delete timingPatch._weakPrediction;
    if (Object.keys(timingPatch).length > 0 && !isWeak) {
      updateMovement(id, timingPatch);
    }
  }

  renderLiveBoard();
  renderHistoryBoard();
  if (window.updateDailyStats) window.updateDailyStats();
}

/**
 * Returns the field name for the completion-side actual time owned by each movement type.
 *
 * LOC: arrActual (ATA — wheels-stop at destination)
 * ARR: arrActual (ATA — wheels-stop at aerodrome)
 * OVR: arrActual (ALFT — actual leave-frequency time)
 * DEP: null      (DEP completion carries no arrival-side actual concept)
 *
 * This is the only field that Complete may stamp, and only when it is absent.
 * Keeping the mapping here makes it easy to extend if a future type ever diverges.
 */
function completionActualField(ft) {
  switch ((ft || '').toUpperCase()) {
    case 'LOC':
    case 'ARR':
    case 'OVR': return 'arrActual';
    default:    return null; // DEP: no completion-side actual
  }
}

/**
 * Returns true when the completion-side actual for a movement is genuinely absent.
 *
 * Estimated/planned times (arrPlanned / ELFT) are never treated as actuals.
 * Both system-stamped actuals and manually-entered actuals are treated as "present"
 * and will cause this function to return false, protecting them from overwrite.
 *
 * Complete may only stamp the time returned by completionActualField() when this
 * function returns true.
 */
function completionActualIsAbsent(movement) {
  const field = completionActualField((movement?.flightType || '').toUpperCase());
  if (!field) return false; // DEP: never stamp
  const val = movement?.[field];
  return !(val && String(val).trim());
}

/**
 * Transition an ACTIVE movement to COMPLETED.
 *
 * Completion-side actual stamping rule (applies to all types):
 *   Stamp the completion-side actual (see completionActualField) only when it is
 *   genuinely absent at completion time.
 *
 *   Preserved in all cases:
 *     - system-stamped actuals (e.g. ATD set by Activate)
 *     - manually-entered or manually-edited actuals
 *
 *   Never substituted:
 *     - estimated times (arrPlanned) — these are not actuals
 *
 *   DEP:  no completion-side actual is ever generated.
 *   ARR:  arrActual (ATA) stamped only if absent. ATD is never fabricated here.
 *   LOC:  arrActual (ATA) stamped only if absent. depActual (ATD) is not modified.
 *   OVR:  arrActual (ALFT) stamped only if absent.
 */
function transitionToCompleted(id) {
  const now = new Date();
  const currentTime = roundActiveStampToMinute(now); // nearest-minute rule: <30s rounds down, ≥30s rounds up

  const movement = getMovements().find(m => m.id === id);
  const completionUpdates = { status: "COMPLETED" };

  // Stamp the completion-side actual only when genuinely absent.
  // Existing actuals — whether system-stamped or operator-entered — are preserved unchanged.
  // Estimated times (arrPlanned) are never substituted as completion actuals.
  if (completionActualIsAbsent(movement)) {
    const field = completionActualField((movement?.flightType || '').toUpperCase());
    if (field) completionUpdates[field] = currentTime;
  }

  updateMovement(id, completionUpdates);
  // Cascade formation elements to COMPLETED
  cascadeFormationStatus(id, "COMPLETED");

  // Sync booking status
  onMovementStatusChanged(movement, 'COMPLETED');

  renderLiveBoard();
  renderHistoryBoard();
  if (window.updateDailyStats) window.updateDailyStats();
}

/**
 * Reason codes for cancellation (Ticket 6).
 * Stored as the code; displayed as the label.
 */
const CANCELLATION_REASON_CODES = [
  { code: "",      label: "— no reason —" },
  { code: "OPS",   label: "OPS — operational / tasking change" },
  { code: "WX",    label: "WX — weather" },
  { code: "TECH",  label: "TECH — aircraft technical / engineering" },
  { code: "ATC",   label: "ATC — ATC / airfield / slot / airspace" },
  { code: "ADMIN", label: "ADMIN — paperwork / authorisation / admin" },
  { code: "CREW",  label: "CREW — crew / staffing" },
  { code: "OTHER", label: "OTHER — other" },
];

/**
 * Return display label for a stored reason code.
 * @param {string} code
 * @returns {string}
 */
function cancellationReasonLabel(code) {
  if (!code) return '';
  const entry = CANCELLATION_REASON_CODES.find(r => r.code === code);
  return entry ? entry.label : code;
}

/**
 * Transition a movement to CANCELLED.
 * Opens a modal to optionally capture a reason code and note,
 * writes one immutable cancelled-sortie log entry, then applies
 * the existing cancel behaviour (status → CANCELLED, booking sync).
 */
function transitionToCancelled(id) {
  const movement = getMovements().find(m => m.id === id);
  if (!movement) return;

  const callsign = movement.callsignCode || 'this flight';
  const ft = (movement.flightType || '').toUpperCase();
  const route = [movement.depAd, movement.arrAd].filter(Boolean).join(' → ') || '—';
  const reg = movement.registration || '—';

  const optionsHtml = CANCELLATION_REASON_CODES.map(r =>
    `<option value="${escapeHtml(r.code)}">${escapeHtml(r.label)}</option>`
  ).join('');

  openModal(`
    <div class="modal-header">
      <div class="modal-title">Cancel Strip — ${escapeHtml(callsign)}</div>
      <div class="modal-header-buttons">
        <button class="btn btn-ghost js-minimize-modal" type="button">−</button>
        <button class="btn btn-ghost js-close-modal" type="button">✕</button>
      </div>
    </div>
    <div class="modal-body">
      <div class="cancel-sortie-identity">
        <span class="badge badge-type">${escapeHtml(ft)}</span>
        <span class="cancel-sortie-callsign">${escapeHtml(callsign)}</span>
        <span class="cancel-sortie-detail">${escapeHtml(reg)} · ${escapeHtml(route)}</span>
      </div>
      <p class="cancel-sortie-warning">This will remove the strip from the Live Board and mark the flight as cancelled.</p>
      <div class="form-group">
        <label class="control-label" for="cancelReasonCode">Reason (optional)</label>
        <select id="cancelReasonCode" class="field field-select">
          ${optionsHtml}
        </select>
      </div>
      <div class="form-group">
        <label class="control-label" for="cancelReasonNote">Note (optional)</label>
        <textarea id="cancelReasonNote" class="field field-textarea" rows="2" maxlength="300" placeholder="Free text note…"></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-danger js-confirm-cancel" type="button">Confirm Cancel</button>
      <button class="btn btn-secondary js-close-modal" type="button">Back</button>
    </div>
  `);

  const root = byId("modalRoot");
  const confirmBtn = root && root.querySelector(".js-confirm-cancel");

  safeOn(confirmBtn, "click", () => {
    const reasonCode = (root.querySelector("#cancelReasonCode") || {}).value || '';
    const reasonNote = ((root.querySelector("#cancelReasonNote") || {}).value || '').trim();

    // Take immutable snapshot of movement as it exists at cancellation time.
    const snapshot = JSON.parse(JSON.stringify(movement));

    const logEntry = {
      id: `cancel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sourceMovementId: movement.id,
      cancelledAt: new Date().toISOString(),
      cancellationReasonCode: reasonCode,
      cancellationReasonText: reasonNote,
      snapshot,
      bookingSnapshot: movement.bookingId ? { bookingId: movement.bookingId } : null,
      createdFromVersion: 1,
    };

    appendCancelledSortie(logEntry);

    // Existing cancel behaviour — unchanged.
    updateMovement(id, { status: "CANCELLED" });
    cascadeFormationStatus(id, "CANCELLED");
    onMovementStatusChanged(movement, 'CANCELLED');

    closeActiveModal();

    showToast(`${callsign} cancelled`, 'info');
    renderLiveBoard();
    renderHistoryBoard();
    renderCancelledSortiesLog();
    if (window.updateDailyStats) window.updateDailyStats();
  });
}

/**
 * Soft-delete a strip: move it to the Deleted Strips retention store.
 * Strip disappears from ordinary operational views immediately.
 * Recoverable via Deleted Strips tab until retention window expires (24 h).
 *
 * Booking linkage: if the strip was linked to a booking, the booking's
 * linkedStripId is cleared (booking is not automatically restored on strip
 * restore — operator re-links if needed).
 */
function performDeleteStrip(movement) {
  if (!movement) return;

  const callsign = movement.callsignCode || 'this flight';
  if (!confirm(`Delete strip ${callsign} (#${movement.id})?\nThe strip will be held in Deleted Strips for ${DELETED_STRIPS_RETENTION_HOURS} hours and can be restored before expiry.`)) {
    return;
  }

  const deletedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + DELETED_STRIPS_RETENTION_HOURS * 60 * 60 * 1000).toISOString();

  // Build deleted-strip log entry with full snapshot
  const logEntry = {
    id: `del_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    sourceMovementId: movement.id,
    deletedAt,
    expiresAt,
    snapshot: JSON.parse(JSON.stringify(movement)),
  };

  appendDeletedStrip(logEntry);

  // Clear booking's linkedStripId if present
  if (movement.bookingId) {
    const booking = getBookingById(movement.bookingId);
    if (booking && booking.linkedStripId === movement.id) {
      updateBookingById(movement.bookingId, { linkedStripId: null });
    }
  }

  // Remove from active movements store
  deleteMovement(movement.id);

  showToast(`${callsign} moved to Deleted Strips (recoverable for ${DELETED_STRIPS_RETENTION_HOURS}h)`, 'info');
  renderLiveBoard();
  renderHistoryBoard();
  renderCancelledSortiesLog(); // update if a CANCELLED strip was deleted
  renderDeletedStripsLog();
  if (window.updateDailyStats) window.updateDailyStats();
  if (window.updateFisCounters) window.updateFisCounters();
}

/* -----------------------------
   Live Board init
------------------------------ */

/**
 * Initialise Live Board event listeners and initial render.
 * Supports both the current HTML IDs and legacy ones (for safety).
 */
/**
 * Initialize Live Board event listeners and render
 */
export function initLiveBoard() {
  // Expose openEditMovementModal globally so calendar can invoke it
  window.openEditMovementModal = openEditMovementModal;

  // Elements
  const globalSearch = firstById(["globalSearch", "searchGlobal"]);
  const statusFilter = byId("statusFilter");
  const plannedWindowSelect = byId("plannedWindowHours");
  const btnNewLoc = document.getElementById("btnNewLoc");
  const btnNewDep = document.getElementById("btnNewDep");
  const btnNewArr = document.getElementById("btnNewArr");
  const btnNewOvr = document.getElementById("btnNewOvr");

  // Global search filter with debounce (150ms delay)
  const debouncedSearch = debounce((value) => {
    state.globalFilter = value;
    renderLiveBoard();
  }, 150);

  safeOn(globalSearch, "input", (e) => {
    debouncedSearch(e.target.value);
  });

  // Status filter
  safeOn(statusFilter, "change", () => renderLiveBoard());

  // Planned window filter
  safeOn(plannedWindowSelect, "change", (e) => {
    state.plannedWindowHours = parseInt(e.target.value, 10);
    renderLiveBoard();
  });

  // New movement buttons
  safeOn(btnNewLoc, "click", openNewLocFlightModal);
  safeOn(btnNewDep, "click", () => openNewFlightModal("DEP"));
  safeOn(btnNewArr, "click", () => openNewFlightModal("ARR"));
  safeOn(btnNewOvr, "click", () => openNewFlightModal("OVR"));

  // Delegated: formation element "Save" buttons in expanded rows
  // Handles both Live Board and History panel (both rendered inside document)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".fmn-el-save");
    if (!btn) return;
    const mvId = parseInt(btn.dataset.mvId, 10);
    const elIdx = parseInt(btn.dataset.elIdx, 10);
    const row = btn.closest("tr");
    if (!row) return;

    const statusSel  = row.querySelector(".fmn-el-select");
    const depAdInputs = row.querySelectorAll(".fmn-el-ad");  // [0] = depAd, [1] = arrAd
    const depInput   = row.querySelector(".fmn-el-dep");
    const arrInput   = row.querySelector(".fmn-el-arr");

    // Validate and build patch
    const rawStatus = statusSel?.value || "PLANNED";
    const rawDepAd  = (depAdInputs[0]?.value || "").toUpperCase().trim();
    const rawArrAd  = (depAdInputs[1]?.value || "").toUpperCase().trim();

    // Validate WTC from element (already in storage; not re-entered here)
    // Validate depAd/arrAd
    if (!isValidIcaoAd(rawDepAd)) {
      showToast(`Dep AD "${rawDepAd}" must be empty or a 4-character ICAO code.`, 'error');
      return;
    }
    if (!isValidIcaoAd(rawArrAd)) {
      showToast(`Arr AD "${rawArrAd}" must be empty or a 4-character ICAO code.`, 'error');
      return;
    }

    const patch = { status: rawStatus, depAd: rawDepAd, arrAd: rawArrAd };

    if (depInput?.value?.trim()) {
      const vd = validateTime(depInput.value.trim());
      patch.depActual = vd.valid ? (vd.normalized || depInput.value.trim()) : "";
    } else {
      patch.depActual = "";
    }
    if (arrInput?.value?.trim()) {
      const va = validateTime(arrInput.value.trim());
      patch.arrActual = va.valid ? (va.normalized || arrInput.value.trim()) : "";
    } else {
      patch.arrActual = "";
    }

    const updated = updateFormationElement(mvId, elIdx, patch);
    if (!updated) {
      showToast("Element update failed — movement not found", "error");
      return;
    }
    renderLiveBoard();
    renderHistoryBoard();
    if (window.updateDailyStats) window.updateDailyStats();
    showToast(`Element ${elIdx + 1} updated`, "success");
  });

  // Re-render when booking data changes (avoids importing ui_booking).
  // Defer if an inline editor is open — apply once editor closes.
  window.addEventListener("fdms:data-changed", () => {
    if (window.__FDMS_DIAGNOSTICS__ && window.__fdmsDiag) window.__fdmsDiag.dataChangedReceived++;
    if (_isInlineEditingActive()) {
      _pendingRerenderWhileInline = true;
      return;
    }
    renderLiveBoard();
    if (typeof renderTimeline === 'function') renderTimeline();
    if (typeof renderTimelineTracks === 'function') renderTimelineTracks();
  });

  renderLiveBoard();

  // Periodic auto-activation check every 60 seconds
  // This ensures movements are auto-activated even without user interaction
  setInterval(() => {
    autoActivatePlannedMovements();
  }, 60000);
}

/* -----------------------------
   Stubs for other panels (kept for app.js imports)
   If you already have implementations elsewhere in your file, keep those instead.
------------------------------ */

/* -----------------------------
   History Board
------------------------------ */

let historySortColumn = 'time';
let historySortDirection = 'desc'; // desc = most recent first

/**
 * Sort history movements by specified column
 * @param {Array} movements - Array of movements
 * @param {string} column - Column to sort by
 * @param {string} direction - 'asc' or 'desc'
 * @returns {Array} Sorted movements
 */
function sortHistoryMovements(movements, column, direction) {
  return movements.slice().sort((a, b) => {
    let valA, valB;

    switch (column) {
      case 'callsign':
        valA = (a.callsignCode || '').toLowerCase();
        valB = (b.callsignCode || '').toLowerCase();
        break;
      case 'regtype':
        valA = `${a.registration || ''} ${a.type || ''}`.toLowerCase();
        valB = `${b.registration || ''} ${b.type || ''}`.toLowerCase();
        break;
      case 'route':
        valA = `${a.depAd || ''} ${a.arrAd || ''}`.toLowerCase();
        valB = `${b.depAd || ''} ${b.arrAd || ''}`.toLowerCase();
        break;
      case 'time':
        // Sort by DOF first, then by completion time
        const dofA = getDOFTimestamp(a);
        const dofB = getDOFTimestamp(b);
        if (dofA !== dofB) return direction === 'asc' ? dofA - dofB : dofB - dofA;

        // Use actual times for completed movements
        valA = timeToMinutes(getATA(a) || getATD(a) || getACT(a) || getETA(a) || getETD(a) || getECT(a));
        valB = timeToMinutes(getATA(b) || getATD(b) || getACT(b) || getETA(b) || getETD(b) || getECT(b));
        break;
      case 'activity':
        valA = (a.flightType || '').toLowerCase();
        valB = (b.flightType || '').toLowerCase();
        break;
      case 'status':
        valA = (a.status || '').toLowerCase();
        valB = (b.status || '').toLowerCase();
        break;
      default:
        return 0;
    }

    if (valA === valB) return 0;
    const comparison = valA < valB ? -1 : 1;
    return direction === 'asc' ? comparison : -comparison;
  });
}

/**
 * Render the History Board table
 * Shows COMPLETED and CANCELLED movements
 */
export function renderHistoryBoard() {
  if (window.__FDMS_DIAGNOSTICS__ && window.__fdmsDiag) window.__fdmsDiag.renderHistoryBoardCount++;
  const tbody = byId("historyBody");
  if (!tbody) return;

  closeDropdownPortal();                                // restore any portalled menu before wiping DOM
  tbody.innerHTML = "";

  // Get time period filter
  const periodSelect = byId("historyTimePeriod");
  const period = periodSelect ? periodSelect.value : "24h";

  // Calculate cutoff time for filtering
  const now = new Date();
  let cutoffTime = null;

  if (period === "today") {
    // Today only - start of current day
    cutoffTime = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (period === "24h") {
    cutoffTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  } else if (period === "48h") {
    cutoffTime = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  } else if (period === "7d") {
    cutoffTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  // "all" means no filter

  // Get completed movements only (Ticket 6a: CANCELLED moved to dedicated Cancelled Sorties subpage)
  let movements = getMovements().filter(m => m.status === "COMPLETED");

  // Apply time period filter
  if (cutoffTime) {
    movements = movements.filter(m => {
      // Parse DOF and completion time
      const dofParts = (m.dof || "").split("-");
      if (dofParts.length !== 3) return false;

      // Get completion time (ATD for DEP, ATA for ARR, ACT for OVR)
      const ft = (m.flightType || "").toUpperCase();
      let completionTime = "";
      if (ft === "DEP") {
        completionTime = m.depActual || m.depPlanned || "";
      } else if (ft === "ARR") {
        completionTime = m.arrActual || m.arrPlanned || "";
      } else if (ft === "LOC") {
        completionTime = m.depActual || m.arrActual || m.depPlanned || m.arrPlanned || "";
      } else if (ft === "OVR") {
        completionTime = m.depActual || m.depPlanned || "";
      }

      if (!completionTime) return false;

      // Parse time
      const timeParts = completionTime.split(":");
      if (timeParts.length !== 2) return false;

      // Create date object from DOF + completion time
      const movementDate = new Date(
        parseInt(dofParts[0], 10),
        parseInt(dofParts[1], 10) - 1,
        parseInt(dofParts[2], 10),
        parseInt(timeParts[0], 10),
        parseInt(timeParts[1], 10)
      );

      return movementDate >= cutoffTime;
    });
  }

  // Sort movements
  const sorted = sortHistoryMovements(movements, historySortColumn, historySortDirection);

  if (sorted.length === 0) {
    const empty = document.createElement("tr");
    empty.innerHTML = `
      <td colspan="8" style="padding:8px; font-size:12px; color:#777;">
        No completed movements in this period.
      </td>
    `;
    tbody.appendChild(empty);
    return;
  }

  for (const m of sorted) {
    const tr = document.createElement("tr");
    // Add cancelled-strip class for brown background on cancelled movements
    const cancelledClass = m.status === 'CANCELLED' ? ' cancelled-strip' : '';
    tr.className = `strip strip-row ${flightTypeClass(m.flightType)}${cancelledClass}`;

    // Sidebar always uses EGOW indicator color (even for cancelled - so we can see who it was for)
    const indicatorColor = getEgowIndicatorColor(m.egowCode, m.unitCode);
    const indicatorTitle = `${m.egowCode || ''}${m.unitCode ? ' - ' + m.unitCode : ''}`;

    // Calculate times display
    const ft = (m.flightType || "").toUpperCase();
    let depDisplay = "-";
    let arrDisplay = "-";

    if (ft === "DEP" || ft === "LOC") {
      depDisplay = getATD(m) || getETD(m) || "-";
    }
    if (ft === "ARR" || ft === "LOC") {
      arrDisplay = getATA(m) || getETA(m) || "-";
    }
    if (ft === "OVR") {
      depDisplay = getACT(m) || getECT(m) || "-";
      // arr-side: ALFT (arrActual) or ELFT (arrPlanned)
      const alft = m.arrActual && String(m.arrActual).trim() ? String(m.arrActual).trim() : null;
      const elft = m.arrPlanned && String(m.arrPlanned).trim() ? String(m.arrPlanned).trim() : null;
      arrDisplay = alft || elft || "-";
    }

    tr.dataset.id = String(m.id);

    tr.innerHTML = `
      <td><div class="status-strip" style="background-color: ${indicatorColor};" title="${escapeHtml(indicatorTitle)}"></div></td>
      <td>
        <div class="call-main">${escapeHtml(m.callsignCode)}</div>
        <div class="call-sub">${m.callsignVoice ? escapeHtml(m.callsignVoice) : "&nbsp;"}</div>
      </td>
      <td>
        <div class="cell-strong">${escapeHtml(m.registration || "—")}${m.type ? ` · <span title="${escapeHtml(m.popularName || '')}">${escapeHtml(m.type)}</span>` : ""}</div>
        <div class="cell-muted">WTC: ${escapeHtml(m.wtc || "—")}</div>
      </td>
      <td>
        <div class="cell-strong"><span${m.depName && m.depName !== '' ? ` title="${m.depName}"` : ''}>${escapeHtml(m.depAd)}</span></div>
        <div class="cell-strong"><span${m.arrName && m.arrName !== '' ? ` title="${m.arrName}"` : ''}>${escapeHtml(m.arrAd)}</span></div>
      </td>
      <td>
        <div class="cell-strong">${escapeHtml(depDisplay)} / ${escapeHtml(arrDisplay)}</div>
        <div class="cell-muted">${m.dof ? escapeHtml(m.dof) : "—"}</div>
      </td>
      <td>
        <div class="badge-row">
          ${renderBadges(m)}
        </div>
      </td>
      <td>
        <span class="badge ${m.status === 'COMPLETED' ? 'badge-success' : 'badge-cancelled'}">${escapeHtml(statusLabel(m.status))}</span>
      </td>
      <td class="actions-cell">
        <div style="display: flex; flex-direction: column; gap: 2px; align-items: flex-end;">
          <div style="position: relative; display: inline-block; z-index: 1;">
            <button class="small-btn js-history-edit-dropdown" type="button" aria-label="Edit menu">Edit ▾</button>
            <div class="js-history-edit-menu" style="display: none; position: absolute; right: 0; top: 100%; background: white; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); z-index: 9999; min-width: 120px; margin-top: 2px;">
              <button class="js-history-edit-details" type="button" style="display: block; width: 100%; padding: 8px 12px; border: none; background: none; text-align: left; cursor: pointer; font-size: 14px; white-space: nowrap;" onmouseover="this.style.backgroundColor='#f0f0f0'" onmouseout="this.style.backgroundColor='transparent'">View/Edit</button>
              <button class="js-history-duplicate" type="button" style="display: block; width: 100%; padding: 8px 12px; border: none; background: none; text-align: left; cursor: pointer; font-size: 14px; white-space: nowrap;" onmouseover="this.style.backgroundColor='#f0f0f0'" onmouseout="this.style.backgroundColor='transparent'">Duplicate</button>
              <button class="js-history-delete-strip" type="button" style="display: block; width: 100%; padding: 8px 12px; border: none; background: none; text-align: left; cursor: pointer; font-size: 14px; color: #dc3545; font-weight: 600; white-space: nowrap; border-top: 1px solid #eee;" onmouseover="this.style.backgroundColor='#f0f0f0'" onmouseout="this.style.backgroundColor='transparent'">Delete</button>
            </div>
          </div>
          <button class="small-btn js-history-toggle-details" type="button" aria-label="Toggle details">Info ▾</button>
        </div>
      </td>
    `;

    // Bind History Edit dropdown toggle (portal-based – escapes overflow)
    const editDropdownBtn = tr.querySelector(".js-history-edit-dropdown");
    const editMenu = tr.querySelector(".js-history-edit-menu");
    safeOn(editDropdownBtn, "click", (e) => {
      e.stopPropagation();
      if (_portalMenu === editMenu) {
        closeDropdownPortal();
      } else {
        openDropdownPortal(editMenu, editDropdownBtn);
      }
    });

    // Bind View/Edit button (opens edit modal)
    const editDetailsBtn = tr.querySelector(".js-history-edit-details");
    safeOn(editDetailsBtn, "click", (e) => {
      e.stopPropagation();
      closeDropdownPortal();
      openEditMovementModal(m);
    });

    // Bind Duplicate button
    const duplicateBtn = tr.querySelector(".js-history-duplicate");
    safeOn(duplicateBtn, "click", (e) => {
      e.stopPropagation();
      closeDropdownPortal();
      openDuplicateMovementModal(m);
    });

    // Bind Delete option (hard delete) in History
    const histDeleteBtn = tr.querySelector(".js-history-delete-strip");
    safeOn(histDeleteBtn, "click", (e) => {
      e.stopPropagation();
      closeDropdownPortal();
      performDeleteStrip(m);
    });

    // Bind Info toggle (similar to Live Board)
    const toggleDetailsBtn = tr.querySelector(".js-history-toggle-details");
    safeOn(toggleDetailsBtn, "click", (e) => {
      e.stopPropagation();
      historyExpandedId = historyExpandedId === m.id ? null : m.id;
      renderHistoryBoard();
    });

    tbody.appendChild(tr);

    // Render expanded row if this movement is expanded
    if (historyExpandedId === m.id) {
      renderExpandedRow(tbody, m, 'history');
    }
  }
}

/**
 * Initialize History board sorting
 */
export function initHistoryBoard() {
  const historyTable = byId("historyTable");
  if (!historyTable) return;

  // Bind time period filter
  const periodSelect = byId("historyTimePeriod");
  if (periodSelect) {
    periodSelect.addEventListener("change", () => {
      renderHistoryBoard();
    });
  }

  // Bind sort headers
  const headers = historyTable.querySelectorAll("thead th[data-sort]");
  headers.forEach(header => {
    header.style.cursor = "pointer";
    header.addEventListener("click", () => {
      const column = header.dataset.sort;

      // Toggle direction if clicking same column
      if (historySortColumn === column) {
        historySortDirection = historySortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        historySortColumn = column;
        historySortDirection = 'desc'; // Default to descending for new column
      }

      // Update visual indicators
      headers.forEach(h => {
        h.textContent = h.textContent.replace(/ ▲| ▼/g, '');
      });
      const indicator = historySortDirection === 'asc' ? ' ▲' : ' ▼';
      header.textContent = header.textContent + indicator;

      renderHistoryBoard();
    });
  });

  renderHistoryBoard();
}

/* ----------------------------------------
   Cancelled Sorties Log viewer (Ticket 6 / 6a)
   Dedicated subpage: sort, filter, export
---------------------------------------- */

/** Currently expanded cancelled-sortie row id (for snapshot detail toggle) */
let _cancelLogExpandedId = null;

/** Active sort column for cancelled sorties table */
let _cancelLogSortColumn = 'cancelledAt';
/** Active sort direction for cancelled sorties table */
let _cancelLogSortDirection = 'desc';
/** Active text filter for cancelled sorties table */
let _cancelLogFilter = '';

/** Currently expanded deleted-strip row id (for detail toggle) */
let _deletedStripsExpandedId = null;

/**
 * Sort a cancelled sorties entries array by the given column.
 * @param {Array} entries
 * @param {string} col
 * @param {'asc'|'desc'} dir
 * @returns {Array}
 */
function sortCancelledSorties(entries, col, dir) {
  return entries.slice().sort((a, b) => {
    const sa = a.snapshot || {};
    const sb = b.snapshot || {};
    let va = '', vb = '';
    switch (col) {
      case 'cancelledAt': va = a.cancelledAt || ''; vb = b.cancelledAt || ''; break;
      case 'callsign':    va = (sa.callsignCode || '').toLowerCase(); vb = (sb.callsignCode || '').toLowerCase(); break;
      case 'flightType':  va = (sa.flightType || '').toUpperCase(); vb = (sb.flightType || '').toUpperCase(); break;
      case 'reg':         va = (sa.registration || '').toLowerCase(); vb = (sb.registration || '').toLowerCase(); break;
      case 'type':        va = (sa.type || '').toLowerCase(); vb = (sb.type || '').toLowerCase(); break;
      case 'depAd':       va = (sa.depAd || '').toLowerCase(); vb = (sb.depAd || '').toLowerCase(); break;
      case 'arrAd':       va = (sa.arrAd || '').toLowerCase(); vb = (sb.arrAd || '').toLowerCase(); break;
      case 'reason':      va = (a.cancellationReasonCode || '').toLowerCase(); vb = (b.cancellationReasonCode || '').toLowerCase(); break;
      default:            va = a.cancelledAt || ''; vb = b.cancelledAt || '';
    }
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return dir === 'asc' ? cmp : -cmp;
  });
}

/* -------------------------------------------------------------------
   Reinstatement helpers (Ticket 6a.2)
------------------------------------------------------------------- */

/** Convert HH:MM string to minutes of day. Returns null if invalid. */
function _hhmm_to_mins(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const parts = hhmm.split(':');
  if (parts.length !== 2) return null;
  const h = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

/** Return current local time plus offsetMinutes as HH:MM. */
function _now_plus_minutes(offsetMinutes) {
  const d = new Date();
  d.setMinutes(d.getMinutes() + (offsetMinutes || 0));
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

/**
 * Compute reinstated planned start-side time.
 * Rule: max(originalPlanned, now + offsetMinutes)
 *  — if now+offset is still before originalPlanned → keep originalPlanned
 *  — otherwise (within or past window) → use now+offset
 * Confirmed examples (DEP offset +10):
 *   reinstated 1045, ETD 1100 → 1055 < 1100 → keep 1100
 *   reinstated 1055, ETD 1100 → 1105 > 1100 → use 1105
 *   reinstated 1127, ETD 1100 → 1137 > 1100 → use 1137
 */
function _computeReinstateStartTime(originalPlanned, offsetMinutes) {
  const nowPlusOffset = _now_plus_minutes(offsetMinutes);
  const origMins = _hhmm_to_mins(originalPlanned);
  const nowPlusMins = _hhmm_to_mins(nowPlusOffset);
  if (origMins !== null && nowPlusMins !== null && nowPlusMins < origMins) {
    return originalPlanned;
  }
  return nowPlusOffset;
}

/**
 * Reinstate a cancelled strip back to the flying programme.
 *
 * Target status: PLANNED.
 * Planned start-side time recalculated per offset-aware rule (type-specific).
 * All other strip details preserved.
 * Formation elements that are currently CANCELLED are cascaded back to PLANNED.
 * Log entry is marked reinstated=true (audit retained; excluded from current-state view).
 *
 * OVR offset note: uses config.ovrOffsetMinutes (default 0) with depPlanned (EOFT).
 * Booking status is NOT automatically restored — booking remains at its
 * current state; operator manages booking record separately.
 *
 * @param {Object} entry - cancelled sortie log entry
 */
function reinstateFromCancelledLog(entry) {
  const allMovements = getMovements();
  const m = allMovements.find(mv => mv.id === entry.sourceMovementId);
  if (!m) {
    showToast("Cannot reinstate — source strip no longer exists", 'error');
    return;
  }

  const cfg = getConfig();
  const ft = (m.flightType || '').toUpperCase();
  const snap = entry.snapshot || {};

  // Determine type-specific offset and original planned start-side field.
  // Original is taken from the snapshot (immutable pre-cancellation state).
  let offsetMinutes;
  let originalPlanned;
  let startFieldLabel;

  if (ft === 'DEP') {
    offsetMinutes = cfg.depOffsetMinutes ?? 10;
    originalPlanned = snap.depPlanned || null;
    startFieldLabel = 'ETD';
  } else if (ft === 'ARR') {
    offsetMinutes = cfg.arrOffsetMinutes ?? 90;
    originalPlanned = snap.arrPlanned || null;
    startFieldLabel = 'ETA';
  } else if (ft === 'LOC') {
    offsetMinutes = cfg.locOffsetMinutes ?? 10;
    originalPlanned = snap.depPlanned || null;
    startFieldLabel = 'ETD';
  } else if (ft === 'OVR') {
    // OVR: depPlanned = EOFT (start of frequency time). Uses ovrOffsetMinutes (default 0).
    offsetMinutes = cfg.ovrOffsetMinutes ?? 0;
    originalPlanned = snap.depPlanned || null;
    startFieldLabel = 'EOFT';
  } else {
    offsetMinutes = 10;
    originalPlanned = snap.depPlanned || null;
    startFieldLabel = 'ETD';
  }

  const newStartTime = originalPlanned
    ? _computeReinstateStartTime(originalPlanned, offsetMinutes)
    : _now_plus_minutes(offsetMinutes);

  // Build patch: status → PLANNED, update planned start-side field only.
  const patch = { status: 'PLANNED' };
  if (ft === 'ARR') {
    patch.arrPlanned = newStartTime;
  } else {
    patch.depPlanned = newStartTime;
  }

  // Cascade formation elements: restore any CANCELLED elements back to PLANNED.
  if (m.formation && Array.isArray(m.formation.elements) && m.formation.elements.length > 0) {
    patch.formation = {
      ...m.formation,
      elements: m.formation.elements.map(el =>
        el.status === 'CANCELLED' ? { ...el, status: 'PLANNED' } : el
      )
    };
  }

  updateMovement(m.id, patch);

  // Recalculate end-side derived time, but only when no actuals are present
  // (pure PLANNED state). If actuals exist, preserve them; operator edits if needed.
  const hasActuals = !!(m.depActual || m.arrActual);
  if (!hasActuals) {
    const freshM = getMovements().find(mv => mv.id === m.id);
    if (freshM) {
      const changedField = ft === 'ARR' ? 'arrPlanned' : 'depPlanned';
      const timingPatch = recalculateTimingModel(freshM, changedField);
      if (Object.keys(timingPatch).length > 0 && !timingPatch._weakPrediction) {
        const { _weakPrediction, ...cleanPatch } = timingPatch; // eslint-disable-line no-unused-vars
        updateMovement(m.id, cleanPatch);
      }
    }
  }

  // Mark log entry as reinstated (mutable top-level; snapshot untouched).
  const list = getCancelledSorties();
  const idx = list.findIndex(e => e.id === entry.id);
  if (idx >= 0) {
    list[idx].reinstated = true;
    list[idx].reinstatedAt = new Date().toISOString();
    list[idx].reinstatedNewStartTime = newStartTime;
    saveCancelledSorties(list);
  }

  renderLiveBoard();
  renderHistoryBoard();
  renderCancelledSortiesLog();
  if (window.updateDailyStats) window.updateDailyStats();

  const callsignLabel = m.callsignCode || ft;
  showToast(`${callsignLabel} reinstated to PLANNED (${startFieldLabel}: ${newStartTime})`, 'success');
}

/**
 * Update the mutable cancellation reason/note on a log entry.
 * Does NOT touch the immutable snapshot field.
 * @param {string} entryId
 * @param {string} reasonCode
 * @param {string} reasonText
 */
function updateCancelledSortieReason(entryId, reasonCode, reasonText) {
  const list = getCancelledSorties();
  const idx = list.findIndex(e => e.id === entryId);
  if (idx < 0) return;
  list[idx].cancellationReasonCode = reasonCode;
  list[idx].cancellationReasonText = reasonText;
  saveCancelledSorties(list);
}

/**
 * Open a focused modal to edit the cancellation reason/note on a log entry.
 * Updates the mutable top-level fields on the entry; snapshot remains immutable.
 * @param {Object} entry - cancelled sortie log entry
 */
function openEditCancellationReasonModal(entry) {
  const s = entry.snapshot || {};
  const callsign = escapeHtml(s.callsignCode || '—');

  const optionsHtml = CANCELLATION_REASON_CODES.map(r =>
    `<option value="${escapeHtml(r.code)}" ${entry.cancellationReasonCode === r.code ? 'selected' : ''}>${escapeHtml(r.label)}</option>`
  ).join('');

  openModal(`
    <div class="modal-header">
      <div class="modal-title">Edit Cancellation Reason — ${callsign}</div>
      <div class="modal-header-buttons">
        <button class="btn btn-ghost js-minimize-modal" type="button">−</button>
        <button class="btn btn-ghost js-close-modal" type="button">✕</button>
      </div>
    </div>
    <div class="modal-body">
      <p style="font-size:12px; color:#666; margin:0 0 12px;">
        Updates the current-state cancellation reason for this log entry.
        The original strip snapshot at the moment of cancellation is preserved separately.
      </p>
      <div class="form-group">
        <label class="control-label" for="editCancelReasonCode">Reason</label>
        <select id="editCancelReasonCode" class="field field-select">
          ${optionsHtml}
        </select>
      </div>
      <div class="form-group">
        <label class="control-label" for="editCancelReasonNote">Note</label>
        <textarea id="editCancelReasonNote" class="field field-textarea" rows="3" maxlength="300" placeholder="Free text note…">${escapeHtml(entry.cancellationReasonText || '')}</textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary js-save-cancel-reason" type="button">Save Reason</button>
      <button class="btn btn-secondary js-close-modal" type="button">Cancel</button>
    </div>
  `);

  const root = byId("modalRoot");
  const saveBtn = root && root.querySelector(".js-save-cancel-reason");

  safeOn(saveBtn, "click", () => {
    const newCode = (root.querySelector("#editCancelReasonCode") || {}).value || '';
    const newText = ((root.querySelector("#editCancelReasonNote") || {}).value || '').trim();
    updateCancelledSortieReason(entry.id, newCode, newText);
    closeActiveModal();
    renderCancelledSortiesLog();
    showToast("Cancellation reason updated", 'success');
  });
}

/**
 * Render the Cancelled Sorties Log table.
 * Applies current sort, direction, and text filter.
 * Row display fields use the current movement record where available;
 * falls back to the immutable snapshot when the source movement is gone.
 * The snapshot section in the expanded detail always shows historical state.
 */
export function renderCancelledSortiesLog() {
  const tbody = byId("cancelledSortiesBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  let entries = getCancelledSorties();
  // Fetch current movements once for O(n) display resolution
  const allMovements = getMovements();

  // Current-state filter — two steps:
  //
  // Step 1: Exclude reinstated entries. Reinstated entries are audit records
  // only; the strip is no longer cancelled from an operational standpoint.
  const reinstatedCount = entries.filter(e => e.reinstated).length;
  entries = entries.filter(e => !e.reinstated);

  // Step 2: Exclude entries whose source movement no longer exists in the
  // active movements store OR whose current status is not CANCELLED.
  // Cancelled Sorties is a CURRENT-STATE view — a row belongs here only if
  // the underlying movement currently exists with status CANCELLED.
  // Soft-deleted strips are no longer in getMovements() and belong exclusively
  // in Deleted Strips until retention expiry. Snapshot-only orphan rows must
  // not appear here.
  const notCurrentlyCancelledCount = entries.filter(e => {
    const m = allMovements.find(mv => mv.id === e.sourceMovementId);
    return !m || m.status !== 'CANCELLED';
  }).length;
  entries = entries.filter(e => {
    const m = allMovements.find(mv => mv.id === e.sourceMovementId);
    return m && m.status === 'CANCELLED';
  });

  const archivedCount = reinstatedCount + notCurrentlyCancelledCount;

  // Apply text filter — searches current movement fields and snapshot
  const filterTerm = _cancelLogFilter.trim().toLowerCase();
  if (filterTerm) {
    entries = entries.filter(e => {
      const s = e.snapshot || {};
      const cur = allMovements.find(m => m.id === e.sourceMovementId);
      const d = cur || s;
      return (
        (d.callsignCode || s.callsignCode || '').toLowerCase().includes(filterTerm) ||
        (d.registration || s.registration || '').toLowerCase().includes(filterTerm) ||
        (d.type || s.type || '').toLowerCase().includes(filterTerm) ||
        (d.depAd || s.depAd || '').toLowerCase().includes(filterTerm) ||
        (d.arrAd || s.arrAd || '').toLowerCase().includes(filterTerm) ||
        (e.cancellationReasonCode || '').toLowerCase().includes(filterTerm) ||
        cancellationReasonLabel(e.cancellationReasonCode).toLowerCase().includes(filterTerm) ||
        (e.cancellationReasonText || '').toLowerCase().includes(filterTerm)
      );
    });
  }

  // Apply sort
  const sorted = sortCancelledSorties(entries, _cancelLogSortColumn, _cancelLogSortDirection);

  // Update sort indicators on thead
  const table = byId("cancelledSortiesTable");
  if (table) {
    table.querySelectorAll("thead th[data-sort]").forEach(th => {
      th.textContent = th.textContent.replace(/ ▲| ▼/g, '');
      if (th.dataset.sort === _cancelLogSortColumn) {
        th.textContent += _cancelLogSortDirection === 'asc' ? ' ▲' : ' ▼';
      }
    });
  }

  if (sorted.length === 0) {
    const empty = document.createElement("tr");
    empty.innerHTML = `
      <td colspan="11" style="padding:8px; font-size:12px; color:#777;">
        ${filterTerm ? 'No cancelled sorties match this filter.' : 'No currently-cancelled sorties.'}
        ${!filterTerm && archivedCount > 0 ? `<span style="color:#999;"> (${archivedCount} archived log ${archivedCount === 1 ? 'entry' : 'entries'} — reinstated or deleted)</span>` : ''}
      </td>
    `;
    tbody.appendChild(empty);
    return;
  }

  const menuItemStyle = 'display: block; width: 100%; padding: 8px 12px; border: none; background: none; text-align: left; cursor: pointer; font-size: 14px; white-space: nowrap;';
  const menuItemHover = 'onmouseover="this.style.backgroundColor=\'#f0f0f0\'" onmouseout="this.style.backgroundColor=\'transparent\'"';

  for (const entry of sorted) {
    const s = entry.snapshot || {};
    // currentMovement is guaranteed non-null by the current-state filter above.
    const currentMovement = allMovements.find(m => m.id === entry.sourceMovementId);
    const d = currentMovement;

    const ft = escapeHtml((d.flightType || '').toUpperCase());
    const callsign = escapeHtml(d.callsignCode || '—');
    const reg = escapeHtml(d.registration || '—');
    const acType = escapeHtml(d.type || '—');
    const depAd = escapeHtml(d.depAd || '—');
    const arrAd = escapeHtml(d.arrAd || '—');
    // statusAtCancel always from snapshot — it records the status AT the moment of cancellation
    const statusAtCancel = escapeHtml(s.status || '—');
    // Reason/note from log entry (current-state, mutable)
    const reasonCode = escapeHtml(entry.cancellationReasonCode || '');
    const reasonLabel = escapeHtml(cancellationReasonLabel(entry.cancellationReasonCode));
    const notePreview = escapeHtml((entry.cancellationReasonText || '').slice(0, 60));
    const cancelledAt = entry.cancelledAt ? escapeHtml(entry.cancelledAt.replace('T', ' ').slice(0, 16)) + 'Z' : '—';

    const isExpanded = _cancelLogExpandedId === entry.id;

    const tr = document.createElement("tr");
    tr.className = "cancelled-log-row";
    tr.dataset.id = entry.id;

    tr.innerHTML = `
      <td><span class="badge badge-type">${ft}</span></td>
      <td style="font-size:11px; white-space:nowrap;">${cancelledAt}</td>
      <td>${callsign}</td>
      <td><span style="font-size:12px;">${reg}</span></td>
      <td><span style="font-size:12px;">${acType}</span></td>
      <td>${depAd}</td>
      <td>${arrAd}</td>
      <td><span class="badge badge-cancelled" style="font-size:10px;">${statusAtCancel}</span></td>
      <td>${reasonCode ? `<span class="badge badge-reason" title="${reasonLabel}">${reasonCode}</span>` : '<span style="color:#999;font-size:11px;">—</span>'}</td>
      <td style="font-size:11px; color:#666; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(entry.cancellationReasonText || '')}">${notePreview || '<span style="color:#bbb;">—</span>'}</td>
      <td>
        <div style="display:flex; flex-direction:column; gap:2px; align-items:flex-end;">
          <div style="position:relative; display:inline-block; z-index:1;">
            <button class="small-btn js-cancel-log-edit-dropdown" type="button" aria-label="Edit menu">Edit ▾</button>
            <div class="js-cancel-log-edit-menu" style="display:none; position:absolute; right:0; top:100%; background:#fff; border:1px solid #ccc; border-radius:4px; box-shadow:0 2px 8px rgba(0,0,0,0.15); z-index:9999; min-width:130px; margin-top:2px;">
              <button class="js-cancel-log-edit-strip" type="button" style="${menuItemStyle}" ${menuItemHover}>Edit Strip</button>
              <button class="js-cancel-log-edit-reason" type="button" style="${menuItemStyle}" ${menuItemHover}>Edit Reason</button>
              <button class="js-cancel-log-reinstate" type="button" style="${menuItemStyle} color:#2a7a2a;" ${menuItemHover}>Reinstate ↩</button>
              <button class="js-cancel-log-delete" type="button" style="${menuItemStyle} color:#a00;" ${menuItemHover}>Delete</button>
            </div>
          </div>
          <button class="small-btn js-cancel-log-toggle" type="button" aria-label="Toggle detail">${isExpanded ? 'Hide ▲' : 'Detail ▾'}</button>
        </div>
      </td>
    `;

    // Edit ▾ dropdown (portal-based to escape overflow)
    const editDropdownBtn = tr.querySelector(".js-cancel-log-edit-dropdown");
    const editMenu = tr.querySelector(".js-cancel-log-edit-menu");
    safeOn(editDropdownBtn, "click", (e) => {
      e.stopPropagation();
      if (_portalMenu === editMenu) {
        closeDropdownPortal();
      } else {
        openDropdownPortal(editMenu, editDropdownBtn);
      }
    });

    // Edit Strip
    const editStripBtn = tr.querySelector(".js-cancel-log-edit-strip");
    safeOn(editStripBtn, "click", (e) => {
      e.stopPropagation();
      closeDropdownPortal();
      if (currentMovement) openEditMovementModal(currentMovement);
    });

    // Edit Reason
    const editReasonBtn = tr.querySelector(".js-cancel-log-edit-reason");
    safeOn(editReasonBtn, "click", (e) => {
      e.stopPropagation();
      closeDropdownPortal();
      openEditCancellationReasonModal(entry);
    });

    // Reinstate
    const reinstateBtn = tr.querySelector(".js-cancel-log-reinstate");
    safeOn(reinstateBtn, "click", (e) => {
      e.stopPropagation();
      closeDropdownPortal();
      reinstateFromCancelledLog(entry);
    });

    // Delete — routes through the same soft-delete retention pathway as all other deletes
    const cancelLogDeleteBtn = tr.querySelector(".js-cancel-log-delete");
    safeOn(cancelLogDeleteBtn, "click", (e) => {
      e.stopPropagation();
      closeDropdownPortal();
      performDeleteStrip(currentMovement);
    });

    // Detail toggle
    const toggleBtn = tr.querySelector(".js-cancel-log-toggle");
    safeOn(toggleBtn, "click", () => {
      _cancelLogExpandedId = isExpanded ? null : entry.id;
      renderCancelledSortiesLog();
    });

    tbody.appendChild(tr);

    if (isExpanded) {
      const detailTr = document.createElement("tr");
      detailTr.className = "cancelled-log-detail-row";
      const snap = entry.snapshot || {};
      const note = escapeHtml(entry.cancellationReasonText || '');
      const bookingId = entry.bookingSnapshot ? escapeHtml(String(entry.bookingSnapshot.bookingId)) : '—';

      // Current strip state section (only when source movement still exists)
      const currentSection = currentMovement ? `
        <div class="cancelled-log-detail-section">
          <strong>Current strip state</strong>
          <div>Callsign: ${escapeHtml(currentMovement.callsignCode || '—')} / ${escapeHtml(currentMovement.callsignVoice || '—')}</div>
          <div>Reg: ${escapeHtml(currentMovement.registration || '—')} · Type: ${escapeHtml(currentMovement.type || '—')} · WTC: ${escapeHtml(currentMovement.wtc || '—')}</div>
          <div>Route: ${escapeHtml(currentMovement.depAd || '—')} → ${escapeHtml(currentMovement.arrAd || '—')}</div>
          <div>DOF: ${escapeHtml(currentMovement.dof || '—')} · Rules: ${escapeHtml(currentMovement.rules || '—')}</div>
          <div>ETD: ${escapeHtml(currentMovement.depPlanned || '—')} · ATD: ${escapeHtml(currentMovement.depActual || '—')} · ETA: ${escapeHtml(currentMovement.arrPlanned || '—')} · ATA: ${escapeHtml(currentMovement.arrActual || '—')}</div>
          <div>Remarks: ${escapeHtml(currentMovement.remarks || '—')}</div>
        </div>` : `
        <div class="cancelled-log-detail-section" style="color:#999;">
          <strong>Current strip state</strong>
          <div><em>Source strip no longer exists (hard deleted)</em></div>
        </div>`;

      detailTr.innerHTML = `
        <td colspan="11" class="cancelled-log-detail-cell">
          <div class="cancelled-log-detail">
            <div class="cancelled-log-detail-section">
              <strong>Cancellation record</strong>
              <div>Logged at: ${escapeHtml(entry.cancelledAt || '—')}</div>
              <div>Reason: ${reasonCode ? `${reasonCode} — ${reasonLabel}` : '<em>none</em>'}</div>
              <div>Note: ${note || '<em>none</em>'}</div>
              <div>Booking ID at cancel: ${bookingId}</div>
            </div>
            ${currentSection}
            <div class="cancelled-log-detail-section">
              <strong>Snapshot at cancellation</strong>
              <div style="font-size:10px; color:#999; margin-bottom:3px;">Historical record — not edited</div>
              <div>Callsign: ${escapeHtml(snap.callsignCode || '—')} / ${escapeHtml(snap.callsignVoice || '—')}</div>
              <div>Reg: ${escapeHtml(snap.registration || '—')} · Type: ${escapeHtml(snap.type || '—')} · WTC: ${escapeHtml(snap.wtc || '—')}</div>
              <div>Route: ${escapeHtml(snap.depAd || '—')} → ${escapeHtml(snap.arrAd || '—')}</div>
              <div>DOF: ${escapeHtml(snap.dof || '—')} · Rules: ${escapeHtml(snap.rules || '—')}</div>
              <div>ETD: ${escapeHtml(snap.depPlanned || '—')} · ATD: ${escapeHtml(snap.depActual || '—')} · ETA: ${escapeHtml(snap.arrPlanned || '—')} · ATA: ${escapeHtml(snap.arrActual || '—')}</div>
              <div>Status at cancel: ${escapeHtml(snap.status || '—')}</div>
              <div>Remarks: ${escapeHtml(snap.remarks || '—')}</div>
            </div>
          </div>
        </td>
      `;
      tbody.appendChild(detailTr);
    }
  }
}

/**
 * Export the cancelled sorties log to CSV.
 * Includes full audit fields plus a practical snapshot subset.
 */
function exportCancelledSortiesCSV() {
  const entries = getCancelledSorties();

  if (entries.length === 0) {
    showToast("No cancelled sorties to export", 'warning');
    return;
  }

  const escapeCSV = (value) => {
    const str = String(value ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headers = [
    "Log ID",
    "Source Movement ID",
    "Cancelled At (UTC)",
    "Reason Code",
    "Reason Text",
    "Booking ID at Cancel",
    "Reinstated",
    "Reinstated At (UTC)",
    "Reinstated New Start Time",
    "Flight Type",
    "Callsign",
    "Registration",
    "A/C Type",
    "WTC",
    "Dep AD",
    "Arr AD",
    "DOF",
    "Rules",
    "ETD",
    "ATD",
    "ETA",
    "ATA",
    "Status at Cancel",
    "EGOW Code",
    "Unit Code",
    "POB",
    "Remarks"
  ];

  const rows = entries.map(e => {
    const s = e.snapshot || {};
    return [
      e.id || '',
      e.sourceMovementId ?? '',
      e.cancelledAt || '',
      e.cancellationReasonCode || '',
      e.cancellationReasonText || '',
      e.bookingSnapshot ? (e.bookingSnapshot.bookingId ?? '') : '',
      e.reinstated ? 'YES' : 'NO',
      e.reinstatedAt || '',
      e.reinstatedNewStartTime || '',
      s.flightType || '',
      s.callsignCode || '',
      s.registration || '',
      s.type || '',
      s.wtc || '',
      s.depAd || '',
      s.arrAd || '',
      s.dof || '',
      s.rules || '',
      s.depPlanned || '',
      s.depActual || '',
      s.arrPlanned || '',
      s.arrActual || '',
      s.status || '',
      s.egowCode || '',
      s.unitCode || '',
      s.pob ?? '',
      s.remarks || ''
    ];
  });

  const csv = [
    headers.join(','),
    ...rows.map(row => row.map(escapeCSV).join(','))
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fdms-cancelled-sorties-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  showToast(`Exported ${entries.length} cancelled sorties to CSV`, 'success');
}

/**
 * Initialise the Cancelled Sorties Log page.
 * Wires sort headers, text filter, and export button.
 * Called from app.js boot sequence.
 */
export function initCancelledSortiesLog() {
  ensureCancelledSortiesInitialised();

  // Wire sort headers
  const table = byId("cancelledSortiesTable");
  if (table) {
    table.querySelectorAll("thead th[data-sort]").forEach(th => {
      th.style.cursor = "pointer";
      th.addEventListener("click", () => {
        const col = th.dataset.sort;
        if (_cancelLogSortColumn === col) {
          _cancelLogSortDirection = _cancelLogSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          _cancelLogSortColumn = col;
          _cancelLogSortDirection = col === 'cancelledAt' ? 'desc' : 'asc';
        }
        renderCancelledSortiesLog();
      });
    });
  }

  // Wire text filter input
  const filterInput = byId("cancelledSortiesFilter");
  if (filterInput) {
    filterInput.addEventListener("input", () => {
      _cancelLogFilter = filterInput.value;
      _cancelLogExpandedId = null; // collapse any open row on filter change
      renderCancelledSortiesLog();
    });
  }

  // Wire export button
  const exportBtn = byId("btnExportCancelledCsv");
  if (exportBtn) {
    exportBtn.addEventListener("click", exportCancelledSortiesCSV);
  }

  renderCancelledSortiesLog();
}

/* ----------------------------------------
   Deleted Strips Log (Ticket 6a.3)
   Soft-delete retention store UI
---------------------------------------- */

/**
 * Format a remaining-time string from now until expiresAt.
 * Returns "Xh Ym" if future, "Expired" if past.
 */
function _formatExpiresIn(expiresAt) {
  if (!expiresAt) return 'Expired';
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (diffMs <= 0) return 'Expired';
  const diffMins = Math.floor(diffMs / 60000);
  const h = Math.floor(diffMins / 60);
  const m = diffMins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Restore a soft-deleted strip from the retention store.
 *
 * Target status by original snapshot status:
 *   PLANNED / ACTIVE → PLANNED with offset-aware start-side time recalculation
 *   CANCELLED        → CANCELLED (reappears in Cancelled Sorties current-state view)
 *   COMPLETED        → COMPLETED (reappears in Movement History)
 *
 * Booking re-linkage: NOT automatic. bookingId is preserved in the restored
 * movement so the operator can see it, but the booking's linkedStripId is not
 * automatically re-set (it was cleared on deletion). Operator re-links manually
 * or via next reconciliation cycle if desired.
 */
function restoreDeletedStrip(entry) {
  if (!entry || !entry.snapshot) {
    showToast("Cannot restore — entry is missing snapshot", 'error');
    return;
  }

  const now = Date.now();
  if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= now) {
    showToast("Cannot restore — retention window has expired", 'error');
    return;
  }

  const snap = entry.snapshot;
  const ft = (snap.flightType || '').toUpperCase();
  const originalStatus = (snap.status || '').toUpperCase();

  // Build the movement to restore
  let restoredSnapshot = JSON.parse(JSON.stringify(snap));

  if (originalStatus === 'PLANNED' || originalStatus === 'ACTIVE') {
    // Restore to PLANNED with offset-aware start-side time recalculation
    restoredSnapshot.status = 'PLANNED';
    const cfg = getConfig();
    let offsetMinutes, originalPlanned, startFieldLabel;

    if (ft === 'DEP') {
      offsetMinutes = cfg.depOffsetMinutes ?? 10;
      originalPlanned = snap.depPlanned || null;
      startFieldLabel = 'ETD';
    } else if (ft === 'ARR') {
      offsetMinutes = cfg.arrOffsetMinutes ?? 90;
      originalPlanned = snap.arrPlanned || null;
      startFieldLabel = 'ETA';
    } else if (ft === 'LOC') {
      offsetMinutes = cfg.locOffsetMinutes ?? 10;
      originalPlanned = snap.depPlanned || null;
      startFieldLabel = 'ETD';
    } else if (ft === 'OVR') {
      offsetMinutes = cfg.ovrOffsetMinutes ?? 0;
      originalPlanned = snap.depPlanned || null;
      startFieldLabel = 'EOFT';
    } else {
      offsetMinutes = 10;
      originalPlanned = snap.depPlanned || null;
      startFieldLabel = 'ETD';
    }

    const newStartTime = originalPlanned
      ? _computeReinstateStartTime(originalPlanned, offsetMinutes)
      : _now_plus_minutes(offsetMinutes);

    if (ft === 'ARR') {
      restoredSnapshot.arrPlanned = newStartTime;
    } else {
      restoredSnapshot.depPlanned = newStartTime;
    }

    const ok = insertRestoredMovement(restoredSnapshot);
    if (!ok) {
      showToast("Cannot restore — movement ID conflict (already in use)", 'error');
      return;
    }

    // Recalculate end-side derived time for pure PLANNED state (no actuals)
    const hasActuals = !!(snap.depActual || snap.arrActual);
    if (!hasActuals) {
      const freshM = getMovements().find(mv => mv.id === restoredSnapshot.id);
      if (freshM) {
        const changedField = ft === 'ARR' ? 'arrPlanned' : 'depPlanned';
        const timingPatch = recalculateTimingModel(freshM, changedField);
        if (Object.keys(timingPatch).length > 0 && !timingPatch._weakPrediction) {
          const { _weakPrediction, ...cleanPatch } = timingPatch; // eslint-disable-line no-unused-vars
          updateMovement(restoredSnapshot.id, cleanPatch);
        }
      }
    }

    showToast(`${snap.callsignCode || ft} restored to PLANNED (${startFieldLabel}: ${newStartTime})`, 'success');
  } else {
    // CANCELLED, COMPLETED, or other — restore with original status intact
    const ok = insertRestoredMovement(restoredSnapshot);
    if (!ok) {
      showToast("Cannot restore — movement ID conflict (already in use)", 'error');
      return;
    }
    showToast(`${snap.callsignCode || ft} restored (status: ${originalStatus})`, 'success');
  }

  // Remove from deleted strips store
  const list = getDeletedStrips();
  saveDeletedStrips(list.filter(e => e.id !== entry.id));

  renderLiveBoard();
  renderHistoryBoard();
  renderCancelledSortiesLog();
  renderDeletedStripsLog();
  if (window.updateDailyStats) window.updateDailyStats();
}

/**
 * Render the Deleted Strips retention table.
 * Purges expired entries first, then renders remaining live entries.
 */
export function renderDeletedStripsLog() {
  const tbody = byId("deletedStripsBody");
  if (!tbody) return;

  // Purge expired entries before rendering
  purgeExpiredDeletedStrips();

  tbody.innerHTML = "";

  const entries = getDeletedStrips();
  // Newest deletions first
  const sorted = [...entries].sort((a, b) => {
    const ta = a.deletedAt ? new Date(a.deletedAt).getTime() : 0;
    const tb = b.deletedAt ? new Date(b.deletedAt).getTime() : 0;
    return tb - ta;
  });

  if (sorted.length === 0) {
    const empty = document.createElement("tr");
    empty.innerHTML = `<td colspan="9" style="padding:8px; font-size:12px; color:#777;">No deleted strips in retention window.</td>`;
    tbody.appendChild(empty);
    return;
  }

  const menuItemStyle = 'display:block; width:100%; padding:8px 12px; border:none; background:none; text-align:left; cursor:pointer; font-size:14px; white-space:nowrap;';
  const menuItemHover = 'onmouseover="this.style.backgroundColor=\'#f0f0f0\'" onmouseout="this.style.backgroundColor=\'transparent\'"';

  for (const entry of sorted) {
    const s = entry.snapshot || {};
    const ft = escapeHtml((s.flightType || '').toUpperCase());
    const callsign = escapeHtml(s.callsignCode || '—');
    const reg = escapeHtml(s.registration || '—');
    const acType = escapeHtml(s.type || '—');
    const depAd = escapeHtml(s.depAd || '—');
    const arrAd = escapeHtml(s.arrAd || '—');
    const statusAtDel = escapeHtml(s.status || '—');

    const deletedAtStr = entry.deletedAt
      ? escapeHtml(entry.deletedAt.replace('T', ' ').slice(0, 16)) + 'Z'
      : '—';

    const now = Date.now();
    const expired = entry.expiresAt && new Date(entry.expiresAt).getTime() <= now;
    const expiresInStr = _formatExpiresIn(entry.expiresAt);
    const restoreDisabled = expired ? 'disabled title="Retention window expired"' : '';

    const isExpanded = _deletedStripsExpandedId === entry.id;

    const tr = document.createElement("tr");
    tr.className = "deleted-strip-row";
    tr.dataset.id = entry.id;

    tr.innerHTML = `
      <td><span class="badge badge-type">${ft}</span></td>
      <td style="font-size:11px; white-space:nowrap;">${deletedAtStr}</td>
      <td style="font-size:11px; white-space:nowrap; color:${expired ? '#c00' : '#666'};">${expiresInStr}</td>
      <td>${callsign}</td>
      <td><span style="font-size:12px;">${reg}</span></td>
      <td><span style="font-size:12px;">${acType}</span></td>
      <td>${depAd}</td>
      <td>${arrAd}</td>
      <td><span class="badge badge-cancelled" style="font-size:10px;">${statusAtDel}</span></td>
      <td>
        <div style="display:flex; flex-direction:column; gap:2px; align-items:flex-end;">
          <button class="small-btn js-deleted-strip-restore" type="button" style="color:#2a7a2a;" ${restoreDisabled}>Restore ↩</button>
          <button class="small-btn js-deleted-strip-toggle" type="button" aria-label="Toggle detail">${isExpanded ? 'Hide ▲' : 'Detail ▾'}</button>
        </div>
      </td>
    `;

    // Restore button
    const restoreBtn = tr.querySelector(".js-deleted-strip-restore");
    safeOn(restoreBtn, "click", () => {
      restoreDeletedStrip(entry);
    });

    // Detail toggle
    const toggleBtn = tr.querySelector(".js-deleted-strip-toggle");
    safeOn(toggleBtn, "click", () => {
      _deletedStripsExpandedId = isExpanded ? null : entry.id;
      renderDeletedStripsLog();
    });

    tbody.appendChild(tr);

    if (isExpanded) {
      const detailTr = document.createElement("tr");
      detailTr.className = "deleted-strip-detail-row";

      const expiresAtStr = entry.expiresAt
        ? escapeHtml(entry.expiresAt.replace('T', ' ').slice(0, 16)) + 'Z'
        : '—';

      detailTr.innerHTML = `
        <td colspan="10" class="cancelled-log-detail-cell">
          <div class="cancelled-log-detail">
            <div class="cancelled-log-detail-section">
              <strong>Deletion record</strong>
              <div>Deleted at: ${escapeHtml(entry.deletedAt || '—')}</div>
              <div>Expires at: ${expiresAtStr}${expired ? ' <em style="color:#c00;">(expired)</em>' : ''}</div>
              <div>Expires in: ${expiresInStr}</div>
              <div>Log entry ID: ${escapeHtml(entry.id || '—')}</div>
              <div>Source movement ID: ${escapeHtml(String(entry.sourceMovementId ?? '—'))}</div>
            </div>
            <div class="cancelled-log-detail-section">
              <strong>Strip snapshot at deletion</strong>
              <div style="font-size:10px; color:#999; margin-bottom:3px;">State at time of deletion</div>
              <div>Callsign: ${escapeHtml(s.callsignCode || '—')} / ${escapeHtml(s.callsignVoice || '—')}</div>
              <div>Reg: ${escapeHtml(s.registration || '—')} · Type: ${escapeHtml(s.type || '—')} · WTC: ${escapeHtml(s.wtc || '—')}</div>
              <div>Route: ${escapeHtml(s.depAd || '—')} → ${escapeHtml(s.arrAd || '—')}</div>
              <div>DOF: ${escapeHtml(s.dof || '—')} · Rules: ${escapeHtml(s.rules || '—')}</div>
              <div>ETD: ${escapeHtml(s.depPlanned || '—')} · ATD: ${escapeHtml(s.depActual || '—')} · ETA: ${escapeHtml(s.arrPlanned || '—')} · ATA: ${escapeHtml(s.arrActual || '—')}</div>
              <div>Status at deletion: ${escapeHtml(s.status || '—')}</div>
              <div>Remarks: ${escapeHtml(s.remarks || '—')}</div>
            </div>
          </div>
        </td>
      `;

      tbody.appendChild(detailTr);
    }
  }
}

/**
 * Initialise the Deleted Strips Log page.
 * Runs initial purge, then renders. Called from app.js boot sequence.
 */
export function initDeletedStripsLog() {
  ensureDeletedStripsInitialised();
  purgeExpiredDeletedStrips();
  renderDeletedStripsLog();
}

/* -----------------------------
   Timeline
------------------------------ */

/**
 * Get timeline configuration from app config
 */
function getTimelineConfig() {
  const cfg = getConfig();
  return {
    enabled: cfg.timelineEnabled !== false,
    startHour: cfg.timelineStartHour ?? 6,
    endHour: cfg.timelineEndHour ?? 22,
    pixelsPerHour: 60
  };
}

/**
 * Get default flight duration for a flight type (in minutes)
 */
function getDefaultFlightDuration(flightType) {
  const cfg = getConfig();
  const ft = (flightType || '').toUpperCase();
  switch (ft) {
    case 'LOC': return cfg.locFlightDurationMinutes || 40;
    case 'DEP': return cfg.depFlightDurationMinutes || 60;
    case 'ARR': return cfg.arrFlightDurationMinutes || 60;
    case 'OVR': return cfg.ovrFlightDurationMinutes || 15;
    default: return 60;
  }
}

/**
 * Resolve the effective display policy for DEP or ARR on the day Timeline.
 * Reads from the saved config, honouring the shared/separate setting.
 *
 * Returns { mode, tokenMinutes } where:
 *   mode         — "token" | "full"
 *   tokenMinutes — positive integer (only meaningful when mode === "token")
 */
function getEffectiveTimelinePolicy(ft) {
  const cfg = getConfig();
  const shared = cfg.timelineArrDepShared !== false;
  if (shared) {
    return {
      mode: cfg.timelineSharedMode === 'full' ? 'full' : 'token',
      tokenMinutes: (Number.isFinite(cfg.timelineSharedTokenMinutes) && cfg.timelineSharedTokenMinutes > 0)
        ? cfg.timelineSharedTokenMinutes : 10,
    };
  }
  if (ft === 'DEP') {
    return {
      mode: cfg.timelineDepMode === 'full' ? 'full' : 'token',
      tokenMinutes: (Number.isFinite(cfg.timelineDepTokenMinutes) && cfg.timelineDepTokenMinutes > 0)
        ? cfg.timelineDepTokenMinutes : 10,
    };
  }
  // ARR
  return {
    mode: cfg.timelineArrMode === 'full' ? 'full' : 'token',
    tokenMinutes: (Number.isFinite(cfg.timelineArrTokenMinutes) && cfg.timelineArrTokenMinutes > 0)
      ? cfg.timelineArrTokenMinutes : 10,
  };
}

/**
 * Shared helper: canonical full-duration span for any movement type.
 * Uses existing resolved start/end + duration-based fallback.
 * Used by DEP/ARR when mode === "full", and always by LOC/OVR.
 */
function _resolvedFullSpan(m) {
  const startTimeStr = getMovementStartTime(m);
  if (!startTimeStr) return null;
  const startMinutes = timeToMinutes(startTimeStr);
  if (!Number.isFinite(startMinutes)) return null;
  const endTimeStr = getMovementEndTime(m);
  let endMinutes = timeToMinutes(endTimeStr);
  if (!Number.isFinite(endMinutes)) {
    const { minutes } = getDurationSource(m);
    endMinutes = startMinutes + minutes;
  }
  if (endMinutes < startMinutes) endMinutes += 24 * 60;
  return { startMinutes, endMinutes };
}

/**
 * Resolve the display span (startMinutes, endMinutes since midnight) for a
 * movement on the day Timeline.
 *
 * DEP — forward token window from departure anchor (ATD || ETD), or full span
 *        per saved config (getEffectiveTimelinePolicy).
 * ARR — backward token window ending at arrival anchor (ATA || ETA), or full
 *        span per saved config.
 * LOC — unchanged: full span via canonical resolved start/end.
 * OVR — unchanged: full span via canonical resolved start/end.
 *
 * Returns { startMinutes, endMinutes } where both values are finite numbers,
 * or null if the anchor is unavailable and the bar should be skipped.
 */
function getDayTimelineDisplayRange(m) {
  const ft = (m.flightType || '').toUpperCase();

  if (ft === 'DEP') {
    const policy = getEffectiveTimelinePolicy('DEP');
    if (policy.mode === 'full') return _resolvedFullSpan(m);
    // Token mode: forward window from departure anchor
    const anchor = getATD(m) || getETD(m);
    if (!anchor) return null;
    const anchorMinutes = timeToMinutes(anchor);
    if (!Number.isFinite(anchorMinutes)) return null;
    return {
      startMinutes: anchorMinutes,
      endMinutes: anchorMinutes + policy.tokenMinutes,
    };
  }

  if (ft === 'ARR') {
    const policy = getEffectiveTimelinePolicy('ARR');
    if (policy.mode === 'full') return _resolvedFullSpan(m);
    // Token mode: backward window ending at arrival anchor
    const anchor = getATA(m) || getETA(m);
    if (!anchor) return null;
    const anchorMinutes = timeToMinutes(anchor);
    if (!Number.isFinite(anchorMinutes)) return null;
    return {
      startMinutes: anchorMinutes - policy.tokenMinutes,
      endMinutes: anchorMinutes,
    };
  }

  // LOC and OVR: full canonical span — unchanged behavior.
  return _resolvedFullSpan(m);
}

/**
 * Render the timeline scale (hour markers)
 */
function renderTimelineScale() {
  const scale = byId("timelineScale");
  if (!scale) return;

  scale.innerHTML = '';

  const { startHour, endHour } = getTimelineConfig();
  const totalHours = endHour - startHour;

  // Use 100% width with percentage positioning
  scale.style.width = '100%';

  for (let hour = startHour; hour <= endHour; hour++) {
    const marker = document.createElement('div');
    marker.className = `timeline-hour-marker${hour % 3 === 0 ? ' hour-major' : ''}`;
    const leftPercent = ((hour - startHour) / totalHours) * 100;
    marker.style.left = `${leftPercent}%`;
    marker.textContent = `${String(hour).padStart(2, '0')}:00`;
    scale.appendChild(marker);
  }
}

/**
 * Resolved start time for the Timeline bar left anchor.
 * Delegates to the canonical timing model (resolvedStartTime from datamodel.js).
 *
 * Canonical bar start anchors:
 *   DEP/LOC planned: ETD     DEP/LOC active: ATD     DEP/LOC completed: ATD
 *   ARR     planned: ETD     ARR     active: ATD     ARR     completed: ATD
 *   OVR     planned: EOFT    OVR     active: ATOF    OVR     completed: ATOF
 *
 * Note for ARR: ETA is the calculation root in planned state, but ETD is still
 * the bar START anchor.  Do not use ETA/ATA as bar start for ARR.
 */
function getMovementStartTime(m) {
  return resolvedStartTime(m);
}

/**
 * Resolved end time for the Timeline bar right anchor.
 * Delegates to the canonical timing model (resolvedEndTime from datamodel.js).
 *
 * Canonical bar end anchors:
 *   DEP/LOC/ARR: ATA when completed, ETA otherwise
 *   OVR:         ALFT when completed, ELFT otherwise
 */
function getMovementEndTime(m) {
  return resolvedEndTime(m);
}

/**
 * Render timeline movement bars
 */
function renderTimelineTracks() {
  const tracks = byId("timelineTracks");
  if (!tracks) return;

  tracks.innerHTML = '';

  const movements = getMovements();
  const { startHour, endHour } = getTimelineConfig();

  // Filter to planned and active movements for today only
  const todayUtcStr = new Date().toISOString().split('T')[0];
  const relevantMovements = movements.filter(m =>
    (m.status === 'PLANNED' || m.status === 'ACTIVE') && m.dof === todayUtcStr
  );

  // Sort by start time
  relevantMovements.sort((a, b) => {
    const aTime = timeToMinutes(getMovementStartTime(a));
    const bTime = timeToMinutes(getMovementStartTime(b));
    const aVal = Number.isFinite(aTime) ? aTime : Number.POSITIVE_INFINITY;
    const bVal = Number.isFinite(bTime) ? bTime : Number.POSITIVE_INFINITY;
    return aVal - bVal;
  });

  // Calculate timeline bounds in minutes
  const timelineStartMinutes = startHour * 60;
  const timelineEndMinutes = endHour * 60;
  const timelineWidthMinutes = timelineEndMinutes - timelineStartMinutes;

  // Track allocation for stacking (simple greedy algorithm)
  const trackEndTimes = []; // Each element is the end minute of a bar in that track

  relevantMovements.forEach(m => {
    // DEP/ARR use fixed-window display spans; LOC/OVR use canonical resolved span.
    const range = getDayTimelineDisplayRange(m);
    if (!range) return;
    let { startMinutes, endMinutes } = range;

    // Skip if entirely outside timeline window
    if (endMinutes < timelineStartMinutes || startMinutes > timelineEndMinutes) {
      return;
    }

    // Clamp to timeline bounds
    const displayStart = Math.max(startMinutes, timelineStartMinutes);
    const displayEnd = Math.min(endMinutes, timelineEndMinutes);

    // Calculate position and width as percentages
    const leftPercent = ((displayStart - timelineStartMinutes) / timelineWidthMinutes) * 100;
    const widthPercent = ((displayEnd - displayStart) / timelineWidthMinutes) * 100;

    // Minimum width for visibility
    const minWidthPercent = 2;
    const actualWidthPercent = Math.max(widthPercent, minWidthPercent);

    // Find available track
    let trackIndex = 0;
    for (let i = 0; i < trackEndTimes.length; i++) {
      if (trackEndTimes[i] <= startMinutes) {
        trackIndex = i;
        break;
      }
      trackIndex = i + 1;
    }
    trackEndTimes[trackIndex] = endMinutes;

    // Create or get track element
    let track = tracks.querySelector(`[data-track="${trackIndex}"]`);
    if (!track) {
      track = document.createElement('div');
      track.className = 'timeline-track';
      track.dataset.track = trackIndex;
      tracks.appendChild(track);
    }

    // Create movement bar
    const bar = document.createElement('div');
    const ftClass = `ft-${(m.flightType || 'loc').toLowerCase()}`;
    const movementStatusClass = `status-${(m.status || 'planned').toLowerCase()}`;
    bar.className = `timeline-movement-bar ${ftClass} ${movementStatusClass}`;
    bar.style.left = `${leftPercent}%`;
    bar.style.width = `${actualWidthPercent}%`;
    bar.title = `${m.callsignCode || 'Unknown'}\n${minutesToTime(startMinutes)} - ${minutesToTime(endMinutes)}\n${m.flightType || ''} (${m.status})`;
    // No text content - bars are thin visual indicators only
    bar.dataset.movementId = m.id;

    // Click to scroll to movement in strip bay
    bar.addEventListener('click', () => {
      const stripRow = document.querySelector(`#liveBody tr[data-id="${m.id}"]`);
      if (stripRow) {
        stripRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        stripRow.style.transition = 'background-color 0.3s';
        stripRow.style.backgroundColor = '#fffbcc';
        setTimeout(() => {
          stripRow.style.backgroundColor = '';
        }, 1500);
      }
    });

    // Hover sync with strip row - highlight strip when hovering timeline bar
    bar.addEventListener('mouseenter', () => {
      const stripRow = document.querySelector(`#liveBody tr[data-id="${m.id}"]`);
      if (stripRow) {
        stripRow.classList.add('strip-highlight');
      }
    });
    bar.addEventListener('mouseleave', () => {
      const stripRow = document.querySelector(`#liveBody tr[data-id="${m.id}"]`);
      if (stripRow) {
        stripRow.classList.remove('strip-highlight');
      }
    });

    track.appendChild(bar);
  });

  // Ensure at least one track exists for visual consistency
  if (tracks.children.length === 0) {
    const emptyTrack = document.createElement('div');
    emptyTrack.className = 'timeline-track';
    emptyTrack.innerHTML = '<span style="font-size: 10px; color: #999; padding-left: 10px;">No movements in timeline window</span>';
    tracks.appendChild(emptyTrack);
  }
}

/**
 * Update the "now" indicator line position
 */
export function updateTimelineNowLine() {
  const container = byId("timelineContainer");
  const nowLine = byId("timelineNowLine");
  const currentTimeEl = byId("timelineCurrentTime");

  if (!container || !nowLine) return;

  const now = new Date();
  const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

  const { startHour, endHour } = getTimelineConfig();
  const timelineStartMinutes = startHour * 60;
  const timelineEndMinutes = endHour * 60;

  // Update current time display
  if (currentTimeEl) {
    const hh = String(now.getUTCHours()).padStart(2, '0');
    const mm = String(now.getUTCMinutes()).padStart(2, '0');
    currentTimeEl.textContent = `${hh}:${mm} UTC`;
  }

  // Check if current time is within timeline window
  if (currentMinutes < timelineStartMinutes || currentMinutes > timelineEndMinutes) {
    nowLine.style.display = 'none';
    return;
  }

  nowLine.style.display = 'block';

  // Calculate position as percentage
  const timelineWidthMinutes = timelineEndMinutes - timelineStartMinutes;
  const positionPercent = ((currentMinutes - timelineStartMinutes) / timelineWidthMinutes) * 100;

  nowLine.style.left = `${positionPercent}%`;
}

/**
 * Render the complete timeline
 */
export function renderTimeline() {
  const container = byId("timelineContainer");
  if (!container) return;

  const { enabled } = getTimelineConfig();

  // Show or hide timeline based on config
  if (!enabled) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');
  renderTimelineScale();
  renderTimelineTracks();
  updateTimelineNowLine();
}

/**
 * Initialize the timeline
 */
export function initTimeline() {
  renderTimeline();

  // Update now line every minute
  setInterval(updateTimelineNowLine, 60000);
}

/* -----------------------------
   Reports
------------------------------ */

/**
 * Render the Reports summary panel
 * Shows statistics and breakdowns
 */
export function renderReportsSummary() {
  const container = byId("reportsSummary");
  if (!container) return;

  const movements = getMovements();

  // Calculate statistics
  const stats = {
    total: movements.length,
    byStatus: {},
    byFlightType: {},
    byUnit: {},
    byEgowCode: {},
    tngTotal: 0,
    fisTotal: 0,
    osTotal: 0,
    pobTotal: 0
  };

  movements.forEach(m => {
    // Status counts
    const status = m.status || 'UNKNOWN';
    stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;

    // Flight type counts
    const ft = m.flightType || 'UNKNOWN';
    stats.byFlightType[ft] = (stats.byFlightType[ft] || 0) + 1;

    // Unit counts
    if (m.unitCode) {
      const unit = `${m.unitCode}${m.unitDesc ? ' - ' + m.unitDesc : ''}`;
      stats.byUnit[unit] = (stats.byUnit[unit] || 0) + 1;
    }

    // EGOW code counts
    if (m.egowCode) {
      const code = `${m.egowCode}${m.egowDesc ? ' - ' + m.egowDesc : ''}`;
      stats.byEgowCode[code] = (stats.byEgowCode[code] || 0) + 1;
    }

    // Totals
    stats.tngTotal += m.tngCount || 0;
    stats.fisTotal += m.fisCount || 0;
    stats.osTotal += m.osCount || 0;
    stats.pobTotal += m.pob || 0;
  });

  // Build HTML
  let html = '<div class="reports-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;">';

  // Summary card
  html += `
    <div class="report-card">
      <div class="report-card-title">Total Movements</div>
      <div class="report-card-main">${stats.total}</div>
      <div class="report-card-breakdown">
        Session statistics
      </div>
    </div>
  `;

  // Status breakdown
  html += `
    <div class="report-card">
      <div class="report-card-title">By Status</div>
      <div class="report-card-main">${stats.total}</div>
      <div class="report-card-breakdown">
        ${Object.entries(stats.byStatus).map(([status, count]) =>
          `<div>${status}: ${count}</div>`
        ).join('')}
      </div>
    </div>
  `;

  // Flight type breakdown
  html += `
    <div class="report-card">
      <div class="report-card-title">By Flight Type</div>
      <div class="report-card-main">${stats.total}</div>
      <div class="report-card-breakdown">
        ${Object.entries(stats.byFlightType).map(([type, count]) =>
          `<div>${type}: ${count}</div>`
        ).join('')}
      </div>
    </div>
  `;

  // Activity totals
  html += `
    <div class="report-card">
      <div class="report-card-title">Activity Totals</div>
      <div class="report-card-main">${stats.tngTotal + stats.fisTotal + stats.osTotal}</div>
      <div class="report-card-breakdown">
        <div>T&G: ${stats.tngTotal}</div>
        <div>FIS: ${stats.fisTotal}</div>
        <div>O/S: ${stats.osTotal}</div>
        <div>Total POB: ${stats.pobTotal}</div>
      </div>
    </div>
  `;

  // Top units
  const topUnits = Object.entries(stats.byUnit)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (topUnits.length > 0) {
    html += `
      <div class="report-card">
        <div class="report-card-title">Top Units</div>
        <div class="report-card-main">${topUnits.length}</div>
        <div class="report-card-breakdown">
          ${topUnits.map(([unit, count]) =>
            `<div>${escapeHtml(unit)}: ${count}</div>`
          ).join('')}
        </div>
      </div>
    `;
  }

  // Top EGOW codes
  const topCodes = Object.entries(stats.byEgowCode)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (topCodes.length > 0) {
    html += `
      <div class="report-card">
        <div class="report-card-title">Top EGOW Codes</div>
        <div class="report-card-main">${topCodes.length}</div>
        <div class="report-card-breakdown">
          ${topCodes.map(([code, count]) =>
            `<div>${escapeHtml(code)}: ${count}</div>`
          ).join('')}
        </div>
      </div>
    `;
  }

  html += '</div>';

  container.innerHTML = html;
}

/* -----------------------------
   CSV Export
------------------------------ */

/**
 * Export history to CSV
 * Includes all relevant fields
 */
function exportHistoryCSV() {
  // Ticket 6a: Movement History exports COMPLETED only.
  // Cancelled sorties are exported separately from the Cancelled Sorties page.
  const movements = getMovements().filter(m => m.status === "COMPLETED");

  if (movements.length === 0) {
    showToast("No completed movements to export", 'warning');
    return;
  }

  // CSV headers
  const headers = [
    "ID",
    "Status",
    "Flight Type",
    "Rules",
    "Callsign",
    "Registration",
    "Type",
    "WTC",
    "Dep AD",
    "Arr AD",
    "DOF",
    "ETD/ECT",
    "ATD/ACT",
    "ETA",
    "ATA",
    "T&G Count",
    "O/S Count",
    "FIS Count",
    "POB",
    "EGOW Code",
    "Unit",
    "Remarks"
  ];

  // Build CSV rows
  const rows = movements.map(m => [
    m.id || '',
    m.status || '',
    m.flightType || '',
    m.rules || '',
    m.callsignCode || '',
    m.registration || '',
    m.type || '',
    m.wtc || '',
    m.depAd || '',
    m.arrAd || '',
    m.dof || '',
    getETD(m) || getECT(m) || '',
    getATD(m) || getACT(m) || '',
    getETA(m) || '',
    getATA(m) || '',
    m.tngCount || 0,
    m.osCount || 0,
    m.fisCount || 0,
    m.pob || 0,
    m.egowCode || '',
    m.unitCode || '',
    m.remarks || ''
  ]);

  // Escape CSV values (handle commas, quotes, newlines)
  const escapeCSV = (value) => {
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  // Build CSV content
  const csv = [
    headers.join(','),
    ...rows.map(row => row.map(escapeCSV).join(','))
  ].join('\n');

  // Download
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fdms-movement-history-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  showToast(`Exported ${movements.length} completed movements to CSV`, 'success');
}

/**
 * Initialize history export button
 */
export function initHistoryExport() {
  const exportBtn = byId("btnExportHistoryCsv");
  if (exportBtn) {
    exportBtn.addEventListener("click", exportHistoryCSV);
  }
}

/* -----------------------------
   VKB Lookup
------------------------------ */

let vkbSearchQuery = '';
let vkbActiveCategory = 'all';

/**
 * Render empty state for a category
 */
function renderVkbEmpty(tbody, colspan, message) {
  tbody.innerHTML = "";
  const row = document.createElement("tr");
  row.innerHTML = `
    <td colspan="${colspan}" style="padding: 16px; text-align: center; color: #777;">
      ${escapeHtml(message)}
    </td>
  `;
  tbody.appendChild(row);
}

/**
 * Render "All Results" tab
 */
function renderVkbAll(results) {
  const tbody = byId("vkbBodyAll");
  if (!tbody) return;

  const allResults = [
    ...results.aircraftTypes.map(r => ({
      kind: 'Aircraft Type',
      code: r['ICAO Type Designator'] || '-',
      label: `${r['Manufacturer']} ${r['Model']}`,
      details: `WTC: ${r['ICAO WTC'] || '-'}, ${r['Common Name'] || ''}`.trim(),
      data: r
    })),
    ...results.callsigns.map(r => ({
      kind: 'Callsign',
      code: r['CALLSIGN'] || '-',
      label: r['COMMON NAME'] || '-',
      details: `${r['TRICODE'] || '-'} • ${r['COUNTRY'] || '-'}`,
      data: r
    })),
    ...results.locations.map(r => ({
      kind: 'Location',
      code: r['ICAO CODE'] || '-',
      label: r['AIRPORT'] || '-',
      details: `${r['LOCATION SERVED'] || '-'} • ${r['COUNTRY'] || '-'}`,
      data: r
    })),
    ...results.registrations.map(r => ({
      kind: 'Registration',
      code: r['REGISTRATION'] || '-',
      label: r['OPERATOR'] || '-',
      details: `${r['TYPE'] || '-'} • ${r['EGOW FLIGHT TYPE'] || '-'}`,
      data: r
    }))
  ];

  if (allResults.length === 0) {
    renderVkbEmpty(tbody, 5, vkbSearchQuery ? `No results found for "${vkbSearchQuery}"` : 'Enter a search term to query the VKB database');
    return;
  }

  tbody.innerHTML = "";
  allResults.forEach(result => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td style="padding: 8px; font-weight: 600; font-size: 11px; color: #666; text-transform: uppercase;">${escapeHtml(result.kind)}</td>
      <td style="padding: 8px; font-family: monospace; font-weight: 600;">${escapeHtml(result.code)}</td>
      <td style="padding: 8px;">${escapeHtml(result.label)}</td>
      <td style="padding: 8px; font-size: 12px; color: #666;">${escapeHtml(result.details)}</td>
      <td style="padding: 8px; text-align: right;">
        <button class="btn btn-sm btn-secondary js-vkb-use" data-kind="${escapeHtml(result.kind)}" data-code="${escapeHtml(result.code)}">Use</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

/**
 * Render "Aircraft Types" tab
 */
function renderVkbTypes(types) {
  const tbody = byId("vkbBodyTypes");
  if (!tbody) return;

  if (types.length === 0) {
    renderVkbEmpty(tbody, 6, vkbSearchQuery ? 'No aircraft types found' : 'Enter a search term');
    return;
  }

  tbody.innerHTML = "";
  types.forEach(t => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td style="padding: 8px; font-family: monospace; font-weight: 600;">${escapeHtml(t['ICAO Type Designator'] || '-')}</td>
      <td style="padding: 8px;">${escapeHtml(t['Manufacturer'] || '-')}</td>
      <td style="padding: 8px;">${escapeHtml(t['Model'] || '-')}</td>
      <td style="padding: 8px; text-align: center;">${escapeHtml(t['ICAO WTC'] || '-')}</td>
      <td style="padding: 8px; font-size: 12px; color: #666;">${escapeHtml(t['Common Name'] || '')}</td>
      <td style="padding: 8px; text-align: right;">
        <button class="btn btn-sm btn-secondary js-vkb-use" data-kind="type" data-code="${escapeHtml(t['ICAO Type Designator'] || '')}">Use</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

/**
 * Render "Callsigns" tab
 */
function renderVkbCallsigns(callsigns) {
  const tbody = byId("vkbBodyCallsigns");
  if (!tbody) return;

  if (callsigns.length === 0) {
    renderVkbEmpty(tbody, 5, vkbSearchQuery ? 'No callsigns found' : 'Enter a search term');
    return;
  }

  tbody.innerHTML = "";
  callsigns.forEach(c => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td style="padding: 8px; font-family: monospace; font-weight: 600;">${escapeHtml(c['CALLSIGN'] || '-')}</td>
      <td style="padding: 8px;">${escapeHtml(c['TRICODE'] || '-')}</td>
      <td style="padding: 8px;">${escapeHtml(c['COMMON NAME'] || '-')}</td>
      <td style="padding: 8px; font-size: 12px; color: #666;">${escapeHtml(c['COUNTRY'] || '-')}</td>
      <td style="padding: 8px; text-align: right;">
        <button class="btn btn-sm btn-secondary js-vkb-use" data-kind="callsign" data-code="${escapeHtml(c['CALLSIGN'] || '')}">Use</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

/**
 * Render "Locations" tab
 */
function renderVkbLocations(locations) {
  const tbody = byId("vkbBodyLocations");
  if (!tbody) return;

  if (locations.length === 0) {
    renderVkbEmpty(tbody, 6, vkbSearchQuery ? 'No locations found' : 'Enter a search term');
    return;
  }

  tbody.innerHTML = "";
  locations.forEach(l => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td style="padding: 8px; font-family: monospace; font-weight: 600;">${escapeHtml(l['ICAO CODE'] || '-')}</td>
      <td style="padding: 8px;">${escapeHtml(l['IATA CODE'] || '-')}</td>
      <td style="padding: 8px;">${escapeHtml(l['AIRPORT'] || '-')}</td>
      <td style="padding: 8px; font-size: 12px; color: #666;">${escapeHtml(l['LOCATION SERVED'] || '-')}</td>
      <td style="padding: 8px; font-size: 12px; color: #666;">${escapeHtml(l['COUNTRY'] || '-')}</td>
      <td style="padding: 8px; text-align: right;">
        <button class="btn btn-sm btn-secondary js-vkb-use" data-kind="location" data-code="${escapeHtml(l['ICAO CODE'] || '')}">Use</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

/**
 * Render "Registrations" tab
 */
function renderVkbRegistrations(regs) {
  const tbody = byId("vkbBodyRegistrations");
  if (!tbody) return;

  if (regs.length === 0) {
    renderVkbEmpty(tbody, 5, vkbSearchQuery ? 'No registrations found' : 'Enter a search term');
    return;
  }

  tbody.innerHTML = "";
  regs.forEach(r => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td style="padding: 8px; font-family: monospace; font-weight: 600;">${escapeHtml(r['REGISTRATION'] || '-')}</td>
      <td style="padding: 8px;">${escapeHtml(r['OPERATOR'] || '-')}</td>
      <td style="padding: 8px;">${escapeHtml(r['TYPE'] || '-')}</td>
      <td style="padding: 8px; font-size: 12px; color: #666;">${escapeHtml(r['EGOW FLIGHT TYPE'] || '-')}</td>
      <td style="padding: 8px; text-align: right;">
        <button class="btn btn-sm btn-secondary js-vkb-use" data-kind="registration" data-code="${escapeHtml(r['REGISTRATION'] || '')}">Use</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

/**
 * Render VKB lookup results for current category
 */
function renderVkbLookup() {
  const status = getVKBStatus();
  if (!status.loaded) {
    // Show error in all tables
    ['vkbBodyAll', 'vkbBodyTypes', 'vkbBodyCallsigns', 'vkbBodyLocations', 'vkbBodyRegistrations'].forEach(id => {
      const tbody = byId(id);
      if (tbody) {
        renderVkbEmpty(tbody, 5, status.error ? `Error: ${status.error}` : 'VKB data not loaded');
      }
    });
    return;
  }

  // Perform search
  const results = searchAll(vkbSearchQuery, 50);

  // Render all categories
  renderVkbAll(results);
  renderVkbTypes(results.aircraftTypes);
  renderVkbCallsigns(results.callsigns);
  renderVkbLocations(results.locations);
  renderVkbRegistrations(results.registrations);

  // Bind all "Use" buttons
  document.querySelectorAll('.js-vkb-use').forEach(btn => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.kind;
      const code = btn.dataset.code;
      showToast(`"${code}" ready to use (auto-fill coming soon)`, 'info', 3000);
    });
  });
}

/**
 * Switch VKB category tab
 */
function switchVkbCategory(category) {
  vkbActiveCategory = category;

  // Update tab buttons
  document.querySelectorAll('.vkb-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.category === category);
  });

  // Show/hide category content
  document.querySelectorAll('.vkb-category-content').forEach(content => {
    const contentId = content.id.replace('vkb-', '');
    content.classList.toggle('hidden', contentId !== category);
  });
}

/**
 * Initialize VKB lookup tab
 */
export function initVkbLookup() {
  const searchInput = byId("vkbSearch");
  if (!searchInput) return;

  // Debounced search
  const debouncedSearch = debounce((query) => {
    vkbSearchQuery = query;
    renderVkbLookup();
  }, 300);

  searchInput.addEventListener('input', (e) => {
    debouncedSearch(e.target.value);
  });

  // Bind category tabs
  document.querySelectorAll('.vkb-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchVkbCategory(tab.dataset.category);
    });
  });

  // Initial render
  renderVkbLookup();
}

/* -----------------------------
   Autocomplete
------------------------------ */

/**
 * Create autocomplete for an input field
 * @param {HTMLElement} input - Input element
 * @param {string} fieldType - 'type', 'callsign', 'location', 'registration'
 */
function createAutocomplete(input, fieldType) {
  if (!input) return;

  // Wrap input in container if not already wrapped
  let container = input.parentElement;
  if (!container.classList.contains('autocomplete-container')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'autocomplete-container';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);
    container = wrapper;
  }

  // Create suggestions dropdown
  let suggestionsDiv = container.querySelector('.autocomplete-suggestions');
  if (!suggestionsDiv) {
    suggestionsDiv = document.createElement('div');
    suggestionsDiv.className = 'autocomplete-suggestions';
    container.appendChild(suggestionsDiv);
  }

  let selectedIndex = -1;
  let currentSuggestions = [];

  // Update suggestions
  const updateSuggestions = (query) => {
    if (!query || query.length < 2) {
      suggestionsDiv.classList.remove('active');
      currentSuggestions = [];
      return;
    }

    const suggestions = getAutocompleteSuggestions(fieldType, query, 10);
    currentSuggestions = suggestions;

    if (suggestions.length === 0) {
      suggestionsDiv.innerHTML = '<div class="autocomplete-empty">No matches found</div>';
      suggestionsDiv.classList.add('active');
      return;
    }

    suggestionsDiv.innerHTML = suggestions
      .map((s, idx) => {
        const primary = typeof s === 'object' ? s.primary : s;
        const secondary = typeof s === 'object' ? s.secondary : '';
        return `
          <div class="autocomplete-item" data-index="${idx}" data-value="${escapeHtml(primary)}">
            <span class="autocomplete-item-primary">${escapeHtml(primary)}</span>
            ${secondary ? `<span class="autocomplete-item-secondary">${escapeHtml(secondary)}</span>` : ''}
          </div>
        `;
      })
      .join('');

    suggestionsDiv.classList.add('active');
    selectedIndex = -1;
  };

  // Debounced update
  const debouncedUpdate = debounce(updateSuggestions, 200);

  // Input event
  input.addEventListener('input', (e) => {
    debouncedUpdate(e.target.value);
  });

  // Keyboard navigation
  input.addEventListener('keydown', (e) => {
    const items = suggestionsDiv.querySelectorAll('.autocomplete-item');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length > 0) {
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        updateSelection(items);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length > 0) {
        selectedIndex = Math.max(selectedIndex - 1, -1);
        updateSelection(items);
      }
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      if (currentSuggestions[selectedIndex]) {
        const suggestion = currentSuggestions[selectedIndex];
        const value = typeof suggestion === 'object' ? suggestion.primary : suggestion;
        input.value = value;
        suggestionsDiv.classList.remove('active');
        selectedIndex = -1;

        // Auto-focus Flight Number field if this is a Callsign Code field
        focusFlightNumberIfCallsignCode(input);
      }
    } else if (e.key === 'Escape') {
      suggestionsDiv.classList.remove('active');
      selectedIndex = -1;
    }
  });

  // Update visual selection
  function updateSelection(items) {
    items.forEach((item, idx) => {
      item.classList.toggle('selected', idx === selectedIndex);
    });
    if (selectedIndex >= 0 && items[selectedIndex]) {
      items[selectedIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  // Helper: Focus Flight Number field if input is Callsign Code
  function focusFlightNumberIfCallsignCode(inputEl) {
    const inputId = inputEl.id || '';
    if (inputId.includes('CallsignCode') || inputId.includes('Callsign')) {
      // Find corresponding Flight Number field
      const flightNumberId = inputId.replace('CallsignCode', 'FlightNumber').replace('Callsign', 'FlightNumber');
      const flightNumberField = document.getElementById(flightNumberId);
      if (flightNumberField) {
        setTimeout(() => flightNumberField.focus(), 50);
      }
    }
  }

  // Click on suggestion
  suggestionsDiv.addEventListener('click', (e) => {
    const item = e.target.closest('.autocomplete-item');
    if (item) {
      const value = item.dataset.value;
      input.value = value;
      suggestionsDiv.classList.remove('active');
      selectedIndex = -1;

      // Auto-focus Flight Number field if this is a Callsign Code field
      focusFlightNumberIfCallsignCode(input);
    }
  });

  // Close on focus loss (with delay to allow click)
  input.addEventListener('blur', () => {
    setTimeout(() => {
      suggestionsDiv.classList.remove('active');
      selectedIndex = -1;
    }, 200);
  });

  // Focus opens suggestions if there's text
  input.addEventListener('focus', () => {
    if (input.value.length >= 2) {
      updateSuggestions(input.value);
    }
  });
}

/**
 * Add autocomplete to modal input fields
 * Call this after a modal is created
 */
export function initModalAutocomplete(modal) {
  if (!modal) return;

  // Find autocomplete fields (updated for split callsign fields)
  const callsignInputs = modal.querySelectorAll('#newCallsignCode, #newLocCallsignCode, #editCallsignCode, #dupCallsignCode, #newCallsign, #editCallsign, #dupCallsign');
  const typeInputs = modal.querySelectorAll('#newType, #newLocType, #editType, #dupType');
  const regInputs = modal.querySelectorAll('#newReg, #newLocReg, #editReg, #dupReg');
  const depAdInputs = modal.querySelectorAll('#newDepAd, #editDepAd, #dupDepAd');
  const arrAdInputs = modal.querySelectorAll('#newArrAd, #editArrAd, #dupArrAd');

  // Create autocomplete for each field type
  callsignInputs.forEach(input => createAutocomplete(input, 'callsign'));
  typeInputs.forEach(input => createAutocomplete(input, 'type'));
  regInputs.forEach(input => createAutocomplete(input, 'registration'));
  depAdInputs.forEach(input => createAutocomplete(input, 'location'));
  arrAdInputs.forEach(input => createAutocomplete(input, 'location'));
}

export function initAdminPanel() {
  // No-op stub: implement if needed in this file.
}

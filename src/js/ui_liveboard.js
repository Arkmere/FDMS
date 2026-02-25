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
  convertUTCToLocal,
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
  isValidIcaoAd
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
      fieldName: (m) => m.depActual ? 'depActual' : 'depPlanned',
      applicable: ft === 'DEP' || ft === 'LOC' || ft === 'OVR' },
    { selector: '.js-edit-arr-time',  inputType: 'time',
      fieldName: (m) => m.arrActual ? 'arrActual' : 'arrPlanned',
      applicable: ft === 'ARR' || ft === 'LOC' },
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
function enableInlineEdit(el, movementId, fieldName, inputType = 'text', onSave = null) {
  if (!el || el.dataset.inlineEditEnabled) return;
  el.dataset.inlineEditEnabled = 'true';
  el.style.cursor = 'pointer';
  el.title = 'Double-click to edit';

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
    // For time inputs, strip the colon for easier editing
    input.value = inputType === 'time' ? displayValue.replace(':', '') : displayValue;
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

    // ── Transactional update ───────────────────────────────────────────────
    const updateData = {};
    updateData[fieldName] = storedValue;

    const updatedMovement = updateMovement(movementId, updateData);
    if (!updatedMovement) {
      el.innerHTML = originalContent;
      return false;
    }

    onMovementUpdated(updatedMovement);

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

  // 1. Registration-based callsign confusion (UK CAP 413-aligned)
  if (thisRegNorm && thisCallsignNorm === thisRegNorm) {
    const thisKey = getRegAbbrevKey(thisRegNorm);

    // Check for conflicts with other registration-based callsigns
    const conflictingRegs = activeOrPlannedMovements.filter(mov => {
      const otherCallsignRaw = (mov.callsignCode || '').toUpperCase().trim();
      const otherRegRaw = (mov.registration || '').toUpperCase().trim();
      const otherCallsignNorm = otherCallsignRaw.replace(/[-\s]/g, '');
      const otherRegNorm = otherRegRaw.replace(/[-\s]/g, '');

      // Only consider if other also uses registration as callsign
      if (otherRegNorm && otherCallsignNorm === otherRegNorm) {
        const otherKey = getRegAbbrevKey(otherRegNorm);
        // Conflict if same abbreviation key but different registrations
        return thisKey === otherKey && thisRegNorm !== otherRegNorm;
      }
      return false;
    });

    if (conflictingRegs.length > 0) {
      const otherCallsigns = conflictingRegs.map(mov => mov.callsignCode).join(', ');
      alerts.push({
        type: 'callsign_confusion_reg',
        severity: 'warning',
        message: `Registration callsign conflict: ${m.callsignCode} and ${otherCallsigns} both abbreviate to "${thisKey}"`
      });
    }

    // Guardrail: check if abbreviation key collides with known VKB contractions
    if (thisKey.length === 3 && isKnownContraction(thisKey)) {
      alerts.push({
        type: 'callsign_confusion_contraction',
        severity: 'warning',
        message: `Abbrev collision: "${thisKey}" matches a callsign contraction. Avoid abbreviated registration callsign.`
      });
    }
  }

  // 2. University Air Squadron (UA_) abbreviated callsign confusion
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
      const otherCallsigns = conflictingUa.map(mov => mov.callsignCode).join(', ');
      alerts.push({
        type: 'callsign_confusion_ua',
        severity: 'warning',
        message: `UAS callsign conflict: ${m.callsignCode} and ${otherCallsigns} both abbreviate to "UNIFORM${thisUaNumber}"`
      });
    }
  }

  // 3. Military non-standard vs ICAO abbreviation confusion
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

  // Get aircraft type info
  const typeData = lookupAircraftType(m.type);
  const typeDisplay = m.type ? `${escapeHtml(m.type)}${typeData && typeData['Common Name'] ? ` (${escapeHtml(typeData['Common Name'])})` : ''}` : "—";

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

      // Callsign confusion alerts
      const isCallsignAlert = ['callsign_confusion_reg', 'callsign_confusion_contraction', 'callsign_confusion_ua', 'callsign_confusion_military'].includes(alert.type);
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
            <div class="kv-label">Departure</div><div class="kv-value">${escapeHtml(m.depAd)} – ${escapeHtml(m.depName)}</div>
            <div class="kv-label">Arrival</div><div class="kv-value">${escapeHtml(m.arrAd)} – ${escapeHtml(m.arrName)}</div>
            <div class="kv-label">Captain</div><div class="kv-value">${escapeHtml(m.captain || "—")}</div>
            <div class="kv-label">POB</div><div class="kv-value">${escapeHtml(m.pob ?? "—")}</div>
            <div class="kv-label">T&amp;Gs</div><div class="kv-value">${escapeHtml(m.tngCount ?? 0)}</div>
            <div class="kv-label">O/S count</div><div class="kv-value">${escapeHtml(m.osCount ?? 0)}</div>
            <div class="kv-label">FIS count</div><div class="kv-value">${escapeHtml(m.fisCount ?? 0)}</div>
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

    // Use semantic time fields based on flight type
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
      arrDisplay = "-";
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

    // Check for callsign confusion alerts
    const hasCallsignConfusion = alerts.some(a =>
      a.type === 'callsign_confusion_reg' ||
      a.type === 'callsign_confusion_contraction' ||
      a.type === 'callsign_confusion_ua' ||
      a.type === 'callsign_confusion_military'
    );
    const callsignClass = hasCallsignConfusion ? 'call-main callsign-confusion' : 'call-main';

    // Check for WTC alert
    const hasWtcAlert = alerts.some(a => a.type === 'wtc_alert');
    const wtcDisplay = hasWtcAlert
      ? `<span class="wtc-alert">${escapeHtml(m.wtc || "—")}</span>`
      : escapeHtml(m.wtc || "—");

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
      </td>
      <td>
        <div class="cell-strong"><span class="js-edit-dep-ad"${m.depName && m.depName !== '' ? ` title="${m.depName}"` : ''}>${escapeHtml(m.depAd)}</span></div>
        <div class="cell-strong"><span class="js-edit-arr-ad"${m.arrName && m.arrName !== '' ? ` title="${m.arrName}"` : ''}>${escapeHtml(m.arrAd)}</span></div>
      </td>
      <td style="text-align: center;">
        <div class="cell-strong"><span class="js-edit-rules">${rulesDisplay}</span></div>
      </td>
      <td${tooltipTitle}>
        <div class="cell-strong"><span class="js-edit-dep-time">${escapeHtml(depDisplay)}</span> / ${overdueClass ? `<span class="js-edit-arr-time ${overdueClass}">${escapeHtml(arrDisplay)}</span>` : `<span class="js-edit-arr-time">${escapeHtml(arrDisplay)}</span>`}</div>
        <div class="cell-muted">${staleWarning ? `<span class="stale-movement" title="${staleWarning}">${dofFormatted}</span>` : dofFormatted}<br>${escapeHtml(m.flightType)} · ${escapeHtml(statusLabel(m.status))}</div>
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

    // Bind inline edit handlers (double-click to edit)
    enableInlineEdit(tr.querySelector(".js-edit-callsign"), m.id, "callsignCode", "text");
    enableInlineEdit(tr.querySelector(".js-edit-voice"), m.id, "callsignVoice", "text");
    enableInlineEdit(tr.querySelector(".js-edit-reg"), m.id, "registration", "text");
    enableInlineEdit(tr.querySelector(".js-edit-type"), m.id, "type", "text");
    enableInlineEdit(tr.querySelector(".js-edit-wtc"), m.id, "wtc", "text");
    // depAd editable only for OVR and ARR (not DEP or LOC)
    if (ft === "OVR" || ft === "ARR") {
      enableInlineEdit(tr.querySelector(".js-edit-dep-ad"), m.id, "depAd", "text");
    }
    // arrAd editable only for OVR and DEP (not ARR or LOC)
    if (ft === "OVR" || ft === "DEP") {
      enableInlineEdit(tr.querySelector(".js-edit-arr-ad"), m.id, "arrAd", "text");
    }
    enableInlineEdit(tr.querySelector(".js-edit-rules"), m.id, "rules", "text");
    enableInlineEdit(tr.querySelector(".js-edit-tng"), m.id, "tngCount", "number");
    enableInlineEdit(tr.querySelector(".js-edit-os"), m.id, "osCount", "number");
    enableInlineEdit(tr.querySelector(".js-edit-fis"), m.id, "fisCount", "number");
    enableInlineEdit(tr.querySelector(".js-edit-remarks"), m.id, "remarks", "text");

    // Time field mapping depends on flight type
    // Use canonical field names: depActual/depPlanned/arrActual/arrPlanned
    const depTimeEl = tr.querySelector(".js-edit-dep-time");
    const arrTimeEl = tr.querySelector(".js-edit-arr-time");
    if (ft === "DEP" || ft === "LOC") {
      enableInlineEdit(depTimeEl, m.id, m.depActual ? "depActual" : "depPlanned", "time");
    }
    if (ft === "ARR" || ft === "LOC") {
      enableInlineEdit(arrTimeEl, m.id, m.arrActual ? "arrActual" : "arrPlanned", "time");
    }
    if (ft === "OVR") {
      enableInlineEdit(depTimeEl, m.id, m.depActual ? "depActual" : "depPlanned", "time");
    }

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

function openNewFlightModal(flightType = "DEP") {
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
          </div>
          <div class="modal-field">
            <label class="modal-label">WTC</label>
            <select id="newWtc" class="modal-input"></select>
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
          </div>
          <div class="modal-field">
            <label class="modal-label">Arrival AD</label>
            <input id="newArrAd" class="modal-input" placeholder="EGOS" value="${flightType === "ARR" || flightType === "LOC" ? "EGOW" : ""}" />
          </div>
        </div>
      </section>

      <!-- Times Section -->
      <section class="modal-section">
        <h3 class="modal-section-title">Times</h3>
        <div class="modal-section-grid">
          <div class="modal-field">
            <label class="modal-label">Date of Flight</label>
            <input id="newDOF" type="date" class="modal-input" value="${getTodayDateString()}" />
          </div>
          <div class="modal-field">
            <label class="modal-label">
              <input type="checkbox" id="showLocalTimeToggle" style="margin-right: 4px;" />
              Times shown in: <strong id="timeDisplayMode">UTC</strong>
            </label>
          </div>
          <div class="modal-field">
            <label class="modal-label">ETD</label>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input id="newDepPlanned" class="modal-input" placeholder="13:37" style="width: 80px;" />
              <span id="localDepTime" class="time-local"></span>
            </div>
          </div>
          <div class="modal-field">
            <label class="modal-label">ETA</label>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input id="newArrPlanned" class="modal-input" placeholder="16:20" style="width: 80px;" />
              <span id="localArrTime" class="time-local"></span>
            </div>
          </div>
        </div>
        <!-- Hidden checkboxes for compatibility -->
        <input type="checkbox" id="showLocalTimeDep" style="display: none;" />
        <input type="checkbox" id="showLocalTimeArr" style="display: none;" />
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
        <button class="btn btn-secondary-modal js-save-complete-flight" type="button">Save & Complete</button>
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
    regInput.addEventListener("input", () => {
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
    });
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

  // Bind local time display handlers
  const depTimeInput = document.getElementById("newDepPlanned");
  const arrTimeInput = document.getElementById("newArrPlanned");
  const showLocalDepCheck = document.getElementById("showLocalTimeDep");
  const showLocalArrCheck = document.getElementById("showLocalTimeArr");
  const showLocalToggle = document.getElementById("showLocalTimeToggle");
  const timeDisplayMode = document.getElementById("timeDisplayMode");
  const localDepSpan = document.getElementById("localDepTime");
  const localArrSpan = document.getElementById("localArrTime");

  function updateLocalDepTime() {
    if (showLocalDepCheck && showLocalDepCheck.checked && depTimeInput && localDepSpan) {
      const utcTime = depTimeInput.value;
      const localTime = convertUTCToLocal(utcTime);
      const offset = getTimezoneOffsetLabel();
      localDepSpan.textContent = localTime ? `${localTime} (${offset})` : "";
    } else if (localDepSpan) {
      localDepSpan.textContent = "";
    }
  }

  function updateLocalArrTime() {
    if (showLocalArrCheck && showLocalArrCheck.checked && arrTimeInput && localArrSpan) {
      const utcTime = arrTimeInput.value;
      const localTime = convertUTCToLocal(utcTime);
      const offset = getTimezoneOffsetLabel();
      localArrSpan.textContent = localTime ? `${localTime} (${offset})` : "";
    } else if (localArrSpan) {
      localArrSpan.textContent = "";
    }
  }

  // Wire single toggle to both hidden checkboxes
  if (showLocalToggle && showLocalDepCheck && showLocalArrCheck && timeDisplayMode) {
    showLocalToggle.addEventListener('change', () => {
      const isChecked = showLocalToggle.checked;
      showLocalDepCheck.checked = isChecked;
      showLocalArrCheck.checked = isChecked;
      timeDisplayMode.textContent = isChecked ? 'Local' : 'UTC';
      updateLocalDepTime();
      updateLocalArrTime();
    });
  }

  if (showLocalDepCheck) showLocalDepCheck.addEventListener("change", updateLocalDepTime);
  if (showLocalArrCheck) showLocalArrCheck.addEventListener("change", updateLocalArrTime);
  if (depTimeInput) depTimeInput.addEventListener("input", updateLocalDepTime);
  if (arrTimeInput) arrTimeInput.addEventListener("input", updateLocalArrTime);

  // Bind save handler with validation
  document.querySelector(".js-save-flight")?.addEventListener("click", () => {
    // Get form values
    const dof = document.getElementById("newDOF")?.value || getTodayDateString();
    let depPlanned = document.getElementById("newDepPlanned")?.value || "";
    let arrPlanned = document.getElementById("newArrPlanned")?.value || "";
    const pob = document.getElementById("newPob")?.value || "0";
    const tng = document.getElementById("newTng")?.value || "0";
    const callsignCode = document.getElementById("newCallsignCode")?.value || "";
    const flightNumber = document.getElementById("newFlightNumber")?.value || "";
    const callsign = callsignCode + flightNumber; // Combine for full callsign

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

    // Use normalized time if provided
    if (depValidation.normalized) {
      depPlanned = depValidation.normalized;
      document.getElementById("newDepPlanned").value = depPlanned;
    }

    const arrValidation = validateTime(arrPlanned);
    if (!arrValidation.valid) {
      showToast(`Arrival time: ${arrValidation.error}`, 'error');
      return;
    }

    // Use normalized time if provided
    if (arrValidation.normalized) {
      arrPlanned = arrValidation.normalized;
      document.getElementById("newArrPlanned").value = arrPlanned;
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

    // Create movement - determine initial status based on whether time is past
    const initialStatus = determineInitialStatus(selectedFlightType, dof, depPlanned, arrPlanned);
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
      depActual: "",
      arrPlanned: arrPlanned,
      arrActual: "",
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
      captain: "",
      pob: parseInt(pob, 10),
      priorityLetter: priorityLetterValue,
      remarks: remarksValue,
      warnings: warningsValue,
      notes: notesValue,
      squawk: squawkValue,
      route: routeValue,
      clearance: clearanceValue,
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

    // Validate and normalize times
    const depValidation = validateTime(depPlanned);
    if (depValidation.normalized) depPlanned = depValidation.normalized;
    const arrValidation = validateTime(arrPlanned);
    if (arrValidation.normalized) arrPlanned = arrValidation.normalized;

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
      depActual: depPlanned || currentTime,
      arrPlanned: arrPlanned,
      arrActual: arrPlanned || currentTime,
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
        <div class="modal-section-grid">
          <div class="modal-field">
            <label class="modal-label">Date of Flight</label>
            <input id="newLocDOF" type="date" class="modal-input" value="${getTodayDateString()}" />
          </div>
          <div class="modal-field">
            <label class="modal-label">
              <input type="checkbox" id="showLocalTimeLocToggle" style="margin-right: 4px;" />
              Times shown in: <strong id="locTimeDisplayMode">UTC</strong>
            </label>
          </div>
          <div class="modal-field">
            <label class="modal-label">ETD</label>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input id="newLocStart" class="modal-input" placeholder="12:30" style="width: 80px;" />
              <span id="localLocDepTime" class="time-local"></span>
            </div>
          </div>
          <div class="modal-field">
            <label class="modal-label">ETA</label>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input id="newLocEnd" class="modal-input" placeholder="13:30" style="width: 80px;" />
              <span id="localLocArrTime" class="time-local"></span>
            </div>
          </div>
        </div>
        <!-- Hidden checkboxes for compatibility -->
        <input type="checkbox" id="showLocalTimeLocDep" style="display: none;" />
        <input type="checkbox" id="showLocalTimeLocArr" style="display: none;" />
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
        <button class="btn btn-secondary-modal js-save-complete-loc" type="button">Save & Complete</button>
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
    regInput.addEventListener("input", () => {
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
    });
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

  // Wire local time display toggle (single toggle mirrors standard modal pattern)
  const depTimeInput = document.getElementById("newLocStart");
  const arrTimeInput = document.getElementById("newLocEnd");
  const showLocalDepCheck = document.getElementById("showLocalTimeLocDep");
  const showLocalArrCheck = document.getElementById("showLocalTimeLocArr");
  const showLocalToggle = document.getElementById("showLocalTimeLocToggle");
  const timeDisplayMode = document.getElementById("locTimeDisplayMode");
  const localDepSpan = document.getElementById("localLocDepTime");
  const localArrSpan = document.getElementById("localLocArrTime");

  function updateLocalLocDepTime() {
    if (showLocalDepCheck && showLocalDepCheck.checked && depTimeInput && localDepSpan) {
      const localTime = convertUTCToLocal(depTimeInput.value);
      const offset = getTimezoneOffsetLabel();
      localDepSpan.textContent = localTime ? `${localTime} (${offset})` : "";
    } else if (localDepSpan) {
      localDepSpan.textContent = "";
    }
  }

  function updateLocalLocArrTime() {
    if (showLocalArrCheck && showLocalArrCheck.checked && arrTimeInput && localArrSpan) {
      const localTime = convertUTCToLocal(arrTimeInput.value);
      const offset = getTimezoneOffsetLabel();
      localArrSpan.textContent = localTime ? `${localTime} (${offset})` : "";
    } else if (localArrSpan) {
      localArrSpan.textContent = "";
    }
  }

  if (showLocalToggle && showLocalDepCheck && showLocalArrCheck && timeDisplayMode) {
    showLocalToggle.addEventListener('change', () => {
      const isChecked = showLocalToggle.checked;
      showLocalDepCheck.checked = isChecked;
      showLocalArrCheck.checked = isChecked;
      timeDisplayMode.textContent = isChecked ? 'Local' : 'UTC';
      updateLocalLocDepTime();
      updateLocalLocArrTime();
    });
  }

  if (showLocalDepCheck) showLocalDepCheck.addEventListener("change", updateLocalLocDepTime);
  if (showLocalArrCheck) showLocalArrCheck.addEventListener("change", updateLocalLocArrTime);
  if (depTimeInput) depTimeInput.addEventListener("input", updateLocalLocDepTime);
  if (arrTimeInput) arrTimeInput.addEventListener("input", updateLocalLocArrTime);

  // Bind save handler
  document.querySelector(".js-save-loc")?.addEventListener("click", () => {
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

    const depValidation = validateTime(depPlanned);
    if (!depValidation.valid) { showToast(`Departure time: ${depValidation.error}`, 'error'); return; }
    if (depValidation.normalized) { depPlanned = depValidation.normalized; document.getElementById("newLocStart").value = depPlanned; }

    const arrValidation = validateTime(arrPlanned);
    if (!arrValidation.valid) { showToast(`Arrival time: ${arrValidation.error}`, 'error'); return; }
    if (arrValidation.normalized) { arrPlanned = arrValidation.normalized; document.getElementById("newLocEnd").value = arrPlanned; }

    const pobValidation = validateNumberRange(pob, 0, 999, "POB");
    if (!pobValidation.valid) { showToast(pobValidation.error, 'error'); return; }

    const tngValidation = validateNumberRange(tng, 0, 99, "T&G count");
    if (!tngValidation.valid) { showToast(tngValidation.error, 'error'); return; }

    const callsignValidation = validateRequired(callsignCode, "Callsign Code");
    if (!callsignValidation.valid) { showToast(callsignValidation.error, 'error'); return; }

    const egowCode = document.getElementById("newLocEgowCode")?.value?.toUpperCase().trim() || "";
    const validEgowCodes = ["VC", "VM", "BC", "BM", "VCH", "VMH", "VNH"];
    if (egowCode && !validEgowCodes.includes(egowCode)) { showToast(`EGOW Code must be one of: ${validEgowCodes.join(', ')}`, 'error'); return; }

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

    const initialStatus = determineInitialStatus("LOC", dof, depPlanned, arrPlanned);
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
      depActual: "",
      arrPlanned: arrPlanned,
      arrActual: "",
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

    const depValidation = validateTime(depPlanned);
    if (depValidation.normalized) depPlanned = depValidation.normalized;
    const arrValidation = validateTime(arrPlanned);
    if (arrValidation.normalized) arrPlanned = arrValidation.normalized;

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
      depActual: depPlanned || currentTime,
      arrPlanned: arrPlanned,
      arrActual: arrPlanned || currentTime,
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
          </div>
          <div class="modal-field">
            <label class="modal-label">WTC</label>
            <input id="editWtcDisplay" class="modal-input is-derived" value="${escapeHtml(m.wtc || "")}" disabled />
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
          </div>
          <div class="modal-field">
            <label class="modal-label">Arrival AD</label>
            <input id="editArrAd" class="modal-input" value="${escapeHtml(m.arrAd || "")}" ${flightType === "LOC" ? "disabled" : ""} />
          </div>
        </div>
      </section>

      <!-- Times Section -->
      <section class="modal-section">
        <h3 class="modal-section-title">Times</h3>
        <div class="modal-section-grid">
          <div class="modal-field">
            <label class="modal-label">Date of Flight (DOF)</label>
            <input id="editDOF" type="date" class="modal-input" value="${m.dof || getTodayDateString()}" />
          </div>
          <div class="modal-field"></div>
          <div class="modal-field">
            <label class="modal-label">ETD</label>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input id="editDepPlanned" class="modal-input" value="${m.depPlanned || ""}" style="width: 80px;" />
              <label style="font-size: 10px; color: #666; cursor: pointer;">
                <input type="checkbox" id="showLocalTimeEditDep" style="margin: 0 4px;" />
                <span id="localEditDepTime" class="time-local"></span>
              </label>
            </div>
          </div>
          <div class="modal-field">
            <label class="modal-label">ATD</label>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input id="editDepActual" class="modal-input" value="${m.depActual || ""}" style="width: 80px;" />
              <label style="font-size: 10px; color: #666; cursor: pointer;">
                <input type="checkbox" id="showLocalTimeEditDepActual" style="margin: 0 4px;" />
                <span id="localEditDepActualTime" class="time-local"></span>
              </label>
            </div>
          </div>
          <div class="modal-field">
            <label class="modal-label">ETA</label>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input id="editArrPlanned" class="modal-input" value="${m.arrPlanned || ""}" style="width: 80px;" />
              <label style="font-size: 10px; color: #666; cursor: pointer;">
                <input type="checkbox" id="showLocalTimeEditArr" style="margin: 0 4px;" />
                <span id="localEditArrTime" class="time-local"></span>
              </label>
            </div>
          </div>
          <div class="modal-field">
            <label class="modal-label">ATA</label>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input id="editArrActual" class="modal-input" value="${m.arrActual || ""}" style="width: 80px;" />
              <label style="font-size: 10px; color: #666; cursor: pointer;">
                <input type="checkbox" id="showLocalTimeEditArrActual" style="margin: 0 4px;" />
                <span id="localEditArrActualTime" class="time-local"></span>
              </label>
            </div>
          </div>
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
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost js-close-modal" type="button">Cancel</button>
      <div style="display: flex; gap: 8px;">
        <button class="btn btn-secondary-modal js-save-complete-edit" type="button">Save & Complete</button>
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

  // When registration is entered, auto-fill type, fixed callsign/flight number, and EGOW code
  if (regInput && typeInput) {
    regInput.addEventListener("input", () => {
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
    });
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

  // Bind local time display handlers for all time fields
  const depPlannedInput = document.getElementById("editDepPlanned");
  const depActualInput = document.getElementById("editDepActual");
  const arrPlannedInput = document.getElementById("editArrPlanned");
  const arrActualInput = document.getElementById("editArrActual");

  const showLocalDepPlannedCheck = document.getElementById("showLocalTimeEditDep");
  const showLocalDepActualCheck = document.getElementById("showLocalTimeEditDepActual");
  const showLocalArrPlannedCheck = document.getElementById("showLocalTimeEditArr");
  const showLocalArrActualCheck = document.getElementById("showLocalTimeEditArrActual");

  const localDepPlannedSpan = document.getElementById("localEditDepTime");
  const localDepActualSpan = document.getElementById("localEditDepActualTime");
  const localArrPlannedSpan = document.getElementById("localEditArrTime");
  const localArrActualSpan = document.getElementById("localEditArrActualTime");

  function updateLocalTime(checkbox, input, span) {
    if (checkbox && checkbox.checked && input && span) {
      const utcTime = input.value;
      const localTime = convertUTCToLocal(utcTime);
      const offset = getTimezoneOffsetLabel();
      span.textContent = localTime ? `Local: ${localTime} (${offset})` : "";
    } else if (span) {
      span.textContent = "";
    }
  }

  if (showLocalDepPlannedCheck) {
    showLocalDepPlannedCheck.addEventListener("change", () =>
      updateLocalTime(showLocalDepPlannedCheck, depPlannedInput, localDepPlannedSpan));
  }
  if (depPlannedInput) {
    depPlannedInput.addEventListener("input", () =>
      updateLocalTime(showLocalDepPlannedCheck, depPlannedInput, localDepPlannedSpan));
  }

  if (showLocalDepActualCheck) {
    showLocalDepActualCheck.addEventListener("change", () =>
      updateLocalTime(showLocalDepActualCheck, depActualInput, localDepActualSpan));
  }
  if (depActualInput) {
    depActualInput.addEventListener("input", () =>
      updateLocalTime(showLocalDepActualCheck, depActualInput, localDepActualSpan));
  }

  if (showLocalArrPlannedCheck) {
    showLocalArrPlannedCheck.addEventListener("change", () =>
      updateLocalTime(showLocalArrPlannedCheck, arrPlannedInput, localArrPlannedSpan));
  }
  if (arrPlannedInput) {
    arrPlannedInput.addEventListener("input", () =>
      updateLocalTime(showLocalArrPlannedCheck, arrPlannedInput, localArrPlannedSpan));
  }

  if (showLocalArrActualCheck) {
    showLocalArrActualCheck.addEventListener("change", () =>
      updateLocalTime(showLocalArrActualCheck, arrActualInput, localArrActualSpan));
  }
  if (arrActualInput) {
    arrActualInput.addEventListener("input", () =>
      updateLocalTime(showLocalArrActualCheck, arrActualInput, localArrActualSpan));
  }

  // Auto-update ETA when ETD changes
  if (depPlannedInput && arrPlannedInput) {
    depPlannedInput.addEventListener("input", () => {
      const etd = depPlannedInput.value;
      const eta = arrPlannedInput.value;

      if (etd && etd.trim() !== "") {
        const etdMinutes = timeToMinutes(etd);
        const etaMinutes = timeToMinutes(eta);

        // If ETA is not set or ETA is before ETD, set ETA to ETD + 20 minutes
        if (!eta || eta.trim() === "" || etaMinutes <= etdMinutes) {
          arrPlannedInput.value = addMinutesToTime(etd, 20);
          updateLocalTime(showLocalArrPlannedCheck, arrPlannedInput, localArrPlannedSpan);
        }
      }
    });
  }

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
      tngCount: parseInt(tng, 10),
      pob: parseInt(pob, 10),
      osCount: editOsCountValue,
      fisCount: editFisCountValue,
      egowCode: document.getElementById("editEgowCode")?.value || "",
      unitCode: document.getElementById("editUnitCode")?.value || "",
      priorityLetter: editPriorityLetterValue,
      remarks: editRemarksValue,
      warnings: editWarningsValue,
      squawk: editSquawkValue,
      route: editRouteValue,
      clearance: editClearanceValue,
    };

    // Validate and read formation
    const editFmBase = (document.getElementById("editCallsignCode")?.value?.trim() || "") +
                       (document.getElementById("editFlightNumber")?.value?.trim() || "");
    const editFm = readFormationFromModal(editFmBase, "editFormationCount", "editFormationElementsContainer");
    if (editFm?._error) { showToast(editFm.message, 'error'); return; }
    updates.formation = editFm;

    updateMovement(m.id, updates);

    // Sync back to booking if this strip is linked
    onMovementUpdated(m);

    renderLiveBoard();
    renderHistoryBoard();
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

    // Normalize times
    const depPlannedValidation = validateTime(depPlanned);
    if (depPlannedValidation.normalized) depPlanned = depPlannedValidation.normalized;
    const depActualValidation = validateTime(depActual);
    if (depActualValidation.normalized) depActual = depActualValidation.normalized;
    const arrPlannedValidation = validateTime(arrPlanned);
    if (arrPlannedValidation.normalized) arrPlanned = arrPlannedValidation.normalized;
    const arrActualValidation = validateTime(arrActual);
    if (arrActualValidation.normalized) arrActual = arrActualValidation.normalized;

    // Set actual times if not provided
    if (!depActual) depActual = depPlanned || currentTime;
    if (!arrActual) arrActual = arrPlanned || currentTime;

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
      tngCount: parseInt(tng, 10),
      pob: parseInt(pob, 10),
      osCount: editOsCountValue,
      fisCount: editFisCountValue,
      egowCode: egowCode,
      unitCode: document.getElementById("editUnitCode")?.value || "",
      priorityLetter: editPriorityLetterValue,
      remarks: editRemarksValue,
      warnings: editWarningsValue,
      squawk: editSquawkValue,
      route: editRouteValue,
      clearance: editClearanceValue,
    };

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
    if (window.updateDailyStats) window.updateDailyStats();
    if (window.updateFisCounters) window.updateFisCounters();
    showToast("Movement saved and completed", 'success');

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
      <div class="modal-field">
        <label class="modal-label">Date of Flight (DOF)</label>
        <input id="dupDOF" type="date" class="modal-input" value="${getTodayDateString()}" />
      </div>
      <div class="modal-field">
        <label class="modal-label">
          Estimated Departure (ETD / ECT) - UTC
          <span style="font-size: 11px; font-weight: normal; margin-left: 8px;">
            <input type="checkbox" id="showLocalTimeDupDep" style="margin: 0 4px;"/>Show Local Time
          </span>
        </label>
        <div style="display: flex; gap: 8px; align-items: center;">
          <input id="dupDepPlanned" class="modal-input" value="${newETD}" style="width: 80px;" />
          <span id="localDupDepTime" style="font-size: 12px; color: #666;"></span>
        </div>
      </div>
      <div class="modal-field">
        <label class="modal-label">
          Estimated Arrival (ETA) - UTC
          <span style="font-size: 11px; font-weight: normal; margin-left: 8px;">
            <input type="checkbox" id="showLocalTimeDupArr" style="margin: 0 4px;"/>Show Local Time
          </span>
        </label>
        <div style="display: flex; gap: 8px; align-items: center;">
          <input id="dupArrPlanned" class="modal-input" value="${newETA}" style="width: 80px;" />
          <span id="localDupArrTime" style="font-size: 12px; color: #666;"></span>
        </div>
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

  // Bind local time display handlers
  const depTimeInput = document.getElementById("dupDepPlanned");
  const arrTimeInput = document.getElementById("dupArrPlanned");
  const showLocalDepCheck = document.getElementById("showLocalTimeDupDep");
  const showLocalArrCheck = document.getElementById("showLocalTimeDupArr");
  const localDepSpan = document.getElementById("localDupDepTime");
  const localArrSpan = document.getElementById("localDupArrTime");

  function updateLocalDepTime() {
    if (showLocalDepCheck && showLocalDepCheck.checked && depTimeInput && localDepSpan) {
      const utcTime = depTimeInput.value;
      const localTime = convertUTCToLocal(utcTime);
      const offset = getTimezoneOffsetLabel();
      localDepSpan.textContent = localTime ? `Local: ${localTime} (${offset})` : "";
    } else if (localDepSpan) {
      localDepSpan.textContent = "";
    }
  }

  function updateLocalArrTime() {
    if (showLocalArrCheck && showLocalArrCheck.checked && arrTimeInput && localArrSpan) {
      const utcTime = arrTimeInput.value;
      const localTime = convertUTCToLocal(utcTime);
      const offset = getTimezoneOffsetLabel();
      localArrSpan.textContent = localTime ? `Local: ${localTime} (${offset})` : "";
    } else if (localArrSpan) {
      localArrSpan.textContent = "";
    }
  }

  if (showLocalDepCheck) showLocalDepCheck.addEventListener("change", updateLocalDepTime);
  if (showLocalArrCheck) showLocalArrCheck.addEventListener("change", updateLocalArrTime);
  if (depTimeInput) depTimeInput.addEventListener("input", updateLocalDepTime);
  if (arrTimeInput) arrTimeInput.addEventListener("input", updateLocalArrTime);

  // Bind save handler with validation
  document.querySelector(".js-save-dup")?.addEventListener("click", () => {
    // Get form values
    const dof = document.getElementById("dupDOF")?.value || getTodayDateString();
    const depPlanned = document.getElementById("dupDepPlanned")?.value || "";
    const arrPlanned = document.getElementById("dupArrPlanned")?.value || "";
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

    const arrValidation = validateTime(arrPlanned);
    if (!arrValidation.valid) {
      showToast(`Arrival time: ${arrValidation.error}`, 'error');
      return;
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
      depActual: "",
      arrPlanned: arrPlanned,
      arrActual: "",
      dof: dof,
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

  // Calculate the reciprocal time
  let newTime = "";
  if (sourceFT === "DEP" && targetType === "ARR") {
    // DEP → ARR: Arrival time = ETD/ATD + depToArrOffsetMinutes
    const sourceTime = m.depActual || m.depPlanned || "";
    if (sourceTime) {
      newTime = addMinutesToTime(sourceTime, config.depToArrOffsetMinutes || 180);
    }
  } else if (sourceFT === "ARR" && targetType === "DEP") {
    // ARR → DEP: Departure time = ETA/ATA + arrToDepOffsetMinutes
    const sourceTime = m.arrActual || m.arrPlanned || "";
    if (sourceTime) {
      newTime = addMinutesToTime(sourceTime, config.arrToDepOffsetMinutes || 30);
    }
  }

  // Swap aerodromes - the original arrival becomes the departure and vice versa
  const newDepAd = m.arrAd || "";
  const newArrAd = m.depAd || "";
  const newDepName = getLocationName(newDepAd);
  const newArrName = getLocationName(newArrAd);

  // Get WTC for new flight type
  const wtc = getWTC(m.type || "", targetType, config.wtcSystem || "ICAO");

  // Determine time fields based on target type
  const dof = getTodayDateString();
  const depPlanned = targetType === "DEP" ? newTime : "";
  const arrPlanned = targetType === "ARR" ? newTime : "";

  // Determine initial status based on whether time is past
  const initialStatus = determineInitialStatus(targetType, dof, depPlanned, arrPlanned);

  // Create the reciprocal movement
  let movement = {
    status: initialStatus,
    flightType: targetType,
    callsignCode: m.callsignCode || "",
    callsignLabel: m.callsignLabel || "",
    callsignVoice: m.callsignVoice || "",
    registration: m.registration || "",
    operator: m.operator || "",
    type: m.type || "",
    popularName: m.popularName || "",
    rules: m.rules || "VFR",
    depAd: newDepAd,
    depName: newDepName,
    arrAd: newArrAd,
    arrName: newArrName,
    wtc: wtc,
    dof: dof,
    depPlanned: depPlanned,
    arrPlanned: arrPlanned,
    pob: m.pob || 0,
    tngCount: 0,
    osCount: 0,
    fisCount: targetType === "OVR" ? 1 : 0,
    egowCode: "",
    ssr: "",
    remarks: `Reciprocal of ${m.callsignCode || ""} ${sourceFT}`,
    warnings: m.warnings || "",
    notes: m.notes || ""
  };

  // Inherit formation (copy identity fields + depAd/arrAd; reset operational state)
  if (m.formation && Array.isArray(m.formation.elements) && m.formation.elements.length >= 2) {
    const resetElements = m.formation.elements.map(el => ({
      ...el,
      status:     "PLANNED",
      depActual:  "",
      arrActual:  ""
    }));
    const { wtcCurrent, wtcMax } = computeFormationWTC(resetElements);
    movement.formation = { ...m.formation, elements: resetElements, wtcCurrent, wtcMax };
  }

  // Enrich with auto-populated fields
  movement = enrichMovementData(movement);

  // Create the movement
  const newMovement = createMovement(movement);
  renderLiveBoard();
  renderHistoryBoard();
  if (window.updateDailyStats) window.updateDailyStats();
  if (window.updateFisCounters) window.updateFisCounters();
  showToast(`Reciprocal ${targetType} strip created`, 'success');

  // Open edit modal for the new movement so user can adjust
  if (newMovement) {
    openEditMovementModal(newMovement);
  }
}

/**
 * Transition a PLANNED movement to ACTIVE
 * Sets ATD/ACT to current time
 * Auto-updates DOF to today if flight was planned for future date
 */
function transitionToActive(id) {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const currentTime = `${hours}:${minutes}`;

  // Get today's date in YYYY-MM-DD format
  const todayStr = getTodayDateString();

  // Get the movement to check its DOF
  const movement = getMovements().find(m => m.id === id);
  const updates = {
    status: "ACTIVE",
    depActual: currentTime
  };

  // If DOF is in the future, update it to today
  if (movement && movement.dof && movement.dof > todayStr) {
    updates.dof = todayStr;
    showToast(`Flight activated early - DOF updated from ${movement.dof.split('-').reverse().join('/')} to today`, 'info');
  }

  updateMovement(id, updates);

  renderLiveBoard();
  renderHistoryBoard();
  if (window.updateDailyStats) window.updateDailyStats();
}

/**
 * Transition an ACTIVE movement to COMPLETED
 * Sets ATA to current time if not already set
 */
function transitionToCompleted(id) {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const currentTime = `${hours}:${minutes}`;

  const movement = getMovements().find(m => m.id === id);

  updateMovement(id, {
    status: "COMPLETED",
    arrActual: currentTime
  });
  // Cascade formation elements to COMPLETED
  cascadeFormationStatus(id, "COMPLETED");

  // Sync booking status
  onMovementStatusChanged(movement, 'COMPLETED');

  renderLiveBoard();
  renderHistoryBoard();
  if (window.updateDailyStats) window.updateDailyStats();
}

/**
 * Transition a movement to CANCELLED
 * Removes the strip from the Live Board and moves it to History
 */
function transitionToCancelled(id) {
  const movement = getMovements().find(m => m.id === id);
  if (!movement) return;

  // Show confirmation dialog
  const callsign = movement.callsignCode || 'this flight';
  if (!confirm(`Cancel ${callsign}? This will remove the strip from the Live Board and mark the flight as cancelled.`)) {
    return;
  }

  updateMovement(id, {
    status: "CANCELLED"
  });
  // Cascade formation elements to CANCELLED
  cascadeFormationStatus(id, "CANCELLED");

  // Sync booking status
  onMovementStatusChanged(movement, 'CANCELLED');

  showToast(`${callsign} cancelled`, 'info');
  renderLiveBoard();
  renderHistoryBoard();
  if (window.updateDailyStats) window.updateDailyStats();
}

/**
 * Permanently delete a strip (hard delete).
 * Removes the movement from storage entirely.
 * If linked to a booking, clears the booking linkage.
 */
function performDeleteStrip(movement) {
  if (!movement) return;

  const callsign = movement.callsignCode || 'this flight';
  if (!confirm(`Delete strip ${callsign} (#${movement.id})? This cannot be undone.`)) {
    return;
  }

  // If linked to a booking, clear the booking's linkedStripId
  if (movement.bookingId) {
    const booking = getBookingById(movement.bookingId);
    if (booking && booking.linkedStripId === movement.id) {
      updateBookingById(movement.bookingId, { linkedStripId: null });
    }
  }

  // Permanently remove from storage
  deleteMovement(movement.id);

  showToast(`${callsign} deleted`, 'info');
  renderLiveBoard();
  renderHistoryBoard();
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

  // Get completed and cancelled movements
  let movements = getMovements().filter(m =>
    m.status === "COMPLETED" || m.status === "CANCELLED"
  );

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
        No completed or cancelled movements in this session.
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
      arrDisplay = "-";
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
 * Get the primary time for a movement (ETD for departures/locals, ETA for arrivals,
 * ECT for overflights).
 */
function getMovementStartTime(m) {
  const ft = (m.flightType || '').toUpperCase();
  // Actual-first ordering so timeline bars reflect committed times immediately
  if (ft === 'ARR') return getATA(m) || getETA(m) || null;          // actual arrival first
  if (ft === 'OVR') return getACT(m) || getECT(m) || null;          // actual crossing first
  return getATD(m) || getETD(m) || null;                             // DEP, LOC — actual departure first
}

/**
 * Get the end time for a movement.
 * ARR/LOC: actual-first (getATA || getETA) — matches strip display semantics.
 * DEP/OVR: use raw arrActual/arrPlanned as timeline end if present
 *           (getATA/getETA are semantically restricted to ARR/LOC only).
 */
function getMovementEndTime(m) {
  const ft = (m.flightType || '').toUpperCase();
  if (ft === 'ARR' || ft === 'LOC') return getATA(m) || getETA(m) || null;
  return m.arrActual || m.arrPlanned || null;  // DEP/OVR fallback
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
    const startTimeStr = getMovementStartTime(m);
    const endTimeStr = getMovementEndTime(m);

    if (!startTimeStr) return;

    let startMinutes = timeToMinutes(startTimeStr);
    let endMinutes = timeToMinutes(endTimeStr);

    if (!Number.isFinite(startMinutes)) {
      return;
    }

    if (!Number.isFinite(startMinutes)) {
      return;
    }

    // Default duration of 60 minutes if no end time
    if (!Number.isFinite(endMinutes)) {
      endMinutes = startMinutes + 60;
    }

    // Handle overnight flights (end time < start time)
    if (endMinutes < startMinutes) {
      endMinutes += 24 * 60;
    }

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
    bar.title = `${m.callsignCode || 'Unknown'}\n${startTimeStr} - ${endTimeStr || '?'}\n${m.flightType || ''} (${m.status})`;
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
  const movements = getMovements().filter(m =>
    m.status === "COMPLETED" || m.status === "CANCELLED"
  );

  if (movements.length === 0) {
    showToast("No history movements to export", 'warning');
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
  a.download = `fdms-history-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  showToast(`Exported ${movements.length} movements to CSV`, 'success');
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

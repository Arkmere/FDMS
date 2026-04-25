// app.js
// App bootstrap: tab switching, UTC clock, and Live / History initialisation.

import {
  initLiveBoard,
  initHistoryBoard,
  renderLiveBoard,
  renderHistoryBoard,
  initHistoryExport,
  initVkbLookup,
  initAdminPanel,
  initTimeline,
  renderTimeline,
  updateTimelineNowLine,
  initCancelledSortiesLog,
  initDeletedStripsLog,
  renderDeletedStripsLog
} from "./ui_liveboard.js";

import {
  initReports,
  renderReports
} from "./ui_reports.js";

import {
  initBookingPage,
  initCalendarPage,
  renderCalendar,
  initBookingProfilesAdmin
} from "./ui_booking.js";

import { reconcileLinks } from "./services/bookingSync.js";

import {
  exportSessionJSON,
  importSessionJSON,
  resetMovementsToDemo,
  getStorageInfo,
  getStorageQuota,
  getDataCounts,
  getConfig,
  updateConfig,
  getGenericOverflightsCount,
  incrementGenericOverflights,
  decrementGenericOverflights,
  getMovements,
  isOverflight,
  runwayMovementContribution,
  egowRunwayContribution,
  getResolvedFormationMovements,
  getOperationalTimezoneOffsetHours
} from "./datamodel.js";

import {
  loadVKBData,
  getVKBStatus
} from "./vkb.js";

import { classifyMovement } from "./reporting.js";

/* -----------------------------
   Toast Notification System
------------------------------ */

/**
 * Show a toast notification
 * @param {string} message - Message to display
 * @param {string} type - Toast type: 'success', 'error', 'warning', 'info'
 * @param {number} duration - Duration in ms (0 = manual dismiss)
 */
export function showToast(message, type = 'info', duration = 4000) {
  const container = getOrCreateToastContainer();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon = getToastIcon(type);
  const closeBtn = '<button class="toast-close" aria-label="Close">×</button>';

  toast.innerHTML = `
    <div class="toast-content">
      <span class="toast-icon">${icon}</span>
      <span class="toast-message">${escapeHtml(message)}</span>
    </div>
    ${closeBtn}
  `;

  // Add to container with fade-in animation
  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.add('toast-show');
  });

  // Bind close button
  const closeButton = toast.querySelector('.toast-close');
  closeButton.addEventListener('click', () => dismissToast(toast));

  // Auto-dismiss after duration
  if (duration > 0) {
    setTimeout(() => dismissToast(toast), duration);
  }

  return toast;
}

/**
 * Dismiss a toast notification
 * @param {HTMLElement} toast - Toast element to dismiss
 */
function dismissToast(toast) {
  if (!toast || !toast.parentNode) return;

  toast.classList.remove('toast-show');
  toast.classList.add('toast-hide');

  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 300); // Match CSS transition duration
}

/**
 * Get or create toast container
 * @returns {HTMLElement} Toast container element
 */
function getOrCreateToastContainer() {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

/**
 * Get icon for toast type
 * @param {string} type - Toast type
 * @returns {string} Icon HTML
 */
function getToastIcon(type) {
  switch (type) {
    case 'success': return '✓';
    case 'error': return '✕';
    case 'warning': return '⚠';
    case 'info': return 'ℹ';
    default: return 'ℹ';
  }
}

/**
 * Show a persistent integrity banner below the nav-bar when reconcileLinks()
 * found issues (cleared/repaired/conflict counts > 0).
 * Dismissed per-session only (returns on reload).
 * @param {{ clearedMovementBookingId: number, clearedBookingLinkedStripId: number,
 *           repairedBookingLinkedStripId: number, conflicts: number,
 *           conflictList: Array }} summary
 */
function showReconcileBanner(summary) {
  if (!summary) return;
  const { clearedMovementBookingId, clearedBookingLinkedStripId,
          repairedBookingLinkedStripId, conflicts, conflictList = [] } = summary;
  const total = clearedMovementBookingId + clearedBookingLinkedStripId +
                repairedBookingLinkedStripId + conflicts;
  if (total === 0) return;

  const hasConflicts = conflicts > 0;
  const bannerType = hasConflicts ? 'warning' : 'info';

  // Build conflict rows (max 10 shown)
  const MAX_SHOWN = 10;
  const shownConflicts = conflictList.slice(0, MAX_SHOWN);
  const hiddenCount = conflictList.length - shownConflicts.length;

  const conflictRows = shownConflicts.map(c => {
    const csText = c.callsigns.map(cs => escapeHtml(cs)).join(', ');
    return `<li>Booking <strong>${escapeHtml(String(c.bookingId))}</strong> — strips: ${csText}</li>`;
  }).join('');
  const moreRow = hiddenCount > 0
    ? `<li class="reconcile-more">…and ${hiddenCount} more conflict${hiddenCount !== 1 ? 's' : ''}</li>`
    : '';

  const detailsHtml = `
    <div class="reconcile-details" id="reconcileDetails" hidden>
      <ul class="reconcile-counts">
        ${clearedMovementBookingId > 0 ? `<li>Cleared strip→booking pointer (missing booking): <strong>${clearedMovementBookingId}</strong></li>` : ''}
        ${clearedBookingLinkedStripId > 0 ? `<li>Cleared booking→strip pointer (missing or mismatched strip): <strong>${clearedBookingLinkedStripId}</strong></li>` : ''}
        ${repairedBookingLinkedStripId > 0 ? `<li>Repaired booking→strip pointer: <strong>${repairedBookingLinkedStripId}</strong></li>` : ''}
        ${conflicts > 0 ? `<li>Unresolved conflicts (multiple strips → same booking): <strong>${conflicts}</strong></li>` : ''}
      </ul>
      ${conflicts > 0 ? `<ul class="reconcile-conflict-list">${conflictRows}${moreRow}</ul>` : ''}
    </div>`;

  const banner = document.createElement('div');
  banner.id = 'reconcileBanner';
  banner.className = `reconcile-banner reconcile-banner-${bannerType}`;
  banner.setAttribute('role', 'alert');
  banner.innerHTML = `
    <div class="reconcile-banner-main">
      <span class="reconcile-banner-icon">${hasConflicts ? '⚠' : 'ℹ'}</span>
      <span class="reconcile-banner-text">
        <strong>Integrity:</strong> booking/strip reconciliation found ${total} issue${total !== 1 ? 's' : ''}.
      </span>
      <button class="reconcile-toggle-btn" aria-expanded="false" aria-controls="reconcileDetails">Details</button>
      <button class="reconcile-dismiss-btn" aria-label="Dismiss">×</button>
    </div>
    ${detailsHtml}
  `;

  // Insert between nav-bar and main.page-body
  const nav = document.querySelector('nav.nav-bar') || document.querySelector('.nav-bar');
  const main = document.querySelector('main.page-body') || document.querySelector('.page-body');
  if (main && main.parentNode) {
    main.parentNode.insertBefore(banner, main);
  } else if (document.body) {
    document.body.appendChild(banner);
  }

  // Details toggle
  const toggleBtn = banner.querySelector('.reconcile-toggle-btn');
  const detailsEl = banner.querySelector('.reconcile-details');
  toggleBtn.addEventListener('click', () => {
    const expanded = detailsEl.hasAttribute('hidden') ? false : true;
    if (expanded) {
      detailsEl.setAttribute('hidden', '');
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.textContent = 'Details';
    } else {
      detailsEl.removeAttribute('hidden');
      toggleBtn.setAttribute('aria-expanded', 'true');
      toggleBtn.textContent = 'Hide';
    }
  });

  // Dismiss (session-only)
  banner.querySelector('.reconcile-dismiss-btn').addEventListener('click', () => {
    banner.remove();
  });
}

/**
 * Escape HTML to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const BUILD_INFO = {
  appName:        'Vectair Flite',
  appVersion:     'dev',
  gitCommit:      'unknown',
  gitBranch:      'unknown',
  buildTimestamp: new Date().toISOString(),
};

const diagnostics = {
  timing: {
    initStartTime:              null,
    initCompleteTime:           null,
    lastRenderTime:             null,
    lastDiagnosticRefreshTime:  null,
  },
  bootstrap: {
    currentStage:        'not-started',
    lastSuccessfulStage: null,
    failedStage:         null,
    stageLog:            [],
  },
  errors: {
    lastErrorMessage: null,
    lastErrorSource:  null,
    lastErrorLine:    null,
    lastErrorColumn:  null,
    lastErrorStack:   null,
    lastErrorType:    null,
    lastErrorTime:    null,
    recentErrors:     [],
  },
  uiState: {
    activeTopTab:        null,
    activeHistorySubtab: null,
    activeAdminSection:  null,
    visibleModalCount:   0,
  },
  runtimeCounters: {
    renderLiveBoardCount:    0,
    renderHistoryBoardCount: 0,
    renderTimelineCount:     0,
    updateDailyStatsCount:   0,
    updateFisCountersCount:  0,
  },
};

window.__FDMS_DIAGNOSTICS__ = true;
window.__fdmsDiag = diagnostics.runtimeCounters;

function recordError(obj) {
  const entry = {
    message: obj.message || 'unknown',
    source:  obj.source  || null,
    line:    obj.line    != null ? obj.line   : null,
    column:  obj.column  != null ? obj.column : null,
    stack:   obj.stack   || null,
    type:    obj.type    || 'error',
    time:    new Date().toISOString(),
  };
  diagnostics.errors.lastErrorMessage = entry.message;
  diagnostics.errors.lastErrorSource  = entry.source;
  diagnostics.errors.lastErrorLine    = entry.line;
  diagnostics.errors.lastErrorColumn  = entry.column;
  diagnostics.errors.lastErrorStack   = entry.stack;
  diagnostics.errors.lastErrorType    = entry.type;
  diagnostics.errors.lastErrorTime    = entry.time;
  diagnostics.errors.recentErrors.unshift(entry);
  if (diagnostics.errors.recentErrors.length > 10) diagnostics.errors.recentErrors.length = 10;
}

window.addEventListener("error", (e) => {
  recordError({
    message: e.message || String(e.error || e),
    source:  e.filename || null,
    line:    e.lineno != null ? e.lineno : null,
    column:  e.colno  != null ? e.colno  : null,
    stack:   e.error?.stack || null,
    type:    'error',
  });
  updateDiagnostics();
  showToast(`Error: ${diagnostics.errors.lastErrorMessage}`, 'error', 6000);
});

window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason;
  recordError({
    message: String(reason?.message || reason || e),
    source:  null,
    line:    null,
    column:  null,
    stack:   reason?.stack || null,
    type:    'unhandledrejection',
  });
  updateDiagnostics();
  showToast(`Promise error: ${diagnostics.errors.lastErrorMessage}`, 'error', 6000);
});

/**
 * Configuration for tab behaviour.
 * Must match index.html:
 * - buttons: .nav-tab with data-tab="tab-live" etc
 * - panels:  .tab-panel with id="tab-live" etc
 * - hidden:  panels hidden via .hidden class
 */
const TAB = {
  BUTTON_SELECTOR: ".nav-tab",
  PANEL_SELECTOR: ".tab-panel",
  ACTIVE_CLASS: "active",
  HIDDEN_CLASS: "hidden",
  DEFAULT_PANEL_ID: "tab-live"
};

/**
 * Optional on-screen error overlay for environments without DevTools.
 * Enable by setting ENABLE_ERROR_OVERLAY = true.
 */
const ENABLE_ERROR_OVERLAY = false;

function $(selector, root = document) {
  return root.querySelector(selector);
}

function $all(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

function setActiveTab(panelId) {
  const buttons = $all(TAB.BUTTON_SELECTOR);
  const panels = $all(TAB.PANEL_SELECTOR);

  // If the requested panel doesn't exist, fall back to default.
  const targetPanel = document.getElementById(panelId) || document.getElementById(TAB.DEFAULT_PANEL_ID);
  const targetId = targetPanel ? targetPanel.id : null;

  // Update button active state
  buttons.forEach((btn) => {
    btn.classList.toggle(TAB.ACTIVE_CLASS, btn.dataset.tab === targetId);
  });

  // Show/hide panels via the CSS class contract
  panels.forEach((panel) => {
    const isTarget = targetId && panel.id === targetId;
    panel.classList.toggle(TAB.HIDDEN_CLASS, !isTarget);
  });

  // Re-render reports when Reports tab is opened to ensure data freshness
  if (targetId === 'tab-reports') {
    renderReports();
  }
}

function initTabs() {
  const buttons = $all(TAB.BUTTON_SELECTOR);

  // Bind clicks
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      if (target) setActiveTab(target);
    });
  });

  // Ensure a sane initial view, regardless of HTML default classes
  setActiveTab(TAB.DEFAULT_PANEL_ID);
}

function initClock() {
  const utcTimeEl = document.getElementById("utcTime");
  const localTimeEl = document.getElementById("localTime");
  const localTimeLineEl = document.getElementById("localTimeLine");
  const dateDisplayEl = document.getElementById("dateDisplay");

  if (!utcTimeEl || !dateDisplayEl) return;

  const updateClock = () => {
    const now = new Date();

    // UTC time
    const utcHh = String(now.getUTCHours()).padStart(2, "0");
    const utcMm = String(now.getUTCMinutes()).padStart(2, "0");
    const utcSs = String(now.getUTCSeconds()).padStart(2, "0");
    utcTimeEl.textContent = `${utcHh}:${utcMm}:${utcSs}`;

    // Date (DD/MM/YY format)
    const yyyy = now.getUTCFullYear();
    const yy = String(yyyy).slice(-2);
    const mon = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    dateDisplayEl.textContent = `${dd}/${mon}/${yy}`;

    // Local time (conditional display)
    if (localTimeEl && localTimeLineEl) {
      const cfg = getConfig();
      const offsetHours = getOperationalTimezoneOffsetHours();

      // Calculate local time
      const localTime = new Date(now.getTime() + (offsetHours * 60 * 60 * 1000));
      const localHh = String(localTime.getUTCHours()).padStart(2, "0");
      const localMm = String(localTime.getUTCMinutes()).padStart(2, "0");
      const localSs = String(localTime.getUTCSeconds()).padStart(2, "0");
      localTimeEl.textContent = `${localHh}:${localMm}:${localSs}`;

      // Determine visibility using canonical offset (not raw config value)
      const isSameAsUtc = offsetHours === 0;
      const hideIfSame = cfg.hideLocalTimeInBannerIfSame || false;
      const alwaysHide = cfg.alwaysHideLocalTimeInBanner || false;

      if (alwaysHide) {
        localTimeLineEl.style.display = 'none';
      } else if (hideIfSame && isSameAsUtc) {
        localTimeLineEl.style.display = 'none';
      } else {
        localTimeLineEl.style.display = '';
      }
    }

    // Update timeline now line position
    updateTimelineNowLine();
  };

  updateClock();
  window.setInterval(updateClock, 1000); // Update every second for seconds display
}

function initErrorOverlay() {
  if (!ENABLE_ERROR_OVERLAY) return;

  const show = (label, message) => {
    const el = document.createElement("div");
    el.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;background:#300;color:#fff;padding:10px;" +
      "font:12px/1.4 monospace;z-index:99999;white-space:pre-wrap";
    el.textContent = `${label}\n${message}`;
    document.body.appendChild(el);
  };

  window.addEventListener("error", (e) => {
    show("JS error:", e?.message || String(e?.error || e));
  });

  window.addEventListener("unhandledrejection", (e) => {
    show("Promise rejection:", String(e?.reason || e));
  });
}

/**
 * Update diagnostics panel with current system state
 */
function updateDiagnostics() {
  const storageInfo = getStorageInfo();
  const storageQuota = getStorageQuota();

  const initTimeEl = document.getElementById("diagInitTime");
  const renderTimeEl = document.getElementById("diagRenderTime");
  const storageKeyEl = document.getElementById("diagStorageKey");
  const movementCountEl = document.getElementById("diagMovementCount");
  const lastErrorEl = document.getElementById("diagLastError");
  const storageUsageEl = document.getElementById("diagStorageUsage");

  if (initTimeEl) initTimeEl.textContent = diagnostics.timing.initCompleteTime || "—";
  if (renderTimeEl) renderTimeEl.textContent = diagnostics.timing.lastRenderTime || "—";
  if (storageKeyEl) storageKeyEl.textContent = storageInfo.key || "—";
  if (movementCountEl) movementCountEl.textContent = String(storageInfo.movementCount);
  if (lastErrorEl) lastErrorEl.textContent = diagnostics.errors.lastErrorMessage || "None";

  // Update storage usage if element exists
  if (storageUsageEl) {
    const usedKB = (storageQuota.used / 1024).toFixed(1);
    const quotaMB = (storageQuota.quota / (1024 * 1024)).toFixed(1);
    const percentage = storageQuota.percentage;

    let color = "#4caf50"; // green
    if (percentage > 80) color = "#f44336"; // red
    else if (percentage > 60) color = "#ff9800"; // orange

    storageUsageEl.innerHTML = `
      <span style="color: ${color}; font-weight: bold;">${usedKB} KB used</span>
      (${percentage}% of ${quotaMB} MB)
    `;

    // Warn if storage is getting full
    if (percentage > 80 && !storageUsageEl.dataset.warned) {
      showToast(`Storage is ${percentage}% full. Consider exporting and clearing old data.`, 'warning', 8000);
      storageUsageEl.dataset.warned = "true";
    }
  }
}

function updateInitStatus(message, isComplete = false) {
  const statusEl = document.getElementById("initStatus");
  if (!statusEl) return;

  if (isComplete) {
    statusEl.style.background = "#e8f5e9";
    statusEl.style.borderColor = "#4caf50";
    statusEl.innerHTML = `<strong>✅ ${message}</strong>`;
  } else {
    statusEl.style.background = "#fff3e0";
    statusEl.style.borderColor = "#ff9800";
    statusEl.innerHTML = `<strong>⏳ ${message}</strong>`;
  }
}

/**
 * Show a lightweight inline confirmation dialog.
 * @param {string} message       - Plain-text message (safely escaped)
 * @param {Function} onConfirm   - Called when user confirms (no-op if confirmEnabled=false)
 * @param {string} [detailsHtml] - Optional pre-sanitised HTML rendered below message
 * @param {boolean} [confirmEnabled] - When false, Confirm button is disabled
 */
function adminConfirm(message, onConfirm, detailsHtml = '', confirmEnabled = true) {
  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:2000;display:flex;align-items:center;justify-content:center;';

  const dialog = document.createElement('div');
  dialog.style.cssText = 'background:#fff;border-radius:6px;padding:24px 24px 20px;max-width:480px;width:90%;box-shadow:0 4px 24px rgba(0,0,0,0.25);';

  // Use textContent for the main message to prevent XSS
  const messageDiv = document.createElement('div');
  messageDiv.style.cssText = 'font-size:13px;line-height:1.5;margin-bottom:' + (detailsHtml ? '12px' : '18px') + ';';
  messageDiv.textContent = message;
  dialog.appendChild(messageDiv);

  if (detailsHtml) {
    const detailsDiv = document.createElement('div');
    detailsDiv.style.cssText = 'margin-bottom:18px;';
    detailsDiv.innerHTML = detailsHtml; // caller is responsible for safe content
    dialog.appendChild(detailsDiv);
  }

  const buttonsDiv = document.createElement('div');
  buttonsDiv.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
  buttonsDiv.innerHTML = `
    <button class="btn btn-secondary" id="_adminConfirmCancel">Cancel</button>
    <button class="btn btn-danger" id="_adminConfirmOk"${confirmEnabled ? '' : ' disabled style="opacity:0.5;cursor:not-allowed;"'}>Confirm</button>
  `;
  dialog.appendChild(buttonsDiv);

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  const cleanup = () => { if (backdrop.parentNode) document.body.removeChild(backdrop); };

  dialog.querySelector('#_adminConfirmCancel').addEventListener('click', cleanup);
  const okBtn = dialog.querySelector('#_adminConfirmOk');
  if (confirmEnabled) {
    okBtn.addEventListener('click', () => { cleanup(); onConfirm(); });
  }
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) cleanup(); });
}

/**
 * Initialise History subtab switching (Ticket 6a).
 * Three subpages: Movement History (default), Cancelled Sorties, Deleted Strips.
 */
function initHistorySubtabs() {
  const bar = document.getElementById('historySubtabBar');
  if (!bar) return;

  const btns = bar.querySelectorAll('.history-subtab-btn');
  const subpages = document.querySelectorAll('.history-subpage');

  function showSubpage(subpageId) {
    btns.forEach(b => b.classList.toggle('active', b.dataset.subpage === subpageId));
    subpages.forEach(p => p.classList.toggle('hidden', p.id !== subpageId));
  }

  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      showSubpage(btn.dataset.subpage);
      // Re-render Deleted Strips on tab activation to purge expired entries
      if (btn.dataset.subpage === 'hist-subpage-deleted') {
        renderDeletedStripsLog();
      }
    });
  });
}

function logBootstrapStage(label, status, detail = null) {
  const entry = { time: new Date().toISOString(), label, status, detail };
  diagnostics.bootstrap.stageLog.push(entry);
  diagnostics.bootstrap.currentStage = label;
  if (status === 'success') diagnostics.bootstrap.lastSuccessfulStage = label;
  if (status === 'failed')  diagnostics.bootstrap.failedStage = label;
}

function runStage(label, fn) {
  logBootstrapStage(label, 'started');
  try {
    fn();
    logBootstrapStage(label, 'success');
  } catch (e) {
    logBootstrapStage(label, 'failed', e.message || String(e));
    throw e;
  }
}

function generateDiagnosticReport() {
  const now = new Date();
  const storageInfo  = getStorageInfo();
  const storageQuota = getStorageQuota();
  const counts       = getDataCounts();
  const cfg          = getConfig();

  const usedKB  = (storageQuota.used / 1024).toFixed(1);
  const quotaMB = (storageQuota.quota / (1024 * 1024)).toFixed(1);
  const runtimeMode = location.protocol === 'file:' ? 'desktop-local' : 'browser';

  const activeTabBtn    = document.querySelector('.nav-tab.active');
  const activeHistBtn   = document.querySelector('.history-subtab-btn.active');
  const activeAdminBtn  = document.querySelector('.admin-nav-btn.active');
  const visibleModals   = document.querySelectorAll('.modal:not(.hidden), [role="dialog"]:not(.hidden)').length;

  const P = 28;
  const f = (label, value) => `${label.padEnd(P)}${value ?? 'none'}`;

  const bsLog = diagnostics.bootstrap.stageLog.length > 0
    ? diagnostics.bootstrap.stageLog
        .map(e => `  ${e.time}  ${e.status.padEnd(9)}${e.label}${e.detail ? '  // ' + e.detail : ''}`)
        .join('\n')
    : '  (no entries)';

  const recentErrLines = diagnostics.errors.recentErrors.length > 0
    ? diagnostics.errors.recentErrors.map((e, i) =>
        `  [${i + 1}] ${e.time}  type:${e.type}\n       msg: ${e.message}` +
        (e.source ? `\n       at:  ${e.source}${e.line != null ? ':' + e.line : ''}` : '')
      ).join('\n')
    : '  (none)';

  const lines = [
    '==== VECTAIR FLITE DIAGNOSTIC REPORT ====',
    f('generated:', now.toISOString()),
    '',
    '[BUILD]',
    f('app_name:', BUILD_INFO.appName),
    f('app_version:', BUILD_INFO.appVersion),
    f('git_commit:', BUILD_INFO.gitCommit),
    f('git_branch:', BUILD_INFO.gitBranch),
    f('build_timestamp:', BUILD_INFO.buildTimestamp),
    '',
    '[TIMING]',
    f('init_start:', diagnostics.timing.initStartTime || 'not available'),
    f('init_complete:', diagnostics.timing.initCompleteTime || 'not available'),
    f('last_render:', diagnostics.timing.lastRenderTime || 'not available'),
    f('last_diag_refresh:', diagnostics.timing.lastDiagnosticRefreshTime || 'not available'),
    '',
    '[BOOTSTRAP]',
    f('current_stage:', diagnostics.bootstrap.currentStage),
    f('last_successful_stage:', diagnostics.bootstrap.lastSuccessfulStage || 'none'),
    f('failed_stage:', diagnostics.bootstrap.failedStage || 'none'),
    '',
    '[BOOTSTRAP_LOG]',
    bsLog,
    '',
    '[RUNTIME]',
    f('runtime_mode:', runtimeMode),
    f('protocol:', location.protocol),
    f('origin:', location.origin || 'null'),
    f('pathname:', location.pathname),
    f('url:', location.href),
    f('user_agent:', navigator.userAgent),
    '',
    '[DATA_STORAGE]',
    f('schema_version:', storageInfo.version),
    f('storage_key:', storageInfo.key),
    f('movements:', counts.movements),
    f('calendar_events:', counts.calendarEvents),
    f('booking_profiles:', counts.bookingProfiles),
    f('cancelled_sorties:', counts.cancelledSorties),
    f('deleted_strips:', counts.deletedStrips),
    f('storage_used_kb:', usedKB),
    f('storage_used_pct:', storageQuota.percentage + '%'),
    f('storage_quota_mb:', quotaMB),
    '',
    '[UI_STATE]',
    f('active_top_tab:', activeTabBtn   ? (activeTabBtn.dataset.tab      || 'none') : 'none'),
    f('active_history_subtab:', activeHistBtn  ? (activeHistBtn.dataset.subpage   || 'none') : 'none'),
    f('active_admin_section:', activeAdminBtn ? (activeAdminBtn.dataset.section  || 'none') : 'none'),
    f('visible_modals:', visibleModals),
    f('page_url:', location.href),
    '',
    '[ERRORS]',
    f('last_error_message:', diagnostics.errors.lastErrorMessage || 'none'),
    f('last_error_type:', diagnostics.errors.lastErrorType || 'none'),
    f('last_error_time:', diagnostics.errors.lastErrorTime || 'none'),
    f('last_error_source:', diagnostics.errors.lastErrorSource || 'none'),
    f('last_error_line_col:', diagnostics.errors.lastErrorLine != null
        ? `${diagnostics.errors.lastErrorLine}:${diagnostics.errors.lastErrorColumn ?? '?'}`
        : 'none'),
    '',
    '[RECENT_ERRORS]',
    recentErrLines,
    '',
    '[COUNTERS]',
    f('render_live_board:', diagnostics.runtimeCounters.renderLiveBoardCount),
    f('render_history_board:', diagnostics.runtimeCounters.renderHistoryBoardCount),
    f('render_timeline:', diagnostics.runtimeCounters.renderTimelineCount),
    f('update_daily_stats:', diagnostics.runtimeCounters.updateDailyStatsCount),
    f('update_fis_counters:', diagnostics.runtimeCounters.updateFisCountersCount),
    '',
    '[CONFIG]',
    f('timezone_offset:', cfg.timezoneOffsetHours ?? 'unknown'),
    f('wtc_system:', cfg.wtcSystem ?? 'unknown'),
    f('wtc_threshold:', cfg.wtcAlertThreshold ?? 'unknown'),
    f('timeline_enabled:', cfg.timelineEnabled ?? 'unknown'),
    f('timeline_hours:', `${cfg.timelineStartHour ?? '?'}–${cfg.timelineEndHour ?? '?'} UTC`),
    f('auto_dep:', cfg.autoActivateDepEnabled ?? 'unknown'),
    f('auto_arr:', cfg.autoActivateArrEnabled ?? 'unknown'),
    f('auto_loc:', cfg.autoActivateLocEnabled ?? 'unknown'),
    f('auto_ovr:', cfg.autoActivateOvrEnabled ?? 'unknown'),
    f('show_time_labels:', cfg.showTimeLabelsOnStrip ?? 'unknown'),
    '',
    '==== END REPORT ===='
  ];

  return lines.join('\n');
}

function refreshDeveloperSection() {
  const now          = new Date();
  diagnostics.timing.lastDiagnosticRefreshTime = now.toISOString();
  const storageInfo  = getStorageInfo();
  const storageQuota = getStorageQuota();
  const counts       = getDataCounts();

  const usedKB  = (storageQuota.used / 1024).toFixed(1);
  const quotaMB = (storageQuota.quota / (1024 * 1024)).toFixed(1);
  const runtimeMode = location.protocol === 'file:' ? 'desktop-local' : 'browser';

  const activeTabBtn   = document.querySelector('.nav-tab.active');
  const activeHistBtn  = document.querySelector('.history-subtab-btn.active');
  const activeAdminBtn = document.querySelector('.admin-nav-btn.active');
  const visibleModals  = document.querySelectorAll('.modal:not(.hidden), [role="dialog"]:not(.hidden)').length;

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? '—';
  };

  // Build
  set('devAppName',        BUILD_INFO.appName);
  set('devAppVersion',     BUILD_INFO.appVersion);
  set('devGitCommit',      BUILD_INFO.gitCommit);
  set('devGitBranch',      BUILD_INFO.gitBranch);
  set('devBuildTimestamp', BUILD_INFO.buildTimestamp);

  // Timing / Bootstrap
  set('devInitStart',        diagnostics.timing.initStartTime || 'not available');
  set('devInitComplete',     diagnostics.timing.initCompleteTime || 'not available');
  set('devLastRender',       diagnostics.timing.lastRenderTime || 'not available');
  set('devLastDiagRefresh',  now.toISOString());
  set('devCurrentStage',     diagnostics.bootstrap.currentStage);
  set('devLastSuccessStage', diagnostics.bootstrap.lastSuccessfulStage || 'none');
  set('devFailedStage',      diagnostics.bootstrap.failedStage || 'none');

  // Runtime
  set('devRuntimeMode', runtimeMode);
  set('devProtocol',    location.protocol);
  set('devOrigin',      location.origin || 'null');
  set('devPathname',    location.pathname);
  set('devRuntimeURL',  location.href);

  // Data / Storage
  set('devSchemaVersion',    String(storageInfo.version));
  set('devStorageKey',       storageInfo.key);
  set('devMovementCount',    String(counts.movements));
  set('devCalendarEvents',   String(counts.calendarEvents));
  set('devBookingProfiles',  String(counts.bookingProfiles));
  set('devCancelledSorties', String(counts.cancelledSorties));
  set('devDeletedStrips',    String(counts.deletedStrips));
  set('devStorageUsed',      `${usedKB} KB  (${storageQuota.percentage}%)`);
  set('devStorageQuota',     `${quotaMB} MB`);

  // UI State
  set('devActiveTopTab',        activeTabBtn   ? (activeTabBtn.dataset.tab      || 'none') : 'none');
  set('devActiveHistorySubtab', activeHistBtn  ? (activeHistBtn.dataset.subpage  || 'none') : 'none');
  set('devActiveAdminSection',  activeAdminBtn ? (activeAdminBtn.dataset.section || 'none') : 'none');
  set('devVisibleModals',       String(visibleModals));

  // Errors
  set('devErrMessage', diagnostics.errors.lastErrorMessage || 'none');
  set('devErrType',    diagnostics.errors.lastErrorType    || 'none');
  set('devErrTime',    diagnostics.errors.lastErrorTime    || 'none');
  set('devErrSource',  diagnostics.errors.lastErrorSource  || 'none');
  set('devErrLineCol', diagnostics.errors.lastErrorLine != null
      ? `${diagnostics.errors.lastErrorLine}:${diagnostics.errors.lastErrorColumn ?? '?'}`
      : 'none');

  // Counters
  set('devCntRenderLive',    String(diagnostics.runtimeCounters.renderLiveBoardCount));
  set('devCntRenderHistory', String(diagnostics.runtimeCounters.renderHistoryBoardCount));
  set('devCntRenderTimeline',String(diagnostics.runtimeCounters.renderTimelineCount));
  set('devCntDailyStats',    String(diagnostics.runtimeCounters.updateDailyStatsCount));
  set('devCntFisCounters',   String(diagnostics.runtimeCounters.updateFisCountersCount));

  // Bootstrap Log
  const bsLogEl = document.getElementById('devBootstrapLog');
  if (bsLogEl) {
    bsLogEl.textContent = diagnostics.bootstrap.stageLog.length > 0
      ? diagnostics.bootstrap.stageLog
          .map(e => `${e.time}  ${e.status.padEnd(9)}${e.label}${e.detail ? '  // ' + e.detail : ''}`)
          .join('\n')
      : '(no entries)';
  }

  // Recent Errors
  const recentErrsEl = document.getElementById('devRecentErrors');
  if (recentErrsEl) {
    recentErrsEl.textContent = diagnostics.errors.recentErrors.length > 0
      ? diagnostics.errors.recentErrors.map((e, i) =>
          `[${i + 1}] ${e.time}  type:${e.type}\n    msg: ${e.message}` +
          (e.source ? `\n    at:  ${e.source}${e.line != null ? ':' + e.line : ''}` : '')
        ).join('\n\n')
      : '(none)';
  }

  // Diagnostic Report
  const outputEl = document.getElementById('devDiagnosticOutput');
  if (outputEl) outputEl.textContent = generateDiagnosticReport();
}

function initAdminPanelHandlers() {
  // ── Section navigation ─────────────────────────────────────────
  const navBtns = document.querySelectorAll('.admin-nav-btn');
  const sections = document.querySelectorAll('.admin-section');
  const adminSaveBar = document.getElementById('adminSaveBar');

  // Sections that show the sticky Save bar (config sections 3–7)
  const CONFIG_SECTIONS = new Set([
    'admin-sec-offsets',
    'admin-sec-autoactivate',
    'admin-sec-timezone',
    'admin-sec-wtc',
    'admin-sec-history'
  ]);

  function showAdminSection(sectionId) {
    navBtns.forEach(b => b.classList.toggle('active', b.dataset.section === sectionId));
    sections.forEach(s => s.classList.toggle('hidden', s.id !== sectionId));
    if (adminSaveBar) {
      adminSaveBar.classList.toggle('hidden', !CONFIG_SECTIONS.has(sectionId));
    }
  }

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => showAdminSection(btn.dataset.section));
  });

  // ── Session export ─────────────────────────────────────────────
  const btnExport = document.getElementById("btnExportSession");
  if (btnExport) {
    btnExport.addEventListener("click", () => {
      try {
        const rawData = exportSessionJSON();

        // Compute counts from the payload
        const movementsCount = Array.isArray(rawData.movements) ? rawData.movements.length : 0;
        const bookingsCount  = Array.isArray(rawData.bookings)  ? rawData.bookings.length  : 0;
        const profilesCount  = Array.isArray(rawData.bookingProfiles) ? rawData.bookingProfiles.length : 0;

        // Wrap in v1.2 envelope
        const envelope = {
          fdmsBackup: {
            schemaVersion: 1,
            createdAtUtc: new Date().toISOString(),
            createdBy: { app: "Vectair FDMS Lite", gitCommit: "unknown", host: "local" },
            counts: { movements: movementsCount, bookings: bookingsCount, bookingProfiles: profilesCount }
          },
          payload: rawData
        };

        // Timestamped filename: fdms_backup_YYYYMMDD_HHMMZ.json
        const now = new Date();
        const pad2 = (n) => String(n).padStart(2, '0');
        const ts = `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}_${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}Z`;
        const filename = `fdms_backup_${ts}.json`;

        const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        showToast("Backup created successfully", 'success');
      } catch (e) {
        showToast(`Backup failed: ${e.message}`, 'error');
      }
    });
  }

  // ── Danger Zone: Restore from JSON ────────────────────────────
  // Flow: button click → open file picker → file selected → parse →
  //       detect format (new envelope / old v2 / old v1) → show preflight
  //       summary with metadata in confirm dialog → on confirm → import.
  const btnImport = document.getElementById("btnImportSession");
  const fileInput = document.getElementById("importFileInput");

  if (btnImport && fileInput) {
    // Open file picker directly — confirmation comes after file selection
    btnImport.addEventListener("click", () => { fileInput.click(); });

    fileInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      fileInput.value = ""; // reset so the same file can be re-selected if needed

      const reader = new FileReader();
      reader.onload = (ev) => {
        let dataForImport = null; // unwrapped payload passed to importSessionJSON
        let summaryHtml = '';
        let confirmEnabled = true;

        try {
          const parsed = JSON.parse(ev.target.result);

          // ── Format detection ──────────────────────────────────────
          // New envelope: { fdmsBackup: {...}, payload: {...} }
          // Old v2:       { version: number, movements: [...] }
          // Old v1:       bare array of movements
          // Anything else: unrecognized → block confirm
          let format = 'unrecognized';
          let meta = null;

          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
              && parsed.fdmsBackup && parsed.payload) {
            format = 'envelope';
            meta = parsed.fdmsBackup;
            dataForImport = parsed.payload;
          } else if (Array.isArray(parsed)) {
            format = 'v1';
            dataForImport = parsed;
          } else if (parsed && typeof parsed === 'object'
                     && typeof parsed.version === 'number'
                     && Array.isArray(parsed.movements)) {
            format = 'v2';
            dataForImport = parsed;
          }

          if (format === 'unrecognized') {
            confirmEnabled = false;
            summaryHtml = `
              <div style="background:#fff3f3;border:1px solid #ffcdd2;border-radius:4px;padding:10px 12px;font-size:12px;color:#c62828;">
                Unrecognized file structure — this does not appear to be an FDMS backup. Confirm is blocked.
              </div>`;
          } else {
            // ── Resolve counts ────────────────────────────────────
            const payload = (format === 'envelope') ? dataForImport : dataForImport;
            const movementsCount = meta?.counts?.movements != null
              ? meta.counts.movements
              : (Array.isArray(payload?.movements) ? payload.movements.length
                 : (Array.isArray(payload) ? payload.length : '—'));
            const bookingsCount = meta?.counts?.bookings != null
              ? meta.counts.bookings
              : (Array.isArray(payload?.bookings) ? payload.bookings.length : '—');
            const profilesCount = meta?.counts?.bookingProfiles != null
              ? meta.counts.bookingProfiles
              : (Array.isArray(payload?.bookingProfiles) ? payload.bookingProfiles.length : '—');
            const hasConfig = payload?.config != null ? 'Yes' : 'No';

            // ── Format createdAt ──────────────────────────────────
            let createdAtStr = '—';
            if (meta?.createdAtUtc) {
              try {
                const d = new Date(meta.createdAtUtc);
                createdAtStr = d.toUTCString();
              } catch (_) { createdAtStr = meta.createdAtUtc; }
            }

            const schemaVersion = meta?.schemaVersion != null ? meta.schemaVersion : '—';
            const schemaLabel = format === 'envelope'
              ? `v${schemaVersion} (current)`
              : (format === 'v2' ? 'v0 (legacy v2)' : 'v0 (legacy v1)');

            // ── Warning banners ───────────────────────────────────
            let warningHtml = '';
            if (format !== 'envelope') {
              warningHtml += `
              <div style="background:#fff8e1;border:1px solid #ffe082;border-radius:4px;padding:8px 12px;font-size:12px;color:#6d4c00;margin-bottom:6px;">
                ⚠ Legacy backup format detected. Metadata (timestamp, counts) is unavailable.
              </div>`;
            } else if (typeof schemaVersion === 'number' && schemaVersion > 1) {
              warningHtml += `
              <div style="background:#fff8e1;border:1px solid #ffe082;border-radius:4px;padding:8px 12px;font-size:12px;color:#6d4c00;margin-bottom:6px;">
                ⚠ This backup was created by a newer version of FDMS (schema v${schemaVersion}). Some data may not be restored.
              </div>`;
            }
            if (movementsCount === 0 || movementsCount === '0') {
              warningHtml += `
              <div style="background:#fff8e1;border:1px solid #ffe082;border-radius:4px;padding:8px 12px;font-size:12px;color:#6d4c00;margin-bottom:6px;">
                ⚠ This backup contains 0 movements.
              </div>`;
            }

            summaryHtml = `
              ${warningHtml}
              <div style="background:#f5f5f5;border-radius:4px;padding:10px 12px;font-size:12px;line-height:1.8;">
                <div><span style="color:#555;display:inline-block;width:148px;">File:</span><strong>${escapeHtml(file.name)}</strong></div>
                <div><span style="color:#555;display:inline-block;width:148px;">Created (UTC):</span><strong>${escapeHtml(createdAtStr)}</strong></div>
                <div><span style="color:#555;display:inline-block;width:148px;">Schema:</span><strong>${escapeHtml(String(schemaLabel))}</strong></div>
                <div><span style="color:#555;display:inline-block;width:148px;">Movements:</span><strong>${movementsCount}</strong></div>
                <div><span style="color:#555;display:inline-block;width:148px;">Booking profiles:</span><strong>${profilesCount}</strong></div>
                <div><span style="color:#555;display:inline-block;width:148px;">Bookings:</span><strong>${bookingsCount}</strong></div>
                <div><span style="color:#555;display:inline-block;width:148px;">Config present:</span><strong>${hasConfig}</strong></div>
              </div>`;
          }
        } catch (_parseErr) {
          confirmEnabled = false;
          summaryHtml = `
            <div style="background:#fff3f3;border:1px solid #ffcdd2;border-radius:4px;padding:10px 12px;font-size:12px;color:#c62828;">
              Unable to read file — not valid JSON. Confirm is blocked.
            </div>`;
        }

        adminConfirm(
          dataForImport
            ? `Restore will overwrite ALL current local movement data with the contents of "${file.name}". This cannot be undone.`
            : `"${file.name}" cannot be restored as FDMS backup data.`,
          () => {
            try {
              const result = importSessionJSON(dataForImport);
              if (result.success) {
                renderLiveBoard();
                renderHistoryBoard();
                renderReports();
                diagnostics.lastRenderTime = new Date().toISOString();
                updateDiagnostics();
                showToast(`Restore applied from "${file.name}" — ${result.count} movements loaded`, 'success');
              } else {
                showToast(`Restore failed: ${result.error}`, 'error');
              }
            } catch (err) {
              showToast(`Restore failed: ${err.message}`, 'error');
            }
          },
          summaryHtml,
          confirmEnabled
        );
      };
      reader.readAsText(file);
    });
  }

  // ── Danger Zone: Reset to Demo ────────────────────────────────
  const btnResetToDemo = document.getElementById("btnResetToDemo");
  if (btnResetToDemo) {
    btnResetToDemo.addEventListener("click", () => {
      adminConfirm(
        "This will replace all current movement strips with the built-in demo seed data. Configuration settings (offsets, timezone, etc.) are not affected. This cannot be undone.",
        () => {
          try {
            resetMovementsToDemo();
            renderLiveBoard();
            renderHistoryBoard();
            renderReports();
            diagnostics.lastRenderTime = new Date().toISOString();
            updateDiagnostics();
            showToast("Reset to demo data complete", 'success');
          } catch (e) {
            showToast(`Reset failed: ${e.message}`, 'error');
          }
        }
      );
    });
  }

  // ── Configuration inputs ───────────────────────────────────────
  const configDepOffset = document.getElementById("configDepOffset");
  const configDepDuration = document.getElementById("configDepDuration");
  const configArrOffset = document.getElementById("configArrOffset");
  const configArrDuration = document.getElementById("configArrDuration");
  const configLocOffset = document.getElementById("configLocOffset");
  const configLocDuration = document.getElementById("configLocDuration");
  const configOvrOffset = document.getElementById("configOvrOffset");
  const configOvrDuration = document.getElementById("configOvrDuration");
  const configTimezoneOffset = document.getElementById("configTimezoneOffset");
  const configHideLocalIfSame = document.getElementById("configHideLocalIfSame");
  const configAlwaysHideLocal = document.getElementById("configAlwaysHideLocal");
  const configNewFormUtcTogglePolicy = document.getElementById("configNewFormUtcTogglePolicy");
  const configEnableAlertTooltips = document.getElementById("configEnableAlertTooltips");
  const configShowTimeLabels = document.getElementById("configShowTimeLabels");
  const configShowDepEstimatedTimes = document.getElementById("configShowDepEstimatedTimes");
  const configShowArrEstimatedTimes = document.getElementById("configShowArrEstimatedTimes");
  const configShowLocEstimatedTimes = document.getElementById("configShowLocEstimatedTimes");
  const configShowOvrEstimatedTimes = document.getElementById("configShowOvrEstimatedTimes");
  // Auto-activation settings per flight type
  const configAutoActivateDepEnabled = document.getElementById("configAutoActivateDepEnabled");
  const configAutoActivateDepMinutes = document.getElementById("configAutoActivateDepMinutes");
  const configAutoActivateArrEnabled = document.getElementById("configAutoActivateArrEnabled");
  const configAutoActivateArrMinutes = document.getElementById("configAutoActivateArrMinutes");
  const configAutoActivateLocEnabled = document.getElementById("configAutoActivateLocEnabled");
  const configAutoActivateLocMinutes = document.getElementById("configAutoActivateLocMinutes");
  const configAutoActivateOvrEnabled = document.getElementById("configAutoActivateOvrEnabled");
  const configAutoActivateOvrMinutes = document.getElementById("configAutoActivateOvrMinutes");
  const configWtcSystem = document.getElementById("configWtcSystem");
  const configWtcThreshold = document.getElementById("configWtcThreshold");
  // History alert visibility settings
  const configHistoryShowTimeAlerts = document.getElementById("configHistoryShowTimeAlerts");
  const configHistoryShowEmergencyAlerts = document.getElementById("configHistoryShowEmergencyAlerts");
  const configHistoryShowCallsignAlerts = document.getElementById("configHistoryShowCallsignAlerts");
  const configHistoryShowWtcAlerts = document.getElementById("configHistoryShowWtcAlerts");
  // Timeline settings
  const configTimelineEnabled = document.getElementById("configTimelineEnabled");
  const configTimelineStartHour = document.getElementById("configTimelineStartHour");
  const configTimelineEndHour = document.getElementById("configTimelineEndHour");
  const configTimelineShowLocalRuler = document.getElementById("configTimelineShowLocalRuler");
  const configTimelineHideLocalRulerIfSame = document.getElementById("configTimelineHideLocalRulerIfSame");
  const configTimelineSwapUtcLocalRulers = document.getElementById("configTimelineSwapUtcLocalRulers");
  // Reciprocal strip settings
  const configDepToArrOffset = document.getElementById("configDepToArrOffset");
  const configArrToDepOffset = document.getElementById("configArrToDepOffset");
  // ARR/DEP Timeline display policy settings (Ticket 3a)
  const configTimelineArrDepShared = document.getElementById("configTimelineArrDepShared");
  const configTimelineSharedTokenMinutes = document.getElementById("configTimelineSharedTokenMinutes");
  const configTimelineDepTokenMinutes = document.getElementById("configTimelineDepTokenMinutes");
  const configTimelineArrTokenMinutes = document.getElementById("configTimelineArrTokenMinutes");

  // All tracked config inputs (order matters only for snapshot key identity)
  const CHECKBOX_IDS = [
    'configHideLocalIfSame', 'configAlwaysHideLocal', 'configEnableAlertTooltips',
    'configShowTimeLabels',
    'configShowDepEstimatedTimes', 'configShowArrEstimatedTimes',
    'configShowLocEstimatedTimes', 'configShowOvrEstimatedTimes',
    'configAutoActivateDepEnabled', 'configAutoActivateArrEnabled',
    'configAutoActivateLocEnabled', 'configAutoActivateOvrEnabled',
    'configHistoryShowTimeAlerts', 'configHistoryShowEmergencyAlerts',
    'configHistoryShowCallsignAlerts', 'configHistoryShowWtcAlerts',
    'configTimelineEnabled',
    'configTimelineArrDepShared',
    'configTimelineShowLocalRuler',
    'configTimelineHideLocalRulerIfSame',
    'configTimelineSwapUtcLocalRulers'
  ];
  const VALUE_IDS = [
    'configDepOffset', 'configDepDuration', 'configArrOffset', 'configArrDuration', 'configLocOffset', 'configLocDuration',
    'configOvrOffset', 'configOvrDuration',
    'configTimezoneOffset',
    'configAutoActivateDepMinutes', 'configAutoActivateArrMinutes',
    'configAutoActivateLocMinutes', 'configAutoActivateOvrMinutes',
    'configWtcSystem', 'configWtcThreshold',
    'configTimelineStartHour', 'configTimelineEndHour',
    'configTimelineSharedTokenMinutes', 'configTimelineDepTokenMinutes', 'configTimelineArrTokenMinutes',
    'configDepToArrOffset', 'configArrToDepOffset',
    'configNewFormUtcTogglePolicy'
  ];
  // Radio button groups tracked for dirty state and snapshot (separate from checkboxes/values)
  const RADIO_GROUPS = ['tlSharedMode', 'tlDepMode', 'tlArrMode'];

  // Helper to populate WTC threshold options based on system
  const populateWtcThresholdOptions = (system) => {
    if (!configWtcThreshold) return;

    const currentValue = configWtcThreshold.value;
    configWtcThreshold.innerHTML = '';

    const offOption = document.createElement('option');
    offOption.value = 'off';
    offOption.textContent = 'Off (No alerts)';
    configWtcThreshold.appendChild(offOption);

    let options = [];

    if (system === 'ICAO') {
      // ICAO: L < M < H (by MTOM: L<7t, M=7-136t, H≥136t)
      options = [
        { value: 'M', label: 'Medium (M) or higher' },
        { value: 'H', label: 'Heavy (H) only' }
      ];
    } else if (system === 'UK') {
      // UK CAP 493: L < S < LM < UM < H < J (arrivals use 6 categories)
      options = [
        { value: 'S', label: 'Small (S) or higher' },
        { value: 'LM', label: 'Lower Medium (LM) or higher' },
        { value: 'UM', label: 'Upper Medium (UM) or higher' },
        { value: 'H', label: 'Heavy (H) or higher' },
        { value: 'J', label: 'Super (J) only' }
      ];
    } else if (system === 'RECAT') {
      // RECAT-EU: F < E < D < C < B < A
      options = [
        { value: 'E', label: 'Lower Medium (E) or higher' },
        { value: 'D', label: 'Upper Medium (D) or higher' },
        { value: 'C', label: 'Lower Heavy (C) or higher' },
        { value: 'B', label: 'Upper Heavy (B) or higher' },
        { value: 'A', label: 'Super Heavy (A) only' }
      ];
    }

    options.forEach(opt => {
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.label;
      configWtcThreshold.appendChild(el);
    });

    // Restore previous value if it's still valid
    if (currentValue && Array.from(configWtcThreshold.options).some(opt => opt.value === currentValue)) {
      configWtcThreshold.value = currentValue;
    }
  };

  // Sync the ARR/DEP Timeline display UI to reflect the shared/separate checkbox
  // and enable/disable fixed display time fields based on selected radio mode.
  function syncTimelineUi() {
    const shared = configTimelineArrDepShared ? configTimelineArrDepShared.checked : true;
    const tlSharedBlock = document.getElementById('tlSharedBlock');
    const tlSplitBlock  = document.getElementById('tlSplitBlock');
    if (tlSharedBlock) tlSharedBlock.style.display = shared ? '' : 'none';
    if (tlSplitBlock)  tlSplitBlock.style.display  = shared ? 'none' : '';

    // Shared fixed display time row
    const tlSharedModeToken = document.getElementById('tlSharedModeToken');
    const tlSharedTokenRow  = document.getElementById('tlSharedTokenRow');
    if (configTimelineSharedTokenMinutes && tlSharedTokenRow) {
      const active = tlSharedModeToken ? tlSharedModeToken.checked : true;
      configTimelineSharedTokenMinutes.disabled = !active;
      tlSharedTokenRow.style.opacity = active ? '' : '0.5';
    }

    // DEP fixed display time row
    const tlDepModeToken = document.getElementById('tlDepModeToken');
    const tlDepTokenRow  = document.getElementById('tlDepTokenRow');
    if (configTimelineDepTokenMinutes && tlDepTokenRow) {
      const active = tlDepModeToken ? tlDepModeToken.checked : true;
      configTimelineDepTokenMinutes.disabled = !active;
      tlDepTokenRow.style.opacity = active ? '' : '0.5';
    }

    // ARR fixed display time row
    const tlArrModeToken = document.getElementById('tlArrModeToken');
    const tlArrTokenRow  = document.getElementById('tlArrTokenRow');
    if (configTimelineArrTokenMinutes && tlArrTokenRow) {
      const active = tlArrModeToken ? tlArrModeToken.checked : true;
      configTimelineArrTokenMinutes.disabled = !active;
      tlArrTokenRow.style.opacity = active ? '' : '0.5';
    }
  }

  // Load current config values
  const currentConfig = getConfig();
  if (configDepOffset) configDepOffset.value = currentConfig.depOffsetMinutes;
  if (configDepDuration) configDepDuration.value = currentConfig.depFlightDurationMinutes || 60;
  if (configArrOffset) configArrOffset.value = currentConfig.arrOffsetMinutes;
  if (configArrDuration) configArrDuration.value = currentConfig.arrFlightDurationMinutes || 60;
  if (configLocOffset) configLocOffset.value = currentConfig.locOffsetMinutes;
  if (configLocDuration) configLocDuration.value = currentConfig.locFlightDurationMinutes || 40;
  if (configOvrOffset) configOvrOffset.value = currentConfig.ovrOffsetMinutes;
  if (configOvrDuration) configOvrDuration.value = currentConfig.ovrFlightDurationMinutes || 5;
  if (configTimezoneOffset) configTimezoneOffset.value = currentConfig.timezoneOffsetHours;
  if (configHideLocalIfSame) configHideLocalIfSame.checked = currentConfig.hideLocalTimeInBannerIfSame || false;
  if (configAlwaysHideLocal) configAlwaysHideLocal.checked = currentConfig.alwaysHideLocalTimeInBanner || false;
  if (configNewFormUtcTogglePolicy) configNewFormUtcTogglePolicy.value = currentConfig.newFormUtcLocalTogglePolicy || "auto";
  if (configEnableAlertTooltips) configEnableAlertTooltips.checked = currentConfig.enableAlertTooltips !== false;
  if (configShowTimeLabels) configShowTimeLabels.checked = currentConfig.showTimeLabelsOnStrip !== false;
  if (configShowDepEstimatedTimes) configShowDepEstimatedTimes.checked = currentConfig.showDepEstimatedTimesOnStrip !== false;
  if (configShowArrEstimatedTimes) configShowArrEstimatedTimes.checked = currentConfig.showArrEstimatedTimesOnStrip !== false;
  if (configShowLocEstimatedTimes) configShowLocEstimatedTimes.checked = currentConfig.showLocEstimatedTimesOnStrip !== false;
  if (configShowOvrEstimatedTimes) configShowOvrEstimatedTimes.checked = currentConfig.showOvrEstimatedTimesOnStrip !== false;
  // Auto-activation settings per flight type
  if (configAutoActivateDepEnabled) configAutoActivateDepEnabled.checked = currentConfig.autoActivateDepEnabled || false;
  if (configAutoActivateDepMinutes) configAutoActivateDepMinutes.value = currentConfig.autoActivateDepMinutes || 30;
  if (configAutoActivateArrEnabled) configAutoActivateArrEnabled.checked = currentConfig.autoActivateArrEnabled ?? currentConfig.autoActivateEnabled ?? true;
  if (configAutoActivateArrMinutes) configAutoActivateArrMinutes.value = currentConfig.autoActivateArrMinutes || currentConfig.autoActivateMinutesBeforeEta || 30;
  if (configAutoActivateLocEnabled) configAutoActivateLocEnabled.checked = currentConfig.autoActivateLocEnabled || false;
  if (configAutoActivateLocMinutes) configAutoActivateLocMinutes.value = currentConfig.autoActivateLocMinutes || 30;
  if (configAutoActivateOvrEnabled) configAutoActivateOvrEnabled.checked = currentConfig.autoActivateOvrEnabled ?? currentConfig.autoActivateEnabled ?? true;
  if (configAutoActivateOvrMinutes) configAutoActivateOvrMinutes.value = currentConfig.autoActivateOvrMinutes || currentConfig.ovrAutoActivateMinutes || 30;

  // Initialize WTC system and threshold
  if (configWtcSystem) {
    configWtcSystem.value = currentConfig.wtcSystem || "ICAO";
    populateWtcThresholdOptions(configWtcSystem.value);

    // Add change listener to repopulate threshold options
    configWtcSystem.addEventListener('change', () => {
      populateWtcThresholdOptions(configWtcSystem.value);
      checkDirty();
    });
  }
  if (configWtcThreshold) configWtcThreshold.value = currentConfig.wtcAlertThreshold || "off";

  // Load History alert visibility settings
  if (configHistoryShowTimeAlerts) configHistoryShowTimeAlerts.checked = currentConfig.historyShowTimeAlerts || false;
  if (configHistoryShowEmergencyAlerts) configHistoryShowEmergencyAlerts.checked = currentConfig.historyShowEmergencyAlerts !== false;
  if (configHistoryShowCallsignAlerts) configHistoryShowCallsignAlerts.checked = currentConfig.historyShowCallsignAlerts || false;
  if (configHistoryShowWtcAlerts) configHistoryShowWtcAlerts.checked = currentConfig.historyShowWtcAlerts || false;

  // Load Timeline settings
  if (configTimelineEnabled) configTimelineEnabled.checked = currentConfig.timelineEnabled !== false;
  if (configTimelineStartHour) configTimelineStartHour.value = currentConfig.timelineStartHour ?? 6;
  if (configTimelineEndHour) configTimelineEndHour.value = currentConfig.timelineEndHour ?? 22;

  // Load ARR/DEP Timeline display policy settings
  if (configTimelineArrDepShared) configTimelineArrDepShared.checked = currentConfig.timelineArrDepShared !== false;
  const _tlSharedModeVal = currentConfig.timelineSharedMode === 'full' ? 'full' : 'token';
  const _tlSharedModeEl = document.querySelector(`input[name="tlSharedMode"][value="${_tlSharedModeVal}"]`);
  if (_tlSharedModeEl) _tlSharedModeEl.checked = true;
  if (configTimelineSharedTokenMinutes) configTimelineSharedTokenMinutes.value = currentConfig.timelineSharedTokenMinutes ?? 10;
  const _tlDepModeVal = currentConfig.timelineDepMode === 'full' ? 'full' : 'token';
  const _tlDepModeEl = document.querySelector(`input[name="tlDepMode"][value="${_tlDepModeVal}"]`);
  if (_tlDepModeEl) _tlDepModeEl.checked = true;
  if (configTimelineDepTokenMinutes) configTimelineDepTokenMinutes.value = currentConfig.timelineDepTokenMinutes ?? 10;
  const _tlArrModeVal = currentConfig.timelineArrMode === 'full' ? 'full' : 'token';
  const _tlArrModeEl = document.querySelector(`input[name="tlArrMode"][value="${_tlArrModeVal}"]`);
  if (_tlArrModeEl) _tlArrModeEl.checked = true;
  if (configTimelineArrTokenMinutes) configTimelineArrTokenMinutes.value = currentConfig.timelineArrTokenMinutes ?? 10;
  syncTimelineUi();

  // Load Timeline ruler display settings
  if (configTimelineShowLocalRuler) configTimelineShowLocalRuler.checked = currentConfig.timelineShowLocalRuler !== false;
  if (configTimelineHideLocalRulerIfSame) configTimelineHideLocalRulerIfSame.checked = currentConfig.timelineHideLocalRulerIfSame !== false;
  if (configTimelineSwapUtcLocalRulers) configTimelineSwapUtcLocalRulers.checked = currentConfig.timelineSwapUtcLocalRulers === true;

  // Load Reciprocal strip settings
  if (configDepToArrOffset) configDepToArrOffset.value = currentConfig.depToArrOffsetMinutes ?? 180;
  if (configArrToDepOffset) configArrToDepOffset.value = currentConfig.arrToDepOffsetMinutes ?? 30;

  // ── Dirty state tracking ───────────────────────────────────────
  const adminSaveBtn = document.getElementById('adminSaveBtn');
  const adminDiscardBtn = document.getElementById('adminDiscardBtn');
  const adminSaveStatus = document.getElementById('adminSaveStatus');

  function takeSnapshot() {
    const snap = {};
    CHECKBOX_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) snap[id] = el.checked;
    });
    VALUE_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) snap[id] = el.value;
    });
    // Capture selected radio value for each named group
    RADIO_GROUPS.forEach(name => {
      const checked = document.querySelector(`input[name="${name}"]:checked`);
      if (checked) snap[`radio_${name}`] = checked.value;
    });
    return snap;
  }

  function applySnapshot(snap) {
    CHECKBOX_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el && id in snap) el.checked = snap[id];
    });
    VALUE_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el && id in snap) el.value = snap[id];
    });
    // Restore radio group selections
    RADIO_GROUPS.forEach(name => {
      const val = snap[`radio_${name}`];
      if (val !== undefined) {
        const radio = document.querySelector(`input[name="${name}"][value="${val}"]`);
        if (radio) radio.checked = true;
      }
    });
    // Re-sync WTC threshold options after restoring WTC system
    if (configWtcSystem) {
      populateWtcThresholdOptions(configWtcSystem.value);
      if (configWtcThreshold && snap['configWtcThreshold']) {
        configWtcThreshold.value = snap['configWtcThreshold'];
      }
    }
    // Re-sync timeline display policy UI after restore
    syncTimelineUi();
  }

  let _configSnapshot = takeSnapshot();

  function isDirty() {
    for (const id of CHECKBOX_IDS) {
      const el = document.getElementById(id);
      if (el && el.checked !== _configSnapshot[id]) return true;
    }
    for (const id of VALUE_IDS) {
      const el = document.getElementById(id);
      if (el && el.value !== _configSnapshot[id]) return true;
    }
    // Check radio groups
    for (const name of RADIO_GROUPS) {
      const checked = document.querySelector(`input[name="${name}"]:checked`);
      if (checked && checked.value !== _configSnapshot[`radio_${name}`]) return true;
    }
    return false;
  }

  function checkDirty() {
    const dirty = isDirty();
    if (adminSaveBtn) adminSaveBtn.disabled = !dirty;
    if (adminDiscardBtn) adminDiscardBtn.disabled = !dirty;
    if (adminSaveStatus) {
      if (dirty) {
        adminSaveStatus.textContent = 'Unsaved changes';
        adminSaveStatus.className = 'admin-save-status admin-save-status--dirty';
      } else {
        adminSaveStatus.textContent = 'All changes saved';
        adminSaveStatus.className = 'admin-save-status admin-save-status--clean';
      }
    }
  }

  // Attach change listeners to all config inputs
  [...CHECKBOX_IDS, ...VALUE_IDS].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', checkDirty);
    if (el && el.type === 'number') el.addEventListener('input', checkDirty);
  });

  // Attach change listeners to radio button groups
  RADIO_GROUPS.forEach(name => {
    document.querySelectorAll(`input[name="${name}"]`).forEach(radio => {
      radio.addEventListener('change', () => { syncTimelineUi(); checkDirty(); });
    });
  });

  // Shared checkbox toggles shared vs split blocks
  if (configTimelineArrDepShared) {
    configTimelineArrDepShared.addEventListener('change', () => { syncTimelineUi(); checkDirty(); });
  }

  // Initial state
  checkDirty();

  // ── Save config action ─────────────────────────────────────────
  function saveAdminConfig() {
    const depOffset = parseInt(configDepOffset?.value || "10", 10);
    const depDuration = parseInt(configDepDuration?.value || "60", 10);
    const arrOffset = parseInt(configArrOffset?.value || "90", 10);
    const arrDuration = parseInt(configArrDuration?.value || "60", 10);
    const locOffset = parseInt(configLocOffset?.value || "10", 10);
    const locDuration = parseInt(configLocDuration?.value || "40", 10);
    const ovrOffset = parseInt(configOvrOffset?.value || "0", 10);
    const ovrDuration = parseInt(configOvrDuration?.value || "5", 10);
    const timezoneOffset = parseInt(configTimezoneOffset?.value || "0", 10);
    const newFormUtcTogglePolicy = configNewFormUtcTogglePolicy?.value || "auto";
    const hideLocalIfSame = configHideLocalIfSame?.checked || false;
    const alwaysHideLocal = configAlwaysHideLocal?.checked || false;
    const enableAlertTooltips = configEnableAlertTooltips?.checked !== false;
    const showTimeLabelsOnStrip = configShowTimeLabels?.checked !== false;
    const showDepEstimatedTimesOnStrip = configShowDepEstimatedTimes?.checked !== false;
    const showArrEstimatedTimesOnStrip = configShowArrEstimatedTimes?.checked !== false;
    const showLocEstimatedTimesOnStrip = configShowLocEstimatedTimes?.checked !== false;
    const showOvrEstimatedTimesOnStrip = configShowOvrEstimatedTimes?.checked !== false;
    // Auto-activation settings per flight type
    const autoActivateDepEnabled = configAutoActivateDepEnabled?.checked || false;
    const autoActivateDepMinutes = parseInt(configAutoActivateDepMinutes?.value || "30", 10);
    const autoActivateArrEnabled = configAutoActivateArrEnabled?.checked !== false;
    const autoActivateArrMinutes = parseInt(configAutoActivateArrMinutes?.value || "30", 10);
    const autoActivateLocEnabled = configAutoActivateLocEnabled?.checked || false;
    const autoActivateLocMinutes = parseInt(configAutoActivateLocMinutes?.value || "30", 10);
    const autoActivateOvrEnabled = configAutoActivateOvrEnabled?.checked !== false;
    const autoActivateOvrMinutes = parseInt(configAutoActivateOvrMinutes?.value || "30", 10);
    const wtcSystem = configWtcSystem?.value || "ICAO";
    const wtcThreshold = configWtcThreshold?.value || "off";
    // History alert visibility settings
    const historyShowTimeAlerts = configHistoryShowTimeAlerts?.checked || false;
    const historyShowEmergencyAlerts = configHistoryShowEmergencyAlerts?.checked !== false;
    const historyShowCallsignAlerts = configHistoryShowCallsignAlerts?.checked || false;
    const historyShowWtcAlerts = configHistoryShowWtcAlerts?.checked || false;
    // Timeline settings
    const timelineEnabled = configTimelineEnabled?.checked !== false;
    const timelineStartHour = parseInt(configTimelineStartHour?.value || "6", 10);
    const timelineEndHour = parseInt(configTimelineEndHour?.value || "22", 10);
    // ARR/DEP Timeline display policy settings
    const timelineArrDepShared = configTimelineArrDepShared?.checked !== false;
    const tlSharedModeChecked = document.querySelector('input[name="tlSharedMode"]:checked');
    const timelineSharedMode = (tlSharedModeChecked && tlSharedModeChecked.value === 'full') ? 'full' : 'token';
    const timelineSharedTokenMinutes = parseInt(configTimelineSharedTokenMinutes?.value || "10", 10);
    const tlDepModeChecked = document.querySelector('input[name="tlDepMode"]:checked');
    const timelineDepMode = (tlDepModeChecked && tlDepModeChecked.value === 'full') ? 'full' : 'token';
    const timelineDepTokenMinutes = parseInt(configTimelineDepTokenMinutes?.value || "10", 10);
    const tlArrModeChecked = document.querySelector('input[name="tlArrMode"]:checked');
    const timelineArrMode = (tlArrModeChecked && tlArrModeChecked.value === 'full') ? 'full' : 'token';
    const timelineArrTokenMinutes = parseInt(configTimelineArrTokenMinutes?.value || "10", 10);
    // Timeline ruler display settings
    const timelineShowLocalRuler = configTimelineShowLocalRuler?.checked !== false;
    const timelineHideLocalRulerIfSame = configTimelineHideLocalRulerIfSame?.checked !== false;
    const timelineSwapUtcLocalRulers = configTimelineSwapUtcLocalRulers?.checked || false;
    // Reciprocal strip settings
    const depToArrOffset = parseInt(configDepToArrOffset?.value || "180", 10);
    const arrToDepOffset = parseInt(configArrToDepOffset?.value || "30", 10);

    // Validate all offsets
    if (isNaN(depOffset) || depOffset < 0 || depOffset > 180 ||
        isNaN(depDuration) || depDuration < 1 || depDuration > 720 ||
        isNaN(arrOffset) || arrOffset < 0 || arrOffset > 180 ||
        isNaN(arrDuration) || arrDuration < 1 || arrDuration > 720 ||
        isNaN(locOffset) || locOffset < 0 || locOffset > 180 ||
        isNaN(locDuration) || locDuration < 5 || locDuration > 180 ||
        isNaN(ovrOffset) || ovrOffset < 0 || ovrOffset > 180 ||
        isNaN(ovrDuration) || ovrDuration < 1 || ovrDuration > 60 ||
        isNaN(timezoneOffset) || timezoneOffset < -12 || timezoneOffset > 12 ||
        isNaN(autoActivateDepMinutes) || autoActivateDepMinutes < 5 || autoActivateDepMinutes > 120 ||
        isNaN(autoActivateArrMinutes) || autoActivateArrMinutes < 5 || autoActivateArrMinutes > 120 ||
        isNaN(autoActivateLocMinutes) || autoActivateLocMinutes < 5 || autoActivateLocMinutes > 120 ||
        isNaN(autoActivateOvrMinutes) || autoActivateOvrMinutes < 5 || autoActivateOvrMinutes > 120 ||
        isNaN(timelineSharedTokenMinutes) || timelineSharedTokenMinutes < 1 || timelineSharedTokenMinutes > 120 ||
        isNaN(timelineDepTokenMinutes) || timelineDepTokenMinutes < 1 || timelineDepTokenMinutes > 120 ||
        isNaN(timelineArrTokenMinutes) || timelineArrTokenMinutes < 1 || timelineArrTokenMinutes > 120) {
      showToast("Please enter valid configuration values", 'error');
      return;
    }

    updateConfig({
      depOffsetMinutes: depOffset,
      depFlightDurationMinutes: depDuration,
      arrOffsetMinutes: arrOffset,
      arrFlightDurationMinutes: arrDuration,
      locOffsetMinutes: locOffset,
      locFlightDurationMinutes: locDuration,
      ovrOffsetMinutes: ovrOffset,
      ovrFlightDurationMinutes: ovrDuration,
      timezoneOffsetHours: timezoneOffset,
      newFormUtcLocalTogglePolicy: newFormUtcTogglePolicy,
      hideLocalTimeInBannerIfSame: hideLocalIfSame,
      alwaysHideLocalTimeInBanner: alwaysHideLocal,
      enableAlertTooltips: enableAlertTooltips,
      showTimeLabelsOnStrip: showTimeLabelsOnStrip,
      showDepEstimatedTimesOnStrip: showDepEstimatedTimesOnStrip,
      showArrEstimatedTimesOnStrip: showArrEstimatedTimesOnStrip,
      showLocEstimatedTimesOnStrip: showLocEstimatedTimesOnStrip,
      showOvrEstimatedTimesOnStrip: showOvrEstimatedTimesOnStrip,
      // Auto-activation settings per flight type
      autoActivateDepEnabled: autoActivateDepEnabled,
      autoActivateDepMinutes: autoActivateDepMinutes,
      autoActivateArrEnabled: autoActivateArrEnabled,
      autoActivateArrMinutes: autoActivateArrMinutes,
      autoActivateLocEnabled: autoActivateLocEnabled,
      autoActivateLocMinutes: autoActivateLocMinutes,
      autoActivateOvrEnabled: autoActivateOvrEnabled,
      autoActivateOvrMinutes: autoActivateOvrMinutes,
      wtcSystem: wtcSystem,
      wtcAlertThreshold: wtcThreshold,
      historyShowTimeAlerts: historyShowTimeAlerts,
      historyShowEmergencyAlerts: historyShowEmergencyAlerts,
      historyShowCallsignAlerts: historyShowCallsignAlerts,
      historyShowWtcAlerts: historyShowWtcAlerts,
      timelineEnabled: timelineEnabled,
      timelineStartHour: timelineStartHour,
      timelineEndHour: timelineEndHour,
      timelineArrDepShared: timelineArrDepShared,
      timelineSharedMode: timelineSharedMode,
      timelineSharedTokenMinutes: timelineSharedTokenMinutes,
      timelineDepMode: timelineDepMode,
      timelineDepTokenMinutes: timelineDepTokenMinutes,
      timelineArrMode: timelineArrMode,
      timelineArrTokenMinutes: timelineArrTokenMinutes,
      timelineShowLocalRuler: timelineShowLocalRuler,
      timelineHideLocalRulerIfSame: timelineHideLocalRulerIfSame,
      timelineSwapUtcLocalRulers: timelineSwapUtcLocalRulers,
      depToArrOffsetMinutes: depToArrOffset,
      arrToDepOffsetMinutes: arrToDepOffset
    });

    // Re-take snapshot so dirty state resets to clean
    _configSnapshot = takeSnapshot();
    checkDirty();
    showToast("Configuration saved", 'success');
    renderTimeline();
  }

  if (adminSaveBtn) adminSaveBtn.addEventListener('click', saveAdminConfig);

  // ── Discard action ─────────────────────────────────────────────
  if (adminDiscardBtn) {
    adminDiscardBtn.addEventListener('click', () => {
      applySnapshot(_configSnapshot);
      checkDirty();
    });
  }

  // ── Developer section ───────────────────────────────────────────
  const devNavBtn = document.querySelector('[data-section="admin-sec-developer"]');
  if (devNavBtn) {
    devNavBtn.addEventListener('click', refreshDeveloperSection);
  }

  const btnReloadAppDev = document.getElementById('btnReloadAppDev');
  if (btnReloadAppDev) {
    btnReloadAppDev.addEventListener('click', () => location.reload());
  }

  const btnRefreshDiagnostic = document.getElementById('btnRefreshDiagnostic');
  if (btnRefreshDiagnostic) {
    btnRefreshDiagnostic.addEventListener('click', () => {
      refreshDeveloperSection();
    });
  }

  const btnCopyDiagnostic = document.getElementById('btnCopyDiagnostic');
  if (btnCopyDiagnostic) {
    btnCopyDiagnostic.addEventListener('click', () => {
      refreshDeveloperSection();
      const outputEl = document.getElementById('devDiagnosticOutput');
      const report = outputEl ? outputEl.textContent : generateDiagnosticReport();

      const copyStatus = document.getElementById('devCopyStatus');
      navigator.clipboard.writeText(report).then(() => {
        if (copyStatus) {
          copyStatus.style.visibility = 'visible';
          setTimeout(() => { copyStatus.style.visibility = 'hidden'; }, 2500);
        }
      }).catch(() => {
        // Fallback for environments where clipboard API is unavailable
        const ta = document.createElement('textarea');
        ta.value = report;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        if (copyStatus) {
          copyStatus.style.visibility = 'visible';
          setTimeout(() => { copyStatus.style.visibility = 'hidden'; }, 2500);
        }
      });
    });
  }
}

/**
 * Initialize the generic overflights counter
 * This allows quick addition of free-caller overflights to today's stats
 * without creating individual strips
 */
/**
 * Calculate total FIS count from today's strips only
 * @returns {number} Total FIS count from today's strips
 */
function calculateStripFisCount() {
  const movements = getMovements();
  const today = getTodayDateString();
  // Only count FIS from today's ACTIVE or COMPLETED movements.
  // PLANNED and CANCELLED strips are excluded — they have not entered operational service.
  return movements
    .filter(m => m.dof === today && (m.status === 'ACTIVE' || m.status === 'COMPLETED'))
    .reduce((total, m) => total + (m.fisCount || 0), 0);
}

/**
 * Update all FIS counter displays
 */
function updateFisCounters() {
  if (window.__FDMS_DIAGNOSTICS__ && window.__fdmsDiag) window.__fdmsDiag.updateFisCountersCount++;
  const genericDisplay = document.getElementById("genericOvrCount");
  const stripFisDisplay = document.getElementById("stripFisCount");
  const totalFisDisplay = document.getElementById("totalFisCount");

  const genericCount = getGenericOverflightsCount();
  const stripFisCount = calculateStripFisCount();
  const totalFis = genericCount + stripFisCount;

  if (genericDisplay) genericDisplay.textContent = genericCount;
  if (stripFisDisplay) stripFisDisplay.textContent = stripFisCount;
  if (totalFisDisplay) totalFisDisplay.textContent = totalFis;
}

// Export for use in other modules
window.updateFisCounters = updateFisCounters;

/**
 * Get today's date in YYYY-MM-DD format (UTC)
 * @returns {string} Today's date
 */
function getTodayDateString() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

/**
 * Calculate daily movement statistics for today.
 * Counts only ACTIVE and COMPLETED movements (today's DOF).
 * Excludes PLANNED and CANCELLED from main movement totals.
 * Each movement is counted exactly once (by ID dedup).
 * @returns {object} Object with movement counts
 */
function calculateDailyStats() {
  const movements = getMovements();
  const today = getTodayDateString();

  // Filter: today only, exclude PLANNED and CANCELLED
  const countable = movements.filter(m =>
    m.dof === today &&
    (m.status === "ACTIVE" || m.status === "COMPLETED")
  );

  // Deduplicate by ID (defensive — should already be unique)
  const seen = new Set();
  let bm = 0, bc = 0, vm = 0, vc = 0, total = 0, ovr = 0;
  for (const m of countable) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);

    // OVR counted separately — excluded from runway totals
    if (isOverflight(m)) {
      ovr++;
      continue;
    }

    // Event-based runway contribution: only realized EGOW events count.
    // depActual required for DEP/LOC departure credit; arrActual required for ARR/LOC arrival credit.
    const contrib = egowRunwayContribution(m);
    total += contrib;

    const { egowFlightType } = classifyMovement(m);
    if (egowFlightType === 'BM') bm += contrib;
    else if (egowFlightType === 'BC') bc += contrib;
    else if (egowFlightType === 'VM') vm += contrib;
    else if (egowFlightType === 'VC') vc += contrib;
  }

  return {
    bookedMovements: bm,       // BM - Based Military (runway-movement-equivalent)
    bookedCompleted: bc,       // BC - Based Civil
    vfrMovements: vm,          // VM - Visiting Military
    vfrCompleted: vc,          // VC - Visiting Civil
    total,                     // Total runway movements (excludes OVR)
    ovr                        // Overflights (separate counter)
  };
}

/**
 * Update daily movement statistics display
 */
function updateDailyStats() {
  if (window.__FDMS_DIAGNOSTICS__ && window.__fdmsDiag) window.__fdmsDiag.updateDailyStatsCount++;
  const stats = calculateDailyStats();

  const bmDisplay = document.getElementById("statBookedMvmts");
  const bcDisplay = document.getElementById("statBookedComp");
  const vmDisplay = document.getElementById("statVfrMvmts");
  const vcDisplay = document.getElementById("statVfrComp");
  const totalDisplay = document.getElementById("statTotalToday");
  const ovrDisplay = document.getElementById("statOvrToday");

  if (bmDisplay) bmDisplay.textContent = stats.bookedMovements;
  if (bcDisplay) bcDisplay.textContent = stats.bookedCompleted;
  if (vmDisplay) vmDisplay.textContent = stats.vfrMovements;
  if (vcDisplay) vcDisplay.textContent = stats.vfrCompleted;
  if (totalDisplay) totalDisplay.textContent = stats.total;
  if (ovrDisplay) ovrDisplay.textContent = stats.ovr;
}

// Export for use in other modules
window.updateDailyStats = updateDailyStats;

function initLiveboardCounters() {
  const btnInc = document.getElementById("btnIncGenericOvr");
  const btnDec = document.getElementById("btnDecGenericOvr");

  // Initialize display with current counts
  updateFisCounters();
  updateDailyStats();

  if (!btnInc || !btnDec) return;

  // Increment button
  btnInc.addEventListener("click", () => {
    incrementGenericOverflights();
    updateFisCounters();
  });

  // Decrement button
  btnDec.addEventListener("click", () => {
    decrementGenericOverflights();
    updateFisCounters();
  });
}

let _lastTickDate = null;

async function bootstrap() {
  diagnostics.timing.initStartTime = new Date().toISOString();
  logBootstrapStage('bootstrap:start', 'success');
  updateInitStatus("Initialising app...");

  try {
    initErrorOverlay();

    runStage('tabs:init',  () => initTabs());
    runStage('clock:init', () => initClock());

    // VKB load is non-fatal — failure is logged but does not abort bootstrap
    logBootstrapStage('vkb:load', 'started');
    updateInitStatus("Loading VKB data...");
    try {
      await loadVKBData();
      const vkbStatus = getVKBStatus();
      const recordCount = vkbStatus.counts.aircraftTypes + vkbStatus.counts.callsignsStandard +
                          vkbStatus.counts.locations + vkbStatus.counts.registrations;
      showToast(`VKB loaded: ${recordCount} records`, 'success', 3000);
      logBootstrapStage('vkb:load', 'success', `${recordCount} records`);
    } catch (vkbError) {
      logBootstrapStage('vkb:load', 'failed', vkbError.message);
      console.warn('VKB load failed, continuing without VKB:', vkbError);
      showToast('VKB data failed to load - lookup features unavailable', 'warning', 5000);
    }

    runStage('liveboard:init', () => initLiveBoard());
    runStage('timeline:init',  () => { initTimeline(); initLiveboardCounters(); });
    runStage('history:init',   () => {
      initHistoryBoard();
      initCancelledSortiesLog();
      initDeletedStripsLog();
      initHistoryExport();
      initHistorySubtabs();
    });
    runStage('vkb-lookup:init', () => initVkbLookup());
    runStage('admin:init',      () => { initAdminPanel(); initAdminPanelHandlers(); });
    runStage('reports:init',    () => initReports());
    runStage('booking:init',    () => { initBookingPage(); initCalendarPage(); initBookingProfilesAdmin(); });

    logBootstrapStage('reconcile:run', 'started');
    const reconcileSummary = reconcileLinks();
    logBootstrapStage('reconcile:run', 'success');

    logBootstrapStage('first-render', 'started');
    renderLiveBoard();
    diagnostics.runtimeCounters.renderLiveBoardCount++;
    renderTimeline();
    diagnostics.runtimeCounters.renderTimelineCount++;
    renderHistoryBoard();
    diagnostics.runtimeCounters.renderHistoryBoardCount++;
    renderReports();
    renderCalendar();
    logBootstrapStage('first-render', 'success');

    showReconcileBanner(reconcileSummary);

    diagnostics.timing.initCompleteTime = new Date().toISOString();
    diagnostics.timing.lastRenderTime   = diagnostics.timing.initCompleteTime;
    logBootstrapStage('bootstrap:complete', 'success');
    updateInitStatus("Init complete", true);
    updateDiagnostics();

    // Low-frequency tick: refresh counters, stale highlights, and auto-activation
    _lastTickDate = getTodayDateString();
    setInterval(() => {
      updateDailyStats();
      updateFisCounters();
      const currentDate = getTodayDateString();
      const dayRolled = currentDate !== _lastTickDate;
      const isLiveActive = !document.getElementById('tab-live')?.classList.contains('hidden');
      if (isLiveActive || dayRolled) {
        renderLiveBoard();
        diagnostics.runtimeCounters.renderLiveBoardCount++;
        renderTimeline();
        diagnostics.runtimeCounters.renderTimelineCount++;
      }
      if (dayRolled) {
        _lastTickDate = currentDate;
      }
    }, 45000); // 45-second tick
  } catch (e) {
    if (!diagnostics.bootstrap.failedStage) {
      logBootstrapStage(diagnostics.bootstrap.currentStage || 'unknown', 'failed', e.message || String(e));
    }
    recordError({ message: e.message || String(e), stack: e.stack || null, type: 'bootstrap-error' });
    updateInitStatus("Init failed - check diagnostics", false);
    updateDiagnostics();
    throw e;
  }
}

document.addEventListener("DOMContentLoaded", bootstrap);

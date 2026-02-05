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
  updateTimelineNowLine
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
  getStorageInfo,
  getStorageQuota,
  getConfig,
  updateConfig,
  getGenericOverflightsCount,
  incrementGenericOverflights,
  decrementGenericOverflights,
  getMovements
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

// Diagnostics state
const diagnostics = {
  initTime: null,
  lastRenderTime: null,
  lastError: null
};

window.addEventListener("error", (e) => {
  const message = e.message || String(e.error || e);
  diagnostics.lastError = message;
  updateDiagnostics();

  // Show toast notification for user
  showToast(`Error: ${message}`, 'error', 6000);
});

window.addEventListener("unhandledrejection", (e) => {
  const message = String(e.reason || e);
  diagnostics.lastError = message;
  updateDiagnostics();

  // Show toast notification for user
  showToast(`Promise error: ${message}`, 'error', 6000);
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
      const offsetHours = cfg.timezoneOffsetHours || 0;

      // Calculate local time
      const localTime = new Date(now.getTime() + (offsetHours * 60 * 60 * 1000));
      const localHh = String(localTime.getUTCHours()).padStart(2, "0");
      const localMm = String(localTime.getUTCMinutes()).padStart(2, "0");
      const localSs = String(localTime.getUTCSeconds()).padStart(2, "0");
      localTimeEl.textContent = `${localHh}:${localMm}:${localSs}`;

      // Determine visibility
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

  if (initTimeEl) initTimeEl.textContent = diagnostics.initTime || "—";
  if (renderTimeEl) renderTimeEl.textContent = diagnostics.lastRenderTime || "—";
  if (storageKeyEl) storageKeyEl.textContent = storageInfo.key || "—";
  if (movementCountEl) movementCountEl.textContent = String(storageInfo.movementCount);
  if (lastErrorEl) lastErrorEl.textContent = diagnostics.lastError || "None";

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

function initAdminPanelHandlers() {
  const btnExport = document.getElementById("btnExportSession");
  const btnImport = document.getElementById("btnImportSession");
  const fileInput = document.getElementById("importFileInput");

  if (btnExport) {
    btnExport.addEventListener("click", () => {
      try {
        const data = exportSessionJSON();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `fdms-backup-${new Date().toISOString().split("T")[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast("Backup created successfully", 'success');
      } catch (e) {
        showToast(`Backup failed: ${e.message}`, 'error');
      }
    });
  }

  if (btnImport && fileInput) {
    btnImport.addEventListener("click", () => {
      fileInput.click();
    });

    fileInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          const result = importSessionJSON(data);

          if (result.success) {
            renderLiveBoard();
            renderHistoryBoard();
            renderReports();
            diagnostics.lastRenderTime = new Date().toISOString();
            updateDiagnostics();
            showToast(`Restore successful! Loaded ${result.count} movements`, 'success');
          } else {
            showToast(`Restore failed: ${result.error}`, 'error');
          }
        } catch (e) {
          showToast(`Restore failed: ${e.message}`, 'error');
        }
        fileInput.value = "";
      };
      reader.readAsText(file);
    });
  }

  // Configuration handlers
  const configDepOffset = document.getElementById("configDepOffset");
  const configArrOffset = document.getElementById("configArrOffset");
  const configLocOffset = document.getElementById("configLocOffset");
  const configLocDuration = document.getElementById("configLocDuration");
  const configOvrOffset = document.getElementById("configOvrOffset");
  const configOvrDuration = document.getElementById("configOvrDuration");
  const configOvrAutoActivate = document.getElementById("configOvrAutoActivate");
  const configTimezoneOffset = document.getElementById("configTimezoneOffset");
  const configHideLocalIfSame = document.getElementById("configHideLocalIfSame");
  const configAlwaysHideLocal = document.getElementById("configAlwaysHideLocal");
  const configEnableAlertTooltips = document.getElementById("configEnableAlertTooltips");
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
  // Reciprocal strip settings
  const configDepToArrOffset = document.getElementById("configDepToArrOffset");
  const configArrToDepOffset = document.getElementById("configArrToDepOffset");
  const btnSaveConfig = document.getElementById("btnSaveConfig");

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

  // Load current config values
  const currentConfig = getConfig();
  if (configDepOffset) configDepOffset.value = currentConfig.depOffsetMinutes;
  if (configArrOffset) configArrOffset.value = currentConfig.arrOffsetMinutes;
  if (configLocOffset) configLocOffset.value = currentConfig.locOffsetMinutes;
  if (configLocDuration) configLocDuration.value = currentConfig.locFlightDurationMinutes || 40;
  if (configOvrOffset) configOvrOffset.value = currentConfig.ovrOffsetMinutes;
  if (configOvrDuration) configOvrDuration.value = currentConfig.ovrFlightDurationMinutes || 5;
  if (configOvrAutoActivate) configOvrAutoActivate.value = currentConfig.ovrAutoActivateMinutes || 30;
  if (configTimezoneOffset) configTimezoneOffset.value = currentConfig.timezoneOffsetHours;
  if (configHideLocalIfSame) configHideLocalIfSame.checked = currentConfig.hideLocalTimeInBannerIfSame || false;
  if (configAlwaysHideLocal) configAlwaysHideLocal.checked = currentConfig.alwaysHideLocalTimeInBanner || false;
  if (configEnableAlertTooltips) configEnableAlertTooltips.checked = currentConfig.enableAlertTooltips !== false;
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

  // Load Reciprocal strip settings
  if (configDepToArrOffset) configDepToArrOffset.value = currentConfig.depToArrOffsetMinutes ?? 180;
  if (configArrToDepOffset) configArrToDepOffset.value = currentConfig.arrToDepOffsetMinutes ?? 30;

  if (btnSaveConfig) {
    btnSaveConfig.addEventListener("click", () => {
      const depOffset = parseInt(configDepOffset?.value || "10", 10);
      const arrOffset = parseInt(configArrOffset?.value || "90", 10);
      const locOffset = parseInt(configLocOffset?.value || "10", 10);
      const locDuration = parseInt(configLocDuration?.value || "40", 10);
      const ovrOffset = parseInt(configOvrOffset?.value || "0", 10);
      const ovrDuration = parseInt(configOvrDuration?.value || "5", 10);
      const ovrAutoActivate = parseInt(configOvrAutoActivate?.value || "30", 10);
      const timezoneOffset = parseInt(configTimezoneOffset?.value || "0", 10);
      const hideLocalIfSame = configHideLocalIfSame?.checked || false;
      const alwaysHideLocal = configAlwaysHideLocal?.checked || false;
      const enableAlertTooltips = configEnableAlertTooltips?.checked !== false;
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
      // Reciprocal strip settings
      const depToArrOffset = parseInt(configDepToArrOffset?.value || "180", 10);
      const arrToDepOffset = parseInt(configArrToDepOffset?.value || "30", 10);

      // Validate all offsets
      if (isNaN(depOffset) || depOffset < 0 || depOffset > 180 ||
          isNaN(arrOffset) || arrOffset < 0 || arrOffset > 180 ||
          isNaN(locOffset) || locOffset < 0 || locOffset > 180 ||
          isNaN(locDuration) || locDuration < 5 || locDuration > 180 ||
          isNaN(ovrOffset) || ovrOffset < 0 || ovrOffset > 180 ||
          isNaN(ovrDuration) || ovrDuration < 1 || ovrDuration > 60 ||
          isNaN(ovrAutoActivate) || ovrAutoActivate < 5 || ovrAutoActivate > 120 ||
          isNaN(timezoneOffset) || timezoneOffset < -12 || timezoneOffset > 12 ||
          isNaN(autoActivateDepMinutes) || autoActivateDepMinutes < 5 || autoActivateDepMinutes > 120 ||
          isNaN(autoActivateArrMinutes) || autoActivateArrMinutes < 5 || autoActivateArrMinutes > 120 ||
          isNaN(autoActivateLocMinutes) || autoActivateLocMinutes < 5 || autoActivateLocMinutes > 120 ||
          isNaN(autoActivateOvrMinutes) || autoActivateOvrMinutes < 5 || autoActivateOvrMinutes > 120) {
        showToast("Please enter valid configuration values", 'error');
        return;
      }

      updateConfig({
        depOffsetMinutes: depOffset,
        arrOffsetMinutes: arrOffset,
        locOffsetMinutes: locOffset,
        locFlightDurationMinutes: locDuration,
        ovrOffsetMinutes: ovrOffset,
        ovrFlightDurationMinutes: ovrDuration,
        ovrAutoActivateMinutes: ovrAutoActivate,
        timezoneOffsetHours: timezoneOffset,
        hideLocalTimeInBannerIfSame: hideLocalIfSame,
        alwaysHideLocalTimeInBanner: alwaysHideLocal,
        enableAlertTooltips: enableAlertTooltips,
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
        depToArrOffsetMinutes: depToArrOffset,
        arrToDepOffsetMinutes: arrToDepOffset
      });
      showToast("Configuration saved successfully", 'success');
      // Re-render timeline with new settings
      renderTimeline();
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
  // Only count FIS from movements with today's date of flight
  return movements
    .filter(m => m.dof === today)
    .reduce((total, m) => total + (m.fisCount || 0), 0);
}

/**
 * Update all FIS counter displays
 */
function updateFisCounters() {
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
 * Calculate daily movement statistics for today
 * @returns {object} Object with movement counts
 */
function calculateDailyStats() {
  const movements = getMovements();
  const today = getTodayDateString();

  // Filter movements for today (by DOF date of flight)
  const todaysMovements = movements.filter(m => m.dof === today);

  // Count by resolved EGOW flight type (mutually exclusive categories)
  let bm = 0, bc = 0, vm = 0, vc = 0;
  for (const m of todaysMovements) {
    const { egowFlightType } = classifyMovement(m);
    if (egowFlightType === 'BM') bm++;
    else if (egowFlightType === 'BC') bc++;
    else if (egowFlightType === 'VM') vm++;
    else if (egowFlightType === 'VC') vc++;
  }

  return {
    bookedMovements: bm,       // BM - Based Military
    bookedCompleted: bc,       // BC - Based Civil
    vfrMovements: vm,          // VM - Visiting Military
    vfrCompleted: vc,          // VC - Visiting Civil
    total: todaysMovements.length
  };
}

/**
 * Update daily movement statistics display
 */
function updateDailyStats() {
  const stats = calculateDailyStats();

  const bmDisplay = document.getElementById("statBookedMvmts");
  const bcDisplay = document.getElementById("statBookedComp");
  const vmDisplay = document.getElementById("statVfrMvmts");
  const vcDisplay = document.getElementById("statVfrComp");
  const totalDisplay = document.getElementById("statTotalToday");

  if (bmDisplay) bmDisplay.textContent = stats.bookedMovements;
  if (bcDisplay) bcDisplay.textContent = stats.bookedCompleted;
  if (vmDisplay) vmDisplay.textContent = stats.vfrMovements;
  if (vcDisplay) vcDisplay.textContent = stats.vfrCompleted;
  if (totalDisplay) totalDisplay.textContent = stats.total;
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
  updateInitStatus("Initialising app...");

  try {
    initErrorOverlay();

    // Global UI primitives
    initTabs();
    initClock();

    // Load VKB data in background
    updateInitStatus("Loading VKB data...");
    try {
      await loadVKBData();
      const status = getVKBStatus();
      showToast(`VKB loaded: ${status.counts.aircraftTypes + status.counts.callsignsStandard + status.counts.locations + status.counts.registrations} records`, 'success', 3000);
    } catch (vkbError) {
      console.warn('VKB load failed, continuing without VKB:', vkbError);
      showToast('VKB data failed to load - lookup features unavailable', 'warning', 5000);
    }

    // Feature modules: bind handlers first, then render
    initLiveBoard();
    initTimeline();
    initLiveboardCounters();
    initHistoryBoard();
    initHistoryExport();
    initVkbLookup();
    initAdminPanel();
    initAdminPanelHandlers();
    initReports();
    initBookingPage();
    initCalendarPage();
    initBookingProfilesAdmin();

    renderLiveBoard();
    renderTimeline();
    renderHistoryBoard();
    renderReports();
    renderCalendar();

    // Reconcile any dangling booking↔strip links from previous sessions
    reconcileLinks();

    // Record init complete
    diagnostics.initTime = new Date().toISOString();
    diagnostics.lastRenderTime = diagnostics.initTime;
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
        renderTimeline();
      }
      if (dayRolled) {
        _lastTickDate = currentDate;
      }
    }, 45000); // 45-second tick
  } catch (e) {
    diagnostics.lastError = e.message || String(e);
    updateInitStatus("Init failed - check diagnostics", false);
    updateDiagnostics();
    throw e;
  }
}

document.addEventListener("DOMContentLoaded", bootstrap);

// app.js
// App bootstrap: tab switching, UTC clock, and Live / History initialisation.

import {
  initLiveBoard,
  initHistoryBoard,
  renderLiveBoard,
  renderHistoryBoard,
  renderReportsSummary,
  initHistoryExport,
  initVkbLookup,
  initAdminPanel
} from "./ui_liveboard.js";

import {
  resetMovementsToDemo,
  exportSessionJSON,
  importSessionJSON,
  getStorageInfo,
  getStorageQuota,
  getConfig,
  updateConfig
} from "./datamodel.js";

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
  const clockEl = document.getElementById("utcClock");
  if (!clockEl) return;

  const updateClock = () => {
    const now = new Date();
    const hh = String(now.getUTCHours()).padStart(2, "0");
    const mm = String(now.getUTCMinutes()).padStart(2, "0");
    const yyyy = now.getUTCFullYear();
    const mon = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");

    // Keep formatting stable and unambiguous
    clockEl.textContent = `UTC: ${hh}:${mm} · ${yyyy}-${mon}-${dd}`;
  };

  updateClock();
  window.setInterval(updateClock, 30_000);
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
  const btnReset = document.getElementById("btnResetDemo");
  const btnExport = document.getElementById("btnExportSession");
  const btnImport = document.getElementById("btnImportSession");
  const fileInput = document.getElementById("importFileInput");

  if (btnReset) {
    btnReset.addEventListener("click", () => {
      if (confirm("Reset to demo data? This will overwrite your current session.")) {
        resetMovementsToDemo();
        renderLiveBoard();
        renderHistoryBoard();
        renderReportsSummary();
        diagnostics.lastRenderTime = new Date().toISOString();
        updateDiagnostics();
        showToast("Session reset to demo data", 'success');
      }
    });
  }

  if (btnExport) {
    btnExport.addEventListener("click", () => {
      try {
        const data = exportSessionJSON();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `fdms-session-${new Date().toISOString().split("T")[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast("Session exported successfully", 'success');
      } catch (e) {
        showToast(`Export failed: ${e.message}`, 'error');
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
            renderReportsSummary();
            diagnostics.lastRenderTime = new Date().toISOString();
            updateDiagnostics();
            showToast(`Import successful! Loaded ${result.count} movements`, 'success');
          } else {
            showToast(`Import failed: ${result.error}`, 'error');
          }
        } catch (e) {
          showToast(`Import failed: ${e.message}`, 'error');
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
  const configOvrOffset = document.getElementById("configOvrOffset");
  const configTimezoneOffset = document.getElementById("configTimezoneOffset");
  const btnSaveConfig = document.getElementById("btnSaveConfig");

  // Load current config values
  const currentConfig = getConfig();
  if (configDepOffset) configDepOffset.value = currentConfig.depOffsetMinutes;
  if (configArrOffset) configArrOffset.value = currentConfig.arrOffsetMinutes;
  if (configLocOffset) configLocOffset.value = currentConfig.locOffsetMinutes;
  if (configOvrOffset) configOvrOffset.value = currentConfig.ovrOffsetMinutes;
  if (configTimezoneOffset) configTimezoneOffset.value = currentConfig.timezoneOffsetHours;

  if (btnSaveConfig) {
    btnSaveConfig.addEventListener("click", () => {
      const depOffset = parseInt(configDepOffset?.value || "10", 10);
      const arrOffset = parseInt(configArrOffset?.value || "90", 10);
      const locOffset = parseInt(configLocOffset?.value || "10", 10);
      const ovrOffset = parseInt(configOvrOffset?.value || "0", 10);
      const timezoneOffset = parseInt(configTimezoneOffset?.value || "0", 10);

      // Validate all offsets
      if (isNaN(depOffset) || depOffset < 0 || depOffset > 180 ||
          isNaN(arrOffset) || arrOffset < 0 || arrOffset > 180 ||
          isNaN(locOffset) || locOffset < 0 || locOffset > 180 ||
          isNaN(ovrOffset) || ovrOffset < 0 || ovrOffset > 180 ||
          isNaN(timezoneOffset) || timezoneOffset < -12 || timezoneOffset > 12) {
        showToast("Please enter valid configuration values", 'error');
        return;
      }

      updateConfig({
        depOffsetMinutes: depOffset,
        arrOffsetMinutes: arrOffset,
        locOffsetMinutes: locOffset,
        ovrOffsetMinutes: ovrOffset,
        timezoneOffsetHours: timezoneOffset
      });
      showToast("Configuration saved successfully", 'success');
    });
  }
}

function bootstrap() {
  updateInitStatus("Initialising app...");

  try {
    initErrorOverlay();

    // Global UI primitives
    initTabs();
    initClock();

    // Feature modules: bind handlers first, then render
    initLiveBoard();
    initHistoryBoard();
    initHistoryExport();
    initVkbLookup();
    initAdminPanel();
    initAdminPanelHandlers();

    renderLiveBoard();
    renderHistoryBoard();
    renderReportsSummary();

    // Record init complete
    diagnostics.initTime = new Date().toISOString();
    diagnostics.lastRenderTime = diagnostics.initTime;
    updateInitStatus("Init complete", true);
    updateDiagnostics();
  } catch (e) {
    diagnostics.lastError = e.message || String(e);
    updateInitStatus("Init failed - check diagnostics", false);
    updateDiagnostics();
    throw e;
  }
}

document.addEventListener("DOMContentLoaded", bootstrap);

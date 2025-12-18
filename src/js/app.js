// app.js
// App bootstrap: tab switching, UTC clock, and Live / History initialisation.

import {
  initLiveBoard,
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
  getStorageInfo
} from "./datamodel.js";

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

  const d = document.createElement("div");
  d.style.cssText =
    "position:fixed;left:0;right:0;bottom:0;background:#300;color:#fff;padding:10px;font:12px monospace;z-index:99999;white-space:pre-wrap";
  d.textContent = "JS error: " + message;
  document.body.appendChild(d);
});

window.addEventListener("unhandledrejection", (e) => {
  const message = String(e.reason || e);
  diagnostics.lastError = message;
  updateDiagnostics();

  const d = document.createElement("div");
  d.style.cssText =
    "position:fixed;left:0;right:0;bottom:0;background:#003;color:#fff;padding:10px;font:12px monospace;z-index:99999;white-space:pre-wrap";
  d.textContent = "Promise rejection: " + message;
  document.body.appendChild(d);
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

function updateDiagnostics() {
  const storageInfo = getStorageInfo();

  const initTimeEl = document.getElementById("diagInitTime");
  const renderTimeEl = document.getElementById("diagRenderTime");
  const storageKeyEl = document.getElementById("diagStorageKey");
  const movementCountEl = document.getElementById("diagMovementCount");
  const lastErrorEl = document.getElementById("diagLastError");

  if (initTimeEl) initTimeEl.textContent = diagnostics.initTime || "—";
  if (renderTimeEl) renderTimeEl.textContent = diagnostics.lastRenderTime || "—";
  if (storageKeyEl) storageKeyEl.textContent = storageInfo.key || "—";
  if (movementCountEl) movementCountEl.textContent = String(storageInfo.movementCount);
  if (lastErrorEl) lastErrorEl.textContent = diagnostics.lastError || "None";
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
        alert("Session reset to demo data.");
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
      } catch (e) {
        alert("Export failed: " + e.message);
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
            alert(`Import successful! Loaded ${result.count} movements.`);
          } else {
            alert("Import failed: " + result.error);
          }
        } catch (e) {
          alert("Import failed: " + e.message);
        }
        fileInput.value = "";
      };
      reader.readAsText(file);
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

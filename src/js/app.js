// app.js
// App bootstrap: tab switching, clock, and Live / History initialisation.
import {
  initLiveBoard,
  renderLiveBoard,
  renderHistoryBoard,
  renderReportsSummary,
  initHistoryExport,
  initVkbLookup,
  initAdminPanel
} from "./ui_liveboard.js";

function setTab(name) {
  const tabButtons = document.querySelectorAll(".nav-tab");
  const livePanel = document.getElementById("live-panel");
  const historyPanel = document.getElementById("history-panel");
  const reportsPanel = document.getElementById("reports-panel");
  const lookupPanel = document.getElementById("lookup-panel");
  const adminPanel = document.getElementById("admin-panel");
  const liveToolbar = document.getElementById("live-toolbar");
  const otherToolbar = document.getElementById("other-toolbar");

  tabButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });

  if (livePanel) livePanel.style.display = name === "live" ? "block" : "none";
  if (historyPanel)
    historyPanel.style.display = name === "history" ? "block" : "none";
  if (reportsPanel)
    reportsPanel.style.display = name === "reports" ? "block" : "none";
  if (lookupPanel)
    lookupPanel.style.display = name === "lookup" ? "block" : "none";
  if (adminPanel)
    adminPanel.style.display = name === "admin" ? "block" : "none";

  if (liveToolbar) liveToolbar.style.display = name === "live" ? "flex" : "none";
  if (otherToolbar)
    otherToolbar.style.display = name === "live" ? "none" : "flex";
}

function initTabs() {
  const tabButtons = document.querySelectorAll(".nav-tab");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });

  setTab("live");
}

function initClock() {
  const clockEl = document.getElementById("utcClock");
  if (!clockEl) return;

  function updateClock() {
    const now = new Date();
    const hh = String(now.getUTCHours()).padStart(2, "0");
    const mm = String(now.getUTCMinutes()).padStart(2, "0");
    const yyyy = now.getUTCFullYear();
    const mmn = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    clockEl.textContent = `UTC: ${hh}:${mm} · ${yyyy}-${mmn}-${dd}`;
  }

  updateClock();
  setInterval(updateClock, 30_000);
}

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initClock();
  initLiveBoard();
  renderLiveBoard();
  renderHistoryBoard();
  renderReportsSummary();
  initHistoryExport();
  initVkbLookup();
  initAdminPanel();
});


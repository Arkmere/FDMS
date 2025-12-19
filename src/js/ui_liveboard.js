// ui_liveboard.js
// Handles rendering and interactions for the Live Board, History, Reports, VKB, and Admin panels.
// ES module, no framework, DOM-contract driven.

import { getMovements, statusClass, statusLabel } from "./datamodel.js";

/* -----------------------------
   State
------------------------------ */

let expandedId = null;

const state = {
  globalFilter: "",
  columnFilters: {
    callsign: "",
    reg: "",
    route: ""
  }
};

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

function escapeHtml(s) {
  // Defensive; most values are demo data, but keep rendering resilient.
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* -----------------------------
   Sorting
------------------------------ */

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

function statusRank(status) {
  const s = (status || "").toUpperCase();
  if (s === "ACTIVE") return 1;
  if (s === "PLANNED") return 2;
  return 3;
}

function plannedSortMinutes(m) {
  const ft = (m.flightType || "").toUpperCase();
  if (ft === "ARR") return timeToMinutes(m.arrPlanned);
  if (ft === "OVR") return timeToMinutes(m.depPlanned);
  return timeToMinutes(m.depPlanned);
}

function activeSortMinutes(m) {
  const ft = (m.flightType || "").toUpperCase();
  if (ft === "ARR") return timeToMinutes(m.arrActual || m.arrPlanned);
  if (ft === "LOC") return timeToMinutes(m.depActual || m.arrActual || m.depPlanned);
  if (ft === "OVR") return timeToMinutes(m.depActual || m.depPlanned);
  return timeToMinutes(m.depActual || m.depPlanned);
}

function movementSortMinutes(m) {
  const s = (m.status || "").toUpperCase();
  if (s === "ACTIVE") return activeSortMinutes(m);
  if (s === "PLANNED") return plannedSortMinutes(m);
  return activeSortMinutes(m);
}

function compareForLiveBoard(a, b) {
  const ra = statusRank(a.status);
  const rb = statusRank(b.status);
  if (ra !== rb) return ra - rb;

  const ta = movementSortMinutes(a);
  const tb = movementSortMinutes(b);
  if (ta !== tb) return ta - tb;

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

function matchesFilters(m) {
  const statusFilter = getStatusFilterValue();

  if (statusFilter === "active" && m.status !== "ACTIVE") return false;

  if (
    statusFilter === "planned_active" &&
    !(m.status === "PLANNED" || m.status === "ACTIVE")
  ) {
    return false;
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

  if (state.columnFilters.callsign) {
    const q = state.columnFilters.callsign.toLowerCase();
    const s1 = (m.callsignCode || "").toLowerCase();
    const s2 = (m.callsignLabel || "").toLowerCase();
    if (!s1.includes(q) && !s2.includes(q)) return false;
  }

  if (state.columnFilters.reg) {
    const q = state.columnFilters.reg.toLowerCase();
    if (!(m.registration || "").toLowerCase().includes(q)) return false;
  }

  if (state.columnFilters.route) {
    const q = state.columnFilters.route.toLowerCase();
    const r = `${m.depAd} ${m.depName} ${m.arrAd} ${m.arrName}`.toLowerCase();
    if (!r.includes(q)) return false;
  }

  return true;
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

function renderFormationDetails(m) {
  if (!m.formation || !Array.isArray(m.formation.elements)) return "";

  const rows = m.formation.elements
    .map((el) => {
      return `
        <tr>
          <td>${escapeHtml(el.callsign)}</td>
          <td>${escapeHtml(el.reg || "—")}</td>
          <td>${escapeHtml(el.type || "—")}</td>
          <td>${escapeHtml(el.wtc || "—")}</td>
          <td>${escapeHtml(statusLabel(el.status))}</td>
          <td>${escapeHtml(el.depActual || "—")}</td>
          <td>${escapeHtml(el.arrActual || "—")}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="expand-section">
      <div class="expand-title">Formation</div>
      <div class="kv">
        <div class="kv-label">Label</div><div class="kv-value">${escapeHtml(m.formation.label)}</div>
        <div class="kv-label">Current WTC</div><div class="kv-value">${escapeHtml(m.formation.wtcCurrent)}</div>
        <div class="kv-label">Max WTC</div><div class="kv-value">${escapeHtml(m.formation.wtcMax)}</div>
      </div>
      <table class="formation-table">
        <thead>
          <tr>
            <th>Element</th>
            <th>Reg</th>
            <th>Type</th>
            <th>WTC</th>
            <th>Status</th>
            <th>Dep</th>
            <th>Arr</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

function renderExpandedRow(tbody, m) {
  const expTr = document.createElement("tr");
  expTr.className = "expand-row";

  const expTd = document.createElement("td");
  expTd.colSpan = 7;

  expTd.innerHTML = `
    <div class="expand-inner">
      <div class="expand-section">
        <div class="expand-title">Movement Summary</div>
        <div class="kv">
          <div class="kv-label">Status</div><div class="kv-value">${escapeHtml(statusLabel(m.status))}</div>
          <div class="kv-label">Flight Type</div><div class="kv-value">${escapeHtml(m.flightType)}</div>
          <div class="kv-label">Departure</div><div class="kv-value">${escapeHtml(m.depAd)} – ${escapeHtml(m.depName)}</div>
          <div class="kv-label">Arrival</div><div class="kv-value">${escapeHtml(m.arrAd)} – ${escapeHtml(m.arrName)}</div>
          <div class="kv-label">Planned times</div><div class="kv-value">${escapeHtml(m.depPlanned || "—")} → ${escapeHtml(m.arrPlanned || "—")}</div>
          <div class="kv-label">Actual times</div><div class="kv-value">${escapeHtml(m.depActual || "—")} → ${escapeHtml(m.arrActual || "—")}</div>
          <div class="kv-label">T&amp;Gs</div><div class="kv-value">${escapeHtml(m.tngCount ?? 0)}</div>
          <div class="kv-label">O/S count</div><div class="kv-value">${escapeHtml(m.osCount ?? 0)}</div>
          <div class="kv-label">FIS count</div><div class="kv-value">${escapeHtml(m.fisCount ?? 0)}</div>
          <div class="kv-label">POB</div><div class="kv-value">${escapeHtml(m.pob ?? 0)}</div>
        </div>
      </div>

      <div class="expand-section">
        <div class="expand-title">Coding &amp; Classification</div>
        <div class="kv">
          <div class="kv-label">EGOW code</div><div class="kv-value">${escapeHtml(m.egowCode || "—")} – ${escapeHtml(m.egowDesc || "")}</div>
          <div class="kv-label">Unit</div><div class="kv-value">${escapeHtml(m.unitCode || "—")}${m.unitDesc ? " · " + escapeHtml(m.unitDesc) : ""}</div>
          <div class="kv-label">Callsign (voice)</div><div class="kv-value">${escapeHtml(m.callsignVoice || "—")}</div>
          <div class="kv-label">Captain</div><div class="kv-value">${escapeHtml(m.captain || "—")}</div>
          <div class="kv-label">Remarks</div><div class="kv-value">${escapeHtml(m.remarks || "—")}</div>
        </div>
      </div>

      ${renderFormationDetails(m)}
    </div>
  `;

  expTr.appendChild(expTd);
  tbody.appendChild(expTr);
}

export function renderLiveBoard() {
  const tbody = byId("liveBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  const movements = getMovements().filter(matchesFilters).slice().sort(compareForLiveBoard);

  for (const m of movements) {
    const tr = document.createElement("tr");
    tr.className = `strip strip-row ${flightTypeClass(m.flightType)}`;
    tr.dataset.id = String(m.id);

    const depDisplay = m.depActual || m.depPlanned || "-";
    const arrDisplay = m.arrActual || m.arrPlanned || "-";

    tr.innerHTML = `
      <td><div class="status-strip ${escapeHtml(statusClass(m.status))}" title="${escapeHtml(statusLabel(m.status))}"></div></td>
      <td>
        <div class="call-main">${escapeHtml(m.callsignCode)}</div>
        <div class="call-sub">${m.callsignLabel ? escapeHtml(m.callsignLabel) : "&nbsp;"}</div>
      </td>
      <td>
        <div class="cell-strong">${escapeHtml(m.registration || "—")}${m.type ? " · " + escapeHtml(m.type) : ""}</div>
        <div class="cell-muted">WTC: ${escapeHtml(m.wtc || "—")}</div>
      </td>
      <td>
        <div class="cell-strong">${escapeHtml(m.depAd)} → ${escapeHtml(m.arrAd)}</div>
        <div class="cell-muted">${escapeHtml(m.depName)} → ${escapeHtml(m.arrName)}</div>
      </td>
      <td>
        <div class="cell-strong">${escapeHtml(depDisplay)} / ${escapeHtml(arrDisplay)}</div>
        <div class="cell-muted">${escapeHtml(m.flightType)} · ${escapeHtml(statusLabel(m.status))}</div>
      </td>
      <td>
        <div class="badge-row">
          ${renderBadges(m)}
        </div>
      </td>
      <td class="actions-cell">
        <button class="small-btn js-toggle-details" type="button">Details ▾</button>
      </td>
    `;

    // Bind details toggle
    const toggleBtn = tr.querySelector(".js-toggle-details");
    safeOn(toggleBtn, "click", (e) => {
      e.stopPropagation();
      expandedId = expandedId === m.id ? null : m.id;
      renderLiveBoard();
    });

    tbody.appendChild(tr);

    if (expandedId === m.id) {
      renderExpandedRow(tbody, m);
    }
  }

  if (!movements.length) {
    const empty = document.createElement("tr");
    empty.innerHTML = `
      <td colspan="7" style="padding:8px; font-size:12px; color:#777;">
        No demo movements match the current filters.
      </td>
    `;
    tbody.appendChild(empty);
  }
}

/* -----------------------------
   Modal helpers (demo-only)
------------------------------ */

function openModal(contentHtml) {
  const root = byId("modalRoot");
  if (!root) return;

  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        ${contentHtml}
      </div>
    </div>
  `;

  const backdrop = root.querySelector(".modal-backdrop");

  const closeModal = () => {
    root.innerHTML = "";
    document.removeEventListener("keydown", escHandler);
  };

  const escHandler = (e) => {
    if (e.key === "Escape") closeModal();
  };

  safeOn(backdrop, "click", (e) => {
    if (e.target === backdrop) closeModal();
  });

  backdrop
    ?.querySelectorAll(".js-close-modal")
    .forEach((btn) => safeOn(btn, "click", closeModal));

  // Real save handler is bound after modal opens via specific save functions

  document.addEventListener("keydown", escHandler);
}

function openNewFlightModal(flightType = "DEP") {
  openModal(`
    <div class="modal-header">
      <div>
        <div class="modal-title">New ${flightType} Flight</div>
        <div class="modal-subtitle">Create a new movement</div>
      </div>
      <button class="btn btn-ghost js-close-modal" type="button">✕</button>
    </div>
    <div class="modal-body">
      <div class="modal-field">
        <label class="modal-label">Callsign</label>
        <input id="newCallsign" class="modal-input" placeholder="e.g. CONNECT or CNNCT22" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Registration</label>
        <input id="newReg" class="modal-input" placeholder="e.g. ZM300" />
      </div>
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
          <option>VFR</option>
          <option>IFR</option>
          <option>SVFR</option>
        </select>
      </div>
      <div class="modal-field">
        <label class="modal-label">Departure AD</label>
        <input id="newDepAd" class="modal-input" placeholder="EGOS or Shawbury" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Arrival AD</label>
        <input id="newArrAd" class="modal-input" placeholder="EGOW or Woodvale" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Planned Departure</label>
        <input id="newDepPlanned" class="modal-input" placeholder="12:30" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Planned Arrival</label>
        <input id="newArrPlanned" class="modal-input" placeholder="13:05" />
      </div>
      <div class="modal-field">
        <label class="modal-label">POB</label>
        <input id="newPob" class="modal-input" type="number" placeholder="2" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Touch &amp; Go count</label>
        <input id="newTng" class="modal-input" type="number" placeholder="0" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Remarks</label>
        <textarea id="newRemarks" class="modal-textarea" placeholder="Any extra notes…"></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost js-close-modal" type="button">Cancel</button>
      <button class="btn btn-primary js-save-flight" type="button">Save</button>
    </div>
  `);

  // Bind save handler
  document.querySelector(".js-save-flight")?.addEventListener("click", () => {
    const movement = {
      status: "PLANNED",
      callsignCode: document.getElementById("newCallsign")?.value || "",
      callsignLabel: "",
      callsignVoice: "",
      registration: document.getElementById("newReg")?.value || "",
      type: "",
      wtc: "L (ICAO)",
      depAd: document.getElementById("newDepAd")?.value || "",
      depName: "",
      arrAd: document.getElementById("newArrAd")?.value || "",
      arrName: "",
      depPlanned: document.getElementById("newDepPlanned")?.value || "",
      depActual: "",
      arrPlanned: document.getElementById("newArrPlanned")?.value || "",
      arrActual: "",
      flightType: document.getElementById("newFlightType")?.value || flightType,
      isLocal: flightType === "LOC",
      tngCount: parseInt(document.getElementById("newTng")?.value || "0", 10),
      osCount: 0,
      fisCount: 0,
      egowCode: "",
      egowDesc: "",
      unitCode: "",
      unitDesc: "",
      captain: "",
      pob: parseInt(document.getElementById("newPob")?.value || "0", 10),
      remarks: document.getElementById("newRemarks")?.value || "",
      formation: null
    };

    createMovement(movement);
    renderLiveBoard();
    renderHistoryBoard();
    closeModal();
  });
}

function openNewLocalModal() {
  openModal(`
    <div class="modal-header">
      <div>
        <div class="modal-title">New Local Flight</div>
        <div class="modal-subtitle">Pre-configured for EGOW → EGOW VFR circuits</div>
      </div>
      <button class="btn btn-ghost js-close-modal" type="button">✕</button>
    </div>
    <div class="modal-body">
      <div class="modal-field">
        <label class="modal-label">Callsign</label>
        <input id="newLocCallsign" class="modal-input" placeholder="e.g. UAM11 or WOODVALE 11" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Registration</label>
        <input id="newLocReg" class="modal-input" placeholder="e.g. G-VAIR" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Flight Type</label>
        <input class="modal-input" value="LOC (Local)" disabled />
      </div>
      <div class="modal-field">
        <label class="modal-label">Departure / Arrival AD</label>
        <input class="modal-input" value="EGOW · RAF Woodvale" disabled />
      </div>
      <div class="modal-field">
        <label class="modal-label">Planned Start</label>
        <input id="newLocStart" class="modal-input" placeholder="12:30" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Planned End</label>
        <input id="newLocEnd" class="modal-input" placeholder="13:30" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Touch &amp; Go count</label>
        <input id="newLocTng" class="modal-input" type="number" placeholder="6" />
      </div>
      <div class="modal-field">
        <label class="modal-label">POB</label>
        <input id="newLocPob" class="modal-input" type="number" placeholder="2" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Remarks</label>
        <textarea id="newLocRemarks" class="modal-textarea" placeholder="Circuits RWY 21, left-hand."></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost js-close-modal" type="button">Cancel</button>
      <button class="btn btn-primary js-save-loc" type="button">Save</button>
    </div>
  `);

  // Bind save handler
  document.querySelector(".js-save-loc")?.addEventListener("click", () => {
    const movement = {
      status: "PLANNED",
      callsignCode: document.getElementById("newLocCallsign")?.value || "",
      callsignLabel: "",
      callsignVoice: "",
      registration: document.getElementById("newLocReg")?.value || "",
      type: "",
      wtc: "L (ICAO)",
      depAd: "EGOW",
      depName: "RAF Woodvale",
      arrAd: "EGOW",
      arrName: "RAF Woodvale",
      depPlanned: document.getElementById("newLocStart")?.value || "",
      depActual: "",
      arrPlanned: document.getElementById("newLocEnd")?.value || "",
      arrActual: "",
      flightType: "LOC",
      isLocal: true,
      tngCount: parseInt(document.getElementById("newLocTng")?.value || "0", 10),
      osCount: 0,
      fisCount: 0,
      egowCode: "",
      egowDesc: "",
      unitCode: "",
      unitDesc: "",
      captain: "",
      pob: parseInt(document.getElementById("newLocPob")?.value || "0", 10),
      remarks: document.getElementById("newLocRemarks")?.value || "",
      formation: null
    };

    createMovement(movement);
    renderLiveBoard();
    renderHistoryBoard();
    closeModal();
  });
}

/* -----------------------------
   Live Board init
------------------------------ */

/**
 * Initialise Live Board event listeners and initial render.
 * Supports both the current HTML IDs and legacy ones (for safety).
 */
export function initLiveBoard() {
  // Current index.html uses: globalSearch, colFilterCallsign, colFilterReg, colFilterRoute, btnNewLoc
  // Legacy variants exist in older branches: searchGlobal, filterCallsign, filterReg, filterRoute, btnNewLocal
  const globalSearch = firstById(["globalSearch", "searchGlobal"]);
  const filterCallsign = firstById(["colFilterCallsign", "filterCallsign"]);
  const filterReg = firstById(["colFilterReg", "filterReg"]);
  const filterRoute = firstById(["colFilterRoute", "filterRoute"]);
  const statusFilter = byId("statusFilter");
  const dateRange = byId("dateRange"); // optional, may not exist
  const btnNewFlight = firstById(["btnNewFlight", "btnNewArr", "btnNewDep", "btnNewOvr"]);
  const btnNewLoc = document.getElementById("btnNewLoc");
  const btnNewDep = document.getElementById("btnNewDep");
  const btnNewArr = document.getElementById("btnNewArr");
  const btnNewOvr = document.getElementById("btnNewOvr");
 // demo fallback
  const btnNewLocal = firstById(["btnNewLoc", "btnNewLocal"]);

  safeOn(globalSearch, "input", (e) => {
    state.globalFilter = e.target.value;
    renderLiveBoard();
  });

  safeOn(filterCallsign, "input", (e) => {
    state.columnFilters.callsign = e.target.value;
    renderLiveBoard();
  });

  safeOn(filterReg, "input", (e) => {
    state.columnFilters.reg = e.target.value;
    renderLiveBoard();
  });

  safeOn(filterRoute, "input", (e) => {
    state.columnFilters.route = e.target.value;
    renderLiveBoard();
  });

  safeOn(statusFilter, "change", () => renderLiveBoard());

  safeOn(dateRange, "change", () => {
    // Placeholder for future behaviour (no-op today)
    renderLiveBoard();
  });

safeOn(btnNewLoc, "click", openNewLocalModal);
safeOn(btnNewDep, "click", () => openNewFlightModal("DEP"));
safeOn(btnNewArr, "click", () => openNewFlightModal("ARR"));
safeOn(btnNewOvr, "click", () => openNewFlightModal("OVR"));

  renderLiveBoard();
}

/* -----------------------------
   Stubs for other panels (kept for app.js imports)
   If you already have implementations elsewhere in your file, keep those instead.
------------------------------ */

export function renderHistoryBoard() {
  // No-op stub: implement if needed in this file.
}

export function renderReportsSummary() {
  // No-op stub: implement if needed in this file.
}

export function initHistoryExport() {
  // No-op stub: implement if needed in this file.
}

export function initVkbLookup() {
  // No-op stub: implement if needed in this file.
}

export function initAdminPanel() {
  // No-op stub: implement if needed in this file.
}

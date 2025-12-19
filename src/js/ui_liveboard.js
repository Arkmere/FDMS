// ui_liveboard.js
// Handles rendering and interactions for the Live Board, History, Reports, VKB, and Admin panels.
// ES module, no framework, DOM-contract driven.

import {
  getMovements,
  statusClass,
  statusLabel,
  createMovement,
  inferTypeFromReg,
  getETD,
  getATD,
  getETA,
  getATA,
  getECT,
  getACT,
  getConfig,
  convertUTCToLocal,
  getTimezoneOffsetLabel
} from "./datamodel.js";

/* -----------------------------
   State
------------------------------ */

let expandedId = null;

const state = {
  globalFilter: "",
  plannedWindowHours: 24, // Show PLANNED movements within this many hours
  showLocalTimeInModals: false // Show local time conversions in modals
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
  if (ft === "ARR") return timeToMinutes(getETA(m));
  if (ft === "OVR") return timeToMinutes(getECT(m));
  return timeToMinutes(getETD(m));
}

function activeSortMinutes(m) {
  const ft = (m.flightType || "").toUpperCase();
  if (ft === "ARR") return timeToMinutes(getATA(m) || getETA(m));
  if (ft === "LOC") return timeToMinutes(getATD(m) || getATA(m) || getETD(m));
  if (ft === "OVR") return timeToMinutes(getACT(m) || getECT(m));
  return timeToMinutes(getATD(m) || getETD(m));
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
          <div class="kv-label">ETD / ETA / ECT</div><div class="kv-value">${escapeHtml(getETD(m) || getECT(m) || "—")} → ${escapeHtml(getETA(m) || "—")}</div>
          <div class="kv-label">ATD / ATA / ACT</div><div class="kv-value">${escapeHtml(getATD(m) || getACT(m) || "—")} → ${escapeHtml(getATA(m) || "—")}</div>
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
        <label class="modal-label">Aircraft Type</label>
        <input id="newType" class="modal-input" placeholder="e.g. JUNO (auto-filled from registration)" />
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
        <input id="newDepAd" class="modal-input" placeholder="EGOS or Shawbury" value="${flightType === "DEP" || flightType === "LOC" ? "EGOW" : ""}" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Arrival AD</label>
        <input id="newArrAd" class="modal-input" placeholder="EGOW or Woodvale" value="${flightType === "ARR" || flightType === "LOC" ? "EGOW" : ""}" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Date of Flight (DOF)</label>
        <input id="newDOF" type="date" class="modal-input" value="${getTodayDateString()}" />
      </div>
      <div class="modal-field">
        <label class="modal-label">
          Estimated Departure (ETD / ECT) - UTC
          <span style="font-size: 11px; font-weight: normal; margin-left: 8px;">
            <input type="checkbox" id="showLocalTimeDep" style="margin: 0 4px;"/>Show Local Time
          </span>
        </label>
        <div style="display: flex; gap: 8px; align-items: center;">
          <input id="newDepPlanned" class="modal-input" placeholder="12:30" style="width: 80px;" />
          <span id="localDepTime" style="font-size: 12px; color: #666;"></span>
        </div>
      </div>
      <div class="modal-field">
        <label class="modal-label">
          Estimated Arrival (ETA) - UTC
          <span style="font-size: 11px; font-weight: normal; margin-left: 8px;">
            <input type="checkbox" id="showLocalTimeArr" style="margin: 0 4px;"/>Show Local Time
          </span>
        </label>
        <div style="display: flex; gap: 8px; align-items: center;">
          <input id="newArrPlanned" class="modal-input" placeholder="13:05" style="width: 80px;" />
          <span id="localArrTime" style="font-size: 12px; color: #666;"></span>
        </div>
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

  // Bind type inference to registration field
  const regInput = document.getElementById("newReg");
  const typeInput = document.getElementById("newType");
  if (regInput && typeInput) {
    regInput.addEventListener("input", () => {
      const inferredType = inferTypeFromReg(regInput.value);
      if (inferredType) {
        typeInput.value = inferredType;
      }
    });
  }

  // Bind local time display handlers
  const depTimeInput = document.getElementById("newDepPlanned");
  const arrTimeInput = document.getElementById("newArrPlanned");
  const showLocalDepCheck = document.getElementById("showLocalTimeDep");
  const showLocalArrCheck = document.getElementById("showLocalTimeArr");
  const localDepSpan = document.getElementById("localDepTime");
  const localArrSpan = document.getElementById("localArrTime");

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

  // Bind save handler
  document.querySelector(".js-save-flight")?.addEventListener("click", () => {
    const movement = {
      status: "PLANNED",
      callsignCode: document.getElementById("newCallsign")?.value || "",
      callsignLabel: "",
      callsignVoice: "",
      registration: document.getElementById("newReg")?.value || "",
      type: document.getElementById("newType")?.value || "",
      wtc: "L (ICAO)",
      depAd: document.getElementById("newDepAd")?.value || "",
      depName: "",
      arrAd: document.getElementById("newArrAd")?.value || "",
      arrName: "",
      depPlanned: document.getElementById("newDepPlanned")?.value || "",
      depActual: "",
      arrPlanned: document.getElementById("newArrPlanned")?.value || "",
      arrActual: "",
      dof: document.getElementById("newDOF")?.value || getTodayDateString(),
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

    // Close modal
    const modalRoot = document.getElementById("modalRoot");
    if (modalRoot) modalRoot.innerHTML = "";
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
        <label class="modal-label">Aircraft Type</label>
        <input id="newLocType" class="modal-input" placeholder="e.g. G115 (auto-filled from registration)" />
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
        <label class="modal-label">Date of Flight (DOF)</label>
        <input id="newLocDOF" type="date" class="modal-input" value="${getTodayDateString()}" />
      </div>
      <div class="modal-field">
        <label class="modal-label">
          Estimated Departure (ETD) - UTC
          <span style="font-size: 11px; font-weight: normal; margin-left: 8px;">
            <input type="checkbox" id="showLocalTimeLocDep" style="margin: 0 4px;"/>Show Local Time
          </span>
        </label>
        <div style="display: flex; gap: 8px; align-items: center;">
          <input id="newLocStart" class="modal-input" placeholder="12:30" style="width: 80px;" />
          <span id="localLocDepTime" style="font-size: 12px; color: #666;"></span>
        </div>
      </div>
      <div class="modal-field">
        <label class="modal-label">
          Estimated Arrival (ETA) - UTC
          <span style="font-size: 11px; font-weight: normal; margin-left: 8px;">
            <input type="checkbox" id="showLocalTimeLocArr" style="margin: 0 4px;"/>Show Local Time
          </span>
        </label>
        <div style="display: flex; gap: 8px; align-items: center;">
          <input id="newLocEnd" class="modal-input" placeholder="13:30" style="width: 80px;" />
          <span id="localLocArrTime" style="font-size: 12px; color: #666;"></span>
        </div>
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

  // Bind type inference to registration field
  const regInput = document.getElementById("newLocReg");
  const typeInput = document.getElementById("newLocType");
  if (regInput && typeInput) {
    regInput.addEventListener("input", () => {
      const inferredType = inferTypeFromReg(regInput.value);
      if (inferredType) {
        typeInput.value = inferredType;
      }
    });
  }

  // Bind local time display handlers
  const depTimeInput = document.getElementById("newLocStart");
  const arrTimeInput = document.getElementById("newLocEnd");
  const showLocalDepCheck = document.getElementById("showLocalTimeLocDep");
  const showLocalArrCheck = document.getElementById("showLocalTimeLocArr");
  const localDepSpan = document.getElementById("localLocDepTime");
  const localArrSpan = document.getElementById("localLocArrTime");

  function updateLocalLocDepTime() {
    if (showLocalDepCheck && showLocalDepCheck.checked && depTimeInput && localDepSpan) {
      const utcTime = depTimeInput.value;
      const localTime = convertUTCToLocal(utcTime);
      const offset = getTimezoneOffsetLabel();
      localDepSpan.textContent = localTime ? `Local: ${localTime} (${offset})` : "";
    } else if (localDepSpan) {
      localDepSpan.textContent = "";
    }
  }

  function updateLocalLocArrTime() {
    if (showLocalArrCheck && showLocalArrCheck.checked && arrTimeInput && localArrSpan) {
      const utcTime = arrTimeInput.value;
      const localTime = convertUTCToLocal(utcTime);
      const offset = getTimezoneOffsetLabel();
      localArrSpan.textContent = localTime ? `Local: ${localTime} (${offset})` : "";
    } else if (localArrSpan) {
      localArrSpan.textContent = "";
    }
  }

  if (showLocalDepCheck) showLocalDepCheck.addEventListener("change", updateLocalLocDepTime);
  if (showLocalArrCheck) showLocalArrCheck.addEventListener("change", updateLocalLocArrTime);
  if (depTimeInput) depTimeInput.addEventListener("input", updateLocalLocDepTime);
  if (arrTimeInput) arrTimeInput.addEventListener("input", updateLocalLocArrTime);

  // Bind save handler
  document.querySelector(".js-save-loc")?.addEventListener("click", () => {
    const movement = {
      status: "PLANNED",
      callsignCode: document.getElementById("newLocCallsign")?.value || "",
      callsignLabel: "",
      callsignVoice: "",
      registration: document.getElementById("newLocReg")?.value || "",
      type: document.getElementById("newLocType")?.value || "",
      wtc: "L (ICAO)",
      depAd: "EGOW",
      depName: "RAF Woodvale",
      arrAd: "EGOW",
      arrName: "RAF Woodvale",
      depPlanned: document.getElementById("newLocStart")?.value || "",
      depActual: "",
      arrPlanned: document.getElementById("newLocEnd")?.value || "",
      arrActual: "",
      dof: document.getElementById("newLocDOF")?.value || getTodayDateString(),
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

    // Close modal
    const modalRoot = document.getElementById("modalRoot");
    if (modalRoot) modalRoot.innerHTML = "";
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
  // Elements
  const globalSearch = firstById(["globalSearch", "searchGlobal"]);
  const statusFilter = byId("statusFilter");
  const plannedWindowSelect = byId("plannedWindowHours");
  const btnNewLoc = document.getElementById("btnNewLoc");
  const btnNewDep = document.getElementById("btnNewDep");
  const btnNewArr = document.getElementById("btnNewArr");
  const btnNewOvr = document.getElementById("btnNewOvr");

  // Global search filter
  safeOn(globalSearch, "input", (e) => {
    state.globalFilter = e.target.value;
    renderLiveBoard();
  });

  // Status filter
  safeOn(statusFilter, "change", () => renderLiveBoard());

  // Planned window filter
  safeOn(plannedWindowSelect, "change", (e) => {
    state.plannedWindowHours = parseInt(e.target.value, 10);
    renderLiveBoard();
  });

  // New movement buttons
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

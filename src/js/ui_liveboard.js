// ui_liveboard.js
// Handles rendering and interactions for the Live Board view.

import { getMovements, statusClass, statusLabel } from "./datamodel.js";

let expandedId = null;

const columnFilters = {
  callsign: "",
  reg: "",
  route: ""
};

let globalFilter = "";

function getStatusFilter() {
  const select = document.getElementById("statusFilter");
  return select ? select.value : "planned_active";
}

/**
 * Returns true if a movement matches the current filters.
 */
function matchesFilters(m) {
  const statusFilter = getStatusFilter();

  if (statusFilter === "active" && m.status !== "ACTIVE") return false;
  if (
    statusFilter === "planned_active" &&
    !(m.status === "PLANNED" || m.status === "ACTIVE")
  )
    return false;

  const gq = globalFilter.trim().toLowerCase();
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

  if (columnFilters.callsign) {
    const q = columnFilters.callsign.toLowerCase();
    const s1 = m.callsignCode.toLowerCase();
    const s2 = (m.callsignLabel || "").toLowerCase();
    if (!s1.includes(q) && !s2.includes(q)) return false;
  }

  if (columnFilters.reg) {
    const q = columnFilters.reg.toLowerCase();
    if (!(m.registration || "").toLowerCase().includes(q)) return false;
  }

  if (columnFilters.route) {
    const q = columnFilters.route.toLowerCase();
    const r = `${m.depAd} ${m.depName} ${m.arrAd} ${m.arrName}`.toLowerCase();
    if (!r.includes(q)) return false;
  }

  return true;
}

/**
 * Renders the Live Board table body.
 */
export function renderLiveBoard() {
  const tbody = document.getElementById("liveBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  const movements = getMovements().filter(matchesFilters);

  movements.forEach((m) => {
    const tr = document.createElement("tr");
    tr.className = "strip-row";
    tr.dataset.id = String(m.id);

    const depDisplay = m.depActual || m.depPlanned || "-";
    const arrDisplay = m.arrActual || m.arrPlanned || "-";

    tr.innerHTML = `
      <td><div class="status-strip ${statusClass(
        m.status
      )}" title="${statusLabel(m.status)}"></div></td>
      <td>
        <div class="call-main">${m.callsignCode}</div>
        <div class="call-sub">${m.callsignLabel || "&nbsp;"}</div>
      </td>
      <td>
        <div class="cell-strong">${m.registration || "—"}${
      m.type ? " · " + m.type : ""
    }</div>
        <div class="cell-muted">WTC: ${m.wtc || "—"}</div>
      </td>
      <td>
        <div class="cell-strong">${m.depAd} → ${m.arrAd}</div>
        <div class="cell-muted">${m.depName} → ${m.arrName}</div>
      </td>
      <td>
        <div class="cell-strong">${depDisplay} / ${arrDisplay}</div>
        <div class="cell-muted">${m.flightType} · ${statusLabel(
      m.status
    )}</div>
      </td>
      <td>
        <div class="badge-row">
          <span class="badge">${m.flightType}</span>
          ${m.isLocal ? '<span class="badge badge-local">Local</span>' : ""}
          ${
            m.tngCount
              ? `<span class="badge badge-tng">T&amp;G × ${m.tngCount}</span>`
              : ""
          }
          ${
            m.osCount
              ? `<span class="badge badge-os">O/S × ${m.osCount}</span>`
              : ""
          }
          ${
            m.fisCount
              ? `<span class="badge badge-fis">FIS × ${m.fisCount}</span>`
              : ""
          }
          ${
            m.formation
              ? `<span class="badge badge-formation">F×${m.formation.elements.length}</span>`
              : ""
          }
        </div>
      </td>
      <td class="actions-cell">
        <button class="small-btn js-toggle-details">Details ▾</button>
      </td>
    `;

    tr
      .querySelector(".js-toggle-details")
      .addEventListener("click", (e) => {
        e.stopPropagation();
        expandedId = expandedId === m.id ? null : m.id;
        renderLiveBoard();
      });

    tbody.appendChild(tr);

    if (expandedId === m.id) {
      const expTr = document.createElement("tr");
      expTr.className = "expand-row";
      const expTd = document.createElement("td");
      expTd.colSpan = 7;

      const formationHtml = m.formation
        ? `
        <div class="expand-section">
          <div class="expand-title">Formation</div>
          <div class="kv">
            <div class="kv-label">Label</div><div class="kv-value">${
              m.formation.label
            }</div>
            <div class="kv-label">Current WTC</div><div class="kv-value">${
              m.formation.wtcCurrent
            }</div>
            <div class="kv-label">Max WTC</div><div class="kv-value">${
              m.formation.wtcMax
            }</div>
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
              ${m.formation.elements
                .map(
                  (el) => `
                <tr>
                  <td>${el.callsign}</td>
                  <td>${el.reg || "—"}</td>
                  <td>${el.type || "—"}</td>
                  <td>${el.wtc || "—"}</td>
                  <td>${statusLabel(el.status)}</td>
                  <td>${el.depActual || "—"}</td>
                  <td>${el.arrActual || "—"}</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `
        : "";

      expTd.innerHTML = `
        <div class="expand-inner">
          <div class="expand-section">
            <div class="expand-title">Movement Summary</div>
            <div class="kv">
              <div class="kv-label">Status</div><div class="kv-value">${statusLabel(
                m.status
              )}</div>
              <div class="kv-label">Flight Type</div><div class="kv-value">${
                m.flightType
              }</div>
              <div class="kv-label">Departure</div><div class="kv-value">${
                m.depAd
              } – ${m.depName}</div>
              <div class="kv-label">Arrival</div><div class="kv-value">${
                m.arrAd
              } – ${m.arrName}</div>
              <div class="kv-label">Planned times</div><div class="kv-value">${
                m.depPlanned || "—"
              } → ${m.arrPlanned || "—"}</div>
              <div class="kv-label">Actual times</div><div class="kv-value">${
                m.depActual || "—"
              } → ${m.arrActual || "—"}</div>
              <div class="kv-label">T&amp;Gs</div><div class="kv-value">${
                m.tngCount
              }</div>
              <div class="kv-label">O/S count</div><div class="kv-value">${
                m.osCount
              }</div>
              <div class="kv-label">FIS count</div><div class="kv-value">${
                m.fisCount
              }</div>
              <div class="kv-label">POB</div><div class="kv-value">${
                m.pob || 0
              }</div>
            </div>
          </div>
          <div class="expand-section">
            <div class="expand-title">Coding &amp; Classification</div>
            <div class="kv">
              <div class="kv-label">EGOW code</div><div class="kv-value">${
                m.egowCode || "—"
              } – ${m.egowDesc || ""}</div>
              <div class="kv-label">Unit</div><div class="kv-value">${
                m.unitCode || "—"
              }${m.unitDesc ? " · " + m.unitDesc : ""}</div>
              <div class="kv-label">Callsign (voice)</div><div class="kv-value">${
                m.callsignVoice || "—"
              }</div>
              <div class="kv-label">Captain</div><div class="kv-value">${
                m.captain || "—"
              }</div>
              <div class="kv-label">Remarks</div><div class="kv-value">${
                m.remarks || "—"
              }</div>
            </div>
          </div>
          ${formationHtml}
        </div>
      `;

      expTr.appendChild(expTd);
      tbody.appendChild(expTr);
    }
  });

  if (!movements.length) {
    const empty = document.createElement("tr");
    empty.innerHTML = `
      <td colspan="7" style="padding:8px; font-size:12px; color:#777;">
        No demo movements match the current filters.
      </td>`;
    tbody.appendChild(empty);
  }
}

/**
 * Creates and shows a modal. `contentHtml` is the inner HTML of the modal box.
 */
function openModal(contentHtml) {
  const root = document.getElementById("modalRoot");
  if (!root) return;

  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        ${contentHtml}
      </div>
    </div>
  `;

  const backdrop = root.querySelector(".modal-backdrop");

  function closeModal() {
    root.innerHTML = "";
    document.removeEventListener("keydown", escHandler);
  }

  function escHandler(e) {
    if (e.key === "Escape") closeModal();
  }

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      closeModal();
    }
  });

  // Hook up any buttons with .js-close-modal or .js-save-demo
  backdrop
    .querySelectorAll(".js-close-modal")
    .forEach((btn) => btn.addEventListener("click", closeModal));

  backdrop
    .querySelectorAll(".js-save-demo")
    .forEach((btn) =>
      btn.addEventListener("click", () => {
        // Placeholder – in future this will actually save a movement.
        alert("Demo only: in the full app this would create a new movement.");
        closeModal();
      })
    );

  document.addEventListener("keydown", escHandler);
}

function openNewFlightModal() {
  openModal(`
    <div class="modal-header">
      <div>
        <div class="modal-title">New Flight (Demo)</div>
        <div class="modal-subtitle">Visual mock only – values are not stored.</div>
      </div>
      <button class="btn btn-ghost js-close-modal">✕</button>
    </div>
    <div class="modal-body">
      <div class="modal-field">
        <label class="modal-label">Callsign</label>
        <input class="modal-input" placeholder="e.g. CONNECT or CNNCT22" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Registration</label>
        <input class="modal-input" placeholder="e.g. ZM300" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Flight Type</label>
        <select class="modal-select">
          <option>ARR</option>
          <option>DEP</option>
          <option>LOC</option>
          <option>OVR</option>
        </select>
      </div>
      <div class="modal-field">
        <label class="modal-label">Flight Rules</label>
        <select class="modal-select">
          <option>VFR</option>
          <option>IFR</option>
          <option>SVFR</option>
        </select>
      </div>
      <div class="modal-field">
        <label class="modal-label">Departure AD</label>
        <input class="modal-input" placeholder="EGOS or Shawbury" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Arrival AD</label>
        <input class="modal-input" placeholder="EGOW or Woodvale" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Planned Off-Block</label>
        <input class="modal-input" placeholder="12:30" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Planned ETA</label>
        <input class="modal-input" placeholder="13:05" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Number of aircraft</label>
        <input class="modal-input" placeholder="1" />
      </div>
      <div class="modal-field">
        <label class="modal-label">POB</label>
        <input class="modal-input" placeholder="2" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Touch &amp; Go count</label>
        <input class="modal-input" placeholder="0" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Outstation?</label>
        <select class="modal-select">
          <option>No</option>
          <option>Yes</option>
        </select>
      </div>
      <div class="modal-field">
        <label class="modal-label">Remarks</label>
        <textarea class="modal-textarea" placeholder="Any extra notes…"></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost js-close-modal">Cancel</button>
      <div style="display:flex; gap:6px;">
        <button class="btn btn-secondary-modal js-save-demo">
          Save &amp; Duplicate
        </button>
        <button class="btn btn-primary js-save-demo">
          Save
        </button>
      </div>
    </div>
  `);
}

function openNewLocalModal() {
  openModal(`
    <div class="modal-header">
      <div>
        <div class="modal-title">New Local Flight (Demo)</div>
        <div class="modal-subtitle">Pre-configured for EGOW → EGOW VFR circuits.</div>
      </div>
      <button class="btn btn-ghost js-close-modal">✕</button>
    </div>
    <div class="modal-body">
      <div class="modal-field">
        <label class="modal-label">Callsign</label>
        <input class="modal-input" placeholder="e.g. UAM11 or WOODVALE 11" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Registration</label>
        <input class="modal-input" placeholder="e.g. G-VAIR" />
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
        <input class="modal-input" placeholder="12:30" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Planned End</label>
        <input class="modal-input" placeholder="13:30" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Number of aircraft</label>
        <input class="modal-input" placeholder="1" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Touch &amp; Go count</label>
        <input class="modal-input" placeholder="6" />
      </div>
      <div class="modal-field">
        <label class="modal-label">POB</label>
        <input class="modal-input" placeholder="2" />
      </div>
      <div class="modal-field">
        <label class="modal-label">Remarks</label>
        <textarea class="modal-textarea" placeholder="Circuits RWY 21, left-hand."></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost js-close-modal">Cancel</button>
      <button class="btn btn-primary js-save-demo">
        Save
      </button>
    </div>
  `);
}

/**
 * Initialise Live Board event listeners and initial render.
 */
export function initLiveBoard() {
  const globalSearch = document.getElementById("searchGlobal");
  const filterCallsign = document.getElementById("filterCallsign");
  const filterReg = document.getElementById("filterReg");
  const filterRoute = document.getElementById("filterRoute");
  const statusFilter = document.getElementById("statusFilter");
  const dateRange = document.getElementById("dateRange");
  const btnNewFlight = document.getElementById("btnNewFlight");
  const btnNewLocal = document.getElementById("btnNewLocal");

  if (globalSearch) {
    globalSearch.addEventListener("input", (e) => {
      globalFilter = e.target.value;
      renderLiveBoard();
    });
  }

  if (filterCallsign) {
    filterCallsign.addEventListener("input", (e) => {
      columnFilters.callsign = e.target.value;
      renderLiveBoard();
    });
  }

  if (filterReg) {
    filterReg.addEventListener("input", (e) => {
      columnFilters.reg = e.target.value;
      renderLiveBoard();
    });
  }

  if (filterRoute) {
    filterRoute.addEventListener("input", (e) => {
      columnFilters.route = e.target.value;
      renderLiveBoard();
    });
  }

  if (statusFilter) {
    statusFilter.addEventListener("change", renderLiveBoard);
  }

  if (dateRange) {
    // At the moment dateRange does not change behaviour – placeholder for later.
    dateRange.addEventListener("change", renderLiveBoard);
  }

  if (btnNewFlight) {
    btnNewFlight.addEventListener("click", openNewFlightModal);
  }

  if (btnNewLocal) {
    btnNewLocal.addEventListener("click", openNewLocalModal);
  }

  renderLiveBoard();
}

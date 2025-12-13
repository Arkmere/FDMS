// ui_liveboard.js
// Handles rendering and interactions for the Live Board view.

import { getMovements, statusClass, statusLabel, createMovement, updateMovement, resetMovementsToDemo } from "./datamodel.js";

let expandedId = null;

const columnFilters = {
  callsign: "",
  reg: "",
  route: ""
};

let globalFilter = "";

function parseNonNegativeInt(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function normaliseAdCode(value) {
  return (value || "").trim().toUpperCase();
}

function inferAdName(adCode) {
  const code = normaliseAdCode(adCode);
  if (!code) return "";
  if (code === "EGOW") return "RAF Woodvale";
  // Later this can use VKB lookup; for now just return code.
  return code;
}

// --- VKB demo dataset -------------------------------------------------------

const vkbDemoEntries = [
  // Callsigns – civil
  {
    kind: "Callsign",
    category: "Airline",
    code: "BAW",
    label: "SPEEDBIRD",
    details: "British Airways (BA/BAW)",
  },
  {
    kind: "Callsign",
    category: "Airline",
    code: "EZY",
    label: "EASY",
    details: "easyJet (U2/EZY)",
  },
  // Callsigns – military / state
  {
    kind: "Callsign",
    category: "Military",
    code: "RRR",
    label: "ASCOT",
    details: "RAF Air Transport / VIP flights",
  },
  {
    kind: "Callsign",
    category: "Military",
    code: "SYS",
    label: "SHAWBURY",
    details: "RAF Shawbury training flights",
  },

  // Locations
  {
    kind: "Location",
    category: "Aerodrome",
    code: "EGOW",
    label: "RAF Woodvale",
    details: "Local unit – Woodvale (Sefton), 21/03 runway pair",
  },
  {
    kind: "Location",
    category: "Aerodrome",
    code: "EGGP",
    label: "Liverpool John Lennon",
    details: "Regional; often used as O/S or practice diversion",
  },
  {
    kind: "Location",
    category: "Aerodrome",
    code: "EGCC",
    label: "Manchester",
    details: "Major regional hub; frequent visiting traffic",
  },

  // Aircraft types
  {
    kind: "Aircraft type",
    category: "Trainer",
    code: "G115E",
    label: "Grob Tutor",
    details: "Light trainer, WTC L, used for UAS / EFT",
  },
  {
    kind: "Aircraft type",
    category: "Helicopter",
    code: "EH10",
    label: "Eurocopter Dauphin (demo)",
    details: "Helicopter, WTC L/M depending on scheme",
  },
  {
    kind: "Aircraft type",
    category: "Airliner",
    code: "A320",
    label: "Airbus A320",
    details: "Typical short-haul jet, WTC M",
  },
];

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
      <td>
        <div class="status-strip ${statusClass(m.status)}"></div>
      </td>
      <td>
        <div class="call-main">${m.callsignCode}</div>
        <div class="call-sub">${m.callsignLabel || "&nbsp;"}</div>
      </td>
      <td>
        <div class="cell-strong">
          ${m.registration || "—"}${m.type ? " · " + m.type : ""}
        </div>
        <div class="cell-muted">WTC: ${m.wtc || "—"}</div>
      </td>
      <td>
        <div class="cell-strong">
          ${m.depAd} → ${m.arrAd}
        </div>
        <div class="cell-muted">
          ${m.depName} → ${m.arrName}
        </div>
      </td>
      <td>
        <div class="cell-strong">
          ${depDisplay} / ${arrDisplay}
        </div>
        <div class="cell-muted">
          ${m.flightType} · ${statusLabel(m.status)}
        </div>
      </td>
      <td>
        <div class="badge-row">
          ${m.isLocal ? '<span class="badge badge-local">Local</span>' : ""}
          ${m.tngCount ? `<span class="badge badge-tng">T&amp;G × ${m.tngCount}</span>` : ""}
          ${m.osCount ? `<span class="badge badge-os">O/S × ${m.osCount}</span>` : ""}
          ${m.fisCount ? `<span class="badge badge-fis">FIS × ${m.fisCount}</span>` : ""}
          ${m.formation ? `<span class="badge badge-formation">F×${m.formation.elements.length}</span>` : ""}
        </div>
      </td>
      <td class="actions-cell">
        <button class="small-btn js-toggle-details">Details ▾</button>
        <button class="small-btn js-edit-movement">Edit</button>
        ${
          m.status === "PLANNED"
            ? `
          <button class="small-btn js-mark-active">Mark Active</button>
          <button class="small-btn js-mark-cancelled">Cancel</button>
        `
            : ""
        }
        ${
          m.status === "ACTIVE"
            ? `
          <button class="small-btn js-mark-completed">Mark Completed</button>
          <button class="small-btn js-mark-cancelled">Cancel</button>
        `
            : ""
        }
      </td>
    `;

    // Details toggle
    const detailsBtn = tr.querySelector(".js-toggle-details");
    if (detailsBtn) {
      detailsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        expandedId = expandedId === m.id ? null : m.id;
        renderLiveBoard();
      });
    }

    // Status transitions (admin, not "clearances")
    const markActiveBtn = tr.querySelector(".js-mark-active");
    if (markActiveBtn) {
      markActiveBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        updateMovement(m.id, { status: "ACTIVE" });
        renderLiveBoard();
        renderHistoryBoard();
        renderReportsSummary();
      });
    }

    const markCompletedBtn = tr.querySelector(".js-mark-completed");
    if (markCompletedBtn) {
      markCompletedBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        updateMovement(m.id, { status: "COMPLETED" });
        renderLiveBoard();
        renderHistoryBoard();
        renderReportsSummary();
      });
    }

    const markCancelledBtn = tr.querySelector(".js-mark-cancelled");
    if (markCancelledBtn) {
      markCancelledBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        updateMovement(m.id, { status: "CANCELLED" });
        renderLiveBoard();
        renderHistoryBoard();
        renderReportsSummary();
      });
    }

    const editBtn = tr.querySelector(".js-edit-movement");
    if (editBtn) {
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openEditMovementModal(m);
      });
    }

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

export function renderHistoryBoard() {
  const tbody = document.getElementById("historyBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  const movements = getMovements().filter(
    (m) => m.status === "COMPLETED" || m.status === "CANCELLED"
  );

  if (!movements.length) {
    const empty = document.createElement("tr");
    empty.innerHTML = `
      <td colspan="7" class="cell-muted">
        No completed or cancelled movements in this session.
      </td>
    `;
    tbody.appendChild(empty);
    return;
  }

  movements.forEach((m) => {
    const tr = document.createElement("tr");
    tr.className = "strip-row";
    tr.dataset.id = String(m.id);

    const depDisplay = m.depActual || m.depPlanned || "-";
    const arrDisplay = m.arrActual || m.arrPlanned || "-";

    tr.innerHTML = `
      <td>
        <div class="status-strip ${statusClass(m.status)}"></div>
      </td>
      <td>
        <div class="call-main">${m.callsignCode}</div>
        <div class="call-sub">${m.callsignLabel || "&nbsp;"}</div>
      </td>
      <td>
        <div class="cell-strong">
          ${m.registration || "—"}${m.type ? " · " + m.type : ""}
        </div>
        <div class="cell-muted">WTC: ${m.wtc || "—"}</div>
      </td>
      <td>
        <div class="cell-strong">
          ${m.depAd} → ${m.arrAd}
        </div>
        <div class="cell-muted">
          ${m.depName} → ${m.arrName}
        </div>
      </td>
      <td>
        <div class="cell-strong">
          ${depDisplay} / ${arrDisplay}
        </div>
        <div class="cell-muted">
          ${m.flightType}
        </div>
      </td>
      <td>
        <div class="badge-row">
          ${m.isLocal ? '<span class="badge badge-local">Local</span>' : ""}
          ${m.tngCount ? `<span class="badge badge-tng">T&amp;G × ${m.tngCount}</span>` : ""}
          ${m.osCount ? `<span class="badge badge-os">O/S × ${m.osCount}</span>` : ""}
          ${m.fisCount ? `<span class="badge badge-fis">FIS × ${m.fisCount}</span>` : ""}
          ${m.formation ? `<span class="badge badge-formation">F×${m.formation.elements.length}</span>` : ""}
        </div>
      </td>
      <td>
        <div class="cell-strong">${statusLabel(m.status)}</div>
        <div class="cell-muted">${m.egowCode || ""}</div>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

export function renderReportsSummary() {
  const container = document.getElementById("reportsSummary");
  if (!container) return;

  const movements = getMovements();

  const total = movements.length;
  const planned = movements.filter((m) => m.status === "PLANNED").length;
  const active = movements.filter((m) => m.status === "ACTIVE").length;
  const completed = movements.filter((m) => m.status === "COMPLETED").length;
  const cancelled = movements.filter((m) => m.status === "CANCELLED").length;

  const local = movements.filter((m) => m.isLocal).length;
  const nonLocal = total - local;

  const totalTng = movements.reduce((sum, m) => sum + (m.tngCount || 0), 0);
  const totalOs = movements.reduce((sum, m) => sum + (m.osCount || 0), 0);
  const totalFis = movements.reduce((sum, m) => sum + (m.fisCount || 0), 0);

  container.innerHTML = `
    <div class="report-card">
      <div class="report-card-title">Movements (session)</div>
      <div class="report-card-main">${total}</div>
      <div class="report-card-breakdown">
        <span>Planned: ${planned}</span>
        <span>Active: ${active}</span>
        <span>Completed: ${completed}</span>
        <span>Cancelled: ${cancelled}</span>
      </div>
    </div>

    <div class="report-card">
      <div class="report-card-title">Local vs Visiting</div>
      <div class="report-card-main">${local}</div>
      <div class="report-card-breakdown">
        <span>Local: ${local}</span>
        <span>Visiting/Other: ${nonLocal}</span>
      </div>
    </div>

    <div class="report-card">
      <div class="report-card-title">Activity Counts</div>
      <div class="report-card-main">${totalTng}</div>
      <div class="report-card-breakdown">
        <span>T&amp;Gs: ${totalTng}</span>
        <span>Outstations: ${totalOs}</span>
        <span>FIS: ${totalFis}</span>
      </div>
    </div>
  `;
}

/**
 * CSV Export Helpers
 */
function csvEscape(value) {
  if (value == null) return "";
  const str = String(value);
  // If it contains comma, quote, newline, or leading/trailing space, wrap in quotes and escape internal quotes
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r") || /^\s|\s$/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function downloadCsv(filename, csvString) {
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportHistoryCsv() {
  const movements = getMovements().filter(
    (m) => m.status === "COMPLETED" || m.status === "CANCELLED"
  );

  if (!movements.length) {
    alert("No completed or cancelled movements to export.");
    return;
  }

  // Define CSV columns (24 total)
  const headers = [
    "ID",
    "Status",
    "Callsign Code",
    "Callsign Label",
    "Registration",
    "Type",
    "WTC",
    "Dep AD",
    "Dep Name",
    "Arr AD",
    "Arr Name",
    "Dep Planned",
    "Dep Actual",
    "Arr Planned",
    "Arr Actual",
    "Flight Type",
    "Is Local",
    "TNG Count",
    "OS Count",
    "FIS Count",
    "POB",
    "Remarks",
    "EGOW Code",
    "EGOW Desc",
  ];

  const rows = movements.map((m) => {
    return [
      m.id,
      m.status,
      m.callsignCode,
      m.callsignLabel,
      m.registration,
      m.type,
      m.wtc,
      m.depAd,
      m.depName,
      m.arrAd,
      m.arrName,
      m.depPlanned,
      m.depActual,
      m.arrPlanned,
      m.arrActual,
      m.flightType,
      m.isLocal ? "Yes" : "No",
      m.tngCount,
      m.osCount,
      m.fisCount,
      m.pob,
      m.remarks,
      m.egowCode,
      m.egowDesc,
    ].map(csvEscape).join(",");
  });

  const csvContent = [headers.map(csvEscape).join(","), ...rows].join("\n");

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const filename = `FDMS_History_${yyyy}${mm}${dd}_${hh}${min}.csv`;

  downloadCsv(filename, csvContent);
}

export function initHistoryExport() {
  const btn = document.getElementById("btnExportHistory");
  if (btn) {
    btn.addEventListener("click", exportHistoryCsv);
  }
}

/**
 * VKB Lookup – Render and Filter
 */
export function renderVkbLookup(filterText = "") {
  const tbody = document.getElementById("vkbResultsBody");
  if (!tbody) return;

  const query = (filterText || "").trim().toUpperCase();

  let entries = vkbDemoEntries;

  if (query) {
    entries = entries.filter((entry) => {
      const haystack =
        (entry.kind || "") +
        " " +
        (entry.category || "") +
        " " +
        (entry.code || "") +
        " " +
        (entry.label || "") +
        " " +
        (entry.details || "");
      return haystack.toUpperCase().includes(query);
    });
  }

  tbody.innerHTML = "";

  if (!entries.length) {
    const empty = document.createElement("tr");
    empty.innerHTML = `
      <td colspan="5" class="cell-muted">
        No VKB entries match "${query}".
      </td>
    `;
    tbody.appendChild(empty);
    return;
  }

  entries.forEach((entry) => {
    const tr = document.createElement("tr");
    tr.className = "strip-row";

    tr.innerHTML = `
      <td>
        <div class="cell-strong">${entry.kind}</div>
        <div class="cell-muted">${entry.category || ""}</div>
      </td>
      <td>
        <div class="cell-strong">${entry.code}</div>
      </td>
      <td>
        <div class="cell-strong">${entry.label}</div>
      </td>
      <td>
        <div class="cell-muted">${entry.details}</div>
      </td>
      <td>
        <button class="small-btn js-vkb-use">Use…</button>
      </td>
    `;

    const useBtn = tr.querySelector(".js-vkb-use");
    useBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openVkbUseChooser(entry);
    });

    tbody.appendChild(tr);
  });
}

export function initVkbLookup() {
  const searchInput = document.getElementById("vkbSearch");
  if (!searchInput) {
    // Still render the default list if the input isn't found.
    renderVkbLookup("");
    return;
  }

  // Initial render with no filter
  renderVkbLookup("");

  searchInput.addEventListener("input", () => {
    renderVkbLookup(searchInput.value);
  });
}

export function initAdminPanel() {
  const btn = document.getElementById("btnResetSession");
  if (!btn) return;

  btn.addEventListener("click", () => {
    const confirmed = window.confirm(
      "Reset FDMS demo data for this browser?\n\n" +
        "This will clear all current movements and restore the original demo set."
    );
    if (!confirmed) return;

    resetMovementsToDemo();
    renderLiveBoard();
    renderHistoryBoard();
    renderReportsSummary();
  });
}

/**
 * Creates and shows a modal.
 * `contentHtml` is the inner HTML inserted into #modalRoot.
 * `initFn` (optional) receives { backdrop, closeModal } for per-modal wiring.
 */
function openModal(contentHtml, initFn) {
  const root = document.getElementById("modalRoot");
  if (!root) return;

  root.innerHTML = `
    ${contentHtml}
  `;

  const backdrop = root.querySelector(".modal-backdrop");
  if (!backdrop) return;

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

  // Generic close buttons
  backdrop
    .querySelectorAll(".js-close-modal")
    .forEach((btn) => btn.addEventListener("click", closeModal));

  document.addEventListener("keydown", escHandler);

  if (typeof initFn === "function") {
    initFn({ backdrop, closeModal });
  }
}

/**
 * VKB "Use in Strip" Helpers
 */
function openVkbUseChooser(entry) {
  openModal(
    `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div>
            <div class="modal-title">Use VKB Entry</div>
            <div class="modal-subtitle">
              Select which field to pre-fill using ${entry.code}.
            </div>
          </div>
          <button type="button" class="small-btn js-close-modal">✕</button>
        </div>

        <div class="modal-body">
          <div class="modal-field">
            <button class="btn btn-primary js-use-new-flight">New Flight…</button>
          </div>
          <div class="modal-field">
            <button class="btn btn-secondary js-use-new-local">New Local…</button>
          </div>
          <div class="modal-field">
            <button class="btn btn-ghost js-use-existing">Apply to Existing…</button>
          </div>
        </div>
      </div>
    </div>
    `,
    ({ backdrop, closeModal }) => {
      // Use in New Flight
      backdrop.querySelector(".js-use-new-flight").addEventListener("click", () => {
        closeModal();
        prefillAndOpenNewFlight(entry);
      });

      // Use in New Local
      backdrop.querySelector(".js-use-new-local").addEventListener("click", () => {
        closeModal();
        prefillAndOpenNewLocal(entry);
      });

      // Apply to Existing
      const existingBtn = backdrop.querySelector(".js-use-existing");
      if (existingBtn) {
        existingBtn.addEventListener("click", () => {
          closeModal();
          openVkbApplyToExisting(entry);
        });
      }
    }
  );
}

function prefillAndOpenNewFlight(entry) {
  const prefill = {};

  if (entry.kind === "Callsign") {
    prefill.callsign = entry.label;    // SPEEDBIRD etc
  }
  if (entry.kind === "Location") {
    prefill.depAd = entry.code;        // or arrAd; for now default to DEP
  }
  if (entry.kind === "Aircraft type") {
    prefill.type = entry.code;
  }

  openNewFlightModal(prefill);
}

function prefillAndOpenNewLocal(entry) {
  const prefill = {};

  if (entry.kind === "Callsign") {
    prefill.callsign = entry.label;
  }
  if (entry.kind === "Aircraft type") {
    prefill.type = entry.code;
  }

  // For Local, ignore Location entries for now (always EGOW)
  openNewLocalModal(prefill);
}

function openVkbApplyToExisting(entry) {
  const movements = getMovements();
  if (!movements.length) {
    alert("There are no movements to apply this VKB entry to.");
    return;
  }

  const rowsHtml = movements
    .map(
      (m) => `
      <tr class="strip-row" data-id="${m.id}">
        <td>
          <div class="status-strip ${statusClass(m.status)}"></div>
        </td>
        <td>
          <div class="call-main">${m.callsignCode}</div>
          <div class="call-sub">${m.callsignLabel || "&nbsp;"}</div>
        </td>
        <td>
          <div class="cell-strong">${m.registration || "—"}</div>
          <div class="cell-muted">${m.depAd || ""} → ${m.arrAd || ""}</div>
        </td>
        <td>
          <div class="cell-muted">${statusLabel(m.status)}</div>
        </td>
        <td class="actions-cell">
          <button class="small-btn js-apply-to-this">Apply</button>
        </td>
      </tr>
    `
    )
    .join("");

  openModal(
    `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div>
            <div class="modal-title">Apply VKB Entry</div>
            <div class="modal-subtitle">
              Select the movement to update with ${entry.code}.
            </div>
          </div>
          <button type="button" class="small-btn js-close-modal">✕</button>
        </div>

        <div class="modal-body">
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th style="width:8px;"></th>
                  <th>Callsign</th>
                  <th>Reg / Route</th>
                  <th>Status</th>
                  <th style="width:80px;"></th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
    `,
    ({ backdrop, closeModal }) => {
      const rows = backdrop.querySelectorAll("tr.strip-row");
      rows.forEach((row) => {
        const id = parseInt(row.dataset.id, 10);
        const btn = row.querySelector(".js-apply-to-this");
        if (!btn || !Number.isFinite(id)) return;

        btn.addEventListener("click", () => {
          applyVkbEntryToMovement(entry, id);
          closeModal();
        });
      });
    }
  );
}

function applyVkbEntryToMovement(entry, id) {
  const patch = {};

  if (entry.kind === "Callsign") {
    patch.callsignLabel = entry.label || entry.code || "";
    patch.callsignCode = (entry.code || patch.callsignLabel || "").toUpperCase();
  }

  if (entry.kind === "Location") {
    const ad = normaliseAdCode(entry.code || "");
    patch.depAd = ad;
    patch.depName = inferAdName(ad);
    // In a later stage we might choose DEP vs ARR via a chooser.
  }

  if (entry.kind === "Aircraft type") {
    patch.type = entry.code || "";
    // WTC could be inferred later from VKB; for now leave unchanged.
  }

  if (Object.keys(patch).length === 0) {
    alert("This VKB entry type is not yet mapped to movement fields.");
    return;
  }

  updateMovement(id, patch);
  renderLiveBoard();
  renderHistoryBoard();
  renderReportsSummary();
}

function openNewFlightModal(prefill = {}) {
  openModal(
    `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div>
            <div class="modal-title">New Flight</div>
            <div class="modal-subtitle">
              Create a new movement. Demo only – stored in memory until reload.
            </div>
          </div>
          <button type="button" class="small-btn js-close-modal">✕</button>
        </div>

        <div class="modal-body">
          <div class="modal-field">
            <label for="nf-callsign" class="modal-label">Callsign</label>
            <input id="nf-callsign" class="modal-input" placeholder="e.g. SYS22" value="${prefill.callsign || ""}" />
          </div>

          <div class="modal-field">
            <label for="nf-registration" class="modal-label">Registration</label>
            <input id="nf-registration" class="modal-input" placeholder="e.g. ZM300" />
          </div>

          <div class="modal-field">
            <span class="modal-label">Flight Type</span>
            <div>
              <label><input type="radio" name="nf-flightType" value="ARR" /> ARR</label>
              <label><input type="radio" name="nf-flightType" value="DEP" checked /> DEP</label>
              <label><input type="radio" name="nf-flightType" value="LOC" /> LOC</label>
              <label><input type="radio" name="nf-flightType" value="OVR" /> OVR</label>
            </div>
          </div>

          <div class="modal-field">
            <span class="modal-label">Flight Rules</span>
            <div>
              <label><input type="radio" name="nf-rules" value="VFR" checked /> VFR</label>
              <label><input type="radio" name="nf-rules" value="IFR" /> IFR</label>
              <label><input type="radio" name="nf-rules" value="SVFR" /> SVFR</label>
            </div>
          </div>

          <div class="modal-field">
            <label for="nf-depAd" class="modal-label">Departure AD</label>
            <input id="nf-depAd" class="modal-input" placeholder="e.g. EGOW" value="${prefill.depAd || ""}" />
          </div>

          <div class="modal-field">
            <label for="nf-arrAd" class="modal-label">Arrival AD</label>
            <input id="nf-arrAd" class="modal-input" placeholder="e.g. EGOS" />
          </div>

          <div class="modal-field">
            <label for="nf-depPlanned" class="modal-label">Planned Off-Block</label>
            <input id="nf-depPlanned" class="modal-input" placeholder="HH:MM" />
          </div>

          <div class="modal-field">
            <label for="nf-arrPlanned" class="modal-label">Planned ETA</label>
            <input id="nf-arrPlanned" class="modal-input" placeholder="HH:MM" />
          </div>

          <div class="modal-field">
            <label for="nf-aircraftCount" class="modal-label">Number of aircraft</label>
            <input id="nf-aircraftCount" class="modal-input" type="number" min="1" value="1" />
          </div>

          <div class="modal-field">
            <label for="nf-pob" class="modal-label">POB</label>
            <input id="nf-pob" class="modal-input" type="number" min="0" value="1" />
          </div>

          <div class="modal-field">
            <label for="nf-tngCount" class="modal-label">Touch &amp; Go count</label>
            <input id="nf-tngCount" class="modal-input" type="number" min="0" value="0" />
          </div>

          <div class="modal-field">
            <span class="modal-label">Outstation?</span>
            <div>
              <label><input type="radio" name="nf-outstation" value="no" checked /> No</label>
              <label><input type="radio" name="nf-outstation" value="yes" /> Yes</label>
            </div>
          </div>

          <div class="modal-field" style="grid-column: 1 / -1;">
            <label for="nf-remarks" class="modal-label">Remarks</label>
            <textarea id="nf-remarks" class="modal-textarea" placeholder="Free text remarks"></textarea>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-ghost js-close-modal">Cancel</button>
          <div style="display:flex; gap:6px;">
            <button type="button" class="btn btn-secondary-modal js-save-flight-duplicate">
              Save &amp; Duplicate
            </button>
            <button type="button" class="btn btn-primary js-save-flight">
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
    `,
    ({ backdrop, closeModal }) => {
      const callsignInput = backdrop.querySelector("#nf-callsign");
      const registrationInput = backdrop.querySelector("#nf-registration");
      const depAdInput = backdrop.querySelector("#nf-depAd");
      const arrAdInput = backdrop.querySelector("#nf-arrAd");
      const depPlannedInput = backdrop.querySelector("#nf-depPlanned");
      const arrPlannedInput = backdrop.querySelector("#nf-arrPlanned");
      const aircraftCountInput = backdrop.querySelector("#nf-aircraftCount");
      const pobInput = backdrop.querySelector("#nf-pob");
      const tngInput = backdrop.querySelector("#nf-tngCount");
      const remarksInput = backdrop.querySelector("#nf-remarks");

      const saveBtn = backdrop.querySelector(".js-save-flight");
      const saveDupBtn = backdrop.querySelector(".js-save-flight-duplicate");

      function buildMovementFromForm() {
        const callsignRaw = (callsignInput?.value || "").trim();
        if (!callsignRaw) {
          alert("Please enter a callsign.");
          callsignInput?.focus();
          return null;
        }

        const depAd = normaliseAdCode(depAdInput?.value || "");
        const arrAd = normaliseAdCode(arrAdInput?.value || "");

        const flightType =
          backdrop.querySelector("input[name='nf-flightType']:checked")?.value ||
          "DEP";

        const rules =
          backdrop.querySelector("input[name='nf-rules']:checked")?.value ||
          "VFR";

        const outstationValue =
          backdrop.querySelector("input[name='nf-outstation']:checked")?.value ||
          "no";

        const isOutstation = outstationValue === "yes";

        const depPlanned = (depPlannedInput?.value || "").trim();
        const arrPlanned = (arrPlannedInput?.value || "").trim();

        const registration = (registrationInput?.value || "").trim().toUpperCase();
        const aircraftCount = parseNonNegativeInt(aircraftCountInput?.value || "1");
        const pob = parseNonNegativeInt(pobInput?.value || "0");
        const tngCount = parseNonNegativeInt(tngInput?.value || "0");
        const remarks = (remarksInput?.value || "").trim();

        const depCode = depAd || "EGOW";
        const arrCode = arrAd || "EGOW";

        return {
          status: "PLANNED",
          callsignCode: callsignRaw.toUpperCase(),
          callsignLabel: callsignRaw,
          callsignVoice: "",
          registration,
          type: "",
          wtc: "",
          depAd: depCode,
          depName: inferAdName(depCode),
          arrAd: arrCode,
          arrName: inferAdName(arrCode),
          depPlanned,
          depActual: "",
          arrPlanned,
          arrActual: "",
          flightType,
          isLocal: depCode === "EGOW" && arrCode === "EGOW",
          tngCount,
          osCount: isOutstation ? 1 : 0,
          fisCount: 0,
          egowCode: "",
          egowDesc: "",
          unitCode: "",
          unitDesc: "",
          captain: "",
          pob,
          remarks,
          rules,
          aircraftCount,
          formation: null,
        };
      }

      function save(closeAfter) {
        const movement = buildMovementFromForm();
        if (!movement) return;
        createMovement(movement);
        renderLiveBoard();
        renderHistoryBoard();
        renderReportsSummary();
        if (closeAfter) {
          closeModal();
        }
      }

      if (saveBtn) {
        saveBtn.addEventListener("click", () => save(true));
      }
      if (saveDupBtn) {
        saveDupBtn.addEventListener("click", () => save(false));
      }

      callsignInput?.focus();
    }
  );
}

function openNewLocalModal(prefill = {}) {
  openModal(
    `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div>
            <div class="modal-title">New Local Flight</div>
            <div class="modal-subtitle">
              Pre-configured for EGOW → EGOW local circuits (LOC, VFR). In-memory only.
            </div>
          </div>
          <button type="button" class="small-btn js-close-modal">✕</button>
        </div>

        <div class="modal-body">
          <div class="modal-field">
            <label for="nl-callsign" class="modal-label">Callsign</label>
            <input id="nl-callsign" class="modal-input" placeholder="e.g. UAM11" value="${prefill.callsign || ""}" />
          </div>

          <div class="modal-field">
            <label for="nl-registration" class="modal-label">Registration</label>
            <input id="nl-registration" class="modal-input" placeholder="e.g. G-VAIR" />
          </div>

          <div class="modal-field">
            <span class="modal-label">Flight Type</span>
            <div class="cell-muted">LOC (fixed)</div>
          </div>

          <div class="modal-field">
            <span class="modal-label">Departure / Arrival AD</span>
            <div class="cell-muted">EGOW → EGOW (fixed)</div>
          </div>

          <div class="modal-field">
            <label for="nl-start" class="modal-label">Planned start</label>
            <input id="nl-start" class="modal-input" placeholder="HH:MM" />
          </div>

          <div class="modal-field">
            <label for="nl-end" class="modal-label">Planned end</label>
            <input id="nl-end" class="modal-input" placeholder="HH:MM" />
          </div>

          <div class="modal-field">
            <label for="nl-aircraftCount" class="modal-label">Number of aircraft</label>
            <input id="nl-aircraftCount" class="modal-input" type="number" min="1" value="1" />
          </div>

          <div class="modal-field">
            <label for="nl-tngCount" class="modal-label">Touch &amp; Go count</label>
            <input id="nl-tngCount" class="modal-input" type="number" min="0" value="0" />
          </div>

          <div class="modal-field">
            <label for="nl-pob" class="modal-label">POB</label>
            <input id="nl-pob" class="modal-input" type="number" min="0" value="1" />
          </div>

          <div class="modal-field" style="grid-column: 1 / -1;">
            <label for="nl-remarks" class="modal-label">Remarks</label>
            <textarea id="nl-remarks" class="modal-textarea" placeholder="Free text remarks"></textarea>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-ghost js-close-modal">Cancel</button>
          <button type="button" class="btn btn-primary js-save-local">Save</button>
        </div>
      </div>
    </div>
    `,
    ({ backdrop, closeModal }) => {
      const callsignInput = backdrop.querySelector("#nl-callsign");
      const registrationInput = backdrop.querySelector("#nl-registration");
      const startInput = backdrop.querySelector("#nl-start");
      const endInput = backdrop.querySelector("#nl-end");
      const aircraftCountInput = backdrop.querySelector("#nl-aircraftCount");
      const tngInput = backdrop.querySelector("#nl-tngCount");
      const pobInput = backdrop.querySelector("#nl-pob");
      const remarksInput = backdrop.querySelector("#nl-remarks");

      const saveBtn = backdrop.querySelector(".js-save-local");

      function buildMovementFromForm() {
        const callsignRaw = (callsignInput?.value || "").trim();
        if (!callsignRaw) {
          alert("Please enter a callsign.");
          callsignInput?.focus();
          return null;
        }

        const registration = (registrationInput?.value || "").trim().toUpperCase();
        const depPlanned = (startInput?.value || "").trim();
        const arrPlanned = (endInput?.value || "").trim();
        const aircraftCount = parseNonNegativeInt(aircraftCountInput?.value || "1");
        const tngCount = parseNonNegativeInt(tngInput?.value || "0");
        const pob = parseNonNegativeInt(pobInput?.value || "0");
        const remarks = (remarksInput?.value || "").trim();

        const depCode = "EGOW";
        const arrCode = "EGOW";

        return {
          status: "PLANNED",
          callsignCode: callsignRaw.toUpperCase(),
          callsignLabel: callsignRaw,
          callsignVoice: "",
          registration,
          type: "",
          wtc: "",
          depAd: depCode,
          depName: inferAdName(depCode),
          arrAd: arrCode,
          arrName: inferAdName(arrCode),
          depPlanned,
          depActual: "",
          arrPlanned,
          arrActual: "",
          flightType: "LOC",
          isLocal: true,
          tngCount,
          osCount: 0,
          fisCount: 0,
          egowCode: "",
          egowDesc: "",
          unitCode: "",
          unitDesc: "",
          captain: "",
          pob,
          remarks,
          rules: "VFR",
          aircraftCount,
          formation: null,
        };
      }

      function save() {
        const movement = buildMovementFromForm();
        if (!movement) return;
        createMovement(movement);
        renderLiveBoard();
        renderHistoryBoard();
        renderReportsSummary();
        closeModal();
      }

      if (saveBtn) {
        saveBtn.addEventListener("click", save);
      }

      callsignInput?.focus();
    }
  );
}

function openEditMovementModal(m) {
  openModal(
    `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <div>
            <div class="modal-title">Edit Movement</div>
            <div class="modal-subtitle">
              Update administrative fields for this movement.
            </div>
          </div>
          <button type="button" class="small-btn js-close-modal">✕</button>
        </div>

        <div class="modal-body">

          <div class="modal-field">
            <label class="modal-label">Callsign</label>
            <input id="em-callsign" class="modal-input" value="${m.callsignLabel}" />
          </div>

          <div class="modal-field">
            <label class="modal-label">Registration</label>
            <input id="em-registration" class="modal-input" value="${m.registration || ""}" />
          </div>

          <div class="modal-field">
            <label class="modal-label">Departure AD</label>
            <input id="em-depAd" class="modal-input" value="${m.depAd}" />
          </div>

          <div class="modal-field">
            <label class="modal-label">Arrival AD</label>
            <input id="em-arrAd" class="modal-input" value="${m.arrAd}" />
          </div>

          <div class="modal-field">
            <label class="modal-label">Planned Off-Block</label>
            <input id="em-depPlanned" class="modal-input" value="${m.depPlanned || ""}" />
          </div>

          <div class="modal-field">
            <label class="modal-label">Planned ETA</label>
            <input id="em-arrPlanned" class="modal-input" value="${m.arrPlanned || ""}" />
          </div>

          <div class="modal-field">
            <label class="modal-label">POB</label>
            <input id="em-pob" class="modal-input" type="number" min="0" value="${m.pob || 0}" />
          </div>

          <div class="modal-field">
            <label class="modal-label">Touch &amp; Go Count</label>
            <input id="em-tngCount" class="modal-input" type="number" min="0" value="${m.tngCount || 0}" />
          </div>

          <div class="modal-field">
            <label class="modal-label">Outstation Count</label>
            <input id="em-osCount" class="modal-input" type="number" min="0" value="${m.osCount || 0}" />
          </div>

          <div class="modal-field">
            <label class="modal-label">FIS Count</label>
            <input id="em-fisCount" class="modal-input" type="number" min="0" value="${m.fisCount || 0}" />
          </div>

          <div class="modal-field" style="grid-column: 1 / -1;">
            <label class="modal-label">Remarks</label>
            <textarea id="em-remarks" class="modal-textarea">${m.remarks || ""}</textarea>
          </div>

        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-ghost js-close-modal">Cancel</button>
          <button type="button" class="btn btn-primary js-save-edit">Save</button>
        </div>
      </div>
    </div>
    `,
    ({ backdrop, closeModal }) => {
      const saveBtn = backdrop.querySelector(".js-save-edit");

      saveBtn.addEventListener("click", () => {
        const patch = {
          callsignLabel: backdrop.querySelector("#em-callsign").value.trim(),
          callsignCode: backdrop.querySelector("#em-callsign").value.trim().toUpperCase(),
          registration: backdrop.querySelector("#em-registration").value.trim(),
          depAd: normaliseAdCode(backdrop.querySelector("#em-depAd").value),
          arrAd: normaliseAdCode(backdrop.querySelector("#em-arrAd").value),
          depPlanned: backdrop.querySelector("#em-depPlanned").value.trim(),
          arrPlanned: backdrop.querySelector("#em-arrPlanned").value.trim(),
          pob: parseNonNegativeInt(backdrop.querySelector("#em-pob").value),
          tngCount: parseNonNegativeInt(backdrop.querySelector("#em-tngCount").value),
          osCount: parseNonNegativeInt(backdrop.querySelector("#em-osCount").value),
          fisCount: parseNonNegativeInt(backdrop.querySelector("#em-fisCount").value),
          remarks: backdrop.querySelector("#em-remarks").value.trim(),
        };

        // Keep names aligned with depAd/arrAd
        patch.depName = inferAdName(patch.depAd);
        patch.arrName = inferAdName(patch.arrAd);

        updateMovement(m.id, patch);
        renderLiveBoard();
        renderHistoryBoard();
        renderReportsSummary();
        closeModal();
      });
    }
  );
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

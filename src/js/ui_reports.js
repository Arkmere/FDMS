// ui_reports.js
// UI rendering for Reports tab: Official Monthly Return, Dashboard, Insights

import { getMovements } from './datamodel.js';
import {
  loadHours,
  saveHours,
  getHoursForDate,
  computeMonthlyReturn,
  computeKPIs,
  computeLeaderboards,
  exportMovementsToCSV,
  exportMonthlyReturnToXLSX,
  computeCancellationReport,
  exportCancellationsToCSV,
  CANCELLATION_REASON_ORDER,
  CANCELLATION_REASON_LABELS,
  FLIGHT_TYPE_ORDER,
  FLIGHT_TYPE_LABELS,
} from './reporting.js';

// Current view state
let currentView = 'official';
let currentYear = new Date().getUTCFullYear();
let currentMonth = new Date().getUTCMonth() + 1; // 1-12

// Cancellation report date range state.
// Default: last 30 days (inclusive).
// Date field used: cancelledAt from log entry (primary), dof from movement (fallback).
let cancelStartDate = _defaultCancelStart();
let cancelEndDate   = _defaultCancelEnd();

function _defaultCancelEnd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _defaultCancelStart() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ========================================
// INITIALIZATION
// ========================================

/**
 * Initialize Reports tab
 */
export function initReports() {
  populateMonthSelector();
  wireReportsControls();
  renderReports();
}

/**
 * Populate month selector with current and past 12 months
 */
function populateMonthSelector() {
  const selector = document.getElementById('reportsMonthSelector');
  if (!selector) return;

  const now = new Date();
  const months = [];

  // Generate past 12 months including current
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: d.toLocaleDateString('en-GB', { year: 'numeric', month: 'long' })
    });
  }

  selector.innerHTML = months.map(m =>
    `<option value="${m.year}-${m.month}" ${m.year === currentYear && m.month === currentMonth ? 'selected' : ''}>
      ${m.label}
    </option>`
  ).join('');
}

/**
 * Wire up all Reports controls
 */
function wireReportsControls() {
  // Month selector
  const monthSelector = document.getElementById('reportsMonthSelector');
  if (monthSelector) {
    monthSelector.addEventListener('change', (e) => {
      const [year, month] = e.target.value.split('-');
      currentYear = parseInt(year, 10);
      currentMonth = parseInt(month, 10);
      renderReports();
    });
  }

  // View selector
  const viewSelector = document.getElementById('reportsViewSelector');
  if (viewSelector) {
    viewSelector.addEventListener('change', (e) => {
      currentView = e.target.value;
      renderReports();
    });
  }

  // Export buttons
  const btnExportCSV = document.getElementById('btnExportCSV');
  if (btnExportCSV) {
    btnExportCSV.addEventListener('click', handleExportCSV);
  }

  const btnExportXLSX = document.getElementById('btnExportXLSX');
  if (btnExportXLSX) {
    btnExportXLSX.addEventListener('click', handleExportXLSX);
  }

  // Hours input controls
  const btnSaveHours = document.getElementById('btnSaveHours');
  if (btnSaveHours) {
    btnSaveHours.addEventListener('click', handleSaveHours);
  }

  const btnClearHours = document.getElementById('btnClearHours');
  if (btnClearHours) {
    btnClearHours.addEventListener('click', handleClearHours);
  }

  // Set hours input date to today
  const hoursInputDate = document.getElementById('hoursInputDate');
  if (hoursInputDate) {
    hoursInputDate.value = getTodayDateString();
    hoursInputDate.addEventListener('change', loadHoursForSelectedDate);
  }

  // Load hours for today initially
  loadHoursForSelectedDate();

  // --- Cancellation report controls ---

  // Populate date inputs with defaults
  const cancelStartInput = document.getElementById('cancelReportStart');
  const cancelEndInput   = document.getElementById('cancelReportEnd');

  if (cancelStartInput) {
    cancelStartInput.value = cancelStartDate;
    cancelStartInput.addEventListener('change', e => {
      cancelStartDate = e.target.value;
      if (currentView === 'cancellation') renderReports();
    });
  }

  if (cancelEndInput) {
    cancelEndInput.value = cancelEndDate;
    cancelEndInput.addEventListener('change', e => {
      cancelEndDate = e.target.value;
      if (currentView === 'cancellation') renderReports();
    });
  }

  // Export cancellations CSV button
  const btnExportCancellationsCSV = document.getElementById('btnExportCancellationsCSV');
  if (btnExportCancellationsCSV) {
    btnExportCancellationsCSV.addEventListener('click', handleExportCancellationsCSV);
  }
}

/**
 * Get today's date in YYYY-MM-DD format
 */
function getTodayDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Load hours for the currently selected date in the hours input
 */
function loadHoursForSelectedDate() {
  const hoursInputDate = document.getElementById('hoursInputDate');
  const hoursInputValue = document.getElementById('hoursInputValue');

  if (!hoursInputDate || !hoursInputValue) return;

  const date = hoursInputDate.value;
  const hours = getHoursForDate(date);

  if (hours !== null) {
    hoursInputValue.value = hours;
  } else {
    hoursInputValue.value = '';
  }
}

/**
 * Handle save hours button
 */
function handleSaveHours() {
  const hoursInputDate = document.getElementById('hoursInputDate');
  const hoursInputValue = document.getElementById('hoursInputValue');

  if (!hoursInputDate || !hoursInputValue) return;

  const date = hoursInputDate.value;
  const value = hoursInputValue.value.trim();

  if (!date) {
    alert('Please select a date.');
    return;
  }

  if (value === '') {
    saveHours(date, null); // Clear hours
  } else {
    const hours = parseFloat(value);
    if (isNaN(hours) || hours < 0 || hours > 24) {
      alert('Please enter a valid hours value between 0 and 24.');
      return;
    }
    saveHours(date, hours);
  }

  // Re-render if viewing Official return
  if (currentView === 'official') {
    renderReports();
  }

  alert(`Hours ${value === '' ? 'cleared' : 'saved'} for ${date}`);
}

/**
 * Handle clear hours button
 */
function handleClearHours() {
  const hoursInputDate = document.getElementById('hoursInputDate');
  const hoursInputValue = document.getElementById('hoursInputValue');

  if (!hoursInputDate || !hoursInputValue) return;

  const date = hoursInputDate.value;
  if (!date) {
    alert('Please select a date.');
    return;
  }

  if (confirm(`Clear hours for ${date}?`)) {
    saveHours(date, null);
    hoursInputValue.value = '';

    if (currentView === 'official') {
      renderReports();
    }

    alert(`Hours cleared for ${date}`);
  }
}

/**
 * Handle CSV export
 */
function handleExportCSV() {
  const movements = getMovementsForCurrentPeriod();
  const filename = `movements_${currentYear}-${String(currentMonth).padStart(2, '0')}.csv`;
  exportMovementsToCSV(movements, filename);
}

/**
 * Handle XLSX export
 */
function handleExportXLSX() {
  const movements = getMovementsForCurrentPeriod();
  const hoursMap = loadHours();
  const monthlyReturn = computeMonthlyReturn(movements, currentYear, currentMonth, hoursMap);
  const filename = `monthly_return_${currentYear}-${String(currentMonth).padStart(2, '0')}.xlsx`;

  exportMonthlyReturnToXLSX(monthlyReturn, movements, filename);
}

/**
 * Handle Cancellations CSV export
 */
function handleExportCancellationsCSV() {
  const report = computeCancellationReport(cancelStartDate, cancelEndDate);
  const start  = cancelStartDate || 'all';
  const end    = cancelEndDate   || 'all';
  const filename = `cancellations_${start}_to_${end}.csv`;
  exportCancellationsToCSV(report.rows, filename);
}

/**
 * Get movements for the current selected period
 */
function getMovementsForCurrentPeriod() {
  const allMovements = getMovements();
  const monthStr = String(currentMonth).padStart(2, '0');
  const prefix = `${currentYear}-${monthStr}`;

  return allMovements.filter(m => (m.dof || '').startsWith(prefix));
}

// ========================================
// MAIN RENDER FUNCTION
// ========================================

/**
 * Render the appropriate Reports view
 */
export function renderReports() {
  const container = document.getElementById('reportsContent');
  if (!container) return;

  // Show/hide panels and export buttons based on view
  const hoursPanel    = document.getElementById('hoursInputPanel');
  const cancelPanel   = document.getElementById('cancellationDatePanel');
  const btnCSV        = document.getElementById('btnExportCSV');
  const btnXLSX       = document.getElementById('btnExportXLSX');
  const btnCancelCSV  = document.getElementById('btnExportCancellationsCSV');

  const isCancelView = (currentView === 'cancellation');

  if (hoursPanel)   hoursPanel.style.display   = (currentView === 'official') ? 'block' : 'none';
  if (cancelPanel)  cancelPanel.style.display   = isCancelView ? 'block' : 'none';
  if (btnCSV)       btnCSV.style.display        = isCancelView ? 'none' : '';
  if (btnXLSX)      btnXLSX.style.display       = isCancelView ? 'none' : '';
  if (btnCancelCSV) btnCancelCSV.style.display  = isCancelView ? '' : 'none';

  // Render based on current view
  switch (currentView) {
    case 'official':
      renderOfficialMonthlyReturn(container);
      break;
    case 'dashboard':
      renderDashboard(container);
      break;
    case 'insights':
      renderInsights(container);
      break;
    case 'cancellation':
      renderCancellationReport(container);
      break;
    default:
      container.innerHTML = '<p>Invalid view selected.</p>';
  }
}

// ========================================
// OFFICIAL MONTHLY RETURN RENDERING
// ========================================

/**
 * Render Official Monthly Return grid
 */
function renderOfficialMonthlyReturn(container) {
  const movements = getMovementsForCurrentPeriod();
  const hoursMap = loadHours();
  const monthlyReturn = computeMonthlyReturn(getMovements(), currentYear, currentMonth, hoursMap);

  const { rows, totals } = monthlyReturn;

  let html = `
    <div class="monthly-return-header">
      <h3>Official Monthly Return - ${getMonthName(currentMonth)} ${currentYear}</h3>
      <p class="monthly-return-subtitle">${monthlyReturn.metadata.movementCount} movements in scope</p>
    </div>

    <div class="table-container" style="overflow-x: auto;">
      <table class="monthly-return-table">
        <thead>
          <tr>
            <th rowspan="2">Day</th>
            <th colspan="3" class="group-header">Based Military</th>
            <th colspan="3" class="group-header">O/S Based Military</th>
            <th colspan="2" class="group-header">Visiting Military</th>
            <th colspan="3" class="group-header">Civil Fixed-Wing</th>
            <th colspan="3" class="group-header">Helicopters</th>
            <th colspan="2" class="group-header">FIS</th>
            <th rowspan="2">Hours</th>
          </tr>
          <tr>
            <th>MASUAS</th>
            <th>LUAS</th>
            <th>AEF</th>
            <th>O/S M</th>
            <th>O/S L</th>
            <th>O/S A</th>
            <th>VIS MIL</th>
            <th>TOT MIL</th>
            <th>VIS CIV F/W</th>
            <th>O/W F/W</th>
            <th>TOT CIV F/W</th>
            <th>NVY HEL</th>
            <th>CIV HEL</th>
            <th>MIL HEL</th>
            <th>MIL FIS</th>
            <th>CIV FIS</th>
          </tr>
        </thead>
        <tbody>
  `;

  // Get today's day for highlighting (in UTC)
  const now = new Date();
  const todayDay = now.getUTCDate();
  const todayMonth = now.getUTCMonth() + 1; // 1-12
  const todayYear = now.getUTCFullYear();
  const isCurrentMonth = (currentMonth === todayMonth && currentYear === todayYear);

  // Daily rows
  for (const row of rows) {
    const isToday = isCurrentMonth && row.day === todayDay;
    const rowClass = isToday ? 'current-day-row' : '';
    html += `
      <tr class="${rowClass}">
        <td class="day-cell">${row.day}</td>
        <td class="num-cell">${row.MASUAS || 0}</td>
        <td class="num-cell">${row.LUAS || 0}</td>
        <td class="num-cell">${row.AEF || 0}</td>
        <td class="num-cell">${row.OS_MASUAS || 0}</td>
        <td class="num-cell">${row.OS_LUAS || 0}</td>
        <td class="num-cell">${row.OS_AEF || 0}</td>
        <td class="num-cell">${row.VIS_MIL || 0}</td>
        <td class="num-cell">${row.TOTAL_MIL || 0}</td>
        <td class="num-cell">${row.VIS_CIV_FW || 0}</td>
        <td class="num-cell">${row.OW_FW || 0}</td>
        <td class="num-cell">${row.TOTAL_CIV_FW || 0}</td>
        <td class="num-cell">${row.NVY_HEL || 0}</td>
        <td class="num-cell">${row.CIV_HEL || 0}</td>
        <td class="num-cell">${row.MIL_HEL || 0}</td>
        <td class="num-cell">${row.MIL_FIS || 0}</td>
        <td class="num-cell">${row.CIV_FIS || 0}</td>
        <td class="hours-cell">${row.HOURS !== null ? row.HOURS.toFixed(1) : ''}</td>
      </tr>
    `;
  }

  // TOTAL row
  html += `
      <tr class="total-row">
        <td class="day-cell"><strong>TOTAL</strong></td>
        <td class="num-cell"><strong>${totals.MASUAS}</strong></td>
        <td class="num-cell"><strong>${totals.LUAS}</strong></td>
        <td class="num-cell"><strong>${totals.AEF}</strong></td>
        <td class="num-cell"><strong>${totals.OS_MASUAS}</strong></td>
        <td class="num-cell"><strong>${totals.OS_LUAS}</strong></td>
        <td class="num-cell"><strong>${totals.OS_AEF}</strong></td>
        <td class="num-cell"><strong>${totals.VIS_MIL}</strong></td>
        <td class="num-cell"><strong>${totals.TOTAL_MIL}</strong></td>
        <td class="num-cell"><strong>${totals.VIS_CIV_FW}</strong></td>
        <td class="num-cell"><strong>${totals.OW_FW}</strong></td>
        <td class="num-cell"><strong>${totals.TOTAL_CIV_FW}</strong></td>
        <td class="num-cell"><strong>${totals.NVY_HEL}</strong></td>
        <td class="num-cell"><strong>${totals.CIV_HEL}</strong></td>
        <td class="num-cell"><strong>${totals.MIL_HEL}</strong></td>
        <td class="num-cell"><strong>${totals.MIL_FIS}</strong></td>
        <td class="num-cell"><strong>${totals.CIV_FIS}</strong></td>
        <td class="hours-cell"><strong>${totals.HOURS.toFixed(1)}</strong></td>
      </tr>
        </tbody>
      </table>
    </div>
  `;

  container.innerHTML = html;
}

// ========================================
// DASHBOARD KPIs RENDERING
// ========================================

/**
 * Render Dashboard KPIs
 */
function renderDashboard(container) {
  const movements = getMovementsForCurrentPeriod();
  const hoursMap = loadHours();
  const kpis = computeKPIs(movements, hoursMap);

  let html = `
    <div class="dashboard-header">
      <h3>Dashboard - ${getMonthName(currentMonth)} ${currentYear}</h3>
      <p class="dashboard-subtitle">${movements.length} movements | ${kpis.totalHours.toFixed(1)} hours</p>
    </div>

    <div class="kpi-grid">
      <!-- Total Movements -->
      <div class="kpi-card">
        <div class="kpi-title">Total Movements</div>
        <div class="kpi-value">${kpis.totalMovements}</div>
        <div class="kpi-subtitle">All flight movements</div>
      </div>

      <!-- Military Movements -->
      <div class="kpi-card">
        <div class="kpi-title">Military</div>
        <div class="kpi-value">${kpis.militaryMovements}</div>
        <div class="kpi-subtitle">${kpis.pctMilitary}% of total</div>
      </div>

      <!-- Civil Movements -->
      <div class="kpi-card">
        <div class="kpi-title">Civil</div>
        <div class="kpi-value">${kpis.civilMovements}</div>
        <div class="kpi-subtitle">${kpis.pctCivil}% of total</div>
      </div>

      <!-- Rotary -->
      <div class="kpi-card">
        <div class="kpi-title">Rotary</div>
        <div class="kpi-value">${kpis.rotaryMovements}</div>
        <div class="kpi-subtitle">${kpis.pctRotary}% helicopters</div>
      </div>

      <!-- Fixed-Wing -->
      <div class="kpi-card">
        <div class="kpi-title">Fixed-Wing</div>
        <div class="kpi-value">${kpis.fixedWingMovements}</div>
        <div class="kpi-subtitle">${kpis.pctFixedWing}% fixed-wing</div>
      </div>

      <!-- Overshoots -->
      <div class="kpi-card">
        <div class="kpi-title">Overshoots</div>
        <div class="kpi-value">${kpis.totalOvershoots}</div>
        <div class="kpi-subtitle">Total O/S events</div>
      </div>

      <!-- FIS Events -->
      <div class="kpi-card">
        <div class="kpi-title">FIS Events</div>
        <div class="kpi-value">${kpis.totalFIS}</div>
        <div class="kpi-subtitle">Total FIS interventions</div>
      </div>

      <!-- Touch & Goes -->
      <div class="kpi-card">
        <div class="kpi-title">Touch & Goes</div>
        <div class="kpi-value">${kpis.totalTnG}</div>
        <div class="kpi-subtitle">Total T&G events</div>
      </div>
    </div>

    <h4 class="rates-header">Rates (per hour)</h4>
    <div class="kpi-grid">
      <!-- Movements per Hour -->
      <div class="kpi-card">
        <div class="kpi-title">Movements/Hour</div>
        <div class="kpi-value">${kpis.movementsPerHour !== null ? kpis.movementsPerHour : '—'}</div>
        <div class="kpi-subtitle">${kpis.totalHours.toFixed(1)} hrs logged</div>
      </div>

      <!-- FIS per Hour -->
      <div class="kpi-card">
        <div class="kpi-title">FIS/Hour</div>
        <div class="kpi-value">${kpis.fisPerHour !== null ? kpis.fisPerHour : '—'}</div>
        <div class="kpi-subtitle">FIS rate</div>
      </div>

      <!-- O/S per Hour -->
      <div class="kpi-card">
        <div class="kpi-title">O/S/Hour</div>
        <div class="kpi-value">${kpis.osPerHour !== null ? kpis.osPerHour : '—'}</div>
        <div class="kpi-subtitle">Overshoot rate</div>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

// ========================================
// INSIGHTS LEADERBOARDS RENDERING
// ========================================

/**
 * Render Insights leaderboards
 */
function renderInsights(container) {
  const movements = getMovementsForCurrentPeriod();
  const hoursMap = loadHours();
  const leaderboards = computeLeaderboards(movements, hoursMap);

  let html = `
    <div class="insights-header">
      <h3>Insights & Leaderboards - ${getMonthName(currentMonth)} ${currentYear}</h3>
      <p class="insights-subtitle">Top performers and statistics</p>
    </div>

    <div class="completeness-notice">
      <strong>Data Completeness:</strong>
      Captain: ${leaderboards.completeness.captainPct}% |
      Callsign: ${leaderboards.completeness.callsignPct}% |
      Registration: ${leaderboards.completeness.registrationPct}%
    </div>

    <h4>Top Captains</h4>
    ${renderLeaderboardTable(leaderboards.byCaptain.slice(0, 25))}

    <h4>Top Callsigns</h4>
    ${renderLeaderboardTable(leaderboards.byCallsign.slice(0, 25))}

    <h4>Top Registrations (Airframes)</h4>
    ${renderLeaderboardTable(leaderboards.byRegistration.slice(0, 25))}
  `;

  container.innerHTML = html;
}

/**
 * Render a leaderboard table
 */
function renderLeaderboardTable(items) {
  if (!items || items.length === 0) {
    return '<p style="color: #999;">No data available.</p>';
  }

  let html = `
    <div class="table-container">
      <table class="leaderboard-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Name</th>
            <th>Sorties</th>
            <th>O/S Events</th>
            <th>O/S Flights</th>
            <th>FIS Events</th>
            <th>FIS Flights</th>
            <th>T&G Events</th>
            <th>T&G Flights</th>
          </tr>
        </thead>
        <tbody>
  `;

  items.forEach((item, index) => {
    html += `
      <tr>
        <td>${index + 1}</td>
        <td><strong>${escapeHtml(item.name)}</strong></td>
        <td>${item.sorties}</td>
        <td>${item.overshoots}</td>
        <td>${item.overshootFlights}</td>
        <td>${item.fis}</td>
        <td>${item.fisFlights}</td>
        <td>${item.tng}</td>
        <td>${item.tngFlights}</td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
    </div>
  `;

  return html;
}

// ========================================
// CANCELLATION REPORT RENDERING (Ticket 6b)
// ========================================

/**
 * Render the Cancellation / Lifecycle Report.
 *
 * Data source: current-state CANCELLED movements (see computeCancellationReport).
 * Reinstated and soft-deleted rows are excluded automatically.
 * Date filtering uses cancelledAt from the log entry (primary) or dof (fallback).
 */
function renderCancellationReport(container) {
  const report = computeCancellationReport(cancelStartDate, cancelEndDate);
  const { rows, total, noReason, byReason, byFlightType, ranked } = report;

  // --- Format date range label ---
  function fmtDate(d) { return d || '—'; }
  const rangeLabel = (cancelStartDate || cancelEndDate)
    ? `${fmtDate(cancelStartDate)} to ${fmtDate(cancelEndDate)}`
    : 'All dates';

  // --- Derive KPI summary values ---
  const noReasonPct = total > 0 ? Math.round((noReason / total) * 100) : 0;

  // Top reason (exclude blank)
  let topReason = null;
  let topReasonCount = 0;
  for (const code of CANCELLATION_REASON_ORDER.filter(c => c !== '')) {
    if ((byReason[code] || 0) > topReasonCount) {
      topReasonCount = byReason[code];
      topReason = code;
    }
  }
  const topReasonLabel = topReason
    ? `${topReason} — ${topReasonCount}`
    : (total > 0 ? 'None recorded' : '—');

  // Top flight type
  let topFT = null;
  let topFTCount = 0;
  for (const ft of FLIGHT_TYPE_ORDER) {
    if ((byFlightType[ft] || 0) > topFTCount) {
      topFTCount = byFlightType[ft];
      topFT = ft;
    }
  }
  const topFTLabel = topFT ? `${topFT} — ${topFTCount}` : '—';

  // --- Build HTML ---
  let html = `
    <div class="cancel-report-header">
      <h3>Cancellation Report</h3>
      <p class="cancel-report-subtitle">
        Current-state cancelled movements &middot; ${rangeLabel}
        &middot; <span class="cancel-datasource-note">Date field: cancelledAt (log entry) &rarr; fallback: date of flight</span>
      </p>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-title">Total Cancellations</div>
        <div class="kpi-value">${total}</div>
        <div class="kpi-subtitle">Current-state cancelled in range</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">No Reason Assigned</div>
        <div class="kpi-value">${noReason}</div>
        <div class="kpi-subtitle">${noReasonPct}% of cancellations undocumented</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Most Common Reason</div>
        <div class="kpi-value" style="font-size:20px;">${topReasonLabel}</div>
        <div class="kpi-subtitle">Leading cancellation cause</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Most Cancelled Type</div>
        <div class="kpi-value" style="font-size:20px;">${topFTLabel}</div>
        <div class="kpi-subtitle">Movement type most affected</div>
      </div>
    </div>
  `;

  // --- Reason code breakdown ---
  html += `
    <h4 class="cancel-section-title">Breakdown by Cancellation Reason</h4>
    <div class="table-container">
      <table class="cancel-breakdown-table">
        <thead>
          <tr>
            <th>Reason Code</th>
            <th>Description</th>
            <th>Count</th>
            <th>% of Total</th>
          </tr>
        </thead>
        <tbody>
  `;
  for (const code of CANCELLATION_REASON_ORDER) {
    const count = byReason[code] || 0;
    const pct   = total > 0 ? (count / total * 100).toFixed(1) : '0.0';
    const label = CANCELLATION_REASON_LABELS[code] || code;
    const codeDisplay = code === '' ? '<em>Unassigned</em>' : `<strong>${escapeHtml(code)}</strong>`;
    const rowClass = code === '' && count > 0 ? ' class="cancel-row-unassigned"' : '';
    html += `
      <tr${rowClass}>
        <td>${codeDisplay}</td>
        <td>${escapeHtml(label)}</td>
        <td class="cancel-num-cell">${count}</td>
        <td class="cancel-num-cell">${pct}%</td>
      </tr>
    `;
  }
  html += `
        </tbody>
        <tfoot>
          <tr class="cancel-total-row">
            <td colspan="2"><strong>Total</strong></td>
            <td class="cancel-num-cell"><strong>${total}</strong></td>
            <td class="cancel-num-cell"><strong>100%</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;

  // --- Flight type breakdown ---
  html += `
    <h4 class="cancel-section-title">Breakdown by Movement Type</h4>
    <div class="table-container">
      <table class="cancel-breakdown-table">
        <thead>
          <tr>
            <th>Movement Type</th>
            <th>Description</th>
            <th>Count</th>
            <th>% of Total</th>
          </tr>
        </thead>
        <tbody>
  `;
  for (const ft of FLIGHT_TYPE_ORDER) {
    const count = byFlightType[ft] || 0;
    const pct   = total > 0 ? (count / total * 100).toFixed(1) : '0.0';
    const label = FLIGHT_TYPE_LABELS[ft] || ft;
    html += `
      <tr>
        <td><strong>${escapeHtml(ft)}</strong></td>
        <td>${escapeHtml(label)}</td>
        <td class="cancel-num-cell">${count}</td>
        <td class="cancel-num-cell">${pct}%</td>
      </tr>
    `;
  }
  if (byFlightType[''] > 0) {
    const count = byFlightType[''];
    const pct   = total > 0 ? (count / total * 100).toFixed(1) : '0.0';
    html += `
      <tr class="cancel-row-unassigned">
        <td><em>Unknown</em></td>
        <td>Type not recorded</td>
        <td class="cancel-num-cell">${count}</td>
        <td class="cancel-num-cell">${pct}%</td>
      </tr>
    `;
  }
  html += `
        </tbody>
        <tfoot>
          <tr class="cancel-total-row">
            <td colspan="2"><strong>Total</strong></td>
            <td class="cancel-num-cell"><strong>${total}</strong></td>
            <td class="cancel-num-cell"><strong>100%</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;

  // --- Ranked tables helper ---
  function renderRankedTable(items, nameHeader, maxRows) {
    if (!items || items.length === 0) {
      return '<p class="cancel-no-data">No data in selected range.</p>';
    }
    const shown = items.slice(0, maxRows || 20);
    let t = `
      <div class="table-container">
        <table class="cancel-breakdown-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>${escapeHtml(nameHeader)}</th>
              <th>Cancellations</th>
              <th>% of Total</th>
            </tr>
          </thead>
          <tbody>
    `;
    shown.forEach((item, idx) => {
      const pct  = total > 0 ? (item.count / total * 100).toFixed(1) : '0.0';
      const rank = item.isUnknown ? '—' : (idx + 1);
      const rowClass = item.isUnknown ? ' class="cancel-row-unassigned"' : '';
      t += `
        <tr${rowClass}>
          <td class="cancel-num-cell">${rank}</td>
          <td><${item.isUnknown ? 'em' : 'strong'}>${escapeHtml(item.name)}</${item.isUnknown ? 'em' : 'strong'}></td>
          <td class="cancel-num-cell">${item.count}</td>
          <td class="cancel-num-cell">${pct}%</td>
        </tr>
      `;
    });
    t += `</tbody></table></div>`;
    return t;
  }

  // --- Ranked: Aircraft Type ---
  html += `<h4 class="cancel-section-title">Most Cancelled — Aircraft Type</h4>`;
  html += renderRankedTable(ranked.byAircraftType, 'Aircraft Type', 20);

  // --- Ranked: Registration ---
  html += `<h4 class="cancel-section-title">Most Cancelled — Registration</h4>`;
  html += renderRankedTable(ranked.byRegistration, 'Registration', 20);

  // --- Ranked: Captain / PIC ---
  html += `
    <h4 class="cancel-section-title">Most Cancelled — Captain / PIC</h4>
    <p class="cancel-datasource-note">Only as reliable as operator data entry. Blank entries grouped as "Captain not recorded".</p>
  `;
  html += renderRankedTable(ranked.byCaptain, 'Captain / PIC', 20);

  // --- Ranked: Departure Aerodrome ---
  html += `<h4 class="cancel-section-title">Most Cancelled — Departure Aerodrome</h4>`;
  html += renderRankedTable(ranked.byDepAd, 'Dep AD', 20);

  // --- Ranked: Arrival Aerodrome ---
  html += `<h4 class="cancel-section-title">Most Cancelled — Arrival Aerodrome</h4>`;
  html += renderRankedTable(ranked.byArrAd, 'Arr AD', 20);

  // --- Row-level detail table ---
  html += `
    <h4 class="cancel-section-title">Row-Level Detail (${rows.length} cancellations)</h4>
    <p class="cancel-datasource-note">
      Current-state fields. Reason reflects current editable value, not locked snapshot.
      Use Export Cancellations CSV for full machine-readable output.
    </p>
  `;

  if (rows.length === 0) {
    html += '<p class="cancel-no-data">No cancellations found in selected date range.</p>';
  } else {
    html += `
      <div class="table-container" style="overflow-x: auto;">
        <table class="cancel-detail-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Cancel Date</th>
              <th>Cancelled At (UTC)</th>
              <th>Callsign</th>
              <th>Reg</th>
              <th>A/C Type</th>
              <th>Dep</th>
              <th>Arr</th>
              <th>DOF</th>
              <th>Reason</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
    `;
    for (const r of rows) {
      const cancelledAtDisplay = r.cancelledAt
        ? formatISOToDisplay(r.cancelledAt)
        : (r.cancelDate || '—');
      const reasonDisplay = r.reasonCode
        ? escapeHtml(r.reasonCode)
        : '<em class="cancel-unassigned-label">—</em>';
      html += `
        <tr>
          <td><strong>${escapeHtml(r.flightType || '—')}</strong></td>
          <td class="cancel-date-cell">${escapeHtml(r.cancelDate || '—')}</td>
          <td class="cancel-date-cell">${escapeHtml(cancelledAtDisplay)}</td>
          <td>${escapeHtml(r.callsign || '—')}</td>
          <td>${escapeHtml(r.registration || '—')}</td>
          <td>${escapeHtml(r.aircraftType || '—')}</td>
          <td>${escapeHtml(r.depAd || '—')}</td>
          <td>${escapeHtml(r.arrAd || '—')}</td>
          <td class="cancel-date-cell">${escapeHtml(r.dof || '—')}</td>
          <td>${reasonDisplay}</td>
          <td class="cancel-note-cell">${escapeHtml(r.reasonText || '')}</td>
        </tr>
      `;
    }
    html += `</tbody></table></div>`;
  }

  container.innerHTML = html;
}

/**
 * Format an ISO 8601 timestamp for tabular display: "YYYY-MM-DD HH:MM UTC"
 * @param {string} iso
 * @returns {string}
 */
function formatISOToDisplay(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const date = d.toISOString().substring(0, 10);
    const time = d.toISOString().substring(11, 16);
    return `${date} ${time} UTC`;
  } catch (e) {
    return iso;
  }
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

/**
 * Get month name from month number
 */
function getMonthName(month) {
  const names = ['January', 'February', 'March', 'April', 'May', 'June',
                 'July', 'August', 'September', 'October', 'November', 'December'];
  return names[month - 1] || '';
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') return unsafe;
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

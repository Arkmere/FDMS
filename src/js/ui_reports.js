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
  exportMonthlyReturnToXLSX
} from './reporting.js';

// Current view state
let currentView = 'official';
let currentYear = new Date().getUTCFullYear();
let currentMonth = new Date().getUTCMonth() + 1; // 1-12

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

  // Show/hide hours input panel based on view
  const hoursPanel = document.getElementById('hoursInputPanel');
  if (hoursPanel) {
    hoursPanel.style.display = currentView === 'official' ? 'block' : 'none';
  }

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

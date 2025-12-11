# Vectair FDMS Lite – Front-End Skeleton

This repository contains the initial front-end skeleton for **Vectair FDMS Lite**, built from the single-file prototype into a modular structure suitable for further development (and later a desktop wrapper).

Current focus:

- Single-page HTML app under `/src`
- Vectair-style UI (colours, typography, table layout)
- “Live Board” with demo movements, including a formation example
- Static “New Flight” / “New Local” modals (visual only for now)

Back-end, persistence, and VKB pack handling will be added later.

---

## Project Structure

```text
fdms-lite/
├─ README.md
├─ roadmap.md                 # High-level roadmap/spec (not included here)
├─ prototype/
│  └─ vectair_fdms_demo.html  # Original single-file demo (optional, reference)
└─ src/
   ├─ index.html              # Main app shell
   ├─ css/
   │  └─ vectair.css          # Shared styling / design tokens
   └─ js/
      ├─ app.js               # App bootstrap, tab switching
      ├─ datamodel.js         # Demo movement data + helpers
      └─ ui_liveboard.js      # Live Board rendering + modals
Only the /src content is required to run the current demo.

How to Run
No build step is required.

Clone or download this repository.

Open src/index.html in any modern browser (Chrome, Edge, Firefox, etc.).

You should see:

Vectair-style header and navigation tabs.

A Live Board tab with a table of demo movements:

Local circuits, visiting military flights, an overflight, and two formations (CNNCT and MEMORIAL).

Click a row’s “Details ▾” button to expand and see:

Movement summary

Coding & classification

Formation details (for CNNCT and MEMORIAL).

Use:

Global search to filter any text.

Column filters for Callsign, Reg/Type, and Route.

“New Flight” and “New Local” buttons open static modals to show the intended form layout; they do not yet save data.

Next Steps (for development)
Suggested immediate next steps (see roadmap.md for full context):

Refactor the in-memory demo data into a richer data model with:

Movement lifecycle

Formation groups and element inheritance

WTC caching per scheme

Wire the “New Flight” / “New Local” modals to create new movements in memory.

Extend the tab system:

Build out History using the same table component.

Add placeholder views for VKB Lookup and Admin.

Plan persistence (SQLite / API) and a desktop wrapper (e.g. Electron).

This skeleton is intentionally simple and self-contained so that tools like Codex / Copilot can work directly from the existing HTML, CSS, and JS.

php-template
Copy code

---

### `src/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Vectair FDMS Lite – Live Board</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="css/vectair.css" />
</head>
<body>
  <div class="app-shell">
    <header class="header">
      <div class="header-left">
        <div class="va-logo-box">VA</div>
        <div>
          <div class="va-title-main">Vectair FDMS Lite</div>
          <div class="va-title-sub">Flight Data Management – Local VFR / Admin</div>
        </div>
      </div>
      <div class="header-right">
        <div>Facility: EGOW · RAF Woodvale (Demo)</div>
        <div id="utcClock">UTC: --:-- · ----------</div>
      </div>
    </header>

    <nav class="nav-bar">
      <div class="nav-tabs">
        <button class="nav-tab active" data-tab="live">Live Board</button>
        <button class="nav-tab" data-tab="history">History</button>
        <button class="nav-tab" data-tab="reports">Reports</button>
        <button class="nav-tab" data-tab="lookup">VKB Lookup</button>
        <button class="nav-tab" data-tab="admin">Admin</button>
      </div>
    </nav>

    <main class="page-body">
      <!-- Live toolbar -->
      <div class="toolbar" id="live-toolbar">
        <div class="toolbar-left">
          <select class="field field-select" id="dateRange">
            <option value="today">Today</option>
            <option value="3days">Today + 3 days</option>
            <option value="all">All demo flights</option>
          </select>
          <select class="field field-select" id="statusFilter">
            <option value="planned_active">Status: Planned & Active</option>
            <option value="active">Status: Active only</option>
            <option value="all">Status: All</option>
          </select>
          <input
            class="field field-search-global"
            id="searchGlobal"
            placeholder="Global search (callsign, reg, aerodrome…)"
          />
        </div>
        <div class="toolbar-right">
          <button class="btn btn-secondary" id="btnNewLocal">New Local</button>
          <button class="btn btn-primary" id="btnNewFlight">New Flight</button>
        </div>
      </div>

      <!-- Toolbar placeholder for non-live tabs -->
      <div class="toolbar" id="other-toolbar">
        <div class="toolbar-left">
          <span class="page-subtitle" style="margin:0;">
            Demo view – filters and controls for this tab are not implemented yet.
          </span>
        </div>
      </div>

      <!-- Live Board panel -->
      <section class="panel" id="live-panel">
        <div class="page-title">Live Board</div>
        <div class="page-subtitle">
          Planned and active movements for EGOW. Click a row to view full details. Demo data only.
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th style="width:8px;"></th>
                <th>Callsign</th>
                <th>Reg / Type / WTC</th>
                <th>Route</th>
                <th>Times (Planned / Actual)</th>
                <th>Activity</th>
                <th style="width:70px; text-align:right;">Actions</th>
              </tr>
              <tr class="filter-row">
                <th></th>
                <th><input type="text" id="filterCallsign" placeholder="Search…" /></th>
                <th><input type="text" id="filterReg" placeholder="Search…" /></th>
                <th><input type="text" id="filterRoute" placeholder="DEP/ARR…" /></th>
                <th></th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody id="liveBody">
              <!-- Rows injected by ui_liveboard.js -->
            </tbody>
          </table>
        </div>
      </section>

      <!-- History panel -->
      <section class="panel" id="history-panel">
        <div class="page-title">History</div>
        <div class="page-subtitle">
          Completed and cancelled movements. Will reuse the Live Board table with additional filters.
        </div>
        <div class="placeholder">
          This demo focuses on the Live Board. History will be implemented in a later stage.
        </div>
      </section>

      <!-- Reports panel -->
      <section class="panel" id="reports-panel">
        <div class="page-title">Reports</div>
        <div class="page-subtitle">
          EGOW-style movement summaries, monthly statistics, and export tools.
        </div>
        <div class="placeholder">
          In the full system this tab will produce reports similar to your existing annual Excel stats,
          including movement counts by EGOW code, unit, T&amp;Gs, O/S, and other metrics.
        </div>
      </section>

      <!-- VKB Lookup panel -->
      <section class="panel" id="lookup-panel">
        <div class="page-title">VKB Lookup</div>
        <div class="page-subtitle">
          Embedded view onto the Vectair Knowledge Base (airline codes, callsigns, locations, types, squawks).
        </div>
        <div class="placeholder">
          Future implementation: tables mirroring vectair.org with per-column search and the ability
          to send selected rows directly into a strip (e.g. &ldquo;Use as callsign&rdquo;, &ldquo;Use as DEP/ARR&rdquo;).
        </div>
      </section>

      <!-- Admin panel -->
      <section class="panel" id="admin-panel">
        <div class="page-title">Admin</div>
        <div class="page-subtitle">
          Facility configuration, VKB packs, users &amp; roles, and business rules.
        </div>
        <div class="placeholder">
          This demo does not implement Admin logic yet. In the full version this tab will control facility settings,
          WTC scheme selection, VKB pack recommendations, and user permissions.
        </div>
      </section>
    </main>
  </div>

  <!-- Modal root for New Flight / New Local dialogs -->
  <div id="modalRoot"></div>

  <script type="module" src="js/app.js"></script>
</body>
</html>

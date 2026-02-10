/**
 * Sprint 3 — Option A: Event / Refresh Storm Safety Audit
 * Playwright (Chromium headless) stress test harness
 *
 * Scenarios:
 *   S1: Rapid inline edits on one strip (N=25)
 *   S2: Rapid edits across multiple strips (10 strips, N=50 round-robin)
 *   S3: Status transitions with counter verification
 *   S4: Booking-linked flow stress (N=15 edits, link integrity)
 *   S5: Delete/cancel under load (10 strips mixed)
 *
 * Instrumentation: Uses window.__FDMS_DIAGNOSTICS__ / window.__fdmsDiag counters
 * to detect event storms or runaway re-renders.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const APP_URL = 'http://localhost:8765/';
const EVIDENCE_DIR = '/home/user/FDMS/evidence_s3';
const RESULTS = [];
let screenshotIdx = 0;

const IGNORABLE_ERRORS = [
  'ERR_TUNNEL_CONNECTION_FAILED', 'ERR_NAME_NOT_RESOLVED', 'net::ERR_',
  'favicon.ico'
];

function isIgnorableError(msg) {
  return IGNORABLE_ERRORS.some(pat => msg.includes(pat));
}

function logResult(testId, title, pass, note, evidenceRefs = []) {
  const status = pass ? 'PASS' : 'FAIL';
  RESULTS.push({ testId, title, status, note, evidenceRefs });
  console.log(`  ${status}  ${testId}   ${title}${note ? ' | ' + note : ''}`);
}

async function screenshot(page, label) {
  screenshotIdx++;
  const fname = `S3_${screenshotIdx}_${label.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
  await page.screenshot({ path: path.join(EVIDENCE_DIR, fname), fullPage: false });
  return fname;
}

function getTodayISO() {
  return new Date().toISOString().split('T')[0];
}

function makeMovement(overrides) {
  const now = new Date().toISOString();
  return {
    id: 1, status: 'ACTIVE', callsignCode: 'STR01', callsignVoice: '',
    registration: 'G-ABCD', type: 'C172', wtc: 'L', depAd: 'EGOW', depName: 'Woodvale',
    arrAd: 'EGLL', arrName: 'Heathrow', depPlanned: '14:00', depActual: null,
    arrPlanned: '15:00', arrActual: null, dof: getTodayISO(), rules: 'VFR',
    flightType: 'DEP', isLocal: false, tngCount: 0, osCount: 0, fisCount: 0,
    egowCode: 'VC', unitCode: '', captain: '', pob: 1, remarks: '',
    formation: null, priorityLetter: '', bookingId: null,
    changeLog: [], createdAtUtc: now, updatedAtUtc: now, updatedBy: 'test',
    ...overrides
  };
}

async function seedData(page, movements, bookings = null) {
  await page.evaluate(({ movements, bookings }) => {
    localStorage.clear();
    const mvmtPayload = {
      version: 3,
      timestamp: new Date().toISOString(),
      movements
    };
    localStorage.setItem('vectair_fdms_movements_v3', JSON.stringify(mvmtPayload));
    if (bookings !== null) {
      const bookingPayload = {
        version: 1,
        timestamp: new Date().toISOString(),
        bookings
      };
      localStorage.setItem('vectair_fdms_bookings_v1', JSON.stringify(bookingPayload));
    }
  }, { movements, bookings });
  await page.reload({ waitUntil: 'networkidle' });
  await waitForApp(page);
}

async function waitForApp(page) {
  await page.waitForSelector('#liveBody', { timeout: 15000 });
  await page.waitForTimeout(500);
}

async function enableDiagnostics(page) {
  await page.evaluate(() => {
    window.__FDMS_DIAGNOSTICS__ = true;
    window.__fdmsDiag = {
      renderLiveBoardCount: 0,
      renderHistoryBoardCount: 0,
      updateDailyStatsCount: 0,
      updateFisCountersCount: 0,
      dataChangedDispatched: 0,
      dataChangedReceived: 0
    };
  });
}

async function getDiag(page) {
  return page.evaluate(() => window.__fdmsDiag ? { ...window.__fdmsDiag } : null);
}

async function resetDiag(page) {
  await page.evaluate(() => {
    if (window.__fdmsDiag) {
      for (const k of Object.keys(window.__fdmsDiag)) window.__fdmsDiag[k] = 0;
    }
  });
}

async function getMovements(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('vectair_fdms_movements_v3');
    if (!raw) return [];
    try { return JSON.parse(raw).movements || []; } catch { return []; }
  });
}

async function getBookings(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('vectair_fdms_bookings_v1');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return parsed.bookings || (Array.isArray(parsed) ? parsed : []);
    } catch { return []; }
  });
}

/**
 * Perform an inline edit on a strip cell.
 * Cells use CSS classes: .js-edit-callsign, .js-edit-reg, .js-edit-type,
 *   .js-edit-dep-ad, .js-edit-arr-ad, .js-edit-dep-time, .js-edit-arr-time
 * @param {object} page - Playwright page
 * @param {number} movementId - Strip ID
 * @param {string} cellClass - CSS class of the editable element (e.g., '.js-edit-callsign')
 * @param {string} newValue - Value to type
 */
async function inlineEdit(page, movementId, cellClass, newValue) {
  const row = page.locator(`#liveBody tr[data-id="${movementId}"]`);
  const cell = row.locator(cellClass).first();

  // Double-click to enter edit mode
  await cell.dblclick({ timeout: 5000 });
  await page.waitForTimeout(150);

  // Find the input that appeared
  const input = cell.locator('input').first();
  await input.waitFor({ state: 'visible', timeout: 3000 });

  // Clear and type new value
  await input.fill('');
  await input.type(newValue, { delay: 10 });
  await page.waitForTimeout(50);

  // Press Enter to save
  await input.press('Enter');
  await page.waitForTimeout(250);
}

/**
 * Read counter values from the page
 */
async function readCounters(page) {
  return page.evaluate(() => {
    const text = (id) => {
      const el = document.getElementById(id);
      return el ? parseInt(el.textContent, 10) || 0 : -1;
    };
    return {
      total: text('statTotalToday'),
      bm: text('statBookedMvmts'),
      bc: text('statBookedComp'),
      vm: text('statVfrMvmts'),
      vc: text('statVfrComp'),
      fisStrip: text('stripFisCount'),
      fisGeneric: text('genericOvrCount'),
      fisTotal: text('totalFisCount')
    };
  });
}

// ═══════════════════════════════════════════
//  SCENARIO 1: Rapid inline edits on one strip
// ═══════════════════════════════════════════
async function scenario1(page, jsErrors) {
  console.log('\n--- SCENARIO 1: Rapid inline edits on one strip (N=25) ---');
  const N = 25;

  const strip = makeMovement({ id: 1, callsignCode: 'RAP01', depPlanned: '10:00' });
  await seedData(page, [strip]);
  await enableDiagnostics(page);
  await resetDiag(page);

  const errorsBefore = jsErrors.length;
  let successCount = 0;

  for (let i = 0; i < N; i++) {
    try {
      // Alternate between dep time field and callsign
      if (i % 2 === 0) {
        const hh = String(10 + Math.floor(i / 2) % 12).padStart(2, '0');
        const mm = String((i * 3) % 60).padStart(2, '0');
        await inlineEdit(page, 1, '.js-edit-dep-time', `${hh}${mm}`);
      } else {
        await inlineEdit(page, 1, '.js-edit-callsign', `RAP${String(i).padStart(2, '0')}`);
      }
      successCount++;
    } catch (e) {
      console.log(`    S1 iteration ${i} error: ${e.message.slice(0, 80)}`);
    }
  }

  // Let things settle
  await page.waitForTimeout(500);

  const diag = await getDiag(page);
  const newErrors = jsErrors.slice(errorsBefore).filter(e => !isIgnorableError(e));
  const movements = await getMovements(page);
  const strip1 = movements.find(m => m.id === 1);

  // Verify data persisted (strip still exists with valid callsign)
  const dataOk = strip1 && strip1.callsignCode && strip1.callsignCode.length > 0;
  // Verify no runaway renders: renders should be roughly proportional to edits
  // Each edit triggers ~1 renderLiveBoard + ~1 renderHistoryBoard + initial load renders
  const renderRatio = diag ? diag.renderLiveBoardCount / Math.max(successCount, 1) : 999;
  const noStorm = renderRatio < 4; // generous: allow up to 4x renders per edit

  const pass = newErrors.length === 0 && dataOk && noStorm && successCount >= 20;
  const evRef = await screenshot(page, 'S1_after_25_rapid_edits');

  logResult('S1', `Rapid inline edits (N=${N})`, pass,
    `${successCount}/${N} edits OK, errors=${newErrors.length}, ` +
    `renders=${diag?.renderLiveBoardCount}, ratio=${renderRatio.toFixed(1)}, ` +
    `strip.callsign=${strip1?.callsignCode}`,
    [evRef]);

  return { diag, newErrors, successCount };
}

// ═══════════════════════════════════════════
//  SCENARIO 2: Rapid edits across multiple strips
// ═══════════════════════════════════════════
async function scenario2(page, jsErrors) {
  console.log('\n--- SCENARIO 2: Rapid edits across 10 strips (N=50 round-robin) ---');
  const NUM_STRIPS = 10;
  const N = 50;

  const strips = [];
  for (let i = 1; i <= NUM_STRIPS; i++) {
    strips.push(makeMovement({
      id: i,
      callsignCode: `MUL${String(i).padStart(2, '0')}`,
      depPlanned: `${String(8 + i).padStart(2, '0')}:00`,
      egowCode: i % 2 === 0 ? 'VC' : 'BM'
    }));
  }
  await seedData(page, strips);
  await enableDiagnostics(page);
  await resetDiag(page);

  const errorsBefore = jsErrors.length;
  let successCount = 0;

  for (let i = 0; i < N; i++) {
    const stripId = (i % NUM_STRIPS) + 1;
    const newCallsign = `E${String(i).padStart(3, '0')}`;
    try {
      await inlineEdit(page, stripId, '.js-edit-callsign', newCallsign);
      successCount++;
    } catch (e) {
      console.log(`    S2 iteration ${i} (strip ${stripId}) error: ${e.message.slice(0, 80)}`);
    }
  }

  await page.waitForTimeout(500);

  const diag = await getDiag(page);
  const newErrors = jsErrors.slice(errorsBefore).filter(e => !isIgnorableError(e));
  const movements = await getMovements(page);

  // Verify all 10 strips still exist
  const allExist = movements.length === NUM_STRIPS;
  // Verify no duplicate IDs
  const ids = movements.map(m => m.id);
  const uniqueIds = new Set(ids).size === NUM_STRIPS;
  // Render ratio check
  const renderRatio = diag ? diag.renderLiveBoardCount / Math.max(successCount, 1) : 999;
  const noStorm = renderRatio < 4;

  const pass = newErrors.length === 0 && allExist && uniqueIds && noStorm && successCount >= 40;
  const evRef = await screenshot(page, 'S2_after_50_multistrip_edits');

  logResult('S2', `Multi-strip edits (${NUM_STRIPS} strips, N=${N})`, pass,
    `${successCount}/${N} edits, strips=${movements.length}, ` +
    `unique_ids=${uniqueIds}, errors=${newErrors.length}, ` +
    `renders=${diag?.renderLiveBoardCount}, ratio=${renderRatio.toFixed(1)}`,
    [evRef]);

  return { diag, newErrors, successCount };
}

// ═══════════════════════════════════════════
//  SCENARIO 3: Status transitions + counter verification
// ═══════════════════════════════════════════
async function scenario3(page, jsErrors) {
  console.log('\n--- SCENARIO 3: Status transitions with counter verification ---');
  const today = getTodayISO();

  // 5 PLANNED strips with far-future times to prevent auto-activation
  const strips = [];
  for (let i = 1; i <= 5; i++) {
    strips.push(makeMovement({
      id: i,
      status: 'PLANNED',
      callsignCode: `TRN${String(i).padStart(2, '0')}`,
      depPlanned: '23:59',
      arrPlanned: '23:59',
      dof: today,
      egowCode: i <= 3 ? 'VC' : 'BM'
    }));
  }
  await seedData(page, strips);
  await enableDiagnostics(page);
  await resetDiag(page);

  const errorsBefore = jsErrors.length;

  // Initial counters: all PLANNED, so total should be 0
  const c0 = await readCounters(page);
  console.log(`    Counters after seed (all PLANNED): total=${c0.total}`);

  // Transition strips 1-3 to ACTIVE via dropdown
  for (let i = 1; i <= 3; i++) {
    await transitionStrip(page, i, 'ACTIVE');
    await page.waitForTimeout(300);
  }

  const c1 = await readCounters(page);
  console.log(`    Counters after 3 ACTIVE: total=${c1.total}, vc=${c1.vc}, bm=${c1.bm}`);

  // Transition strip 1 to COMPLETED
  await transitionStrip(page, 1, 'COMPLETED');
  await page.waitForTimeout(300);

  const c2 = await readCounters(page);
  console.log(`    Counters after 1 COMPLETED + 2 ACTIVE: total=${c2.total}`);

  // Cancel strip 2
  await transitionStrip(page, 2, 'CANCELLED');
  await page.waitForTimeout(300);

  const c3 = await readCounters(page);
  console.log(`    Counters after 1 COMPLETED + 1 ACTIVE + 1 CANCELLED: total=${c3.total}`);

  const diag = await getDiag(page);
  const newErrors = jsErrors.slice(errorsBefore).filter(e => !isIgnorableError(e));

  // Verify counter correctness at each stage
  const counterOk =
    c0.total === 0 &&       // All PLANNED → 0
    c1.total === 3 &&       // 3 ACTIVE → 3
    c2.total === 3 &&       // 1 COMPLETED + 2 ACTIVE → 3 (no double count)
    c3.total === 2;         // 1 COMPLETED + 1 ACTIVE (1 cancelled excluded) → 2

  const pass = newErrors.length === 0 && counterOk;
  const evRef = await screenshot(page, 'S3_counter_transitions');

  logResult('S3', 'Status transitions + counter correctness', pass,
    `c0=${c0.total}, c1=${c1.total}, c2=${c2.total}, c3=${c3.total}, ` +
    `expected=0,3,3,2, errors=${newErrors.length}`,
    [evRef]);

  return { diag, newErrors };
}

/**
 * Transition a strip to a new status.
 * - ACTIVE: click the standalone "→ Active" button (js-activate)
 * - COMPLETED: click the standalone "→ Complete" button (js-complete)
 * - CANCELLED: open Edit dropdown, click Cancel (js-cancel) — in portal
 */
async function transitionStrip(page, movementId, targetStatus) {
  const row = page.locator(`#liveBody tr[data-id="${movementId}"]`).first();

  if (targetStatus === 'ACTIVE') {
    const btn = row.locator('.js-activate').first();
    await btn.click({ timeout: 5000 });
  } else if (targetStatus === 'COMPLETED') {
    const btn = row.locator('.js-complete').first();
    await btn.click({ timeout: 5000 });
  } else if (targetStatus === 'CANCELLED') {
    // Cancel is inside the Edit dropdown (portal-based)
    const editBtn = row.locator('.js-edit-dropdown').first();
    await editBtn.click({ timeout: 5000 });
    await page.waitForTimeout(200);
    const cancelBtn = page.locator('button.js-cancel:visible').first();
    await cancelBtn.click({ timeout: 5000 });
  } else {
    throw new Error(`Unknown target status: ${targetStatus}`);
  }
  await page.waitForTimeout(300);
}

// ═══════════════════════════════════════════
//  SCENARIO 4: Booking-linked flow stress
// ═══════════════════════════════════════════
async function scenario4(page, jsErrors) {
  console.log('\n--- SCENARIO 4: Booking-linked flow stress (N=15) ---');
  const N = 15;
  const today = getTodayISO();

  const booking = {
    id: 'BK-STRESS-001',
    callsign: 'LNK01',
    registration: 'G-LINK',
    type: 'PA28',
    schedule: {
      dateISO: today,
      plannedTimeLocalHHMM: '12:00',
      plannedTimeKind: 'DEP',
      arrivalTimeLocalHHMM: null
    },
    aircraft: { registration: 'G-LINK', type: 'PA28', callsign: 'LNK01', pob: 2 },
    movement: { departure: 'EGOW', departureName: 'Woodvale' },
    ops: { notesFromStrip: '' },
    status: 'CONFIRMED',
    linkedStripId: 1,
    createdAt: new Date().toISOString()
  };

  const strip = makeMovement({
    id: 1,
    callsignCode: 'LNK01',
    registration: 'G-LINK',
    type: 'PA28',
    depPlanned: '12:00',
    dof: today,
    bookingId: 'BK-STRESS-001'
  });

  await seedData(page, [strip], [booking]);
  await enableDiagnostics(page);
  await resetDiag(page);

  const errorsBefore = jsErrors.length;
  let successCount = 0;

  for (let i = 0; i < N; i++) {
    try {
      // Edit callsign (should sync to booking)
      const newCallsign = `LK${String(i).padStart(2, '0')}`;
      await inlineEdit(page, 1, '.js-edit-callsign', newCallsign);
      successCount++;
    } catch (e) {
      console.log(`    S4 iteration ${i} error: ${e.message.slice(0, 80)}`);
    }
  }

  await page.waitForTimeout(500);

  const diag = await getDiag(page);
  const newErrors = jsErrors.slice(errorsBefore).filter(e => !isIgnorableError(e));

  // Check link integrity
  const movements = await getMovements(page);
  const bookings = await getBookings(page);
  const strip1 = movements.find(m => m.id === 1);
  const bk1 = bookings.find(b => b.id === 'BK-STRESS-001');

  const linkOk = strip1?.bookingId === 'BK-STRESS-001' &&
                 bk1?.linkedStripId === 1;
  // Booking sync should have dispatched events — check ratio
  const syncRatio = diag ? diag.dataChangedDispatched / Math.max(successCount, 1) : 0;

  const pass = newErrors.length === 0 && linkOk && successCount >= 12;
  const evRef = await screenshot(page, 'S4_booking_linked_stress');

  logResult('S4', `Booking-linked stress (N=${N})`, pass,
    `${successCount}/${N} edits, link_ok=${linkOk}, ` +
    `sync_dispatches=${diag?.dataChangedDispatched}, ratio=${syncRatio.toFixed(1)}, ` +
    `errors=${newErrors.length}`,
    [evRef]);

  return { diag, newErrors, successCount };
}

// ═══════════════════════════════════════════
//  SCENARIO 5: Delete/cancel under load
// ═══════════════════════════════════════════
async function scenario5(page, jsErrors) {
  console.log('\n--- SCENARIO 5: Delete/cancel under load (10 strips) ---');
  const today = getTodayISO();

  const strips = [];
  for (let i = 1; i <= 10; i++) {
    strips.push(makeMovement({
      id: i,
      status: 'ACTIVE',
      callsignCode: `DEL${String(i).padStart(2, '0')}`,
      depPlanned: `${String(8 + i).padStart(2, '0')}:00`,
      dof: today,
      egowCode: 'VC'
    }));
  }
  await seedData(page, strips);
  await enableDiagnostics(page);
  await resetDiag(page);

  const errorsBefore = jsErrors.length;

  // Delete strips 1, 2, 3
  for (const id of [1, 2, 3]) {
    await deleteStrip(page, id);
    await page.waitForTimeout(300);
  }

  // Cancel strips 4, 5, 6
  for (const id of [4, 5, 6]) {
    await transitionStrip(page, id, 'CANCELLED');
    await page.waitForTimeout(300);
  }

  // Complete strips 7, 8
  for (const id of [7, 8]) {
    await transitionStrip(page, id, 'COMPLETED');
    await page.waitForTimeout(300);
  }

  // Strips 9, 10 stay ACTIVE
  await page.waitForTimeout(500);

  const diag = await getDiag(page);
  const newErrors = jsErrors.slice(errorsBefore).filter(e => !isIgnorableError(e));
  const movements = await getMovements(page);

  // Expected: 7 remain (1,2,3 deleted permanently)
  const remaining = movements.length;
  const activeCount = movements.filter(m => m.status === 'ACTIVE').length;
  const completedCount = movements.filter(m => m.status === 'COMPLETED').length;
  const cancelledCount = movements.filter(m => m.status === 'CANCELLED').length;

  const counters = await readCounters(page);

  // Expected counters: 2 ACTIVE + 2 COMPLETED = 4
  const counterOk = counters.total === 4;
  const structOk = remaining === 7 && activeCount === 2 && completedCount === 2 && cancelledCount === 3;

  const pass = newErrors.length === 0 && structOk && counterOk;
  const evRef = await screenshot(page, 'S5_delete_cancel_under_load');

  logResult('S5', 'Delete/cancel under load (10 strips)', pass,
    `remaining=${remaining} (exp 7), active=${activeCount}, completed=${completedCount}, ` +
    `cancelled=${cancelledCount}, counter_total=${counters.total} (exp 4), ` +
    `errors=${newErrors.length}`,
    [evRef]);

  return { diag, newErrors };
}

async function deleteStrip(page, movementId) {
  const row = page.locator(`#liveBody tr[data-id="${movementId}"]`).first();
  const editBtn = row.locator('.js-edit-dropdown').first();
  await editBtn.click({ timeout: 5000 });
  await page.waitForTimeout(200);

  // Delete button (portal-based, pick visible)
  const deleteBtn = page.locator('button.js-delete-strip:visible').first();
  await deleteBtn.click({ timeout: 5000 });
  await page.waitForTimeout(200);
}

// ═══════════════════════════════════════════
//  POST-STRESS PERSISTENCE CHECK
// ═══════════════════════════════════════════
async function persistenceCheck(page, jsErrors) {
  console.log('\n--- PERSISTENCE CHECK: Reload + verify data consistency ---');
  const errorsBefore = jsErrors.length;

  // Save movement count before reload
  const beforeMovements = await getMovements(page);

  // Hard reload
  await page.reload({ waitUntil: 'networkidle' });
  await waitForApp(page);

  const afterMovements = await getMovements(page);
  const newErrors = jsErrors.slice(errorsBefore).filter(e => !isIgnorableError(e));

  // Verify data survived reload
  const countMatch = beforeMovements.length === afterMovements.length;
  // Verify no duplicate IDs
  const ids = afterMovements.map(m => m.id);
  const uniqueIds = new Set(ids).size === ids.length;
  // Verify app is responsive (can read a counter)
  const counters = await readCounters(page);
  const responsive = counters.total >= 0;

  const pass = newErrors.length === 0 && countMatch && uniqueIds && responsive;
  const evRef = await screenshot(page, 'S_persist_after_reload');

  logResult('PERSIST', 'Post-stress persistence + consistency', pass,
    `before=${beforeMovements.length}, after=${afterMovements.length}, ` +
    `unique_ids=${uniqueIds}, responsive=${responsive}, errors=${newErrors.length}`,
    [evRef]);

  return { pass };
}

// ═══════════════════════════════════════════
//  QUIESCENCE CHECK
// ═══════════════════════════════════════════
async function quiescenceCheck(page) {
  console.log('\n--- QUIESCENCE CHECK: Verify counters stop growing ---');

  await enableDiagnostics(page);
  await resetDiag(page);

  const diag0 = await getDiag(page);

  // Wait 3 seconds with no actions
  await page.waitForTimeout(3000);

  const diag1 = await getDiag(page);

  // Only the 45s periodic tick could bump counters, but 3s < 45s
  // So counters should be stable (no growth or at most +1 from a tick)
  const renderGrowth = (diag1.renderLiveBoardCount - diag0.renderLiveBoardCount);
  const statsGrowth = (diag1.updateDailyStatsCount - diag0.updateDailyStatsCount);

  // Allow at most 1 tick each (in case tick fires during wait)
  const stable = renderGrowth <= 1 && statsGrowth <= 1;

  logResult('QUIESCE', 'Counters quiesce after actions stop', stable,
    `renderGrowth=${renderGrowth}, statsGrowth=${statsGrowth} (max 1 allowed)`);

  return { stable, diag: diag1 };
}

// ═══════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════
async function run() {
  fs.rmSync(EVIDENCE_DIR, { recursive: true, force: true });
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  console.log('Sprint 3 — Option A: Event/Refresh Storm Safety Audit');
  console.log('======================================================\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const browserVersion = browser.version();
  console.log(`Browser: Chromium ${browserVersion}`);
  console.log(`URL: ${APP_URL}\n`);

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 }
  });
  const page = await context.newPage();

  // Collect JS errors
  const jsErrors = [];
  page.on('pageerror', err => {
    const msg = err.message || String(err);
    jsErrors.push(msg);
    if (!isIgnorableError(msg)) {
      console.log(`  [JS ERROR] ${msg.slice(0, 120)}`);
    }
  });

  // Auto-accept dialogs (confirm for delete/cancel)
  page.on('dialog', async dialog => {
    await dialog.accept();
  });

  // Initial load
  await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await waitForApp(page);

  // Collect all diagnostics for final report
  const allDiag = {};

  // Run scenarios
  const s1 = await scenario1(page, jsErrors);
  allDiag.S1 = s1.diag;

  const s2 = await scenario2(page, jsErrors);
  allDiag.S2 = s2.diag;

  const s3 = await scenario3(page, jsErrors);
  allDiag.S3 = s3.diag;

  const s4 = await scenario4(page, jsErrors);
  allDiag.S4 = s4.diag;

  const s5 = await scenario5(page, jsErrors);
  allDiag.S5 = s5.diag;

  // Post-stress persistence
  await persistenceCheck(page, jsErrors);

  // Quiescence check
  const q = await quiescenceCheck(page);
  allDiag.QUIESCE = q.diag;

  await browser.close();

  // ─── Summary ───
  console.log('\n======================================================');
  console.log('RESULTS SUMMARY');
  console.log('======================================================');
  const passCount = RESULTS.filter(r => r.status === 'PASS').length;
  const failCount = RESULTS.filter(r => r.status === 'FAIL').length;
  const allJsErrors = jsErrors.filter(e => !isIgnorableError(e));

  for (const r of RESULTS) {
    console.log(`  ${r.status}  ${r.testId}   ${r.title}`);
  }
  console.log(`\nOverall: ${passCount} PASS, ${failCount} FAIL`);
  console.log(`Total real JS errors: ${allJsErrors.length}`);
  if (allJsErrors.length > 0) {
    console.log('JS Errors:');
    for (const e of allJsErrors) console.log(`  - ${e.slice(0, 150)}`);
  }

  // Dump diagnostics
  console.log('\n--- DIAGNOSTICS DUMP ---');
  console.log(JSON.stringify(allDiag, null, 2));

  // Generate evidence pack
  generateEvidencePack(browserVersion, allDiag, allJsErrors);

  console.log(`\nDone. Evidence in ${EVIDENCE_DIR}/`);
  process.exit(failCount > 0 ? 1 : 0);
}

function generateEvidencePack(browserVersion, allDiag, allJsErrors) {
  const date = new Date().toISOString().split('T')[0];
  const lines = [];
  lines.push(`# Sprint 3 — Option A: Stress Audit Evidence Pack`);
  lines.push(`## Date: ${date}`);
  lines.push('');
  lines.push('## Environment');
  lines.push(`- **Playwright:** ${process.env.npm_package_version || 'global install'}`);
  lines.push(`- **Browser:** Chromium ${browserVersion} (headless)`);
  lines.push(`- **OS:** Linux (container)`);
  lines.push(`- **URL:** ${APP_URL}`);
  lines.push('');
  lines.push('## Results Table');
  lines.push('');
  lines.push('| Test ID | Scenario | Result | Notes |');
  lines.push('|---------|----------|--------|-------|');
  for (const r of RESULTS) {
    lines.push(`| ${r.testId} | ${r.title} | **${r.status}** | ${r.note || ''} |`);
  }
  lines.push('');
  lines.push(`**Overall: ${RESULTS.filter(r => r.status === 'PASS').length}/${RESULTS.length} PASS**`);
  lines.push('');
  lines.push('## JS Errors');
  if (allJsErrors.length === 0) {
    lines.push('None.');
  } else {
    for (const e of allJsErrors) lines.push(`- \`${e.slice(0, 200)}\``);
  }
  lines.push('');
  lines.push('## Diagnostics Counters (window.__fdmsDiag)');
  lines.push('```json');
  lines.push(JSON.stringify(allDiag, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## Screenshots');
  const screenshots = fs.readdirSync(EVIDENCE_DIR).filter(f => f.endsWith('.png')).sort();
  for (const s of screenshots) {
    lines.push(`- \`${s}\``);
  }
  lines.push('');

  const packPath = path.join('/home/user/FDMS', `Sprint3_OptionA_StressAudit_EvidencePack_${date}.md`);
  fs.writeFileSync(packPath, lines.join('\n'));
  console.log(`\nEvidence pack written: ${packPath}`);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});

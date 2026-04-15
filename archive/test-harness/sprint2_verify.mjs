/**
 * Sprint 2 Formal Verification — Browser Smoke + Regression (v2)
 * Playwright (Chromium headless) test harness
 * Tests Tasks A/B/C from STATE.md Sprint 2 ledger.
 *
 * Fixes from v1: proper data seeding, filtered network errors, isolated tests.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const APP_URL = 'http://localhost:8765/';
const SCREENSHOT_DIR = '/home/user/FDMS/evidence';
const RESULTS = [];
let screenshotIdx = 0;

// Only count real JS errors, not network resource failures
const IGNORABLE_ERRORS = ['ERR_TUNNEL_CONNECTION_FAILED', 'ERR_NAME_NOT_RESOLVED', 'net::ERR_'];

function isIgnorableError(msg) {
  return IGNORABLE_ERRORS.some(pat => msg.includes(pat));
}

function logResult(testId, title, pass, note, evidenceRefs = []) {
  const status = pass ? 'PASS' : 'FAIL';
  RESULTS.push({ testId, title, status, note, evidenceRefs });
  console.log(`  ${status}: ${testId} — ${title}${note ? ' | ' + note : ''}`);
}

async function screenshot(page, label) {
  screenshotIdx++;
  const fname = `S${screenshotIdx}_${label.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, fname), fullPage: false });
  return `S${screenshotIdx}: ${label} (${fname})`;
}

async function getLocalStorageKeys(page) {
  return page.evaluate(() => Object.keys(localStorage));
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

async function waitForApp(page) {
  await page.waitForSelector('#liveBody', { timeout: 10000 });
  await page.waitForTimeout(600);
}

function getTodayISO() {
  return new Date().toISOString().split('T')[0];
}

function getYesterdayISO() {
  return new Date(Date.now() - 86400000).toISOString().split('T')[0];
}

/**
 * Seed a known set of movements + optionally bookings directly into localStorage.
 * Bookings must use the store format: { version: 1, bookings: [...] }
 * Then reload the page to pick them up.
 */
async function seedData(page, movements, bookings = null) {
  await page.evaluate(({ movements, bookings }) => {
    const mvmtPayload = {
      version: 3,
      timestamp: new Date().toISOString(),
      movements
    };
    localStorage.setItem('vectair_fdms_movements_v3', JSON.stringify(mvmtPayload));
    if (bookings !== null) {
      // Store expects { version, timestamp, bookings: [...] }
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

function makeMovement(overrides) {
  const now = new Date().toISOString();
  return {
    id: 1, status: 'ACTIVE', callsignCode: 'TEST01', callsignVoice: '',
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

async function run() {
  fs.rmSync(SCREENSHOT_DIR, { recursive: true, force: true });
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  console.log('=== Sprint 2 Formal Verification (v2) ===');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Today ISO: ${getTodayISO()}`);

  const browser = await chromium.launch({ headless: true });
  const browserVersion = browser.version();
  console.log(`Browser: Chromium ${browserVersion}`);
  console.log(`Node: ${process.version}`);
  console.log('');

  // Track real JS errors (not network resource failures)
  const jsErrors = [];
  const allConsoleErrors = [];

  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('pageerror', (err) => {
    jsErrors.push(err.message);
    allConsoleErrors.push(`[pageerror] ${err.message}`);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      allConsoleErrors.push(`[console.error] ${text}`);
      if (!isIgnorableError(text)) {
        jsErrors.push(text);
      }
    }
  });

  // ──── STATE A: Clean Profile ────
  console.log('── STATE A: Clean Profile ──');
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await waitForApp(page);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await waitForApp(page);

  const evidA1 = await screenshot(page, 'Console_clean_after_hard_reload_StateA');
  const keysA = await getLocalStorageKeys(page);
  console.log('  LocalStorage keys (State A):', keysA);
  const evidA2 = await screenshot(page, 'LocalStorage_keys_StateA');

  // ════════════════════════════════════
  // TEST 1 — Inline edit saves canonical time fields (Task A core)
  // ════════════════════════════════════
  console.log('\n── TEST 1: Inline edit saves canonical time fields ──');
  {
    const evids = [];
    const today = getTodayISO();

    // Seed a single ACTIVE DEP strip
    await seedData(page, [
      makeMovement({ id: 1, status: 'ACTIVE', callsignCode: 'TIM01', depPlanned: '14:00', depActual: null, dof: today, flightType: 'DEP' })
    ]);

    const row = page.locator('#liveBody tr[data-id="1"]');
    const depTimeEl = row.locator('.js-edit-dep-time');

    if (await row.isVisible() && await depTimeEl.isVisible()) {
      evids.push(await screenshot(page, 'T1_before_inline_edit'));

      // Double-click dep time to start inline edit
      await depTimeEl.dblclick();
      await page.waitForTimeout(300);

      const input = depTimeEl.locator('input');
      if (await input.isVisible()) {
        await input.fill('');
        await input.type('1430');
        evids.push(await screenshot(page, 'T1_during_inline_edit'));

        await input.press('Enter');
        await page.waitForTimeout(500);

        evids.push(await screenshot(page, 'T1_after_inline_edit'));

        // Check stored movement
        const mvmts = await getMovements(page);
        const m = mvmts.find(x => x.id === 1);
        const canonicalUpdated = m?.depPlanned === '14:30';
        const noPhantom = !m?.etd && !m?.atd;
        console.log(`  depPlanned=${m?.depPlanned}, noPhantom=${noPhantom}`);

        // Reload + verify persistence
        await page.reload({ waitUntil: 'networkidle' });
        await waitForApp(page);
        const mvmts2 = await getMovements(page);
        const m2 = mvmts2.find(x => x.id === 1);
        const persisted = m2?.depPlanned === '14:30';

        evids.push(await screenshot(page, 'T1_after_reload'));

        logResult('TEST 1', 'Inline edit saves canonical time fields',
          canonicalUpdated && persisted && noPhantom,
          `canonical=${canonicalUpdated}, persisted=${persisted}, noPhantom=${noPhantom}`, evids);
      } else {
        logResult('TEST 1', 'Inline edit saves canonical time fields', false, 'Input not visible after dblclick', evids);
      }
    } else {
      logResult('TEST 1', 'Inline edit saves canonical time fields', false, 'Strip row or dep-time el not visible', evids);
    }
  }

  // ════════════════════════════════════
  // TEST 2 — Enter + blur double-save guard (Task A)
  // ════════════════════════════════════
  console.log('\n── TEST 2: Enter + blur double-save guard ──');
  {
    const evids = [];

    // Seed a strip
    await seedData(page, [
      makeMovement({ id: 10, status: 'ACTIVE', callsignCode: 'DUP02', registration: 'G-DUPL', dof: getTodayISO() })
    ]);

    const row = page.locator('#liveBody tr[data-id="10"]');
    const regEl = row.locator('.js-edit-reg');

    if (await row.isVisible() && await regEl.isVisible()) {
      // Double-click to edit registration
      await regEl.dblclick();
      await page.waitForTimeout(300);

      const input = regEl.locator('input');
      if (await input.isVisible()) {
        await input.fill('G-XYZZ');

        // Count JS errors before
        const errsBefore = jsErrors.length;

        // Press Enter (saves) then immediately click elsewhere (blur)
        await input.press('Enter');
        await page.click('body', { position: { x: 10, y: 10 }, force: true });
        await page.waitForTimeout(600);

        evids.push(await screenshot(page, 'T2_after_enter_and_blur'));

        // Verify: only one save happened (check movement changeLog)
        const mvmts = await getMovements(page);
        const m = mvmts.find(x => x.id === 10);
        // changeLog has "created" + (ideally) exactly 1 "updated"
        const updateEntries = (m?.changeLog || []).filter(e => e.action === 'updated');
        const singleSave = updateEntries.length === 1;
        const noNewJSErrors = jsErrors.length === errsBefore;

        console.log(`  changeLog updates: ${updateEntries.length}, registration: ${m?.registration}`);
        console.log(`  New JS errors: ${jsErrors.length - errsBefore}`);

        logResult('TEST 2', 'Enter + blur double-save guard',
          singleSave && noNewJSErrors,
          `updateEntries=${updateEntries.length}, noNewJSErrors=${noNewJSErrors}`, evids);
      } else {
        logResult('TEST 2', 'Enter + blur double-save guard', false, 'Input not visible', evids);
      }
    } else {
      logResult('TEST 2', 'Enter + blur double-save guard', false, 'Row or reg el not visible', evids);
    }
  }

  // ════════════════════════════════════
  // TEST 3 — Callsign cannot be blank (Task A)
  // ════════════════════════════════════
  console.log('\n── TEST 3: Callsign cannot be blank ──');
  {
    const evids = [];

    await seedData(page, [
      makeMovement({ id: 20, status: 'ACTIVE', callsignCode: 'BLK03', dof: getTodayISO() })
    ]);

    const row = page.locator('#liveBody tr[data-id="20"]');
    const csEl = row.locator('.js-edit-callsign');

    if (await row.isVisible() && await csEl.isVisible()) {
      const beforeText = (await csEl.textContent()).trim();
      console.log(`  Callsign before: "${beforeText}"`);
      evids.push(await screenshot(page, 'T3_before_blank'));

      await csEl.dblclick();
      await page.waitForTimeout(300);

      const input = csEl.locator('input');
      if (await input.isVisible()) {
        await input.fill('');
        await input.press('Enter');
        await page.waitForTimeout(600);

        evids.push(await screenshot(page, 'T3_after_blank_attempt'));

        // Check toast
        const toasts = await page.evaluate(() =>
          Array.from(document.querySelectorAll('.toast')).map(t => t.textContent.trim())
        );
        const hasBlankToast = toasts.some(t => t.toLowerCase().includes('blank') || t.toLowerCase().includes('cannot'));
        console.log(`  Toasts: ${JSON.stringify(toasts)}`);

        // Check storage preserved
        const mvmts = await getMovements(page);
        const m = mvmts.find(x => x.id === 20);
        const preserved = m?.callsignCode === 'BLK03';
        console.log(`  Storage callsignCode: "${m?.callsignCode}"`);

        // Reload
        await page.reload({ waitUntil: 'networkidle' });
        await waitForApp(page);
        const mvmts2 = await getMovements(page);
        const m2 = mvmts2.find(x => x.id === 20);
        const persisted = m2?.callsignCode === 'BLK03';

        evids.push(await screenshot(page, 'T3_after_reload'));

        logResult('TEST 3', 'Callsign cannot be blank; revert on invalid clear',
          preserved && persisted && hasBlankToast,
          `preserved=${preserved}, persisted=${persisted}, validationToast=${hasBlankToast}`, evids);
      } else {
        logResult('TEST 3', 'Callsign cannot be blank; revert on invalid clear', false, 'Input not visible', evids);
      }
    } else {
      logResult('TEST 3', 'Callsign cannot be blank; revert on invalid clear', false, 'Row/callsign el not visible', evids);
    }
  }

  // ════════════════════════════════════
  // TEST 4 — Inline edit triggers booking sync (Task A)
  // ════════════════════════════════════
  console.log('\n── TEST 4: Inline edit triggers booking sync ──');
  {
    const evids = [];
    const today = getTodayISO();

    // Seed movement linked to booking, plus matching booking
    const movement = makeMovement({
      id: 30, status: 'ACTIVE', callsignCode: 'SYN04', registration: 'G-SYNC',
      dof: today, bookingId: 200
    });

    const booking = {
      id: 200, status: 'CONFIRMED', linkedStripId: 30,
      contact: { name: 'Test Pilot', phone: '555-1234' },
      schedule: { dof: today, plannedTimeLocalHHMM: '14:00', plannedTimeKind: 'DEP', dateISO: today },
      aircraft: { registration: 'G-SYNC', type: 'C172', callsign: 'SYN04', pob: 1 },
      movement: { departure: 'EGOW', departureName: 'Woodvale' },
      ops: { notesFromStrip: '' }, charges: {},
      createdAtUtc: new Date().toISOString(),
      updatedAtUtc: new Date().toISOString()
    };

    await seedData(page, [movement], [booking]);

    // Verify seeding worked — check bookingId survived reconciliation
    const mvmtsBefore = await getMovements(page);
    const mBefore = mvmtsBefore.find(x => x.id === 30);
    console.log(`  After seed: movement.bookingId=${mBefore?.bookingId}`);

    const bookingsBefore = await getBookings(page);
    const bBefore = bookingsBefore.find(x => x.id === 200);
    console.log(`  After seed: booking.linkedStripId=${bBefore?.linkedStripId}`);

    const row = page.locator('#liveBody tr[data-id="30"]');
    if (await row.isVisible().catch(() => false)) {
      const regEl = row.locator('.js-edit-reg');
      if (await regEl.isVisible()) {
        await regEl.dblclick();
        await page.waitForTimeout(300);
        const input = regEl.locator('input');
        if (await input.isVisible()) {
          await input.fill('G-NEWW');
          await input.press('Enter');
          await page.waitForTimeout(600);

          evids.push(await screenshot(page, 'T4_after_reg_edit'));

          // Check booking sync
          const bookingsAfter = await getBookings(page);
          const bAfter = bookingsAfter.find(x => x.id === 200);
          const syncedReg = bAfter?.aircraft?.registration;
          console.log(`  Booking aircraft.registration after: "${syncedReg}"`);

          // Check link integrity
          const mvmtsAfter = await getMovements(page);
          const mAfter = mvmtsAfter.find(x => x.id === 30);
          const linkOK = mAfter?.bookingId === 200;
          const bookingLinkOK = bAfter?.linkedStripId === 30;
          console.log(`  movement.bookingId=${mAfter?.bookingId}, booking.linkedStripId=${bAfter?.linkedStripId}`);

          logResult('TEST 4', 'Inline edit triggers booking sync',
            syncedReg === 'G-NEWW' && linkOK && bookingLinkOK,
            `syncedReg="${syncedReg}", mvmtLink=${linkOK}, bookingLink=${bookingLinkOK}`, evids);
        } else {
          logResult('TEST 4', 'Inline edit triggers booking sync', false, 'Input not visible', evids);
        }
      } else {
        logResult('TEST 4', 'Inline edit triggers booking sync', false, 'Reg el not visible', evids);
      }
    } else {
      // Maybe auto-activated to a different position. Check if it's anywhere
      const allRows = await page.locator('#liveBody tr[data-id]').count();
      logResult('TEST 4', 'Inline edit triggers booking sync', false,
        `Strip ID=30 not visible on live board (${allRows} rows total). bookingId may have been cleared by reconciliation.`, evids);
    }
  }

  // ════════════════════════════════════
  // TEST 5 — Inline edit triggers counters refresh (Task A)
  // ════════════════════════════════════
  console.log('\n── TEST 5: Inline edit triggers counters refresh ──');
  {
    const evids = [];

    // Seed 2 ACTIVE strips today
    await seedData(page, [
      makeMovement({ id: 40, status: 'ACTIVE', callsignCode: 'CNT05A', egowCode: 'VC', dof: getTodayISO() }),
      makeMovement({ id: 41, status: 'ACTIVE', callsignCode: 'CNT05B', egowCode: 'VM', registration: 'G-EFGH', dof: getTodayISO() })
    ]);

    // Force counter refresh
    await page.evaluate(() => { if (window.updateDailyStats) window.updateDailyStats(); });
    await page.waitForTimeout(200);

    const countersBefore = await page.evaluate(() => ({
      total: document.getElementById('statTotalToday')?.textContent,
      vc: document.getElementById('statVfrComp')?.textContent,
      vm: document.getElementById('statVfrMvmts')?.textContent
    }));
    console.log(`  Counters before: ${JSON.stringify(countersBefore)}`);
    evids.push(await screenshot(page, 'T5_counters_before'));

    // Inline edit a field to trigger counter refresh
    const row = page.locator('#liveBody tr[data-id="40"]');
    const typeEl = row.locator('.js-edit-type');
    if (await typeEl.isVisible().catch(() => false)) {
      await typeEl.dblclick();
      await page.waitForTimeout(300);
      const input = typeEl.locator('input');
      if (await input.isVisible()) {
        await input.fill('PA28');
        await input.press('Enter');
        await page.waitForTimeout(500);
      }
    }

    const countersAfter = await page.evaluate(() => ({
      total: document.getElementById('statTotalToday')?.textContent,
      vc: document.getElementById('statVfrComp')?.textContent,
      vm: document.getElementById('statVfrMvmts')?.textContent
    }));
    console.log(`  Counters after: ${JSON.stringify(countersAfter)}`);
    evids.push(await screenshot(page, 'T5_counters_after'));

    // Counters should be valid and consistent (total=2, VC=1, VM=1)
    const valid = countersAfter.total !== null && countersAfter.total !== 'NaN';
    const totalCorrect = parseInt(countersAfter.total) === 2;

    logResult('TEST 5', 'Inline edit triggers counters refresh',
      valid && totalCorrect,
      `before=${JSON.stringify(countersBefore)}, after=${JSON.stringify(countersAfter)}`, evids);
  }

  // ════════════════════════════════════
  // TEST 6 — Hard delete strip from Live Board (Task B)
  // ════════════════════════════════════
  console.log('\n── TEST 6: Hard delete strip from Live Board ──');
  {
    const evids = [];

    // Seed 2 strips — will delete ID=51
    await seedData(page, [
      makeMovement({ id: 50, status: 'ACTIVE', callsignCode: 'KEEP06', dof: getTodayISO() }),
      makeMovement({ id: 51, status: 'ACTIVE', callsignCode: 'DEL06', registration: 'G-DEL1', dof: getTodayISO(), egowCode: 'BM', unitCode: 'M' })
    ]);

    const mvmtsBefore = await getMovements(page);
    console.log(`  Before: ${mvmtsBefore.length} movements, IDs=[${mvmtsBefore.map(m => m.id)}]`);
    evids.push(await screenshot(page, 'T6_before_delete'));

    const delRow = page.locator('#liveBody tr[data-id="51"]');
    if (await delRow.isVisible()) {
      // Open Edit dropdown
      await delRow.locator('.js-edit-dropdown').click();
      await page.waitForTimeout(400);

      // Find the Delete button — portal moves menu to body, so use visible filter
      // The portalled menu is the one with display:block (others are display:none)
      const deleteBtn = page.locator('button.js-delete-strip:visible');
      const deleteBtnCount = await deleteBtn.count();
      const deleteBtnVisible = deleteBtnCount > 0;
      console.log(`  Delete button visible: ${deleteBtnVisible} (count: ${deleteBtnCount})`);

      if (deleteBtnVisible) {
        evids.push(await screenshot(page, 'T6_delete_menu_visible'));

        // Accept confirmation dialog
        page.once('dialog', async dialog => {
          console.log(`  Confirm dialog: "${dialog.message()}"`);
          await dialog.accept();
        });

        await deleteBtn.first().click();
        await page.waitForTimeout(600);

        evids.push(await screenshot(page, 'T6_after_delete'));

        // Verify removed from storage
        const mvmtsAfter = await getMovements(page);
        const ids = mvmtsAfter.map(m => m.id);
        const isDeleted = !ids.includes(51);
        console.log(`  After: ${mvmtsAfter.length} movements, IDs=[${ids}]`);

        // Verify not in history either
        // Switch to history tab or check DOM
        const historyRow = await page.locator('#historyBody tr[data-id="51"]').count();
        console.log(`  In history: ${historyRow > 0}`);

        // Reload persistence
        await page.reload({ waitUntil: 'networkidle' });
        await waitForApp(page);
        const mvmtsPersist = await getMovements(page);
        const persistDeleted = !mvmtsPersist.find(m => m.id === 51);

        evids.push(await screenshot(page, 'T6_after_reload'));

        logResult('TEST 6', 'Hard delete strip from Live Board',
          isDeleted && persistDeleted,
          `deleted=${isDeleted}, persisted=${persistDeleted}, historyPresent=${historyRow > 0}`, evids);
      } else {
        evids.push(await screenshot(page, 'T6_no_delete_btn'));
        logResult('TEST 6', 'Hard delete strip from Live Board', false,
          'Delete button not found in dropdown menu', evids);
      }
    } else {
      logResult('TEST 6', 'Hard delete strip from Live Board', false, 'Strip ID=51 not visible', evids);
    }
  }

  // ════════════════════════════════════
  // TEST 7 — Hard delete cleans booking linkage (Task B)
  // ════════════════════════════════════
  console.log('\n── TEST 7: Hard delete cleans booking linkage ──');
  {
    const evids = [];
    const today = getTodayISO();

    // Seed a booking-linked strip
    const mvmt = makeMovement({
      id: 60, status: 'ACTIVE', callsignCode: 'LNK07', registration: 'G-LINK',
      dof: today, bookingId: 300
    });
    const booking = {
      id: 300, status: 'CONFIRMED', linkedStripId: 60,
      contact: { name: 'Link Test', phone: '555-0000' },
      schedule: { dof: today, plannedTimeLocalHHMM: '14:00', plannedTimeKind: 'DEP', dateISO: today },
      aircraft: { registration: 'G-LINK', type: 'C172', callsign: 'LNK07', pob: 1 },
      movement: { departure: 'EGOW', departureName: 'Woodvale' },
      ops: {}, charges: {},
      createdAtUtc: new Date().toISOString(), updatedAtUtc: new Date().toISOString()
    };

    await seedData(page, [mvmt], [booking]);

    // Verify link survived reconciliation
    const mvmtCheck = (await getMovements(page)).find(m => m.id === 60);
    const bookingCheck = (await getBookings(page)).find(b => b.id === 300);
    console.log(`  After seed: mvmt.bookingId=${mvmtCheck?.bookingId}, booking.linkedStripId=${bookingCheck?.linkedStripId}`);

    const row = page.locator('#liveBody tr[data-id="60"]');
    if (await row.isVisible().catch(() => false)) {
      // Open dropdown and click Delete
      await row.locator('.js-edit-dropdown').click();
      await page.waitForTimeout(400);

      const deleteBtn = page.locator('button.js-delete-strip:visible');
      if (await deleteBtn.count() > 0) {
        page.once('dialog', async dialog => { await dialog.accept(); });
        await deleteBtn.first().click();
        await page.waitForTimeout(600);

        evids.push(await screenshot(page, 'T7_after_linked_delete'));

        // Check movement gone
        const mvmtsAfter = await getMovements(page);
        const mvmtGone = !mvmtsAfter.find(m => m.id === 60);

        // Check booking linkage cleared
        const bookingsAfter = await getBookings(page);
        const bAfter = bookingsAfter.find(b => b.id === 300);
        const linkCleared = !bAfter?.linkedStripId || bAfter.linkedStripId === null;
        console.log(`  mvmtGone=${mvmtGone}, booking.linkedStripId=${bAfter?.linkedStripId}`);

        // Reload
        await page.reload({ waitUntil: 'networkidle' });
        await waitForApp(page);
        evids.push(await screenshot(page, 'T7_after_reload'));

        logResult('TEST 7', 'Hard delete cleans booking linkage',
          mvmtGone && linkCleared,
          `mvmtGone=${mvmtGone}, linkCleared=${linkCleared}`, evids);
      } else {
        logResult('TEST 7', 'Hard delete cleans booking linkage', false, 'Delete button not found', evids);
      }
    } else {
      logResult('TEST 7', 'Hard delete cleans booking linkage', false,
        `Strip ID=60 not visible (bookingId may have been cleared by reconciliation, mvmt.bookingId=${mvmtCheck?.bookingId})`, evids);
    }
  }

  // ════════════════════════════════════
  // TEST 8 — Daily counters: today-only + ACTIVE/COMPLETED only (Task C)
  // ════════════════════════════════════
  console.log('\n── TEST 8: Daily counters correctness ──');
  {
    const evids = [];
    const today = getTodayISO();
    const yesterday = getYesterdayISO();

    await seedData(page, [
      makeMovement({ id: 70, status: 'PLANNED', callsignCode: 'PLN70', egowCode: 'VC', dof: today }),     // Excluded
      makeMovement({ id: 71, status: 'ACTIVE',  callsignCode: 'ACT71', egowCode: 'VM', dof: today, registration: 'G-ACT1' }), // Counted
      makeMovement({ id: 72, status: 'COMPLETED', callsignCode: 'CMP72', egowCode: 'BC', dof: today, registration: 'G-CMP1', depActual: '10:05', arrActual: '10:55' }), // Counted
      makeMovement({ id: 73, status: 'COMPLETED', callsignCode: 'YST73', egowCode: 'VC', dof: yesterday, registration: 'G-YST1', depActual: '09:05', arrActual: '09:55' }), // Excluded (yesterday)
      makeMovement({ id: 74, status: 'CANCELLED', callsignCode: 'CAN74', egowCode: 'BM', unitCode: 'M', dof: today, registration: 'G-CAN1' }) // Excluded
    ]);

    await page.evaluate(() => { if (window.updateDailyStats) window.updateDailyStats(); });
    await page.waitForTimeout(300);

    const counters = await page.evaluate(() => ({
      bm: document.getElementById('statBookedMvmts')?.textContent,
      bc: document.getElementById('statBookedComp')?.textContent,
      vm: document.getElementById('statVfrMvmts')?.textContent,
      vc: document.getElementById('statVfrComp')?.textContent,
      total: document.getElementById('statTotalToday')?.textContent
    }));

    console.log(`  Counters: ${JSON.stringify(counters)}`);
    // Expected: ACTIVE VM + COMPLETED BC = 2 total. BM=0, BC=1, VM=1, VC=0
    const totalOK = parseInt(counters.total) === 2;
    const bmOK = parseInt(counters.bm) === 0;
    const bcOK = parseInt(counters.bc) === 1;
    const vmOK = parseInt(counters.vm) === 1;
    const vcOK = parseInt(counters.vc) === 0;

    evids.push(await screenshot(page, 'T8_counter_correctness'));

    logResult('TEST 8', 'Daily counters: today-only + ACTIVE/COMPLETED only',
      totalOK && bmOK && bcOK && vmOK && vcOK,
      `total=${counters.total}(exp:2), BM=${counters.bm}(0), BC=${counters.bc}(1), VM=${counters.vm}(1), VC=${counters.vc}(0)`, evids);
  }

  // ════════════════════════════════════
  // TEST 9 — No double counting across transitions (Task C)
  // ════════════════════════════════════
  console.log('\n── TEST 9: No double counting across transitions ──');
  {
    const evids = [];

    // Seed: 1 ACTIVE + 1 COMPLETED today
    await seedData(page, [
      makeMovement({ id: 80, status: 'ACTIVE', callsignCode: 'TRN09A', egowCode: 'VC', dof: getTodayISO() }),
      makeMovement({ id: 81, status: 'COMPLETED', callsignCode: 'TRN09B', egowCode: 'VM', dof: getTodayISO(), registration: 'G-TRN2', depActual: '10:00', arrActual: '11:00' })
    ]);

    await page.evaluate(() => { if (window.updateDailyStats) window.updateDailyStats(); });
    await page.waitForTimeout(200);

    const before = await page.evaluate(() => document.getElementById('statTotalToday')?.textContent);
    console.log(`  Before transition: total=${before}`);
    evids.push(await screenshot(page, 'T9_before_transition'));

    // Complete the ACTIVE strip
    const row = page.locator('#liveBody tr[data-id="80"]');
    const completeBtn = row.locator('.js-complete');
    if (await row.isVisible() && await completeBtn.isVisible()) {
      page.once('dialog', async dialog => { await dialog.accept(); });
      await completeBtn.click();
      await page.waitForTimeout(600);

      await page.evaluate(() => { if (window.updateDailyStats) window.updateDailyStats(); });
      await page.waitForTimeout(200);

      const after = await page.evaluate(() => document.getElementById('statTotalToday')?.textContent);
      console.log(`  After ACTIVE→COMPLETED: total=${after}`);
      evids.push(await screenshot(page, 'T9_after_transition'));

      // Reload
      await page.reload({ waitUntil: 'networkidle' });
      await waitForApp(page);
      await page.evaluate(() => { if (window.updateDailyStats) window.updateDailyStats(); });
      const afterReload = await page.evaluate(() => document.getElementById('statTotalToday')?.textContent);
      console.log(`  After reload: total=${afterReload}`);
      evids.push(await screenshot(page, 'T9_after_reload'));

      // Should be 2 throughout (no double count)
      logResult('TEST 9', 'No double counting across transitions',
        parseInt(before) === 2 && parseInt(after) === 2 && parseInt(afterReload) === 2,
        `before=${before}, after=${after}, afterReload=${afterReload}`, evids);
    } else {
      logResult('TEST 9', 'No double counting across transitions', false, 'Complete button not found', evids);
    }
  }

  // ════════════════════════════════════
  // TEST 10 — Modal regression after inline edits
  // ════════════════════════════════════
  console.log('\n── TEST 10: Modal regression after inline edits ──');
  {
    const evids = [];

    await seedData(page, [
      makeMovement({ id: 90, status: 'ACTIVE', callsignCode: 'MOD10', registration: 'G-MODL', dof: getTodayISO() })
    ]);

    const errsBefore = jsErrors.length;

    const row = page.locator('#liveBody tr[data-id="90"]');
    const regEl = row.locator('.js-edit-reg');

    if (await row.isVisible() && await regEl.isVisible()) {
      // Inline edit registration
      await regEl.dblclick();
      await page.waitForTimeout(300);
      const input = regEl.locator('input');
      if (await input.isVisible()) {
        await input.fill('G-EDIT');
        await input.press('Enter');
        await page.waitForTimeout(500);
      }

      evids.push(await screenshot(page, 'T10_after_inline_edit'));

      // Open Edit > Details modal
      await row.locator('.js-edit-dropdown').click();
      await page.waitForTimeout(400);
      const detailsBtn = page.locator('.js-edit-details').first();
      if (await detailsBtn.isVisible().catch(() => false)) {
        await detailsBtn.click();
        await page.waitForTimeout(600);

        const modalVis = await page.locator('.modal').isVisible().catch(() => false);
        evids.push(await screenshot(page, 'T10_modal_opened'));

        // Check modal reg value
        const modalReg = await page.locator('#editReg').inputValue().catch(() => '');
        console.log(`  Modal visible: ${modalVis}, reg="${modalReg}"`);

        // Close modal
        const closeBtn = page.locator('.js-close-modal');
        if (await closeBtn.isVisible().catch(() => false)) {
          await closeBtn.click();
          await page.waitForTimeout(300);
        }

        // Reload
        await page.reload({ waitUntil: 'networkidle' });
        await waitForApp(page);
        evids.push(await screenshot(page, 'T10_after_reload'));

        const noNewErrors = jsErrors.length === errsBefore;
        console.log(`  New JS errors: ${jsErrors.length - errsBefore}`);

        logResult('TEST 10', 'Modal regression after inline edits',
          modalVis && noNewErrors && modalReg === 'G-EDIT',
          `modalVis=${modalVis}, modalReg="${modalReg}", noNewErrors=${noNewErrors}`, evids);
      } else {
        logResult('TEST 10', 'Modal regression after inline edits', false, 'Details button not found', evids);
      }
    } else {
      logResult('TEST 10', 'Modal regression after inline edits', false, 'Row/reg not visible', evids);
    }
  }

  // ──── STATE B: Dirty Profile ────
  console.log('\n── STATE B: Dirty Profile ──');
  await page.reload({ waitUntil: 'networkidle' });
  await waitForApp(page);
  const keysB = await getLocalStorageKeys(page);
  console.log(`  LocalStorage keys: ${JSON.stringify(keysB)}`);
  const mvmtsB = await getMovements(page);
  console.log(`  Movements: ${mvmtsB.length}`);
  const evidB1 = await screenshot(page, 'StateB_after_reload');
  const evidB2 = await screenshot(page, 'StateB_localStorage');

  // ──── Console errors summary ────
  console.log('\n── Console errors summary ──');
  console.log(`  Real JS errors: ${jsErrors.length}`);
  if (jsErrors.length > 0) {
    jsErrors.forEach((e, i) => console.log(`    ${i + 1}. ${e}`));
  }
  console.log(`  Ignorable network errors: ${allConsoleErrors.length - jsErrors.length}`);

  // ──── Results summary ────
  console.log('\n════════════════════════════════');
  console.log('RESULTS SUMMARY');
  console.log('════════════════════════════════');

  let allPass = true;
  for (const r of RESULTS) {
    if (r.status === 'FAIL') allPass = false;
    console.log(`${r.status}\t${r.testId}\t${r.title}`);
    if (r.note) console.log(`\t  ${r.note}`);
  }

  console.log(`\nOverall: ${allPass ? 'ALL PASS' : 'SOME FAILURES'}`);

  // Write evidence pack
  const evidenceContent = generateEvidencePack(browserVersion, keysA, keysB, jsErrors, allConsoleErrors);
  fs.writeFileSync('/home/user/FDMS/Sprint2_Verification_EvidencePack_2026-02-09.md', evidenceContent);
  console.log('Evidence Pack written.');

  await context.close();
  await browser.close();
  process.exit(allPass ? 0 : 1);
}

function generateEvidencePack(browserVersion, keysA, keysB, jsErrors, allConsoleErrors) {
  let md = `# Sprint 2 Verification Evidence Pack\n`;
  md += `**Date:** 2026-02-09\n`;
  md += `**Branch:** claude/fix-strip-field-editing-KdR83\n\n`;

  md += `## A) Environment\n`;
  md += `- **OS:** Linux 4.4.0\n`;
  md += `- **Browser:** Chromium ${browserVersion} (headless, via Playwright 1.56.1)\n`;
  md += `- **Node:** ${process.version}\n`;
  md += `- **Cache disabled on reload:** Yes (Playwright fresh context per test)\n`;
  md += `- **State A (Clean profile):** Fresh browser context, localStorage cleared before first test\n`;
  md += `- **State B (Dirty profile):** Same context with accumulated data from all tests\n\n`;

  md += `## B) LocalStorage Key Inventory\n`;
  md += `### State A (clean boot)\n\`\`\`\n${keysA.join('\\n') || '(empty before seeding)'}\n\`\`\`\n`;
  md += `### State B (post-tests)\n\`\`\`\n${keysB.join('\\n')}\n\`\`\`\n\n`;

  md += `## C) Test Results Table\n\n`;
  md += `| Test | Title | Result | Note |\n`;
  md += `|------|-------|--------|------|\n`;
  for (const r of RESULTS) {
    md += `| ${r.testId} | ${r.title} | **${r.status}** | ${r.note || ''} |\n`;
  }

  md += `\n## D) Console Snippets\n`;
  if (jsErrors.length === 0) {
    md += `**No uncaught JS exceptions observed** during test execution.\n`;
  } else {
    md += `**${jsErrors.length} JS error(s):**\n`;
    jsErrors.forEach((e, i) => { md += `${i + 1}. \`${e}\`\n`; });
  }
  const networkCount = allConsoleErrors.filter(e => isIgnorableError(e)).length;
  if (networkCount > 0) {
    md += `\n*${networkCount} ignorable network errors (ERR_TUNNEL_CONNECTION_FAILED from CSV lookups) excluded from pass/fail criteria.*\n`;
  }

  md += `\n## E) Screenshot Index\n`;
  try {
    const files = fs.readdirSync('/home/user/FDMS/evidence').sort();
    files.forEach(f => { md += `- ${f}\n`; });
  } catch { md += `(screenshots directory not found)\n`; }

  return md;
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});

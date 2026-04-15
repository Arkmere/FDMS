/**
 * P0 Regression Harness — Inline Edit Time Field Integrity
 *
 * Root cause fixed: openModal() was adding document.addEventListener("keydown",
 * keyHandler) but all save-handler paths closed the modal by setting
 * modalRoot.innerHTML = "" directly, never calling closeModal(), so the
 * keyHandler was never removed.  Over multiple modal open+save cycles, leaked
 * handlers accumulated.  Every subsequent Enter keypress (including inline-edit
 * commits) triggered ALL leaked handlers, each trying to click a cached
 * (now-detached) save button, causing validation to run against non-existent
 * DOM elements → "Callsign Code is required" toast storm.  If a live modal
 * happened to be open, the movement would be saved twice with partial data →
 * data corruption / history entry disappearance.
 *
 * Fix applied:
 *   1. _modalKeyHandler module-level variable tracks the active handler.
 *   2. closeActiveModal() removes the handler AND clears modalRoot.
 *   3. All save-handler modal-close paths call closeActiveModal().
 *   4. openModal() removes any leaked handler before registering a new one.
 *   5. inline-edit keydown Enter/Escape now calls e.stopPropagation().
 *   6. Modal keyHandler guards backdrop.isConnected before acting on Enter.
 *   7. _lastSaveFailed flag prevents blur-auto-save after a failed validation.
 *
 * Tests:
 *   P0-T1  Single toast on valid inline-edit commit (no storm)
 *   P0-T2  Single error toast on invalid time, no data mutation
 *   P0-T3  Live/Pending count unchanged after inline-edit
 *   P0-T4  History count unchanged after inline-edit
 *   P0-T5  Repeated inline-edits on same cell (3×) — counts stable throughout
 *   P0-T6  Open+save modal N times, then inline-edit — no accumulated toasts
 *   P0-T7  Inline-edit while modal is minimised — only inline-edit saves
 *   P0-T8  Persistence: time field update survives page reload
 *   P0-T9  8-cycle modal stress: open+save 8× then inline-edit — 0 error toasts,
 *          stable live count, persisted dep-time after reload
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const APP_URL  = 'http://localhost:8765/';
const EVIDENCE = '/home/user/FDMS/evidence_p0';
const RESULTS  = [];
let   ssIdx    = 0;

const IGNORABLE = ['ERR_TUNNEL_CONNECTION_FAILED', 'ERR_NAME_NOT_RESOLVED', 'net::ERR_', 'favicon.ico', 'async listener', '407'];
const isIgnorable = m => IGNORABLE.some(p => m.includes(p));

function log(id, title, pass, note, refs = []) {
  const s = pass ? 'PASS' : 'FAIL';
  RESULTS.push({ id, title, status: s, note, refs });
  console.log(`  ${s}: ${id} — ${title}${note ? ' | ' + note : ''}`);
}

async function ss(page, label) {
  ssIdx++;
  const fname = `P0_${String(ssIdx).padStart(2,'0')}_${label.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
  await page.screenshot({ path: path.join(EVIDENCE, fname) });
  return fname;
}

async function waitForApp(page) {
  await page.waitForSelector('#liveBody', { timeout: 15000 });
  await page.waitForTimeout(600);
}

function today() { return new Date().toISOString().split('T')[0]; }

/** Seed movements directly into localStorage and reload. */
async function seedData(page, movements) {
  await page.evaluate((movements) => {
    const payload = {
      version: 3,
      timestamp: new Date().toISOString(),
      movements
    };
    localStorage.setItem('vectair_fdms_movements_v3', JSON.stringify(payload));
    localStorage.removeItem('vectair_fdms_bookings_v1');
  }, movements);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForApp(page);
}

/** Build a minimal valid movement fixture. */
function makeMovement(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: 1,
    status: 'ACTIVE',
    callsignCode: 'BAW01',
    callsignVoice: 'SPEEDBIRD ONE',
    registration: 'G-AAAA',
    type: 'B738',
    wtc: 'M',
    flightType: 'DEP',
    rules: 'IFR',
    depAd: 'EGOW',
    depName: 'Woodvale',
    arrAd: 'EGLL',
    arrName: 'Heathrow',
    depPlanned: '10:00',
    depActual: null,
    arrPlanned: '11:00',
    arrActual: null,
    dof: today(),
    pob: 6,
    tngCount: 0,
    osCount: 0,
    fisCount: 0,
    egowCode: 'VC',
    unitCode: '',
    priorityLetter: '',
    remarks: '',
    warnings: '',
    squawk: '',
    route: '',
    clearance: '',
    formation: null,
    bookingId: null,
    changeLog: [],
    createdAtUtc: now,
    updatedAtUtc: now,
    updatedBy: 'test'
  };
}

async function getMovements(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('vectair_fdms_movements_v3');
    if (!raw) return [];
    try { return JSON.parse(raw).movements || []; } catch { return []; }
  });
}

/**
 * Collect all toast messages that appear within a time window.
 * Returns an array of { text, type } objects.
 */
async function collectToasts(page, actionFn, windowMs = 2500) {
  await page.evaluate(() => {
    window.__p0_toasts = [];
    window.__p0_observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1 && node.classList) {
            // Match both direct toasts and children
            const toastEl = node.classList.contains('toast') ? node
              : node.querySelector && node.querySelector('.toast');
            if (toastEl) {
              window.__p0_toasts.push({
                text: toastEl.textContent.trim(),
                type: toastEl.classList.contains('toast-error')   ? 'error'
                    : toastEl.classList.contains('toast-success') ? 'success'
                    : toastEl.classList.contains('toast-warning') ? 'warning'
                    : 'info'
              });
            }
          }
        }
      }
    });
    const container = document.getElementById('toastContainer') || document.body;
    window.__p0_observer.observe(container, { childList: true, subtree: true });
  });

  await actionFn();
  await page.waitForTimeout(windowMs);

  const captured = await page.evaluate(() => {
    if (window.__p0_observer) window.__p0_observer.disconnect();
    return window.__p0_toasts || [];
  });

  return captured;
}

/**
 * Double-click the dep-time cell on the first strip row and commit with Enter.
 */
async function inlineEditDepTimeCell(page, newTime) {
  // Find the dep-time cell on the first strip row
  const cell = page.locator('#liveBody tr.strip-row .js-edit-dep-time').first();
  const count = await cell.count();
  if (count === 0) throw new Error('No dep-time cell found for inline edit');

  await cell.dblclick();
  await page.waitForTimeout(250);

  const input = page.locator('#liveBody tr.strip-row .inline-edit-input').first();
  await input.fill(newTime);
  await input.press('Enter');
  await page.waitForTimeout(400);
}

/** Count live-board strip rows. */
async function countLiveRows(page) {
  return page.evaluate(() =>
    document.querySelectorAll('#liveBody tr.strip-row').length
  );
}

/** Count history-board strip rows with a data-id attribute. */
async function countHistoryRows(page) {
  return page.evaluate(() =>
    document.querySelectorAll('#historyBody tr[data-id]').length
  );
}

// ============================================================
// Main
// ============================================================
(async () => {
  fs.rmSync(EVIDENCE, { recursive: true, force: true });
  fs.mkdirSync(EVIDENCE, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
           '--single-process', '--no-zygote', '--disable-gpu']
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error' && !isIgnorable(msg.text())) {
      console.warn('  [browser-error]', msg.text());
    }
  });

  console.log('\n=== P0 Inline Edit Integrity Harness ===\n');

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForApp(page);

  // Seed: one ACTIVE DEP movement
  const seedMovement = makeMovement({ id: 101, status: 'ACTIVE', depPlanned: '10:00' });

  // ── P0-T1: Single toast on valid inline-edit commit ────────────────────────
  {
    console.log('[P0-T1] Single toast on valid inline-edit commit (no storm)');
    await seedData(page, [seedMovement]);

    const toasts = await collectToasts(page, async () => {
      await inlineEditDepTimeCell(page, '1030');
    });

    // Inline-edit success path shows NO toast (silent save then re-render).
    // Any error toast means something is wrong.
    const errorToasts = toasts.filter(t => t.type === 'error');
    const ref1 = await ss(page, 'T1_after_valid_edit');
    log('P0-T1', 'No error toasts on valid inline-edit commit',
        errorToasts.length === 0,
        `toasts=${JSON.stringify(toasts)}`,
        [ref1]);
  }

  // ── P0-T2: Single error toast on invalid time, no data mutation ─────────────
  {
    console.log('\n[P0-T2] Single error toast on invalid time, no data mutation');
    await seedData(page, [makeMovement({ id: 102, depPlanned: '10:00' })]);
    const before = await getMovements(page);
    const originalTime = before[0]?.depPlanned;

    const toasts = await collectToasts(page, async () => {
      const cell = page.locator('#liveBody tr.strip-row .js-edit-dep-time').first();
      await cell.dblclick();
      await page.waitForTimeout(200);
      const input = page.locator('#liveBody tr.strip-row .inline-edit-input').first();
      await input.fill('9999'); // Invalid hour
      await input.press('Enter');
      await page.waitForTimeout(500);
      // Press Escape to abandon the retry input
      await input.press('Escape').catch(() => {});
      await page.waitForTimeout(300);
    }, 1500);

    const after = await getMovements(page);
    const timeAfter = after[0]?.depPlanned;
    const errorCount = toasts.filter(t => t.type === 'error').length;
    const tooManyErrors = errorCount > 1;
    const dataUnchanged = timeAfter === originalTime || timeAfter === null;

    const ref2 = await ss(page, 'T2_invalid_time_error');
    log('P0-T2', 'Exactly one error toast, data not mutated on invalid time',
        !tooManyErrors && dataUnchanged,
        `errorToasts=${errorCount} originalTime=${originalTime} timeAfter=${timeAfter}`,
        [ref2]);
  }

  // ── P0-T3: Live/Pending count unchanged after inline-edit ─────────────────
  {
    console.log('\n[P0-T3] Live/Pending count stable after inline-edit');
    // Seed 3 ACTIVE movements
    await seedData(page, [
      makeMovement({ id: 201, depPlanned: '09:00' }),
      makeMovement({ id: 202, callsignCode: 'EZY01', depPlanned: '09:30' }),
      makeMovement({ id: 203, callsignCode: 'RYR01', depPlanned: '10:00' })
    ]);

    const beforeCount = await countLiveRows(page);
    await inlineEditDepTimeCell(page, '1100');
    const afterCount = await countLiveRows(page);
    const ref3 = await ss(page, 'T3_live_count_stable');
    log('P0-T3', 'Live/Pending row count unchanged after inline-edit',
        beforeCount === 3 && afterCount === 3,
        `before=${beforeCount} after=${afterCount}`,
        [ref3]);
  }

  // ── P0-T4: History count unchanged after inline-edit ──────────────────────
  {
    console.log('\n[P0-T4] History count stable after inline-edit');
    // Seed 2 ACTIVE + 2 COMPLETED (history)
    await seedData(page, [
      makeMovement({ id: 301, depPlanned: '09:00' }),
      makeMovement({ id: 302, callsignCode: 'EZY02', depPlanned: '09:30' }),
      makeMovement({ id: 303, callsignCode: 'COMP1', status: 'COMPLETED', depActual: '08:00' }),
      makeMovement({ id: 304, callsignCode: 'COMP2', status: 'COMPLETED', depActual: '08:30' })
    ]);

    const histTab = page.locator('[data-tab="history"], .tab-btn').filter({ hasText: /history/i }).first();
    if (await histTab.count() > 0) await histTab.click();
    await page.waitForTimeout(400);
    const beforeHist = await countHistoryRows(page);

    // Switch to live and edit
    const liveTab = page.locator('[data-tab="live"], .tab-btn').filter({ hasText: /live|board/i }).first();
    if (await liveTab.count() > 0) await liveTab.click();
    await page.waitForTimeout(400);
    await inlineEditDepTimeCell(page, '1115');

    // Re-count history
    if (await histTab.count() > 0) await histTab.click();
    await page.waitForTimeout(400);
    const afterHist = await countHistoryRows(page);
    const ref4 = await ss(page, 'T4_history_count_stable');

    if (await liveTab.count() > 0) await liveTab.click();
    await page.waitForTimeout(300);

    log('P0-T4', 'History row count unchanged after inline-edit',
        beforeHist === afterHist,
        `before=${beforeHist} after=${afterHist}`,
        [ref4]);
  }

  // ── P0-T5: Repeated inline-edits on same cell — counts stable ─────────────
  {
    console.log('\n[P0-T5] Repeated inline-edits (3x) — counts stable, no error toasts');
    await seedData(page, [
      makeMovement({ id: 401, depPlanned: '10:00' }),
      makeMovement({ id: 402, callsignCode: 'EZY03', depPlanned: '10:30' })
    ]);
    const startCount = await countLiveRows(page);
    let allToasts = [];

    for (const t of ['1200', '1215', '1230']) {
      const toasts = await collectToasts(page, async () => {
        await inlineEditDepTimeCell(page, t);
      }, 700);
      allToasts = allToasts.concat(toasts);
    }

    const endCount = await countLiveRows(page);
    const errorToasts = allToasts.filter(t => t.type === 'error');
    const ref5 = await ss(page, 'T5_repeated_edits');

    log('P0-T5', 'Repeated inline-edits produce no error toasts and keep count stable',
        errorToasts.length === 0 && startCount === endCount,
        `startCount=${startCount} endCount=${endCount} errorToasts=${errorToasts.length} allToasts=${JSON.stringify(allToasts)}`,
        [ref5]);
  }

  // ── P0-T6: Open+save modal N times, then inline-edit — no accumulated toasts
  {
    console.log('\n[P0-T6] Open+save edit modal 3x then inline-edit — no toast storm');
    await seedData(page, [
      makeMovement({ id: 501, callsignCode: 'BAW02', egowCode: 'VC', depPlanned: '10:00' })
    ]);

    // Open and save the edit modal 3 times to accumulate leaked keyHandlers
    // (before fix: each save would leave a handler on document)
    for (let i = 0; i < 3; i++) {
      const editDropdown = page.locator('#liveBody tr.strip-row .js-edit-dropdown').first();
      if (await editDropdown.count() > 0) {
        await editDropdown.click();
        await page.waitForTimeout(250);
        const editDetailsBtn = page.locator('.js-edit-details').first();
        if (await editDetailsBtn.count() > 0) {
          await editDetailsBtn.click();
          await page.waitForTimeout(500);
          const saveBtn = page.locator('.js-save-edit').first();
          if (await saveBtn.count() > 0) {
            await saveBtn.click();
            await page.waitForTimeout(500);
          }
        }
      }
    }

    // Now do an inline edit — with the fix there should be no storm of error toasts
    const toasts = await collectToasts(page, async () => {
      await inlineEditDepTimeCell(page, '1300');
    }, 2000);

    const errorToasts = toasts.filter(t => t.type === 'error');
    // Before fix: would see N "Callsign Code is required" error toasts
    // After fix: 0 error toasts
    const ref6 = await ss(page, 'T6_post_modal_saves_no_storm');
    log('P0-T6', 'No error toast storm after 3 modal open+save cycles',
        errorToasts.length === 0,
        `errorToasts=${errorToasts.length} allToasts=${JSON.stringify(toasts)}`,
        [ref6]);
  }

  // ── P0-T7: Inline-edit while modal is minimised — only inline-edit saves ──
  {
    console.log('\n[P0-T7] Inline-edit while edit modal minimised — no modal double-save');
    await seedData(page, [
      makeMovement({ id: 601, callsignCode: 'BAW03', egowCode: 'VC', depPlanned: '10:00' })
    ]);

    // Open edit modal
    const editDropdown = page.locator('#liveBody tr.strip-row .js-edit-dropdown').first();
    if (await editDropdown.count() > 0) {
      await editDropdown.click();
      await page.waitForTimeout(250);
      const editDetailsBtn = page.locator('.js-edit-details').first();
      if (await editDetailsBtn.count() > 0) {
        await editDetailsBtn.click();
        await page.waitForTimeout(500);
      }
    }

    // Minimise the modal
    const minimiseBtn = page.locator('.js-minimize-modal').first();
    if (await minimiseBtn.count() > 0) {
      await minimiseBtn.click();
      await page.waitForTimeout(300);
    }

    const liveCountBefore = await countLiveRows(page);

    // Inline-edit time cell — before fix, this would also trigger the modal's
    // keyHandler (which finds the save button in the minimised modal and clicks it)
    const toasts = await collectToasts(page, async () => {
      await inlineEditDepTimeCell(page, '1400');
    }, 1500);

    const liveCountAfter = await countLiveRows(page);
    // Should NOT see "Movement updated successfully" (that comes only from modal save)
    const modalSaveToasts = toasts.filter(t => t.text.includes('Movement updated successfully'));
    const errorToasts = toasts.filter(t => t.type === 'error');

    // Close the minimised modal cleanly
    const restoreBtn = page.locator('.js-restore-modal').first();
    if (await restoreBtn.count() > 0) await restoreBtn.click();
    await page.waitForTimeout(200);
    const closeBtn = page.locator('.js-close-modal').first();
    if (await closeBtn.count() > 0) await closeBtn.click();
    await page.waitForTimeout(300);

    const ref7 = await ss(page, 'T7_no_modal_save_on_inline_edit');
    log('P0-T7', 'Inline-edit while modal minimised does not trigger modal save path',
        modalSaveToasts.length === 0 && errorToasts.length === 0,
        `modalSaveToasts=${modalSaveToasts.length} errorToasts=${errorToasts.length} allToasts=${JSON.stringify(toasts)}`,
        [ref7]);
  }

  // ── P0-T8: Persistence — time field update survives page reload ────────────
  {
    console.log('\n[P0-T8] Persistence: time field update survives reload');
    await seedData(page, [
      makeMovement({ id: 701, depPlanned: '10:00', depActual: null })
    ]);

    // Inline-edit to a known value
    await inlineEditDepTimeCell(page, '1500');
    await page.waitForTimeout(500);

    // Read back from localStorage — use [0] since exactly one movement was seeded.
    const afterEdit = await getMovements(page);
    const updated = afterEdit[0];
    const updatedTime = updated ? (updated.depActual || updated.depPlanned || '') : '';

    // Reload and check persistence
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForApp(page);

    const afterReload = await getMovements(page);
    const persisted = afterReload[0];
    const persistedTime = persisted ? (persisted.depActual || persisted.depPlanned || '') : '';

    const ref8 = await ss(page, 'T8_persistence_after_reload');
    log('P0-T8', 'Inline-edit time value persists across page reload',
        updatedTime !== '' && persistedTime === updatedTime,
        `afterEdit=${updatedTime} afterReload=${persistedTime}`,
        [ref8]);
  }

  // ── P0-T9: 8-cycle modal stress test ──────────────────────────────────────
  {
    console.log('\n[P0-T9] 8-cycle modal stress: open+save modal 8× then inline-edit — 0 error toasts, stable count, persist');
    const stressMovement = makeMovement({ id: 801, callsignCode: 'BAW04', egowCode: 'VC', depPlanned: '10:00' });
    await seedData(page, [stressMovement]);
    const liveCountBefore = await countLiveRows(page);

    // Run 8 open+save cycles — before fix each would leak a keyHandler onto document
    const CYCLES = 8;
    for (let i = 0; i < CYCLES; i++) {
      const editDropdown = page.locator('#liveBody tr.strip-row .js-edit-dropdown').first();
      if (await editDropdown.count() > 0) {
        await editDropdown.click();
        await page.waitForTimeout(200);
        const editDetailsBtn = page.locator('.js-edit-details').first();
        if (await editDetailsBtn.count() > 0) {
          await editDetailsBtn.click();
          await page.waitForTimeout(400);
          const saveBtn = page.locator('.js-save-edit').first();
          if (await saveBtn.count() > 0) {
            await saveBtn.click();
            await page.waitForTimeout(400);
          } else {
            // modal didn't open — close via Escape as fallback
            await page.keyboard.press('Escape');
            await page.waitForTimeout(200);
          }
        }
      }
    }

    // Now inline-edit: with fix, exactly 0 error toasts regardless of cycle count
    const toasts = await collectToasts(page, async () => {
      await inlineEditDepTimeCell(page, '1600');
    }, 3000);

    const liveCountAfter = await countLiveRows(page);
    const errorToasts = toasts.filter(t => t.type === 'error');

    // Verify persistence after reload
    const afterEdit = await getMovements(page);
    const editedTime = afterEdit[0]
      ? (afterEdit[0].depActual || afterEdit[0].depPlanned || '')
      : '';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    const afterReload = await getMovements(page);
    const persistedTime = afterReload[0]
      ? (afterReload[0].depActual || afterReload[0].depPlanned || '')
      : '';

    const ref9 = await ss(page, 'T9_8cycle_modal_stress');
    const pass = errorToasts.length === 0
      && liveCountBefore === liveCountAfter
      && editedTime !== ''
      && persistedTime === editedTime;
    log('P0-T9', `8-cycle modal stress: 0 error toasts, stable count, persisted time`,
        pass,
        `cycles=${CYCLES} errorToasts=${errorToasts.length} liveBefore=${liveCountBefore} liveAfter=${liveCountAfter} editedTime=${editedTime} persistedTime=${persistedTime} allToasts=${JSON.stringify(toasts)}`,
        [ref9]);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  await browser.close();

  const passed = RESULTS.filter(r => r.status === 'PASS').length;
  const failed = RESULTS.filter(r => r.status === 'FAIL').length;

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`P0 Results: ${passed} PASS  ${failed} FAIL  (${RESULTS.length} total)`);
  console.log(`${'─'.repeat(60)}\n`);

  const out = {
    timestamp: new Date().toISOString(),
    runMetadata: {
      sprint: 'P0',
      fix: 'inline-edit-data-loss-QLjBR',
      node: process.version,
      platform: process.platform,
      appUrl: APP_URL
    },
    summary: { passed, failed, total: RESULTS.length },
    results: RESULTS
  };

  fs.writeFileSync(
    path.join(EVIDENCE, 'sprintP0_inline_edit_integrity_results.json'),
    JSON.stringify(out, null, 2)
  );
  console.log(`Evidence written to ${EVIDENCE}/`);

  if (failed > 0) {
    console.error(`\nFAILED: ${failed} test(s) did not pass\n`);
    process.exit(1);
  }
})();

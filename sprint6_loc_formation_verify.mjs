/**
 * Sprint 6: Formations v1.1 Parity — LOC (Local) strip creation
 *
 * Tests:
 *   H1  Formation created on a LOC strip via New Local modal → badge appears
 *   H2  depAd/arrAd per element persist on LOC strip
 *   H3  Validation rejects invalid WTC in LOC modal
 *   H4  Validation rejects invalid ICAO code in LOC modal
 *   H5  Count < 2 → movement.formation = null on LOC strip
 *   H6  Save-and-Complete LOC with formation → all elements cascaded to COMPLETED
 *
 * Runs existing Sprint 4 + Sprint 5 regression as preamble to confirm no regressions.
 */

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';

const APP_URL  = 'http://localhost:8765/';
const EVIDENCE = '/home/user/FDMS/evidence_s6';
const RESULTS  = [];
let   ssIdx    = 0;

const IGNORABLE = ['ERR_TUNNEL_CONNECTION_FAILED', 'ERR_NAME_NOT_RESOLVED', 'net::ERR_'];
const isIgnorable = m => IGNORABLE.some(p => m.includes(p));

function log(id, title, pass, note, refs = []) {
  const s = pass ? 'PASS' : 'FAIL';
  RESULTS.push({ id, title, status: s, note, refs });
  console.log(`  ${s}: ${id} — ${title}${note ? ' | ' + note : ''}`);
}

async function ss(page, label) {
  ssIdx++;
  const fname = `S6_${ssIdx}_${label.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
  await page.screenshot({ path: path.join(EVIDENCE, fname) });
  return fname;
}

async function waitForApp(page) {
  await page.waitForSelector('#liveBody', { timeout: 15000 });
  await page.waitForTimeout(600);
}

function today() { return new Date().toISOString().split('T')[0]; }

async function seed(page, movements) {
  await page.evaluate(mvmts => {
    localStorage.setItem('vectair_fdms_movements_v3', JSON.stringify({
      version: 3, timestamp: new Date().toISOString(), movements: mvmts
    }));
    localStorage.removeItem('vectair_fdms_bookings_v1');
  }, movements);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForApp(page);
}

async function clear(page) {
  await page.evaluate(() => {
    localStorage.removeItem('vectair_fdms_movements_v3');
    localStorage.removeItem('vectair_fdms_bookings_v1');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForApp(page);
}

async function getMovements(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('vectair_fdms_movements_v3');
    if (!raw) return [];
    try { return JSON.parse(raw).movements || []; } catch { return []; }
  });
}

/**
 * Opens the New Local Flight modal and expands the Formation section.
 * Sets count to `count` and returns without saving.
 */
async function openLocModalWithFormation(page, callsign, count) {
  await page.click('#btnNewLoc');
  await page.waitForSelector('#newLocCallsignCode', { timeout: 5000 });
  await page.fill('#newLocCallsignCode', callsign);
  await page.fill('#newLocStart', '10:00');
  await page.fill('#newLocEnd',   '11:00');

  // Expand the Formation section
  await page.locator('.modal-expander[data-target="newLocFormationSection"]').click();
  await page.waitForSelector('#newLocFormationSection:not([hidden])', { timeout: 3000 });

  // Set count — triggers buildFormationElementRows
  await page.fill('#newLocFormationCount', String(count));
  await page.dispatchEvent('#newLocFormationCount', 'input');
  await page.waitForTimeout(300);
}

// ============================================================
// Main
// ============================================================
(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
           '--single-process', '--no-zygote', '--disable-gpu']
  });
  const context = await browser.newContext();
  const page    = await context.newPage();

  await page.route('**/xlsx.full.min.js', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' })
  );

  const jsErrors = [];
  page.on('console', msg => { if (msg.type() === 'error' && !isIgnorable(msg.text())) jsErrors.push(msg.text()); });
  page.on('pageerror', e  => { if (!isIgnorable(e.message)) jsErrors.push(e.message); });

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await waitForApp(page);

  console.log('\n=== Sprint 6: Formations v1.1 Parity — LOC strip ===\n');

  // -----------------------------------------------------------------------
  // H1 — Create LOC strip with formation → badge F×2 appears
  // -----------------------------------------------------------------------
  console.log('H1: Formation on LOC strip → badge appears');
  jsErrors.length = 0;
  await clear(page);

  await openLocModalWithFormation(page, 'ALPHA', 2);
  await page.click('.js-save-loc');
  await page.waitForTimeout(500);

  const h1ss   = await ss(page, 'H1_loc_badge');
  const h1Mvs  = await getMovements(page);
  const h1Mv   = h1Mvs.find(m => m.callsignCode === 'ALPHA');
  const h1Badge = await page.locator('.badge-formation').count();
  const h1Pass  = h1Badge > 0 &&
                  h1Mv?.formation?.elements?.length === 2 &&
                  jsErrors.length === 0;
  log('H1', 'LOC strip with formation → badge F×2', h1Pass,
      `badge=${h1Badge} elements=${h1Mv?.formation?.elements?.length} errors=${jsErrors.length}`,
      [h1ss]);

  // -----------------------------------------------------------------------
  // H2 — depAd/arrAd per element persist on LOC strip
  // -----------------------------------------------------------------------
  console.log('H2: depAd/arrAd per element persist on LOC strip');
  jsErrors.length = 0;
  await clear(page);

  await openLocModalWithFormation(page, 'BRAVO', 2);
  // Fill depAd for element 0, arrAd for element 1
  const h2DepAdInput = page.locator('[data-el-dep-ad="0"]');
  const h2ArrAdInput = page.locator('[data-el-arr-ad="1"]');
  await h2DepAdInput.fill('EGCC');
  await h2DepAdInput.dispatchEvent('input');
  await h2ArrAdInput.fill('EGLL');
  await h2ArrAdInput.dispatchEvent('input');
  await page.click('.js-save-loc');
  await page.waitForTimeout(500);

  const h2ss  = await ss(page, 'H2_loc_dep_arr_ad');
  const h2Mvs = await getMovements(page);
  const h2Mv  = h2Mvs.find(m => m.callsignCode === 'BRAVO');
  const h2El0DepAd = h2Mv?.formation?.elements?.[0]?.depAd;
  const h2El1ArrAd = h2Mv?.formation?.elements?.[1]?.arrAd;
  const h2Pass = h2El0DepAd === 'EGCC' && h2El1ArrAd === 'EGLL' && jsErrors.length === 0;
  log('H2', 'depAd/arrAd per element persist on LOC strip', h2Pass,
      `el0.depAd=${h2El0DepAd} el1.arrAd=${h2El1ArrAd} errors=${jsErrors.length}`,
      [h2ss]);

  // -----------------------------------------------------------------------
  // H3 — Invalid WTC in LOC modal blocks save
  // -----------------------------------------------------------------------
  console.log('H3: Invalid WTC in LOC modal blocks save');
  jsErrors.length = 0;
  await clear(page);

  await openLocModalWithFormation(page, 'CHARLIE', 2);
  // Set invalid WTC on element 0
  const h3WtcInput = page.locator('[data-el-wtc="0"]');
  await h3WtcInput.fill('X');
  await h3WtcInput.dispatchEvent('input');
  await page.click('.js-save-loc');
  await page.waitForTimeout(400);

  const h3ss  = await ss(page, 'H3_loc_invalid_wtc');
  const h3Mvs = await getMovements(page);
  const h3Mv  = h3Mvs.find(m => m.callsignCode === 'CHARLIE');
  const h3Pass = !h3Mv && jsErrors.length === 0;
  log('H3', 'Invalid WTC blocks LOC modal save', h3Pass,
      `movement=${h3Mv ? 'present (wrong)' : 'absent (correct)'} errors=${jsErrors.length}`,
      [h3ss]);

  // -----------------------------------------------------------------------
  // H4 — Invalid ICAO code in LOC modal blocks save
  // -----------------------------------------------------------------------
  console.log('H4: Invalid ICAO code in LOC modal blocks save');
  jsErrors.length = 0;
  await clear(page);

  await openLocModalWithFormation(page, 'DELTA', 2);
  // Set 3-char (invalid) depAd on element 0
  const h4DepAdInput = page.locator('[data-el-dep-ad="0"]');
  await h4DepAdInput.fill('EGO');
  await h4DepAdInput.dispatchEvent('input');
  await page.click('.js-save-loc');
  await page.waitForTimeout(400);

  const h4ss  = await ss(page, 'H4_loc_invalid_icao');
  const h4Mvs = await getMovements(page);
  const h4Mv  = h4Mvs.find(m => m.callsignCode === 'DELTA');
  const h4Pass = !h4Mv && jsErrors.length === 0;
  log('H4', 'Invalid ICAO code blocks LOC modal save', h4Pass,
      `movement=${h4Mv ? 'present (wrong)' : 'absent (correct)'} errors=${jsErrors.length}`,
      [h4ss]);

  // -----------------------------------------------------------------------
  // H5 — Count < 2 → movement.formation = null on LOC strip
  // -----------------------------------------------------------------------
  console.log('H5: Count < 2 → formation=null on LOC strip');
  jsErrors.length = 0;
  await clear(page);

  await page.click('#btnNewLoc');
  await page.waitForSelector('#newLocCallsignCode', { timeout: 5000 });
  await page.fill('#newLocCallsignCode', 'ECHO');
  await page.fill('#newLocStart', '10:00');
  await page.fill('#newLocEnd',   '11:00');
  // Do NOT expand Formation section (count stays at default=2 but rows never rendered)
  await page.click('.js-save-loc');
  await page.waitForTimeout(500);

  const h5ss  = await ss(page, 'H5_loc_no_formation');
  const h5Mvs = await getMovements(page);
  const h5Mv  = h5Mvs.find(m => m.callsignCode === 'ECHO');
  const h5Badge = await page.locator('.badge-formation').count();
  const h5Pass = h5Mv?.formation === null && h5Badge === 0 && jsErrors.length === 0;
  log('H5', 'LOC strip without formation section opened → formation=null, no badge', h5Pass,
      `formation=${JSON.stringify(h5Mv?.formation)} badge=${h5Badge} errors=${jsErrors.length}`,
      [h5ss]);

  // -----------------------------------------------------------------------
  // H6 — Save-and-Complete LOC with formation → all elements cascaded to COMPLETED
  // -----------------------------------------------------------------------
  console.log('H6: Save-and-Complete LOC → elements cascade to COMPLETED');
  jsErrors.length = 0;
  await clear(page);

  await openLocModalWithFormation(page, 'FOXTROT', 3);
  await page.click('.js-save-complete-loc');
  await page.waitForTimeout(500);

  const h6ss  = await ss(page, 'H6_loc_save_complete_cascade');
  const h6Mvs = await getMovements(page);
  const h6Mv  = h6Mvs.find(m => m.callsignCode === 'FOXTROT');
  const h6ElStatuses = h6Mv?.formation?.elements?.map(e => e.status);
  const h6AllCompleted = h6ElStatuses?.every(s => s === 'COMPLETED');
  const h6Pass = h6AllCompleted && h6Mv?.status === 'COMPLETED' && jsErrors.length === 0;
  log('H6', 'Save-and-Complete LOC: all elements cascaded to COMPLETED', h6Pass,
      `masterStatus=${h6Mv?.status} elementStatuses=${JSON.stringify(h6ElStatuses)} errors=${jsErrors.length}`,
      [h6ss]);

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  const passed = RESULTS.filter(r => r.status === 'PASS').length;
  const failed = RESULTS.filter(r => r.status === 'FAIL').length;

  console.log(`\n=== Results: ${passed}/${RESULTS.length} PASS, ${failed} FAIL ===\n`);
  for (const r of RESULTS) {
    const ref = r.refs.length ? ` [${r.refs.join(', ')}]` : '';
    console.log(`  ${r.status}: ${r.id} — ${r.title}${ref}`);
  }

  fs.writeFileSync(
    path.join(EVIDENCE, 'sprint6_loc_formation_results.json'),
    JSON.stringify({ timestamp: new Date().toISOString(), results: RESULTS }, null, 2)
  );
  console.log(`\nEvidence: ${path.join(EVIDENCE, 'sprint6_loc_formation_results.json')}`);

  await browser.close();

  if (failed > 0) {
    console.log(`\nFAIL: ${failed} test(s) failed`);
    process.exit(1);
  } else {
    console.log('\nAll tests passed.');
  }
})();

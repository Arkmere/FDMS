/**
 * Sprint 4 Formation v1 Regression — Playwright (Chromium headless)
 *
 * Tests:
 *   F1  Create strip without formation via UI → no badge
 *   F2  Create strip WITH formation via UI → badge F×2 persists
 *   F3  Seeded formation → badge F×3 renders on Live Board
 *   F4  Expanded panel shows formation table, element Save buttons present
 *   F5  Element inline save: status → ACTIVE, dep time set, persists
 *   F6  WTC recomputes: element 0 (M) set COMPLETED → wtcCurrent drops to L
 *   F7  Edit modal pre-populates formation count from existing strip
 *   F8  Remove Formation via edit modal → formation null, badge gone
 *   F9  Duplicate inherits formation with elements reset to PLANNED/no actuals
 *   F10 Malformed formation in localStorage is normalized on load (no crash)
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const APP_URL   = 'http://localhost:8765/';
const EVIDENCE  = '/home/user/FDMS/evidence_s4';
const RESULTS   = [];
let   ssIdx     = 0;

const IGNORABLE = ['ERR_TUNNEL_CONNECTION_FAILED', 'ERR_NAME_NOT_RESOLVED', 'net::ERR_'];
const isIgnorable = m => IGNORABLE.some(p => m.includes(p));

function log(id, title, pass, note, refs = []) {
  const s = pass ? 'PASS' : 'FAIL';
  RESULTS.push({ id, title, status: s, note, refs });
  console.log(`  ${s}: ${id} — ${title}${note ? ' | ' + note : ''}`);
}

async function ss(page, label) {
  ssIdx++;
  const fname = `S4_${ssIdx}_${label.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
  await page.screenshot({ path: path.join(EVIDENCE, fname) });
  return `${fname}`;
}

async function waitForApp(page) {
  await page.waitForSelector('#liveBody', { timeout: 15000 });
  await page.waitForTimeout(800);
}

function today() { return new Date().toISOString().split('T')[0]; }

/** Seed movements into localStorage and reload */
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

/** Clear storage and reload */
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

// Formation test fixtures
const CNNCT_FORMATION = {
  label: 'CNNCT flight of 3', wtcCurrent: 'M', wtcMax: 'M',
  elements: [
    { callsign: 'CNNCT 1', reg: 'ZZ400', type: 'EH10', wtc: 'M', status: 'ACTIVE', depActual: '13:15', arrActual: '' },
    { callsign: 'CNNCT 2', reg: 'ZZ401', type: 'LYNX', wtc: 'L', status: 'ACTIVE', depActual: '13:15', arrActual: '' },
    { callsign: 'CNNCT 3', reg: 'ZZ402', type: 'LYNX', wtc: 'L', status: 'PLANNED', depActual: '', arrActual: '' }
  ]
};

const BASE_STRIP = {
  id: 1, status: 'ACTIVE', callsignCode: 'CNNCT', callsignLabel: 'CONNECT FLIGHT',
  callsignVoice: '', registration: 'ZZ400', operator: '', type: 'Mixed (EH10/LYNX)', wtc: 'M',
  depAd: 'EGOW', depName: 'RAF Woodvale', arrAd: 'EGOS', arrName: 'RAF Shawbury',
  depPlanned: '13:00', depActual: '13:15', arrPlanned: '14:00', arrActual: '',
  dof: today(), flightType: 'DEP', rules: 'VFR', isLocal: false,
  tngCount: 0, osCount: 1, fisCount: 0, egowCode: 'BM', egowDesc: '',
  unitCode: '', unitDesc: '', captain: '', pob: 3,
  remarks: 'Formation departure to Shawbury', warnings: '', notes: '',
  squawk: '', route: '', clearance: '', formation: CNNCT_FORMATION
};

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

  // Stub CDN xlsx (network may be unavailable)
  await page.route('**/xlsx.full.min.js', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' })
  );

  const jsErrors = [];
  page.on('console', msg => { if (msg.type() === 'error' && !isIgnorable(msg.text())) jsErrors.push(msg.text()); });
  page.on('pageerror', e  => { if (!isIgnorable(e.message)) jsErrors.push(e.message); });

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await waitForApp(page);

  console.log('\n=== Sprint 4: Formation v1 Regression ===\n');

  // ------------------------------------------------------------------
  // F1 — Create via UI: no formation → no badge
  // ------------------------------------------------------------------
  console.log('F1: No formation = no badge');
  jsErrors.length = 0;
  await clear(page);

  await page.click('#btnNewDep');
  await page.waitForSelector('#newCallsignCode', { timeout: 5000 });
  await page.fill('#newCallsignCode', 'SIMPLE');
  await page.fill('#newReg',          'G-TEST');
  await page.fill('#newType',         'C172');
  await page.fill('#newDepPlanned',   '10:00');
  await page.fill('#newArrPlanned',   '10:30');
  await page.fill('#newEgowCode',     'BC');
  await page.fill('#newDOF', today());
  await page.click('.js-save-flight');
  await page.waitForTimeout(500);

  const f1ss = await ss(page, 'F1_no_badge');
  const f1Badges = await page.locator('.badge-formation').count();
  log('F1', 'No formation → badge absent', f1Badges === 0 && jsErrors.length === 0,
      `badges=${f1Badges} errors=${jsErrors.length}`, [f1ss]);

  // ------------------------------------------------------------------
  // F2 — Create via UI: formation count=2 → badge F×2, persists on reload
  // ------------------------------------------------------------------
  console.log('F2: Create 2-element formation via UI → badge persists');
  jsErrors.length = 0;
  await clear(page);

  await page.click('#btnNewDep');
  await page.waitForSelector('#newCallsignCode', { timeout: 5000 });
  await page.fill('#newCallsignCode', 'CNNCT');
  await page.fill('#newReg',          'ZZ400');
  await page.fill('#newType',         'EH10');
  await page.fill('#newDepPlanned',   '13:00');
  await page.fill('#newArrPlanned',   '14:00');
  await page.fill('#newEgowCode',     'BM');
  await page.fill('#newDOF', today());

  // Expand formation section
  await page.click('button.modal-expander[data-target="newFormationSection"]');
  await page.waitForSelector('#newFormationCount', { state: 'visible', timeout: 5000 });
  // Set count = 2 via evaluate (more reliable than fill for triggering custom listeners)
  await page.evaluate(() => {
    const inp = document.getElementById('newFormationCount');
    inp.value = '2';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(200);

  // Fill element rows
  await page.fill('[data-el-reg="0"]',  'ZZ400');
  await page.fill('[data-el-type="0"]', 'EH10');
  await page.fill('[data-el-wtc="0"]',  'M');
  await page.fill('[data-el-reg="1"]',  'ZZ401');
  await page.fill('[data-el-type="1"]', 'LYNX');
  await page.fill('[data-el-wtc="1"]',  'L');

  await page.click('.js-save-flight');
  await page.waitForTimeout(600);

  const f2ss_pre = await ss(page, 'F2_badge_before_reload');
  const f2BadgePre = await page.locator('.badge-formation').first().textContent().catch(() => '');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForApp(page);
  const f2ss_post = await ss(page, 'F2_badge_after_reload');
  const f2BadgePost = await page.locator('.badge-formation').first().textContent().catch(() => '');
  const f2Pass = f2BadgePre.includes('2') && f2BadgePost.includes('2') && jsErrors.length === 0;
  log('F2', 'Formation badge F×2 created and persists after reload', f2Pass,
      `pre="${f2BadgePre}" post="${f2BadgePost}" errors=${jsErrors.length}`, [f2ss_pre, f2ss_post]);

  // ------------------------------------------------------------------
  // F3 — Seeded 3-element formation → badge F×3
  // ------------------------------------------------------------------
  console.log('F3: Seeded formation → badge F×3');
  jsErrors.length = 0;
  await seed(page, [BASE_STRIP]);

  const f3ss = await ss(page, 'F3_seeded_badge');
  const f3Badge = await page.locator('.badge-formation').first().textContent().catch(() => '');
  const f3Pass = f3Badge.includes('3') && jsErrors.length === 0;
  log('F3', 'Seeded formation renders badge F×3', f3Pass,
      `badge="${f3Badge}" errors=${jsErrors.length}`, [f3ss]);

  // ------------------------------------------------------------------
  // F4 — Expanded panel shows formation table + Save buttons
  // ------------------------------------------------------------------
  console.log('F4: Expanded panel renders formation table');
  jsErrors.length = 0;
  await seed(page, [BASE_STRIP]);

  // Click the info/toggle button on the first strip
  await page.locator('.js-toggle-details').first().click();
  await page.waitForTimeout(400);

  const f4ss = await ss(page, 'F4_expanded_panel');
  const f4Tables   = await page.locator('.formation-table').count();
  const f4SaveBtns = await page.locator('.fmn-el-save').count();
  const f4HasLabel = (await page.locator('.expand-subsection').filter({ hasText: 'Formation' }).count()) > 0;
  const f4Pass = f4Tables > 0 && f4SaveBtns === 3 && f4HasLabel && jsErrors.length === 0;
  log('F4', 'Formation panel renders: table + 3 Save buttons', f4Pass,
      `tables=${f4Tables} saveBtns=${f4SaveBtns} hasLabel=${f4HasLabel}`, [f4ss]);

  // ------------------------------------------------------------------
  // F5 — Element inline save: status=ACTIVE, depActual=13:20
  // ------------------------------------------------------------------
  console.log('F5: Element inline save');
  jsErrors.length = 0;
  // Re-seed with PLANNED element 2 (index 2 = CNNCT 3, PLANNED, no dep time)
  const stripF5 = { ...BASE_STRIP, formation: { ...CNNCT_FORMATION } };
  await seed(page, [stripF5]);

  // Expand to see formation table
  await page.locator('.js-toggle-details').first().click();
  await page.waitForTimeout(400);

  // Update element 2 (index 2): status=ACTIVE, dep=13:20
  await page.locator('.fmn-el-select').nth(2).selectOption('ACTIVE');
  await page.locator('.fmn-el-dep').nth(2).fill('13:20');
  await page.locator('.fmn-el-save').nth(2).dispatchEvent('click');
  await page.waitForTimeout(600);

  const f5ss = await ss(page, 'F5_element_saved');
  const mvs5 = await getMovements(page);
  const mv5  = mvs5.find(m => m.callsignCode === 'CNNCT');
  const el5  = mv5?.formation?.elements?.[2];
  const f5Pass = el5?.status === 'ACTIVE' && el5?.depActual === '13:20' && jsErrors.length === 0;
  log('F5', 'Element 2 saved: status=ACTIVE depActual=13:20', f5Pass,
      `status=${el5?.status} dep=${el5?.depActual}`, [f5ss]);

  // ------------------------------------------------------------------
  // F6 — WTC recomputes: element 0 (EH10 M) set COMPLETED → wtcCurrent=L
  // ------------------------------------------------------------------
  console.log('F6: WTC recomputes after element completion');
  jsErrors.length = 0;
  // Seed with all elements PLANNED to start fresh
  const stripF6 = {
    ...BASE_STRIP,
    formation: {
      label: 'CNNCT flight of 3', wtcCurrent: 'M', wtcMax: 'M',
      elements: [
        { callsign: 'CNNCT 1', reg: 'ZZ400', type: 'EH10', wtc: 'M', status: 'ACTIVE', depActual: '13:15', arrActual: '' },
        { callsign: 'CNNCT 2', reg: 'ZZ401', type: 'LYNX', wtc: 'L', status: 'ACTIVE', depActual: '13:15', arrActual: '' },
        { callsign: 'CNNCT 3', reg: 'ZZ402', type: 'LYNX', wtc: 'L', status: 'ACTIVE', depActual: '13:15', arrActual: '' }
      ]
    }
  };
  await seed(page, [stripF6]);
  await page.locator('.js-toggle-details').first().click();
  await page.waitForTimeout(400);

  // Complete element 0 (EH10, wtc=M)
  await page.locator('.fmn-el-select').nth(0).selectOption('COMPLETED');
  await page.locator('.fmn-el-arr').nth(0).fill('14:00');
  await page.locator('.fmn-el-save').nth(0).dispatchEvent('click');
  await page.waitForTimeout(600);

  const mvs6 = await getMovements(page);
  const mv6  = mvs6.find(m => m.callsignCode === 'CNNCT');
  const f6ss = await ss(page, 'F6_wtc_recompute');
  // wtcCurrent should be L (only LYNX x2 remain ACTIVE)
  // wtcMax should remain M (EH10 was in the formation)
  const f6Pass = mv6?.formation?.wtcCurrent === 'L' &&
                 mv6?.formation?.wtcMax     === 'M' &&
                 jsErrors.length === 0;
  log('F6', 'WTC recomputes: current=L max=M after EH10 completed', f6Pass,
      `wtcCurrent=${mv6?.formation?.wtcCurrent} wtcMax=${mv6?.formation?.wtcMax}`, [f6ss]);

  // ------------------------------------------------------------------
  // F7 — Edit modal pre-populates formation count
  // ------------------------------------------------------------------
  console.log('F7: Edit modal pre-populates formation');
  jsErrors.length = 0;
  await seed(page, [BASE_STRIP]);

  // Open edit modal via dropdown
  let openedEditModal = false;
  try {
    await page.locator('.js-edit-dropdown').first().click({ timeout: 3000 });
    await page.waitForTimeout(200);
    await page.locator('.js-edit-details').first().click({ timeout: 3000 });
    openedEditModal = true;
  } catch { }
  await page.waitForTimeout(600);

  const f7ss = await ss(page, 'F7_edit_modal');
  let f7Count = '0';
  let f7FormationVisible = false;
  if (openedEditModal) {
    try {
      f7Count = await page.locator('#editFormationCount').inputValue({ timeout: 3000 });
      f7FormationVisible = true;
    } catch { }
  }
  const f7Pass = f7FormationVisible && parseInt(f7Count, 10) === 3 && jsErrors.length === 0;
  log('F7', 'Edit modal pre-populates formation count=3', f7Pass,
      `count=${f7Count} visible=${f7FormationVisible}`, [f7ss]);
  // Close modal if open
  await page.locator('.js-close-modal').click().catch(() => {});
  await page.waitForTimeout(200);

  // ------------------------------------------------------------------
  // F8 — Remove formation via edit modal → formation=null, badge gone
  // ------------------------------------------------------------------
  console.log('F8: Remove formation via edit modal');
  jsErrors.length = 0;
  await seed(page, [BASE_STRIP]);

  let openedEditModal8 = false;
  try {
    await page.locator('.js-edit-dropdown').first().click({ timeout: 3000 });
    await page.waitForTimeout(200);
    await page.locator('.js-edit-details').first().click({ timeout: 3000 });
    openedEditModal8 = true;
  } catch { }
  await page.waitForTimeout(600);

  const f8ss_before = await ss(page, 'F8_edit_modal_open');
  let f8Removed = false;
  if (openedEditModal8) {
    try {
      // Expand formation section if not already open
      const fmSect = page.locator('#editFormationSection');
      const fmVisible = await fmSect.isVisible({ timeout: 1000 }).catch(() => false);
      if (!fmVisible) {
        await page.locator('button.modal-expander[data-target="editFormationSection"]').click();
        await page.waitForTimeout(200);
      }
      // Click Remove Formation
      await page.locator('.js-remove-formation').click({ timeout: 3000 });
      await page.waitForTimeout(200);
      // Save
      await page.locator('.js-save-edit').click();
      await page.waitForTimeout(600);
      f8Removed = true;
    } catch (e) {
      // Fallback: set count to 1 then save
      try {
        await page.evaluate(() => {
          const inp = document.getElementById('editFormationCount');
          if (inp) { inp.value = '1'; inp.dispatchEvent(new Event('input', {bubbles:true})); }
        });
        await page.locator('.js-save-edit').click();
        await page.waitForTimeout(600);
        f8Removed = true;
      } catch {}
    }
  }

  const f8ss = await ss(page, 'F8_formation_removed');
  const mvs8 = await getMovements(page);
  const mv8  = mvs8.find(m => m.callsignCode === 'CNNCT');
  const f8Badge = await page.locator('.badge-formation').count();
  const f8FormationNull = mv8?.formation === null || mv8?.formation === undefined;
  const f8Pass = f8Removed && f8FormationNull && f8Badge === 0 && jsErrors.length === 0;
  log('F8', 'Formation removed via edit modal → null, badge gone', f8Pass,
      `removed=${f8Removed} formationNull=${f8FormationNull} badge=${f8Badge}`, [f8ss]);

  // ------------------------------------------------------------------
  // F9 — Duplicate: formation copied with elements reset to PLANNED
  // ------------------------------------------------------------------
  console.log('F9: Duplicate resets formation elements to PLANNED');
  jsErrors.length = 0;
  // Seed with ACTIVE elements (elements have actual times)
  await seed(page, [BASE_STRIP]);

  let openedDupModal = false;
  try {
    await page.locator('.js-edit-dropdown').first().click({ timeout: 3000 });
    await page.waitForTimeout(200);
    await page.locator('.js-duplicate').first().click({ timeout: 3000 });
    openedDupModal = true;
  } catch { }
  await page.waitForTimeout(500);

  const f9ss_modal = await ss(page, 'F9_dup_modal');
  if (openedDupModal) {
    try {
      await page.locator('.js-save-dup').click({ timeout: 3000 });
      await page.waitForTimeout(600);
    } catch {}
  }

  const f9ss = await ss(page, 'F9_dup_created');
  const mvs9 = await getMovements(page);
  // Duplicate is the second strip (id !== 1)
  const dupMv = mvs9.find(m => m.id !== 1 && m.callsignCode === 'CNNCT');
  const f9Pass = openedDupModal && dupMv?.formation != null &&
    dupMv.formation.elements?.every(el => el.status === 'PLANNED' &&
      el.depActual === '' && el.arrActual === '') &&
    jsErrors.length === 0;
  log('F9', 'Duplicate inherits formation, elements reset to PLANNED', f9Pass,
      `dupId=${dupMv?.id} elStatuses=${JSON.stringify(dupMv?.formation?.elements?.map(e => e.status))}`, [f9ss]);

  // ------------------------------------------------------------------
  // F10 — Malformed formation normalized on load (no JS errors)
  // ------------------------------------------------------------------
  console.log('F10: Malformed formation normalized on load');
  await page.evaluate(todayStr => {
    localStorage.setItem('vectair_fdms_movements_v3', JSON.stringify({
      version: 3, timestamp: new Date().toISOString(),
      movements: [{
        id: 50, status: 'PLANNED', callsignCode: 'BADFORM',
        callsignLabel: '', callsignVoice: '', registration: '', type: '', wtc: '',
        depAd: 'EGOW', depName: '', arrAd: 'EGOS', arrName: '',
        depPlanned: '09:00', depActual: '', arrPlanned: '10:00', arrActual: '',
        dof: todayStr, flightType: 'DEP', rules: 'VFR', isLocal: false,
        tngCount: 0, osCount: 0, fisCount: 0, egowCode: 'BC',
        egowDesc: '', unitCode: '', unitDesc: '', captain: '', pob: 1,
        remarks: '', warnings: '', notes: '',
        formation: { label: null }   // malformed: null label, no elements
      }]
    }));
  }, today());
  jsErrors.length = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForApp(page);

  const mvs10 = await getMovements(page);
  const mv10  = mvs10.find(m => m.callsignCode === 'BADFORM');
  const f10ss = await ss(page, 'F10_normalized');
  const f10Pass = mv10 != null &&
    mv10.formation != null &&
    Array.isArray(mv10.formation.elements) &&
    mv10.formation.elements.length === 0 &&
    typeof mv10.formation.label === 'string' &&
    mv10.formation.label.length > 0 &&
    jsErrors.length === 0;
  log('F10', 'Malformed formation normalized on load', f10Pass,
      `label="${mv10?.formation?.label}" elemLen=${mv10?.formation?.elements?.length} errors=${jsErrors.length}`, [f10ss]);

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  await browser.close();

  const total  = RESULTS.length;
  const passed = RESULTS.filter(r => r.status === 'PASS').length;
  const failed = RESULTS.filter(r => r.status === 'FAIL').length;

  console.log(`\n=== Results: ${passed}/${total} PASS, ${failed} FAIL ===\n`);
  RESULTS.forEach(r => {
    const refs = r.refs.length ? ` [${r.refs.join(', ')}]` : '';
    console.log(`  ${r.status}: ${r.id} — ${r.title}${refs}`);
  });

  const evPath = path.join(EVIDENCE, 'sprint4_formation_results.json');
  fs.writeFileSync(evPath, JSON.stringify({ summary: { total, passed, failed }, results: RESULTS }, null, 2));
  console.log(`\nEvidence: ${evPath}`);

  if (failed > 0) {
    console.error(`\nFAIL: ${failed} test(s) failed`);
    process.exit(1);
  }
  console.log('\nAll tests passed.');
})();

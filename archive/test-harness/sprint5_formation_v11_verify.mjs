/**
 * Sprint 5 — Formations v1.1 Regression — Playwright (Chromium headless)
 *
 * Tests:
 *   G1  depAd/arrAd fields present in authoring modal element rows
 *   G2  depAd/arrAd persist via New Flight modal save
 *   G3  depAd/arrAd editable in expanded panel; persist after .fmn-el-save
 *   G4  Empty depAd/arrAd shows master fallback (muted) in expanded panel
 *   G5  Invalid depAd (3-char) rejected with toast; element not saved
 *   G6  Invalid WTC in modal rejected with toast; save blocked
 *   G7  Callsign input editable in New Flight modal; saved value persists
 *   G8  Formation count < 2 → movement.formation = null (no formation)
 *   G9  Cascade COMPLETE → all PLANNED/ACTIVE elements become COMPLETED
 *   G10 Cascade CANCEL → all elements become CANCELLED
 *   G11 Produce-arrival from formation DEP → inherits formation + resets state
 *   G12 Edit modal count clamped to max=12 (HTML attribute check)
 */

import { chromium } from 'playwright';
import fs   from 'fs';
import path from 'path';

const APP_URL  = 'http://localhost:8765/';
const EVIDENCE = '/home/user/FDMS/evidence_s5';
const RESULTS  = [];
let ssIdx = 0;

const IGNORABLE = ['ERR_TUNNEL_CONNECTION_FAILED', 'ERR_NAME_NOT_RESOLVED', 'net::ERR_'];
const isIgnorable = m => IGNORABLE.some(p => m.includes(p));

function log(id, title, pass, note, refs = []) {
  const s = pass ? 'PASS' : 'FAIL';
  RESULTS.push({ id, title, status: s, note, refs });
  console.log(`  ${s}: ${id} — ${title}${note ? ' | ' + note : ''}`);
}

async function ss(page, label) {
  ssIdx++;
  const fname = `S5_${ssIdx}_${label.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
  await page.screenshot({ path: path.join(EVIDENCE, fname) });
  return fname;
}

async function waitForApp(page) {
  await page.waitForSelector('#liveBody', { timeout: 15000 });
  await page.waitForTimeout(800);
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

// --- Fixtures ---
const BASE_STRIP_DEP = {
  id: 1, status: 'ACTIVE', callsignCode: 'CNNCT', callsignLabel: '', callsignVoice: '',
  registration: 'ZZ400', operator: '', type: 'EH10', wtc: 'M',
  depAd: 'EGOW', depName: 'RAF Woodvale', arrAd: 'EGOS', arrName: 'RAF Shawbury',
  depPlanned: '13:00', depActual: '13:15', arrPlanned: '14:00', arrActual: '',
  dof: today(), flightType: 'DEP', rules: 'VFR', isLocal: false,
  tngCount: 0, osCount: 0, fisCount: 0, egowCode: 'BM',
  egowDesc: '', unitCode: '', unitDesc: '', captain: '', pob: 3,
  remarks: '', warnings: '', notes: '', squawk: '', route: '', clearance: '',
  formation: {
    label: 'CNNCT flight of 3', wtcCurrent: 'M', wtcMax: 'M',
    elements: [
      { callsign: 'CNNCT 1', reg: 'ZZ400', type: 'EH10', wtc: 'M',
        status: 'ACTIVE',  depAd: 'EGOW', arrAd: 'EGOS', depActual: '13:15', arrActual: '' },
      { callsign: 'CNNCT 2', reg: 'ZZ401', type: 'LYNX', wtc: 'L',
        status: 'PLANNED', depAd: '',     arrAd: '',     depActual: '',       arrActual: '' },
      { callsign: 'CNNCT 3', reg: 'ZZ402', type: 'LYNX', wtc: 'L',
        status: 'PLANNED', depAd: 'EGOM', arrAd: '',     depActual: '',       arrActual: '' }
    ]
  }
};

// ============================================================
(async () => {
  fs.mkdirSync(EVIDENCE, { recursive: true });

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

  console.log('\n=== Sprint 5: Formations v1.1 Regression ===\n');

  // -----------------------------------------------------------------------
  // G1 — depAd/arrAd inputs present in New Flight modal element rows
  // -----------------------------------------------------------------------
  console.log('G1: depAd/arrAd inputs in New Flight modal');
  jsErrors.length = 0;
  await clear(page);

  await page.click('#btnNewDep');
  await page.waitForSelector('#newCallsignCode', { timeout: 5000 });
  await page.fill('#newCallsignCode', 'TEST');
  await page.fill('#newReg', 'G-TEST');
  await page.fill('#newDepPlanned', '10:00');
  await page.fill('#newArrPlanned', '10:30');
  await page.fill('#newEgowCode', 'BC');
  await page.fill('#newDOF', today());

  // Expand formation and set count = 2
  await page.click('button.modal-expander[data-target="newFormationSection"]');
  await page.waitForSelector('#newFormationCount', { state: 'visible', timeout: 5000 });
  await page.evaluate(() => {
    const inp = document.getElementById('newFormationCount');
    inp.value = '2';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(300);

  const g1DepAdCount  = await page.locator('[data-el-dep-ad]').count();
  const g1ArrAdCount  = await page.locator('[data-el-arr-ad]').count();
  const g1CallsignCount = await page.locator('[data-el-callsign]').count();
  const g1ss = await ss(page, 'G1_modal_inputs');
  const g1Pass = g1DepAdCount === 2 && g1ArrAdCount === 2 && g1CallsignCount === 2 && jsErrors.length === 0;
  log('G1', 'depAd/arrAd/callsign inputs present (count=2)', g1Pass,
      `depAdInputs=${g1DepAdCount} arrAdInputs=${g1ArrAdCount} callsignInputs=${g1CallsignCount}`, [g1ss]);

  // Close modal without saving
  await page.locator('.js-close-modal').first().click().catch(() => {});
  await page.waitForTimeout(200);

  // -----------------------------------------------------------------------
  // G2 — depAd/arrAd persist via New Flight modal save
  // -----------------------------------------------------------------------
  console.log('G2: depAd/arrAd persist via New Flight modal');
  jsErrors.length = 0;
  await clear(page);

  await page.click('#btnNewDep');
  await page.waitForSelector('#newCallsignCode', { timeout: 5000 });
  await page.fill('#newCallsignCode', 'CNNCT');
  await page.fill('#newReg', 'ZZ400');
  await page.fill('#newType', 'EH10');
  await page.fill('#newDepPlanned', '13:00');
  await page.fill('#newArrPlanned', '14:00');
  await page.fill('#newEgowCode', 'BM');
  await page.fill('#newDOF', today());

  await page.click('button.modal-expander[data-target="newFormationSection"]');
  await page.waitForSelector('#newFormationCount', { state: 'visible', timeout: 5000 });
  await page.evaluate(() => {
    const inp = document.getElementById('newFormationCount');
    inp.value = '2';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(300);

  // Fill element 0: dep ad EGOW, arr ad EGOS
  await page.fill('[data-el-dep-ad="0"]', 'EGOW');
  await page.fill('[data-el-arr-ad="0"]', 'EGOS');
  await page.fill('[data-el-wtc="0"]', 'M');
  // Element 1: leave dep ad blank, arr ad EGOM
  await page.fill('[data-el-arr-ad="1"]', 'EGOM');
  await page.fill('[data-el-wtc="1"]', 'L');

  await page.click('.js-save-flight');
  await page.waitForTimeout(600);

  const g2ss = await ss(page, 'G2_after_save');
  const mvs2 = await getMovements(page);
  const mv2  = mvs2.find(m => m.callsignCode === 'CNNCT');
  const el2_0 = mv2?.formation?.elements?.[0];
  const el2_1 = mv2?.formation?.elements?.[1];
  const g2Pass = el2_0?.depAd === 'EGOW' && el2_0?.arrAd === 'EGOS' &&
                 el2_1?.depAd === '' && el2_1?.arrAd === 'EGOM' &&
                 jsErrors.length === 0;
  log('G2', 'depAd/arrAd persist after New Flight modal save', g2Pass,
      `el0.depAd=${el2_0?.depAd} el0.arrAd=${el2_0?.arrAd} el1.depAd="${el2_1?.depAd}" el1.arrAd=${el2_1?.arrAd}`,
      [g2ss]);

  // -----------------------------------------------------------------------
  // G3 — depAd/arrAd editable in expanded panel; persist after .fmn-el-save
  // -----------------------------------------------------------------------
  console.log('G3: depAd/arrAd editable in expanded panel');
  jsErrors.length = 0;
  await seed(page, [BASE_STRIP_DEP]);

  await page.locator('.js-toggle-details').first().click();
  await page.waitForTimeout(400);

  // Element 1 (index 1, CNNCT 2) has empty depAd; set it to EGGP
  const g3DepAdInputs = page.locator('.fmn-el-ad');
  await g3DepAdInputs.nth(2).fill('EGGP');  // index 2 = element 1 dep ad (el0 has 2 inputs, 0=dep,1=arr; el1: 2=dep)
  await page.locator('.fmn-el-save').nth(1).dispatchEvent('click');
  await page.waitForTimeout(500);

  const g3ss = await ss(page, 'G3_dep_ad_saved');
  const mvs3 = await getMovements(page);
  const mv3  = mvs3.find(m => m.callsignCode === 'CNNCT');
  const el3_1 = mv3?.formation?.elements?.[1];
  const g3Pass = el3_1?.depAd === 'EGGP' && jsErrors.length === 0;
  log('G3', 'depAd persists after inline panel save', g3Pass,
      `el1.depAd=${el3_1?.depAd}`, [g3ss]);

  // -----------------------------------------------------------------------
  // G4 — Empty depAd shows master fallback in expanded panel
  // -----------------------------------------------------------------------
  console.log('G4: Empty depAd shows master fallback');
  jsErrors.length = 0;
  await seed(page, [BASE_STRIP_DEP]);

  await page.locator('.js-toggle-details').first().click();
  await page.waitForTimeout(400);

  // Element 1 (CNNCT 2) has depAd="" — should show master depAd (EGOW) as fallback
  const g4ss = await ss(page, 'G4_fallback_display');
  // Look for .fmn-fallback text containing master depAd
  const g4FallbackCount = await page.locator('.fmn-fallback').count();
  const g4FallbackText  = await page.locator('.fmn-fallback').first().textContent().catch(() => '');
  const g4Pass = g4FallbackCount > 0 && g4FallbackText.includes('EGOW') && jsErrors.length === 0;
  log('G4', 'Empty depAd shows master fallback (EGOW)', g4Pass,
      `fallbacks=${g4FallbackCount} text="${g4FallbackText}"`, [g4ss]);

  // -----------------------------------------------------------------------
  // G5 — Invalid depAd (3-char) rejected with toast
  // -----------------------------------------------------------------------
  console.log('G5: Invalid depAd rejected');
  jsErrors.length = 0;
  await seed(page, [BASE_STRIP_DEP]);

  await page.locator('.js-toggle-details').first().click();
  await page.waitForTimeout(400);

  // Capture toast messages
  const toasts5 = [];
  await page.exposeFunction('__captureToast5', msg => toasts5.push(msg));
  await page.evaluate(() => {
    const orig = window.showToast;
    window.showToast = (msg, type) => {
      window.__captureToast5(msg + '|' + type);
      if (orig) orig(msg, type);
    };
  }).catch(() => {});

  // Try to save with invalid 3-char dep ad on element 0
  const g5DepAdInputs = page.locator('.fmn-el-ad');
  const g5OrigVal = await g5DepAdInputs.nth(0).inputValue();
  await g5DepAdInputs.nth(0).fill('EGW');  // 3 chars — invalid
  await page.locator('.fmn-el-save').nth(0).dispatchEvent('click');
  await page.waitForTimeout(400);

  const g5ss = await ss(page, 'G5_invalid_dep_ad');
  const mvs5 = await getMovements(page);
  const mv5  = mvs5.find(m => m.callsignCode === 'CNNCT');
  const el5_0 = mv5?.formation?.elements?.[0];
  // depAd should remain unchanged (save was blocked)
  const g5Pass = el5_0?.depAd === 'EGOW' && jsErrors.length === 0;
  log('G5', 'Invalid 3-char depAd rejected; element unchanged', g5Pass,
      `el0.depAd=${el5_0?.depAd} (should stay EGOW)`, [g5ss]);

  // -----------------------------------------------------------------------
  // G6 — Invalid WTC in New Flight modal rejected with toast
  // -----------------------------------------------------------------------
  console.log('G6: Invalid WTC in modal rejected');
  jsErrors.length = 0;
  await clear(page);

  await page.click('#btnNewDep');
  await page.waitForSelector('#newCallsignCode', { timeout: 5000 });
  await page.fill('#newCallsignCode', 'BADWTC');
  await page.fill('#newReg', 'ZZ999');
  await page.fill('#newDepPlanned', '09:00');
  await page.fill('#newArrPlanned', '10:00');
  await page.fill('#newEgowCode', 'BC');
  await page.fill('#newDOF', today());

  await page.click('button.modal-expander[data-target="newFormationSection"]');
  await page.waitForSelector('#newFormationCount', { state: 'visible', timeout: 5000 });
  await page.evaluate(() => {
    const inp = document.getElementById('newFormationCount');
    inp.value = '2';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(300);

  await page.fill('[data-el-wtc="0"]', 'HEAVY');  // invalid
  await page.fill('[data-el-wtc="1"]', 'L');

  await page.click('.js-save-flight');
  await page.waitForTimeout(500);

  const g6ss = await ss(page, 'G6_invalid_wtc');
  const mvs6 = await getMovements(page);
  const mv6  = mvs6.find(m => m.callsignCode === 'BADWTC');
  // Modal should still be open (save was blocked) — movement should NOT exist
  const g6Pass = mv6 == null && jsErrors.length === 0;
  log('G6', 'Invalid WTC blocks modal save; movement not created', g6Pass,
      `movement=${mv6 == null ? 'absent (correct)' : 'PRESENT (wrong)'}`, [g6ss]);

  await page.locator('.js-close-modal').first().click().catch(() => {});
  await page.waitForTimeout(200);

  // -----------------------------------------------------------------------
  // G7 — Callsign editable in New Flight modal; saved value persists
  // -----------------------------------------------------------------------
  console.log('G7: Element callsign editable in modal');
  jsErrors.length = 0;
  await clear(page);

  await page.click('#btnNewDep');
  await page.waitForSelector('#newCallsignCode', { timeout: 5000 });
  await page.fill('#newCallsignCode', 'FOXTROT');
  await page.fill('#newReg', 'ZZ100');
  await page.fill('#newType', 'EH10');
  await page.fill('#newDepPlanned', '10:00');
  await page.fill('#newArrPlanned', '11:00');
  await page.fill('#newEgowCode', 'BM');
  await page.fill('#newDOF', today());

  await page.click('button.modal-expander[data-target="newFormationSection"]');
  await page.waitForSelector('#newFormationCount', { state: 'visible', timeout: 5000 });
  await page.evaluate(() => {
    const inp = document.getElementById('newFormationCount');
    inp.value = '2';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(300);

  // Override auto-generated callsign for element 0
  await page.locator('[data-el-callsign="0"]').fill('FOXTROT LEAD');
  await page.fill('[data-el-wtc="0"]', 'M');
  await page.fill('[data-el-wtc="1"]', 'L');

  await page.click('.js-save-flight');
  await page.waitForTimeout(600);

  const g7ss = await ss(page, 'G7_callsign_override');
  const mvs7 = await getMovements(page);
  const mv7  = mvs7.find(m => m.callsignCode === 'FOXTROT');
  const el7_0 = mv7?.formation?.elements?.[0];
  const g7Pass = el7_0?.callsign === 'FOXTROT LEAD' && jsErrors.length === 0;
  log('G7', 'Overridden callsign persists', g7Pass,
      `el0.callsign="${el7_0?.callsign}"`, [g7ss]);

  // -----------------------------------------------------------------------
  // G8 — Count < 2 → formation = null
  // -----------------------------------------------------------------------
  console.log('G8: Count < 2 produces null formation');
  jsErrors.length = 0;
  await clear(page);

  await page.click('#btnNewDep');
  await page.waitForSelector('#newCallsignCode', { timeout: 5000 });
  await page.fill('#newCallsignCode', 'SOLO');
  await page.fill('#newReg', 'G-SOLO');
  await page.fill('#newDepPlanned', '09:00');
  await page.fill('#newArrPlanned', '09:30');
  await page.fill('#newEgowCode', 'BC');
  await page.fill('#newDOF', today());

  // Expand formation section but set count = 1 (below minimum)
  await page.click('button.modal-expander[data-target="newFormationSection"]');
  await page.waitForSelector('#newFormationCount', { state: 'visible', timeout: 5000 });
  await page.evaluate(() => {
    const inp = document.getElementById('newFormationCount');
    inp.value = '1';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(200);

  await page.click('.js-save-flight');
  await page.waitForTimeout(500);

  const g8ss = await ss(page, 'G8_no_formation');
  const mvs8 = await getMovements(page);
  const mv8  = mvs8.find(m => m.callsignCode === 'SOLO');
  const g8Pass = mv8 != null && mv8.formation == null && jsErrors.length === 0;
  log('G8', 'Count=1 → formation=null', g8Pass,
      `formation=${JSON.stringify(mv8?.formation)}`, [g8ss]);

  // -----------------------------------------------------------------------
  // G9 — Cascade COMPLETE → PLANNED/ACTIVE elements become COMPLETED
  // -----------------------------------------------------------------------
  console.log('G9: Complete master → elements cascade to COMPLETED');
  jsErrors.length = 0;
  await seed(page, [{
    ...BASE_STRIP_DEP,
    status: 'ACTIVE',
    formation: {
      label: 'CNNCT flight of 3', wtcCurrent: 'M', wtcMax: 'M',
      elements: [
        { callsign: 'CNNCT 1', reg: 'ZZ400', type: 'EH10', wtc: 'M',
          status: 'ACTIVE',  depAd: 'EGOW', arrAd: 'EGOS', depActual: '13:15', arrActual: '' },
        { callsign: 'CNNCT 2', reg: 'ZZ401', type: 'LYNX', wtc: 'L',
          status: 'PLANNED', depAd: '',     arrAd: '',     depActual: '',       arrActual: '' },
        { callsign: 'CNNCT 3', reg: 'ZZ402', type: 'LYNX', wtc: 'L',
          status: 'PLANNED', depAd: '',     arrAd: '',     depActual: '',       arrActual: '' }
      ]
    }
  }]);

  // Click the "→ Complete" button on the live board strip
  await page.locator('.js-complete').first().click();
  await page.waitForTimeout(600);

  const g9ss = await ss(page, 'G9_cascade_complete');
  const mvs9 = await getMovements(page);
  const mv9  = mvs9.find(m => m.callsignCode === 'CNNCT');
  const g9AllCompleted = mv9?.formation?.elements?.every(el => el.status === 'COMPLETED');
  const g9Pass = g9AllCompleted && mv9?.formation?.wtcCurrent === '' && jsErrors.length === 0;
  log('G9', 'COMPLETE cascade: all elements COMPLETED, wtcCurrent=""', g9Pass,
      `statuses=${JSON.stringify(mv9?.formation?.elements?.map(e => e.status))} wtcCurrent="${mv9?.formation?.wtcCurrent}"`,
      [g9ss]);

  // -----------------------------------------------------------------------
  // G10 — Cascade CANCEL → all elements become CANCELLED
  // -----------------------------------------------------------------------
  console.log('G10: Cancel master → elements cascade to CANCELLED');
  jsErrors.length = 0;
  await seed(page, [{
    ...BASE_STRIP_DEP,
    status: 'ACTIVE',
    formation: {
      label: 'CNNCT flight of 3', wtcCurrent: 'M', wtcMax: 'M',
      elements: [
        { callsign: 'CNNCT 1', reg: 'ZZ400', type: 'EH10', wtc: 'M',
          status: 'ACTIVE',  depAd: 'EGOW', arrAd: 'EGOS', depActual: '13:15', arrActual: '' },
        { callsign: 'CNNCT 2', reg: 'ZZ401', type: 'LYNX', wtc: 'L',
          status: 'PLANNED', depAd: '',     arrAd: '',     depActual: '',       arrActual: '' },
        { callsign: 'CNNCT 3', reg: 'ZZ402', type: 'LYNX', wtc: 'L',
          status: 'COMPLETED', depAd: '',   arrAd: '',     depActual: '13:15', arrActual: '14:00' }
      ]
    }
  }]);

  // Register dialog handler BEFORE click (confirm fires synchronously on click)
  page.once('dialog', d => d.accept());
  // Open dropdown and cancel
  await page.locator('.js-edit-dropdown').first().click();
  await page.waitForTimeout(200);
  await page.locator('.js-cancel').first().click();
  await page.waitForTimeout(600);

  const g10ss = await ss(page, 'G10_cascade_cancel');
  const mvs10 = await getMovements(page);
  const mv10  = mvs10.find(m => m.callsignCode === 'CNNCT');
  const g10AllCancelled = mv10?.formation?.elements?.every(el => el.status === 'CANCELLED');
  const g10Pass = g10AllCancelled && jsErrors.length === 0;
  log('G10', 'CANCEL cascade: all elements CANCELLED', g10Pass,
      `statuses=${JSON.stringify(mv10?.formation?.elements?.map(e => e.status))}`, [g10ss]);

  // -----------------------------------------------------------------------
  // G11 — Produce-arrival from formation DEP inherits formation + resets state
  // -----------------------------------------------------------------------
  console.log('G11: Produce-arrival inherits formation with state reset');
  jsErrors.length = 0;
  // Seed a fresh DEP strip with formation
  await seed(page, [{ ...BASE_STRIP_DEP, status: 'ACTIVE' }]);

  // Open dropdown → Arrival
  await page.locator('.js-edit-dropdown').first().click();
  await page.waitForTimeout(200);
  await page.locator('.js-produce-arr').first().click();
  await page.waitForTimeout(600);

  // Modal should be open — save it
  const g11ModalOpen = await page.locator('.js-save-edit').count();
  if (g11ModalOpen > 0) {
    await page.locator('.js-save-edit').click();
    await page.waitForTimeout(500);
  }

  const g11ss = await ss(page, 'G11_produce_arr');
  const mvs11 = await getMovements(page);
  // Produced strip is the ARR strip (id !== 1)
  const prodMv = mvs11.find(m => m.flightType === 'ARR' && m.callsignCode === 'CNNCT');
  const g11HasFormation = prodMv?.formation != null;
  const g11ElementsReset = prodMv?.formation?.elements?.every(
    el => el.status === 'PLANNED' && el.depActual === '' && el.arrActual === ''
  );
  const g11DepAdCopied = prodMv?.formation?.elements?.[0]?.depAd === 'EGOW'; // identity field preserved
  const g11Pass = g11HasFormation && g11ElementsReset && g11DepAdCopied && jsErrors.length === 0;
  log('G11', 'Produce-arrival inherits formation; elements reset to PLANNED', g11Pass,
      `hasFormation=${g11HasFormation} allReset=${g11ElementsReset} depAdCopied=${g11DepAdCopied}`,
      [g11ss]);

  // -----------------------------------------------------------------------
  // G12 — Edit modal count input has max=12 attribute
  // -----------------------------------------------------------------------
  console.log('G12: Edit modal count input clamped to max=12');
  jsErrors.length = 0;
  await seed(page, [BASE_STRIP_DEP]);

  await page.locator('.js-edit-dropdown').first().click();
  await page.waitForTimeout(200);
  await page.locator('.js-edit-details').first().click();
  await page.waitForTimeout(500);

  const g12ss = await ss(page, 'G12_edit_modal_attrs');
  const g12MaxAttr = await page.locator('#editFormationCount').getAttribute('max').catch(() => null);
  const g12MinAttr = await page.locator('#editFormationCount').getAttribute('min').catch(() => null);
  const g12Pass = g12MaxAttr === '12' && g12MinAttr === '2' && jsErrors.length === 0;
  log('G12', 'Edit modal count input: min=2 max=12', g12Pass,
      `min=${g12MinAttr} max=${g12MaxAttr}`, [g12ss]);

  await page.locator('.js-close-modal').first().click().catch(() => {});
  await page.waitForTimeout(200);

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  await browser.close();

  const total  = RESULTS.length;
  const passed = RESULTS.filter(r => r.status === 'PASS').length;
  const failed = RESULTS.filter(r => r.status === 'FAIL').length;

  console.log(`\n=== Results: ${passed}/${total} PASS, ${failed} FAIL ===\n`);
  RESULTS.forEach(r => {
    const refs = r.refs.length ? ` [${r.refs.join(', ')}]` : '';
    console.log(`  ${r.status}: ${r.id} — ${r.title}${refs}`);
  });

  const evPath = path.join(EVIDENCE, 'sprint5_formation_v11_results.json');
  fs.writeFileSync(evPath, JSON.stringify({ timestamp: new Date().toISOString(), results: RESULTS }, null, 2));
  console.log(`\nEvidence: ${evPath}`);

  if (failed > 0) { console.error(`\nFAIL: ${failed} test(s) failed`); process.exit(1); }
  else            { console.log('\nAll tests passed.'); }
})();

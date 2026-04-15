/**
 * Sprint 7: LOC Standard Modal Parity Verification
 *
 * Proves that the LOC "New Local Flight" modal now uses the standard movement
 * modal structure (sections: IDENTITY, PLAN, TIMES, OPERATIONAL + accordions:
 * Remarks & Warnings, ATC Details, Formation), with LOC-specific locks applied:
 *   - Flight Type: shows "LOC", disabled/read-only
 *   - Departure AD: shows "EGOW", disabled/read-only
 *   - Arrival AD: shows "EGOW", disabled/read-only
 *
 * Tests:
 *   I1  Standard modal structure: IDENTITY, PLAN, TIMES, OPERATIONAL headings present
 *   I2  Standard modal accordions: Remarks & Warnings, ATC Details, Formation present
 *   I3  Flight Type shows LOC and is disabled/read-only
 *   I4  Departure AD shows EGOW and is disabled/read-only
 *   I5  Arrival AD shows EGOW and is disabled/read-only
 *   I6  LOC timing: entering ETD does not auto-fill ETA (unchanged behavior)
 *   I7  Save LOC movement; reload; confirm times (depPlanned/arrPlanned) persisted correctly
 *   I8  Edit LOC: flight type locked, dep/arr AD locked in edit modal
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const APP_URL  = 'http://localhost:8765/';
const EVIDENCE = '/home/user/FDMS/evidence_s7';
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
  const fname = `S7_${ssIdx}_${label.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
  await page.screenshot({ path: path.join(EVIDENCE, fname) });
  return fname;
}

async function waitForApp(page) {
  await page.waitForSelector('#liveBody', { timeout: 15000 });
  await page.waitForTimeout(600);
}

function today() { return new Date().toISOString().split('T')[0]; }

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

  console.log('\n=== Sprint 7: LOC Standard Modal Parity ===\n');

  // -----------------------------------------------------------------------
  // I1 — Standard modal structure: section headings present
  // -----------------------------------------------------------------------
  console.log('I1: Standard modal structure — section headings');
  jsErrors.length = 0;
  await clear(page);

  await page.click('#btnNewLoc');
  await page.waitForSelector('#newLocCallsignCode', { timeout: 5000 });

  // Assert section headings (case-insensitive text match)
  const headings = await page.locator('.modal-section-title').allTextContents();
  const headingsUpper = headings.map(h => h.trim().toUpperCase());
  const hasIdentity    = headingsUpper.some(h => h.includes('IDENTITY'));
  const hasPlan        = headingsUpper.some(h => h.includes('PLAN'));
  const hasTimes       = headingsUpper.some(h => h.includes('TIMES'));
  const hasOperational = headingsUpper.some(h => h.includes('OPERATIONAL'));

  const i1ss   = await ss(page, 'I1_section_headings');
  const i1Pass = hasIdentity && hasPlan && hasTimes && hasOperational && jsErrors.length === 0;
  log('I1', 'Standard modal structure: IDENTITY, PLAN, TIMES, OPERATIONAL headings', i1Pass,
      `headings=${JSON.stringify(headingsUpper)} errors=${jsErrors.length}`,
      [i1ss]);

  // -----------------------------------------------------------------------
  // I2 — Standard modal accordions: Remarks & Warnings, ATC Details, Formation
  // -----------------------------------------------------------------------
  console.log('I2: Standard modal accordions present');
  jsErrors.length = 0;

  const expanderTexts = await page.locator('.modal-expander').allTextContents();
  const expanderUpper = expanderTexts.map(t => t.trim().toUpperCase());
  const hasRemarksWarnings = expanderUpper.some(t => t.includes('REMARKS') && t.includes('WARNINGS'));
  const hasAtcDetails      = expanderUpper.some(t => t.includes('ATC') && t.includes('DETAILS'));
  const hasFormation       = expanderUpper.some(t => t.includes('FORMATION'));

  const i2ss   = await ss(page, 'I2_accordions');
  const i2Pass = hasRemarksWarnings && hasAtcDetails && hasFormation && jsErrors.length === 0;
  log('I2', 'Standard modal accordions: Remarks & Warnings, ATC Details, Formation', i2Pass,
      `expanders=${JSON.stringify(expanderUpper)} errors=${jsErrors.length}`,
      [i2ss]);

  // -----------------------------------------------------------------------
  // I3 — Flight Type shows LOC and is disabled/read-only
  // -----------------------------------------------------------------------
  console.log('I3: Flight Type = LOC, disabled');
  jsErrors.length = 0;

  // The standard LOC modal renders Flight Type as a disabled input with value "LOC"
  // Locate a disabled input whose value is "LOC" inside the PLAN section
  const ftInput  = page.locator('.modal-section:nth-of-type(2) input[disabled]').first();
  const ftValue  = await ftInput.inputValue().catch(() => null);
  const ftDisabled = await ftInput.isDisabled().catch(() => false);

  const i3ss   = await ss(page, 'I3_flight_type_loc_locked');
  const i3Pass = ftValue === 'LOC' && ftDisabled && jsErrors.length === 0;
  log('I3', 'Flight Type shows LOC and is disabled/read-only', i3Pass,
      `value=${ftValue} disabled=${ftDisabled} errors=${jsErrors.length}`,
      [i3ss]);

  // -----------------------------------------------------------------------
  // I4 — Departure AD shows EGOW and is disabled/read-only
  // -----------------------------------------------------------------------
  console.log('I4: Departure AD = EGOW, disabled');
  jsErrors.length = 0;

  // Find all disabled inputs in the modal, look for one with value EGOW that is labeled Departure AD
  // The plan section has locked inputs: LOC (index 0), EGOW dep (index 1), EGOW arr (index 2)
  const planSection = page.locator('.modal-section').nth(1);
  const disabledInputs = planSection.locator('input[disabled]');
  const disabledValues = [];
  const count = await disabledInputs.count();
  for (let i = 0; i < count; i++) {
    disabledValues.push(await disabledInputs.nth(i).inputValue());
  }

  const i4ss   = await ss(page, 'I4_dep_ad_egow_locked');
  // We expect EGOW to appear among the disabled values (dep AD = EGOW)
  const hasDepEgow = disabledValues.includes('EGOW');
  const i4Pass = hasDepEgow && count >= 2 && jsErrors.length === 0;
  log('I4', 'Departure AD shows EGOW and is disabled/read-only', i4Pass,
      `disabledValues=${JSON.stringify(disabledValues)} errors=${jsErrors.length}`,
      [i4ss]);

  // -----------------------------------------------------------------------
  // I5 — Arrival AD shows EGOW and is disabled/read-only
  // -----------------------------------------------------------------------
  console.log('I5: Arrival AD = EGOW, disabled');
  jsErrors.length = 0;

  // Both dep and arr AD should be EGOW and disabled — count occurrences
  const egowCount = disabledValues.filter(v => v === 'EGOW').length;

  const i5ss   = await ss(page, 'I5_arr_ad_egow_locked');
  const i5Pass = egowCount >= 2 && jsErrors.length === 0;
  log('I5', 'Arrival AD shows EGOW and is disabled/read-only', i5Pass,
      `egowCount=${egowCount} disabledValues=${JSON.stringify(disabledValues)} errors=${jsErrors.length}`,
      [i5ss]);

  // -----------------------------------------------------------------------
  // I6 — LOC timing: entering ETD does not auto-fill ETA (unchanged behavior)
  // -----------------------------------------------------------------------
  console.log('I6: LOC timing — ETD entry does not auto-fill ETA');
  jsErrors.length = 0;

  // The modal is still open from I1–I5 — ETD/ETA fields should be empty
  const etdBefore = await page.locator('#newLocStart').inputValue();
  const etaBefore = await page.locator('#newLocEnd').inputValue();

  // Enter ETD
  await page.fill('#newLocStart', '10:00');
  await page.locator('#newLocStart').dispatchEvent('input');
  await page.waitForTimeout(300);

  // ETA should remain unchanged (no auto-fill for LOC, preserving current behavior)
  const etaAfter = await page.locator('#newLocEnd').inputValue();

  const i6ss   = await ss(page, 'I6_timing_no_autofill');
  // Current LOC behavior: no auto-fill of ETA when ETD is entered
  const i6Pass = etaAfter === etaBefore && jsErrors.length === 0;
  log('I6', 'LOC timing: entering ETD does not auto-fill ETA (unchanged behavior)', i6Pass,
      `etdBefore=${etdBefore} etaBefore=${etaBefore} etaAfter=${etaAfter} errors=${jsErrors.length}`,
      [i6ss]);

  // -----------------------------------------------------------------------
  // I7 — Save LOC; reload; confirm depPlanned/arrPlanned persisted correctly
  // -----------------------------------------------------------------------
  console.log('I7: Save LOC movement and confirm persistence');
  jsErrors.length = 0;

  // Fill remaining required fields and save
  await page.fill('#newLocCallsignCode', 'WOODVALE');
  await page.fill('#newLocStart', '10:00');
  await page.fill('#newLocEnd',   '11:00');
  await page.fill('#newLocEgowCode', 'VM');

  await page.click('.js-save-loc');
  await page.waitForTimeout(600);

  const i7ssBefore = await ss(page, 'I7_after_save');

  // Reload and verify
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForApp(page);

  const i7Mvs = await getMovements(page);
  const i7Mv  = i7Mvs.find(m => m.callsignCode === 'WOODVALE' && m.flightType === 'LOC');
  const i7ssAfter = await ss(page, 'I7_after_reload');

  const i7Pass = i7Mv !== undefined &&
                 i7Mv.depPlanned === '10:00' &&
                 i7Mv.arrPlanned === '11:00' &&
                 i7Mv.depAd      === 'EGOW' &&
                 i7Mv.arrAd      === 'EGOW' &&
                 i7Mv.flightType === 'LOC' &&
                 i7Mv.egowCode   === 'VM' &&
                 jsErrors.length === 0;
  log('I7', 'Save LOC; reload; depPlanned/arrPlanned/depAd/arrAd/flightType persisted', i7Pass,
      `depPlanned=${i7Mv?.depPlanned} arrPlanned=${i7Mv?.arrPlanned} depAd=${i7Mv?.depAd} arrAd=${i7Mv?.arrAd} ft=${i7Mv?.flightType} errors=${jsErrors.length}`,
      [i7ssBefore, i7ssAfter]);

  // -----------------------------------------------------------------------
  // I8 — Edit LOC: flight type locked, dep/arr AD locked in edit modal
  // -----------------------------------------------------------------------
  console.log('I8: Edit LOC — flight type and AD fields locked');
  jsErrors.length = 0;

  if (i7Mv) {
    // Open edit modal for the saved LOC movement via the edit dropdown
    await page.locator('.js-edit-dropdown').first().click({ timeout: 5000 });
    await page.waitForTimeout(300);
    await page.locator('.js-edit-details').first().click({ timeout: 5000 });
    await page.waitForSelector('#editCallsignCode', { timeout: 5000 });

    // Check flight type select is disabled for LOC
    const editFtDisabled = await page.locator('#editFlightType').isDisabled().catch(() => false);
    const editFtValue    = await page.locator('#editFlightType').evaluate(el => el.value).catch(() => null);

    // Check dep/arr AD inputs are disabled
    const editDepAdDisabled = await page.locator('#editDepAd').isDisabled().catch(() => false);
    const editArrAdDisabled = await page.locator('#editArrAd').isDisabled().catch(() => false);
    const editDepAdValue    = await page.locator('#editDepAd').inputValue().catch(() => null);
    const editArrAdValue    = await page.locator('#editArrAd').inputValue().catch(() => null);

    const i8ss   = await ss(page, 'I8_edit_loc_locked_fields');
    const i8Pass = editFtDisabled && editFtValue === 'LOC' &&
                   editDepAdDisabled && editDepAdValue === 'EGOW' &&
                   editArrAdDisabled && editArrAdValue === 'EGOW' &&
                   jsErrors.length === 0;
    log('I8', 'Edit LOC: flight type locked to LOC, dep/arr AD locked to EGOW', i8Pass,
        `ftDisabled=${editFtDisabled} ft=${editFtValue} depAdDisabled=${editDepAdDisabled} depAd=${editDepAdValue} arrAdDisabled=${editArrAdDisabled} arrAd=${editArrAdValue} errors=${jsErrors.length}`,
        [i8ss]);
  } else {
    log('I8', 'Edit LOC: flight type locked to LOC, dep/arr AD locked to EGOW', false,
        'SKIP: I7 movement not found', []);
  }

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

  const resultsPath = path.join(EVIDENCE, 'sprint7_loc_standard_modal_results.json');
  fs.writeFileSync(
    resultsPath,
    JSON.stringify({
      timestamp: new Date().toISOString(),
      runMetadata: {
        sprint: 7,
        node: process.version,
        platform: process.platform,
        appUrl: APP_URL
      },
      summary: { passed, failed, total: RESULTS.length },
      results: RESULTS
    }, null, 2)
  );
  console.log(`\nEvidence: ${resultsPath}`);

  await browser.close();

  if (failed > 0) {
    console.log(`\nFAIL: ${failed} test(s) failed`);
    process.exit(1);
  } else {
    console.log('\nAll tests passed.');
  }
})();

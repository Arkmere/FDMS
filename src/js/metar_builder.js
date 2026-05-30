// metar_builder.js
// Structured METAR/SPECI builder for Vectair Flite.

import { getConfig, updateConfig } from './datamodel.js';

const STORAGE_KEY = 'vectair_fdms_metar_builder_last_v1';
const DEFAULT_STATION = 'EGOW';

// ── Temperature helpers ───────────────────────────────────────────────────────

function parseTempInput(v) {
  const s = String(v ?? '').trim().toUpperCase();
  if (!s) return NaN;
  if (s.startsWith('M')) return -parseInt(s.slice(1), 10);
  return parseInt(s, 10);
}

function formatTemp(v) {
  const n = parseTempInput(v);
  if (isNaN(n)) return '//';
  const abs = String(Math.abs(n)).padStart(2, '0');
  return n < 0 ? `M${abs}` : abs;
}

// ── Observation schedule ──────────────────────────────────────────────────────

function getScheduledMETARTime() {
  const cfg = getConfig();
  const schedule = (cfg.metarObservationSchedule) || { pattern: 'H20_H50' };
  const now = new Date();
  const currentHour = now.getUTCHours();
  const currentMin  = now.getUTCMinutes();

  let scheduledMins;
  if (schedule.pattern === 'H00_H30') {
    scheduledMins = [0, 30];
  } else if (schedule.pattern === 'H53') {
    scheduledMins = [53];
  } else {
    scheduledMins = [20, 50];
  }

  // Most recent past scheduled minute in current or previous hour
  let targetHour = currentHour;
  let targetMin  = null;
  for (let i = scheduledMins.length - 1; i >= 0; i--) {
    if (currentMin >= scheduledMins[i]) {
      targetMin = scheduledMins[i];
      break;
    }
  }
  if (targetMin === null) {
    targetHour = (currentHour - 1 + 24) % 24;
    targetMin  = scheduledMins[scheduledMins.length - 1];
  }

  const dd = String(now.getUTCDate()).padStart(2, '0');
  const hh = String(targetHour).padStart(2, '0');
  const mm = String(targetMin).padStart(2, '0');
  return `${dd}${hh}${mm}Z`;
}

function currentUtcTimeStr() {
  const now = new Date();
  return `${String(now.getUTCDate()).padStart(2,'0')}${String(now.getUTCHours()).padStart(2,'0')}${String(now.getUTCMinutes()).padStart(2,'0')}Z`;
}

// ── Colour state derivation (UK thresholds) ───────────────────────────────────

const COLOUR_THRESHOLDS = [
  { state: 'BLU',  visM: 8000, ceilFt: 2500 },
  { state: 'WHT',  visM: 5000, ceilFt: 1500 },
  { state: 'GRN',  visM: 3700, ceilFt:  700 },
  { state: 'YLO1', visM: 2500, ceilFt:  500 },
  { state: 'YLO2', visM: 1600, ceilFt:  300 },
  { state: 'AMB',  visM:  800, ceilFt:  200 },
];

function deriveColourState(vis, clouds, cavok) {
  if (cavok) return 'BLU';
  const visM = parseInt(vis, 10) || 0;
  let lowestBrokenFt = Infinity;
  (clouds || []).forEach(c => {
    if (['BKN', 'OVC'].includes(c.amount) && c.height) {
      const ft = parseInt(c.height, 10) * 100;
      if (ft < lowestBrokenFt) lowestBrokenFt = ft;
    }
  });
  const ceilFt = isFinite(lowestBrokenFt) ? lowestBrokenFt : Infinity;
  for (const t of COLOUR_THRESHOLDS) {
    if (visM >= t.visM && ceilFt >= t.ceilFt) return t.state;
  }
  return 'RED';
}

// ── Defaults ──────────────────────────────────────────────────────────────────

function getDefaultState() {
  return {
    reportType:           'METAR',
    station:              DEFAULT_STATION,
    time:                 getScheduledMETARTime(),
    windType:             'dir',
    windDir:              '360',
    windSpeed:            '10',
    windUnit:             'KT',
    windGust:             '',
    windVarFrom:          '',
    windVarTo:            '',
    cavok:                false,
    vis:                  '9999',
    rvr:                  '',
    rvrEnabled:           false,
    wxEnabled:            false,
    wxMode:               'structured',
    wxIntensity:          '',
    wxDescriptor:         '',
    wxPhenomenon:         '',
    wxManualText:         '',
    clouds:               [{ amount: 'FEW', height: '030', qualifier: '' }],
    cloudsEnabled:        true,
    tempC:                '10',
    dewC:                 '08',
    qnh:                  '1013',
    recentWxEnabled:      false,
    recentWxMode:         'structured',
    recentWxIntensity:    '',
    recentWxDescriptor:   '',
    recentWxPhenomenon:   '',
    recentWxManualText:   '',
    windShear:            '',
    windShearEnabled:     false,
    colourState:          '',
    colourEnabled:        false,
    colourManualOverride: false,
    rwyState:             '',
    rwyEnabled:           false,
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateState(s) {
  const errors = [];

  if (!/^[A-Z]{4}$/.test(s.station)) {
    errors.push('Station: must be four uppercase letters (e.g. EGOW).');
  }
  if (!/^\d{6}Z$/.test(s.time)) {
    errors.push('Time: must be DDHHMMZ (e.g. 011530Z).');
  }

  if (s.windType === 'dir') {
    if (!/^\d{3}$/.test(s.windDir)) errors.push('Wind direction: must be three digits (e.g. 270).');
    if (!/^\d{2,3}$/.test(s.windSpeed)) errors.push('Wind speed: must be 2–3 digits.');
    if (s.windGust) {
      if (!/^\d{2,3}$/.test(s.windGust)) {
        errors.push('Wind gust: must be 2–3 digits if provided.');
      } else {
        const gust  = parseInt(s.windGust,  10);
        const speed = parseInt(s.windSpeed, 10);
        if (!isNaN(gust) && !isNaN(speed) && gust < speed + 10) {
          errors.push(`Wind gust: gust (${gust} kt) must be at least 10 kt greater than mean wind (${speed} kt).`);
        }
      }
    }
    if (s.windVarFrom || s.windVarTo) {
      if (!/^\d{3}$/.test(s.windVarFrom) || !/^\d{3}$/.test(s.windVarTo)) {
        errors.push('Variable wind sector: both FROM and TO must be three digits.');
      }
    }
  }
  if (s.windType === 'vrb') {
    if (!/^\d{2,3}$/.test(s.windSpeed)) errors.push('Wind speed (VRB): must be 2–3 digits.');
  }

  if (!s.cavok) {
    if (!/^\d{4}$/.test(s.vis)) {
      errors.push('Visibility: must be a four-digit value (e.g. 9999).');
    }
    if (s.cloudsEnabled) {
      s.clouds.forEach((c, i) => {
        if (!['FEW', 'SCT', 'BKN', 'OVC', 'NSC', 'SKC', 'NCD'].includes(c.amount)) {
          errors.push(`Cloud layer ${i + 1}: invalid amount.`);
        }
        if (!['NSC', 'SKC', 'NCD'].includes(c.amount) && !/^\d{3}$/.test(c.height)) {
          errors.push(`Cloud layer ${i + 1}: height must be three digits (e.g. 030).`);
        }
      });
    }
  }

  if (isNaN(parseTempInput(s.tempC)) || String(s.tempC).trim() === '') {
    errors.push('Temperature: must be an integer (e.g. 10, -5, M05).');
  }
  if (isNaN(parseTempInput(s.dewC)) || String(s.dewC).trim() === '') {
    errors.push('Dew point: must be an integer (e.g. 08, -3, M03).');
  }
  if (!/^\d{3,4}$/.test(s.qnh)) errors.push('QNH: must be 3–4 digits (e.g. 1013).');

  return errors;
}

// ── WX group assembler ────────────────────────────────────────────────────────

function assembleWxGroup(mode, intensity, descriptor, phenomenon, manualText) {
  if (mode === 'manual') return (manualText || '').trim().toUpperCase();
  return (intensity || '') + (descriptor || '') + (phenomenon || '');
}

// ── METAR assembler ───────────────────────────────────────────────────────────

function buildReport(s) {
  const groups = [];

  groups.push(s.reportType);
  groups.push(s.station);
  groups.push(s.time);

  // Wind
  if (s.windType === 'calm') {
    groups.push('00000KT');
  } else if (s.windType === 'vrb') {
    groups.push(`VRB${String(s.windSpeed).padStart(2,'0')}${s.windUnit}`);
  } else {
    const dir = String(s.windDir).padStart(3, '0');
    const spd = String(s.windSpeed).padStart(2, '0');
    let w = `${dir}${spd}`;
    if (s.windGust) w += `G${String(s.windGust).padStart(2, '0')}`;
    w += s.windUnit;
    groups.push(w);
    if (s.windVarFrom && s.windVarTo) {
      groups.push(`${String(s.windVarFrom).padStart(3,'0')}V${String(s.windVarTo).padStart(3,'0')}`);
    }
  }

  // Visibility / CAVOK
  if (s.cavok) {
    groups.push('CAVOK');
  } else {
    groups.push(s.vis || '9999');
    if (s.rvrEnabled && s.rvr.trim()) groups.push(s.rvr.trim().toUpperCase());

    if (s.wxEnabled) {
      const wxGroup = assembleWxGroup(s.wxMode, s.wxIntensity, s.wxDescriptor, s.wxPhenomenon, s.wxManualText);
      if (wxGroup) groups.push(wxGroup);
    }

    if (s.cloudsEnabled && s.clouds.length) {
      s.clouds.forEach(c => {
        if (['NSC', 'SKC', 'NCD'].includes(c.amount)) {
          groups.push(c.amount);
        } else {
          groups.push(`${c.amount}${String(c.height).padStart(3,'0')}${c.qualifier || ''}`);
        }
      });
    }
  }

  groups.push(`${formatTemp(s.tempC)}/${formatTemp(s.dewC)}`);
  groups.push(`Q${String(s.qnh).padStart(4,'0')}`);

  // Recent weather
  if (s.recentWxEnabled) {
    const code = assembleWxGroup(s.recentWxMode, s.recentWxIntensity, s.recentWxDescriptor, s.recentWxPhenomenon, s.recentWxManualText);
    if (code) {
      // In manual mode, strip leading RE to avoid double prefix, then re-add
      const stripped = s.recentWxMode === 'manual' && code.startsWith('RE') ? code.slice(2) : code;
      groups.push(`RE${stripped}`);
    }
  }

  if (s.windShearEnabled && s.windShear.trim())  groups.push(`WS ${s.windShear.trim().toUpperCase()}`);
  if (s.colourEnabled    && s.colourState.trim()) groups.push(s.colourState.trim().toUpperCase());
  if (s.rwyEnabled       && s.rwyState.trim())    groups.push(s.rwyState.trim().toUpperCase());

  return groups.join(' ') + '=';
}

// ── localStorage ──────────────────────────────────────────────────────────────

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Migrate legacy plain-text wx fields from v1
    if (parsed.wx !== undefined && parsed.wxMode === undefined) {
      parsed.wxMode = 'manual';
      parsed.wxManualText = parsed.wx || '';
      delete parsed.wx;
    }
    if (parsed.recentWx !== undefined && parsed.recentWxMode === undefined) {
      parsed.recentWxMode = 'manual';
      parsed.recentWxManualText = parsed.recentWx || '';
      delete parsed.recentWx;
    }
    return parsed;
  } catch (_) {
    return null;
  }
}

function saveState(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (_) {}
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function el(id)         { return document.getElementById(id); }
function setVal(id, v)  { const e = el(id); if (e) e.value = v; }
function setChecked(id, v) { const e = el(id); if (e) e.checked = !!v; }
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Cloud row builder ─────────────────────────────────────────────────────────

function buildCloudRow(idx, cloud) {
  const amounts   = ['FEW','SCT','BKN','OVC','NSC','SKC','NCD'];
  const amtOpts   = amounts.map(a =>
    `<option value="${a}"${a === cloud.amount ? ' selected' : ''}>${a}</option>`
  ).join('');
  const noHeight  = ['NSC','SKC','NCD'].includes(cloud.amount);
  const heightHtml = noHeight
    ? `<input type="text" class="mb-cloud-height" style="width:56px;opacity:0.4;pointer-events:none;" value="" disabled placeholder="---" />`
    : `<input type="text" class="mb-cloud-height" maxlength="3" style="width:56px;" value="${cloud.height || '030'}" placeholder="030" />`;
  const qualOpts  = ['','TCU','CB'].map(q =>
    `<option value="${q}"${q === (cloud.qualifier||'') ? ' selected' : ''}>${q||'—'}</option>`
  ).join('');
  const qualHtml  = noHeight
    ? `<select class="mb-cloud-qualifier" disabled style="opacity:0.4;">${qualOpts}</select>`
    : `<select class="mb-cloud-qualifier">${qualOpts}</select>`;
  return `
    <div class="mb-cloud-row" data-cloud-idx="${idx}">
      <select class="mb-cloud-amount">${amtOpts}</select>
      ${heightHtml}
      <label class="mb-cloud-qual-label">TCU/CB</label>
      ${qualHtml}
      <button type="button" class="btn btn-ghost btn-small mb-cloud-remove" title="Remove layer">×</button>
    </div>`;
}

// ── Wind section sync ─────────────────────────────────────────────────────────

function syncWindUi(windType) {
  const dirRow  = el('mbWindDirRow');
  const vrbRow  = el('mbWindVrbNote');
  const varRow  = el('mbWindVarRow');
  if (dirRow)  dirRow.style.display  = windType === 'dir' ? '' : 'none';
  if (vrbRow)  vrbRow.style.display  = windType === 'vrb' ? '' : 'none';
  if (varRow)  varRow.style.display  = windType === 'dir' ? '' : 'none';
}

function syncCavokUi(cavok) {
  ['mbVisSection','mbWxSection','mbCloudSection'].forEach(id => {
    const e = el(id);
    if (e) e.style.display = cavok ? 'none' : '';
  });
}

function syncWxMode(mode, prefix) {
  const structEl = el(`mb${prefix}WxStructured`);
  const manualEl = el(`mb${prefix}WxManual`);
  if (structEl) structEl.style.display = mode === 'structured' ? '' : 'none';
  if (manualEl) manualEl.style.display = mode === 'manual'     ? '' : 'none';
}

// ── Colour indicator ──────────────────────────────────────────────────────────

function updateColourAutoIndicator(isManual) {
  const ind = el('mbColourAutoIndicator');
  if (!ind) return;
  ind.textContent = isManual ? 'Manual' : 'Auto';
  ind.className   = isManual
    ? 'mb-colour-indicator mb-colour-indicator--manual'
    : 'mb-colour-indicator mb-colour-indicator--auto';
}

// ── Read form state ────────────────────────────────────────────────────────────

function readFormState() {
  const windType = document.querySelector('input[name="mbWindType"]:checked')?.value   || 'dir';
  const wxMode   = document.querySelector('input[name="mbWxMode"]:checked')?.value     || 'structured';
  const rwxMode  = document.querySelector('input[name="mbRecentWxMode"]:checked')?.value || 'structured';
  const colourManualOverride = el('mbColour')?.dataset.manualOverride === 'true';

  const clouds = [];
  document.querySelectorAll('.mb-cloud-row').forEach(row => {
    clouds.push({
      amount:    row.querySelector('.mb-cloud-amount')?.value    || 'FEW',
      height:    row.querySelector('.mb-cloud-height')?.value    || '030',
      qualifier: row.querySelector('.mb-cloud-qualifier')?.value || '',
    });
  });

  return {
    reportType:           el('mbReportType')?.value || 'METAR',
    station:              (el('mbStation')?.value   || DEFAULT_STATION).toUpperCase().trim(),
    time:                 (el('mbTime')?.value       || '').toUpperCase().trim(),
    windType,
    windDir:              el('mbWindDir')?.value      || '360',
    windSpeed:            windType === 'vrb'
                            ? (el('mbWindSpeedVrb')?.value || '05')
                            : (el('mbWindSpeed')?.value    || '10'),
    windUnit:             el('mbWindUnit')?.value     || 'KT',
    windGust:             el('mbWindGust')?.value     || '',
    windVarFrom:          el('mbWindVarFrom')?.value  || '',
    windVarTo:            el('mbWindVarTo')?.value    || '',
    cavok:                el('mbCavok')?.checked      || false,
    vis:                  el('mbVis')?.value          || '9999',
    rvr:                  el('mbRvr')?.value          || '',
    rvrEnabled:           el('mbRvrEnabled')?.checked || false,
    wxEnabled:            el('mbWxEnabled')?.checked  || false,
    wxMode,
    wxIntensity:          el('mbWxIntensity')?.value  || '',
    wxDescriptor:         el('mbWxDescriptor')?.value || '',
    wxPhenomenon:         el('mbWxPhenomenon')?.value || '',
    wxManualText:         el('mbWxManualText')?.value || '',
    clouds,
    cloudsEnabled:        el('mbCloudsEnabled')?.checked !== false,
    tempC:                el('mbTemp')?.value         || '10',
    dewC:                 el('mbDew')?.value          || '08',
    qnh:                  el('mbQnh')?.value          || '1013',
    recentWxEnabled:      el('mbRecentWxEnabled')?.checked   || false,
    recentWxMode:         rwxMode,
    recentWxIntensity:    el('mbRecentWxIntensity')?.value   || '',
    recentWxDescriptor:   el('mbRecentWxDescriptor')?.value  || '',
    recentWxPhenomenon:   el('mbRecentWxPhenomenon')?.value  || '',
    recentWxManualText:   el('mbRecentWxManualText')?.value  || '',
    windShear:            el('mbWindShear')?.value    || '',
    windShearEnabled:     el('mbWindShearEnabled')?.checked || false,
    colourState:          el('mbColour')?.value       || '',
    colourEnabled:        el('mbColourEnabled')?.checked || false,
    colourManualOverride,
    rwyState:             el('mbRwyState')?.value     || '',
    rwyEnabled:           el('mbRwyEnabled')?.checked || false,
  };
}

// ── Apply state to form ────────────────────────────────────────────────────────

function applyStateToForm(s) {
  setVal('mbReportType', s.reportType);
  setVal('mbStation',    s.station);
  setVal('mbTime',       s.time);

  const windRadio = document.querySelector(`input[name="mbWindType"][value="${s.windType}"]`);
  if (windRadio) windRadio.checked = true;
  setVal('mbWindDir',      s.windDir);
  setVal('mbWindSpeed',    s.windType !== 'vrb' ? s.windSpeed : '10');
  setVal('mbWindSpeedVrb', s.windType === 'vrb' ? s.windSpeed : '');
  setVal('mbWindUnit',     s.windUnit);
  setVal('mbWindGust',     s.windGust);
  setVal('mbWindVarFrom',  s.windVarFrom);
  setVal('mbWindVarTo',    s.windVarTo);
  setChecked('mbCavok',    s.cavok);
  setVal('mbVis',          s.vis);
  setVal('mbRvr',          s.rvr);
  setChecked('mbRvrEnabled', s.rvrEnabled);

  setChecked('mbWxEnabled', s.wxEnabled);
  const wxModeRadio = document.querySelector(`input[name="mbWxMode"][value="${s.wxMode || 'structured'}"]`);
  if (wxModeRadio) wxModeRadio.checked = true;
  setVal('mbWxIntensity',  s.wxIntensity  || '');
  setVal('mbWxDescriptor', s.wxDescriptor || '');
  setVal('mbWxPhenomenon', s.wxPhenomenon || '');
  setVal('mbWxManualText', s.wxManualText || '');
  syncWxMode(s.wxMode || 'structured', '');

  setChecked('mbCloudsEnabled', s.cloudsEnabled);

  setVal('mbTemp', s.tempC);
  setVal('mbDew',  s.dewC);
  setVal('mbQnh',  s.qnh);

  setChecked('mbRecentWxEnabled', s.recentWxEnabled);
  const rwxModeRadio = document.querySelector(`input[name="mbRecentWxMode"][value="${s.recentWxMode || 'structured'}"]`);
  if (rwxModeRadio) rwxModeRadio.checked = true;
  setVal('mbRecentWxIntensity',  s.recentWxIntensity  || '');
  setVal('mbRecentWxDescriptor', s.recentWxDescriptor || '');
  setVal('mbRecentWxPhenomenon', s.recentWxPhenomenon || '');
  setVal('mbRecentWxManualText', s.recentWxManualText || '');
  syncWxMode(s.recentWxMode || 'structured', 'Recent');

  setVal('mbWindShear',   s.windShear);
  setChecked('mbWindShearEnabled', s.windShearEnabled);

  setChecked('mbColourEnabled', s.colourEnabled);
  setVal('mbColour', s.colourState || '');
  if (el('mbColour')) el('mbColour').dataset.manualOverride = s.colourManualOverride ? 'true' : 'false';
  updateColourAutoIndicator(!!s.colourManualOverride);

  setVal('mbRwyState', s.rwyState);
  setChecked('mbRwyEnabled', s.rwyEnabled);

  renderCloudList(s.clouds);
  syncWindUi(s.windType);
  syncCavokUi(s.cavok);
}

// ── Cloud list render ──────────────────────────────────────────────────────────

function renderCloudList(clouds) {
  const list = el('mbCloudList');
  if (!list) return;
  list.innerHTML = clouds.map((c, i) => buildCloudRow(i, c)).join('');
  bindCloudRows();
}

function bindCloudRows() {
  document.querySelectorAll('.mb-cloud-row').forEach(row => {
    const amountSel = row.querySelector('.mb-cloud-amount');
    const qualSel   = row.querySelector('.mb-cloud-qualifier');
    amountSel?.addEventListener('change', () => {
      const noHeight = ['NSC','SKC','NCD'].includes(amountSel.value);
      const hEl = row.querySelector('.mb-cloud-height');
      if (hEl) {
        hEl.disabled = noHeight;
        hEl.style.opacity = noHeight ? '0.4' : '';
        hEl.style.pointerEvents = noHeight ? 'none' : '';
        if (noHeight) hEl.value = '';
      }
      if (qualSel) {
        qualSel.disabled = noHeight;
        qualSel.style.opacity = noHeight ? '0.4' : '';
        if (noHeight) qualSel.value = '';
      }
      handleChange();
    });
    row.querySelector('.mb-cloud-remove')?.addEventListener('click', () => {
      row.remove();
      handleChange();
    });
    row.querySelector('.mb-cloud-height')?.addEventListener('input', handleChange);
    qualSel?.addEventListener('change', handleChange);
  });
}

// ── Output update ─────────────────────────────────────────────────────────────

function handleChange() {
  const s = readFormState();

  // Auto-populate colour state when enabled and not manually overridden
  if (s.colourEnabled && !s.colourManualOverride) {
    const auto = deriveColourState(s.vis, s.clouds, s.cavok);
    if (el('mbColour')) el('mbColour').value = auto;
    s.colourState = auto;
  }

  const errors   = validateState(s);
  const outputEl = el('mbOutput');
  const validEl  = el('mbValidation');
  const copyBtn  = el('mbCopyBtn');

  if (outputEl) outputEl.textContent = buildReport(s);

  if (validEl) {
    if (errors.length) {
      validEl.innerHTML = errors.map(e => `<div class="mb-error-item">⚠ ${escHtml(e)}</div>`).join('');
      validEl.className = 'mb-validation mb-validation--errors';
    } else {
      validEl.innerHTML = '<div class="mb-ok-item">✓ All enabled groups valid.</div>';
      validEl.className = 'mb-validation mb-validation--ok';
    }
  }

  if (copyBtn) copyBtn.disabled = errors.length > 0;
}

function showCopyFeedback(msg) {
  const fb = el('mbCopyFeedback');
  if (!fb) return;
  fb.textContent = msg;
  fb.style.visibility = 'visible';
  setTimeout(() => { fb.style.visibility = 'hidden'; }, 2500);
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initMetarBuilder() {
  if (!el('tab-metar')) return;

  applyStateToForm(getDefaultState());
  handleChange();

  // Report type — auto-set time on switch
  el('mbReportType')?.addEventListener('change', () => {
    const type = el('mbReportType').value;
    setVal('mbTime', type === 'METAR' ? getScheduledMETARTime() : currentUtcTimeStr());
    handleChange();
  });

  el('mbStation')?.addEventListener('input', handleChange);
  el('mbTime')?.addEventListener('input', handleChange);

  el('mbTimeNow')?.addEventListener('click', () => {
    const type = el('mbReportType')?.value || 'METAR';
    setVal('mbTime', type === 'METAR' ? getScheduledMETARTime() : currentUtcTimeStr());
    handleChange();
  });

  document.querySelectorAll('input[name="mbWindType"]').forEach(r =>
    r.addEventListener('change', () => { syncWindUi(r.value); handleChange(); })
  );

  ['mbWindDir','mbWindSpeed','mbWindSpeedVrb','mbWindUnit','mbWindGust','mbWindVarFrom','mbWindVarTo'].forEach(id => {
    el(id)?.addEventListener('input', handleChange);
    el(id)?.addEventListener('change', handleChange);
  });

  el('mbCavok')?.addEventListener('change', () => {
    syncCavokUi(el('mbCavok').checked);
    handleChange();
  });

  el('mbVis')?.addEventListener('input', handleChange);
  el('mbRvr')?.addEventListener('input', handleChange);
  el('mbRvrEnabled')?.addEventListener('change', handleChange);

  // Present weather
  document.querySelectorAll('input[name="mbWxMode"]').forEach(r =>
    r.addEventListener('change', () => { syncWxMode(r.value, ''); handleChange(); })
  );
  ['mbWxEnabled','mbWxIntensity','mbWxDescriptor','mbWxPhenomenon'].forEach(id =>
    el(id)?.addEventListener('change', handleChange)
  );
  el('mbWxManualText')?.addEventListener('input', handleChange);

  // Cloud
  el('mbCloudsEnabled')?.addEventListener('change', handleChange);
  el('mbAddCloud')?.addEventListener('click', () => {
    const list = el('mbCloudList');
    if (!list) return;
    const idx = list.querySelectorAll('.mb-cloud-row').length;
    const div = document.createElement('div');
    div.innerHTML = buildCloudRow(idx, { amount: 'SCT', height: '030', qualifier: '' });
    list.appendChild(div.firstElementChild);
    bindCloudRows();
    handleChange();
  });

  ['mbTemp','mbDew','mbQnh'].forEach(id => el(id)?.addEventListener('input', handleChange));

  // Recent weather
  document.querySelectorAll('input[name="mbRecentWxMode"]').forEach(r =>
    r.addEventListener('change', () => { syncWxMode(r.value, 'Recent'); handleChange(); })
  );
  ['mbRecentWxEnabled','mbRecentWxIntensity','mbRecentWxDescriptor','mbRecentWxPhenomenon'].forEach(id =>
    el(id)?.addEventListener('change', handleChange)
  );
  el('mbRecentWxManualText')?.addEventListener('input', handleChange);

  el('mbWindShear')?.addEventListener('input', handleChange);
  el('mbWindShearEnabled')?.addEventListener('change', handleChange);

  // Colour state — manual override tracking
  el('mbColourEnabled')?.addEventListener('change', handleChange);
  el('mbColour')?.addEventListener('change', () => {
    if (el('mbColour')) {
      el('mbColour').dataset.manualOverride = 'true';
      updateColourAutoIndicator(true);
    }
    handleChange();
  });
  el('mbColourAutoBtn')?.addEventListener('click', () => {
    if (el('mbColour')) {
      el('mbColour').dataset.manualOverride = 'false';
      updateColourAutoIndicator(false);
    }
    handleChange();
  });

  el('mbRwyState')?.addEventListener('input', handleChange);
  el('mbRwyEnabled')?.addEventListener('change', handleChange);

  // Copy
  el('mbCopyBtn')?.addEventListener('click', () => {
    const text = el('mbOutput')?.textContent || '';
    saveState(readFormState());
    navigator.clipboard.writeText(text).then(() => {
      showCopyFeedback('Copied!');
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showCopyFeedback('Copied!');
    });
  });

  // Reset
  el('mbResetBtn')?.addEventListener('click', () => {
    applyStateToForm(getDefaultState());
    handleChange();
  });

  // Recall Previous
  el('mbRecallBtn')?.addEventListener('click', () => {
    const saved = loadSaved();
    if (saved) {
      applyStateToForm({ ...getDefaultState(), ...saved });
      handleChange();
      showCopyFeedback('Previous observation recalled.');
    } else {
      showCopyFeedback('No previous observation saved.');
    }
  });
}

// ── Admin Weather section ─────────────────────────────────────────────────────

export function initAdminWeather() {
  const saveBtn   = el('adminWeatherSave');
  const patternEl = el('adminWeatherPattern');
  const rateEl    = el('adminWeatherRate');
  if (!saveBtn || !patternEl || !rateEl) return;

  const cfg      = getConfig();
  const schedule = cfg.metarObservationSchedule || { pattern: 'H20_H50', rate: 'bi-hourly' };
  setVal('adminWeatherPattern', schedule.pattern || 'H20_H50');
  setVal('adminWeatherRate',    schedule.rate    || 'bi-hourly');

  saveBtn.addEventListener('click', () => {
    updateConfig({
      metarObservationSchedule: {
        pattern: patternEl.value,
        rate:    rateEl.value,
      },
    });
    const st = el('adminWeatherStatus');
    if (st) {
      st.textContent = 'Saved.';
      st.style.visibility = 'visible';
      setTimeout(() => { st.style.visibility = 'hidden'; }, 2000);
    }
  });
}

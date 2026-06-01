// metar_builder.js
// Structured METAR/SPECI builder for Vectair Flite — CAP 746 Issue 6 compliant.

import { getConfig, updateConfig } from './datamodel.js';

const STORAGE_KEY    = 'vectair_fdms_metar_builder_last_v1';
const DEFAULT_STATION = 'EGOW';

// ── Temperature helpers ───────────────────────────────────────────────────────

function isValidMetarTempInput(v) {
  const s = String(v ?? '').trim().toUpperCase();
  return /^-?\d{1,2}$/.test(s) || /^M\d{1,2}$/.test(s);
}

function parseMetarTempInput(v) {
  const s = String(v ?? '').trim().toUpperCase();
  if (!isValidMetarTempInput(s)) return NaN;
  if (s.startsWith('M')) return -parseInt(s.slice(1), 10);
  return parseInt(s, 10);
}

function formatMetarTemp(v) {
  const n = parseMetarTempInput(v);
  if (isNaN(n)) return '//';
  return (n < 0 ? 'M' : '') + String(Math.abs(n)).padStart(2, '0');
}

// ── Recent weather token normaliser ──────────────────────────────────────────

function normalizeRecentWeatherToken(raw) {
  const token = String(raw || '').trim().toUpperCase();
  if (!token) return '';
  return token.startsWith('RE') ? token : `RE${token}`;
}

// ── Observation schedule ──────────────────────────────────────────────────────

function formatDateAsMetarTime(d) {
  return `${String(d.getUTCDate()).padStart(2,'0')}${String(d.getUTCHours()).padStart(2,'0')}${String(d.getUTCMinutes()).padStart(2,'0')}Z`;
}

function getScheduledMins(schedule) {
  if (schedule.pattern === 'H53') return [53];
  if (schedule.rate === 'hourly') {
    const m = parseInt(schedule.hourlyMinute, 10);
    if (!isNaN(m)) return [m];
    return schedule.pattern === 'H00_H30' ? [0] : [50];
  }
  return schedule.pattern === 'H00_H30' ? [0, 30] : [20, 50];
}

function getScheduledMETARTime() {
  const cfg = getConfig();
  const schedule = cfg.metarObservationSchedule || { pattern: 'H20_H50', rate: 'bi-hourly', hourlyMinute: '50' };
  const scheduledMins = getScheduledMins(schedule);
  const now = new Date();
  const WINDOW_MS = 5 * 60 * 1000;

  const candidates = [];
  for (let hourOffset = -2; hourOffset <= 2; hourOffset++) {
    for (const min of scheduledMins) {
      const cand = new Date(now);
      cand.setUTCHours(now.getUTCHours() + hourOffset, min, 0, 0);
      candidates.push(cand);
    }
  }
  candidates.sort((a, b) => a - b);

  for (const cand of candidates) {
    if (now >= cand && now <= new Date(cand.getTime() + WINDOW_MS)) {
      return formatDateAsMetarTime(cand);
    }
  }
  for (const cand of candidates) {
    if (cand > now) return formatDateAsMetarTime(cand);
  }
  return formatDateAsMetarTime(candidates[candidates.length - 1]);
}

function currentUtcTimeStr() {
  return formatDateAsMetarTime(new Date());
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

const SIGNIFICANT_CLOUD = new Set(['SCT', 'BKN', 'OVC']);

function deriveColourState(vis, clouds, cavok) {
  if (cavok) return 'BLU';
  const visM = parseInt(vis, 10) || 0;
  let lowestSignificantFt = Infinity;
  (clouds || []).forEach(c => {
    if (SIGNIFICANT_CLOUD.has(c.amount) && c.height) {
      const ft = parseInt(c.height, 10) * 100;
      if (ft < lowestSignificantFt) lowestSignificantFt = ft;
    }
  });
  const ceilFt = isFinite(lowestSignificantFt) ? lowestSignificantFt : Infinity;
  for (const t of COLOUR_THRESHOLDS) {
    if (visM >= t.visM && ceilFt >= t.ceilFt) return t.state;
  }
  return 'RED';
}

// ── CAP 746 WX compatibility validator — blocking errors ─────────────────────

const PRECIP_PHENOM = new Set(['RA','DZ','SN','SG','IC','PL','GR','GS','UP']);

// Phenomena valid in the secondary/tertiary precipitation slots
const PRECIP_LIST = ['RA','DZ','SN','SG','PL','GR','GS'];

// Accepts a full group object {intensity, descriptor, phenom1, phenom2, phenom3}
function validateWxCompatibility(group, vis, tempC) {
  const { intensity, descriptor } = group;
  // Backwards-compat: old saves may use 'phenomenon' instead of 'phenom1'
  const phenom1 = group.phenom1 !== undefined ? group.phenom1 : (group.phenomenon || '');
  const phenom2 = group.phenom2 || '';
  const phenom3 = group.phenom3 || '';
  const errors   = [];
  const warnings = [];

  // TS alone (with or without VC) is a valid terminal group — no further checks
  if (descriptor === 'TS' && !phenom1) return { errors, warnings };

  // ── GR/GS require SH or TS (CAP 746) ────────────────────────────────────
  const hasGRorGS = [phenom1, phenom2, phenom3].some(p => p === 'GR' || p === 'GS');
  if (hasGRorGS && descriptor !== 'SH' && descriptor !== 'TS') {
    errors.push('GR/GS must be reported with SH (shower) or TS (thunderstorm) (CAP 746).');
  }

  // ── Intensity +/− only applies to precipitation ──────────────────────────
  if (intensity === '+' || intensity === '-') {
    if (!PRECIP_PHENOM.has(phenom1)) {
      errors.push(`Intensity '${intensity}' is only valid for precipitation. '${phenom1 || '(none)'}' does not permit +/− intensity (CAP 746).`);
    }
  }

  // ── VC (in vicinity) permitted combinations ──────────────────────────────
  if (intensity === 'VC' && (descriptor || phenom1)) {
    const VC_PHENOM_ALONE = new Set(['FG','PO','FC','DS','SS']);
    const vcOk =
      (descriptor === 'TS') ||
      (VC_PHENOM_ALONE.has(phenom1) && !descriptor) ||
      (descriptor === 'SH') ||
      (descriptor === 'BL' && ['DU','SA','SN'].includes(phenom1));
    if (!vcOk) {
      errors.push(`VC with '${descriptor||''}${phenom1||''}' is not a valid CAP 746 combination. Permitted: VCTS, VCFG, VCSH, VCPO, VCFC, VCDS, VCSS, VCBLSN/DU/SA.`);
    }
  }

  // ── Descriptor / phenomenon compatibility ────────────────────────────────

  if ((descriptor === 'MI' || descriptor === 'BC' || descriptor === 'PR') && phenom1 !== 'FG') {
    errors.push(`Descriptor '${descriptor}' requires FG as phenomenon (CAP 746).`);
  }
  if ((descriptor === 'DR' || descriptor === 'BL') && !['DU','SA','SN'].includes(phenom1)) {
    errors.push(`Descriptor '${descriptor}' requires DU, SA, or SN as phenomenon (CAP 746).`);
  }
  if (descriptor === 'SH' && !PRECIP_PHENOM.has(phenom1)) {
    errors.push('SH (shower) requires a precipitation phenomenon (CAP 746).');
  }
  // FZ valid only with DZ, RA, FG, UP — FZSN is not a valid CAP 746 code
  if (descriptor === 'FZ' && !['DZ','RA','FG','UP'].includes(phenom1)) {
    errors.push(`FZ (freezing) requires DZ, RA, FG, or UP. '${phenom1}' is not valid with FZ — FZSN is not a CAP 746 code.`);
  }
  if (descriptor === 'TS' && phenom1 && !PRECIP_PHENOM.has(phenom1)) {
    errors.push(`TS (thunderstorm) requires a precipitation phenomenon or must stand alone. '${phenom1}' is not valid with TS (CAP 746).`);
  }

  // ── FG / BR / HZ visibility checks (blocking) ────────────────────────────
  const visM   = parseInt(vis, 10);
  const hasVis = /^\d{4}$/.test(vis);

  if (phenom1 === 'FG') {
    const isVicinity  = intensity === 'VC';
    const isFZFG      = descriptor === 'FZ';
    const isException = ['MI','BC','PR'].includes(descriptor);

    if (isFZFG) {
      if (!hasVis) {
        errors.push('FZFG: visibility is required to validate this combination.');
      } else if (visM >= 1000) {
        errors.push(`FZFG: visibility must be < 1000 m (currently ${vis} m) (CAP 746).`);
      }
      const tNum = parseMetarTempInput(tempC);
      if (!isNaN(tNum) && tNum >= 0) {
        errors.push(`FZFG (freezing fog): temperature must be below 0°C (currently ${tempC}°C).`);
      }
    } else if (!isVicinity && !isException) {
      if (!hasVis) {
        errors.push('FG (fog): visibility must be entered to validate this combination.');
      } else if (visM >= 1000) {
        errors.push(`FG (fog): visibility must be < 1000 m (currently ${vis} m). Use BR (mist) for 1000–5000 m (CAP 746).`);
      }
    }
  }

  if (phenom1 === 'BR') {
    if (intensity !== 'VC') {
      if (!hasVis) {
        errors.push('BR (mist): visibility must be entered to validate this combination.');
      } else {
        if (visM < 1000) errors.push(`BR (mist): visibility must be ≥ 1000 m (currently ${vis} m). Use FG for vis < 1000 m (CAP 746).`);
        if (visM > 5000) errors.push(`BR (mist): visibility must be ≤ 5000 m (currently ${vis} m). Use HZ for vis > 5000 m (CAP 746).`);
      }
    }
  }

  if (phenom1 === 'HZ' && hasVis && visM < 1000) {
    errors.push(`HZ (haze): visibility should be ≥ 1000 m (currently ${vis} m) (CAP 746).`);
  }

  return { errors, warnings };
}

// ── Defaults (no operational values — all blank) ──────────────────────────────

function getDefaultState() {
  return {
    reportType:           'METAR',
    station:              DEFAULT_STATION,
    time:                 getScheduledMETARTime(),
    windType:             'dir',
    windDir:              '',
    windSpeed:            '',
    windUnit:             'KT',
    windGust:             '',
    windVarFrom:          '',
    windVarTo:            '',
    cavok:                false,
    vis:                  '',
    rvr:                  '',
    rvrEnabled:           false,
    wxEnabled:            false,
    wxMode:               'structured',
    wxGroups:             [],
    wxManualText:         '',
    clouds:               [],
    cloudsEnabled:        true,
    tempC:                '',
    dewC:                 '',
    qnh:                  '',
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
  const errors   = [];  // blocks Copy
  const warnings = [];  // informational only

  if (!/^[A-Z]{4}$/.test(s.station)) {
    errors.push('Station: must be four uppercase letters (e.g. EGOW).');
  }
  if (!/^\d{6}Z$/.test(s.time)) {
    errors.push('Time: must be DDHHMMZ (e.g. 011530Z).');
  }

  if (s.windType === 'dir') {
    if (!s.windDir.trim()) {
      errors.push('Wind direction: required (010–360).');
    } else if (!/^\d{3}$/.test(s.windDir)) {
      errors.push('Wind direction: must be exactly three digits (e.g. 270).');
    } else {
      const d = parseInt(s.windDir, 10);
      if (d < 1 || d > 360) {
        errors.push('Wind direction: must be 010–360. Use Calm (00000KT) for still air.');
      }
    }
    if (!s.windSpeed.trim()) {
      errors.push('Wind speed: required.');
    } else if (!/^\d{2,3}$/.test(s.windSpeed)) {
      errors.push('Wind speed: must be 2–3 digits.');
    }
    if (s.windGust) {
      if (!/^\d{2,3}$/.test(s.windGust)) {
        errors.push('Wind gust: must be 2–3 digits if provided.');
      } else {
        const gust  = parseInt(s.windGust,  10);
        const speed = parseInt(s.windSpeed, 10);
        if (!isNaN(gust) && !isNaN(speed) && gust < speed + 10) {
          errors.push('Wind gust: gust must be at least 10 kt greater than the mean wind speed.');
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
    if (!s.windSpeed.trim()) {
      errors.push('Wind speed (VRB): required.');
    } else if (!/^\d{2,3}$/.test(s.windSpeed)) {
      errors.push('Wind speed (VRB): must be 2–3 digits.');
    }
  }

  if (!s.cavok) {
    if (!s.vis.trim()) {
      errors.push('Visibility: required when CAVOK is not set.');
    } else if (!/^\d{4}$/.test(s.vis)) {
      errors.push('Visibility: must be a four-digit value (e.g. 9999).');
    }

    if (s.rvrEnabled) {
      if (!s.rvr.trim()) {
        errors.push('RVR: enabled but no group entered (e.g. R28/0800).');
      }
    }

    if (!s.cloudsEnabled || !s.clouds.length) {
      errors.push('Cloud: at least one layer required when CAVOK is not set. Use NSC if no significant cloud.');
    } else {
      s.clouds.forEach((c, i) => {
        if (!['FEW','SCT','BKN','OVC','NSC'].includes(c.amount)) {
          errors.push(`Cloud layer ${i + 1}: invalid amount.`);
        }
        if (c.amount !== 'NSC' && !/^\d{3}$/.test(c.height)) {
          errors.push(`Cloud layer ${i + 1}: height must be three digits (e.g. 030).`);
        }
      });
    }
  } else {
    warnings.push('CAVOK: use only when visibility is 10 km or more, no cloud below 5000 ft or MSA, and no significant weather (CAP 746).');
  }

  if (s.wxEnabled) {
    if (s.wxMode === 'structured') {
      const groups = s.wxGroups || [];
      const anyFilled = groups.some(g => {
        const p1 = g.phenom1 !== undefined ? g.phenom1 : (g.phenomenon || '');
        return p1 || g.descriptor === 'TS';
      });
      if (!groups.length || !anyFilled) {
        errors.push('Present Weather: select at least one phenomenon (TS alone is also valid) or disable the section.');
      } else {
        groups.forEach((g, i) => {
          const compat = validateWxCompatibility(g, s.vis, s.tempC);
          compat.errors.forEach(msg => errors.push(`WX group ${i + 1}: ${msg}`));
          compat.warnings.forEach(msg => warnings.push(`WX group ${i + 1}: ${msg}`));
        });

        // Block multiple separate pure-precipitation groups (CAP 746: combine into one)
        const PURE_PRECIP = new Set(['DZ','RA','SN','SG','PL','GR','GS']);
        const purePrecipGroups = groups.filter(g => {
          const p1 = g.phenom1 !== undefined ? g.phenom1 : (g.phenomenon || '');
          return !g.descriptor && g.intensity !== 'VC' && PURE_PRECIP.has(p1);
        });
        if (purePrecipGroups.length > 1) {
          errors.push('Present Weather: simultaneous precipitation types must be combined into one group with the dominant type first, not entered as separate groups (CAP 746).');
        }

        const hasTS = groups.some(g => g.descriptor === 'TS');
        const hasCB = (s.clouds || []).some(c => c.qualifier === 'CB');
        if (hasTS && !hasCB) {
          warnings.push('TS in present weather without a CB cloud qualifier — consider adding CB to the relevant cloud layer (CAP 746).');
        }
      }
    } else {
      if (!s.wxManualText.trim()) {
        errors.push('Present Weather: enter a manual weather group or disable the section.');
      }
    }
  }

  if (s.recentWxEnabled) {
    if (s.recentWxMode === 'structured') {
      if (!s.recentWxPhenomenon) {
        errors.push('Recent Weather: select a phenomenon or disable the section.');
      }
    } else {
      if (!s.recentWxManualText.trim()) {
        errors.push('Recent Weather: enter a manual recent-weather group or disable the section.');
      }
    }
  }

  if (!s.tempC.trim()) {
    errors.push('Temperature: required.');
  } else if (!isValidMetarTempInput(s.tempC)) {
    errors.push('Temperature: must be an integer (e.g. 10, -5, M05).');
  }
  if (!s.dewC.trim()) {
    errors.push('Dew point: required.');
  } else if (!isValidMetarTempInput(s.dewC)) {
    errors.push('Dew point: must be an integer (e.g. 08, -3, M03).');
  }
  if (isValidMetarTempInput(s.tempC) && isValidMetarTempInput(s.dewC)) {
    const tNum = parseMetarTempInput(s.tempC);
    const dNum = parseMetarTempInput(s.dewC);
    if (!isNaN(tNum) && !isNaN(dNum) && tNum < dNum) {
      errors.push('Temperature cannot be colder than dew point.');
    }
  }

  if (!s.qnh.trim()) {
    errors.push('QNH: required.');
  } else if (!/^\d{3,4}$/.test(s.qnh)) {
    errors.push('QNH: must be 3–4 digits (e.g. 1013).');
  }

  return { errors, warnings };
}

// ── METAR assembler — placeholder tokens for missing mandatory data ────────────

function buildReport(s) {
  const groups = [];

  groups.push(s.reportType);
  groups.push(/^[A-Z]{4}$/.test(s.station) ? s.station : '[STATION]');
  groups.push(/^\d{6}Z$/.test(s.time) ? s.time : '[TIME]');

  // Wind
  if (s.windType === 'calm') {
    groups.push('00000KT');
  } else if (s.windType === 'vrb') {
    const spdOk = /^\d{2,3}$/.test(s.windSpeed);
    groups.push(spdOk ? `VRB${String(s.windSpeed).padStart(2,'0')}${s.windUnit}` : '[WIND]');
  } else {
    const dirNum = parseInt(s.windDir, 10);
    const dirOk  = /^\d{3}$/.test(s.windDir) && dirNum >= 1 && dirNum <= 360;
    const spdOk  = /^\d{2,3}$/.test(s.windSpeed);
    if (!dirOk || !spdOk) {
      groups.push('[WIND]');
    } else {
      let w = `${String(s.windDir).padStart(3,'0')}${String(s.windSpeed).padStart(2,'0')}`;
      if (s.windGust) w += `G${String(s.windGust).padStart(2,'0')}`;
      w += s.windUnit;
      groups.push(w);
      if (s.windVarFrom && s.windVarTo) {
        groups.push(`${String(s.windVarFrom).padStart(3,'0')}V${String(s.windVarTo).padStart(3,'0')}`);
      }
    }
  }

  // CAVOK or vis/wx/cloud
  if (s.cavok) {
    groups.push('CAVOK');
  } else {
    groups.push(/^\d{4}$/.test(s.vis) ? s.vis : '[VIS]');

    if (s.rvrEnabled && s.rvr.trim()) groups.push(s.rvr.trim().toUpperCase());

    if (s.wxEnabled) {
      if (s.wxMode === 'manual') {
        const t = s.wxManualText.trim().toUpperCase();
        if (t) groups.push(t);
      } else {
        (s.wxGroups || []).forEach(g => {
          const p1 = g.phenom1 !== undefined ? g.phenom1 : (g.phenomenon || '');
          const code = (g.intensity || '') + (g.descriptor || '') + p1 + (g.phenom2 || '') + (g.phenom3 || '');
          if (code) groups.push(code);
        });
      }
    }

    if (s.cloudsEnabled && s.clouds.length) {
      s.clouds.forEach(c => {
        if (c.amount === 'NSC') {
          groups.push(c.amount);
        } else {
          groups.push(`${c.amount}${String(c.height || '').padStart(3,'0')}${c.qualifier || ''}`);
        }
      });
    }
  }

  // Temp/dew — show values if entered (even if temp < dew sanity fails)
  if (isValidMetarTempInput(s.tempC) && isValidMetarTempInput(s.dewC)) {
    groups.push(`${formatMetarTemp(s.tempC)}/${formatMetarTemp(s.dewC)}`);
  } else {
    groups.push('[TEMP/DEW]');
  }

  // QNH
  groups.push(/^\d{3,4}$/.test(s.qnh) ? `Q${String(s.qnh).padStart(4,'0')}` : '[QNH]');

  // Recent weather
  if (s.recentWxEnabled) {
    let reCode;
    if (s.recentWxMode === 'manual') {
      reCode = normalizeRecentWeatherToken(s.recentWxManualText);
    } else {
      const assembled = (s.recentWxIntensity || '') + (s.recentWxDescriptor || '') + (s.recentWxPhenomenon || '');
      reCode = assembled ? `RE${assembled}` : '';
    }
    if (reCode) groups.push(reCode);
  }

  if (s.windShearEnabled && s.windShear.trim())  groups.push(`WS ${s.windShear.trim().toUpperCase()}`);
  // CAP 746: colour state goes in remarks
  if (s.colourEnabled    && s.colourState.trim()) groups.push(`RMK ${s.colourState.trim().toUpperCase()}`);
  if (s.rwyEnabled       && s.rwyState.trim())    groups.push(s.rwyState.trim().toUpperCase());

  return groups.join(' ') + '=';
}

// ── localStorage ──────────────────────────────────────────────────────────────

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Migrate legacy plain-text wx
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
    // Migrate legacy single structured WX group to wxGroups array
    if (parsed.wxIntensity !== undefined && parsed.wxGroups === undefined) {
      if (parsed.wxIntensity || parsed.wxDescriptor || parsed.wxPhenomenon) {
        parsed.wxGroups = [{
          intensity:  parsed.wxIntensity  || '',
          descriptor: parsed.wxDescriptor || '',
          phenom1:    parsed.wxPhenomenon || '',
          phenom2:    '',
          phenom3:    '',
        }];
      } else {
        parsed.wxGroups = [];
      }
      delete parsed.wxIntensity;
      delete parsed.wxDescriptor;
      delete parsed.wxPhenomenon;
    }
    // Migrate wxGroups items: old 'phenomenon' field → 'phenom1' (003b)
    if (Array.isArray(parsed.wxGroups)) {
      parsed.wxGroups = parsed.wxGroups.map(g => {
        if (g.phenomenon !== undefined && g.phenom1 === undefined) {
          const { phenomenon, ...rest } = g;
          return { ...rest, phenom1: phenomenon || '', phenom2: '', phenom3: '' };
        }
        return { phenom2: '', phenom3: '', ...g };
      });
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

function el(id)            { return document.getElementById(id); }
function setVal(id, v)     { const e = el(id); if (e) e.value = v; }
function setChecked(id, v) { const e = el(id); if (e) e.checked = !!v; }
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Cloud row builder (NCD removed — human-observed stations only) ─────────────

function buildCloudRow(idx, cloud) {
  const amounts = ['FEW','SCT','BKN','OVC','NSC'];  // NCD and SKC removed
  const amtOpts = amounts.map(a =>
    `<option value="${a}"${a === cloud.amount ? ' selected' : ''}>${a}</option>`
  ).join('');
  const noHeight = cloud.amount === 'NSC';
  const heightHtml = noHeight
    ? `<input type="text" class="mb-cloud-height" style="width:56px;opacity:0.4;pointer-events:none;" value="" disabled placeholder="---" />`
    : `<input type="text" class="mb-cloud-height" maxlength="3" style="width:56px;" value="${cloud.height || ''}" placeholder="030" />`;
  const qualOpts = ['','TCU','CB'].map(q =>
    `<option value="${q}"${q === (cloud.qualifier||'') ? ' selected' : ''}>${q||'—'}</option>`
  ).join('');
  const qualHtml = noHeight
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

// ── WX group row builder ──────────────────────────────────────────────────────

function buildWxGroupRow(idx, group) {
  const intOpts = [
    ['', 'Moderate'],
    ['-', '– Light'],
    ['+', '+ Heavy'],
    ['VC', 'VC In vicinity'],
  ].map(([v, l]) =>
    `<option value="${v}"${v === (group.intensity||'') ? ' selected' : ''}>${l}</option>`
  ).join('');

  const descOpts = [
    ['', 'None'],
    ['TS', 'TS Thunderstorm'],
    ['SH', 'SH Shower'],
    ['FZ', 'FZ Freezing'],
    ['MI', 'MI Shallow'],
    ['BC', 'BC Patches'],
    ['DR', 'DR Low drifting'],
    ['BL', 'BL Blowing'],
    ['PR', 'PR Partial'],
  ].map(([v, l]) =>
    `<option value="${v}"${v === (group.descriptor||'') ? ' selected' : ''}>${l}</option>`
  ).join('');

  const selectedP1 = group.phenom1 !== undefined ? group.phenom1 : (group.phenomenon || '');
  const phenomData = [
    ['RA','Rain','Precipitation'],
    ['DZ','Drizzle','Precipitation'],
    ['SN','Snow','Precipitation'],
    ['SG','Snow grains','Precipitation'],
    ['PL','Ice pellets','Precipitation'],
    ['GR','Hail','Precipitation'],
    ['GS','Small hail','Precipitation'],
    ['FG','Fog','Obscuration'],
    ['BR','Mist','Obscuration'],
    ['HZ','Haze','Obscuration'],
    ['FU','Smoke','Obscuration'],
    ['VA','Volcanic ash','Obscuration'],
    ['DU','Dust','Obscuration'],
    ['SA','Sand','Obscuration'],
    ['SQ','Squall','Other'],
    ['PO','Dust whirl','Other'],
    ['DS','Dust storm','Other'],
    ['SS','Sandstorm','Other'],
    ['FC','Funnel cloud','Other'],
  ];
  let phenomHtml = `<option value="">— none —</option>`;
  let curGrp = '';
  for (const [v, label, grp] of phenomData) {
    if (grp !== curGrp) {
      if (curGrp) phenomHtml += '</optgroup>';
      phenomHtml += `<optgroup label="${grp}">`;
      curGrp = grp;
    }
    phenomHtml += `<option value="${v}"${v === selectedP1 ? ' selected' : ''}>${v} ${label}</option>`;
  }
  if (curGrp) phenomHtml += '</optgroup>';

  const precip2Opts = ['','RA','DZ','SN','SG','PL','GR','GS'].map(v =>
    `<option value="${v}"${v === (group.phenom2||'') ? ' selected' : ''}>${v||'—'}</option>`
  ).join('');
  const precip3Opts = ['','RA','DZ','SN','SG','PL','GR','GS'].map(v =>
    `<option value="${v}"${v === (group.phenom3||'') ? ' selected' : ''}>${v||'—'}</option>`
  ).join('');

  return `
    <div class="mb-wx-group-row" data-wx-idx="${idx}">
      <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:2px;">
        <select class="mb-wx-intensity field" style="width:140px;">${intOpts}</select>
        <select class="mb-wx-descriptor field" style="width:155px;">${descOpts}</select>
        <select class="mb-wx-phenom1 field" style="width:170px;">${phenomHtml}</select>
        <span style="font-weight:600;color:#888;padding:0 1px;">+</span>
        <select class="mb-wx-phenom2 field" style="width:62px;" title="Second precipitation type (combined group)">${precip2Opts}</select>
        <span style="font-weight:600;color:#888;padding:0 1px;">+</span>
        <select class="mb-wx-phenom3 field" style="width:62px;" title="Third precipitation type (combined group)">${precip3Opts}</select>
        <button type="button" class="btn btn-ghost btn-small mb-wx-remove" title="Remove WX group">×</button>
      </div>
      <div class="mb-hint" style="font-size:10px;color:#888;margin-top:0;">Combined precipitation: dominant type first</div>
    </div>`;
}

// ── Wind section sync ─────────────────────────────────────────────────────────

function syncWindUi(windType) {
  const dirRow = el('mbWindDirRow');
  const vrbRow = el('mbWindVrbNote');
  const varRow = el('mbWindVarRow');
  if (dirRow) dirRow.style.display = windType === 'dir' ? '' : 'none';
  if (vrbRow) vrbRow.style.display = windType === 'vrb' ? '' : 'none';
  if (varRow) varRow.style.display = windType === 'dir' ? '' : 'none';
}

function syncCavokUi(cavok) {
  ['mbVisSection','mbWxSection','mbCloudSection','mbRvrSection'].forEach(id => {
    const e = el(id);
    if (e) e.style.display = cavok ? 'none' : '';
  });
  // Conditional mandatory asterisks
  const visReq   = el('mbVisRequired');
  const cloudReq = el('mbCloudRequired');
  if (visReq)   visReq.style.display   = cavok ? 'none' : '';
  if (cloudReq) cloudReq.style.display = cavok ? 'none' : '';
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

// ── WX group list ─────────────────────────────────────────────────────────────

function renderWxGroups(groups) {
  const list = el('mbWxGroupList');
  if (!list) return;
  list.innerHTML = (groups || []).map((g, i) => buildWxGroupRow(i, g)).join('');
  bindWxGroupRows();
  updateAddWxGroupButton();
}

function bindWxGroupRows() {
  document.querySelectorAll('.mb-wx-group-row').forEach(row => {
    row.querySelector('.mb-wx-remove')?.addEventListener('click', () => {
      row.remove();
      updateAddWxGroupButton();
      handleChange();
    });
    row.querySelector('.mb-wx-intensity')?.addEventListener('change', handleChange);
    row.querySelector('.mb-wx-descriptor')?.addEventListener('change', handleChange);
    row.querySelector('.mb-wx-phenom1')?.addEventListener('change', handleChange);
    row.querySelector('.mb-wx-phenom2')?.addEventListener('change', handleChange);
    row.querySelector('.mb-wx-phenom3')?.addEventListener('change', handleChange);
  });
}

function updateAddWxGroupButton() {
  const list   = el('mbWxGroupList');
  const addBtn = el('mbAddWxGroup');
  if (!list || !addBtn) return;
  const count = list.querySelectorAll('.mb-wx-group-row').length;
  addBtn.style.display = count >= 3 ? 'none' : '';
}

// ── Read form state ────────────────────────────────────────────────────────────

function readFormState() {
  const windType = document.querySelector('input[name="mbWindType"]:checked')?.value     || 'dir';
  const wxMode   = document.querySelector('input[name="mbWxMode"]:checked')?.value       || 'structured';
  const rwxMode  = document.querySelector('input[name="mbRecentWxMode"]:checked')?.value || 'structured';
  const colourManualOverride = el('mbColour')?.dataset.manualOverride === 'true';

  const clouds = [];
  document.querySelectorAll('.mb-cloud-row').forEach(row => {
    clouds.push({
      amount:    row.querySelector('.mb-cloud-amount')?.value    || 'FEW',
      height:    row.querySelector('.mb-cloud-height')?.value    || '',
      qualifier: row.querySelector('.mb-cloud-qualifier')?.value || '',
    });
  });

  const wxGroups = [];
  document.querySelectorAll('.mb-wx-group-row').forEach(row => {
    wxGroups.push({
      intensity:  row.querySelector('.mb-wx-intensity')?.value  || '',
      descriptor: row.querySelector('.mb-wx-descriptor')?.value || '',
      phenom1:    row.querySelector('.mb-wx-phenom1')?.value    || '',
      phenom2:    row.querySelector('.mb-wx-phenom2')?.value    || '',
      phenom3:    row.querySelector('.mb-wx-phenom3')?.value    || '',
    });
  });

  return {
    reportType:           el('mbReportType')?.value || 'METAR',
    station:              (el('mbStation')?.value   || DEFAULT_STATION).toUpperCase().trim(),
    time:                 (el('mbTime')?.value       || '').toUpperCase().trim(),
    windType,
    windDir:              el('mbWindDir')?.value      || '',
    windSpeed:            windType === 'vrb'
                            ? (el('mbWindSpeedVrb')?.value || '')
                            : (el('mbWindSpeed')?.value    || ''),
    windUnit:             el('mbWindUnit')?.value     || 'KT',
    windGust:             el('mbWindGust')?.value     || '',
    windVarFrom:          el('mbWindVarFrom')?.value  || '',
    windVarTo:            el('mbWindVarTo')?.value    || '',
    cavok:                el('mbCavok')?.checked      || false,
    vis:                  el('mbVis')?.value          || '',
    rvr:                  el('mbRvr')?.value          || '',
    rvrEnabled:           el('mbRvrEnabled')?.checked || false,
    wxEnabled:            el('mbWxEnabled')?.checked  || false,
    wxMode,
    wxGroups,
    wxManualText:         el('mbWxManualText')?.value || '',
    clouds,
    cloudsEnabled:        el('mbCloudsEnabled')?.checked !== false,
    tempC:                el('mbTemp')?.value         || '',
    dewC:                 el('mbDew')?.value          || '',
    qnh:                  el('mbQnh')?.value          || '',
    recentWxEnabled:      el('mbRecentWxEnabled')?.checked    || false,
    recentWxMode:         rwxMode,
    recentWxIntensity:    el('mbRecentWxIntensity')?.value    || '',
    recentWxDescriptor:   el('mbRecentWxDescriptor')?.value   || '',
    recentWxPhenomenon:   el('mbRecentWxPhenomenon')?.value   || '',
    recentWxManualText:   el('mbRecentWxManualText')?.value   || '',
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
  setVal('mbWindSpeed',    s.windType !== 'vrb' ? s.windSpeed : '');
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
  renderWxGroups(s.wxGroups || []);
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
      const noHeight = amountSel.value === 'NSC';
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

  // Auto-expand RVR when vis drops below 1500 m (advisory — user can uncheck)
  if (!s.cavok && /^\d{4}$/.test(s.vis) && parseInt(s.vis, 10) < 1500) {
    const rvrEl = el('mbRvrEnabled');
    if (rvrEl && !rvrEl.checked) {
      rvrEl.checked = true;
      s.rvrEnabled = true;
    }
  }

  const { errors, warnings } = validateState(s);
  const outputEl = el('mbOutput');
  const validEl  = el('mbValidation');
  const copyBtn  = el('mbCopyBtn');
  const incMsg   = el('mbIncompleteMsg');

  if (outputEl) outputEl.textContent = buildReport(s);

  if (validEl) {
    const parts = [];
    errors.forEach(e   => parts.push(`<div class="mb-error-item">⚠ ${escHtml(e)}</div>`));
    warnings.forEach(w => parts.push(`<div class="mb-warning-item">ℹ ${escHtml(w)}</div>`));
    if (parts.length) {
      validEl.innerHTML = parts.join('');
      validEl.className = errors.length
        ? 'mb-validation mb-validation--errors'
        : 'mb-validation mb-validation--warnings';
    } else {
      validEl.innerHTML = '<div class="mb-ok-item">✓ All enabled groups valid.</div>';
      validEl.className = 'mb-validation mb-validation--ok';
    }
  }

  if (copyBtn) {
    copyBtn.disabled = errors.length > 0;
    copyBtn.classList.toggle('mb-copy-blocked', errors.length > 0);
  }
  if (incMsg) incMsg.style.display = errors.length > 0 ? '' : 'none';
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
  el('mbWxEnabled')?.addEventListener('change', handleChange);
  el('mbAddWxGroup')?.addEventListener('click', () => {
    const list = el('mbWxGroupList');
    if (!list) return;
    if (list.querySelectorAll('.mb-wx-group-row').length >= 3) return;
    const count = list.querySelectorAll('.mb-wx-group-row').length;
    const div = document.createElement('div');
    div.innerHTML = buildWxGroupRow(count, { intensity: '', descriptor: '', phenom1: '', phenom2: '', phenom3: '' });
    list.appendChild(div.firstElementChild);
    bindWxGroupRows();
    updateAddWxGroupButton();
    handleChange();
  });
  el('mbWxManualText')?.addEventListener('input', handleChange);

  // Cloud
  el('mbCloudsEnabled')?.addEventListener('change', handleChange);
  el('mbAddCloud')?.addEventListener('click', () => {
    const list = el('mbCloudList');
    if (!list) return;
    const idx = list.querySelectorAll('.mb-cloud-row').length;
    const div = document.createElement('div');
    div.innerHTML = buildCloudRow(idx, { amount: 'FEW', height: '', qualifier: '' });
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

  // Colour state
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

function syncAdminWeatherUi(pattern, rate) {
  const rateRow   = el('adminWeatherRateRow');
  const minuteRow = el('adminWeatherMinuteRow');
  if (pattern === 'H53') {
    if (rateRow)   rateRow.style.display   = 'none';
    if (minuteRow) minuteRow.style.display = 'none';
  } else {
    if (rateRow)   rateRow.style.display   = '';
    if (minuteRow) minuteRow.style.display = rate === 'hourly' ? '' : 'none';
  }
}

function rebuildMinuteOptions(pattern, selectedMinute) {
  const minuteEl = el('adminWeatherHourlyMinute');
  if (!minuteEl) return;
  const opts = pattern === 'H00_H30'
    ? [['00', '+00 (top of hour)'], ['30', '+30 minutes']]
    : [['20', '+20 minutes'],       ['50', '+50 minutes']];
  minuteEl.innerHTML = opts.map(([v, label]) =>
    `<option value="${v}"${v === String(selectedMinute) ? ' selected' : ''}>${label}</option>`
  ).join('');
  if (!opts.some(([v]) => v === minuteEl.value)) minuteEl.value = opts[0][0];
}

export function initAdminWeather() {
  const saveBtn   = el('adminWeatherSave');
  const patternEl = el('adminWeatherPattern');
  const rateEl    = el('adminWeatherRate');
  if (!saveBtn || !patternEl || !rateEl) return;

  const cfg      = getConfig();
  const schedule = cfg.metarObservationSchedule || { pattern: 'H20_H50', rate: 'bi-hourly', hourlyMinute: '50' };
  setVal('adminWeatherPattern', schedule.pattern || 'H20_H50');
  setVal('adminWeatherRate',    schedule.rate    || 'bi-hourly');
  rebuildMinuteOptions(schedule.pattern || 'H20_H50', schedule.hourlyMinute || '50');
  syncAdminWeatherUi(schedule.pattern || 'H20_H50', schedule.rate || 'bi-hourly');

  patternEl.addEventListener('change', () => {
    rebuildMinuteOptions(patternEl.value, el('adminWeatherHourlyMinute')?.value || '50');
    syncAdminWeatherUi(patternEl.value, rateEl.value);
  });
  rateEl.addEventListener('change', () => {
    syncAdminWeatherUi(patternEl.value, rateEl.value);
  });

  saveBtn.addEventListener('click', () => {
    const minuteEl = el('adminWeatherHourlyMinute');
    updateConfig({
      metarObservationSchedule: {
        pattern:       patternEl.value,
        rate:          rateEl.value,
        hourlyMinute:  minuteEl ? minuteEl.value : '50',
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

// Application entry point for the multi-body platform solver.
//
// Builds the environment controls and the Body Manager, wires them to the
// AppState store, and renders results reactively. Security rule: no user- or
// file-derived string is ever written with innerHTML — all dynamic content is
// built with el() / textContent.

import { AppState } from './state.js';
import { computePlatform } from './morison.js';
import { renderForceChart, renderLegend, clearChart } from './charts.js';
import { exportCSV, exportPDF, exportJSON } from './export.js';
import { saveScenario, listScenarios, loadScenario, deleteScenario } from './scenarios.js';

const state = new AppState();
const $ = (sel) => document.querySelector(sel);
const kN = (n) => `${(n / 1000).toFixed(2)} kN`;

// Which force series the chart shows: 'global' or `body-${id}`.
let selectedSeries = 'global';

/** Create an element with attributes and text/element children (never parses HTML). */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

// ---------------------------------------------------------------------------
// Environment schema
// ---------------------------------------------------------------------------

const ENV_GROUPS = [
  {
    title: 'Wave',
    fields: [
      {
        key: 'waveTheory', label: 'Wave theory', type: 'select',
        options: [['airy', 'Airy (linear)'], ['stokes5', 'Stokes 5th order']],
      },
      { key: 'H', label: 'Wave height H', unit: 'm', min: 0.1, max: 20, step: 0.1 },
      { key: 'T', label: 'Wave period T (intrinsic)', unit: 's', min: 2, max: 25, step: 0.1 },
      { key: 'h', label: 'Water depth h', unit: 'm', min: 2, max: 500, step: 0.5 },
      {
        key: 'integrateTo', label: 'Wetted length / integration limit', type: 'select',
        options: [
          ['swl', 'Still-water level (linear)'],
          ['surface', 'Instantaneous free surface (Wheeler for Airy)'],
        ],
      },
    ],
  },
  {
    title: 'Current',
    fields: [
      { key: 'U_c', label: 'Surface current', unit: 'm/s', min: 0, max: 4, step: 0.05 },
      {
        key: 'currentProfile', label: 'Current profile', type: 'select',
        options: [['uniform', 'Uniform over depth'], ['power17', '1/7 power law'], ['log', 'Logarithmic (zero at bed)']],
      },
    ],
  },
  {
    title: 'Wind (power law)',
    fields: [
      { key: 'V_wind', label: 'Wind speed @ 10 m', unit: 'm/s', min: 0, max: 80, step: 0.5 },
      { key: 'windBeta', label: 'Profile exponent β', unit: '–', min: 0.05, max: 0.4, step: 0.001 },
      { key: 'Cd_air', label: 'Shape coefficient', unit: '–', min: 0.3, max: 2, step: 0.05 },
    ],
  },
  {
    title: 'Coefficients & models',
    fields: [
      { key: 'Cd', label: 'Drag coefficient C_d', unit: '–', min: 0, max: 2.5, step: 0.05 },
      { key: 'Cm', label: 'Inertia coefficient C_m', unit: '–', min: 0, max: 2.5, step: 0.05 },
      { key: 'useMacCamy', label: 'MacCamy–Fuchs inertia correction (cylinders)', type: 'checkbox' },
      {
        key: 'sphereModel', label: 'Sphere load model', type: 'select',
        options: [['slices3', 'Thesis 3-slice equivalent'], ['exact', 'Exact spherical section']],
      },
      { key: 'rho', label: 'Water density', unit: 'kg/m³', min: 995, max: 1035, step: 1 },
      // stored in m²/s (SI); shown in mm²/s so the value fits the input
      { key: 'nu', label: 'Kinematic viscosity (for Re)', unit: 'mm²/s', scale: 1e6, min: 0.8, max: 1.8, step: 0.01 },
    ],
  },
];

const RESULT_TILES = [
  { id: 'peakTotal', label: 'Global peak base shear', fmt: (r) => kN(r.global.peakTotal) },
  { id: 'rms', label: 'Global RMS', fmt: (r) => kN(r.global.rms) },
  { id: 'peakDrag', label: 'Peak drag (summed)', fmt: (r) => kN(r.global.peakDrag) },
  { id: 'peakInertia', label: 'Peak inertia (summed)', fmt: (r) => kN(r.global.peakInertia) },
  { id: 'peakWind', label: 'Wind base shear (steady)', fmt: (r) => kN(r.global.peakWind) },
  { id: 'wavelength', label: 'Wavelength λ', fmt: (r) => `${r.wavelength.toFixed(1)} m` },
  {
    id: 'arrayFactor', label: 'Array factor (peak of sum / sum of peaks)', fmt: (r) => r.arrayFactor.toFixed(3),
    sub: (r) => (r.arrayFactor > 0.999 ? '1 = all bodies in phase'
      : `${((1 - r.arrayFactor) * 100).toFixed(0)}% below the in-phase sum`),
  },
  {
    id: 'heave', label: 'Heave period T₃ (screening)',
    fmt: (r) => (r.heave.applicable ? `${r.heave.Tn3.toFixed(2)} s` : 'n/a'),
    sub: (r) => (!r.heave.applicable ? 'no waterplane area'
      : r.heave.potentialResonance ? '⚠ T inside screening band'
        : `band ${r.heave.bandLow.toFixed(1)}–${r.heave.bandHigh.toFixed(1)} s`),
  },
];

const inputClass =
  'rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm tabular-nums focus:border-sky-500 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100';

// ---------------------------------------------------------------------------
// Environment controls
// ---------------------------------------------------------------------------

function buildEnv() {
  const root = $('#inputs');
  root.replaceChildren();
  for (const group of ENV_GROUPS) {
    const list = el('div', { class: 'space-y-4' });
    for (const f of group.fields) {
      list.append(f.type === 'checkbox' ? envCheckbox(f) : f.type === 'select' ? envSelect(f) : envNumber(f));
    }
    root.append(el('section', {},
      el('h3', { class: 'mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400', text: group.title }),
      list));
  }
}

function envNumber(f) {
  const range = el('input', {
    id: `rg-${f.key}`, type: 'range', min: f.min, max: f.max, step: f.step, 'aria-label': f.label,
    class: 'h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-neutral-200 dark:bg-neutral-700 accent-sky-600',
  });
  const num = el('input', { id: `in-${f.key}`, type: 'number', min: f.min, max: f.max, step: f.step, class: `w-24 text-right ${inputClass}` });
  // min/max/step are in display units; state holds SI (display = SI × scale)
  const scale = f.scale ?? 1;
  const toDisplay = (si) => Number((si * scale).toPrecision(12));
  const sync = (shown) => { range.value = shown; num.value = shown; };
  sync(toDisplay(state.getEnv(f.key)));
  range.addEventListener('input', () => { num.value = range.value; state.setEnv(f.key, Number(range.value) / scale); });
  num.addEventListener('change', () => {
    const raw = Number(num.value);
    const shown = Number.isFinite(raw) ? Math.min(f.max, Math.max(f.min, raw)) : toDisplay(state.getEnv(f.key));
    sync(shown);
    state.setEnv(f.key, shown / scale);
  });
  state.on('env:changed', ({ keys, environment }) => { if (keys.includes(f.key)) sync(toDisplay(environment[f.key])); });
  return el('div', {},
    el('div', { class: 'mb-1 flex items-baseline justify-between gap-2' },
      el('label', { for: `in-${f.key}`, class: 'text-sm text-neutral-700 dark:text-neutral-200', text: f.label }),
      el('span', { class: 'text-xs text-neutral-400', text: f.unit })),
    el('div', { class: 'flex items-center gap-3' }, range, num));
}

function envSelect(f) {
  const sel = el('select', { id: `in-${f.key}`, class: `w-full ${inputClass}` },
    f.options.map(([value, label]) => el('option', { value, text: label })));
  sel.value = state.getEnv(f.key);
  sel.addEventListener('change', () => state.setEnv(f.key, sel.value));
  state.on('env:changed', ({ keys, environment }) => { if (keys.includes(f.key)) sel.value = environment[f.key]; });
  return el('div', {},
    el('label', { for: `in-${f.key}`, class: 'mb-1 block text-sm text-neutral-700 dark:text-neutral-200', text: f.label }),
    sel);
}

function envCheckbox(f) {
  const box = el('input', { id: `in-${f.key}`, type: 'checkbox', class: 'h-4 w-4 rounded accent-sky-600' });
  box.checked = state.getEnv(f.key);
  box.addEventListener('change', () => state.setEnv(f.key, box.checked));
  state.on('env:changed', ({ keys, environment }) => { if (keys.includes(f.key)) box.checked = environment[f.key]; });
  return el('label', { class: 'flex cursor-pointer items-center justify-between gap-3' },
    el('span', { class: 'text-sm text-neutral-700 dark:text-neutral-200', text: f.label }), box);
}

// ---------------------------------------------------------------------------
// Body Manager
// ---------------------------------------------------------------------------

function bodyNumberInput(id, key, value, { min, max, step, label, unit }) {
  const input = el('input', {
    type: 'number', value, min, max, step, 'aria-label': `${label} (${unit})`,
    'data-field': key, class: `w-full text-right ${inputClass}`,
  });
  input.addEventListener('change', () => {
    const raw = Number(input.value);
    if (!Number.isFinite(raw)) { input.value = state.getBody(id)?.[key] ?? value; return; }
    const v = Math.min(max, Math.max(min, raw));
    input.value = v;
    state.updateBody(id, key, v);
  });
  return el('div', {},
    el('label', { class: 'mb-0.5 flex items-baseline justify-between text-xs text-neutral-500 dark:text-neutral-400' },
      el('span', { text: label }), el('span', { text: unit })),
    input);
}

function renderBodyManager() {
  const root = $('#body-manager');
  root.replaceChildren();
  const bodies = state.bodies;
  bodies.forEach((body, i) => {
    const isSphere = body.type === 'sphere';
    const removeBtn = el('button', {
      type: 'button', title: 'Remove body', 'aria-label': `Remove body ${i + 1}`,
      class: 'rounded px-1.5 text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30 dark:text-red-400 dark:hover:bg-red-500/10',
      text: '✕',
    });
    removeBtn.disabled = bodies.length <= 1;
    removeBtn.addEventListener('click', () => { if (state.bodies.length > 1) state.removeBody(body.id); });

    const typeSel = el('select', { class: `w-full ${inputClass}`, 'aria-label': `Body ${i + 1} type` },
      el('option', { value: 'cylinder', text: 'Cylinder' }), el('option', { value: 'sphere', text: 'Sphere' }));
    typeSel.value = body.type;
    typeSel.addEventListener('change', () => state.updateBody(body.id, 'type', typeSel.value, true));

    const grid = el('div', { class: 'grid grid-cols-2 gap-2' },
      bodyNumberInput(body.id, 'x', body.x, { min: -400, max: 400, step: 1, label: 'X pos', unit: 'm' }),
      bodyNumberInput(body.id, 'y', body.y, { min: -400, max: 400, step: 1, label: 'Y pos', unit: 'm' }),
      isSphere
        ? bodyNumberInput(body.id, 'radius', body.radius, { min: 0.2, max: 30, step: 0.1, label: 'Radius', unit: 'm' })
        : bodyNumberInput(body.id, 'diameter', body.diameter, { min: 0.2, max: 60, step: 0.1, label: 'Diameter', unit: 'm' }),
      bodyNumberInput(body.id, 'draft', body.draft, { min: 0.1, max: 500, step: 0.5, label: 'Draft', unit: 'm' }),
      isSphere ? null
        : bodyNumberInput(body.id, 'freeboard', body.freeboard, { min: 0, max: 100, step: 0.5, label: 'Freeboard', unit: 'm' }));

    root.append(el('div', {
      class: 'rounded-lg border border-black/10 bg-neutral-50 p-3 dark:border-white/10 dark:bg-neutral-900/40',
      'data-body-id': body.id,
    },
    el('div', { class: 'mb-2 flex items-center justify-between' },
      el('span', { class: 'text-sm font-medium text-neutral-800 dark:text-neutral-100', text: `Body ${i + 1}` }), removeBtn),
    el('div', { class: 'mb-2' }, typeSel),
    grid,
    el('ul', { class: 'body-issues mt-2 space-y-1 text-xs', 'data-issues-for': body.id })));
  });
  if (state.results) renderBodyIssues(state.results);
}

const ISSUE_STYLE = {
  error: ['⛔', 'text-red-700 dark:text-red-300'],
  warning: ['⚠', 'text-amber-700 dark:text-amber-300'],
  info: ['ℹ', 'text-sky-700 dark:text-sky-300'],
};

function renderBodyIssues(results) {
  const all = [...(results.errors || []), ...(results.warnings || []), ...(results.infos || [])];
  document.querySelectorAll('[data-issues-for]').forEach((ul) => {
    const id = Number(ul.dataset.issuesFor);
    ul.replaceChildren(...all
      .filter((x) => x.bodyId === id || (x.bodyIds || []).includes(id))
      .map((x) => {
        const [icon, cls] = ISSUE_STYLE[x.severity];
        return el('li', { class: cls, 'data-code': x.code, text: `${icon} ${x.message}` });
      }));
  });
}

// ---------------------------------------------------------------------------
// Chart series selector
// ---------------------------------------------------------------------------

function buildChartSelector() {
  const sel = $('#chart-series-select');
  const bodies = state.bodies;
  if (selectedSeries !== 'global' && !bodies.some((b) => `body-${b.id}` === selectedSeries)) selectedSeries = 'global';
  sel.replaceChildren(
    el('option', { value: 'global', text: 'Global Platform Force' }),
    ...bodies.map((b, i) => el('option', { value: `body-${b.id}`, text: `Body ${i + 1} Force (${b.type})` })));
  sel.value = selectedSeries;
}

function currentSeries(results) {
  if (selectedSeries !== 'global') {
    const id = Number(selectedSeries.slice('body-'.length));
    const idx = results.bodies.findIndex((b) => b.id === id);
    if (idx !== -1) return { timeData: results.bodies[idx].timeData, label: `Body ${idx + 1} Force` };
  }
  return { timeData: results.global.timeData, label: 'Global Platform Force' };
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function buildTiles() {
  $('#tiles').replaceChildren(...RESULT_TILES.map((t) => el('div', {
    class: 'rounded-xl border border-black/5 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-neutral-800/60',
  },
  el('div', { class: 'text-xs text-neutral-500 dark:text-neutral-400', text: t.label }),
  el('div', { id: `tile-${t.id}`, class: 'mt-1 text-xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-50', text: '–' }),
  el('div', { id: `tilesub-${t.id}`, class: 'mt-0.5 text-xs text-neutral-500 dark:text-neutral-400' }))));
}

function render(results) {
  renderIssues(results);
  renderBodyIssues(results);
  const ok = results.ok;
  for (const t of RESULT_TILES) {
    $(`#tile-${t.id}`).textContent = ok ? t.fmt(results) : '—';
    $(`#tilesub-${t.id}`).textContent = ok && t.sub ? t.sub(results) : (ok ? '' : 'no valid result');
  }
  for (const id of ['#export-csv', '#export-pdf', '#export-json']) $(id).disabled = !ok;
  if (ok) {
    const { timeData, label } = currentSeries(results);
    $('#chart-title').textContent = `${label} — one wave period`;
    renderForceChart($('#chart'), timeData);
  } else {
    $('#chart-title').textContent = 'Force time series';
    clearChart($('#chart'), 'No results — resolve the errors listed above.');
  }
  renderBodyTable(results);
  renderAssumptions(results);
  viz?.update(results.wave ?? null, state.bodies, ok ? results.bodies : []);
}

function renderBodyTable(results) {
  const tbody = $('#body-table');
  if (!results.ok) {
    tbody.replaceChildren(el('tr', {}, el('td', { colspan: 9, class: 'py-3 text-neutral-500', text: 'No valid result.' })));
    return;
  }
  const num = (v, d) => el('td', { class: 'py-2 pr-4 text-right', text: v.toFixed(d) });
  tbody.replaceChildren(...results.bodies.map((b, i) => el('tr', { class: 'border-b border-black/5 dark:border-white/5' },
    el('td', { class: 'py-2 pr-4', text: `Body ${i + 1}` }),
    el('td', { class: 'py-2 pr-4 capitalize text-neutral-500 dark:text-neutral-400', text: b.type === 'sphere' ? 'sphere' : 'cylinder' }),
    num(b.x, 0),
    el('td', { class: 'py-2 pr-4 text-right font-medium', text: (b.peakTotal / 1000).toFixed(2) }),
    num(b.rms / 1000, 2),
    num(b.Dlambda, 3),
    num(b.KC, 2),
    el('td', { class: 'py-2 pr-4 text-right', text: b.Re.toExponential(1) }),
    el('td', { class: 'py-2 pr-4 text-right', text: b.mfApplied ? `MF ×${b.mfInertiaRatio.toFixed(3)}` : '—' }))));
}

function banner(severity, text) {
  const styles = {
    error: 'border-red-400 bg-red-100 text-red-900 dark:border-red-500/50 dark:bg-red-500/15 dark:text-red-200',
    warning: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200',
    info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200',
  }[severity];
  const icon = { error: '⛔', warning: '⚠️', info: 'ℹ️' }[severity];
  return el('div', { class: `rounded-xl border px-4 py-2.5 text-sm ${styles}`, 'data-severity': severity, 'data-code': '' },
    el('span', { class: 'mr-1', 'aria-hidden': 'true', text: icon }), text);
}

function renderIssues(results) {
  const items = [
    ...(results.errors || []).map((x) => ['error', x]),
    ...(results.warnings || []).filter((x) => x.bodyId === undefined && !x.bodyIds).map((x) => ['warning', x]),
    ...(results.infos || []).filter((x) => x.bodyId === undefined).map((x) => ['info', x]),
  ];
  // body-specific warnings are shown on the body cards; count them here
  const bodyWarnings = (results.warnings || []).filter((x) => x.bodyId !== undefined || x.bodyIds).length;
  const nodes = items.map(([sev, x]) => {
    const b = banner(sev, x.message);
    b.dataset.code = x.code;
    return b;
  });
  if (bodyWarnings) nodes.push(banner('warning', `${bodyWarnings} body-specific warning(s) — see the Body Manager cards.`));
  $('#warnings').replaceChildren(...nodes);
}

function renderAssumptions(results) {
  const list = $('#assumptions-list');
  const lines = [...(results.assumptions || [])];
  if (results.ok) {
    lines.push(...results.heave.assumptions.map((a) => `Heave screening: ${a}`));
    const n = results.numerics;
    lines.push(`Numerics: composite Gauss–Legendre ${n.panels}×${n.order} points per wetted length; ${n.timeSamples} samples per period; every reported peak refined on the continuous force function.`);
  }
  lines.push(`Engine ${results.engineVersion ?? ''} · SI units internally; forces displayed in kN.`);
  list.replaceChildren(...lines.map((t) => el('li', { text: t })));
}

// ---------------------------------------------------------------------------
// Reactive pipeline (coalesced to one computation per animation frame)
// ---------------------------------------------------------------------------

let pending = false;
function recalculate() {
  try {
    state.setResults(computePlatform(state.environment, state.bodies));
  } catch (err) {
    console.error(err);
    state.setResults({
      ok: false, warnings: [], infos: [],
      errors: [{ severity: 'error', code: 'INTERNAL', message: `Internal error in the solver: ${err.message}` }],
    });
  }
}
function scheduleRecalc() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; recalculate(); });
}

// ---------------------------------------------------------------------------
// Status messages
// ---------------------------------------------------------------------------

function notify(message, kind = 'info') {
  const box = $('#toast');
  box.textContent = message;
  box.dataset.kind = kind;
  box.className = `text-xs ${kind === 'error' ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`;
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

function initTheme() {
  const btn = $('#theme-toggle');
  const apply = (dark) => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('wfc-theme', dark ? 'dark' : 'light'); } catch { /* storage unavailable */ }
    btn.textContent = dark ? '☀️ Light' : '🌙 Dark';
    if (state.results?.ok) renderForceChart($('#chart'), currentSeries(state.results).timeData);
  };
  apply(document.documentElement.classList.contains('dark'));
  btn.addEventListener('click', () => apply(!document.documentElement.classList.contains('dark')));
}

// ---------------------------------------------------------------------------
// Scenarios + exports
// ---------------------------------------------------------------------------

function refreshScenarioList(names) {
  const sel = $('#scenario-list');
  sel.replaceChildren(...(names.length
    ? names.map((n) => el('option', { value: n, text: n }))
    : [el('option', { value: '', disabled: true, selected: true, text: 'No saved scenarios' })]));
}

function initTools() {
  refreshScenarioList(listScenarios());

  $('#add-body').addEventListener('click', () => {
    const bodies = state.bodies;
    const last = bodies[bodies.length - 1];
    const { id, ...geometry } = last;
    const span = 2 * (last.type === 'sphere' ? last.radius : last.diameter / 2);
    state.addBody({ ...geometry, x: last.x + Math.max(30, 4 * span) });
  });

  $('#chart-series-select').addEventListener('change', (e) => {
    selectedSeries = e.target.value;
    if (state.results?.ok) {
      const { timeData, label } = currentSeries(state.results);
      $('#chart-title').textContent = `${label} — one wave period`;
      renderForceChart($('#chart'), timeData);
    }
  });

  $('#scenario-save').addEventListener('click', () => {
    const input = $('#scenario-name');
    const name = input.value.trim() || `Platform ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    try {
      refreshScenarioList(saveScenario(name, state.serialize()));
      $('#scenario-list').value = name;
      input.value = '';
      notify(`Saved scenario “${name}”.`);
    } catch (err) {
      notify(err.message, 'error');
    }
  });

  $('#scenario-load').addEventListener('click', () => {
    const name = $('#scenario-list').value;
    const snapshot = name ? loadScenario(name) : null;
    if (!snapshot) { notify('Select a saved scenario first.', 'error'); return; }
    try {
      state.replace(snapshot);
      notify(`Loaded scenario “${name}”.`);
    } catch (err) {
      notify(`Scenario “${name}” could not be loaded: ${err.message}`, 'error');
    }
  });

  $('#scenario-delete').addEventListener('click', () => {
    const name = $('#scenario-list').value;
    if (!name) return;
    try {
      refreshScenarioList(deleteScenario(name));
      notify(`Deleted scenario “${name}”.`);
    } catch (err) {
      notify(err.message, 'error');
    }
  });

  $('#export-csv').addEventListener('click', () => {
    try {
      exportCSV(state.results);
      notify('CSV exported.');
    } catch (err) {
      notify(`CSV export failed: ${err.message}`, 'error');
    }
  });

  $('#export-json').addEventListener('click', () => {
    try {
      exportJSON(state.serialize(), state.results);
      notify('JSON exported.');
    } catch (err) {
      notify(`JSON export failed: ${err.message}`, 'error');
    }
  });

  $('#export-pdf').addEventListener('click', async () => {
    if (!state.results?.ok) return;
    const { label } = currentSeries(state.results);
    const res = await exportPDF(state.environment, state.bodies, state.results, $('#chart'), label);
    if (res.ok) notify(`PDF exported (${res.pages} page${res.pages > 1 ? 's' : ''}).`);
    else if (res.reason === 'missing-library') notify('PDF export unavailable: the bundled jsPDF library could not be loaded (vendor/jspdf-4.2.1.umd.min.js).', 'error');
    else notify(`PDF export failed: ${res.message}`, 'error');
  });
}

// ---------------------------------------------------------------------------
// 3-D view — dynamic import so a three.js or WebGL failure degrades gracefully.
// ---------------------------------------------------------------------------

let viz = null;
import('./viz3d.js')
  .then((m) => {
    viz = m.initViz3d($('#viz3d'));
    const r = state.results;
    if (r) viz.update(r.wave ?? null, state.bodies, r.ok ? r.bodies : []);
  })
  .catch(() => {
    $('#viz3d').replaceChildren(el('div', {
      class: 'flex h-full items-center justify-center text-sm text-neutral-500',
      text: '3-D view unavailable (three.js or WebGL could not be started).',
    }));
  });

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

buildEnv();
renderBodyManager();
buildChartSelector();
buildTiles();
renderLegend($('#legend'));
initTheme();
initTools();

state.on('env:changed', scheduleRecalc);
state.on('bodies:changed', (e) => {
  if (e.reason !== 'update') {
    renderBodyManager();
    buildChartSelector();
  }
  scheduleRecalc();
});
state.on('results:changed', render);

new ResizeObserver(() => {
  if (state.results?.ok) renderForceChart($('#chart'), currentSeries(state.results).timeData);
}).observe($('#chart'));

recalculate();

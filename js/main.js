// Application entry point: builds the input sidebar from a declarative schema,
// wires inputs to the AppState store, and re-renders results reactively.

import { AppState } from './state.js';
import { computeForces } from './morison.js';
import { renderForceChart, renderLegend } from './charts.js';
import { exportCSV, exportPDF } from './export.js';
import { saveScenario, listScenarios, loadScenario, deleteScenario } from './scenarios.js';

// ---------------------------------------------------------------------------
// Input schema — the single source of truth for sidebar controls.
// ---------------------------------------------------------------------------

const FIELD_GROUPS = [
  {
    title: 'Wave',
    fields: [
      {
        key: 'waveTheory', label: 'Wave theory', type: 'select',
        options: [
          { value: 'airy', label: 'Airy (linear)' },
          { value: 'stokes5', label: 'Stokes 5th order' },
        ],
      },
      { key: 'H', label: 'Wave height', unit: 'm', min: 0.1, max: 15, step: 0.1 },
      { key: 'T', label: 'Wave period', unit: 's', min: 2, max: 25, step: 0.1 },
      { key: 'h', label: 'Water depth', unit: 'm', min: 2, max: 500, step: 0.5 },
      { key: 'U_c', label: 'Surface current', unit: 'm/s', min: 0, max: 3, step: 0.05 },
      {
        key: 'currentProfile', label: 'Current profile', type: 'select',
        options: [
          { value: 'uniform', label: 'Uniform over depth' },
          { value: 'log', label: 'Logarithmic (zero at bed)' },
        ],
      },
    ],
  },
  {
    title: 'Cylinder',
    fields: [
      { key: 'D', label: 'Diameter', unit: 'm', min: 0.2, max: 20, step: 0.1 },
      { key: 'd', label: 'Draft', unit: 'm', min: 0.5, max: 50, step: 0.1 },
      { key: 'L', label: 'Total length', unit: 'm', min: 1, max: 100, step: 0.5 },
    ],
  },
  {
    title: 'Coefficients',
    fields: [
      { key: 'Cd', label: 'Drag coefficient C<sub>d</sub>', unit: '–', min: 0.4, max: 2, step: 0.05 },
      { key: 'Cm', label: 'Inertia coefficient C<sub>m</sub>', unit: '–', min: 1, max: 2.5, step: 0.05 },
      { key: 'rho', label: 'Water density', unit: 'kg/m³', min: 995, max: 1035, step: 1 },
      { key: 'useMacCamy', label: 'MacCamy–Fuchs correction', type: 'checkbox' },
    ],
  },
  {
    title: 'Wind',
    fields: [
      { key: 'V_wind', label: 'Wind speed', unit: 'm/s', min: 0, max: 60, step: 0.5 },
      { key: 'Cd_air', label: 'Air drag coefficient', unit: '–', min: 0.3, max: 2, step: 0.05 },
      { key: 'h_exp', label: 'Exposed height', unit: 'm', min: 0, max: 60, step: 0.5 },
    ],
  },
];

const RESULT_TILES = [
  { id: 'peakWaveForce', label: 'Peak wave force', fmt: (r) => kN(r.peakWaveForce) },
  { id: 'peakAirForce', label: 'Peak wind force', fmt: (r) => kN(r.peakAirForce) },
  { id: 'totalPeakForce', label: 'Total peak force', fmt: (r) => kN(r.totalPeakForce) },
  { id: 'rmsForce', label: 'RMS force', fmt: (r) => kN(r.rmsForce) },
  { id: 'KC', label: 'KC number', fmt: (r) => r.KC.toFixed(2) },
  { id: 'Re', label: 'Reynolds number', fmt: (r) => r.Re.toExponential(2) },
  { id: 'ka', label: 'Diffraction ka', fmt: (r) => r.ka.toFixed(3) },
  { id: 'wavelength', label: 'Wavelength', fmt: (r) => `${r.wavelength.toFixed(1)} m` },
];

const kN = (n) => `${(n / 1000).toFixed(2)} kN`;

// ---------------------------------------------------------------------------
// State + DOM construction
// ---------------------------------------------------------------------------

const state = new AppState();
const $ = (sel) => document.querySelector(sel);

function buildSidebar() {
  const root = $('#inputs');
  for (const group of FIELD_GROUPS) {
    const section = document.createElement('section');
    section.innerHTML =
      `<h3 class="mb-3 text-xs font-semibold uppercase tracking-wider ` +
      `text-neutral-500 dark:text-neutral-400">${group.title}</h3>`;
    const list = document.createElement('div');
    list.className = 'space-y-4';

    for (const f of group.fields) {
      const builder =
        f.type === 'checkbox' ? buildCheckbox : f.type === 'select' ? buildSelect : buildNumberField;
      list.appendChild(builder(f));
    }
    section.appendChild(list);
    root.appendChild(section);
  }
}

function buildNumberField(f) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="mb-1 flex items-baseline justify-between">
      <label for="in-${f.key}" class="text-sm text-neutral-700 dark:text-neutral-200">${f.label}</label>
      <span class="text-xs text-neutral-400">${f.unit}</span>
    </div>
    <div class="flex items-center gap-3">
      <input id="rg-${f.key}" type="range" min="${f.min}" max="${f.max}" step="${f.step}"
        class="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-neutral-200 dark:bg-neutral-700 accent-sky-600">
      <input id="in-${f.key}" type="number" min="${f.min}" max="${f.max}" step="${f.step}"
        class="w-20 rounded-md border border-neutral-300 bg-white px-2 py-1 text-right text-sm tabular-nums
               focus:border-sky-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100">
    </div>`;
  const range = wrap.querySelector(`#rg-${f.key}`);
  const num = wrap.querySelector(`#in-${f.key}`);
  const sync = (v) => {
    range.value = v;
    num.value = v;
  };
  sync(state.get(f.key));
  range.addEventListener('input', () => {
    num.value = range.value;
    state.set(f.key, Number(range.value));
  });
  num.addEventListener('change', () => {
    const v = Math.min(f.max, Math.max(f.min, Number(num.value) || f.min));
    sync(v);
    state.set(f.key, v);
  });
  // Keep controls in sync on external changes (scenario load, batch update)
  state.on('params:changed', ({ keys, params }) => {
    if (keys.includes(f.key)) sync(params[f.key]);
  });
  return wrap;
}

function buildSelect(f) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <label for="in-${f.key}" class="mb-1 block text-sm text-neutral-700 dark:text-neutral-200">${f.label}</label>
    <select id="in-${f.key}"
      class="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm
             focus:border-sky-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100">
      ${f.options.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')}
    </select>`;
  const sel = wrap.querySelector('select');
  sel.value = state.get(f.key);
  sel.addEventListener('change', () => state.set(f.key, sel.value));
  state.on('params:changed', ({ keys, params }) => {
    if (keys.includes(f.key)) sel.value = params[f.key];
  });
  return wrap;
}

function buildCheckbox(f) {
  const wrap = document.createElement('label');
  wrap.className = 'flex cursor-pointer items-center justify-between';
  wrap.innerHTML = `
    <span class="text-sm text-neutral-700 dark:text-neutral-200">${f.label}</span>
    <input id="in-${f.key}" type="checkbox" class="h-4 w-4 rounded accent-sky-600">`;
  const box = wrap.querySelector('input');
  box.checked = state.get(f.key);
  box.addEventListener('change', () => state.set(f.key, box.checked));
  state.on('params:changed', ({ keys, params }) => {
    if (keys.includes(f.key)) box.checked = params[f.key];
  });
  return wrap;
}

function buildTiles() {
  const root = $('#tiles');
  root.innerHTML = RESULT_TILES.map(
    (t) => `
    <div class="rounded-xl border border-black/5 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-neutral-800/60">
      <div class="text-xs text-neutral-500 dark:text-neutral-400">${t.label}</div>
      <div id="tile-${t.id}" class="mt-1 text-xl font-semibold text-neutral-900 dark:text-neutral-50">–</div>
    </div>`
  ).join('');
}

// ---------------------------------------------------------------------------
// Reactive pipeline
// ---------------------------------------------------------------------------

function recalculate() {
  state.setResults(computeForces(state.params));
}

function render(results) {
  for (const t of RESULT_TILES) {
    $(`#tile-${t.id}`).textContent = t.fmt(results);
  }
  renderWarnings(results);
  renderForceChart($('#chart'), results.timeData);
  viz?.update(results.wave, state.params);
}

function renderWarnings(results) {
  const banner = $('#warning-banner');
  const b = results.breaking;
  const messages = [];
  if (b.depthLimited) {
    messages.push(
      `<strong>Wave breaking limit exceeded (depth):</strong> H/h = ${b.depthRatio.toFixed(2)} ` +
      `&gt; 0.78 — the wave breaks before reaching this depth.`
    );
  }
  if (b.steepnessLimited) {
    messages.push(
      `<strong>Wave breaking limit exceeded (steepness):</strong> H/λ = ${b.steepness.toFixed(3)} ` +
      `&gt; ${b.micheLimit.toFixed(3)} (Miche criterion) — the wave is steeper than it can physically be.`
    );
  }
  if (results.stokesConverged === false) {
    messages.push(
      `<strong>Stokes 5th order did not converge</strong> for these inputs — results are unreliable. ` +
      `Reduce wave height or use deeper water.`
    );
  }
  banner.innerHTML = messages.map((m) => `<div>⚠️ ${m}</div>`).join('');
  banner.classList.toggle('hidden', messages.length === 0);
}

// ---------------------------------------------------------------------------
// Theme toggle
// ---------------------------------------------------------------------------

function initTheme() {
  const btn = $('#theme-toggle');
  const apply = (dark) => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('wfc-theme', dark ? 'dark' : 'light');
    } catch { /* storage unavailable — theme just won't persist */ }
    btn.textContent = dark ? '☀️ Light' : '🌙 Dark';
    // Chart colors come from CSS vars — re-render so SVG picks them up
    if (state.results) renderForceChart($('#chart'), state.results.timeData);
  };
  apply(document.documentElement.classList.contains('dark'));
  btn.addEventListener('click', () =>
    apply(!document.documentElement.classList.contains('dark'))
  );
}

// ---------------------------------------------------------------------------
// Scenarios (localStorage) + report export
// ---------------------------------------------------------------------------

function refreshScenarioList(names) {
  const sel = $('#scenario-list');
  sel.innerHTML = names.length
    ? names.map((n) => `<option value="${n.replace(/"/g, '&quot;')}">${n}</option>`).join('')
    : '<option value="" disabled selected>No saved scenarios</option>';
}

function initTools() {
  refreshScenarioList(listScenarios());

  $('#scenario-save').addEventListener('click', () => {
    const input = $('#scenario-name');
    const name =
      input.value.trim() ||
      `Scenario ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    refreshScenarioList(saveScenario(name, state.params));
    $('#scenario-list').value = name;
    input.value = '';
  });

  $('#scenario-load').addEventListener('click', () => {
    const params = loadScenario($('#scenario-list').value);
    if (params) state.replace(params);
  });

  $('#scenario-delete').addEventListener('click', () => {
    const name = $('#scenario-list').value;
    if (name) refreshScenarioList(deleteScenario(name));
  });

  $('#export-csv').addEventListener('click', () => {
    if (state.results) exportCSV(state.results);
  });

  $('#export-pdf').addEventListener('click', async () => {
    if (!state.results) return;
    const ok = await exportPDF(state.params, state.results, $('#chart'));
    if (!ok) alert('PDF export unavailable — jsPDF could not be loaded from the CDN.');
  });
}

// ---------------------------------------------------------------------------
// 3D visualization — dynamic import so a three.js CDN failure degrades
// gracefully instead of breaking the whole app.
// ---------------------------------------------------------------------------

let viz = null;
import('./viz3d.js')
  .then((m) => {
    viz = m.initViz3d($('#viz3d'));
    if (state.results) viz.update(state.results.wave, state.params);
  })
  .catch(() => {
    $('#viz3d').innerHTML =
      '<div class="flex h-full items-center justify-center text-sm text-neutral-400">' +
      '3D view unavailable (three.js could not be loaded)</div>';
  });

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

buildSidebar();
buildTiles();
renderLegend($('#legend'));
initTheme();
initTools();

state.on('params:changed', recalculate);
state.on('results:changed', render);

new ResizeObserver(() => {
  if (state.results) renderForceChart($('#chart'), state.results.timeData);
}).observe($('#chart'));

recalculate();

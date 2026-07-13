// Application entry point for the multi-body platform solver.
// Builds the environment controls and the dynamic Body Manager, wires them to
// the AppState store, and re-renders global + per-body results reactively.

import { AppState, bodyRadius } from './state.js';
import { computePlatform } from './morison.js';
import { renderForceChart, renderLegend } from './charts.js';
import { exportCSV, exportPDF } from './export.js';
import { saveScenario, listScenarios, loadScenario, deleteScenario } from './scenarios.js';

const state = new AppState();
const $ = (sel) => document.querySelector(sel);
const kN = (n) => `${(n / 1000).toFixed(2)} kN`;

// ---------------------------------------------------------------------------
// Environment schema — sidebar controls for the shared environment.
// ---------------------------------------------------------------------------

const ENV_GROUPS = [
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
      { key: 'H', label: 'Wave height H', unit: 'm', min: 0.1, max: 20, step: 0.1 },
      { key: 'T', label: 'Wave period T', unit: 's', min: 2, max: 25, step: 0.1 },
      { key: 'h', label: 'Water depth h', unit: 'm', min: 2, max: 500, step: 0.5 },
    ],
  },
  {
    title: 'Current',
    fields: [
      { key: 'U_c', label: 'Surface current', unit: 'm/s', min: 0, max: 4, step: 0.05 },
      {
        key: 'currentProfile', label: 'Current profile', type: 'select',
        options: [
          { value: 'uniform', label: 'Uniform over depth' },
          { value: 'power17', label: '1/7 power law' },
          { value: 'log', label: 'Logarithmic (zero at bed)' },
        ],
      },
    ],
  },
  {
    title: 'Wind (power law)',
    fields: [
      { key: 'V_wind', label: 'Wind speed @ ref', unit: 'm/s', min: 0, max: 80, step: 0.5 },
      { key: 'windBeta', label: 'Profile exponent β', unit: '–', min: 0.05, max: 0.4, step: 0.001 },
      { key: 'Cd_air', label: 'Shape coefficient', unit: '–', min: 0.3, max: 2, step: 0.05 },
      { key: 'h_exp', label: 'Exposed height', unit: 'm', min: 0, max: 80, step: 0.5 },
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
];

// ---------------------------------------------------------------------------
// Global result tiles.
// ---------------------------------------------------------------------------

const RESULT_TILES = [
  { id: 'peakTotal', label: 'Global peak base shear', fmt: (r) => kN(r.global.peakTotal) },
  { id: 'rms', label: 'Global RMS', fmt: (r) => kN(r.global.rms) },
  { id: 'peakDrag', label: 'Peak drag (summed)', fmt: (r) => kN(r.global.peakDrag) },
  { id: 'peakInertia', label: 'Peak inertia (summed)', fmt: (r) => kN(r.global.peakInertia) },
  { id: 'peakWind', label: 'Total wind base shear', fmt: (r) => kN(r.global.peakWind) },
  { id: 'wavelength', label: 'Wavelength λ', fmt: (r) => `${r.wavelength.toFixed(1)} m` },
  {
    id: 'arrayFactor', label: 'Array factor', fmt: (r) => r.arrayFactor.toFixed(3),
    sub: (r) => (r.arrayFactor < 0.9 ? 'net cancellation' : r.arrayFactor > 1.05 ? 'amplification' : 'in phase'),
  },
  {
    id: 'heave', label: 'Heave period T₃', fmt: (r) => `${r.heave.Tn3.toFixed(2)} s`,
    sub: (r) => (r.heave.resonance ? '⚠ resonance' : `T/T₃ = ${(1 / (r.heave.ratio || 1)).toFixed(2)}`),
  },
];

// ---------------------------------------------------------------------------
// Environment control builders.
// ---------------------------------------------------------------------------

function buildEnv() {
  const root = $('#inputs');
  root.innerHTML = '';
  for (const group of ENV_GROUPS) {
    const section = document.createElement('section');
    section.innerHTML =
      `<h3 class="mb-3 text-xs font-semibold uppercase tracking-wider ` +
      `text-neutral-500 dark:text-neutral-400">${group.title}</h3>`;
    const list = document.createElement('div');
    list.className = 'space-y-4';
    for (const f of group.fields) {
      const builder =
        f.type === 'checkbox' ? envCheckbox : f.type === 'select' ? envSelect : envNumber;
      list.appendChild(builder(f));
    }
    section.appendChild(list);
    root.appendChild(section);
  }
}

function envNumber(f) {
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
  const sync = (v) => { range.value = v; num.value = v; };
  sync(state.getEnv(f.key));
  range.addEventListener('input', () => { num.value = range.value; state.setEnv(f.key, Number(range.value)); });
  num.addEventListener('change', () => {
    const v = Math.min(f.max, Math.max(f.min, Number(num.value) || f.min));
    sync(v);
    state.setEnv(f.key, v);
  });
  state.on('env:changed', ({ keys, environment }) => {
    if (keys.includes(f.key)) sync(environment[f.key]);
  });
  return wrap;
}

function envSelect(f) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <label for="in-${f.key}" class="mb-1 block text-sm text-neutral-700 dark:text-neutral-200">${f.label}</label>
    <select id="in-${f.key}"
      class="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm
             focus:border-sky-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100">
      ${f.options.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')}
    </select>`;
  const sel = wrap.querySelector('select');
  sel.value = state.getEnv(f.key);
  sel.addEventListener('change', () => state.setEnv(f.key, sel.value));
  state.on('env:changed', ({ keys, environment }) => {
    if (keys.includes(f.key)) sel.value = environment[f.key];
  });
  return wrap;
}

function envCheckbox(f) {
  const wrap = document.createElement('label');
  wrap.className = 'flex cursor-pointer items-center justify-between';
  wrap.innerHTML = `
    <span class="text-sm text-neutral-700 dark:text-neutral-200">${f.label}</span>
    <input id="in-${f.key}" type="checkbox" class="h-4 w-4 rounded accent-sky-600">`;
  const box = wrap.querySelector('input');
  box.checked = state.getEnv(f.key);
  box.addEventListener('change', () => state.setEnv(f.key, box.checked));
  state.on('env:changed', ({ keys, environment }) => {
    if (keys.includes(f.key)) box.checked = environment[f.key];
  });
  return wrap;
}

// ---------------------------------------------------------------------------
// Body Manager — dynamic cards, rebuilt on structural change.
// ---------------------------------------------------------------------------

function bodyNumberInput(id, key, value, { min, max, step, label, unit }) {
  const cell = document.createElement('div');
  cell.innerHTML = `
    <label class="mb-0.5 flex items-baseline justify-between text-xs text-neutral-500 dark:text-neutral-400">
      <span>${label}</span><span>${unit}</span>
    </label>
    <input type="number" value="${value}" min="${min}" max="${max}" step="${step}"
      class="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-right text-sm tabular-nums
             focus:border-sky-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100">`;
  const input = cell.querySelector('input');
  input.addEventListener('change', () => {
    const v = Math.min(max, Math.max(min, Number(input.value) || min));
    input.value = v;
    state.updateBody(id, key, v);
  });
  return cell;
}

function renderBodyManager() {
  const root = $('#body-manager');
  root.innerHTML = '';
  const bodies = state.bodies;

  bodies.forEach((body, i) => {
    const isSphere = body.type === 'sphere';
    const card = document.createElement('div');
    card.className =
      'rounded-lg border border-black/10 bg-neutral-50 p-3 dark:border-white/10 dark:bg-neutral-900/40';

    // Header: label + remove
    const head = document.createElement('div');
    head.className = 'mb-2 flex items-center justify-between';
    head.innerHTML = `
      <span class="text-sm font-medium text-neutral-800 dark:text-neutral-100">Body ${i + 1}</span>
      <button title="Remove body"
        class="rounded px-1.5 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10">✕</button>`;
    const removeBtn = head.querySelector('button');
    removeBtn.disabled = bodies.length <= 1;
    if (removeBtn.disabled) removeBtn.classList.add('opacity-30', 'cursor-not-allowed');
    removeBtn.addEventListener('click', () => bodies.length > 1 && state.removeBody(body.id));
    card.appendChild(head);

    // Type selector
    const typeWrap = document.createElement('div');
    typeWrap.className = 'mb-2';
    typeWrap.innerHTML = `
      <select class="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm
             focus:border-sky-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100">
        <option value="cylinder"${!isSphere ? ' selected' : ''}>Cylinder</option>
        <option value="sphere"${isSphere ? ' selected' : ''}>Sphere</option>
      </select>`;
    const typeSel = typeWrap.querySelector('select');
    typeSel.addEventListener('change', () => state.updateBody(body.id, 'type', typeSel.value, true));
    card.appendChild(typeWrap);

    // Numeric grid
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-2 gap-2';
    grid.appendChild(bodyNumberInput(body.id, 'x', body.x,
      { min: -400, max: 400, step: 1, label: 'X pos', unit: 'm' }));
    grid.appendChild(bodyNumberInput(body.id, 'y', body.y,
      { min: -400, max: 400, step: 1, label: 'Y pos', unit: 'm' }));
    if (isSphere) {
      grid.appendChild(bodyNumberInput(body.id, 'radius', body.radius,
        { min: 0.2, max: 20, step: 0.1, label: 'Radius', unit: 'm' }));
    } else {
      grid.appendChild(bodyNumberInput(body.id, 'diameter', body.diameter,
        { min: 0.2, max: 40, step: 0.1, label: 'Diameter', unit: 'm' }));
    }
    grid.appendChild(bodyNumberInput(body.id, 'draft', body.draft,
      { min: 0.5, max: 100, step: 0.5, label: 'Draft', unit: 'm' }));
    card.appendChild(grid);

    root.appendChild(card);
  });
}

// ---------------------------------------------------------------------------
// Result rendering.
// ---------------------------------------------------------------------------

function buildTiles() {
  const root = $('#tiles');
  root.innerHTML = RESULT_TILES.map(
    (t) => `
    <div class="rounded-xl border border-black/5 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-neutral-800/60">
      <div class="text-xs text-neutral-500 dark:text-neutral-400">${t.label}</div>
      <div id="tile-${t.id}" class="mt-1 text-xl font-semibold text-neutral-900 dark:text-neutral-50">–</div>
      <div id="tilesub-${t.id}" class="mt-0.5 text-xs text-neutral-400"></div>
    </div>`
  ).join('');
}

function render(results) {
  for (const t of RESULT_TILES) {
    $(`#tile-${t.id}`).textContent = t.fmt(results);
    const sub = $(`#tilesub-${t.id}`);
    if (sub) sub.textContent = t.sub ? t.sub(results) : '';
  }
  renderWarnings(results);
  renderForceChart($('#chart'), results.global.timeData);
  renderBodyTable(results);
  viz?.update(results.wave, state.bodies);
}

function renderBodyTable(results) {
  const tbody = $('#body-table');
  tbody.innerHTML = results.bodies
    .map(
      (b, i) => `
      <tr class="border-b border-black/5 dark:border-white/5">
        <td class="py-2 pr-4">Body ${i + 1}</td>
        <td class="py-2 pr-4 capitalize text-neutral-500 dark:text-neutral-400">${b.type}</td>
        <td class="py-2 pr-4 text-right">${b.x.toFixed(0)}</td>
        <td class="py-2 pr-4 text-right font-medium">${(b.peakTotal / 1000).toFixed(2)}</td>
        <td class="py-2 pr-4 text-right">${(b.rms / 1000).toFixed(2)}</td>
        <td class="py-2 pr-4 text-right">${b.KC.toFixed(2)}</td>
        <td class="py-2 pr-4 text-right">${b.Re.toExponential(1)}</td>
        <td class="py-2 pr-4 text-right">${b.ka.toFixed(3)}</td>
      </tr>`
    )
    .join('');
}

function banner(severity, html) {
  const styles = {
    critical: 'border-red-400 bg-red-100 text-red-900 dark:border-red-500/50 dark:bg-red-500/15 dark:text-red-200',
    warning: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200',
  }[severity];
  return `<div class="rounded-xl border px-4 py-3 text-sm ${styles}">${html}</div>`;
}

function renderWarnings(results) {
  const root = $('#warnings');
  const b = results.breaking;
  const out = [];

  if (b.critical) {
    const reasons = [];
    if (b.depthLimited) reasons.push(`H/h = ${b.depthRatio.toFixed(2)} &gt; 0.78 (depth-limited)`);
    if (b.steepLimited) reasons.push(`H/λ = ${b.steepness.toFixed(3)} &gt; 0.14 (steepness-limited)`);
    out.push(banner('critical',
      `<strong>⛔ CRITICAL: Wave Breaking Limit Exceeded</strong> — ${reasons.join('; ')}. ` +
      `Results are outside the valid range of the wave theory.`));
  } else if (b.micheLimited) {
    out.push(banner('warning',
      `<strong>⚠️ Near breaking (Miche):</strong> H/λ = ${b.steepness.toFixed(3)} ` +
      `&gt; ${b.micheLimit.toFixed(3)} — kinematics may be unreliable.`));
  }

  if (results.heave.resonance) {
    out.push(banner('warning',
      `<strong>⚠️ Potential Dynamic Resonance:</strong> heave natural period ` +
      `T₃ = ${results.heave.Tn3.toFixed(2)} s is within 10% of the wave period ` +
      `T = ${state.getEnv('T').toFixed(2)} s.`));
  }

  if (results.stokesConverged === false) {
    out.push(banner('warning',
      `<strong>⚠️ Stokes 5th order did not converge</strong> for these inputs — ` +
      `reduce wave height or increase depth.`));
  }

  root.innerHTML = out.join('');
}

// ---------------------------------------------------------------------------
// Reactive pipeline.
// ---------------------------------------------------------------------------

function recalculate() {
  state.setResults(computePlatform(state.environment, state.bodies));
}

// ---------------------------------------------------------------------------
// Theme toggle.
// ---------------------------------------------------------------------------

function initTheme() {
  const btn = $('#theme-toggle');
  const apply = (dark) => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('wfc-theme', dark ? 'dark' : 'light');
    } catch { /* storage unavailable — theme just won't persist */ }
    btn.textContent = dark ? '☀️ Light' : '🌙 Dark';
    if (state.results) renderForceChart($('#chart'), state.results.global.timeData);
  };
  apply(document.documentElement.classList.contains('dark'));
  btn.addEventListener('click', () => apply(!document.documentElement.classList.contains('dark')));
}

// ---------------------------------------------------------------------------
// Scenarios + report export.
// ---------------------------------------------------------------------------

function refreshScenarioList(names) {
  const sel = $('#scenario-list');
  sel.innerHTML = names.length
    ? names.map((n) => `<option value="${n.replace(/"/g, '&quot;')}">${n}</option>`).join('')
    : '<option value="" disabled selected>No saved scenarios</option>';
}

function initTools() {
  refreshScenarioList(listScenarios());

  $('#add-body').addEventListener('click', () => {
    const bodies = state.bodies;
    const last = bodies[bodies.length - 1];
    state.addBody({ x: (last?.x ?? 0) + 30, type: last?.type ?? 'cylinder' });
  });

  $('#scenario-save').addEventListener('click', () => {
    const input = $('#scenario-name');
    const name = input.value.trim() ||
      `Platform ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    refreshScenarioList(saveScenario(name, state.serialize()));
    $('#scenario-list').value = name;
    input.value = '';
  });

  $('#scenario-load').addEventListener('click', () => {
    const snap = loadScenario($('#scenario-list').value);
    if (snap) state.replace(snap);
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
    const ok = await exportPDF(state.environment, state.bodies, state.results, $('#chart'));
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
    if (state.results) viz.update(state.results.wave, state.bodies);
  })
  .catch(() => {
    $('#viz3d').innerHTML =
      '<div class="flex h-full items-center justify-center text-sm text-neutral-400">' +
      '3D view unavailable (three.js could not be loaded)</div>';
  });

// ---------------------------------------------------------------------------
// Boot.
// ---------------------------------------------------------------------------

buildEnv();
renderBodyManager();
buildTiles();
renderLegend($('#legend'));
initTheme();
initTools();

// Environment or body value edits → recalc. Structural body changes also
// rebuild the manager cards and the 3D meshes.
state.on('env:changed', recalculate);
state.on('bodies:changed', (e) => {
  if (e.reason !== 'update') renderBodyManager();
  recalculate();
});
state.on('results:changed', render);

new ResizeObserver(() => {
  if (state.results) renderForceChart($('#chart'), state.results.global.timeData);
}).observe($('#chart'));

recalculate();

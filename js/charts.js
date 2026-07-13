// Force time-series chart. Phase 1 ships a lightweight SVG renderer with a
// crosshair + tooltip hover layer; Phase 3 swaps the internals for Plotly.js
// behind this same renderForceChart() interface.
//
// Colors are read from CSS custom properties (--series-1..3, --chart-grid,
// --chart-ink-muted) so the light/dark theme swap happens in CSS alone.

const SERIES = [
  { key: 'drag', label: 'Drag', varName: '--series-1' },
  { key: 'inertia', label: 'Inertia', varName: '--series-2' },
  { key: 'total', label: 'Total', varName: '--series-3' },
];

const M = { top: 16, right: 76, bottom: 30 }; // fixed plot margins [px]; left is dynamic

const fmtkN = (n) => `${(n / 1000).toFixed(2)} kN`;

function cssVar(el, name) {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

export function renderForceChart(container, timeData) {
  container.innerHTML = '';
  if (!timeData?.length) return;

  const width = container.clientWidth || 640;
  const height = 320;

  const tMax = timeData[timeData.length - 1].t;
  let yMin = 0;
  let yMax = 0;
  for (const p of timeData) {
    for (const s of SERIES) {
      yMin = Math.min(yMin, p[s.key]);
      yMax = Math.max(yMax, p[s.key]);
    }
  }
  const pad = (yMax - yMin) * 0.08 || 1;
  yMin -= pad;
  yMax += pad;

  // "Nice" tick step (1/2/5 × 10^n) targeting ~5 gridlines, in kN
  const rangeKN = (yMax - yMin) / 1000;
  const rawStep = rangeKN / 5;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const step = ([1, 2, 5, 10].find((m) => rawStep / mag <= m) || 10) * mag;
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const ticks = [];
  for (let v = Math.ceil(yMin / 1000 / step) * step; v <= yMax / 1000 + 1e-9; v += step) {
    ticks.push({ v: v * 1000, label: v.toLocaleString('en-US', {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals }) });
  }

  // Left margin sized to the widest tick label (6.4px/char at 11px font)
  const maxChars = Math.max(...ticks.map((t) => t.label.length), 3);
  const left = 28 + Math.ceil(maxChars * 6.4);
  const pw = width - left - M.right; // plot width
  const ph = height - M.top - M.bottom;

  const x = (t) => left + (t / tMax) * pw;
  const y = (v) => M.top + (1 - (v - yMin) / (yMax - yMin)) * ph;

  const grid = cssVar(container, '--chart-grid');
  const inkMuted = cssVar(container, '--chart-ink-muted');
  const axis = cssVar(container, '--chart-axis');

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', height);
  svg.style.display = 'block';

  const el = (tag, attrs, parent = svg) => {
    const node = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.appendChild(node);
    return node;
  };

  // Horizontal gridlines + y tick labels
  for (const tick of ticks) {
    const yy = y(tick.v);
    el('line', { x1: left, x2: left + pw, y1: yy, y2: yy, stroke: grid, 'stroke-width': 1 });
    el('text', {
      x: left - 8, y: yy + 4, 'text-anchor': 'end', fill: inkMuted,
      'font-size': 11, 'font-family': 'system-ui, sans-serif',
    }).textContent = tick.label;
  }

  // Zero baseline (emphasized) + x axis ticks
  el('line', { x1: left, x2: left + pw, y1: y(0), y2: y(0), stroke: axis, 'stroke-width': 1.5 });
  for (let i = 0; i <= 4; i++) {
    const t = (tMax * i) / 4;
    el('text', {
      x: x(t), y: height - 8, 'text-anchor': 'middle', fill: inkMuted,
      'font-size': 11, 'font-family': 'system-ui, sans-serif',
    }).textContent = `${t.toFixed(1)} s`;
  }
  // Axis title (fixed at the far left, clear of tick labels)
  el('text', {
    x: 12, y: M.top + ph / 2, fill: inkMuted, 'font-size': 11,
    'font-family': 'system-ui, sans-serif', 'text-anchor': 'middle',
    transform: `rotate(-90 12 ${M.top + ph / 2})`,
  }).textContent = 'Force [kN]';

  // Series lines
  for (const s of SERIES) {
    const dAttr = timeData
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p[s.key]).toFixed(1)}`)
      .join('');
    el('path', {
      d: dAttr, fill: 'none', stroke: cssVar(container, s.varName),
      'stroke-width': 2, 'stroke-linejoin': 'round',
    });
  }

  // Direct labels at line ends, nudged apart so they never collide
  const last = timeData[timeData.length - 1];
  const labels = SERIES
    .map((s) => ({ s, y: y(last[s.key]) + 4 }))
    .sort((a, b) => a.y - b.y);
  const MIN_GAP = 14;
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].y - labels[i - 1].y < MIN_GAP) labels[i].y = labels[i - 1].y + MIN_GAP;
  }
  for (const { s, y: ly } of labels) {
    el('text', {
      x: left + pw + 6, y: ly, fill: cssVar(container, s.varName),
      'font-size': 11, 'font-weight': 600, 'font-family': 'system-ui, sans-serif',
    }).textContent = s.label;
  }

  // Hover layer: crosshair + tooltip
  const crosshair = el('line', {
    y1: M.top, y2: M.top + ph, stroke: axis, 'stroke-width': 1,
    'stroke-dasharray': '3,3', visibility: 'hidden',
  });
  const dots = SERIES.map((s) =>
    el('circle', { r: 4, fill: cssVar(container, s.varName), visibility: 'hidden' })
  );

  const tooltip = document.createElement('div');
  tooltip.className =
    'pointer-events-none absolute z-10 hidden rounded-md border border-black/10 dark:border-white/10 ' +
    'bg-white/95 dark:bg-neutral-800/95 px-3 py-2 text-xs shadow-lg';
  container.style.position = 'relative';
  container.appendChild(tooltip);

  svg.addEventListener('mousemove', (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * width;
    if (px < left || px > left + pw) return;
    const idx = Math.round(((px - left) / pw) * (timeData.length - 1));
    const p = timeData[Math.max(0, Math.min(timeData.length - 1, idx))];

    crosshair.setAttribute('x1', x(p.t));
    crosshair.setAttribute('x2', x(p.t));
    crosshair.setAttribute('visibility', 'visible');
    SERIES.forEach((s, i) => {
      dots[i].setAttribute('cx', x(p.t));
      dots[i].setAttribute('cy', y(p[s.key]));
      dots[i].setAttribute('visibility', 'visible');
    });

    tooltip.innerHTML =
      `<div class="font-semibold mb-1">t = ${p.t.toFixed(2)} s</div>` +
      SERIES.map(
        (s) =>
          `<div class="flex items-center gap-2">` +
          `<span class="inline-block h-2 w-2 rounded-full" style="background:${cssVar(container, s.varName)}"></span>` +
          `<span class="text-neutral-500 dark:text-neutral-400">${s.label}</span>` +
          `<span class="ml-auto font-medium tabular-nums">${fmtkN(p[s.key])}</span></div>`
      ).join('');
    tooltip.classList.remove('hidden');
    const tipX = (x(p.t) / width) * rect.width;
    tooltip.style.left = `${Math.min(tipX + 14, rect.width - 150)}px`;
    tooltip.style.top = '12px';
  });
  svg.addEventListener('mouseleave', () => {
    crosshair.setAttribute('visibility', 'hidden');
    dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
    tooltip.classList.add('hidden');
  });

  container.appendChild(svg);
}

/** Legend row (HTML, above the plot). */
export function renderLegend(container) {
  container.innerHTML = SERIES.map(
    (s) =>
      `<span class="inline-flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">` +
      `<span class="inline-block h-2.5 w-2.5 rounded-full" style="background:var(${s.varName})"></span>${s.label}</span>`
  ).join('');
}

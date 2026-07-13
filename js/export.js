// Report export: global force time-series as CSV, and a one-page PDF summary
// (environment, body list, global results, heave, breaking) via jsPDF.

import { chartSnapshot } from './charts.js';
import { bodyRadius } from './state.js';

const kN = (n) => `${(n / 1000).toFixed(2)} kN`;

const ENV_ROWS = [
  ['Wave theory', (e) => (e.waveTheory === 'stokes5' ? 'Stokes 5th order' : 'Airy (linear)')],
  ['Wave height H', (e) => `${e.H} m`],
  ['Wave period T', (e) => `${e.T} s`],
  ['Water depth h', (e) => `${e.h} m`],
  ['Surface current', (e) => `${e.U_c} m/s`],
  ['Current profile', (e) => ({ power17: '1/7 power law', log: 'Logarithmic' }[e.currentProfile] || 'Uniform')],
  ['Wind speed', (e) => `${e.V_wind} m/s`],
  ['Wind exponent', (e) => `${e.windBeta}`],
  ['Drag / inertia Cd,Cm', (e) => `${e.Cd} / ${e.Cm}`],
  ['MacCamy-Fuchs', (e) => (e.useMacCamy ? 'on' : 'off')],
];

function resultRows(r) {
  return [
    ['Global peak base shear', kN(r.global.peakTotal)],
    ['Global RMS', kN(r.global.rms)],
    ['Peak drag (summed)', kN(r.global.peakDrag)],
    ['Peak inertia (summed)', kN(r.global.peakInertia)],
    ['Total wind base shear', kN(r.global.peakWind)],
    ['Wavelength', `${r.wavelength.toFixed(1)} m`],
    ['Array factor', r.arrayFactor.toFixed(3)],
    ['Heave period T3', `${r.heave.Tn3.toFixed(2)} s`],
    ['Resonance', r.heave.resonance ? 'YES (within 10%)' : 'no'],
    ['Number of bodies', `${r.bodies.length}`],
  ];
}

function download(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Global base-shear time series (plus per-body columns) as CSV. */
export function exportCSV(results) {
  const bodies = results.bodies;
  const header = ['t_s', 'global_total_kN', 'global_drag_kN', 'global_inertia_kN', 'global_wind_kN']
    .concat(bodies.map((_, i) => `body${i + 1}_total_kN`));
  const rows = [header];
  const steps = results.global.timeData.length;
  for (let i = 0; i < steps; i++) {
    const g = results.global.timeData[i];
    const row = [
      g.t.toFixed(4),
      (g.total / 1000).toFixed(4),
      (g.drag / 1000).toFixed(4),
      (g.inertia / 1000).toFixed(4),
      (g.wind / 1000).toFixed(4),
    ];
    for (const b of bodies) row.push((b.timeData[i].total / 1000).toFixed(4));
    rows.push(row);
  }
  const csv = rows.map((r) => r.join(',')).join('\n');
  download('platform-forces.csv', new Blob([csv], { type: 'text/csv;charset=utf-8' }));
}

/** One-page PDF summary. Returns false if jsPDF isn't loaded. */
export async function exportPDF(env, bodies, results, chartContainer, chartLabel = 'Global Platform Force') {
  if (!window.jspdf?.jsPDF) return false;
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const MARGIN = 18;
  let y = 20;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Multi-Body Hydrodynamic Solver - Summary', MARGIN, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} - ` +
    `Morison array, spatial-phase superposition`, MARGIN, y);
  doc.setTextColor(0);
  y += 9;

  const col2 = W / 2 + 4;
  const line = (x, yy, label, value) => {
    doc.setFont('helvetica', 'normal');
    doc.text(String(label), x, yy);
    doc.setFont('helvetica', 'bold');
    doc.text(String(value), x + 46, yy);
  };

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Environment', MARGIN, y);
  doc.text('Global results', col2, y);
  y += 5.5;
  doc.setFontSize(9);

  const rowsL = ENV_ROWS.map(([label, fn]) => [label, fn(env)]);
  const rowsR = resultRows(results);
  const n = Math.max(rowsL.length, rowsR.length);
  const yStart = y;
  for (let i = 0; i < n; i++) {
    if (rowsL[i]) line(MARGIN, y, rowsL[i][0], rowsL[i][1]);
    if (rowsR[i]) line(col2, y, rowsR[i][0], rowsR[i][1]);
    y += 5;
  }

  // Breaking / resonance warnings
  const b = results.breaking;
  if (b.critical || results.heave.resonance) {
    y += 1;
    doc.setTextColor(190, 30, 30);
    doc.setFont('helvetica', 'bold');
    if (b.critical) {
      doc.text(`CRITICAL: wave breaking limit exceeded (H/h=${b.depthRatio.toFixed(2)}, H/L=${b.steepness.toFixed(3)})`, MARGIN, y);
      y += 4.5;
    }
    if (results.heave.resonance) {
      doc.text(`WARNING: heave resonance - T3=${results.heave.Tn3.toFixed(2)}s near T=${env.T}s`, MARGIN, y);
      y += 4.5;
    }
    doc.setTextColor(0);
  }

  // Per-body table
  y = Math.max(y, yStart + n * 5) + 4;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Bodies', MARGIN, y);
  y += 5;
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  const cols = [MARGIN, MARGIN + 20, MARGIN + 48, MARGIN + 74, MARGIN + 104, MARGIN + 134, MARGIN + 160];
  ['Body', 'Type', 'x [m]', 'Size [m]', 'Peak |F|', 'RMS', 'KC'].forEach((h, i) => doc.text(h, cols[i], y));
  y += 4;
  doc.setFont('helvetica', 'normal');
  results.bodies.forEach((br, i) => {
    const input = bodies[i];
    const size = input ? (input.type === 'sphere' ? `R ${input.radius}` : `D ${input.diameter}`) : '';
    [
      `Body ${i + 1}`, br.type, br.x.toFixed(0), size,
      kN(br.peakTotal), kN(br.rms), br.KC.toFixed(2),
    ].forEach((v, c) => doc.text(String(v), cols[c], y));
    y += 4.5;
  });

  // Chart snapshot
  try {
    const png = await chartSnapshot(chartContainer);
    if (png) {
      y += 5;
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text(`${chartLabel} - one wave period`, MARGIN, y);
      y += 3;
      const imgW = W - 2 * MARGIN;
      doc.addImage(png, 'PNG', MARGIN, y, imgW, imgW * (420 / 980), undefined, 'FAST');
    }
  } catch {
    /* chart snapshot is best-effort */
  }

  doc.save('platform-report.pdf');
  return true;
}

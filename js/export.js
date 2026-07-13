// Report export: force time-series as CSV, and a one-page PDF summary
// (inputs, peak forces, dimensionless parameters, chart snapshot) via jsPDF.

import { chartSnapshot } from './charts.js';

const PARAM_ROWS = [
  ['Wave theory', (p) => (p.waveTheory === 'stokes5' ? 'Stokes 5th order' : 'Airy (linear)')],
  ['Wave height H', (p) => `${p.H} m`],
  ['Wave period T', (p) => `${p.T} s`],
  ['Water depth h', (p) => `${p.h} m`],
  ['Surface current U_c', (p) => `${p.U_c} m/s`],
  ['Current profile', (p) => (p.currentProfile === 'log' ? 'Logarithmic' : 'Uniform')],
  ['Cylinder diameter D', (p) => `${p.D} m`],
  ['Draft d', (p) => `${p.d} m`],
  ['Total length L', (p) => `${p.L} m`],
  ['Drag coefficient Cd', (p) => `${p.Cd}`],
  ['Inertia coefficient Cm', (p) => `${p.Cm}`],
  ['MacCamy-Fuchs', (p) => (p.useMacCamy ? 'on' : 'off')],
  ['Water density', (p) => `${p.rho} kg/m3`],
  ['Wind speed', (p) => `${p.V_wind} m/s`],
  ['Air drag coefficient', (p) => `${p.Cd_air}`],
  ['Exposed height', (p) => `${p.h_exp} m`],
];

const kN = (n) => `${(n / 1000).toFixed(2)} kN`;

const RESULT_ROWS = [
  ['Peak wave force', (r) => kN(r.peakWaveForce)],
  ['Peak drag force', (r) => kN(r.peakDragForce)],
  ['Peak inertia force', (r) => kN(r.peakInertiaForce)],
  ['Peak wind force', (r) => kN(r.peakAirForce)],
  ['Total peak force', (r) => kN(r.totalPeakForce)],
  ['RMS force', (r) => kN(r.rmsForce)],
  ['Wavelength', (r) => `${r.wavelength.toFixed(1)} m`],
  ['Keulegan-Carpenter KC', (r) => r.KC.toFixed(2)],
  ['Reynolds number Re', (r) => r.Re.toExponential(2)],
  ['Diffraction parameter ka', (r) => r.ka.toFixed(3)],
];

function download(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Force time series as CSV. */
export function exportCSV(results) {
  const rows = [['t_s', 'drag_kN', 'inertia_kN', 'wave_kN', 'wind_kN', 'total_kN']];
  for (const p of results.timeData) {
    rows.push([
      p.t.toFixed(4),
      (p.drag / 1000).toFixed(4),
      (p.inertia / 1000).toFixed(4),
      (p.wave / 1000).toFixed(4),
      (p.air / 1000).toFixed(4),
      (p.total / 1000).toFixed(4),
    ]);
  }
  const csv = rows.map((r) => r.join(',')).join('\n');
  download('wave-forces.csv', new Blob([csv], { type: 'text/csv;charset=utf-8' }));
}

/** One-page PDF summary. Returns false if jsPDF isn't loaded. */
export async function exportPDF(params, results, chartContainer) {
  if (!window.jspdf?.jsPDF) return false;
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const MARGIN = 18;
  let y = 20;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Wave Force Calculator - Summary Report', MARGIN, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} - ` +
    `Morison equation, strip-integrated over draft`, MARGIN, y);
  doc.setTextColor(0);
  y += 9;

  const col2 = W / 2 + 4;
  const line = (x, yy, label, value) => {
    doc.setFont('helvetica', 'normal');
    doc.text(label, x, yy);
    doc.setFont('helvetica', 'bold');
    doc.text(value, x + 46, yy);
  };

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Input parameters', MARGIN, y);
  doc.text('Results', col2, y);
  y += 5.5;
  doc.setFontSize(9);

  const rowsL = PARAM_ROWS.map(([label, fn]) => [label, fn(params)]);
  const rowsR = RESULT_ROWS.map(([label, fn]) => [label, fn(results)]);
  const n = Math.max(rowsL.length, rowsR.length);
  for (let i = 0; i < n; i++) {
    if (rowsL[i]) line(MARGIN, y, rowsL[i][0], rowsL[i][1]);
    if (rowsR[i]) line(col2, y, rowsR[i][0], rowsR[i][1]);
    y += 5;
  }

  // Warnings
  const b = results.breaking;
  if (b.breaking) {
    y += 2;
    doc.setTextColor(190, 30, 30);
    doc.setFont('helvetica', 'bold');
    const warn = b.depthLimited
      ? `WARNING: wave breaking limit exceeded - H/h = ${b.depthRatio.toFixed(2)} > 0.78`
      : `WARNING: wave breaking limit exceeded - H/L = ${b.steepness.toFixed(3)} > ${b.micheLimit.toFixed(3)} (Miche)`;
    doc.text(warn, MARGIN, y);
    doc.setTextColor(0);
    y += 4;
  }

  // Chart snapshot
  try {
    const png = await chartSnapshot(chartContainer);
    if (png) {
      y += 4;
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('Force time series - one wave period', MARGIN, y);
      y += 3;
      const imgW = W - 2 * MARGIN;
      doc.addImage(png, 'PNG', MARGIN, y, imgW, imgW * (420 / 980), undefined, 'FAST');
    }
  } catch {
    /* chart snapshot is best-effort */
  }

  doc.save('wave-force-report.pdf');
  return true;
}

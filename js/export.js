/**
 * Data export module: CSV time series, JSON results record, and a paginated
 * PDF report generated with jsPDF.
 *
 * Formats:
 * 1. CSV:  time series (global + per-body drag/inertia/total) in kN, one row per sample.
 * 2. JSON: machine-readable record of inputs, results, warnings, assumptions,
 *          numerics and engine version (for reproducibility).
 * 3. PDF:  multi-page report with inputs, results, per-body table, validity
 *          warnings, model assumptions and a chart snapshot.
 *
 * Dependencies:
 * - jsPDF (vendor/, exposed as window.jspdf.jsPDF) — PDF only
 * - charts.js for chartSnapshot()
 *
 * @module export
 */

import { chartSnapshot } from './charts.js';

/**
 * Formats a force value in Newtons to a kN string with 2 decimal places.
 * @param {number} n - Force in Newtons
 * @returns {string} e.g. "12.34 kN", or "—" for non-finite input
 */
const kN = (n) => (Number.isFinite(n) ? `${(n / 1000).toFixed(2)} kN` : '—');

/**
 * Environment rows for the PDF report (label, getter).
 * @type {Array<[string, Function]>}
 */
const ENV_ROWS = [
  ['Wave theory', (e) => (e.waveTheory === 'stokes5' ? 'Stokes 5th order' : 'Airy (linear)')],
  ['Wave height H', (e) => `${e.H} m`],
  ['Wave period T (intrinsic)', (e) => `${e.T} s`],
  ['Water depth h', (e) => `${e.h} m`],
  ['Integration limit', (e) => (e.integrateTo === 'surface' ? 'Instantaneous surface' : 'Still-water level')],
  ['Surface current', (e) => `${e.U_c} m/s`],
  ['Current profile', (e) => ({ power17: '1/7 power law', log: 'Logarithmic' }[e.currentProfile] || 'Uniform')],
  ['Wind speed @ ref', (e) => `${e.V_wind} m/s (beta ${e.windBeta})`],
  ['Cd / Cm', (e) => `${e.Cd} / ${e.Cm}`],
  ['MacCamy-Fuchs (cyl.)', (e) => (e.useMacCamy ? 'on (inertia only)' : 'off')],
  ['Sphere model', (e) => (e.sphereModel === 'exact' ? 'Exact section' : 'Thesis 3-slice')],
  ['Water density', (e) => `${e.rho} kg/m3`],
];

/**
 * Result rows for the PDF report.
 * @param {Object} r - successful result of computePlatform()
 * @returns {Array<[string, string]>}
 */
function resultRows(r) {
  return [
    ['Global peak base shear', kN(r.global.peakTotal)],
    ['Global RMS', kN(r.global.rms)],
    ['Peak drag (summed)', kN(r.global.peakDrag)],
    ['Peak inertia (summed)', kN(r.global.peakInertia)],
    ['Wind (steady)', kN(r.global.peakWind)],
    ['Wavelength', `${r.wavelength.toFixed(1)} m`],
    ['Array factor', r.arrayFactor.toFixed(3)],
    ['Heave T3 (screening)', r.heave.applicable ? `${r.heave.Tn3.toFixed(2)} s` : 'n/a'],
    ['Screening band', r.heave.applicable ? `${r.heave.bandLow.toFixed(1)}-${r.heave.bandHigh.toFixed(1)} s` : 'n/a'],
    ['Bodies', `${r.bodies.length}`],
  ];
}

/**
 * Transliterate text into the Latin-1 range supported by jsPDF's standard
 * fonts, so symbols never print as garbage.
 * @param {string} s
 * @returns {string}
 */
export function pdfText(s) {
  const map = {
    'λ': 'lambda', 'ρ': 'rho', 'ν': 'nu', 'β': 'beta', 'δ': 'delta', 'η': 'eta', 'θ': 'theta',
    'π': 'pi', 'ω': 'omega', '∇': 'V', '≈': '~', '≤': '<=', '≥': '>=', '—': '-', '–': '-',
    '→': '->', '₃': '3', '⚠': '!', '⛔': '!', 'ℹ': 'i', '“': '"', '”': '"', '’': "'", '…': '...',
    '√': 'sqrt', '∞': 'inf', '·': '*',
  };
  return String(s).replace(/[^\x20-\x7E\xA0-\xFF]/gu, (ch) => map[ch] ?? '?');
}

/**
 * Triggers a browser download of a blob.
 * @param {string} filename
 * @param {Blob} blob
 * @throws {Error} if the download cannot be initiated
 */
function download(filename, blob) {
  if (!filename || !blob) throw new Error('Invalid filename or blob for download');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}

/**
 * Builds the CSV text for a successful result.
 * Columns: t_s, global total/drag/inertia/wind, then per body i:
 * body{i}_total_kN, body{i}_drag_kN, body{i}_inertia_kN. Values in kN, 6 decimals.
 *
 * @param {Object} results - successful result of computePlatform()
 * @returns {string}
 * @throws {Error} if results are missing or not ok
 */
export function buildCSV(results) {
  if (!results?.ok || !results.global?.timeData?.length) {
    throw new Error('No valid results to export (resolve the reported errors first).');
  }
  const f = (n) => (n / 1000).toFixed(6);
  const header = ['t_s', 'global_total_kN', 'global_drag_kN', 'global_inertia_kN', 'global_wind_kN'];
  results.bodies.forEach((_, i) => header.push(`body${i + 1}_total_kN`, `body${i + 1}_drag_kN`, `body${i + 1}_inertia_kN`));
  const rows = [header.join(',')];
  results.global.timeData.forEach((g, i) => {
    const row = [g.t.toFixed(6), f(g.total), f(g.drag), f(g.inertia), f(g.wind)];
    for (const b of results.bodies) {
      const p = b.timeData[i];
      row.push(f(p.total), f(p.drag), f(p.inertia));
    }
    rows.push(row.join(','));
  });
  return rows.join('\n') + '\n';
}

/**
 * Downloads the CSV time series.
 * @param {Object} results - successful result of computePlatform()
 * @throws {Error} if results are invalid or the download fails
 */
export function exportCSV(results) {
  download('platform-forces.csv', new Blob([buildCSV(results)], { type: 'text/csv;charset=utf-8' }));
}

/**
 * Builds the machine-readable results record.
 * @param {Object} snapshot - state.serialize()
 * @param {Object} results - result of computePlatform() (ok or not)
 * @returns {Object}
 */
export function buildResultsRecord(snapshot, results) {
  const record = {
    format: 'offshore-studio/results',
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    engineVersion: results?.engineVersion ?? null,
    inputs: snapshot,
    ok: Boolean(results?.ok),
    errors: results?.errors ?? [],
    warnings: results?.warnings ?? [],
    infos: results?.infos ?? [],
    assumptions: results?.assumptions ?? [],
    units: { length: 'm', time: 's', force: 'N', mass: 'kg' },
  };
  if (!results?.ok) return record;
  const { heave } = results;
  return {
    ...record,
    numerics: results.numerics,
    wave: { theory: results.wave.theory, k: results.k, omega: results.omega, wavelength: results.wavelength, ursell: results.wave.ursell },
    summary: {
      peakTotal: results.global.peakTotal, rms: results.global.rms, peakDrag: results.global.peakDrag,
      peakInertia: results.global.peakInertia, wind: results.global.peakWind, arrayFactor: results.arrayFactor,
    },
    heaveScreening: {
      status: heave.status, mass: heave.mass, addedMass: heave.addedMass, restoringStiffness: heave.restoringStiffness,
      Tn3: heave.Tn3, Tn3NoAddedMass: heave.Tn3NoAddedMass, bandLow: heave.bandLow, bandHigh: heave.bandHigh,
      potentialResonance: heave.potentialResonance, damping: null, excitation: null, assumptions: heave.assumptions,
    },
    bodies: results.bodies.map((b) => ({
      id: b.id, type: b.type, x: b.x, y: b.y, peakTotal: b.peakTotal, rms: b.rms, windForce: b.windForce,
      KC: b.KC, Re: b.Re, ka: b.ka, Dlambda: b.Dlambda, mfApplied: b.mfApplied, mfInertiaRatio: b.mfInertiaRatio,
      submergedVolume: b.submergedVolume,
    })),
    timeSeries: {
      t: results.global.timeData.map((p) => p.t),
      globalTotal: results.global.timeData.map((p) => p.total),
      bodyTotals: results.bodies.map((b) => b.timeData.map((p) => p.total)),
    },
  };
}

/**
 * Downloads the JSON results record.
 * @param {Object} snapshot - state.serialize()
 * @param {Object} results
 */
export function exportJSON(snapshot, results) {
  const text = JSON.stringify(buildResultsRecord(snapshot, results), null, 2);
  download('platform-results.json', new Blob([text], { type: 'application/json' }));
}

/**
 * Exports a paginated PDF report using jsPDF.
 *
 * @param {Object} env - environment
 * @param {Array} bodies - body definitions (state.bodies)
 * @param {Object} results - successful result of computePlatform()
 * @param {HTMLElement} chartContainer - element holding the rendered chart
 * @param {string} [chartLabel='Global Platform Force']
 * @returns {Promise<{ok: true, pages: number} | {ok: false, reason: 'missing-library'|'invalid-results'|'error', message: string}>}
 */
export async function exportPDF(env, bodies, results, chartContainer, chartLabel = 'Global Platform Force') {
  if (!window.jspdf?.jsPDF) {
    return { ok: false, reason: 'missing-library', message: 'jsPDF is not loaded.' };
  }
  if (!results?.ok) {
    return { ok: false, reason: 'invalid-results', message: 'No valid results to report.' };
  }
  try {
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210, H = 297, M = 18, BOTTOM = H - 16;
    let y = 20;
    const ensure = (needed) => { if (y + needed > BOTTOM) { doc.addPage(); y = 20; } };
    const heading = (text) => {
      ensure(12);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text(pdfText(text), M, y); y += 6;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    };
    const paragraph = (text, { color = [0, 0, 0], bullet = '' } = {}) => {
      doc.setTextColor(...color);
      for (const line of doc.splitTextToSize(pdfText(`${bullet}${text}`), W - 2 * M)) {
        ensure(5); doc.text(line, M, y); y += 4.4;
      }
      doc.setTextColor(0);
    };

    // Title
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text('Multi-Body Hydrodynamic Solver - Report', M, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110);
    doc.text(pdfText(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC - engine ${results.engineVersion} - fixed-body Morison superposition`), M, y);
    doc.setTextColor(0); y += 9;

    // Environment | results (two columns)
    const col2 = W / 2 + 4;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('Environment', M, y); doc.text('Global results', col2, y); y += 5.5;
    doc.setFontSize(9);
    const left = ENV_ROWS.map(([l, fn]) => [l, fn(env)]);
    const right = resultRows(results);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      ensure(5);
      for (const [x, row] of [[M, left[i]], [col2, right[i]]]) {
        if (!row) continue;
        doc.setFont('helvetica', 'normal'); doc.text(pdfText(row[0]), x, y);
        doc.setFont('helvetica', 'bold'); doc.text(pdfText(row[1]), x + 44, y);
      }
      y += 5;
    }
    doc.setFont('helvetica', 'normal');
    y += 3;

    // Warnings
    if (results.warnings.length) {
      heading('Validity warnings');
      for (const w of results.warnings) paragraph(w.message, { color: [150, 80, 0], bullet: '! ' });
      y += 2;
    }

    // Bodies table (paginated, header repeated)
    heading('Bodies');
    const cols = [M, M + 16, M + 36, M + 52, M + 74, M + 96, M + 116, M + 136, M + 154];
    const head = ['Body', 'Type', 'x [m]', 'Size [m]', 'Peak |F|', 'RMS', 'D/lambda', 'KC', 'MF'];
    const drawHead = () => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
      head.forEach((t, i) => doc.text(t, cols[i], y)); y += 4.5;
      doc.setFont('helvetica', 'normal');
    };
    drawHead();
    results.bodies.forEach((br, i) => {
      if (y + 4.5 > BOTTOM) { doc.addPage(); y = 20; drawHead(); }
      const input = bodies[i];
      const size = input ? (input.type === 'sphere' ? `R ${input.radius}` : `D ${input.diameter}`) : '-';
      [
        `Body ${i + 1}`, br.type, br.x.toFixed(0), size, kN(br.peakTotal), kN(br.rms),
        br.Dlambda.toFixed(3), br.KC.toFixed(2), br.mfApplied ? br.mfInertiaRatio.toFixed(3) : '-',
      ].forEach((v, c) => doc.text(pdfText(v), cols[c], y));
      y += 4.5;
    });
    y += 3;

    // Chart
    try {
      const png = await chartSnapshot(chartContainer);
      if (png) {
        const imgW = W - 2 * M, imgH = imgW * (420 / 980);
        ensure(imgH + 10);
        heading(`${chartLabel} - one wave period`);
        doc.addImage(png, 'PNG', M, y, imgW, imgH, undefined, 'FAST');
        y += imgH + 4;
      }
    } catch (err) {
      paragraph(`Chart snapshot unavailable: ${err.message}`, { color: [110, 110, 110] });
    }

    // Assumptions and method
    heading('Model assumptions and limitations');
    for (const a of results.assumptions) paragraph(a, { bullet: '- ' });
    for (const a of results.heave.assumptions) paragraph(`Heave screening: ${a}`, { bullet: '- ' });
    if (results.infos.length) for (const i of results.infos) paragraph(i.message, { bullet: '- ' });
    const n = results.numerics;
    paragraph(`Numerics: composite Gauss-Legendre ${n.panels}x${n.order} points per wetted length; ${n.timeSamples} samples per period; peaks refined on the continuous force function.`, { bullet: '- ' });
    y += 2;
    heading('Verification status');
    paragraph('The numerical methods are verified against analytical benchmarks (closed-form Morison integrals, exact MacCamy-Fuchs force, Stokes 5th boundary-condition residuals) - see docs/VALIDATION_MATRIX.md. The results have NOT been validated against model tests or field measurements and are not a substitute for a certified design analysis.');

    // Footers
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFontSize(8); doc.setTextColor(120);
      doc.text(`Page ${p} of ${pages}`, W - M, H - 8, { align: 'right' });
      doc.text('Fixed-body Morison analysis - screening tool', M, H - 8);
      doc.setTextColor(0);
    }
    doc.save('platform-report.pdf');
    return { ok: true, pages };
  } catch (err) {
    console.error('PDF export error:', err);
    return { ok: false, reason: 'error', message: err.message };
  }
}

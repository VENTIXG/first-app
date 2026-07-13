/**
 * Data export module: CSV download and one-page PDF report generation via jsPDF.
 *
 * Provides functions to export calculation results in two formats:
 * 1. CSV: Full time-series data for post-processing in Excel/MATLAB/Python
 * 2. PDF: One-page professional report with inputs, results, and chart snapshot
 *
 * Dependencies:
 * - jsPDF (loaded from CDN as window.jspdf.jsPDF)
 * - charts.js for chartSnapshot()
 *
 * @module export
 */

import { chartSnapshot } from './charts.js';

/**
 * Formats a force value in Newtons to kN string with 2 decimal places.
 * @param {number} n - Force in Newtons
 * @returns {string} Formatted force string (e.g., "12.34 kN")
 */
const kN = (n) => {
  if (!Number.isFinite(n)) return '—';
  return `${(n / 1000).toFixed(2)} kN`;
};

/**
 * Environment parameter rows for the PDF report left column.
 * Each entry is [label, getter_function] where getter extracts from env.
 * @type {Array<[string, Function]>}
 */
const ENV_ROWS = [
  ['Wave theory', (e) => (e.waveTheory === 'stokes5' ? 'Stokes 5th order' : 'Airy (linear)')],
  ['Wave height H', (e) => `${e.H ?? '—'} m`],
  ['Wave period T', (e) => `${e.T ?? '—'} s`],
  ['Water depth h', (e) => `${e.h ?? '—'} m`],
  ['Surface current', (e) => `${e.U_c ?? '—'} m/s`],
  ['Current profile', (e) => ({ power17: '1/7 power law', log: 'Logarithmic' }[e.currentProfile] || 'Uniform')],
  ['Wind speed', (e) => `${e.V_wind ?? '—'} m/s`],
  ['Wind exponent', (e) => `${e.windBeta ?? '—'}`],
  ['Drag / inertia Cd,Cm', (e) => `${e.Cd ?? '—'} / ${e.Cm ?? '—'}`],
  ['MacCamy-Fuchs', (e) => (e.useMacCamy ? 'on' : 'off')],
];

/**
 * Builds result parameter rows for the PDF report right column.
 * @param {Object} r - Results object from computePlatform()
 * @returns {Array<[string, string]>} Array of [label, value] pairs
 */
function resultRows(r) {
  if (!r || !r.global) {
    return [['Error', 'Results incomplete or invalid']];
  }
  return [
    ['Global peak base shear', kN(r.global?.peakTotal)],
    ['Global RMS', kN(r.global?.rms)],
    ['Peak drag (summed)', kN(r.global?.peakDrag)],
    ['Peak inertia (summed)', kN(r.global?.peakInertia)],
    ['Total wind base shear', kN(r.global?.peakWind)],
    ['Wavelength', r.wavelength ? `${r.wavelength.toFixed(1)} m` : '—'],
    ['Array factor', r.arrayFactor ? r.arrayFactor.toFixed(3) : '—'],
    ['Heave period T3', r.heave?.Tn3 ? `${r.heave.Tn3.toFixed(2)} s` : '—'],
    ['Resonance', r.heave?.resonance ? 'YES (within 10%)' : 'no'],
    ['Number of bodies', `${r.bodies?.length ?? 0}`],
  ];
}

/**
 * Triggers a browser download of a blob with the given filename.
 * Uses the HTML5 Blob + download attribute approach (compatible with all modern browsers).
 *
 * @param {string} filename - Filename for download (e.g., 'report.pdf')
 * @param {Blob} blob - File contents
 * @throws {Error} If blob creation or download initiation fails
 */
function download(filename, blob) {
  if (!filename || !blob) {
    throw new Error('Invalid filename or blob for download');
  }
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  } catch (err) {
    console.error('Download failed:', err);
    throw new Error(`Failed to download ${filename}: ${err.message}`);
  }
}

/**
 * Exports global base-shear time series as CSV format.
 *
 * The CSV includes:
 * - Global total, drag, inertia, and wind forces
 * - Per-body total forces (one column per body)
 * - Time series over one wave period
 *
 * Format: comma-separated values with header row
 * Compatible with: Excel, MATLAB, Python pandas, etc.
 *
 * @param {Object} results - Results object from computePlatform()
 * @param {Array} results.bodies - Array of body result objects
 * @param {Object} results.global - Global force results
 * @param {Array} results.global.timeData - Time series array of {t, drag, inertia, total, wind}
 *
 * @throws {Error} If results are invalid or download fails
 */
export function exportCSV(results) {
  // Validate inputs
  if (!results || !Array.isArray(results.bodies) || !results.global?.timeData) {
    throw new Error('Cannot export CSV: results object is incomplete or invalid');
  }

  try {
    const bodies = results.bodies;
    const timeData = results.global.timeData;

    if (!Array.isArray(timeData) || timeData.length === 0) {
      throw new Error('No time-series data available for export');
    }

    // Build CSV header
    const header = [
      't_s',
      'global_total_kN',
      'global_drag_kN',
      'global_inertia_kN',
      'global_wind_kN',
    ].concat(bodies.map((_, i) => `body${i + 1}_total_kN`));

    // Build CSV rows
    const rows = [header];
    for (let i = 0; i < timeData.length; i++) {
      const g = timeData[i];
      const row = [
        (g.t ?? 0).toFixed(4),
        ((g.total ?? 0) / 1000).toFixed(4),
        ((g.drag ?? 0) / 1000).toFixed(4),
        ((g.inertia ?? 0) / 1000).toFixed(4),
        ((g.wind ?? 0) / 1000).toFixed(4),
      ];
      for (const b of bodies) {
        const bodyTimeData = b.timeData?.[i];
        const bodyTotal = bodyTimeData?.total ?? 0;
        row.push((bodyTotal / 1000).toFixed(4));
      }
      rows.push(row);
    }

    // Convert to CSV string
    const csv = rows.map((r) => r.join(',')).join('\n');

    // Trigger download
    download(
      'platform-forces.csv',
      new Blob([csv], { type: 'text/csv;charset=utf-8' })
    );
  } catch (err) {
    console.error('CSV export failed:', err);
    throw new Error(`CSV export failed: ${err.message}`);
  }
}

/**
 * Exports a one-page PDF summary report using jsPDF.
 *
 * The PDF includes:
 * - Header with generation timestamp
 * - Left column: environment parameters
 * - Right column: calculated results
 * - Breaking and resonance warnings (if applicable)
 * - Per-body results table
 * - Embedded chart snapshot (if available)
 *
 * Gracefully handles missing dependencies and fallback scenarios.
 *
 * @param {Object} env - Environment object from state
 * @param {Array} bodies - Array of input body objects from state.bodies
 * @param {Object} results - Results object from computePlatform()
 * @param {HTMLElement} chartContainer - DOM element containing the rendered chart (for snapshot)
 * @param {string} [chartLabel='Global Platform Force'] - Label for the chart section in the PDF
 *
 * @returns {Promise<boolean>}
 *   - true if PDF was generated and downloaded successfully
 *   - false if jsPDF is not available (graceful degradation)
 *
 * @throws {Error} If results are invalid or chart snapshot fails (non-critical)
 *
 * @example
 * const success = await exportPDF(env, bodies, results, chartEl);
 * if (!success) {
 *   alert('PDF export unavailable — jsPDF not loaded from CDN.');
 * }
 */
export async function exportPDF(env, bodies, results, chartContainer, chartLabel = 'Global Platform Force') {
  // Check if jsPDF is available
  if (!window.jspdf?.jsPDF) {
    console.warn('jsPDF not available. Check CDN load in browser console.');
    return false;
  }

  try {
    // Validate required inputs
    if (!env || !Array.isArray(bodies) || !results || !results.global || !results.bodies) {
      throw new Error('PDF export: required parameters are missing or invalid');
    }

    // Initialize PDF document
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210;
    const MARGIN = 18;
    let y = 20;

    // --- Header ---
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Multi-Body Hydrodynamic Solver - Summary', MARGIN, y);
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(120);
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    doc.text(
      `Generated ${timestamp} - Morison array, spatial-phase superposition`,
      MARGIN,
      y
    );
    doc.setTextColor(0);
    y += 9;

    // --- Environment and Results Tables ---
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

    // --- Breaking and Resonance Warnings ---
    const breaking = results.breaking;
    if (breaking?.critical || results.heave?.resonance) {
      y += 1;
      doc.setTextColor(190, 30, 30);
      doc.setFont('helvetica', 'bold');
      if (breaking?.critical) {
        const msg = `CRITICAL: wave breaking limit exceeded (H/h=${breaking.depthRatio?.toFixed(2) ?? '—'}, H/L=${breaking.steepness?.toFixed(3) ?? '—'})`;
        doc.text(msg, MARGIN, y);
        y += 4.5;
      }
      if (results.heave?.resonance) {
        const msg = `WARNING: heave resonance - T3=${results.heave.Tn3?.toFixed(2) ?? '—'}s near T=${env.T ?? '—'}s`;
        doc.text(msg, MARGIN, y);
        y += 4.5;
      }
      doc.setTextColor(0);
    }

    // --- Per-Body Results Table ---
    y = Math.max(y, yStart + n * 5) + 4;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Bodies', MARGIN, y);
    y += 5;

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    const cols = [
      MARGIN,
      MARGIN + 20,
      MARGIN + 48,
      MARGIN + 74,
      MARGIN + 104,
      MARGIN + 134,
      MARGIN + 160,
    ];
    ['Body', 'Type', 'x [m]', 'Size [m]', 'Peak |F|', 'RMS', 'KC'].forEach((h, i) => {
      doc.text(h, cols[i], y);
    });
    y += 4;

    doc.setFont('helvetica', 'normal');
    results.bodies.forEach((br, i) => {
      const input = bodies[i];
      const size = input
        ? input.type === 'sphere'
          ? `R ${input.radius?.toFixed(1) ?? '—'}`
          : `D ${input.diameter?.toFixed(1) ?? '—'}`
        : '—';
      const values = [
        `Body ${i + 1}`,
        br.type || '—',
        (br.x ?? 0).toFixed(0),
        size,
        kN(br.peakTotal),
        kN(br.rms),
        (br.KC ?? 0).toFixed(2),
      ];
      values.forEach((v, c) => {
        doc.text(String(v), cols[c], y);
      });
      y += 4.5;
    });

    // --- Chart Snapshot ---
    if (chartContainer) {
      try {
        const png = await chartSnapshot(chartContainer);
        if (png) {
          y += 5;
          doc.setFontSize(11);
          doc.setFont('helvetica', 'bold');
          doc.text(`${chartLabel} - one wave period`, MARGIN, y);
          y += 3;
          const imgW = W - 2 * MARGIN;
          const imgH = imgW * (420 / 980); // Maintain aspect ratio
          doc.addImage(png, 'PNG', MARGIN, y, imgW, imgH, undefined, 'FAST');
        }
      } catch (err) {
        console.warn('Chart snapshot failed (non-critical):', err.message);
        // Continue without chart - it's a best-effort feature
      }
    }

    // Save the PDF
    doc.save('platform-report.pdf');
    return true;
  } catch (err) {
    console.error('PDF export error:', err);
    // Return false instead of throwing so the app doesn't crash
    // The UI will handle the false return value gracefully
    return false;
  }
}

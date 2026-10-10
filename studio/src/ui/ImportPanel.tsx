import { useState } from 'react';
import { ASSUMABLE_UNITS } from '../core/units.ts';
import type { RhinoImportResult } from '../core/rhinoImport.ts';

interface Props {
  busy: boolean;
  report: RhinoImportResult | null;
  needsUnits: string | null;
  onImport(file: File, options: { swlElevation: number; assumeUnits?: string }): void;
  onRetryWithUnits(units: string, swlElevation: number): void;
}

export function ImportPanel({ busy, report, needsUnits, onImport, onRetryWithUnits }: Props) {
  const [swl, setSwl] = useState('0');
  const [units, setUnits] = useState<string>('Meters');
  const swlValue = Number(swl);
  const swlOk = swl.trim() !== '' && Number.isFinite(swlValue);

  return (
    <div className="import">
      <div className="field">
        <label htmlFor="import-swl">Still-water level in the model<span className="unit">m</span></label>
        <input id="import-swl" type="text" inputMode="decimal" value={swl} onChange={(e) => setSwl(e.target.value)} />
      </div>
      <label className={`file ${busy || !swlOk ? 'disabled' : ''}`}>
        <input
          id="import-file"
          type="file"
          accept=".3dm"
          disabled={busy || !swlOk}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onImport(file, { swlElevation: swlValue });
          }}
        />
        {busy ? 'Reading…' : 'Import Rhino .3dm…'}
      </label>
      {!swlOk ? <p className="issue issue-error">Enter the still-water elevation as a number (0 if z = 0 is the water line).</p> : null}

      {needsUnits ? (
        <div className="units-needed" role="alert">
          <p>{needsUnits}</p>
          <div className="row">
            <select id="import-units" value={units} onChange={(e) => setUnits(e.target.value)} aria-label="Model units">
              {ASSUMABLE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <button type="button" disabled={busy || !swlOk} onClick={() => onRetryWithUnits(units, swlValue)}>Import with these units</button>
          </div>
        </div>
      ) : null}

      {report && report.ok ? (
        <div className="report" id="import-report">
          <p>
            <strong>{report.fileName}</strong>: {report.objects.length} imported, {report.skipped.length} skipped
            · units {report.unitSystem} (×{report.metresPerUnit} m)
          </p>
          <ul className="small">
            {report.notes.map((n, i) => <li key={i}>{n}</li>)}
            <li>Imported objects are not analysed until you tick “Include in load analysis”.</li>
          </ul>
          {report.skipped.length ? (
            <details>
              <summary>Skipped objects ({report.skipped.length})</summary>
              <ul className="small skipped">
                {report.skipped.map((s, i) => (
                  <li key={i}><strong>{s.name}</strong> ({s.rhinoType}{s.layer ? `, ${s.layer}` : ''}): {s.reason}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

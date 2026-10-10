import { fixed, kN } from './format.ts';
import type { AnalysisSummary } from '../core/analysis.ts';

interface Props {
  summary: AnalysisSummary | null;
  running: boolean;
  failure: string | null;
  onSelectObject(id: string): void;
}

export function ResultsPanel({ summary, running, failure, onSelectObject }: Props) {
  if (failure) return <p className="issue issue-error" role="alert">Analysis failed: {failure}</p>;
  if (!summary) return <p className="muted">{running ? 'Computing…' : 'No analysis yet.'}</p>;
  const nameOf = (bodyId: number) => summary.links.find((l) => l.bodyId === bodyId);
  return (
    <div className="results" aria-busy={running}>
      {summary.ok && summary.global ? (
        <>
          <dl className="tiles">
            <div><dt>Global peak base shear</dt><dd id="res-peak">{kN(summary.global.peakTotal)}</dd></div>
            <div><dt>RMS</dt><dd>{kN(summary.global.rms)}</dd></div>
            <div><dt>Peak drag (summed)</dt><dd>{kN(summary.global.peakDrag)}</dd></div>
            <div><dt>Peak inertia (summed)</dt><dd>{kN(summary.global.peakInertia)}</dd></div>
            <div><dt>Wind (steady)</dt><dd>{kN(summary.global.peakWind)}</dd></div>
            <div><dt>Wavelength</dt><dd>{fixed(summary.wavelength, 1)} m</dd></div>
            <div>
              <dt>Heave period T₃ (screening)</dt>
              <dd>{summary.heave?.applicable ? `${fixed(summary.heave.Tn3, 2)} s` : '—'}</dd>
            </div>
          </dl>
          <table className="bodies">
            <thead><tr><th>Body</th><th>Peak</th><th>RMS</th><th>D/λ</th><th>KC</th><th>MF</th></tr></thead>
            <tbody>
              {summary.bodies?.map((b) => {
                const link = nameOf(b.bodyId);
                return (
                  <tr key={b.bodyId}>
                    <td>
                      <button type="button" className="link" onClick={() => link && onSelectObject(link.objectId)}>
                        {b.bodyId}. {link?.name ?? ''}
                      </button>
                    </td>
                    <td>{kN(b.peakTotal)}</td>
                    <td>{kN(b.rms)}</td>
                    <td>{fixed(b.Dlambda, 3)}</td>
                    <td>{fixed(b.KC, 2)}</td>
                    <td>{b.mfApplied ? 'yes' : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : (
        <p className="muted" id="res-none">No load results: {summary.issues.some((i) => i.severity === 'error') ? 'resolve the errors below.' : 'nothing to analyse.'}</p>
      )}
      {summary.issues.length ? (
        <ul className="issues" aria-live="polite">
          {summary.issues.map((i, n) => (
            <li key={n} className={`issue issue-${i.severity}`} data-code={i.code}>
              {i.objectId ? <button type="button" className="link" onClick={() => onSelectObject(i.objectId!)}>{i.message}</button> : i.message}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="small muted">
        Engine {summary.engineVersion}, the same verified engine as the <a href="../../index.html">load calculator</a>:
        fixed bodies, regular unidirectional waves in +x, no hydrodynamic interaction. Bodies are numbered in scene order.
        Heave is a screening estimate, not a motion analysis.
      </p>
    </div>
  );
}

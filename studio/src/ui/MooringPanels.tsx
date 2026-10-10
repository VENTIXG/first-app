// Mooring Studio panels: design (layout generator and item list), inspector
// for the selected line/anchor/fairlead/line type, and results (load case,
// criteria, equilibrium, safety cases, stiffness, tension-offset chart).

import { useState } from 'react';
import { DEFAULT_SPREAD, type SpreadParams } from '../core/mooringCommands.ts';
import { MATERIALS, type LineType } from '../core/mooring/library.ts';
import type { MooringProject } from '../core/mooring/schema.ts';
import type { MooringSummary } from '../core/mooring/run.ts';
import type { SafetyCriteria } from '../core/mooring/safety.ts';
import type { Anchor, Fairlead, MooringLine } from '../core/mooring/system.ts';
import type { MooringOutcome } from '../workers/analysis.worker.ts';
import { NumberField } from './NumberField.tsx';
import { fixed } from './format.ts';

const kN = (n: number) => `${fixed(n / 1000, 0)} kN`;
const MATERIAL_NAMES: Record<string, string> = {
  chain: 'Studless chain', chain_studlink: 'Studlink chain', wire: 'Wire rope', polyester: 'Polyester', nylon: 'Nylon', hmpe: 'HMPE',
};

// ------------------------------------------------------------------ design panel

interface DesignProps {
  mooring: MooringProject | undefined;
  result: MooringSummary | null;
  depth: number;
  selected: string | null;
  onSelect(itemId: string): void;
  onGenerate(p: SpreadParams): void;
  onAddLine(headingDeg: number): void;
  onRemove(): void;
  onLoadExample(): void;
  onInvalid(message: string): void;
}

export function MooringDesignPanel({ mooring, result, depth, selected, onSelect, onGenerate, onAddLine, onRemove, onLoadExample, onInvalid }: DesignProps) {
  const [p, setP] = useState<SpreadParams>({ ...DEFAULT_SPREAD, fairleadZ: Math.max(DEFAULT_SPREAD.fairleadZ, -depth + 1) });
  const [heading, setHeading] = useState(0);
  const set = (patch: Partial<SpreadParams>) => setP((v) => ({ ...v, ...patch }));
  const byId = new Map(result?.lines.map((l) => [l.id, l]) ?? []);
  return (
    <div className="mooring-design">
      <h3 className="sub">Spread layout</h3>
      <div className="grid2">
        <NumberField id="sp-count" label="Lines" value={p.count} onInvalid={onInvalid} onCommit={(v) => set({ count: v })} />
        <NumberField id="sp-heading" label="First line" unit="deg" value={p.headingDeg} onInvalid={onInvalid} onCommit={(v) => set({ headingDeg: v })} />
        <NumberField id="sp-ra" label="Anchor radius" unit="m" value={p.anchorRadius} onInvalid={onInvalid} onCommit={(v) => set({ anchorRadius: v })} />
        <NumberField id="sp-rf" label="Fairlead radius" unit="m" value={p.fairleadRadius} onInvalid={onInvalid} onCommit={(v) => set({ fairleadRadius: v })} />
        <NumberField id="sp-zf" label="Fairlead z" unit="m" value={p.fairleadZ} onInvalid={onInvalid} onCommit={(v) => set({ fairleadZ: v })} />
        <NumberField id="sp-t" label="Pretension" unit="kN" value={p.pretension / 1000} onInvalid={onInvalid} onCommit={(v) => set({ pretension: v * 1000 })} />
        <div className="field">
          <label htmlFor="sp-material">Material</label>
          <select id="sp-material" value={p.material} onChange={(e) => set({ material: e.target.value })}>
            {Object.keys(MATERIALS).map((k) => <option key={k} value={k}>{MATERIAL_NAMES[k] ?? k}</option>)}
          </select>
        </div>
        <NumberField id="sp-d" label="Nominal dia." unit="mm" value={Number((p.diameter * 1000).toFixed(3))} onInvalid={onInvalid} onCommit={(v) => set({ diameter: v / 1000 })} />
      </div>
      <p className="derived">Anchors on the seabed (z = −{depth} m). Line lengths are solved for the pretension at the neutral position.</p>
      <div className="row">
        <button type="button" id="mooring-generate" onClick={() => onGenerate(p)}>{mooring?.system.lines.length ? 'Replace with spread' : 'Generate spread'}</button>
        {!mooring ? <button type="button" id="mooring-example" onClick={onLoadExample}>Open example project</button> : null}
      </div>

      {mooring ? (
        <>
          <h3 className="sub">Lines</h3>
          {mooring.system.lines.length === 0 ? <p className="muted">No lines.</p> : (
            <ul className="outliner mooring-items">
              {mooring.system.lines.map((l) => {
                const r = byId.get(l.id);
                return (
                  <li key={l.id} className={selected === `mooring:${l.id}` ? 'selected' : ''}>
                    <button type="button" className="outliner-name" onClick={() => onSelect(l.id)}>
                      <span className="kind kind-line" />
                      <span className="name">{l.name}</span>
                      <span className="meta">
                        {fixed(l.length, 1)} m · {l.failed ? 'failed' : r ? `${kN(r.TF)} · SF ${fixed(r.safetyFactor, 2)}` : '—'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <h3 className="sub">Anchors and fairleads</h3>
          <ul className="outliner mooring-items">
            {mooring.system.anchors.map((a) => (
              <li key={a.id} className={selected === `mooring:${a.id}` ? 'selected' : ''}>
                <button type="button" className="outliner-name" onClick={() => onSelect(a.id)}>
                  <span className="kind kind-anchor" /><span className="name">{a.name}</span>
                  <span className="meta">{a.type} · ({fixed(a.x, 1)}, {fixed(a.y, 1)}, {fixed(a.z, 1)}) m</span>
                </button>
              </li>
            ))}
            {mooring.system.fairleads.map((f) => (
              <li key={f.id} className={selected === `mooring:${f.id}` ? 'selected' : ''}>
                <button type="button" className="outliner-name" onClick={() => onSelect(f.id)}>
                  <span className="kind kind-sphere" /><span className="name">{f.name}</span>
                  <span className="meta">body frame ({fixed(f.x, 1)}, {fixed(f.y, 1)}, {fixed(f.z, 1)}) m</span>
                </button>
              </li>
            ))}
          </ul>
          <h3 className="sub">Line types</h3>
          <ul className="outliner mooring-items">
            {mooring.system.lineTypes.map((t) => (
              <li key={t.id} className={selected === `mooring:type:${t.id}` ? 'selected' : ''}>
                <button type="button" className="outliner-name" onClick={() => onSelect(`type:${t.id}`)}>
                  <span className="kind" /><span className="name">{t.name}</span>
                  <span className="meta">MBL {kN(t.MBL)} · w {fixed(t.w, 0)} N/m</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="row">
            <NumberField id="add-heading" label="New line heading" unit="deg" value={heading} onInvalid={onInvalid} onCommit={setHeading} />
          </div>
          <div className="row">
            <button type="button" id="mooring-add-line" disabled={mooring.system.lines.length === 0} onClick={() => onAddLine(heading)}>+ Line</button>
            <button type="button" className="danger" id="mooring-remove" onClick={onRemove}>Remove mooring</button>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ inspector

interface InspectorProps {
  mooring: MooringProject;
  itemId: string;
  onLine(id: string, label: string, patch: Partial<MooringLine>): void;
  onAnchor(id: string, label: string, patch: Partial<Anchor>): void;
  onFairlead(id: string, label: string, patch: Partial<Fairlead>): void;
  onLineType(id: string, label: string, patch: Partial<LineType>): void;
  onRemoveLine(id: string): void;
  onInvalid(message: string): void;
}

export function MooringInspector({ mooring, itemId, onLine, onAnchor, onFairlead, onLineType, onRemoveLine, onInvalid }: InspectorProps) {
  const s = mooring.system;
  const line = s.lines.find((l) => l.id === itemId);
  if (line) {
    return (
      <div className="inspector" data-item={line.id}>
        <p><strong>{line.name}</strong> <span className="muted small">{s.anchors.find((a) => a.id === line.anchorId)?.name} → {s.fairleads.find((f) => f.id === line.fairleadId)?.name}</span></p>
        <NumberField id="ml-length" label="Unstretched length" unit="m" value={line.length} onInvalid={onInvalid} onCommit={(v) => onLine(line.id, `Set ${line.name} length`, { length: v })} />
        <div className="field">
          <label htmlFor="ml-type">Line type</label>
          <select id="ml-type" value={line.lineTypeId} onChange={(e) => onLine(line.id, `Change ${line.name} type`, { lineTypeId: e.target.value })}>
            {s.lineTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <label className="check">
          <input type="checkbox" id="ml-failed" checked={line.failed === true} onChange={(e) => onLine(line.id, e.target.checked ? `Fail ${line.name}` : `Restore ${line.name}`, { failed: e.target.checked })} />
          Treat as failed (removed from the intact analysis)
        </label>
        <div className="row"><button type="button" className="danger" id="ml-delete" onClick={() => onRemoveLine(line.id)}>Delete line</button></div>
      </div>
    );
  }
  const anchor = s.anchors.find((a) => a.id === itemId);
  if (anchor) {
    return (
      <div className="inspector" data-item={anchor.id}>
        <p><strong>{anchor.name}</strong> <span className="muted small">global coordinates</span></p>
        <div className="grid3">
          {(['x', 'y', 'z'] as const).map((k) => (
            <NumberField key={k} id={`ma-${k}`} label={k} unit="m" value={anchor[k]} onInvalid={onInvalid} onCommit={(v) => onAnchor(anchor.id, `Move ${anchor.name}`, { [k]: v })} />
          ))}
        </div>
        <div className="field">
          <label htmlFor="ma-type">Anchor type</label>
          <select id="ma-type" value={anchor.type} onChange={(e) => onAnchor(anchor.id, `Change ${anchor.name} type`, { type: e.target.value as Anchor['type'] })}>
            {['drag', 'suction', 'driven', 'gravity', 'plate'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <p className="derived">Drag anchors are checked for uplift. Anchor holding capacity is not computed.</p>
      </div>
    );
  }
  const fairlead = s.fairleads.find((f) => f.id === itemId);
  if (fairlead) {
    return (
      <div className="inspector" data-item={fairlead.id}>
        <p><strong>{fairlead.name}</strong> <span className="muted small">platform (body) coordinates</span></p>
        <div className="grid3">
          {(['x', 'y', 'z'] as const).map((k) => (
            <NumberField key={k} id={`mf-${k}`} label={k} unit="m" value={fairlead[k]} onInvalid={onInvalid} onCommit={(v) => onFairlead(fairlead.id, `Move ${fairlead.name}`, { [k]: v })} />
          ))}
        </div>
      </div>
    );
  }
  const type = itemId.startsWith('type:') ? s.lineTypes.find((t) => `type:${t.id}` === itemId) : undefined;
  if (type) {
    return (
      <div className="inspector" data-item={type.id}>
        <p><strong>{type.name}</strong></p>
        <div className="grid2">
          <NumberField id="mt-mbl" label="MBL" unit="kN" value={Number((type.MBL / 1000).toFixed(3))} onInvalid={onInvalid} onCommit={(v) => onLineType(type.id, 'Set MBL', { MBL: v * 1000 })} />
          <NumberField id="mt-ea" label="EA" unit="MN" value={Number((type.EA / 1e6).toFixed(3))} onInvalid={onInvalid} onCommit={(v) => onLineType(type.id, 'Set EA', { EA: v * 1e6 })} />
          <NumberField id="mt-w" label="Submerged weight" unit="N/m" value={Number(type.w.toFixed(3))} onInvalid={onInvalid} onCommit={(v) => onLineType(type.id, 'Set submerged weight', { w: v })} />
          <NumberField id="mt-mass" label="Mass" unit="kg/m" value={Number(type.mass.toFixed(3))} onInvalid={onInvalid} onCommit={(v) => onLineType(type.id, 'Set mass', { mass: v })} />
        </div>
        <dl className="source">
          <dt>Nominal diameter</dt><dd>{fixed(type.d * 1000, 1)} mm</dd>
          <dt>Source</dt><dd id="mt-source">{type.source}</dd>
        </dl>
        <p className="derived">Replace the estimates with the manufacturer's certified values for design work.</p>
      </div>
    );
  }
  return <p className="muted">Select a line, anchor, fairlead or line type.</p>;
}

// ------------------------------------------------------------------ results

interface ResultsProps {
  mooring: MooringProject;
  outcome: MooringOutcome | null;
  running: boolean;
  meanLoad: { Fx: number; Mz: number } | null;
  onExternal(external: [number, number, number], label: string): void;
  onCriteria(patch: Partial<Omit<SafetyCriteria, 'maxOffset'>> & { maxOffset?: number | null }): void;
  onSelect(itemId: string): void;
  onInvalid(message: string): void;
}

export function MooringResults({ mooring, outcome, running, meanLoad, onExternal, onCriteria, onSelect, onInvalid }: ResultsProps) {
  const [fx, fy, mz] = mooring.external;
  const c = mooring.criteria;
  const r = outcome?.ok ? outcome.summary : null;
  return (
    <div className="results mooring-results" aria-busy={running}>
      <h3 className="sub">Steady load on the platform</h3>
      <div className="grid3">
        <NumberField id="mx-fx" label="Fx" unit="kN" value={Number((fx / 1000).toFixed(3))} onInvalid={onInvalid} onCommit={(v) => onExternal([v * 1000, fy, mz], 'Set mooring load Fx')} />
        <NumberField id="mx-fy" label="Fy" unit="kN" value={Number((fy / 1000).toFixed(3))} onInvalid={onInvalid} onCommit={(v) => onExternal([fx, v * 1000, mz], 'Set mooring load Fy')} />
        <NumberField id="mx-mz" label="Mz" unit="kN·m" value={Number((mz / 1000).toFixed(3))} onInvalid={onInvalid} onCommit={(v) => onExternal([fx, fy, v * 1000], 'Set mooring load Mz')} />
      </div>
      <div className="row">
        <button
          type="button" id="mx-use-mean" disabled={!meanLoad}
          title={meanLoad ? 'Period-mean Morison (current/drag) and wind load of the analysed bodies' : 'No load analysis result'}
          onClick={() => meanLoad && onExternal([Number(meanLoad.Fx.toFixed(1)), 0, Number(meanLoad.Mz.toFixed(1))], 'Use mean environmental load')}
        >
          Use mean environmental load{meanLoad ? ` (${kN(meanLoad.Fx)})` : ''}
        </button>
      </div>
      <p className="derived">The mean load excludes second-order wave drift, which is not computed; add it here if known.</p>

      <h3 className="sub">Criteria</h3>
      <div className="grid3">
        <NumberField id="mc-intact" label="Intact SF" value={c.intactSF} onInvalid={onInvalid} onCommit={(v) => onCriteria({ intactSF: v })} />
        <NumberField id="mc-damaged" label="Damaged SF" value={c.damagedSF} onInvalid={onInvalid} onCommit={(v) => onCriteria({ damagedSF: v })} />
        <NumberField id="mc-offset" label="Max offset" unit="m" value={c.maxOffset ?? 0} onInvalid={onInvalid} onCommit={(v) => onCriteria({ maxOffset: v > 0 ? v : null })} />
      </div>
      <p className="derived">{c.source}. Max offset 0 = not checked.</p>

      <h3 className="sub">Results {running ? <span className="spinner" aria-label="computing" /> : null}</h3>
      {outcome && !outcome.ok ? <p className="issue issue-error" role="alert">Mooring analysis failed: {outcome.message}</p> : null}
      {r ? (
        <>
          <p id="mooring-status" className={`status ${r.ok && r.cases.every((x) => x.pass) ? 'status-pass' : 'status-fail'}`}>{r.status}</p>
          {r.ok && r.pose ? (
            <>
              <dl className="tiles">
                <div><dt>Offset (intact)</dt><dd id="mooring-offset">{fixed(r.offset, 2)} m</dd></div>
                <div><dt>Yaw</dt><dd>{fixed((r.pose[5] * 180) / Math.PI, 2)}°</dd></div>
                <div><dt>Max tension</dt><dd id="mooring-tmax">{kN(Math.max(...r.lines.map((l) => Math.max(l.TF, l.TA)), 0))}</dd></div>
                <div><dt>Min safety factor</dt><dd id="mooring-minsf">{fixed(Math.min(...r.lines.map((l) => l.safetyFactor)), 2)}</dd></div>
                <div><dt>Surge stiffness K₁₁</dt><dd>{r.stiffness ? `${fixed(r.stiffness[0][0] / 1000, 1)} kN/m` : '—'}</dd></div>
                <div><dt>Yaw stiffness K₆₆</dt><dd>{r.stiffness ? `${fixed(r.stiffness[5][5] / 1e6, 1)} MN·m/rad` : '—'}</dd></div>
              </dl>
              <table className="bodies" id="mooring-lines">
                <thead><tr><th>Line</th><th>T fairlead</th><th>T anchor</th><th>Angle</th><th>On seabed</th><th>SF</th></tr></thead>
                <tbody>
                  {r.lines.map((l) => (
                    <tr key={l.id}>
                      <td><button type="button" className="link" onClick={() => onSelect(l.id)}>{l.name}</button></td>
                      <td>{kN(l.TF)}</td><td>{kN(l.TA)}</td><td>{fixed(l.fairleadAngleDeg, 1)}°</td>
                      <td>{fixed(l.grounded, 0)} m</td><td>{fixed(l.safetyFactor, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3 className="sub">Safety cases</h3>
              <table className="bodies" id="mooring-cases">
                <thead><tr><th>Case</th><th>Offset</th><th>Min SF</th><th>Req.</th><th>Result</th></tr></thead>
                <tbody>
                  {r.cases.map((k) => (
                    <tr key={k.id} data-pass={k.pass} title={k.messages.join(' ')}>
                      <td>{k.label}</td>
                      <td>{k.ok ? `${fixed(k.offset, 1)} m` : '—'}</td>
                      <td>{k.ok ? fixed(k.minSF, 2) : '—'}</td>
                      <td>{fixed(k.criterion, 2)}</td>
                      <td className={k.pass ? 'pass' : 'fail'}>{k.pass ? 'pass' : 'fail'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {r.sweep ? <TensionChart sweep={r.sweep} names={new Map(r.lines.map((l) => [l.id, l.name]))} equilibrium={r.pose[0] * r.sweep.direction[0] + r.pose[1] * r.sweep.direction[1]} limit={Math.min(...r.lines.map((l) => l.MBL)) / c.intactSF} /> : null}
            </>
          ) : null}
          {r.issues.length ? (
            <ul className="issues" aria-live="polite">
              {r.issues.map((i, n) => (
                <li key={n} className={`issue issue-${i.severity}`} data-code={i.code}>{i.message}</li>
              ))}
            </ul>
          ) : null}
          <p className="small muted">{r.method} Single-segment lines; no clump weights, buoys, seabed friction, line dynamics (MoorDyn) or fatigue yet. Solver compared against MoorPy 1.3.0 in the test suite.</p>
        </>
      ) : !outcome ? <p className="muted">{running ? 'Computing…' : 'No mooring result yet.'}</p> : null}
    </div>
  );
}

const PALETTE = ['#4b9be0', '#e8743b', '#6fcf97', '#f2c94c', '#bb6bd9', '#56ccf2', '#eb5757', '#9fb3c8'];

function TensionChart({ sweep, names, equilibrium, limit }: {
  sweep: NonNullable<MooringSummary['sweep']>; names: Map<string, string>; equilibrium: number; limit: number;
}) {
  const W = 320, H = 190, L = 44, R = 8, T = 10, B = 30;
  const xs = sweep.offsets;
  const series = Object.entries(sweep.tensions).filter(([, v]) => v.length === xs.length);
  const all = series.flatMap(([, v]) => v);
  if (!xs.length || !all.length) return null;
  const x0 = xs[0], x1 = xs[xs.length - 1];
  const y1 = Math.max(...all, Number.isFinite(limit) ? Math.min(limit, 1.5 * Math.max(...all)) : 0) * 1.08;
  const px = (x: number) => L + ((x - x0) / (x1 - x0 || 1)) * (W - L - R);
  const py = (y: number) => T + (1 - y / (y1 || 1)) * (H - T - B);
  const ticks = (a: number, b: number, n: number) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  const dirDeg = (Math.atan2(sweep.direction[1], sweep.direction[0]) * 180) / Math.PI;
  return (
    <figure className="chart" id="mooring-chart">
      <figcaption className="small muted">Fairlead/anchor tension vs. offset along {fixed(dirDeg, 0)}° (other DOF held at equilibrium)</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Line tension against platform offset">
        {ticks(0, y1, 4).map((y) => (
          <g key={`y${y}`}>
            <line x1={L} x2={W - R} y1={py(y)} y2={py(y)} className="grid" />
            <text x={L - 4} y={py(y) + 3} textAnchor="end">{(y / 1000).toFixed(0)}</text>
          </g>
        ))}
        {ticks(x0, x1, 4).map((x) => <text key={`x${x}`} x={px(x)} y={H - B + 14} textAnchor="middle">{x.toFixed(0)}</text>)}
        <text x={(L + W - R) / 2} y={H - 3} textAnchor="middle">offset [m]</text>
        <text x={10} y={T + 8} textAnchor="start">kN</text>
        {limit < y1 ? <line x1={L} x2={W - R} y1={py(limit)} y2={py(limit)} className="limit"><title>MBL / intact SF</title></line> : null}
        <line x1={px(equilibrium)} x2={px(equilibrium)} y1={T} y2={H - B} className="eq"><title>equilibrium</title></line>
        {series.map(([id, v], i) => (
          <polyline key={id} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="1.6"
            points={v.map((y, k) => `${px(xs[k]).toFixed(1)},${py(y).toFixed(1)}`).join(' ')}>
            <title>{names.get(id) ?? id}</title>
          </polyline>
        ))}
      </svg>
      <ul className="legend">
        {series.map(([id], i) => <li key={id}><span style={{ background: PALETTE[i % PALETTE.length] }} />{names.get(id) ?? id}</li>)}
        <li><span className="limit-key" />MBL / intact SF</li>
      </ul>
    </figure>
  );
}

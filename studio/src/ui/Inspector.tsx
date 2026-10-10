import { NumberField } from './NumberField.tsx';
import type { Issue, Project, SceneObject } from '../core/types.ts';

interface Props {
  object: SceneObject | null;
  project: Project;
  issues: Issue[];
  onShape(id: string, label: string, patch: Record<string, number>): void;
  onRename(id: string, name: string): void;
  onAnalysis(id: string, include: boolean): void;
  onVisible(id: string, visible: boolean): void;
  onDuplicate(id: string): void;
  onDelete(id: string): void;
  onInvalid(message: string): void;
}

export function Inspector({ object: o, project, issues, onShape, onRename, onAnalysis, onVisible, onDuplicate, onDelete, onInvalid }: Props) {
  if (!o) return <p className="muted">Select an object in the scene or the list to edit it.</p>;
  const s = o.shape;
  const field = (key: string, label: string, value: number, unit = 'm') => (
    <NumberField
      key={`${o.id}-${key}`}
      id={`insp-${key}`}
      label={label}
      unit={unit}
      value={value}
      onInvalid={onInvalid}
      onCommit={(v) => onShape(o.id, `Edit ${label} of ${o.name}`, { [key]: v })}
    />
  );
  const own = issues.filter((i) => i.objectId === o.id);
  const meshInfo = s.kind === 'mesh' ? project.meshes[s.meshId] : null;

  return (
    <div className="inspector" data-object-id={o.id}>
      <div className="field">
        <label htmlFor="insp-name">Name</label>
        <input
          id="insp-name"
          key={`${o.id}-name-${o.name}`}
          type="text"
          defaultValue={o.name}
          maxLength={200}
          onBlur={(e) => { if (e.target.value !== o.name) onRename(o.id, e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
      </div>

      {s.kind === 'cylinder' ? (
        <>
          <div className="grid2">
            {field('x', 'x', s.x)}
            {field('y', 'y', s.y)}
          </div>
          {field('diameter', 'Diameter', s.diameter)}
          <div className="grid2">
            {field('zBottom', 'Bottom z', s.zBottom)}
            {field('zTop', 'Top z', s.zTop)}
          </div>
          <p className="derived">Draft {Number((-s.zBottom).toPrecision(10))} m · freeboard {Number(s.zTop.toPrecision(10))} m (z = 0 is the still-water level)</p>
        </>
      ) : null}
      {s.kind === 'sphere' ? (
        <>
          <div className="grid2">
            {field('x', 'x', s.x)}
            {field('y', 'y', s.y)}
          </div>
          <div className="grid2">
            {field('zCenter', 'Centre z', s.zCenter)}
            {field('radius', 'Radius', s.radius)}
          </div>
          <p className="derived">Draft {Number((s.radius - s.zCenter).toPrecision(10))} m</p>
        </>
      ) : null}
      {s.kind === 'mesh' ? (
        <>
          <div className="grid2">
            {field('dx', 'Offset x', s.dx)}
            {field('dy', 'Offset y', s.dy)}
          </div>
          {field('dz', 'Offset z', s.dz)}
          <p className="derived">{meshInfo ? `${(meshInfo.indices.length / 3).toLocaleString('en-US')} triangles` : 'mesh data missing'}</p>
        </>
      ) : null}

      <label className="check">
        <input type="checkbox" checked={o.visible} onChange={(e) => onVisible(o.id, e.target.checked)} />
        Visible
      </label>
      <label className="check" title={s.kind === 'mesh' ? 'Only cylinders and spheres can be analysed' : undefined}>
        <input
          id="insp-analysis"
          type="checkbox"
          checked={o.analysis}
          disabled={s.kind === 'mesh'}
          onChange={(e) => onAnalysis(o.id, e.target.checked)}
        />
        Include in load analysis
      </label>
      {s.kind === 'mesh' ? <p className="muted small">Display only: the load engine handles vertical cylinders and spheres.</p> : null}

      {o.source.kind === 'rhino' ? (
        <dl className="source">
          <dt>Source</dt><dd>{o.source.file}</dd>
          <dt>Layer</dt><dd>{o.source.layer || '(default)'}</dd>
          <dt>Rhino type</dt><dd>{o.source.rhinoType}</dd>
          <dt>Import</dt><dd>{o.source.note}</dd>
        </dl>
      ) : null}

      {own.length ? (
        <ul className="issues">
          {own.map((i, n) => <li key={n} className={`issue issue-${i.severity}`} data-code={i.code}>{i.message}</li>)}
        </ul>
      ) : null}

      <div className="row">
        <button type="button" onClick={() => onDuplicate(o.id)}>Duplicate</button>
        <button type="button" className="danger" onClick={() => onDelete(o.id)}>Delete</button>
      </div>
    </div>
  );
}

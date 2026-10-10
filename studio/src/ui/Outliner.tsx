import type { Issue, SceneObject } from '../core/types.ts';

interface Props {
  objects: SceneObject[];
  selected: string | null;
  issues: Issue[];
  onSelect(id: string): void;
  onToggleVisible(id: string, visible: boolean): void;
}

const KIND_LABEL = { cylinder: 'Cylinder', sphere: 'Sphere', mesh: 'Mesh' } as const;

export function Outliner({ objects, selected, issues, onSelect, onToggleVisible }: Props) {
  if (objects.length === 0) {
    return <p className="muted">The scene is empty. Add a cylinder or sphere, or import a Rhino file.</p>;
  }
  return (
    <ul className="outliner" aria-label="Scene objects">
      {objects.map((o) => {
        const worst = issues.filter((i) => i.objectId === o.id).reduce<'error' | 'warning' | null>(
          (w, i) => (i.severity === 'error' ? 'error' : i.severity === 'warning' && w !== 'error' ? 'warning' : w), null);
        return (
          <li key={o.id} className={o.id === selected ? 'selected' : undefined} data-object-id={o.id}>
            <button type="button" className="outliner-name" onClick={() => onSelect(o.id)} aria-pressed={o.id === selected}>
              <span className={`kind kind-${o.shape.kind}`} aria-hidden="true" />
              <span className="name">{o.name || '(unnamed)'}</span>
              <span className="meta">
                {KIND_LABEL[o.shape.kind]}
                {o.source.kind === 'rhino' && o.source.layer ? ` · ${o.source.layer}` : ''}
              </span>
            </button>
            <span className="badges">
              {o.analysis ? <span className="badge badge-analysis" title="Included in the analysis">analysed</span> : null}
              {worst ? <span className={`badge badge-${worst}`} title={`${worst} reported for this object`}>{worst}</span> : null}
              <button
                type="button"
                className={`eye ${o.visible ? '' : 'off'}`}
                aria-pressed={o.visible}
                aria-label={`${o.visible ? 'Hide' : 'Show'} ${o.name}`}
                title={o.visible ? 'Hide' : 'Show'}
                onClick={() => onToggleVisible(o.id, !o.visible)}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z" fill="none" stroke="currentColor" strokeWidth="1.8" />
                  {o.visible
                    ? <circle cx="12" cy="12" r="3" fill="currentColor" />
                    : <path d="M4 20 20 4" stroke="currentColor" strokeWidth="1.8" />}
                </svg>
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

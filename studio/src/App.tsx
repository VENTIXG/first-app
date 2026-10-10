import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addObjects, CommandError, duplicateObject, moveObject, removeObjects, renameObject, setAnalysis, setEnvironment,
  setVisible, updateShape,
} from './core/commands.ts';
import { commit, createHistory, redo, redoLabel, undo, undoLabel, type History } from './core/history.ts';
import { newId } from './core/ids.ts';
import { createDefaultProject, parseProject, ProjectError, serializeProject } from './core/project.ts';
import { createExampleProject } from './core/example.ts';
import {
  addLine, generateSpread, removeLine, removeMooring, setCriteria, setMooringLoad, updateAnchor, updateFairlead, updateLine, updateLineType,
} from './core/mooringCommands.ts';
import type { AnalysisSummary } from './core/analysis.ts';
import type { RhinoImportResult } from './core/rhinoImport.ts';
import type { Environment, Project, SceneObject } from './core/types.ts';
import type { AnalysisReply, AnalysisRequest, MooringOutcome } from './workers/analysis.worker.ts';
import type { CadReply, CadRequest } from './workers/cad.worker.ts';
import { Viewport } from './viewport/Viewport.ts';
import { EnvironmentPanel } from './ui/EnvironmentPanel.tsx';
import { ImportPanel } from './ui/ImportPanel.tsx';
import { Inspector } from './ui/Inspector.tsx';
import { Outliner } from './ui/Outliner.tsx';
import { ResultsPanel } from './ui/ResultsPanel.tsx';
import { MooringDesignPanel, MooringInspector, MooringResults } from './ui/MooringPanels.tsx';

const MAX_IMPORT_BYTES = 200 * 1024 * 1024;
const MAX_PROJECT_BYTES = 200 * 1024 * 1024;

type Notice = { kind: 'info' | 'error'; text: string } | null;
type Workspace = 'geometry' | 'mooring';
const MOORING_PREFIX = 'mooring:';

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeFileName = (name: string) => (name.replace(/[^A-Za-z0-9._ -]+/g, '_').trim() || 'project').slice(0, 80);

export function App() {
  const [history, setHistory] = useState<History>(() => createHistory(createDefaultProject()));
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [summary, setSummary] = useState<AnalysisSummary | null>(null);
  const [analysisFailure, setAnalysisFailure] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importReport, setImportReport] = useState<RhinoImportResult | null>(null);
  const [needsUnits, setNeedsUnits] = useState<{ message: string; file: File } | null>(null);
  const [workspace, setWorkspace] = useState<Workspace>('geometry');
  const [mooringOutcome, setMooringOutcome] = useState<MooringOutcome | null>(null);

  const historyRef = useRef(history);
  historyRef.current = history;
  const [saved, setSaved] = useState<Project>(history.present);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const viewportHost = useRef<HTMLDivElement>(null);
  const viewport = useRef<Viewport | null>(null);
  const project = history.present;

  const notify = useCallback((kind: 'info' | 'error', text: string) => setNotice({ kind, text }), []);

  /** Apply a command to the current project and record it; command errors are shown, never committed. */
  const apply = useCallback((label: string, edit: (p: Project) => Project) => {
    const h = historyRef.current;
    try {
      const next = edit(h.present);
      const updated = commit(h, label, next);
      historyRef.current = updated;
      setHistory(updated);
      return true;
    } catch (err) {
      if (err instanceof CommandError) {
        notify('error', err.message);
        return false;
      }
      throw err;
    }
  }, [notify]);

  // ---------------------------------------------------------------- viewport
  useEffect(() => {
    if (!viewportHost.current) return undefined;
    const vp = new Viewport(viewportHost.current, {
      onSelect: (id) => {
        setSelected(id);
        if (id?.startsWith(MOORING_PREFIX)) setWorkspace('mooring');
      },
      onMove: (id, x, y) => {
        const obj = historyRef.current.present.objects.find((o) => o.id === id);
        apply(`Move ${obj?.name ?? 'object'}`, (p) => moveObject(p, id, Number(x.toFixed(6)), Number(y.toFixed(6))));
      },
    });
    viewport.current = vp;
    return () => {
      vp.dispose();
      viewport.current = null;
    };
  }, [apply]);

  useEffect(() => {
    viewport.current?.update(project, selected);
  }, [project, selected]);

  const mooringSummary = mooringOutcome?.ok ? mooringOutcome.summary : null;
  useEffect(() => {
    viewport.current?.updateMooring(project, mooringSummary, selected);
  }, [project, mooringSummary, selected]);

  useEffect(() => {
    if (!selected) return;
    if (selected.startsWith(MOORING_PREFIX)) {
      const item = selected.slice(MOORING_PREFIX.length);
      const s = project.mooring?.system;
      const exists = s && (s.lines.some((l) => l.id === item) || s.anchors.some((a) => a.id === item)
        || s.fairleads.some((f) => f.id === item) || s.lineTypes.some((t) => `type:${t.id}` === item));
      if (!exists) setSelected(null);
    } else if (!project.objects.some((o) => o.id === selected)) setSelected(null);
  }, [project, selected]);

  // ---------------------------------------------------------------- analysis (worker, latest request wins)
  const worker = useRef<Worker | null>(null);
  const requestId = useRef(0);
  useEffect(() => {
    const w = new Worker(new URL('./workers/analysis.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<AnalysisReply>) => {
      if (e.data.id !== requestId.current) return;
      setRunning(false);
      setMooringOutcome(e.data.mooring);
      if (e.data.ok) {
        setSummary(e.data.summary);
        setAnalysisFailure(null);
      } else {
        setSummary(null);
        setAnalysisFailure(e.data.message);
      }
    };
    w.onerror = (e) => {
      setRunning(false);
      setAnalysisFailure(e.message || 'the analysis worker stopped');
    };
    worker.current = w;
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, []);

  useEffect(() => {
    const id = ++requestId.current;
    setRunning(true);
    const t = setTimeout(() => worker.current?.postMessage({ id, project } satisfies AnalysisRequest), 120);
    return () => clearTimeout(t);
  }, [project]);

  // ---------------------------------------------------------------- import
  const runImport = useCallback(async (file: File, options: { swlElevation: number; assumeUnits?: string }) => {
    if (file.size > MAX_IMPORT_BYTES) {
      notify('error', `${file.name} is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`);
      return;
    }
    setImportBusy(true);
    setNeedsUnits(null);
    const w = new Worker(new URL('./workers/cad.worker.ts', import.meta.url), { type: 'module' });
    try {
      const bytes = await file.arrayBuffer();
      const existingMeshVertices = Object.values(historyRef.current.present.meshes)
        .reduce((n, m) => n + m.positions.length / 3, 0);
      const reply = await new Promise<CadReply>((resolve) => {
        w.onmessage = (e: MessageEvent<CadReply>) => resolve(e.data);
        w.onerror = (e) => resolve({ ok: false, message: e.message || 'the import worker stopped' });
        w.postMessage({ bytes, fileName: file.name, options: { ...options, existingMeshVertices } } satisfies CadRequest, [bytes]);
      });
      if (!reply.ok) {
        notify('error', `Import failed: ${reply.message}`);
        return;
      }
      const r = reply.result;
      if (!r.ok) {
        if (r.error?.code === 'UNITS_UNKNOWN') setNeedsUnits({ message: r.error.message, file });
        else notify('error', r.error?.message ?? 'Import failed.');
        return;
      }
      setImportReport(r);
      if (r.objects.length === 0) {
        notify('info', `${file.name}: nothing could be imported (see the import report).`);
        return;
      }
      if (apply(`Import ${file.name}`, (p) => addObjects(p, r.objects, r.meshes))) {
        notify('info', `Imported ${r.objects.length} object(s) from ${file.name}; ${r.skipped.length} skipped.`);
        requestAnimationFrame(() => viewport.current?.frameAll());
      }
    } catch (err) {
      notify('error', `Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      w.terminate();
      setImportBusy(false);
    }
  }, [apply, notify]);

  // ---------------------------------------------------------------- project files
  const projectInput = useRef<HTMLInputElement>(null);
  const dirty = project !== saved;

  const openProject = async (file: File) => {
    if (file.size > MAX_PROJECT_BYTES) {
      notify('error', `${file.name} is larger than ${MAX_PROJECT_BYTES / 1024 / 1024} MB.`);
      return;
    }
    try {
      const p = parseProject(await file.text());
      const h = createHistory(p);
      historyRef.current = h;
      setSaved(p);
      setHistory(h);
      setSelected(null);
      setImportReport(null);
      notify('info', `Opened ${file.name}.`);
      requestAnimationFrame(() => viewport.current?.frameAll());
    } catch (err) {
      notify('error', err instanceof ProjectError ? `${file.name} could not be opened: ${err.message}` : `Could not open ${file.name}.`);
    }
  };

  const saveProject = () => {
    try {
      download(`${safeFileName(project.name)}.osproj.json`, serializeProject(project), 'application/json');
      setSaved(project);
      notify('info', 'Project saved as a download.');
    } catch (err) {
      notify('error', `Saving failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const newProject = (example = false) => {
    if (dirty && !window.confirm(`Discard the unsaved changes and ${example ? 'open the example' : 'start a new project'}?`)) return;
    const p = example ? createExampleProject() : createDefaultProject();
    const h = createHistory(p);
    historyRef.current = h;
    setSaved(p);
    setHistory(h);
    setSelected(null);
    setImportReport(null);
    requestAnimationFrame(() => viewport.current?.frameAll());
  };

  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (historyRef.current.present !== savedRef.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);

  // ---------------------------------------------------------------- object creation
  const nextX = () => {
    const xs = project.objects.map((o) => (o.shape.kind === 'mesh' ? o.shape.dx : o.shape.x));
    return xs.length ? Math.max(...xs) + 30 : 0;
  };
  const addCylinder = () => {
    const id = newId('obj');
    const n = project.objects.filter((o) => o.shape.kind === 'cylinder').length + 1;
    const obj: SceneObject = {
      id, name: `Column ${n}`, visible: true, analysis: true,
      shape: { kind: 'cylinder', x: nextX(), y: 0, diameter: 6, zBottom: -20, zTop: 15 },
      source: { kind: 'parametric' },
    };
    if (apply(`Add ${obj.name}`, (p) => addObjects(p, [obj]))) setSelected(id);
  };
  const addSphere = () => {
    const id = newId('obj');
    const n = project.objects.filter((o) => o.shape.kind === 'sphere').length + 1;
    const obj: SceneObject = {
      id, name: `Buoy ${n}`, visible: true, analysis: true,
      shape: { kind: 'sphere', x: nextX(), y: 0, zCenter: 0, radius: 5 },
      source: { kind: 'parametric' },
    };
    if (apply(`Add ${obj.name}`, (p) => addObjects(p, [obj]))) setSelected(id);
  };

  const remove = useCallback((id: string) => {
    if (id.startsWith(MOORING_PREFIX)) {
      const lineId = id.slice(MOORING_PREFIX.length);
      const line = historyRef.current.present.mooring?.system.lines.find((l) => l.id === lineId);
      if (line && apply(`Delete ${line.name}`, (p) => removeLine(p, lineId))) setSelected(null);
      return;
    }
    const obj = historyRef.current.present.objects.find((o) => o.id === id);
    if (apply(`Delete ${obj?.name ?? 'object'}`, (p) => removeObjects(p, [id]))) setSelected(null);
  }, [apply]);

  const doUndo = useCallback(() => { const h = undo(historyRef.current); historyRef.current = h; setHistory(h); }, []);
  const doRedo = useCallback(() => { const h = redo(historyRef.current); historyRef.current = h; setHistory(h); }, []);

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
      else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); doRedo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); remove(selected); }
      else if (e.key === 'f' && !mod) viewport.current?.frameAll();
      else if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doUndo, doRedo, remove, selected]);

  // ---------------------------------------------------------------- test hooks (read-only)
  useEffect(() => {
    (window as unknown as { __studio?: unknown }).__studio = {
      project: () => historyRef.current.present,
      objectScreenPoint: (id: string) => viewport.current?.objectScreenPoint(id) ?? null,
      gizmoHandlePoint: (h: 'X' | 'Y' | 'XY') => viewport.current?.gizmoHandlePoint(h) ?? null,
      mooringScreenPoint: (itemId: string) => viewport.current?.mooringScreenPoint(itemId) ?? null,
      viewportAvailable: () => viewport.current?.available ?? false,
    };
  }, []);

  const selectedObject = useMemo(() => project.objects.find((o) => o.id === selected) ?? null, [project, selected]);
  const selectedMooring = selected?.startsWith(MOORING_PREFIX) ? selected.slice(MOORING_PREFIX.length) : null;
  const selectMooring = (itemId: string) => setSelected(`${MOORING_PREFIX}${itemId}`);
  const err = (m: string) => notify('error', m);
  const issues = summary?.issues ?? [];
  const uLabel = undoLabel(history);
  const rLabel = redoLabel(history);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>VENTIX Offshore Studio</strong>
          <span className="preview" title="Phase 2–3 foundation: scene editing, Rhino import, load analysis">preview</span>
          <span className="project-name">{project.name}{dirty ? ' •' : ''}</span>
        </div>
        <nav className="actions" aria-label="Project and scene actions">
          <button type="button" onClick={() => newProject()}>New</button>
          <button type="button" id="open-example" onClick={() => newProject(true)} title="Three-column platform with a chain spread mooring">Example</button>
          <button type="button" onClick={() => projectInput.current?.click()}>Open…</button>
          <input
            ref={projectInput}
            id="project-file"
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void openProject(f); }}
          />
          <button type="button" id="save-project" onClick={saveProject}>Save</button>
          <span className="sep" />
          <button type="button" id="add-cylinder" onClick={() => { addCylinder(); setWorkspace('geometry'); }}>+ Cylinder</button>
          <button type="button" id="add-sphere" onClick={() => { addSphere(); setWorkspace('geometry'); }}>+ Sphere</button>
          <span className="sep" />
          <button type="button" id="undo" onClick={doUndo} disabled={!uLabel} title={uLabel ? `Undo ${uLabel} (Ctrl+Z)` : 'Nothing to undo'}>Undo</button>
          <button type="button" id="redo" onClick={doRedo} disabled={!rLabel} title={rLabel ? `Redo ${rLabel} (Ctrl+Shift+Z)` : 'Nothing to redo'}>Redo</button>
          <button type="button" onClick={() => viewport.current?.frameAll()} title="Frame all (F)">Frame</button>
          <span className="sep" />
          <a className="navlink" href="../../home.html">Home</a>
          <a className="navlink" href="../../index.html">Load calculator</a>
          <a className="navlink" href="../../standalone.html">Array study</a>
        </nav>
      </header>

      <main className="main">
        <aside className="panel left" aria-label={workspace === 'geometry' ? 'Scene' : 'Mooring design'}>
          <div className="workspaces" role="tablist" aria-label="Workspace">
            <button type="button" role="tab" id="ws-geometry" aria-selected={workspace === 'geometry'} onClick={() => setWorkspace('geometry')}>Geometry &amp; loads</button>
            <button type="button" role="tab" id="ws-mooring" aria-selected={workspace === 'mooring'} onClick={() => setWorkspace('mooring')}>Mooring</button>
          </div>
          {workspace === 'geometry' ? (
            <>
              <section>
                <h2>Scene</h2>
                <Outliner
                  objects={project.objects}
                  selected={selected}
                  issues={issues}
                  onSelect={setSelected}
                  onToggleVisible={(id, v) => apply(`${v ? 'Show' : 'Hide'} object`, (p) => setVisible(p, id, v))}
                />
              </section>
              <section>
                <h2>Import</h2>
                <ImportPanel
                  busy={importBusy}
                  report={importReport}
                  needsUnits={needsUnits?.message ?? null}
                  onImport={(file, options) => void runImport(file, options)}
                  onRetryWithUnits={(units, swlElevation) => {
                    if (needsUnits) void runImport(needsUnits.file, { swlElevation, assumeUnits: units });
                  }}
                />
              </section>
            </>
          ) : (
            <section>
              <h2>Mooring design</h2>
              <MooringDesignPanel
                mooring={project.mooring}
                result={mooringSummary}
                depth={project.environment.h}
                selected={selected}
                onSelect={selectMooring}
                onInvalid={err}
                onGenerate={(sp) => { if (apply(`Generate ${sp.count}-line spread`, (p) => generateSpread(p, sp))) { setSelected(null); requestAnimationFrame(() => viewport.current?.frameAll()); } }}
                onAddLine={(deg) => apply('Add line', (p) => addLine(p, deg))}
                onRemove={() => { if (apply('Remove mooring', removeMooring)) setSelected(null); }}
                onLoadExample={() => newProject(true)}
              />
            </section>
          )}
        </aside>

        <section className="viewport" aria-label="3-D view">
          <div ref={viewportHost} className="viewport-host" />
          <p className="viewport-caption">
            z up · water plane z = 0 · seabed z = −{project.environment.h} m · arrow: wave direction (+x) · bodies are fixed in the load analysis
            {project.mooring ? ' · mooring lines at the quasi-static equilibrium, coloured by tension relative to MBL / intact SF (green → yellow → red at the limit; grey slack; dashed: unsolved or failed)' : ''}
          </p>
        </section>

        <aside className="panel right" aria-label="Properties and results">
          {workspace === 'geometry' ? (
            <>
              <section>
                <h2>Object</h2>
                <Inspector
                  object={selectedObject}
                  project={project}
                  issues={issues}
                  onInvalid={err}
                  onShape={(id, label, patch) => apply(label, (p) => updateShape(p, id, patch))}
                  onRename={(id, name) => apply('Rename', (p) => renameObject(p, id, name))}
                  onAnalysis={(id, v) => apply(v ? 'Include in analysis' : 'Exclude from analysis', (p) => setAnalysis(p, id, v))}
                  onVisible={(id, v) => apply(`${v ? 'Show' : 'Hide'} object`, (p) => setVisible(p, id, v))}
                  onDuplicate={(id) => {
                    const nid = newId('obj');
                    if (apply('Duplicate', (p) => duplicateObject(p, id, nid, [30, 0]))) setSelected(nid);
                  }}
                  onDelete={remove}
                />
              </section>
              <section>
                <h2>Environment</h2>
                <EnvironmentPanel
                  env={project.environment}
                  onInvalid={err}
                  onChange={(label: string, patch: Partial<Environment>) => apply(label, (p) => setEnvironment(p, patch))}
                />
              </section>
              <section>
                <h2>Loads {running ? <span className="spinner" aria-label="computing" /> : null}</h2>
                <ResultsPanel summary={summary} running={running} failure={analysisFailure} onSelectObject={setSelected} />
              </section>
            </>
          ) : project.mooring ? (
            <>
              <section>
                <h2>Selected item</h2>
                {selectedMooring ? (
                  <MooringInspector
                    mooring={project.mooring}
                    itemId={selectedMooring}
                    onInvalid={err}
                    onLine={(id, label, patch) => apply(label, (p) => updateLine(p, id, patch))}
                    onAnchor={(id, label, patch) => apply(label, (p) => updateAnchor(p, id, patch))}
                    onFairlead={(id, label, patch) => apply(label, (p) => updateFairlead(p, id, patch))}
                    onLineType={(id, label, patch) => apply(label, (p) => updateLineType(p, id, patch))}
                    onRemoveLine={(id) => remove(`${MOORING_PREFIX}${id}`)}
                  />
                ) : <p className="muted">Select a line, anchor, fairlead or line type in the list or the 3-D view.</p>}
              </section>
              <section>
                <h2>Mooring analysis</h2>
                <MooringResults
                  mooring={project.mooring}
                  outcome={mooringOutcome}
                  running={running}
                  meanLoad={summary?.ok && summary.mean ? summary.mean : null}
                  onInvalid={err}
                  onSelect={selectMooring}
                  onExternal={(ext, label) => apply(label, (p) => setMooringLoad(p, ext))}
                  onCriteria={(patch) => apply('Change criteria', (p) => setCriteria(p, patch))}
                />
              </section>
            </>
          ) : (
            <section>
              <h2>Mooring analysis</h2>
              <p className="muted" id="mooring-none">This project has no mooring design. Generate a spread layout on the left, or open the example project.</p>
            </section>
          )}
        </aside>
      </main>

      <footer className="statusbar">
        <p id="notice" role="status" data-kind={notice?.kind ?? 'info'}>{notice?.text ?? 'Ready.'}</p>
        <p className="small muted">{project.objects.length} objects · {Object.keys(project.meshes).length} meshes{project.mooring ? ` · ${project.mooring.system.lines.length} mooring lines` : ''}</p>
      </footer>
    </div>
  );
}

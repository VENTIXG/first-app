# Target Architecture — Offshore Engineering Simulation Studio

Status: **proposal** for Phases 2–13. Nothing in this document is implemented
unless the roadmap marks it done.

## 1. Guiding constraints

1. **Physics is a library, not a UI feature.** Every solver is a pure, versioned,
   tested module with a typed input/output contract. The UI and 3-D views only
   consume its outputs (rule 8: separate graphics from physics).
2. **Run in the browser what is cheap and verifiable; run on a server what needs
   established scientific codes** (BEM, dynamic mooring, CAD kernels, meshing).
3. **No silent model substitution.** Every result carries `method`, `assumptions`,
   `validity` and `verificationStatus` fields.
4. **Strangler migration.** The current app stays usable at every step; new
   workspaces replace old screens only at feature parity.

## 2. Frontend

### 2.1 Stack decision

| Option | Assessment |
|---|---|
| Keep vanilla ES modules | Zero build cost, but no type safety, no component model for dockable multi-workspace UI; does not scale to a CAD-like editor |
| **Vite + TypeScript + React (recommended)** | Mature ecosystem for exactly this problem: react-three-fiber (declarative three.js scene graph), a docking layout library (e.g. dockview / FlexLayout), virtualised data grids, Web Workers. TypeScript types become the API contract with the backend (OpenAPI codegen) |
| Vite + TypeScript + Svelte/Vue | Viable; smaller three.js / docking ecosystems for CAE use |

**Migration cost estimate (current code ≈ 2.4 k lines JS):**
- Physics modules (`waveTheory`, `morison`, `diffraction`, `bessel`, `quadrature`,
  `geometry`, `validation`, `hydrostatics`) port to TypeScript almost mechanically;
  the unit-test suite runs unchanged against the compiled output (Vitest can import
  the same tests). Low risk.
- UI (`main.js`, `charts.js`, `viz3d.js`, `export.js`) is rewritten as components.
  Medium effort; the existing app remains at `/` until the new shell reaches parity.
- Build: Vite emits static assets — the deploy model (static hosting) is unchanged
  for browser-only features.

### 2.2 Layering

```
packages/
  core/          Pure TypeScript physics & geometry. No DOM, no three.js.
                 Runs in main thread, Web Workers and Node (tests).
    waves/       dispersion, Airy, Stokes 5th, spectra (PM, JONSWAP, directional)
    loads/       Morison, wind, current, MacCamy–Fuchs
    hydrostatics/
    mooring/     catenary & quasi-static (verified vs analytical + MoorPy)
    geometry/    mesh topology, waterline cut, volume, validation
    units/       SI internal; display-unit conversion
  schema/        JSON Schema for the project file + generated TS types
  api-client/    Generated from the backend OpenAPI document
apps/
  studio/        React app: workspaces, docking layout, viewport, inspectors
```

### 2.3 Workspaces (Phase 2 shell)

Dashboard · Projects & Models · 3-D Design Studio · Geometry Import & Mesh
Processing · Hydrostatics & Stability · Hydrodynamics · Mooring Systems ·
Structural Engineering · Optimization Laboratory · Simulation Results ·
Environmental Conditions · Engineering Reports · Settings & Validation.

Layout: left (project explorer, hierarchy), centre (viewport), right (inspector),
bottom (timeline, solver log, plots), top toolbar. Workspaces only appear when they
have a working implementation; unimplemented ones are not shown as buttons.

### 2.4 State

- Project document (serialisable, versioned) separate from UI/session state.
- Command pattern for every model edit → undo/redo and revision history for free.
- Derived analysis results are cached by a hash of their inputs and invalidated
  when inputs change; results never mutate the model.
- Store: Zustand (or equivalent) with immer for structural sharing.

### 2.5 Computation in the browser

Long browser computations (parameter sweeps, quasi-static mooring, hydrostatics of
large meshes) run in Web Workers with progress events and cancellation
(`AbortController`). The UI never blocks.

## 3. 3-D and CAD

### 3.1 Viewport
three.js via react-three-fiber; transform gizmos (TransformControls), selection
via BVH raycasting (three-mesh-bvh), section planes (clipping planes),
orthographic/perspective cameras, measurement tools. Analysis visualisations
(force vectors, pressure maps, mooring tension colour maps) read computed result
arrays only; illustrative animation is a separately labelled mode.

### 3.2 Rhino `.3dm` import — what is and is not possible client-side

- **rhino3dm.js** (McNeel, WASM, MIT) reads `.3dm` files: units, layers, object
  attributes/names/IDs, instance definitions, and geometry objects.
- **three.js `3DMLoader`** builds three.js objects from rhino3dm, using the
  **render meshes stored in the file** for BReps/Extrusions.
- **Limitation:** rhino3dm.js cannot tessellate BReps/NURBS itself. If a file was
  saved without render meshes ("Save small"), BRep geometry cannot be meshed in the
  browser. Options: (a) ask the user to save with render meshes; (b) Rhino.Compute
  (requires a Rhino licence/server); (c) server-side conversion through another kernel.
  The importer must report which objects were skipped and why.
- Coordinate convention: Rhino is Z-up, three.js Y-up — one documented transform at
  import; units converted to metres from the file's `ModelUnitSystem`.

### 3.3 STEP / IGES
Not readable in the browser without a CAD kernel. Options: OpenCascade.js (WASM,
large, LGPL — licence review needed) or a server-side converter (pythonocc-core /
OCCT) producing a mesh + metadata. Recommended: server-side.

### 3.4 Geometry → analysis pipeline
`source CAD` → `triangulated surface` → **validation** (manifold edges, boundary
loops, normal orientation, self-intersection via BVH, overlapping bodies) →
**waterline cut** → **closure** (cap the cut with the waterplane polygon) →
**volume, centroid, waterplane properties** (divergence theorem; only for closed
surfaces) → **analysis mesh** (panel size vs λ, aspect ratio, quality metrics).
Source and analysis meshes are stored separately with provenance. A body is
"analysis-ready" only when every check passes; the status panel explains each failure.

## 4. Backend (only where needed)

### 4.1 When it is needed
| Need | Browser? | Backend tool |
|---|---|---|
| Morison / wind / current / Airy / Stokes | Yes | — |
| Hydrostatics of closed meshes | Yes | — |
| Quasi-static catenary mooring | Yes (verified TS) | MoorPy for cross-verification |
| Radiation/diffraction BEM, RAOs | No | **Capytaine** (Python, GPL-3) |
| Dynamic mooring | No | **MoorDyn** (C/C++, BSD) |
| STEP/IGES, BRep meshing | No | OCCT / gmsh |
| Optimisation with expensive evaluations | Mostly no | Python workers (pymoo for NSGA-II, scipy) |

### 4.2 Services
- **FastAPI** application: project storage, job submission, results.
- **Job queue:** Redis + RQ/Arq (Celery if routing grows). Each job: status
  (queued/running/succeeded/failed/cancelled), progress, log stream, cancellation,
  inputs hash, solver name and version, persisted results.
- Progress to the client via Server-Sent Events.
- Storage: PostgreSQL (projects, jobs, metadata) + object storage (meshes, result arrays).
- Containers per solver with pinned versions; solver version recorded in every result.

### 4.3 API contract (sketch)
```
POST /projects/{id}/jobs        { kind: "bem", bodyRefs, frequencies, headings, meshRef }
GET  /jobs/{jobId}              { status, progress, log[], resultRef?, error? }
GET  /jobs/{jobId}/events       (SSE)
POST /geometry/convert          multipart CAD → { meshRef, objects[], skipped[] }
```
All payloads defined in `packages/schema` (JSON Schema) → OpenAPI → generated TS client.

## 5. Project file

`*.oes.json` (JSON, gzip optional): `schemaVersion`, units, metadata, environment
cases, components (geometry refs + parameters + mass properties), mooring system,
analysis definitions, result references, revision log. Every version bump ships a
migration function and a round-trip test.

## 6. Verification architecture

- Unit tests per solver module; analytical benchmarks; published benchmark
  comparisons kept in `tests/benchmarks/` with the source cited and the tolerance justified.
- `VALIDATION_MATRIX.md` generated/checked in CI against the test inventory.
- Browser E2E (Playwright) for workflows; visual regression for deterministic views.
- Results carry `verificationStatus ∈ {verified-analytical, verified-benchmark,
  code-consistency, unverified, experimental}` and reports print it.

## 7. Security

- No `innerHTML` with user or file-derived data; Content-Security-Policy in production.
- Uploaded CAD processed in sandboxed workers/containers with size and time limits.
- Pinned dependencies, lockfiles, `npm audit`/`pip-audit` in CI; vendored or
  SRI-protected third-party scripts.

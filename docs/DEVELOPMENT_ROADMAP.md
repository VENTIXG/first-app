# Development Roadmap

Each phase ends with: modified-file list, architectural decisions, run
instructions, executed test results, unresolved issues, unsupported features,
benchmark results, and confirmation that existing modules still work.
A phase is not "done" until its acceptance criteria pass in CI.

## Phase 1 — Audit, correct and harden *(complete; see `PHASE1_REPORT.md`)*

**Deliverables:** engineering documents (this folder); automated test suite;
fixes per `BUG_FIX_PLAN.md`; browser E2E tests; updated README.

**Acceptance:**
- every defect in `ENGINEERING_AUDIT.md` fixed or explicitly deferred with a reason — **met** (all fixed);
- all unit and E2E tests pass, no `todo` left for a fixed defect — **met** locally
  (82 unit, 19 browser); the CI workflow is added but had not yet run on GitHub
  when this was written;
- Stokes 5th BC residuals scale as λ⁶; Morison matches closed forms to 1e-6 — **met** (1e-12);
- invalid geometry and impossible waves rejected with explanations — **met**;
- existing features (multi-body, charts, 3-D, scenarios, CSV/PDF, dark mode) still work — **met** (browser suite).

**Deferred from Phase 1, with reasons:**
- display-unit configuration beyond the viscosity field (needs the project/settings model of Phase 2);
- wave–current interaction (Doppler shift): a modelling extension, Phase 6;
- vendoring the CDN libraries / subresource integrity: depends on the Phase 2 build;
- Web Worker execution: Phase 2 (instantaneous-surface integration takes ≈ 0.4–0.5 s for 50 bodies on the main thread).

## Phase 2–3 foundation *(in progress)*

Scope agreed for the first increment, built in the target stack so it is not
thrown away later, but kept independent of the classic calculator:

- `studio/`: Vite + TypeScript + React app; physics imported from the verified
  `js/` modules (no second copy of the physics).
- Project document v1 (SI units, versioned, validated on load) and a
  command history with undo/redo.
- Editable 3-D scene: parametric cylinders and spheres; select, move in plan,
  edit dimensions, rename, hide, delete; outliner and inspector.
- Basic Rhino `.3dm` import (rhino3dm.js): unit conversion, layers, names, IDs;
  meshes displayed; cylinders and spheres recognised and offered as analysis
  bodies; everything skipped is listed with the reason.
- Analysis of the scene's analysis bodies with the Phase 1 engine in a Web Worker.

Everything beyond this (docking layout, STL/OBJ/glTF, rotate/scale gizmos,
geometry verification of meshes, mesh hydrostatics) stays in Phases 2–5.

## Phase 2 — Application architecture

- Vite + TypeScript monorepo (`packages/core`, `packages/schema`, `apps/studio`).
- Port physics modules to TS with the same tests (Vitest).
- React shell with docking layout, workspaces shown only when implemented.
- Project file format v1 + migrations; command-based undo/redo; display-unit settings.
- Web Worker execution for long computations, with progress and cancellation.

**Acceptance:** the new shell reproduces every Phase 1 result to 1e-12; the old
app still runs; project files round-trip.

## Phase 3 — CAD and Rhino integration (foundation)

- `.3dm` import via rhino3dm.js + 3DMLoader: units, layers, names, IDs, transforms,
  render meshes; explicit report of skipped objects (e.g. BReps without render meshes).
- STL / OBJ / glTF import.
- Editable scene: select/multi-select, move/rotate/scale gizmos, duplicate, hide,
  lock, group, undo/redo; parametric cylinders/spheres/pontoons/columns/braces.
- Geometry verification pipeline (manifold, normals, intersections, waterline,
  closure, volume) with an "analysis-ready" status.

**Acceptance:** sample `.3dm` files (with and without render meshes) import with
correct units and positions; validation correctly flags open/non-manifold meshes;
closed-mesh volumes match analytical solids to 1e-6.

## Phase 4 — Visualisation
Ocean rendering (regular/irregular), cutaways, wireframe, seabed, force/moment
vectors and pressure maps from computed data, timeline scrubbing, screenshots
and video export. Illustrative animations labelled separately.

## Phase 5 — Hydrostatics and stability
General closed-mesh hydrostatics: ∇, displacement, CoB, waterplane area and
moments, BM, GM, restoring matrix, equilibrium draft/heel/trim, GZ curves,
loading conditions. **Acceptance:** box, cylinder, sphere analytical cases to 1e-6;
GZ of a box barge vs. analytical wall-sided formula.

## Phase 6 — Advanced hydrodynamics
Irregular waves (PM, JONSWAP, directional, user spectra); wave heading; wave–current
interaction; Capytaine backend (added mass, radiation damping, excitation, RAOs,
multi-body); 6-DOF frequency-domain motions. **Acceptance:** hemisphere added mass/damping
vs Hulme (1982); truncated cylinder vs published BEM results; mesh convergence study.

## Phase 7 — Mooring engineering studio *(major priority)*
7.1 visual designer (fairleads on imported geometry, anchors on seabed) ·
7.2 component database with sourced properties only ·
7.3 anchor library with stated applicability ·
7.4 static catenary solver (elastic catenary with seabed contact) ·
7.5 quasi-static multi-line analysis (offset, restoring curves, damaged cases) ·
7.6 dynamic analysis via MoorDyn (no in-house toy solver) ·
7.7 failure/redundancy analysis with selectable criteria editions ·
7.8 fatigue workflow (rainflow, S–N) only from dynamic tension histories ·
7.9 visual analytics.
**Acceptance (7.4/7.5):** analytical inextensible and elastic catenary benchmarks;
cross-check against MoorPy on published reference systems (e.g. OC3/OC4 mooring).

## Phase 8 — Structural engineering
Beam/frame model, mass estimation, load mapping from hydrodynamics, beam-element
solver verified against analytical beams. No shell/solid FEM claims before a verified
solver is integrated.

## Phase 9 — Optimisation laboratory
Design variables, objectives, constraints; sweeps, gradient methods (where derivatives
are reliable), DE/GA, NSGA-II; seeded, logged, reproducible; Pareto and sensitivity views;
full input/output traceability.

## Phase 10 — Environmental engineering
Load-case management, metocean import, return-period analysis from supplied data only.

## Phase 11 — Reports and reproducibility
Report sections listed in the specification; every result tagged calculated /
estimate / user data / validated / experimental; PDF, CSV, JSON, project export.

## Phase 12 — UI/UX
Dark navy/graphite CAE-style interface, dockable panels, keyboard shortcuts,
contextual warnings, consistent units.

## Phase 13 — Validation & QA
Verification matrix enforced in CI; benchmark library; performance tests on large
meshes; dependency and security checks.

## Dependencies

```
1 → 2 → 3 → 5 → 6 → 7.5/7.6 → 9
          ↘ 4 (incremental from 2)
     2 → 10 → 6
     5,6,7 → 11
     3 → 8
```

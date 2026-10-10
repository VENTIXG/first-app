# Phase 2–3 Foundation: Offshore Studio preview

First increment of the application architecture (Phase 2) and CAD integration
(Phase 3): an editable 3-D scene with basic Rhino `.3dm` import, analysed with
the verified Phase 1 engine. Commits `864aef0` (dependencies), `6283f59` (core),
`32c4c17` (application), `d876084` (documentation) and `a886444` (test race fix).

## 1. What is delivered

| Capability | State |
|---|---|
| Project document v1 (SI, z-up, versioned, validated on load) | done, tested |
| Undo/redo for every edit (bounded, labelled) | done, tested |
| Parametric vertical cylinders and spheres: add, edit, rename, hide, duplicate, delete | done, tested |
| 3-D viewport: orbit, click selection, plan-move gizmo, frame-all, water/seabed planes | done, browser-tested |
| Rhino `.3dm` import: units, layers, names, ids, visibility | done, tested |
| Recognition of closed capped cylinders and spheres (Brep and Extrusion) | done, tested |
| Display of meshes, inclined cylinders and render-meshed Breps (display only) | done, tested |
| Import report listing every skipped object with the reason | done, tested |
| Load analysis of included objects in a Web Worker (Phase 1 engine, unchanged) | done, tested |
| Project save/open (JSON) with validation and an unsaved-changes guard | done, tested |
| Content-Security-Policy on the built page | done, tested |

## 2. Files

| Area | Files |
|---|---|
| Core (pure TypeScript) | `studio/src/core/{types,project,history,commands,analysis,units,fit,rhinoImport,ids}.ts` |
| Viewport | `studio/src/viewport/Viewport.ts` |
| UI | `studio/src/App.tsx`, `studio/src/ui/*.tsx`, `studio/src/styles.css`, `studio/src/main.tsx`, `studio/index.html` |
| Workers | `studio/src/workers/analysis.worker.ts`, `studio/src/workers/cad.worker.ts` |
| Build | `studio/vite.config.ts`, `studio/tsconfig.json`, `studio/src/types/rhino3dm-module.d.ts`, `package.json` |
| Shared physics | `js/state.js` (`parseEnvironment` extracted, used by both apps) |
| Tests | `tests/unit/studio/*.test.ts` (6 files), `tests/e2e/studio.spec.js`, `tests/helpers/rhinoFixtures.mjs` |
| Tooling | `scripts/bench-studio.mjs`, `scripts/serve.mjs` (WASM content type), `.github/workflows/ci.yml` |

## 3. Architectural decisions

1. **Target stack, no rewrite of the physics.** The studio uses Vite + TypeScript
   + React as `TARGET_ARCHITECTURE.md` recommends, but imports the verified
   JavaScript physics from `js/` instead of porting it now. Both apps therefore run
   the same engine; a test asserts the studio's default scene reproduces the
   classic calculator's result exactly.
2. **Layers.** `core/` is pure TypeScript (no DOM, no three.js) and runs in Node
   under `node:test` through Node 22's type stripping, so no separate test runner
   was added. `viewport/` draws and reports intents (select, move) but never edits
   the project. React components hold UI state only; every edit is a pure
   command recorded in the history.
3. **Immutable project + structural sharing** makes undo/redo exact and cheap:
   an edit copies only what it touches; mesh data is shared between states.
4. **One frame everywhere.** Rhino, the engine and the viewport are all z-up, with x
   the wave direction, so imported geometry is used without an axis swap. z = 0 is
   the still-water level; the import asks for the model's still-water elevation.
5. **Recognise, do not guess.** A Brep becomes an analysable cylinder or sphere only
   when its face structure matches (one cylindrical face and two planar caps normal
   to the axis, closed; or one closed spherical face) **and** a least-squares fit
   reproduces the sampled surface within max(file tolerance, 1e-7 × size). Axes
   within 1 mrad of vertical are snapped and the tilt is stated in the object's
   provenance; anything more inclined is display-only. Imported objects are not
   analysed until the user includes them.
6. **Untrusted input is isolated and validated.** `.3dm` bytes are parsed in a
   fresh worker per file (WASM memory released afterwards); project files are fully
   validated (types, ranges, safe identifier charset) and refused rather than
   partially loaded; names are rendered as text. The built page has a CSP that
   allows scripts only from its own origin (plus WASM instantiation).
7. **Analysis off the main thread.** The engine runs in a module worker; only
   the reply to the latest request is displayed.

## 4. Install and run

```bash
npm install
npm run studio                 # development server
npm run build:studio           # production build → studio/dist/
npm run serve                  # http://localhost:8000/studio/dist/index.html
npm test                       # includes the studio core tests
npm run typecheck
npm run test:e2e               # builds the studio, then all browser tests
npm run bench:studio
```

## 5. Test results (executed 2026-10-10, Node 22.22.0, Playwright 1.56.0, Chromium)

- `npm test`: **114 / 114 pass** (82 physics + 32 studio core).
- `npm run typecheck`: no errors.
- `npm run test:e2e`: **27 / 27 pass** (19 classic calculator + 8 studio).
- Studio core coverage: project validation (17 rejection cases), history,
  commands, scene → engine mapping, eigen-solver, cylinder/sphere fits on
  random cases in millimetre coordinates (recovery to 1e-9 relative), display
  tessellation (closed, outward, exact prism volume to 1e-12), and the importer
  on files generated with rhino3dm.
- GitHub CI (unit tests, type check, studio build, CSS check, browser tests except
  `@visual`): run 1 (Phase 1 close-out) passed. Runs 2 and 3 failed on one studio
  test that read the peak before the worker had returned the new result (a race in
  the test; the application result was correct). Commit `a886444` fixed the test and
  made the panel dim stale results while recomputing; **run 4 passed**.
- CI warns that `actions/checkout@v4` and `actions/setup-node@v4` target Node 20,
  which GitHub now runs on Node 24; harmless today, to be updated with the next
  workflow change.

## 6. Benchmarks

`npm run bench:studio` (Node 22.22.0, linux/x64; parse + recognition + conversion):

| File | Size | Import time |
|---|---|---|
| 10 capped Brep cylinders | 58 KB | 17 ms |
| 50 capped Brep cylinders | 261 KB | 56 ms (analysis of all 50: 67 ms) |
| mesh, 20 k triangles | 217 KB | 30 ms |
| mesh, 180 k triangles | 2.6 MB | 227 ms |

Production build: main bundle 683 KB (186 KB gzip; React + three.js), analysis
worker 24 KB, import worker 98 KB plus the rhino3dm reader (143 KB JS, 2.6 MB WASM,
1.0 MB gzip) loaded only when a file is imported.

## 7. Limitations and unresolved issues

- **Recognition scope.** Only Rhino-native shapes: single-face cylinders with two
  planar caps, and single-face spheres. Cylinders whose side is split into several
  faces, cones, tapered or ring-stiffened columns, pontoons and boxes are not
  recognised; they appear only if the file stores render meshes.
- **Files from Rhino itself are not in the test set.** All test files are produced by
  rhino3dm (the same openNURBS library Rhino uses for writing), including Breps with
  attached render meshes. Files saved by Rhino 7/8, with their own render meshes and
  user data, have not been tested.
- **rhino3dm cannot mesh NURBS.** Unrecognised Breps without stored render meshes
  cannot be shown (reported, with the remedy).
- **Not imported:** block instances, SubD, open surfaces, curves, points, annotations.
- **Imported meshes are display only.** No mesh hydrostatics or hydrodynamics (Phases 5–6).
- **Editing:** plan moves only (elevations are edited numerically); no rotation, scaling,
  multi-selection, grouping or locking.
- **Layout:** one fixed three-panel layout, no docking; usable on narrow screens but
  designed for desktop.
- **Units:** SI display only.
- **Persistence:** projects are saved as downloads; there is no autosave.
- **Link to the classic calculator** (`../../index.html`) is correct for the built app
  served from the repository root; it does not resolve on the Vite dev server.
- **Messages from the engine** number bodies in scene order ("Body 2"); the results
  table shows which object each number refers to, and issues link to the object.
- The WebGL viewport has no pixel-level regression test (GPU-dependent); its behaviour
  (selection, gizmo) is covered by browser tests.
- Results are recomputed after every edit (debounced, in a worker); while a
  recomputation is pending the previous numbers are shown dimmed.

## 8. Existing functionality

The classic calculator, `standalone.html` and all their tests are unchanged
(19 browser tests and 82 unit tests pass). The only shared-code change is the
extraction of `parseEnvironment` in `js/state.js`, covered by the existing
scenario tests.

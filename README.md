# Multi-Body Wave Force Calculator

Browser-based calculator for wave, current and wind loads on **fixed** groups
of vertical cylinders and spheres: Morison equation with strip integration,
Airy and Stokes 5th-order waves, the MacCamy–Fuchs diffraction correction,
and a heave-resonance screening estimate. It is the first stage of a planned
offshore engineering studio (see [`docs/DEVELOPMENT_ROADMAP.md`](docs/DEVELOPMENT_ROADMAP.md)).

## Download the desktop app

Offshore Studio is available as a desktop app for **Windows, macOS and Linux**
that works offline: the 3-D Studio, the load calculator and the array study in
one window. **Download: <https://github.com/VENTIXG/first-app/releases/latest>**
(builds of every change are also kept on the
[**Desktop app** workflow](https://github.com/VENTIXG/first-app/actions/workflows/desktop.yml)
for 30 days, sign-in required). Installation
notes, including the unsigned-app warnings, are in [`docs/DESKTOP.md`](docs/DESKTOP.md).

> **Status.** The physics is verified against analytical solutions and
> reference tables (see [`docs/VALIDATION_MATRIX.md`](docs/VALIDATION_MATRIX.md)).
> It has **not** been validated against model tests or field measurements and
> is not a substitute for a certified design analysis.

## Quick start

Requires Node.js 22 or later (only for the dev server, tests and CSS build; the app
itself is static HTML + ES modules with no build step).

```bash
npm install          # development tools: Playwright, Tailwind, Vite, Electron
npm run serve        # http://localhost:8000/home.html  (npm run serve -- --port N)
```

Any static file server works (`python3 -m http.server`); opening `index.html`
through `file://` does not, because browsers block ES modules there.

Plotly (interactive chart), three.js (3-D view) and jsPDF (PDF report) are
bundled in `vendor/` at pinned versions, so everything works offline; the app
makes no network requests. Styling is a prebuilt local file (`css/app.css`).
`home.html` links the three tools.

`standalone.html` is the earlier self-contained version with the array
frequency-sweep study (thesis method). It works fully offline and has
received the Phase 1 fixes D-04, D-05 and D-19.

## Offshore Studio (preview)

`studio/` is the first increment of the planned studio: an editable 3-D scene
with Rhino `.3dm` import, analysed with the same verified engine. It is a
Vite + TypeScript + React app and needs a build step:

```bash
npm run studio           # development server (prints the URL)
npm run build:studio     # production build in studio/dist/
npm run serve            # then open http://localhost:8000/studio/dist/index.html
```

What it does:

- Scene of vertical cylinders and spheres (z up, z = 0 is the still-water level,
  waves travel in +x): add, select in the 3-D view or the list, move in plan with
  the gizmo, edit dimensions and elevations, rename, hide, duplicate, delete;
  undo/redo for every edit (Ctrl+Z, Ctrl+Shift+Z).
- Rhino import (rhino3dm.js, in a Web Worker): units converted to metres (files
  without units are refused until you state them), layers, names, visibility.
  Closed capped cylinders and spheres are recognised by a least-squares fit that
  must reproduce the surface within tolerance; vertical ones become editable,
  analysable objects (not analysed until you include them). Inclined cylinders,
  meshes and Breps with stored render meshes are shown for reference only.
  Everything else is listed in the import report with the reason it was skipped.
- Loads for the objects you include, computed in a Web Worker by the Phase 1
  engine; the default scene gives exactly the classic calculator's default result.
- Projects saved and opened as JSON files, validated on load.

Not yet: other CAD formats, rotation/scaling, multi-selection, mesh hydrostatics,
docking layout, display units other than SI. Details and limitations:
[`docs/PHASE2_3_FOUNDATION.md`](docs/PHASE2_3_FOUNDATION.md).

## What it computes

| Quantity | Model |
|---|---|
| Wave kinematics | Airy (any kh, overflow-free) or Stokes 5th order (Skjelbreia–Hendrickson with Fenton's C2) |
| Wave load per body | Morison drag + inertia, composite Gauss–Legendre over the wetted length, at the body's own phase kx − ωt |
| Integration limit | Still-water level (default) or the instantaneous surface (Wheeler stretching for Airy) |
| Diffraction | MacCamy–Fuchs gain C_M/2 and phase lead δ on the **inertia term only**, cylinders only; per harmonic for Stokes (labelled approximation) |
| Current | Uniform, 1/7 power law or logarithmic profile; collinear with the waves |
| Wind | Steady power-law profile, exact integral over each body's exposed height |
| Platform | Sum of body forces at each instant (no hydrodynamic interaction) |
| Heave | Screening only: mass, added mass, stiffness and T₃ reported separately; damping and excitation are not modelled |

Every reported peak is refined on the continuous force function. Results are
withheld (tiles show "—" and exports are disabled) when an input is
physically impossible or outside the model's validity: draft deeper than the
water, overlapping bodies, breaking waves, Stokes 5th not converged or beyond
the Ursell limit, and so on. Warnings (D/λ > 0.2, close spacing, Stokes
truncated at the still-water level, potential heave resonance, …) are shown
next to the result and listed in the exports.

### Not modelled

Body motion (all loads are for fixed bodies), wave–current interaction
(T is the intrinsic period), irregular or directional seas, wave headings
other than +x, hydrodynamic interaction between bodies, KC/Re-dependent
coefficients, slamming, ringing, mooring and structural response. The full
list of assumptions and limitations is shown in the app and in
[`docs/ENGINEERING_AUDIT.md`](docs/ENGINEERING_AUDIT.md).

## Tests

```bash
npm test                                   # 114 unit / verification tests (physics + studio core, node:test)
npm run typecheck                          # TypeScript check of the studio
npx playwright install chromium            # once; or set PW_CHROMIUM_PATH=/path/to/chromium
npm run test:e2e                           # builds the studio, then the browser tests (runs offline)
xvfb-run -a npm run test:app               # desktop app tests (Electron); no xvfb-run on Windows/macOS
npm run app                                # start the desktop app from source
npm run dist                               # build installers for this system into release/
npm run bench                              # engine timings
npm run bench:studio                       # Rhino import timings
npm run build:css                          # rebuild css/app.css after changing Tailwind classes
```

The unit suite checks the physics against closed-form solutions (to 1e-12),
free-surface boundary-condition residuals for Stokes 5th, published tables
(Abramowitz & Stegun Bessel values, thesis Table 6) and convergence in
quadrature and time step, plus a 300-case robustness sweep. The browser
suite covers the main workflow, error states, HTML-injection attempts,
scenario round trips and migration, exports, offline operation and visual
baselines (`@visual`, host-specific, excluded from CI), and the studio on its
production build. CI runs on every push (`.github/workflows/ci.yml`).

## Project layout

```
home.html             Home page linking the three tools
index.html            Load calculator (inputs, result tiles, 3-D view, chart, table, assumptions)
css/                  Tailwind input and the prebuilt app.css
js/
  main.js             UI: schema-driven inputs, body manager, safe DOM rendering, scheduling
  state.js            AppState store, versioned scenario schema (v1) and migration from v0
  validation.js       Input, geometry, wave and applicability checks (errors / warnings / infos)
  waveTheory.js       Dispersion, Airy and Stokes 5th kinematics, breaking checks, Wheeler stretching
  morison.js          Platform engine: strip integration, superposition, peaks, wind, KC/Re
  compute.worker.js   Runs the engine off the page thread for the calculator
  framePacer.js       Adaptive frame pacing for the 3-D views (slow/software graphics)
  diffraction.js      MacCamy–Fuchs coefficients and the closed-form total force
  hydrostatics.js     Heave screening (mass, added mass, stiffness, period band)
  geometry.js         Body geometry: section radius, volume, waterplane area, sphere slices
  bessel.js           J0, J1, Y0, Y1 and derivatives
  quadrature.js       Gauss–Legendre rules and golden-section peak search
  charts.js           Plotly chart with a dependency-free SVG fallback
  viz3d.js            three.js scene (illustrative; bodies drawn fixed)
  export.js           CSV, JSON results record, paginated PDF
  scenarios.js        Named scenarios in localStorage
studio/               Offshore Studio (Vite + TypeScript + React)
  src/core/           Pure TypeScript: project model, undo/redo, Rhino import, fits, scene analysis
  src/viewport/       three.js viewport (graphics only)
  src/ui/, App.tsx    React panels
  src/workers/        Analysis and .3dm parsing workers
standalone.html       Array study (thesis frequency sweep), self-contained
vendor/               Bundled Plotly, three.js and jsPDF (pinned, with licences)
electron/             Desktop app main process; electron-builder.yml packages it
legacy/               Deprecated first version — see legacy/README.md
docs/                 Architecture, audit, bug-fix plan, roadmap, validation matrix, phase reports
tests/unit, tests/e2e Automated tests; tests/helpers holds independent reference implementations
                      and the generator of the .3dm test files
scripts/              Static dev server and benchmark
```

Physics modules import nothing from the UI and run unchanged in Node.

## Documentation

- [`docs/CURRENT_ARCHITECTURE.md`](docs/CURRENT_ARCHITECTURE.md): the code as found at the audit
- [`docs/ENGINEERING_AUDIT.md`](docs/ENGINEERING_AUDIT.md): defects, impacts and limitations
- [`docs/BUG_FIX_PLAN.md`](docs/BUG_FIX_PLAN.md): fixes and the changelog of result changes
- [`docs/VALIDATION_MATRIX.md`](docs/VALIDATION_MATRIX.md): what is verified, how, and to what tolerance
- [`docs/TARGET_ARCHITECTURE.md`](docs/TARGET_ARCHITECTURE.md), [`docs/DEVELOPMENT_ROADMAP.md`](docs/DEVELOPMENT_ROADMAP.md)
- [`docs/PHASE1_REPORT.md`](docs/PHASE1_REPORT.md): Phase 1 summary, test results and benchmarks
- [`docs/PHASE2_3_FOUNDATION.md`](docs/PHASE2_3_FOUNDATION.md): the studio increment, its tests and limitations
- [`methodologia-morison.md`](methodologia-morison.md): the thesis method used by the array study

## References

1. Morison, O'Brien, Johnson & Schaaf (1950). The force exerted by surface waves on piles.
2. MacCamy & Fuchs (1954). Wave forces on piles: a diffraction theory. BEB Tech. Memo 69.
3. Skjelbreia & Hendrickson (1960). Fifth order gravity wave theory. Proc. 7th Coastal Eng. Conf.
4. Fenton (1985). A fifth-order Stokes theory for steady waves. J. Waterway, Port, Coastal and Ocean Eng. 111(2).
5. Newman (1977). Marine Hydrodynamics. MIT Press.
6. Hedges (1995). Regions of validity of analytical wave theories. Proc. ICE Water, Maritime and Energy 112.
7. Sarpkaya & Isaacson (1981). Mechanics of Wave Forces on Offshore Structures.
8. Abramowitz & Stegun (1964). Handbook of Mathematical Functions, Table 9.1.

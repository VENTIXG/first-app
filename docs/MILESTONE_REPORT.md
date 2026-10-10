# Milestone report: Milestones 0–3

Branch `claude/e-cuvhh9`, version 0.7.0, 2026-10-10.

| Milestone | Scope delivered | Commit |
|---|---|---|
| 0: Audit and critical repairs | `AUDIT.md`, `FEATURE_MATRIX.md`; dead studio route fixed; `npm start` builds and serves | `5cffc62`, this commit |
| 1: Numerical validation foundation | overturning moments (engine 1.1.0), reference-point transfer, group velocity and buoyancy benchmarks; benchmarks A–M mapped to tests | `5cffc62`, this commit |
| 2: Frontend architecture | studio workspaces (Geometry & loads, Mooring), product name, worker carries both analyses | `870b569` |
| 3: Mooring Studio | quasi-static mooring solver compared against MoorPy, safety study, designer UI, 3-D tension view, charts | `7bb6742`, `870b569` |

## What was built

**Mooring solver** (`studio/src/core/mooring/`):
- `catenary.ts`: elastic catenary with frictionless seabed contact (Jonkman 2007). It handles the suspended, seabed-contact, slack and vertical regimes. Newton with an analytic Jacobian; it reports an error on invalid input or non-convergence and never returns a guess.
- `library.ts`: generic properties for 6 materials (MoorPy 1.3.0 coefficients), each with its source.
- `system.ts`: assembly of the line forces on a 6-DOF pose, equilibrium in surge, sway and yaw, a 6×6 finite-difference stiffness, and the inverse pretension → length.
- `safety.ts`: an intact case plus one case per failed line. It checks the MBL safety factors, uplift at drag anchors, an optional offset limit, and station-keeping loss.
- `schema.ts`, `run.ts`: validated project data and the complete study as plain data for the worker.

**Mooring Studio** (`studio/src/ui/MooringPanels.tsx`, `core/mooringCommands.ts`, `viewport/Viewport.ts`):
- spread generator, add/remove line, and editors for each item, all undoable;
- load case, including "use mean environmental load", and editable criteria;
- result tiles, line and case tables, the tension–offset chart, and the method and limitations;
- 3-D lines coloured by tension relative to the allowable value, with click selection;
- an example project.

**Engine 1.1.0** (`js/morison.js`): overturning moment about the seabed (wave, current and wind), plus `transferMoment` to any reference point. It is shown as a tile in the calculator.

## Test commands and results (run on 2026-10-10)

```text
$ npm test
# tests 148  # pass 148  # fail 0
$ npm run typecheck
(no errors)
$ npx playwright test            # builds already done with npm run build:studio
36 passed
$ xvfb-run -a npx playwright test -c playwright.electron.config.js
7 passed
```

Mooring-specific results:
- `tests/unit/studio/mooring.test.ts`: 17 tests against MoorPy 1.3.0 (properties to 1e-12, catenary and system forces to 1e-6, single-line stiffness to 1e-4) and analytical cases.
- `tests/unit/studio/mooringCommands.test.ts`: 5 tests.
- `tests/e2e/mooring.spec.js`: 4 tests.

Example project, mean environmental load ≈ 402 kN in +x:
- intact offset 2.11 m, maximum tension 1483 kN, minimum SF 9.19, so the intact case passes;
- losing Line 1 (the windward line) moves the platform 398 m past the remaining anchors, which is reported as **fail: station keeping lost**.

## Limitations (what is not done)

- **Mooring**:
  - quasi-static only: no MoorDyn, no line dynamics, no fatigue;
  - single-segment lines: no clump weights or buoys;
  - no seabed friction, flat seabed only;
  - no anchor holding capacity;
  - heave, roll and pitch are held, so there is no hydrostatic coupling;
  - the coupled rotational stiffness terms are not compared with a reference;
  - the line properties are generic estimates, not manufacturer data.
- **Loads**: bodies are fixed; +x heading only; regular waves only; no second-order drift (so the "mean environmental load" excludes it); no BEM.
- **Shell**: two workspaces out of the twelve modules in the brief. No command palette, autosave, light theme in the studio, or studio PDF report.
- **Import**: Rhino `.3dm` only.
- **Validation**: nothing is validated against model tests or field data. The safety factors are screening defaults and must be checked against the governing standard. Nothing here is design-certified.

## How to run

```bash
npm install
npm start                        # http://localhost:8000/home.html → Offshore Studio → Example → Mooring
npm run app                      # desktop app from source
```

Installers: <https://github.com/VENTIXG/first-app/releases/latest>. The
desktop workflow publishes v0.7.0 once this version is pushed.

## Next milestones

4. Professional shell: sidebar modules, command palette, autosave, light theme, studio reports.
5. Geometry readiness: STL/OBJ/glTF import, mesh checks, mesh hydrostatics, GZ curves.
6. Hydrodynamics: spectra and irregular seas, Capytaine BEM (offline service), RAOs.
7. Dynamic mooring (MoorDyn), multi-segment lines, fatigue; optimisation lab.

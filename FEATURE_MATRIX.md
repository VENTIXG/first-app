# VENTIX Offshore Studio — Feature Matrix

State on 2026-10-10 (branch `claude/e-cuvhh9`). Section numbers refer to the
rebuild brief. The validation state of each solver is in
`docs/VALIDATION_MATRIX.md`; this file says what exists.

**Status**
- **Complete**: implemented, tested, and usable in the app.
- **Partial**: implemented with a stated, limited scope.
- **Unverified**: implemented but not checked against a reference.
- **Missing**: not implemented. Nothing in the UI pretends otherwise.

## Applications

| Feature | Status | Where | Tests |
|---|---|---|---|
| Home page linking all tools; studio links disabled with an explanation when the build is missing | Complete | `home.html`, `js/studioLink.js` | e2e `home`, `route` |
| Load calculator (classic, single page) | Complete | `index.html`, `js/main.js` | e2e `app`, `exports-offline` |
| Array study (thesis method) | Complete | `standalone.html` | unit `standalone` |
| Studio (React/three.js): Geometry & loads and Mooring workspaces | Partial (2 of the 12 planned modules) | `studio/src/App.tsx` | e2e `studio`, `mooring` |
| Desktop app (Electron) and installers for Windows, macOS and Linux | Complete | `electron/`, `.github/workflows/desktop.yml` | `tests/electron` (7) |

## §3 Professional shell

| Feature | Status | Notes |
|---|---|---|
| Dark graphite/navy design tokens | Partial | `studio/src/styles.css` `:root`. No light theme in the studio yet (the calculator has one). |
| App bar, left panel, viewport, inspector | Complete | |
| Sidebar with Dashboard … Validation (12 modules) | Missing | Two workspaces exist today. Modules without a backend are deliberately not shown. |
| Command palette | Missing | |
| Bottom workspace (logs, tables) | Missing | Results are in the right-hand panel. |
| Autosave | Missing | Saving is explicit (download). The unsaved-changes guard is complete. |
| Undo/redo for every edit | Complete | `studio/src/core/history.ts`, covering geometry, environment and mooring. |

## §4–5 Geometry studio and import

| Feature | Status | Notes |
|---|---|---|
| Parametric cylinders and spheres, gizmo move, numeric editing | Complete | |
| Rhino `.3dm` import (units, layers, recognised cylinders/spheres, report of skipped objects) | Complete | `studio/src/core/rhinoImport.ts` |
| Imported meshes | Partial | Display only; refused for analysis (`studio/src/core/commands.ts:122`). |
| OBJ, STL, glTF, STEP, IGES import | Missing | |
| Analysis-readiness workflow (watertightness, normals, waterline cut, panel quality) | Missing | |

## §6 Mooring Systems

| Feature | Status | Where / notes |
|---|---|---|
| Elastic catenary with seabed contact; slack and vertical regimes | Complete | `studio/src/core/mooring/catenary.ts`. Compared against MoorPy. |
| Line library with provenance (6 materials, MoorPy scaling) | Complete | `library.ts`. Marked "generic, not manufacturer data". Edited values are marked "User-defined values". |
| Multi-line equilibrium (surge, sway, yaw) under a steady load | Complete | `system.ts`. Heave, roll and pitch are held. |
| 6×6 stiffness matrix | Partial | Finite differences. Single-line terms are checked against MoorPy; the coupled rotational terms are not compared yet. |
| Safety study: intact plus each single-line failure, SF = MBL/T, criteria, offset limit, station-keeping loss | Complete | `safety.ts`. API RP 2SK quasi-static defaults, configurable and labelled as screening values. |
| Anchor uplift check (drag anchors) | Complete | |
| Anchor holding capacity | Missing | |
| Visual designer: spread generator, add/remove lines, edit anchors, fairleads, lines and line types | Complete | `studio/src/ui/MooringPanels.tsx`, `core/mooringCommands.ts` |
| 3-D lines at equilibrium coloured by tension, click selection | Complete | `studio/src/viewport/Viewport.ts` |
| Tension–offset chart and result tables | Complete | |
| "Use mean environmental load" from the load analysis | Complete | Excludes second-order wave drift, which is not computed; the UI says so. |
| Multi-segment lines, clump weights, buoys | Missing | |
| Seabed friction, sloped bathymetry | Missing | An anchor off the nominal seabed gives a warning. |
| Dynamic analysis (MoorDyn), fatigue | Missing | |

## §7 Hydrodynamics

| Feature | Status | Notes |
|---|---|---|
| Airy and Stokes 5th regular waves, current profiles | Complete | +x heading only, no Doppler shift (`js/morison.js:41`). |
| Morison loads (relative velocity, Wheeler stretching), wind, overturning moments | Complete | Engine 1.1.0 |
| MacCamy–Fuchs diffraction (cylinders) | Complete | |
| Irregular seas (spectra), directional seas | Missing | |
| BEM radiation/diffraction (Capytaine), RAOs, motions | Missing | |
| Second-order wave drift | Missing | |

## §8 Structure and stability

| Feature | Status | Notes |
|---|---|---|
| Heave natural-period screening | Partial | The added-mass estimate is not validated. |
| General hydrostatics (mesh), GZ curves, intact or damaged stability | Missing | |
| Structural analysis (beam/FEM) | Missing | |

## §9 Optimization lab

| Feature | Status |
|---|---|
| Parametric sweeps and optimisation | Missing |

## §10–12 Architecture, testing and reports

| Feature | Status | Notes |
|---|---|---|
| Computation in Web Workers (calculator, studio, import) | Complete | |
| Versioned project schema with migration (v1 → v2) | Complete | `studio/src/core/project.ts` |
| Unit, e2e, desktop and visual tests in CI | Complete | `.github/workflows` |
| CSV/JSON/PDF export (calculator) | Complete | |
| Studio reports (mooring/loads PDF) | Missing | |

# VENTIX Offshore Studio — Audit (Milestone 0)

Audit date: 2026-10-10, branch `claude/e-cuvhh9`. It starts at commit `7e47f3d`
(desktop release v0.6.0); later commits record the fixes. This file continues
the Phase 1 engineering audit (`docs/ENGINEERING_AUDIT.md`, defects D-01…D-19,
A-01…A-09, all fixed and tested) and does not repeat it.

Every finding gives the file and line, the evidence, a severity and the current
status. Line numbers refer to the tree at commit `870b569` or later, unless the
finding is about older code that has since been removed.

**Severity**
- **Critical**: wrong engineering output, or a feature that looks available but does nothing.
- **High**: a missing capability that users need for the stated purpose.
- **Medium**: a limitation that is disclosed but restricts use.
- **Low**: a presentation or maintenance issue.

## 1. Findings

| # | Area | Evidence | Severity | Status |
|---|---|---|---|---|
| M0-01 | Dead studio route | `home.html`, `index.html` and `standalone.html` linked to `studio/dist/index.html`. That file is a build output (`npm run build:studio`), not in git, so a clone or `npm run serve` gave a 404 and `file://` gave a blank page. | Critical | **Fixed** in `5cffc62`. `js/studioLink.js:36-37` detects the missing build (HEAD request, or `file:`) and disables the links with an inline explanation. `npm start` now builds the studio first (`package.json` `start`). Tested by `tests/e2e/route.spec.js` (2 tests). |
| M0-02 | Mooring | No mooring code anywhere in the repository before `7bb6742`; `docs/VALIDATION_MATRIX.md` listed it as "N". | High | **Fixed (quasi-static scope)** in `7bb6742` and `870b569`. `studio/src/core/mooring/*` and the Mooring workspace, compared against MoorPy 1.3.0 (see §2). Dynamic analysis is still open (M0-11). |
| M0-03 | Overturning moments | The engine reported forces only. A platform or foundation designer needs the overturning moment, and the wind moment arm was not computed. | High | **Fixed** in `5cffc62`. `js/morison.js:34` (engine 1.1.0) adds `windLoad` (`:129`), `transferMoment` (`:156`) and `peakMoment` (`:317`, `:337`), shown as a new calculator tile. Closed-form tests are in `tests/unit/moments.test.js`. |
| M0-04 | Motion | Every body is fixed. There is no RAO, motion or coupled response, so mooring offsets are quasi-static only. | High | **Open, disclosed.** `js/morison.js:41` assumptions, studio caption `studio/src/App.tsx:425`, and `studio/src/core/mooring/system.ts:10-11` (heave, roll and pitch held). |
| M0-05 | Wave heading | Waves travel only in +x and T is the intrinsic period (no Doppler shift with current). | Medium | **Open, disclosed.** `js/morison.js:41`. |
| M0-06 | Diffraction | MacCamy–Fuchs is applied only to cylinders (`js/morison.js:219`). For D/λ > 0.2 the user gets a warning, not a solution (`js/validation.js:193`). There is no BEM (Capytaine). | Medium | **Open.** Verified within scope (`docs/VALIDATION_MATRIX.md`, Loads). |
| M0-07 | Hydrostatics | Heave screening only. A33 is an estimate model (`js/hydrostatics.js:4-17`). There are no GZ curves and no mesh hydrostatics. | Medium | **Open, disclosed** in the UI and exports (`js/export.js:61`). |
| M0-08 | Imported geometry | Imported meshes are display-only: `studio/src/core/commands.ts:122` refuses analysis. Only recognised Rhino cylinders and spheres can be analysed. | Medium | **Open, disclosed.** |
| M0-09 | Import formats | Only `.3dm` is accepted (`studio/src/ui/ImportPanel.tsx:29`). STEP, IGES, OBJ, STL and glTF are not implemented. | Medium | **Open.** |
| M0-10 | Sea states | Only regular waves. There are no spectra (JONSWAP/PM), no irregular time series and no directional seas. | Medium | **Open.** |
| M0-11 | Mooring dynamics | The mooring is quasi-static: single-segment lines, no clump weights or buoys, no seabed friction, no MoorDyn, no fatigue, no anchor capacity. | Medium | **Open, disclosed** in the results panel (`studio/src/ui/MooringPanels.tsx`, method note) and in the validation matrix. |
| M0-12 | Mooring safety study | During development, losing the windward line let the platform drift about 398 m past the remaining anchors, and this was reported as a pass. | Critical (found before release) | **Fixed** before commit: `studio/src/core/mooring/safety.ts` flags "Station keeping lost" when a line reverses or the platform crosses an anchor along the load. Tested in `tests/unit/studio/mooring.test.ts` (tests 16 and 17) and `tests/e2e/mooring.spec.js`. |
| M0-13 | Over-tensioned "equilibrium" | A force balance found with a line tension above its MBL is physically impossible, but would have been reported as converged. | Critical (found before release) | **Fixed** before commit: `solveEquilibrium` returns `ok: false` when any line is above its MBL (`studio/src/core/mooring/system.ts:214`). Tested by "impossible demand is reported" and the e2e "impossible line" test. |
| M0-14 | Product shell | The studio has two workspaces (Geometry & loads, Mooring). The full sidebar from the brief (Dashboard … Validation), the command palette and autosave are not built. `localStorage` is not used in `studio/src`, so there is no autosave. | Low | **Open.** Planned (FEATURE_MATRIX §Shell). The current UI has no dead routes or buttons that do nothing. |
| M0-15 | Group velocity | Group velocity had no test. | Low | **Fixed** in `5cffc62`: `tests/unit/groupVelocity.test.js`, with Cg = dω/dk to 1e-7 plus the deep and shallow limits. |

## 2. Re-verification of existing modules

All checks run on 2026-10-10 with Node 22 and Chromium (Playwright 1.56).

| Module | What was re-checked | Result |
|---|---|---|
| Dispersion and Airy | residuals, limits, thesis example | pass (`dispersion`, `airy`) |
| Stokes 5th | KFSBC and DFSBC residual order λ⁶, small-amplitude limit, non-convergence error | pass (`stokes`) |
| Morison | closed-form I₁ and I₂, quadrature convergence, current, relative velocity | pass (`morison`, `engine`) |
| MacCamy–Fuchs | closed-form total force, phase lead, drag unchanged | pass (`engine`, `diffraction`) |
| Hydrostatics and heave | waterplane, spherical cap, report structure | pass (`heave`); the A33 model is still an estimate (M0-07) |
| Geometry (studio) | cylinder and sphere fits, tessellation, units | pass (`studio/fit`, `studio/rhinoImport`) |
| Validation layer | breaking, Ursell, D/λ, overlaps | pass (`validation`) |
| Moments (new) | seabed moment against the closed form, transfer, wind lever arm | pass (`moments`) |
| Mooring (new) | 17 tests against MoorPy and analytical results | pass (`studio/mooring`) |

Totals: `npm test` **148 / 148** pass, `npx playwright test` **36 / 36** pass,
and the desktop tests `playwright -c playwright.electron.config.js` **7 / 7** pass.

## 3. Mandatory benchmarks A–M (brief §2.6)

Each row names the test file in `tests/unit` that runs the benchmark, and why
its tolerance is acceptable.

| ID | Benchmark (brief) | Test | Tolerance and why | Status |
|---|---|---|---|---|
| A | Dispersion residual ω² = gk tanh kh | `dispersion` | 1e-12 relative: Newton to machine precision | Verified (analytical) |
| B | Deep-water Airy u → aω e^{kz} | `airy` ("deep water…", "extreme kh") | 1e-9: the exact deep-water form, rounding only | Verified (analytical) |
| C | Small-amplitude Stokes → Airy | `stokes` | 0.2 % of amplitude: the residual is O(kH) at the H tested | Verified (analytical) |
| D | Morison drag-only and inertia-only | `morison` (closed-form I₁, I₂) | 1e-12: Gauss–Legendre is exact for the integrands | Verified (analytical) |
| E | Integrated loads on uniform cylindrical sections | `morison`, `engine` (MacCamy–Fuchs closed form), `moments` | 1e-10 to 1e-12 | Verified (analytical) |
| F | Buoyancy of fully and partially submerged analytical shapes | `buoyancy` (new), `heave` | 1e-9 against an independent section-area integration | Verified (analytical) |
| G | Cancellation or summation of symmetric forces | `morison` (superposition), `moments` (pair λ/2 apart), `studio/mooring` (zero-load return) | 1e-6 to 1e-9 | Verified (analytical) |
| H | Deep-water numerical stability | `airy` (kh ≈ 5000 stays finite and monotone) | finite, 1e-9 | Verified |
| I | Invalid input and non-convergence | `dispersion`, `stokes`, `validation`, `studio/project`, `studio/mooring` ("invalid inputs are refused", "impossible demand") | behaviour (an error, never a result) | Verified (behaviour) |
| J | Mesh refinement and integration convergence | `engine` (6×8 vs 24×8 Gauss points, moving surface) | 1e-6 self-convergence | Verified for strip integration. **No mesh solver exists**, so there is no mesh-refinement study yet. |
| K | Time-step convergence for dynamic simulations | `engine` (refined peak against sampling density) | 1e-9 | Verified for the load time history only. **No dynamic simulation exists** (motions, MoorDyn), so this is open for dynamics. |
| L | Force and moment reference-point transformation | `moments` (seabed ↔ SWL transfer) | 1e-10 | Verified (analytical) |
| M | Mooring equilibrium and analytical catenary | `studio/mooring` (17 tests, MoorPy 1.3.0 reference) | 1e-6 against MoorPy; 1e-4 for finite-difference stiffness | Verified (analytical) and compared with an independent implementation |

No benchmark value in this repository is estimated or typed in by hand. Each
one comes from a test that runs in CI (`npm test`). The MoorPy reference
values are generated by `scripts/mooring-reference.py`, which can be re-run.

### Validation state by solver (brief §2.7)

| Solver | State |
|---|---|
| Wave kinematics (Airy, Stokes 5th) | Verified against analytical test cases |
| Morison loads, wind, moments | Verified against analytical test cases; the array sweep reproduces the thesis tables (same method) |
| MacCamy–Fuchs diffraction (cylinders) | Verified against analytical test cases; compared against an independent Bessel implementation |
| Heave screening (A33 estimate) | Experimental / unverified (the model choice is not validated) |
| Quasi-static mooring | Verified against analytical test cases; compared against an independent reference implementation (MoorPy) |
| Any solver against experimental measurements | None. No module is validated against model tests or field data. |

Nothing here is design-certified.

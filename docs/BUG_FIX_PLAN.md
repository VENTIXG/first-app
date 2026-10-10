# Bug-Fix Plan — Phase 1

Every fix is driven by a failing test registered before the change
(`todo: '<ID>'` in `tests/unit`). A fix is complete when the `todo` flag is removed
and the test passes. **"Result change"** states whether numbers shown to the user change;
such changes are listed in the changelog section at the end, never applied silently.

## Execution order

1. Numerical core (no UI impact): D-16, D-10, D-01, D-05 → new `bessel.js`, `quadrature.js`
2. Geometry + validation layer: D-07, D-08, D-17, D-18, D-09
3. Engine corrections: D-03 (exact MacCamy–Fuchs), D-11, D-12, D-13, D-06, D-02
4. `standalone.html`: D-04, D-05, D-19
5. Application hardening: A-01 … A-11, D-14, D-15
6. Browser tests, documentation (A-12)

## Plan per defect

| ID | Fix | Files | Test | Result change |
|---|---|---|---|---|
| D-01 | Replace C2 with the Fenton-derived expression; keep residual-scaling test as permanent verification | `waveTheory.js` | `stokes.test.js` DFSBC ratio > 55 at kh = 0.6–4 | Yes, small (≤0.03 % in c for valid cases) |
| D-02 | Unconverged Stokes ⇒ `ok: false` with error; UI shows the error and no numbers | `waveTheory.js`, `morison.js`, `main.js` | `stokes.test.js` non-convergence | Yes: invalid results no longer shown |
| D-03 | Delete the empirical factor. New `diffraction.js`: exact MacCamy–Fuchs ratio C_M(ka)/2 and phase lag δ applied to the **inertia term only**; per harmonic for Stokes (ka_n = n·ka), labelled as an approximation there; cylinders only | `diffraction.js`, `bessel.js`, `morison.js` | small-ka limit, full-depth closed form, phase | Yes: inertia changes (±2–7 % at ka < 0.5, large reduction at ka > 1); drag no longer scaled |
| D-04 | Use sin(θ+δ) in the MF branch | `standalone.html` | `standalone.test.js` phase | Yes, when D/λ > 0.2 |
| D-05 | Accurate Y1 (series ≤ 12, Hankel asymptotic > 12) in both apps | `bessel.js`, `standalone.html` | A&S table to 1e-9 | Negligible |
| D-06 | Heave **screening**: report M, A33, C33 separately; A33 = (4/3)ρR³ (cylinder, one-sided disk), ½ρ∇ (sphere); damping and excitation explicitly `null`; screening band uses T₃ with and without added mass; wording "potential resonance — requires motion analysis" | `hydrostatics.js`, `morison.js`, `main.js` | `heave.test.js` | Yes: default T₃ 12.7 s → 9.25 s (flags potential resonance at T = 9 s) |
| D-07 | Exact spherical-cap hydrostatics; sphere draft must satisfy 0 < d ≤ 2R; 3-slice Morison model kept (thesis method) but warns when d ≠ R; optional exact-section model | `geometry.js`, `validation.js`, `morison.js` | `heave.test.js`, `validation.test.js` | Yes for spheres with d ≠ R |
| D-08 | `validation.js`: finite/positive checks, draft ≤ depth, overlap, coefficient ranges; engine returns `{ok:false, errors}` | `validation.js`, `morison.js` | `validation.test.js` | Invalid input no longer computed |
| D-09 | Per-body warning D/λ > 0.2 (and > 0.5 for truncated cylinders / spheres) | `validation.js` | `validation.test.js` | Warning only |
| D-10 | Stable exponential forms for the hyperbolic ratios; no effective-depth cap for Airy | `waveTheory.js` | `airy.test.js` deep-water decay | Negligible |
| D-11 | Gauss–Legendre strips (configurable panels), golden-section peak refinement; option to integrate to the instantaneous surface (Wheeler stretching for Airy; Stokes kinematics to η); warning when Stokes is truncated at SWL; default stays SWL for continuity | `quadrature.js`, `morison.js` | closed forms to 1e-6; convergence test | Yes, ~1e-4 (accuracy improvement); surface option opt-in |
| D-12 | Per-body `freeboard`; exact power-law integral for cylinders; Gauss–Legendre over the spherical cap for spheres; 3-D uses the same freeboard; scenario migration maps old `h_exp` | `geometry.js`, `morison.js`, `state.js`, `viz3d.js` | `wind.test.js` | Yes (wind) |
| D-13 | Kinematic viscosity an environment input, default 1.19e-6 m²/s (seawater ~15 °C) | `state.js`, `morison.js` | dimensionless test | Re display only |
| D-14 | Relabel array factor: "1 = all in phase; < 1 = phase cancellation" | `main.js` | e2e | Label only |
| D-15 | Bodies drawn fixed (consistent with the analysis); caption states it | `viz3d.js`, `index.html` | e2e | Visual only |
| D-16 | `RangeError` on invalid input; `solveDispersionDetailed` returns residual and iterations | `waveTheory.js` | `dispersion.test.js` | No |
| D-17 | Breaking ⇒ error (no results) | `validation.js` | `validation.test.js` | Yes: impossible waves rejected |
| D-18 | Ursell number: Stokes 5th error for U_R > 40, Airy warning for U_R > 26 (heuristic, labelled) | `validation.js` | `validation.test.js` | Stokes cases beyond U_R 40 rejected |
| D-19 | Show a visible error instead of clamping | `standalone.html` | `standalone.test.js` | Yes (no silent change) |
| A-01 | Build all user-derived DOM with `textContent` / `createElement`; never interpolate stored strings into `innerHTML` | `main.js`, `charts.js` | e2e injection test | No |
| A-02 | Versioned scenario schema (`schemaVersion: 1`), `parseSnapshot` with type/range/enum checks, migration from v0 (`h_exp` → body freeboard); invalid snapshot throws and leaves state unchanged | `state.js` | `scenarios.test.js` | No |
| A-03 | `saveScenario` throws on storage failure; UI reports it | `scenarios.js`, `main.js` | `scenarios.test.js` | No |
| A-04 | Paginated PDF (page breaks for tables and chart), assumptions and validity sections | `export.js` | e2e page count | No |
| A-05 | `exportPDF` distinguishes missing library from other failures | `export.js`, `main.js` | e2e | No |
| A-06 | `try/catch` around exports with a visible message | `main.js` | e2e | No |
| A-07 | Re-fit the camera only when the body layout changes | `viz3d.js` | manual/e2e | No |
| A-08 | Coalesce recalculation to one per animation frame | `main.js` | e2e | No |
| A-09 | Prebuilt static Tailwind CSS (`npm run build:css`), committed | `css/`, `index.html` | e2e (offline styling) | No |
| A-10 | `try/catch` around compute; error shown | `main.js` | e2e | No |
| A-11 | "Add body" copies the previous body's geometry | `main.js` | e2e | No |
| A-12 | Rewrite README for the current app, assumptions and tests | `README.md` | — | — |
| A-13 | Add a deprecation notice to `legacy/` | `legacy/README.md` | — | — |

## Deliberately not changed in Phase 1

- Default integration limit stays at the still-water level (preserves existing
  results); the instantaneous-surface option is opt-in and recommended for Stokes 5th.
- The thesis 3-slice sphere model stays the default sphere model (user-specified method).
- No wave–current interaction (Doppler) — documented limitation L-03, roadmap Phase 6.

## Status

All defects D-01 … D-19 and A-01 … A-13 are fixed; no `todo` test remains.

| Commit | Content |
|---|---|
| `e2e63f9` | Test harness and baseline characterization tests (defects registered as `todo`) |
| `498bf22` | Engineering documents |
| `1fd610a` | Physics: D-01 … D-19 (engine, wave theory, diffraction, geometry, validation, heave, `standalone.html`) |
| `c8d1b0b` | Tooling: static CSS (A-09), dev server, pinned dev dependencies |
| `838ae86` | Application: A-01 … A-08, A-10, A-11, D-14, D-15 |
| `63ce92e` | Browser tests |
| `d94577e` | Engine speed-up with identical results (fixed nodes evaluated once) |
| *(this commit)* | README (A-12), `legacy/README.md` (A-13), CI, documentation of results |

## Changelog of result-affecting fixes

Measured with the baseline engine (`e2e63f9`) and the Phase 1 engine on the
same inputs (H = 4 m, T = 9 s, h = 40 m, U_c = 0.8 m/s power-law current,
wind 20 m/s, C_d = 1, C_m = 2, MacCamy–Fuchs on, integration to SWL, unless
stated). Global peak is the peak base shear including wind.

| Case | Quantity | Before | After | Cause |
|---|---|---|---|---|
| Default platform (2 × D 6 m, draft 20 m, 60 m apart, Airy) | global peak | 261.04 kN | 262.55 kN | D-03 (exact MF on inertia only, drag no longer scaled), D-11 (Gauss–Legendre + peak refinement), D-12 |
| | peak inertia / drag (summed) | 45.59 / 175.95 kN | 46.55 / 176.58 kN | D-03, D-11 |
| | wind | 39.53 kN | 39.42 kN | D-12: exact profile integral over each body's freeboard (15 m) |
| | heave T₃ | 12.69 s | 9.25 s | D-06: A33 (4/3)ρR³ instead of ρ∇; **T = 9 s is now flagged as a potential heave resonance** |
| Same, Stokes 5th | global peak | 286.19 kN | 289.83 kN | D-01, D-03 (per-harmonic MF), D-11 |
| Single cylinder D 20 m, draft 20 m, T = 7 s (ka ≈ 0.82) | global peak | 8968.06 kN | 8643.11 kN | D-03 |
| | peak inertia / drag | 8795.34 / 512.56 kN | 8334.32 / 598.04 kN | D-03: the empirical factor reduced the drag as well |
| Single sphere R 5 m, draft 5 m | global peak | 537.14 kN | 516.92 kN | D-12 wind (below), D-11 |
| | wind | 32.94 kN | 6.43 kN | D-12: the global 15 m "exposed height" was applied to a sphere whose top is 5 m above SWL |

Other changes visible to users:

- **Results withheld instead of shown** for impossible or out-of-validity inputs:
  draft > depth, sphere draft > 2R, overlapping bodies, non-finite or negative
  inputs, depth- or steepness-limited breaking, Stokes 5th not converged or
  Ursell number > 40 (D-02, D-07, D-08, D-17, D-18).
- `standalone.html`: the MacCamy–Fuchs force in the array study now has the
  correct phase (D-04), so its combined peaks change whenever D/λ > 0.2.
- Reynolds numbers are about 16 % lower (ν 1.0e-6 → 1.19e-6 m²/s, D-13).
- Engine speed-up `d94577e`: no numerical change (all 1e-12 checks unchanged,
  default peak identical to the last digit).

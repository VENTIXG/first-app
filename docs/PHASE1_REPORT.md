# Phase 1 Report: Audit, correct and harden

Branch `claude/e-cuvhh9`, starting point `ab5bbd0`. Commits are listed in
`BUG_FIX_PLAN.md` § Status.

## 1. Summary

The audit (`ENGINEERING_AUDIT.md`) found 19 physics/geometry defects (D-01 … D-19)
and 13 application defects (A-01 … A-13). Each was first captured by a failing
test registered as `todo`, then fixed. All are now fixed and no `todo` remains.
The most consequential were these:

- the "MacCamy–Fuchs correction" was an empirical curve that also scaled the drag
  (D-03); it is replaced by the exact MacCamy–Fuchs coefficient and phase, on the
  inertia term only, verified against the closed-form force to 1e-12;
- the Stokes 5th dispersion coefficient C2 was wrong at finite depth (D-01);
  it is now verified by the free-surface boundary-condition residual scaling as λ⁶;
- the heave added mass was taken as the displaced mass (D-06): 1159 t instead of
  about 74 t for the default platform, which hid a potential resonance at T = 9 s;
- impossible inputs (draft below the seabed, breaking waves, unconverged Stokes)
  were computed and displayed (D-02, D-08, D-17); they are now rejected with an
  explanation and no numbers;
- user strings were parsed as HTML (A-01), and scenario loads were not validated (A-02).

## 2. Modified and added files

| Area | Files |
|---|---|
| Physics (new) | `js/bessel.js`, `js/quadrature.js`, `js/diffraction.js`, `js/geometry.js`, `js/validation.js`, `js/hydrostatics.js` |
| Physics (rewritten) | `js/waveTheory.js`, `js/morison.js` |
| State and storage | `js/state.js` (schema v1 + v0 migration), `js/scenarios.js` |
| UI | `index.html`, `js/main.js`, `js/charts.js`, `js/viz3d.js`, `js/export.js`, `css/` (static Tailwind build) |
| Offline app | `standalone.html` (D-04, D-05, D-19) |
| Tooling | `package.json`, `package-lock.json`, `tailwind.config.cjs`, `playwright.config.js`, `scripts/serve.mjs`, `scripts/bench.mjs`, `.github/workflows/ci.yml`, `.gitignore` |
| Tests | `tests/unit/*.test.js` (13 files), `tests/helpers/*` (independent reference code), `tests/e2e/*` (5 files + visual baselines) |
| Documentation | `README.md`, `legacy/README.md`, `docs/*.md` |

## 3. Architectural decisions

1. **Physics is separated from the UI and the graphics.** Physics modules import
   nothing from the DOM, three.js or Plotly, and run unchanged in Node (tests,
   benchmark) and later in Web Workers.
2. **Validation is a separate layer** (`validation.js`) that returns structured
   issues `{severity, code, message, bodyId?}`. The engine refuses to produce force
   numbers when any error is present (`ok: false`); the UI renders issues next
   to the inputs that cause them.
3. **Fixed-body analysis is stated everywhere.** The 3-D view no longer moves
   bodies with the surface. The relative-velocity Morison form exists
   (`morisonStripForce`) for a future motion solver but is not used.
4. **Diffraction correction is restricted to where it is defined:** cylinders,
   inertia term, per harmonic for Stokes (flagged as an approximation).
5. **Heave is a screening estimate**, with mass, added mass and stiffness reported
   separately; damping and excitation are explicitly `null`; the result is worded
   as "potential resonance — requires a motion analysis".
6. **Versioned scenario schema** (v1) with validation on load and migration
   from v0, so stored data cannot inject markup or break the state.
7. **Numerics:** composite Gauss–Legendre over the wetted length and
   golden-section refinement of every peak; depth factors at fixed nodes are
   evaluated once (`velocityAmplitudes`) for speed without changing results.
8. **No build step for the classic app** (static Tailwind CSS is prebuilt and
   committed); the CDN libraries are optional and their absence is reported.

## 4. Install and run

```bash
npm install
npm run serve            # http://localhost:8000/index.html
npm test                 # unit and verification tests
npx playwright install chromium   # or: export PW_CHROMIUM_PATH=/path/to/chromium
npm run test:e2e         # browser tests
npm run bench            # engine timings
```

Node.js 22 or later.

## 5. Test results (executed 2026-10-10, Node 22.22.0, Playwright 1.56.0, Chromium)

- `npm test`: **82 tests, 82 pass, 0 fail, 0 todo**.
- `npm run test:e2e`: **19 tests, 19 pass** (17 functional + 2 visual).
- Coverage by module, method, reference and tolerance: `VALIDATION_MATRIX.md`.
- CI (`.github/workflows/ci.yml`) runs the unit tests, a CSS-build check and the
  browser tests except the host-specific visual baselines. **It had not yet run on
  GitHub when this report was written.**

## 6. Benchmarks

`npm run bench`, same container (Node 22.22.0, linux/x64), mean wall-clock time
of one complete analysis (200 samples per period, 6×8 Gauss–Legendre points,
all peaks refined):

| Case | Baseline engine (`e2e63f9`) | Phase 1 engine |
|---|---|---|
| default platform, Airy, SWL | 1.4–1.7 ms | 1.4–1.7 ms |
| 2 bodies, Stokes 5th, SWL | — | 1.8–2.9 ms |
| 2 bodies, Stokes 5th, instantaneous surface | — | 18–22 ms |
| 10 bodies, Airy, SWL | — | 4.5–5.4 ms |
| 50 bodies, Airy, SWL | — | 24–25 ms |
| 50 bodies, Airy, instantaneous surface (Wheeler) | — | 375 ms |
| 50 bodies, Stokes 5th, instantaneous surface | — | 450–540 ms |

Ranges are the spread between runs. Before the `d94577e` optimisation the
Phase 1 engine took 16.7 ms for the default platform and 304 ms for 50 bodies (SWL).

## 7. Changes in results

See `BUG_FIX_PLAN.md` § Changelog. Default platform: global peak 261.04 → 262.55 kN,
wind 39.53 → 39.42 kN, heave T₃ 12.69 → 9.25 s (potential resonance now flagged).

## 8. Existing functionality

Verified by the browser suite: multi-body editing, wave theories, charts (Plotly
and the SVG fallback), 3-D view, scenarios (save/load/delete, including legacy
scenarios), CSV, PDF and the new JSON export, dark/light theme, offline operation.
`standalone.html` keeps its array study (thesis Table 6 reproduced).

## 9. Unresolved issues and limitations

- **Not validated against measurements.** Verification is analytical and numerical only.
- Fixed bodies only; no motion response, radiation damping or wave excitation.
- No wave–current interaction; T is the intrinsic period.
- Regular, unidirectional waves travelling in +x only.
- No hydrodynamic interaction between bodies (shielding, blockage, trapped modes).
- One C_d and C_m for all bodies; no KC/Re/roughness dependence.
- MacCamy–Fuchs on truncated cylinders and per Stokes harmonic is an approximation (flagged).
- Breaking and applicability limits (H/h 0.78, Miche, Ursell 26/40) are screening
  criteria from the literature, not guarantees.
- Instantaneous-surface integration is slow for many bodies (≈ 0.5 s for 50 bodies);
  computation runs on the main thread until the Web Worker of Phase 2.
- Display units are SI only (viscosity shown in mm²/s).
- Plotly, three.js and jsPDF still come from CDNs without subresource integrity.
- Dependency audit (`npm audit`, 2026-10-10): jsPDF upgraded 2.5.2 → 4.2.1 after the
  close-out, which clears its published advisories (the app used none of the affected
  features: AcroForms, addJS, html(), file loading, new-window output). Remaining
  advisories are in the Tailwind 3 build chain (braces/micromatch, denial of
  service from crafted glob patterns): build-time only, run on this repository's own
  configuration, nothing shipped. Upgrading to Tailwind 4 is a migration, deferred.
- Visual baselines are host-specific and are not run in CI.

## 10. Unsupported features (not implemented, and not presented as available)

CAD import, mesh hydrostatics and stability, irregular seas, BEM/RAOs, mooring,
structural analysis, optimisation, environmental statistics. See `DEVELOPMENT_ROADMAP.md`.

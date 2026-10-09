# Current Architecture (as audited, pre-Phase 1)

Snapshot of the repository at commit `ab5bbd0` (audit baseline), before any
Phase 1 changes. Later documents describe what changed and why.

## 1. What the repository contains

| Path | Role | Status |
|---|---|---|
| `index.html` + `js/` | **Primary app**: multi-body Morison platform solver (ES modules, no build step) | Active |
| `standalone.html` | Older single-file offline app (v4): strip Morison, MacCamy–Fuchs (Bessel), thesis array frequency sweep, canvas 3-D view | Active, self-contained |
| `legacy/index.html`, `legacy/physics.js` | First single-body version | Deprecated, not linked |
| `methodologia-morison.md` | Greek-language extraction of the thesis Part A Morison methodology (§3.1.1–3.1.8) incl. Table 6 | Reference |
| `README.md` | User documentation | Out of date at audit time (described the single-body version) |

There was no `package.json`, no build, no tests and no CI at the audit baseline.

## 2. Runtime model

- Static files served over HTTP (`python3 -m http.server`); ES modules require
  HTTP, `file://` does not work.
- Third-party libraries loaded from CDNs at runtime:

| Library | Source | Failure behaviour at audit |
|---|---|---|
| Tailwind CSS | `cdn.tailwindcss.com` (Play CDN — a runtime JIT compiler, not intended for production) | App renders unstyled |
| three.js 0.160 | jsDelivr ES module, dynamic `import()` | 3-D panel shows a notice; rest works |
| Plotly 2.35.2 | `cdn.plot.ly` | Falls back to built-in SVG chart |
| jsPDF 2.5.2 | jsDelivr UMD | PDF export unavailable |

## 3. Module structure (`js/`)

```
main.js        Entry. Builds sidebar (environment schema + body manager), result
               tiles, warnings, chart selector; wires events -> AppState -> compute -> render.
state.js       AppState: environment object + bodies[] + results; pub/sub events
               env:changed / bodies:changed(reason) / results:changed. makeBody(), bodyRadius().
waveTheory.js  Dispersion (Newton), Airy & Stokes 5th (Skjelbreia–Hendrickson) wave
               preparation, kinematics(z,t,wp,x), surfaceElevation, breaking checks.
morison.js     computePlatform(env, bodies): per-body strip-integrated Morison over 200
               time samples, spatial phase k·x, current profiles, wind, heave estimate.
charts.js      Plotly renderer with SVG fallback; chartSnapshot() for PDF.
viz3d.js       three.js scene: water plane (CPU vertex displacement), bodies, force arrows.
export.js      CSV + one-page jsPDF report.
scenarios.js   Named snapshots in localStorage.
```

Dependency direction: `main → {state, morison, charts, export, scenarios, viz3d}`,
`morison → {waveTheory, state}`, `export → charts`, `viz3d → {waveTheory, state, three}`.
Physics modules contain no DOM access (they import `bodyRadius` from `state.js`,
which is itself DOM-free).

## 4. Data model

```js
environment = { H, T, h, waveTheory: 'airy'|'stokes5',
                U_c, currentProfile: 'uniform'|'power17'|'log',
                V_wind, windRef, windBeta, Cd_air, h_exp,
                Cd, Cm, useMacCamy, rho, rho_air }
bodies[i]   = { id, type: 'cylinder'|'sphere', x, y, diameter, radius, draft }
```

Units are SI throughout (m, s, kg, N). Forces are displayed in kN.
Scenario snapshots are `{ environment, bodies }` with no schema version.

## 5. Computational pipeline (`computePlatform`)

1. `prepareWave`: k from linear dispersion (Airy) or coupled (k, λ) iteration (Stokes 5th).
2. Per body: strips (24 midpoint strips for cylinders; sphere = 3 slices × 8 sub-strips),
   current at each strip, coefficient "MacCamy–Fuchs" factor, steady wind force,
   displaced volume and waterplane area.
3. Time loop, 200 samples over one period: for each body and strip, kinematics at the
   body's x (phase θ = k·x − ωt), Morison drag `½ρC_dD|u+U|(u+U)dz` and inertia
   `ρC_mA u̇ dz`; per-body and global sums.
4. Peaks / RMS from the samples; KC, Re, ka at mid-draft; array factor; heave
   natural period; breaking checks.

Integration is always from −draft to the still-water level; bodies are fixed (no motion).

## 6. UI

Tailwind dashboard: sidebar (body manager, environment groups, scenarios,
exports), main area (warnings, 8 result tiles, 3-D twin, force chart with
global/per-body selector, per-body table). Dark mode via `.dark` class.

## 7. Persistence and export

- localStorage key `wfc-scenarios`: `{ name: { params: snapshot, savedAt } }`.
- CSV: time, global total/drag/inertia/wind, per-body totals (kN).
- PDF: single page (environment, results, warnings, per-body table, chart image).

## 8. `standalone.html` (separate code base)

Inline script (~760 lines). Own Bessel J0/J1/Y0/Y1 (rational approximations),
MacCamy–Fuchs applied only when D/λ > 0.2, Re-dependent C_d ("drag crisis" table),
DNV-style wind gust factors, 1/7-power current, fully submerged 6-slice spheres,
thesis 7-step array frequency sweep (linearised drag), 2-D canvas pseudo-3-D view.
No shared code with `js/`.

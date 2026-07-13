# 🌊 Wave Force Calculator

Interactive, client-side dashboard for wave and wind forces on floating
cylindrical structures — Morison equation, MacCamy–Fuchs diffraction,
Airy and **Stokes 5th order** wave theory, real-time 3D visualization.

## Running the app

The app uses ES6 modules, so it must be served over HTTP (opening
`index.html` via `file://` won't work in most browsers):

```bash
python3 -m http.server 8000
# open http://localhost:8000/index.html
```

Tailwind CSS, Plotly.js, three.js, and jsPDF load from CDNs, so an
internet connection is needed for full styling, interactive charts, 3D
view, and PDF export. Without a network the physics still runs and the
chart falls back to a built-in SVG renderer.

> `standalone.html` is the previous fully self-contained version (multi-body
> arrays, frequency sweep study) and works entirely offline.

## Features

- **Physics**
  - Morison drag + inertia, **strip-integrated over the draft** (24 strips)
  - **Airy (linear)** and **Stokes 5th order** (Skjelbreia–Hendrickson 1960)
    wave theories, selectable in the UI
  - **Current profiles**: uniform, or logarithmic with zero velocity at the bed
  - MacCamy–Fuchs diffraction correction for the ka regime
  - Wind drag on the exposed cylinder height
  - **Breaking-wave warnings**: depth-limited (H/h > 0.78) and steepness
    (Miche criterion), shown as a live banner
  - Dimensionless parameters: KC, Re, ka, wavelength
- **UI**
  - Tailwind CSS dashboard with persisted **dark/light mode**
  - **three.js 3D view**: animated water surface following the selected wave
    theory, floating cylinder riding the heave — drag to rotate, scroll to zoom
  - **Plotly.js** force time-series (drag / inertia / total) with unified
    hover tooltips
  - **Scenario save/load** via localStorage
  - **Export**: CSV time series and a one-page **PDF report** (jsPDF) with
    inputs, results, and a chart snapshot

## Architecture

```
index.html          Tailwind dashboard shell (sidebar inputs, tiles, 3D, chart)
js/
  main.js           Entry point: schema-driven UI, reactive render pipeline
  state.js          AppState — central store with pub/sub observer pattern
  waveTheory.js     Dispersion solver, Airy & Stokes 5th kinematics, breaking checks
  morison.js        Strip-integrated force engine, current profiles, KC/Re/ka
  charts.js         Plotly renderer + dependency-free SVG fallback
  viz3d.js          three.js scene (loaded dynamically; degrades gracefully)
  export.js         CSV download + jsPDF one-page report
  scenarios.js      Named parameter snapshots in localStorage
legacy/             Pre-refactor single-file version
standalone.html     Offline multi-body / array-study app (v4)
```

All inputs live in a single `AppState`; UI controls write to it, and the
calculation + render pipeline subscribes to change events — there is no
direct DOM-to-DOM coupling.

## Physics notes

- **Dispersion**: ω² = gk·tanh(kh), Newton–Raphson. For Stokes 5th the pair
  (k, λ) is solved from the coupled S&H equations so the specified H and T
  are reproduced exactly.
- **Stokes 5th kinematics**: u = c·Σₙ n·Dₙ·cosh(nk(z+h))·cos(n(kx−ωt)),
  with harmonic amplitudes from the S&H coefficient tables. Validated
  against Airy in the small-amplitude limit and against the 3rd-order
  deep-water dispersion correction.
- **Morison per strip**: dF = ½ρC_d·D·|u+u_c|(u+u_c)·dz + ρC_m·A·u̇·dz,
  summed over the submerged draft.
- **Log current profile**: u_c(z) = U_c·ln((z+h)/z₀)/ln(h/z₀), z₀ = 0.05 m.
- Very deep water uses an effective-depth cap (kh ≤ 25) where the kinematics
  depend only on the distance below the surface — this keeps cosh/sinh finite
  without changing the result.

## References

1. Morison, O'Brien, Johnson & Schaaf (1950), "The Force Exerted by Surface
   Waves on Piles"
2. MacCamy & Fuchs (1954), "Wave Forces on Piles: A Diffraction Theory"
3. Skjelbreia & Hendrickson (1960), "Fifth Order Gravity Wave Theory"
4. Sarpkaya & Isaacson (1981), "Mechanics of Wave Forces on Offshore Structures"
5. Miche (1944) breaking criterion; DNV-RP-C205 for validity regimes

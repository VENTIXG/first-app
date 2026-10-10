# Validation Matrix

**Status legend**

| Status | Meaning |
|---|---|
| **V-A** | Verified against an independent analytical result, limit or convergence property |
| **V-R** | Reproduces a published/reference table produced with the *same method* (method-consistency, not physical validation) |
| **V-X** | Cross-checked against an independent numerical implementation written for the test |
| **C** | Code-consistency / characterization only |
| **B** | Required behaviour tested (rejection, error reporting, UI); not an accuracy claim |
| **OPEN** | Known defect, test registered as `todo` |
| **N** | Not verified / not implemented |

Passing unit tests is not engineering validation. No module here has been
validated against model-scale or full-scale measurements.

## State at audit baseline (`e2e63f9`)

| Module | Quantity | Method | Reference | Tolerance | Status | Test |
|---|---|---|---|---|---|---|
| Dispersion | k(ω,h) | residual, deep/shallow limits | ω² = gk tanh kh | 1e-12 | V-A | `dispersion` |
| Dispersion | thesis example | value | methodologia §3.1.2 kd = 0.81724 | 2e-4 | V-R | `dispersion` |
| Dispersion | invalid input | rejection | — | — | OPEN D-16 | `dispersion` |
| Airy | u, u̇, η, phase | closed form, finite difference | linear theory | 1e-12 / 1e-6 | V-A | `airy` |
| Airy | deep-water decay | e^{kz} for all z | asymptotic | 1e-9 | OPEN D-10 | `airy` |
| Stokes 5th | Aᵢⱼ, Bᵢⱼ | KFSBC residual ∝ λ⁶ | free-surface BCs | ratio > 55 | V-A | `stokes` |
| Stokes 5th | dispersion C1, C2 | Bernoulli residual ∝ λ⁶ | free-surface BCs | ratio > 55 | OPEN D-01 | `stokes` |
| Stokes 5th | H reproduction, deep limits | identity / limits | S&H definitions | 1e-9 / 1e-6 | V-A | `stokes` |
| Stokes 5th | small-amplitude → Airy | limit | linear theory | 0.2 % | V-A | `stokes` |
| Stokes 5th | non-convergence handling | error state | — | — | OPEN D-02 | `stokes` |
| Morison | inertia/drag (truncated cylinder, SWL) | closed-form I₁, I₂ | analytical | 1e-3 (1e-6 OPEN D-11) | V-A | `morison` |
| Morison | drag with current | independent Simpson quadrature | numerical | 2e-3 | V-X | `morison` |
| Morison array | 7-cylinder sweep | thesis Table 6 | thesis (same method) | table rounding | V-R | `morison`, `standalone` |
| Morison array | time-domain vs \|Q\|C_FI | closed form | analytical | 1e-3 | V-A | `morison` |
| Superposition | in-phase / antiphase | identity | analytical | 1e-9 / 1e-6 | V-A | `morison` |
| Diffraction (js) | "MacCamy–Fuchs" factor | — | MacCamy–Fuchs (1954) | — | OPEN D-03 | — |
| Diffraction (standalone) | C_M → 2 (ka→0) | limit | MF asymptotics | 1e-3 | V-A | `standalone` |
| Diffraction (standalone) | force phase | projection | MF solution | 0.01 rad | OPEN D-04 | `standalone` |
| Bessel (standalone) | J0, J1, Y0 | table | A&S 9.1 | 1e-7 | V-R | `standalone` |
| Bessel (standalone) | Y1 | table | A&S 9.1 | 1e-7 | OPEN D-05 | `standalone` |
| Wind | cylinder power-law force | exact integral | analytical | 1 % (1e-12 OPEN D-12) | V-A | `wind` |
| Heave | waterplane area | geometry | analytical | 1e-9 | V-A | `heave` |
| Heave | added mass / T₃ | estimate model | Newman (1977) disk | — | OPEN D-06 | `heave` |
| Sphere | hydrostatics any draft | spherical cap | analytical | 1e-9 | OPEN D-07 | `heave` |
| Validation | geometry/inputs | rejection | — | — | OPEN D-08/D-07/D-17/D-09 | `validation` |
| Scenarios | round trip | identity | — | exact | C | `scenarios` |
| Scenarios | sanitisation / write failure | rejection | — | — | OPEN A-02/A-03 | `scenarios` |
| Browser E2E | workflows, injection, exports | Playwright | — | — | N | — |
| Hydrostatics (general) | — | — | — | — | N | — |
| Mooring | — | — | — | — | N | — |
| BEM / RAOs | — | — | — | — | N | — |

## State after Phase 1

Executed on 2026-10-10 (Node 22.22, Chromium via Playwright 1.56):
`npm test` **82 / 82 pass, 0 todo**; `npm run test:e2e` **19 / 19 pass**.
Tolerances are relative unless stated. "Test" names the file in `tests/unit`
(or `tests/e2e` for browser rows).

### Wave kinematics

| Quantity | Method | Reference | Tolerance | Status | Test |
|---|---|---|---|---|---|
| k(ω, h) | dispersion residual over shallow…deep grid | ω² = gk tanh kh | 1e-12 | V-A | `dispersion` |
| k(ω, h) | deep and shallow limits | k = ω²/g; c → √(gh) | 1e-12; 1e-3 (kh < 0.06) | V-A | `dispersion` |
| k(ω, h) | thesis worked example | methodologia §3.1.2, kd = 0.81724 | 2e-4 | V-R | `dispersion` |
| Dispersion | non-physical input | `RangeError` | — | B | `dispersion` |
| Airy u, u̇, η | closed form; central difference; phase kx − ωt | linear theory | 1e-12 / 1e-6 | V-A | `airy` |
| Airy, deep water | finite at kh ≈ 5000; amplitude = aωe^{kz} and monotone at every depth | asymptotic | 1e-9 | V-A (D-10 fixed) | `airy` |
| Stokes 5th KFSBC | residual scales as λ⁶, kh 0.6–4 | free-surface BCs | ratio > 55 | V-A | `stokes` |
| Stokes 5th DFSBC (C1, C2) | Bernoulli residual scales as λ⁶ | free-surface BCs | ratio > 55 | V-A (D-01 fixed) | `stokes` |
| Stokes 5th C1 | Fenton λ² term vs S&H C1 | identity | 1e-12 | V-A | `stokes` |
| Stokes 5th | H reproduction; deep-water coefficient limits | S&H definitions | 1e-9 / 1e-6 | V-A | `stokes` |
| Stokes 5th | small amplitude → Airy | linear theory | 0.2 % of amplitude | V-A | `stokes` |
| Stokes 5th | non-convergence | error, no result | — | B (D-02 fixed) | `stokes` |
| Wheeler stretching | surface − SWL difference vanishes as H → 0 | order: drag O(kH), inertia O((kH)²) | ±25 % of order | V-A | `engine` |

### Special functions and numerics

| Quantity | Method | Reference | Tolerance | Status | Test |
|---|---|---|---|---|---|
| J0, J1, Y0, Y1 | table, x = 1…8, 10 | A&S Table 9.1 | 1e-9 abs | V-R | `bessel` |
| J0, J1, Y0, Y1 | integral representations either side of x = 12 | numerical | 1e-9 (J), 1e-8 (Y) abs | V-X | `bessel` |
| J, Y | Wronskian J1Y0 − J0Y1 = 2/(πx), x = 0.01…100 | identity | 1e-10 | V-A | `bessel` |
| J1′, Y1′ | central differences | numerical | 1e-8 / 1e-7 | V-A | `bessel` |
| Gauss–Legendre | exact for degree 2n − 1; weights sum to 2 | identity | 1e-13 / 1e-14 abs | V-A | `quadrature` |
| Composite rule | e^x; cosh over a 25 m wetted length | analytical | 1e-12 abs; 1e-9 | V-A | `quadrature` |
| Golden-section peak | sinusoid: peak value; peak location | analytical | 1e-14; 1e-7 | V-A | `quadrature` |
| Quadrature convergence | 6×8 vs 24×8 points (SWL and moving surface) | self-convergence | 1e-6 | V-A | `engine` |
| Time-step convergence | refined peak vs sampling density | self-convergence | 1e-9 | V-A | `engine` |

### Loads

| Quantity | Method | Reference | Tolerance | Status | Test |
|---|---|---|---|---|---|
| Morison inertia (truncated cylinder, SWL) | closed-form I₁ | analytical | 1e-12 | V-A (D-11 fixed) | `morison` |
| Morison drag, no current | closed-form I₂ | analytical | 1e-12 | V-A | `morison` |
| Morison drag with current | Simpson quadrature, separate code | numerical | 2e-3 | V-X | `morison` |
| MacCamy–Fuchs total force, bottom-mounted cylinder, ka ≤ 1.13 | engine vs closed form 2ρgH tanh(kh)/(k²\|H1′\|) | MacCamy & Fuchs (1954) | 1e-12 | V-A (D-03 fixed) | `engine` |
| MacCamy–Fuchs | drag term unchanged | requirement | 1e-14 | V-A | `engine` |
| MacCamy–Fuchs | inertia phase lead = δ(ka) | MF solution | 1e-9 rad | V-A | `engine` |
| C_M(ka) | ka → 0 limit; small-argument asymptotic | MF asymptotics | 1e-4 / 2e-5 | V-A | `diffraction` |
| C_M(ka), δ | vs `standalone.html` (independent Bessel code) | numerical | 1e-6 | V-X | `diffraction` |
| Sphere, exact section | inertia vs Simpson reference, several drafts | numerical | 2e-5 | V-X | `engine` |
| Sphere, thesis 3-slice | equals exact model in long waves at draft = R | analytical limit | 1e-3 | V-A | `engine` |
| Relative-velocity Morison | co-moving body → Froude–Krylov only | analytical | 1e-9 | V-A | `engine` |
| Current profiles | surface value, zero at bed, constant above SWL | definition | 1e-12 | V-A | `engine` |
| Array, 7 cylinders, 15 frequencies | closed-form 7-step method | thesis Table 6 (same method) | table rounding | V-R | `morison`, `standalone` |
| Array, Cd = 0 | time domain vs \|Q\|·C_FI | analytical | 1e-12 | V-A | `morison` |
| Array, with drag | time domain vs linearised thesis \|F\| | method comparison | 2 % | C | `morison` |
| Superposition | in phase ×2; λ/2 apart cancel | identity | 1e-9 / 1e-6 | V-A | `morison` |
| Array factor | ≤ 1 for any spacing | identity | 1e-12 | V-A | `engine` |
| Wind, cylinder | exact power-law integral, per-body freeboard | analytical | 1e-12 | V-A (D-12 fixed) | `wind` |
| Wind, sphere cap | independent quadrature | numerical | 1e-4 | V-X | `engine` |
| Reynolds number | uses configured ν | definition | 1e-12 | B (D-13 fixed) | `engine` |
| Robustness | 300 seeded random configurations: no throw, no NaN | — | — | B | `engine` |

### Hydrostatics and heave screening

| Quantity | Method | Reference | Tolerance | Status | Test |
|---|---|---|---|---|---|
| Waterplane area, cylinder | πR² | analytical | 1e-9 | V-A | `heave` |
| Sphere ∇ and A_wp, any draft | spherical cap | analytical | 1e-9 | V-A (D-07 fixed) | `heave` |
| Cylinder A33 | (4/3)ρR³ one-sided disk | Newman (1977), estimate | implementation 1e-12 | C (model choice, not validated) | `heave` |
| T₃ default platform | 9.2526 s | regression value | 1e-3 s | C (D-06 fixed) | `engine` |
| Heave report | M, A33, C33 separate; damping and excitation null | requirement | — | B | `heave` |

### Inputs, application and security

| Behaviour | Status | Test |
|---|---|---|
| Draft > depth, sphere draft > 2R, overlap, non-finite/negative inputs rejected | B (D-08, D-07 fixed) | `validation` |
| Breaking (depth- and steepness-limited) blocks results | B (D-17 fixed) | `validation`, e2e `app` |
| Ursell applicability: Stokes error > 40, Airy warning > 26 (heuristic) | B (D-18 fixed) | `validation` |
| D/λ > 0.2 Morison-validity warning per body | B (D-09 fixed) | `validation` |
| `standalone.html`: Y1, MF phase, no silent clamping | V-R / V-A / B (D-05, D-04, D-19 fixed) | `standalone` |
| Scenario round trip; unknown keys ignored | C | `scenarios`, e2e `security-scenarios` |
| Malformed or injected snapshot rejected, state unchanged | B (A-02 fixed) | `scenarios`, e2e |
| Storage write failure reported | B (A-03 fixed) | `scenarios`, e2e |
| No HTML parsing of user/stored strings | B (A-01 fixed) | e2e `security-scenarios` |
| v0 → v1 scenario migration (h_exp → freeboard) | B | e2e `security-scenarios` |
| CSV / JSON content; 25-body multi-page PDF | B (A-04, A-06 fixed) | e2e `exports-offline` |
| All CDNs blocked: physics, styling, SVG chart work; 3-D/PDF explain unavailability | B (A-05, A-09 fixed) | e2e `exports-offline` |
| Error states, recovery, display-unit scaling of ν | B | e2e `app` |
| Visual baselines (tiles, SVG chart, light/dark) | C (host-specific, not in CI) | e2e `visual` |

### Not verified or not implemented

| Area | Status |
|---|---|
| Comparison with model-scale or full-scale measurements (any module) | N |
| Coupled motion response, radiation damping, wave excitation, RAOs | N |
| General (mesh) hydrostatics and stability | N |
| Irregular / directional seas, wave–current interaction | N |
| Hydrodynamic interaction between bodies | N |
| Mooring, structural response | N |
| CAD (Rhino) import | N (Phase 2–3) |

# Validation Matrix

**Status legend**

| Status | Meaning |
|---|---|
| **V-A** | Verified against an independent analytical result, limit or convergence property |
| **V-R** | Reproduces a published/reference table produced with the *same method* (method-consistency, not physical validation) |
| **V-X** | Cross-checked against an independent numerical implementation written for the test |
| **C** | Code-consistency / characterization only |
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

The post-Phase-1 state is recorded in the next section once the fixes land.

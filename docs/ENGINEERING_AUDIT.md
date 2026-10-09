# Engineering Audit — Phase 1

Audit baseline: commit `ab5bbd0`. Evidence comes from the automated suite added
in commit `e2e63f9` (`npm test`), whose baseline run gave
**49 tests: 28 pass, 21 recorded failures (registered as `todo` with the defect ID)**,
plus the quantification scripts described per finding.

Severity scale:
**Critical** — produces wrong engineering numbers presented as valid, or mislabels physics;
**High** — wrong numbers in plausible use, or accepts impossible input;
**Medium** — misleading presentation, missing validity flags, robustness;
**Low** — cosmetic, negligible numerical effect, or latent.

---

## 1. What was verified correct

These were checked independently and are kept as regression tests.

| Item | Evidence |
|---|---|
| Linear dispersion solver | Residual \|ω² − gk tanh kh\|/ω² < 1e-12 on a 6×6 grid, T = 1.5–30 s, h = 0.5–5000 m; deep and shallow limits; thesis worked example kd = 0.81724 (`dispersion.test.js`) |
| Airy kinematics | Closed form to 1e-12; u̇ equals ∂u/∂t (central difference, 1e-6); spatial phase u(x,t) = u(0, t − kx/ω); η = a cos(kx − ωt) (`airy.test.js`) |
| Stokes 5th kinematic/surface coefficients (Aᵢⱼ, Bᵢⱼ) | Kinematic free-surface BC residual scales as λ⁶ (ratio 64–65 per halving) at kh = 1, 2, 4; crest-to-trough reproduces H to 1e-9; deep-water limits B22 = ½, B33 = ⅜, B44 = ⅓, B55 = 125/384 (`stokes.test.js`) |
| Morison strip integration | Inertia and drag peaks within 1e-4 of the closed-form I₁/I₂ integrals; drag with current within 2e-3 of an independent quadrature (`morison.test.js`) |
| Current superposition | Current added to orbital velocity **before** the quadratic drag term, `(u+U)\|u+U\|` — correct |
| Spatial phase superposition | Co-located-in-x bodies sum exactly (rel 1e-9); λ/2 spacing cancels to < 1e-6 |
| Thesis Table 6 (7-cylinder array) | Closed-form 7-step method reproduces all values to table rounding; the time-domain engine with C_d = 0 equals \|Q\|·C_FI within 7e-4; with quadratic drag within 2 % of the linearised thesis \|F\| (model difference, not error) |
| `standalone.html` array study | Reproduces all 15 Table 6 rows to 0.006 kN |

---

## 2. Wave kinematics

### D-01 · Stokes 5th dispersion coefficient C2 wrong at finite depth — High
- **Evidence:** the dynamic (Bernoulli) free-surface residual scales only as λ⁵
  (ratio 32–36 per halving of λ) at kh = 0.6 and 1.0, approaching λ⁶ only in deep
  water (kh = 4). The kinematic condition, which is independent of the phase speed,
  scales as λ⁶ everywhere — isolating the error to the dispersion relation.
- **Root cause:** the C2 expression transcribed from Skjelbreia & Hendrickson (1960)
  is inconsistent with their own Aᵢⱼ/Bᵢⱼ coefficients.
  Code vs. corrected value: kh = 0.5: 2943 vs 239; kh = 0.75: 92.2 vs 29.8;
  kh = 1: 14.2 vs 9.33; kh ≥ 3: identical.
- **Corrected value:** derived independently by converting Fenton's (1985)
  5th-order expansion of c into the S&H λ parameter:
  C2 = 4qB33 + q² + 2r, q = (2+7S²)/(4(1−S)²), r = (4+32S−116S²−400S³−71S⁴+146S⁵)/(32(1−S)⁵), S = sech 2kh.
  With it, the Bernoulli residual scales as λ⁶ at every depth tested (ratio 61–64).
- **Impact:** because C2 enters at λ⁴, the phase-speed change is small in the tested
  valid cases (≤ 0.03 %). The defect is nonetheless a correctness error in a theory
  presented as 5th-order accurate.

### D-02 · Unconverged Stokes results are used — High
`prepareWave` returns its last iterate when the (k, λ) iteration fails; the UI only
shows a banner while all tiles, charts and exports display the numbers.
Violates "never silently use unconverged Stokes results".

### D-10 · Effective-depth cap gives non-physical kinematics below z = −25/k — Low
To avoid overflow, `kinematics` evaluates cosh(k(z + min(h, 25/k))). Below
z = −25/k the argument becomes negative and the "decay" grows again
(e.g. T = 4 s, h = 3000 m, z = −150 m gives 4.6e-6·aω instead of e^{kz}·aω ≈ 4e-17·aω).
Numerically negligible, but wrong. Replace with stable exponential forms
cosh k(z+h)/sinh kh = (e^{kz} + e^{−k(2h+z)})/(1 − e^{−2kh}).

### D-16 · Dispersion solver accepts non-physical inputs — Low
ω ≤ 0, h ≤ 0, NaN or ∞ return NaN/garbage instead of an error; no residual or
convergence flag is reported.

### D-17 · Breaking waves are computed and displayed — Medium
H/h > 0.78 and H/λ > 0.14 only raise a banner; forces for waves that cannot exist
are still shown and exported.

### D-18 · No applicability check for the wave theory — Medium
No Ursell number (U_R = Hλ²/h³) check. Stokes theories are not applicable for
U_R ≳ 40 (Hedges 1995); linear theory loses accuracy well before that.

### Not defects, but undocumented assumptions (documented in Phase 1)
- **L-03:** T is the intrinsic (current-relative) period; no Doppler shift or other
  wave–current interaction; current collinear with the waves.
- **L-02:** long-crested regular waves at 0° heading only (index.html).

---

## 3. Morison equation

### D-03 · "MacCamy–Fuchs correction" in `js/morison.js` is not MacCamy–Fuchs — Critical
`macCamyFuchsCorrection(ka)` is an invented piecewise formula, blended 70/30 with a
"drag factor", clamped to [0.7, 1.1], and applied to **both** C_m and C_d.
- Diffraction is a potential-flow effect: it must not modify the viscous drag term.
- There is no phase lag.
- Compared with the exact MacCamy–Fuchs inertia ratio C_M(ka)/2:

| ka | code factor | exact C_M/2 | code / exact |
|---|---|---|---|
| 0.15 | 0.997 | 1.017 | 0.98 |
| 0.5 | 0.934 | 1.003 | 0.93 |
| 1.0 | 0.804 | 0.686 | 1.17 |
| 1.5 | 0.810 | 0.421 | 1.93 |
| 2.0 | 0.815 | 0.280 | 2.91 |
| 3.0 | 0.925 | 0.154 | 6.01 |

The UI labels this "MacCamy–Fuchs correction". This violates "never label an
empirical correction as an exact diffraction solution".

### D-09 · No Morison validity check (D/λ) in the primary app — Medium
D/λ > 0.2 (diffraction regime) is not flagged in `index.html` (it is in `standalone.html`).

### D-11 · Strip integration accuracy and integration limit — Medium
- 24 midpoint strips and 200 time samples limit accuracy to ~1e-4 (closed-form test).
- Integration always ends at the still-water level. For **Stokes 5th** this discards
  the crest kinematics — the main reason to use a nonlinear theory — without any label.
  No variable-water-level option (Wheeler stretching for Airy).

### D-12 · Wind loading not tied to body geometry — Medium
- One global "exposed height" for all bodies; the 3-D view draws a freeboard of
  0.3 × draft regardless.
- Spheres use a rectangular projected area (diameter × exposed height).
- Midpoint integration of z^{2β} (singular derivative at z = 0) where an exact
  integral exists.

### D-13 · Kinematic viscosity 1.0e-6 m²/s — Low
Fresh water at ~20 °C. Seawater at 15 °C is ≈ 1.19e-6 (ITTC). Affects displayed Re only.

### Not defects, documented limitations
- **L-01:** structures are fixed; no motion. The relative-velocity form
  (ρ(1+C_a)Au̇ − ρC_aAẍ + ½ρC_dD|u−ẋ|(u−ẋ)) is not used because there is no motion solution.
- **L-04:** no hydrodynamic interaction (shielding, blockage) between bodies.
- **L-05:** one global C_d and C_m for all bodies; no KC/Re/roughness dependence in the primary app.

---

## 4. Diffraction

### D-04 · `standalone.html` MacCamy–Fuchs force has a 90° phase error — High
The inertia force is computed as `C_M,MF … cos(phX + δ)`. The Morison inertia it
replaces is ∝ sin(phX); in the small-ka limit the two must coincide. Measured phase
1.926 rad vs expected δ = 0.355 rad: an error of exactly π/2. The diffraction
inertia is therefore placed in phase with drag, overestimating the combined peak,
and the force jumps discontinuously when D/λ crosses 0.2.

### D-05 · `standalone.html` Bessel Y1 inaccurate for 3.5 < x < 8 — Low
Error vs A&S Table 9.1: 2.8e-7 (x = 4), 3.5e-6 (x = 5), 4.4e-5 (x = 7),
2.8e-4 (x = 7.9). J0, J1, Y0 are accurate to ~1e-8. Effect on C_M ≲ 0.01 %.

### Applicability (documented in Phase 1)
- MacCamy–Fuchs is the exact linear potential-flow solution for a **bottom-mounted,
  surface-piercing vertical circular cylinder** in regular Airy waves.
- For truncated cylinders it is an approximation (strip-wise application).
- It does not apply to spheres or arbitrary geometry: those need a 3-D BEM
  (e.g. Capytaine) — Phase 6.

---

## 5. Floating-body response

### D-06 · Heave added mass grossly overestimated; resonance conclusion unreliable — High
- Cylinder added mass is taken as A33 = 1.0·ρ∇ — equal to the displaced mass.
  For a deep-draft cylinder the bottom acts like one face of a disk,
  A33 ≈ ½·(8/3)ρR³ = (4/3)ρR³ (Newman 1977).
- Default platform (2 × D = 6 m, draft 20 m): code A33 = 1159 t, T₃ = 12.7 s;
  disk estimate A33 = 74 t, T₃ = 9.25 s.
- **Consequence:** with the default T = 9 s wave the corrected estimate lies within
  3 % of resonance, while the code reports T/T₃ = 0.71 and **no resonance warning**.
- Mass, added mass, restoring, damping and excitation are not reported separately;
  the result is phrased as a resonance conclusion rather than a screening estimate.

### D-07 · Sphere geometry accepts impossible configurations — High
- The 3-slice equivalent uses slice height draft/3 with radii defined for draft = R.
  For draft ≠ R the geometry is inconsistent.
- draft > 2R is accepted: the default sphere (R = 5 m, draft 20 m) gets a
  submerged volume of 1047 m³ although the whole sphere is 524 m³.
- Hydrostatics (volume, waterplane area) inherit the same error.

---

## 6. Geometry, application and security

### D-08 · No input validation — High
Draft > water depth (body below the seabed), negative or zero dimensions, NaN/∞
from loaded scenarios, negative coefficients, and overlapping bodies are all
computed without complaint.

### D-19 · `standalone.html` silently alters user input — Medium
`runArray()` replaces a draft ≥ depth with `depth − 1` without telling the user.

### D-14 · Array-factor label claims "amplification" — Low
The array factor (peak of sum / sum of peaks) cannot exceed 1; the UI label
">1.05 amplification" is unreachable and implies something impossible.

### D-15 · 3-D view moves fixed bodies with the free surface — Medium
Bodies are drawn heaving with η at their position. The analysis treats them as
fixed, so the animation suggests a motion response that was never computed.
`standalone.html` does the same (documented there as illustrative).

### A-01 · HTML injection — High
- Scenario names are written into `<option>` via `innerHTML` (only `"` is escaped),
  e.g. `<img src=x onerror=…>` executes.
- `body.type` from a stored scenario is written into the results table via `innerHTML`.

### A-02 · Scenario load is not validated — Medium
No schema version, no type/range checks; arbitrary keys are spread into body objects;
a stored non-number makes `toFixed` throw and breaks rendering.

### A-03 · Storage write failures swallowed — Medium
`writeAll` catches quota/permission errors silently: the user believes the scenario was saved.

### A-04 · PDF report is single-page — Medium
With many bodies the table and chart run off the page.

### A-05 · Misleading PDF error — Low
`exportPDF` returns `false` for any internal error; the UI then says
"jsPDF could not be loaded from the CDN".

### A-06 · CSV export exception uncaught — Low
`exportCSV` throws on invalid input; the click handler has no `try/catch`.

### A-07 · 3-D camera reset on every recalculation — Low
`fitScene` re-sets the orbit distance on each update, discarding the user's zoom.

### A-08 · No coalescing of slider input — Low
A full recomputation runs on every `input` event.

### A-09 · Tailwind Play CDN in production — Medium
A runtime JIT compiler not intended for production; offline the app is unstyled.

### A-10 · Engine exceptions uncaught — Low
An exception in `computePlatform` breaks the event pipeline silently.

### A-11 · "Add body" copies only the type — Low
A new sphere gets draft 20 m with radius 5 m — immediately invalid after D-07 is fixed.

### A-12 · README out of date — Low
Described the single-body version and the empirical "MacCamy–Fuchs" formula.

### A-13 · `legacy/` contains incorrect physics — Low
`legacy/physics.js` divides by sinh(kh) twice and uses cosh(kz) instead of
cosh(k(z+h)). Not linked from the apps; retained for history only.

---

## 7. Verification gaps at audit time

No automated tests, benchmark references, convergence studies, browser tests,
or CI existed. The baseline suite above now covers dispersion, Airy, Stokes
(residual scaling), Morison closed forms and thesis benchmarks, Bessel accuracy,
heave, wind, validation and scenario integrity. Browser end-to-end and visual
regression tests are added in Phase 1 (see `VALIDATION_MATRIX.md`).

## References

- Fenton, J.D. (1985). A fifth-order Stokes theory for steady waves. *J. Waterway, Port, Coastal and Ocean Eng.* 111(2), 216–234.
- Skjelbreia, L. & Hendrickson, J. (1960). Fifth order gravity wave theory. *Proc. 7th Coastal Eng. Conf.*, 184–196.
- MacCamy, R.C. & Fuchs, R.A. (1954). Wave forces on piles: a diffraction theory. *US Army Corps of Engineers, Beach Erosion Board, Tech. Memo 69.*
- Newman, J.N. (1977). *Marine Hydrodynamics.* MIT Press.
- Hedges, T.S. (1995). Regions of validity of analytical wave theories. *Proc. ICE Water, Maritime and Energy* 112, 111–114.
- Abramowitz, M. & Stegun, I.A. (1964). *Handbook of Mathematical Functions*, Table 9.1.
- Sarpkaya, T. & Isaacson, M. (1981). *Mechanics of Wave Forces on Offshore Structures.*
- DNV-RP-C205, *Environmental Conditions and Environmental Loads* (validity regimes; edition to be fixed per project).

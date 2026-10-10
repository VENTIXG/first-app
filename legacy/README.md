# Deprecated: pre-refactor single-cylinder calculator

These files are kept only for historical comparison. **Do not use them for
engineering work.** They are not maintained or tested, and `physics.js`
contains defects that the current application does not have:

- **Wrong kinematics.** The velocity is `U_m·cos(ωt)·cosh(kz)/sinh(kh)` with
  `U_m = aω/sinh(kh)`, i.e. it divides by sinh(kh) twice, and it uses
  cosh(kz) with z measured from the still-water level instead of
  cosh(k(z+h)) (lines 18–19, 51–52).
- **No depth integration.** The force is the kinematics at mid-draft
  multiplied by the draft (lines 48, 58–59).
- **Empirical "MacCamy–Fuchs" factor.** An ad-hoc curve, not the MacCamy–Fuchs
  solution, applied to both the inertia and the drag coefficient
  (lines 29–35, 121–151; audit D-03).
- **No input validation.** A draft deeper than the water, or a breaking
  wave, is computed without any error.
- KC and Re use the velocity amplitude at the seabed.

Use `index.html` at the repository root instead. The audit of the current
code is in [`docs/ENGINEERING_AUDIT.md`](../docs/ENGINEERING_AUDIT.md).

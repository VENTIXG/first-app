// MacCamy–Fuchs (1954) linear diffraction solution for a vertical circular
// cylinder in regular waves.
//
// For an incident wave eta = (H/2) cos(theta), theta = kx - omega t, the exact
// linear potential-flow force per unit length on a bottom-mounted, surface-
// piercing cylinder of radius a is
//
//   dF/dz = (2 rho g H / k) Z(z) / |H1'(ka)| * cos(theta - alpha),
//   Z(z)  = cosh k(z+h) / cosh kh,   alpha = arg H1'(ka),  H1 = J1 + i Y1.
//
// Writing it in Morison form with the incident acceleration u' ∝ sin(theta):
//
//   dF/dz = rho * C_M(ka) * pi a^2 * u'(theta + delta),
//   C_M(ka) = 4 / (pi (ka)^2 |H1'(ka)|),   delta = pi/2 - alpha.
//
// C_M -> 2 and delta -> 0 as ka -> 0 (Morison with C_m = 2 is recovered).
// Note: C_M slightly exceeds 2 for small ka (≈2.06 at ka = 0.3) before falling.
//
// Applicability:
//  - exact (linear theory): bottom-mounted vertical circular cylinder, Airy waves;
//  - truncated cylinders: strip-wise approximation (end effects neglected);
//  - Stokes waves: applied per harmonic with ka_n = n·ka — an approximation
//    (second-order diffraction forcing neglected);
//  - not applicable to spheres or other shapes (requires 3-D BEM).
// Only the inertia term is affected; the viscous drag term is not diffraction.

import { besselJ1Prime, besselY1Prime } from './bessel.js';

/** MacCamy–Fuchs inertia coefficient and phase lead for argument ka. */
export function macCamyFuchs(ka) {
  if (!(Number.isFinite(ka) && ka > 0)) throw new RangeError(`ka must be finite and > 0 (got ${ka})`);
  const J1p = besselJ1Prime(ka);
  const Y1p = besselY1Prime(ka);
  const mod = Math.hypot(J1p, Y1p);
  const alpha = Math.atan2(Y1p, J1p);
  return {
    CM: 4 / (Math.PI * ka * ka * mod),
    delta: Math.PI / 2 - alpha,
    modH1p: mod,
  };
}

/**
 * Per-harmonic gain/phase filter for the inertia term of a cylinder of radius
 * a, relative to a user inertia coefficient defined for the slender-body limit:
 * gain_n = C_M(n k a) / 2, phase_n = delta(n k a).
 */
export function macCamyFuchsFilter(k, a, harmonics = 1) {
  const out = [];
  for (let n = 1; n <= harmonics; n++) {
    const { CM, delta } = macCamyFuchs(n * k * a);
    out.push({ gain: CM / 2, phase: delta });
  }
  return out;
}

/**
 * Closed-form total MacCamy–Fuchs force amplitude on a bottom-mounted cylinder
 * (integrated over the full depth): F = 2 rho g H tanh(kh) / (k^2 |H1'(ka)|).
 */
export function macCamyFuchsTotalForce({ rho, g, H, k, h, a }) {
  const { modH1p } = macCamyFuchs(k * a);
  return (2 * rho * g * H * Math.tanh(k * h)) / (k * k * modH1p);
}

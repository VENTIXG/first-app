// Wave theory: dispersion relation and particle kinematics for regular waves.
//
// Theories:
//  - Airy (linear) theory;
//  - Stokes 5th order in the Skjelbreia & Hendrickson (1960) formulation, with the
//    5th-order dispersion coefficient C2 corrected (see stokesCoefficients).
//
// Conventions: waves travel in +x; theta = k x - omega t; z = 0 at the still-water
// level, z = -h at the seabed; SI units. The wave period T is treated as the
// intrinsic (current-relative) period — no Doppler shift / wave–current interaction.
//
// Verification: tests/unit/{dispersion,airy,stokes}.test.js, including the
// free-surface boundary-condition residual scaling test for Stokes 5th.

export const g = 9.81;                         // gravitational acceleration [m/s^2]
export const KIN_VISCOSITY_SEAWATER = 1.19e-6; // seawater ~15 °C (ITTC) [m^2/s]

// Above this kh the Stokes coefficients have reached their deep-water limits to
// ~e^-50; capping avoids overflow of sinh^13 etc.
const STOKES_KH_CAP = 25;

function assertPositiveFinite(value, name) {
  if (!(Number.isFinite(value) && value > 0)) {
    throw new RangeError(`${name} must be a finite number > 0 (got ${value})`);
  }
}

// ---------------------------------------------------------------------------
// Dispersion
// ---------------------------------------------------------------------------

/**
 * Solve omega^2 = g k tanh(kh). Returns { k, iterations, residual }.
 * Initial guess: explicit approximation of Fenton & McKee (1990), error < 1.7 %;
 * then safeguarded Newton to machine precision.
 */
export function solveDispersionDetailed(omega, h) {
  assertPositiveFinite(omega, 'Angular frequency omega');
  assertPositiveFinite(h, 'Water depth h');
  const k0 = (omega * omega) / g;
  const x = Math.pow(omega * Math.sqrt(h / g), 1.5);
  let k = k0 / Math.pow(Math.tanh(x), 2 / 3);
  let iterations = 0;
  for (; iterations < 60; iterations++) {
    const th = Math.tanh(k * h);
    const f = g * k * th - omega * omega;
    const df = g * (th + k * h * (1 - th * th));
    let next = k - f / df;
    if (!(next > 0)) next = k / 2; // safeguard (never observed with this guess)
    const done = Math.abs(next - k) <= 1e-15 * k;
    k = next;
    if (done) break;
  }
  const residual = Math.abs(omega * omega - g * k * Math.tanh(k * h)) / (omega * omega);
  if (!(residual < 1e-10)) throw new Error(`Dispersion solver failed to converge (residual ${residual})`);
  return { k, iterations: iterations + 1, residual };
}

export function solveDispersion(omega, h) {
  return solveDispersionDetailed(omega, h).k;
}

// ---------------------------------------------------------------------------
// Overflow-free hyperbolic depth ratios (valid for z >= -h, any kh)
//   cosh k(z+h)/sinh kh = (e^{kz} + e^{-k(z+2h)}) / (1 - e^{-2kh})
//   sinh k(z+h)/sinh kh = (e^{kz} - e^{-k(z+2h)}) / (1 - e^{-2kh})
// ---------------------------------------------------------------------------

export function coshOverSinh(k, z, h) {
  return (Math.exp(k * z) + Math.exp(-k * (z + 2 * h))) / -Math.expm1(-2 * k * h);
}

export function sinhOverSinh(k, z, h) {
  return (Math.exp(k * z) - Math.exp(-k * (z + 2 * h))) / -Math.expm1(-2 * k * h);
}

// ---------------------------------------------------------------------------
// Stokes 5th-order coefficients (Skjelbreia & Hendrickson 1960 formulation)
// ---------------------------------------------------------------------------

/**
 * Coefficients for c = cosh(kh), s = sinh(kh).
 *
 * C2 correction: the C2 transcribed from S&H is inconsistent with their own
 * A_ij/B_ij — the Bernoulli free-surface residual then decays only as lambda^5
 * at finite depth. C2 here is obtained by converting Fenton's (1985) 5th-order
 * phase-speed expansion c sqrt(k/g) = C0 + eps^2 C2F + eps^4 C4F into the S&H
 * parameter lambda (eps = kH/2 = lambda + B33 lambda^3 + O(lambda^5)):
 *     c^2 k/(g tanh kh) = 1 + lambda^2 [2 q] + lambda^4 [4 q B33 + q^2 + 2 r]
 *     q = C2F/C0 = (2 + 7S^2) / (4 (1-S)^2)
 *     r = C4F/C0 = (4 + 32S - 116S^2 - 400S^3 - 71S^4 + 146S^5) / (32 (1-S)^5)
 *     S = sech(2kh).
 * The lambda^2 term reproduces the S&H C1 identically (tested), and the
 * corrected C2 makes both boundary-condition residuals scale as lambda^6 at
 * every depth tested (tests/unit/stokes.test.js). Deep-water limit: C2 -> 5/4.
 */
export function stokesCoefficients(kh) {
  const x = Math.min(kh, STOKES_KH_CAP);
  const c = Math.cosh(x);
  const s = Math.sinh(x);
  const c2 = c * c, c4 = c2 * c2, c6 = c4 * c2, c8 = c4 * c4;
  const c10 = c8 * c2, c12 = c8 * c4, c14 = c12 * c2, c16 = c8 * c8;
  const s2 = s * s, s3 = s2 * s, s4 = s2 * s2, s5 = s4 * s, s6 = s4 * s2;
  const s7 = s6 * s, s9 = s6 * s3, s10 = s6 * s4, s11 = s10 * s;
  const s12 = s6 * s6, s13 = s12 * s;
  const d1 = 6 * c2 - 1;
  const d2 = 8 * c4 - 11 * c2 + 3;

  const B33 = (3 * (8 * c6 + 1)) / (64 * s6);
  const S = 1 / Math.cosh(2 * x);
  const q = (2 + 7 * S * S) / (4 * (1 - S) ** 2);
  const r = (4 + 32 * S - 116 * S ** 2 - 400 * S ** 3 - 71 * S ** 4 + 146 * S ** 5) / (32 * (1 - S) ** 5);

  return {
    A11: 1 / s,
    A13: (-c2 * (5 * c2 + 1)) / (8 * s5),
    A15: -(1184 * c10 - 1440 * c8 - 1992 * c6 + 2641 * c4 - 249 * c2 + 18) / (1536 * s11),
    A22: 3 / (8 * s4),
    A24: (192 * c8 - 424 * c6 - 312 * c4 + 480 * c2 - 17) / (768 * s10),
    A33: (13 - 4 * c2) / (64 * s7),
    A35: (512 * c12 + 4224 * c10 - 6800 * c8 - 12808 * c6 + 16704 * c4 - 3154 * c2 + 107) /
      (4096 * s13 * d1),
    A44: (80 * c6 - 816 * c4 + 1338 * c2 - 197) / (1536 * s10 * d1),
    A55: -(2880 * c10 - 72480 * c8 + 324000 * c6 - 432000 * c4 + 163470 * c2 - 16245) /
      (61440 * s11 * d1 * d2),
    B22: (c * (2 * c2 + 1)) / (4 * s3),
    B24: (c * (272 * c8 - 504 * c6 - 192 * c4 + 322 * c2 + 21)) / (384 * s9),
    B33,
    B35: (88128 * c14 - 208224 * c12 + 70848 * c10 + 54000 * c8 - 21816 * c6 +
      6264 * c4 - 54 * c2 - 81) / (12288 * s12 * d1),
    B44: (c * (768 * c10 - 448 * c8 - 48 * c6 + 48 * c4 + 106 * c2 - 21)) / (384 * s9 * d1),
    B55: (192000 * c16 - 262720 * c14 + 83680 * c12 + 20160 * c10 - 7280 * c8 +
      7160 * c6 - 1800 * c4 - 1050 * c2 + 225) / (12288 * s10 * d1 * d2),
    C1: (8 * c4 - 8 * c2 + 9) / (8 * s4),
    C2: 4 * q * B33 + q * q + 2 * r,
  };
}

// ---------------------------------------------------------------------------
// Wave preparation
// ---------------------------------------------------------------------------

/**
 * Prepare wave parameters for 'airy' or 'stokes5'.
 * Throws RangeError for non-physical H, T, h. For Stokes, `converged` reports
 * whether the coupled (k, lambda) iteration converged; callers must not use an
 * unconverged solution (validation.js turns it into an error).
 */
export function prepareWave(theory, H, T, h) {
  assertPositiveFinite(H, 'Wave height H');
  assertPositiveFinite(T, 'Wave period T');
  assertPositiveFinite(h, 'Water depth h');
  if (theory !== 'airy' && theory !== 'stokes5') throw new RangeError(`Unknown wave theory "${theory}"`);

  const omega = (2 * Math.PI) / T;
  let k = solveDispersion(omega, h);

  if (theory === 'airy') {
    return finalize({ theory, omega, k, H, T, h, converged: true, iterations: 0 });
  }

  let lambda = (k * H) / 2;
  let co = stokesCoefficients(k * h);
  let converged = false;
  let iterations = 0;
  let failure = null;

  outer: for (; iterations < 200; iterations++) {
    co = stokesCoefficients(k * h);
    const B5 = co.B35 + co.B55;
    const target = (k * H) / 2;
    let innerOk = false;
    for (let j = 0; j < 60; j++) {
      const f = lambda + lambda ** 3 * co.B33 + lambda ** 5 * B5 - target;
      const df = 1 + 3 * lambda ** 2 * co.B33 + 5 * lambda ** 4 * B5;
      if (!(df > 0) || !Number.isFinite(f)) { failure = 'non-monotonic height relation'; break outer; }
      const next = lambda - f / df;
      if (!(next > 0) || !Number.isFinite(next)) { failure = 'perturbation parameter left the valid range'; break outer; }
      const done = Math.abs(next - lambda) <= 1e-14 * next;
      lambda = next;
      if (done) { innerOk = true; break; }
    }
    if (!innerOk) { failure = 'height relation did not converge'; break; }
    const corr = 1 + lambda ** 2 * co.C1 + lambda ** 4 * co.C2;
    if (!(corr > 0)) { failure = 'dispersion correction non-positive'; break; }
    const kNew = solveDispersion(omega / Math.sqrt(corr), h);
    if (Math.abs(kNew - k) <= 1e-13 * k) { k = kNew; converged = true; break; }
    k = kNew;
  }
  if (!converged && !failure) failure = 'iteration limit reached';
  co = stokesCoefficients(k * h);

  const D = [
    lambda * co.A11 + lambda ** 3 * co.A13 + lambda ** 5 * co.A15,
    lambda ** 2 * co.A22 + lambda ** 4 * co.A24,
    lambda ** 3 * co.A33 + lambda ** 5 * co.A35,
    lambda ** 4 * co.A44,
    lambda ** 5 * co.A55,
  ];
  const E = [
    lambda,
    lambda ** 2 * co.B22 + lambda ** 4 * co.B24,
    lambda ** 3 * co.B33 + lambda ** 5 * co.B35,
    lambda ** 4 * co.B44,
    lambda ** 5 * co.B55,
  ];
  return finalize({ theory, omega, k, H, T, h, lambda, D, E, converged, iterations, failure });
}

function finalize(wp) {
  const wavelength = (2 * Math.PI) / wp.k;
  const c = wp.omega / wp.k;
  const kh = wp.k * wp.h;
  return {
    ...wp,
    a: wp.H / 2,
    wavelength,
    c,
    kh,
    // group velocity from linear theory (informational)
    Cg: c * (0.5 + kh / Math.sinh(Math.min(2 * kh, 700))),
    hEff: Math.min(wp.h, STOKES_KH_CAP / wp.k),
    ursell: (wp.H * wavelength * wavelength) / (wp.h ** 3),
  };
}

// ---------------------------------------------------------------------------
// Kinematics
// ---------------------------------------------------------------------------

/** Vertical factor cosh(n k (z+hEff)) for Stokes harmonics, monotone below -hEff. */
function stokesVertical(n, k, z, hEff) {
  const arg = n * k * (z + hEff);
  return arg >= 0 ? Math.cosh(arg) : Math.exp(arg);
}

/**
 * Harmonic amplitudes of the horizontal velocity at elevation z, separating
 * the depth dependence from the phase theta = kx - omega t:
 *   u = sum U[n-1] cos(n theta),   du/dt = sum n omega U[n-1] sin(n theta).
 * One harmonic for Airy (overflow-free ratio for any kh), five for Stokes.
 * Fixed integration nodes can therefore be evaluated once per analysis.
 */
export function velocityAmplitudes(z, wp) {
  if (wp.theory === 'stokes5') {
    const U = new Array(5);
    for (let n = 1; n <= 5; n++) U[n - 1] = wp.c * n * wp.D[n - 1] * stokesVertical(n, wp.k, z, wp.hEff);
    return U;
  }
  return [wp.a * wp.omega * coshOverSinh(wp.k, z, wp.h)];
}

/**
 * Horizontal particle velocity and local acceleration at (x, z, t).
 * The wave travels in +x with theta = kx - omega t, so du/dt = A omega
 * sin(theta) for u = A cos(theta).
 */
export function kinematics(z, t, wp, x = 0) {
  const theta = wp.k * x - wp.omega * t;
  const U = velocityAmplitudes(z, wp);
  let u = 0, dudt = 0;
  for (let n = 1; n <= U.length; n++) {
    u += U[n - 1] * Math.cos(n * theta);
    dudt += U[n - 1] * n * wp.omega * Math.sin(n * theta);
  }
  return { u, dudt };
}

/**
 * Local acceleration with a per-harmonic gain and phase lead applied
 * (used for the MacCamy–Fuchs inertia correction): harmonic n contributes
 * gain_n * a_n * sin(n theta + phase_n).
 */
export function accelerationFiltered(z, t, wp, x, filter) {
  const theta = wp.k * x - wp.omega * t;
  const U = velocityAmplitudes(z, wp);
  let dudt = 0;
  for (let n = 1; n <= U.length; n++) {
    const f = filter[n - 1] || filter[filter.length - 1];
    dudt += f.gain * U[n - 1] * n * wp.omega * Math.sin(n * theta + f.phase);
  }
  return dudt;
}

/** Free-surface elevation at horizontal position x and time t. */
export function surfaceElevation(t, wp, x = 0) {
  const theta = wp.k * x - wp.omega * t;
  if (wp.theory === 'stokes5') {
    let eta = 0;
    for (let n = 1; n <= 5; n++) eta += wp.E[n - 1] * Math.cos(n * theta);
    return eta / wp.k;
  }
  return wp.a * Math.cos(theta);
}

/**
 * Wheeler stretching: map z in [-h, eta] onto the linear-theory domain [-h, 0].
 */
export function wheelerZ(z, eta, h) {
  return (h * (z - eta)) / (h + eta);
}

/**
 * Breaking limits.
 *  - depth-limited: H/h > 0.78 (McCowan)
 *  - steepness: H/lambda > min(0.14, 0.142 tanh kh) (Michell deep-water / Miche)
 */
export function breakingChecks(wp) {
  const { H, h, k, wavelength } = wp;
  const depthRatio = H / h;
  const steepness = H / wavelength;
  const micheLimit = 0.142 * Math.tanh(k * h);
  const steepLimit = Math.min(0.14, micheLimit);
  const depthLimited = depthRatio > 0.78;
  const steepLimited = steepness > steepLimit;
  return {
    depthRatio, depthLimited, steepness, steepLimit, micheLimit, steepLimited,
    critical: depthLimited || steepLimited,
  };
}

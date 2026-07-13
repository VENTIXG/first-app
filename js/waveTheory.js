// Wave theory: dispersion relation and particle kinematics.
// Provides linear (Airy) theory and Stokes 5th order theory
// (Skjelbreia & Hendrickson, 1960 formulation).

export const g = 9.81;               // gravitational acceleration [m/s^2]
export const KIN_VISCOSITY = 1.0e-6; // kinematic viscosity of seawater [m^2/s]

/**
 * Solve the linear dispersion relation  omega^2 = g*k*tanh(k*h)
 * for wave number k via Newton-Raphson.
 */
export function solveDispersion(omega, h) {
  let k = (omega * omega) / g; // deep-water initial guess
  for (let iter = 0; iter < 50; iter++) {
    const th = Math.tanh(k * h);
    const f = omega * omega - g * k * th;
    const df = -g * (th + k * h * (1 - th * th));
    const kNew = k - f / df;
    if (Math.abs(kNew - k) < 1e-10) return kNew;
    k = kNew;
  }
  return k;
}

// ---------------------------------------------------------------------------
// Skjelbreia & Hendrickson (1960) 5th-order coefficients.
// c = cosh(kh), s = sinh(kh). kh is capped to avoid overflow of the high
// powers in very deep water, where every ratio has already reached its
// deep-water limit.
// ---------------------------------------------------------------------------

function stokesCoefficients(kh) {
  const x = Math.min(kh, 25);
  const c = Math.cosh(x);
  const s = Math.sinh(x);
  const c2 = c * c, c4 = c2 * c2, c6 = c4 * c2, c8 = c4 * c4;
  const c10 = c8 * c2, c12 = c8 * c4, c14 = c12 * c2, c16 = c8 * c8;
  const s2 = s * s, s3 = s2 * s, s4 = s2 * s2, s5 = s4 * s, s6 = s4 * s2;
  const s7 = s6 * s, s9 = s6 * s3, s10 = s6 * s4, s11 = s10 * s;
  const s12 = s6 * s6, s13 = s12 * s;
  const d1 = 6 * c2 - 1;                    // recurring denominators
  const d2 = 8 * c4 - 11 * c2 + 3;

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
    B33: (3 * (8 * c6 + 1)) / (64 * s6),
    B35: (88128 * c14 - 208224 * c12 + 70848 * c10 + 54000 * c8 - 21816 * c6 +
      6264 * c4 - 54 * c2 - 81) / (12288 * s12 * d1),
    B44: (c * (768 * c10 - 448 * c8 - 48 * c6 + 48 * c4 + 106 * c2 - 21)) / (384 * s9 * d1),
    B55: (192000 * c16 - 262720 * c14 + 83680 * c12 + 20160 * c10 - 7280 * c8 +
      7160 * c6 - 1800 * c4 - 1050 * c2 + 225) / (12288 * s10 * d1 * d2),
    C1: (8 * c4 - 8 * c2 + 9) / (8 * s4),
    C2: (3840 * c12 - 4096 * c10 + 2592 * c8 - 1008 * c6 + 5944 * c4 - 1830 * c2 + 147) /
      (512 * s10 * d1),
  };
}

/**
 * Prepare wave parameters for the chosen theory.
 * Returns everything kinematics() needs, tagged with the theory in use.
 *
 * For Stokes 5th the pair (k, lambda) is solved from the two S&H equations
 *   kH/2   = lambda + lambda^3*B33 + lambda^5*(B35 + B55)
 *   omega^2 = g*k*tanh(kh)*(1 + lambda^2*C1 + lambda^4*C2)
 * by alternating Newton updates.
 */
export function prepareWave(theory, H, T, h) {
  const omega = (2 * Math.PI) / T;
  let k = solveDispersion(omega, h);

  if (theory !== 'stokes5') {
    const wavelength = (2 * Math.PI) / k;
    const c = omega / k;
    return {
      theory: 'airy', omega, k, wavelength, c,
      Cg: c * (0.5 + (k * h) / Math.sinh(2 * k * h)),
      a: H / 2, H, T, h, hEff: Math.min(h, 25 / k), converged: true,
    };
  }

  let lambda = (k * H) / 2;
  let co = stokesCoefficients(k * h);
  let converged = false;

  for (let iter = 0; iter < 100; iter++) {
    co = stokesCoefficients(k * h);

    // Newton on lambda:  f = lambda + lambda^3*B33 + lambda^5*(B35+B55) - kH/2
    const B5 = co.B35 + co.B55;
    for (let j = 0; j < 30; j++) {
      const f = lambda + lambda ** 3 * co.B33 + lambda ** 5 * B5 - (k * H) / 2;
      const df = 1 + 3 * lambda ** 2 * co.B33 + 5 * lambda ** 4 * B5;
      const next = lambda - f / df;
      if (Math.abs(next - lambda) < 1e-12) { lambda = next; break; }
      lambda = next;
    }

    // Fixed-point update of k from the 5th-order dispersion relation
    const corr = 1 + lambda ** 2 * co.C1 + lambda ** 4 * co.C2;
    const kNew = solveDispersion(omega / Math.sqrt(corr), h);
    if (Math.abs(kNew - k) < 1e-10 * k) { k = kNew; converged = true; break; }
    k = kNew;
  }

  const wavelength = (2 * Math.PI) / k;
  const c = omega / k;

  // Velocity-potential and elevation harmonic amplitudes
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

  return {
    theory: 'stokes5', omega, k, wavelength, c,
    Cg: c * (0.5 + (k * h) / Math.sinh(2 * k * h)),
    a: H / 2, H, T, h, hEff: Math.min(h, 25 / k), lambda, D, E, converged,
  };
}

/**
 * Horizontal particle kinematics at elevation z (z = 0 at still water level,
 * z = -h at seabed) and time t, evaluated at x = 0.
 * Returns { u, dudt } — velocity and local acceleration.
 */
export function kinematics(z, t, wp) {
  // hEff = min(h, 25/k): in deeper water the kinematics depend only on the
  // distance below the surface, and this cap keeps cosh/sinh finite. It is
  // the same cap stokesCoefficients() applies, so the two stay consistent.
  const { omega, k, hEff } = wp;

  if (wp.theory === 'stokes5') {
    // u = c * sum( n * D_n * cosh(n*k*(z+h)) * cos(n*omega*t) )
    let u = 0;
    let dudt = 0;
    for (let n = 1; n <= 5; n++) {
      const Dn = wp.D[n - 1];
      if (Dn === 0) continue;
      const ch = Math.cosh(n * k * (z + hEff));
      u += n * Dn * ch * Math.cos(n * omega * t);
      dudt += n * Dn * ch * n * omega * Math.sin(n * omega * t);
    }
    return { u: wp.c * u, dudt: wp.c * dudt };
  }

  // Airy (linear)
  const decay = Math.cosh(k * (z + hEff)) / Math.sinh(k * hEff);
  return {
    u: wp.a * omega * decay * Math.cos(omega * t),
    dudt: wp.a * omega * omega * decay * Math.sin(omega * t),
  };
}

/** Free-surface elevation at horizontal position x and time t. */
export function surfaceElevation(t, wp, x = 0) {
  const theta = wp.k * x - wp.omega * t;
  if (wp.theory === 'stokes5') {
    let eta = 0;
    for (let n = 1; n <= 5; n++) {
      eta += wp.E[n - 1] * Math.cos(n * theta);
    }
    return eta / wp.k;
  }
  return wp.a * Math.cos(theta);
}

/**
 * Validity / breaking checks.
 *  - depth-limited breaking:  H/h > 0.78
 *  - steepness-limited breaking:  H/λ > 0.142·tanh(kh)  (Miche criterion)
 */
export function breakingChecks(wp) {
  const { H, h, k, wavelength } = wp;
  const depthRatio = H / h;
  const steepness = H / wavelength;
  const micheLimit = 0.142 * Math.tanh(k * h);
  return {
    depthRatio,
    depthLimited: depthRatio > 0.78,
    steepness,
    micheLimit,
    steepnessLimited: steepness > micheLimit,
    breaking: depthRatio > 0.78 || steepness > micheLimit,
  };
}

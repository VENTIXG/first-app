// Wave theory: dispersion relation and particle kinematics.
// Phase 1 provides linear (Airy) theory; Stokes 5th order lands here as well.

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

/** Derived wave parameters shared by all theories. */
export function waveParameters(H, T, h) {
  const omega = (2 * Math.PI) / T;
  const k = solveDispersion(omega, h);
  const wavelength = (2 * Math.PI) / k;
  const c = omega / k;                                    // phase celerity
  const Cg = c * (0.5 + (k * h) / Math.sinh(2 * k * h));  // group velocity
  return { omega, k, wavelength, c, Cg, a: H / 2, H, T, h };
}

/**
 * Airy (linear) horizontal particle kinematics at elevation z
 * (z = 0 at still water level, z = -h at seabed) and time t.
 * Returns { u, dudt } — horizontal velocity and acceleration.
 */
export function airyKinematics(z, t, wp) {
  const { a, omega, k, h } = wp;
  const decay = Math.cosh(k * (z + h)) / Math.sinh(k * h);
  const phase = omega * t;
  return {
    u: a * omega * decay * Math.cos(phase),
    dudt: a * omega * omega * decay * Math.sin(phase),
  };
}

/**
 * Kinematics dispatcher — selects the wave theory.
 * 'stokes5' falls back to Airy until Phase 2 implements it.
 */
export function kinematics(theory, z, t, wp) {
  switch (theory) {
    case 'stokes5':
      return airyKinematics(z, t, wp); // TODO Phase 2: Stokes 5th order
    case 'airy':
    default:
      return airyKinematics(z, t, wp);
  }
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

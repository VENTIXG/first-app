// Free-surface boundary-condition residuals for a Stokes 5th-order solution.
//
// A correct 5th-order solution satisfies the kinematic (KFSBC) and dynamic
// (Bernoulli, DFSBC) free-surface conditions to O(lambda^6). Halving lambda must
// therefore shrink both residuals by ~2^6 = 64. An error in any coefficient at
// order n shows up as a residual that only scales as lambda^n. This check is
// independent of any published coefficient table and of sign conventions.
//
//   phi = (c/k) * sum_n D_n cosh(n k (z+h)) sin(n theta),  theta = k x - omega t
//   eta = (1/k) * sum_n E_n cos(n theta)
//
// KFSBC:  eta_t + u eta_x - w = 0          at z = eta   (eta_t = -c eta_x)
// DFSBC:  phi_t + (u^2 + w^2)/2 + g eta = const        at z = eta

export function stokesResiduals(wp, g, samples = 256) {
  const { k, c, D, E, h } = wp;
  let kinMax = 0;
  const bern = new Array(samples);
  for (let i = 0; i < samples; i++) {
    const th = (2 * Math.PI * i) / samples;
    let keta = 0;
    let etaX = 0;
    for (let n = 1; n <= 5; n++) {
      keta += E[n - 1] * Math.cos(n * th);
      etaX -= n * E[n - 1] * Math.sin(n * th);
    }
    const eta = keta / k;
    let u = 0, w = 0, phiT = 0;
    for (let n = 1; n <= 5; n++) {
      const arg = n * k * (eta + h);
      const a = n * D[n - 1];
      u += c * a * Math.cosh(arg) * Math.cos(n * th);
      w += c * a * Math.sinh(arg) * Math.sin(n * th);
      phiT -= c * c * a * Math.cosh(arg) * Math.cos(n * th);
    }
    kinMax = Math.max(kinMax, Math.abs(-c * etaX + u * etaX - w));
    bern[i] = phiT + 0.5 * (u * u + w * w) + g * eta;
  }
  const mean = bern.reduce((s, b) => s + b, 0) / samples;
  const dynMax = Math.max(...bern.map((b) => Math.abs(b - mean)));
  return { kinematic: kinMax / c, dynamic: dynMax / (c * c) };
}

// Quasi-static elastic catenary for a single homogeneous mooring line with
// seabed contact (no seabed friction), after Jonkman (2007, NREL/TP-500-41958,
// §4.2) and the MAP/MoorPy formulation.
//
// Frame: the anchor A is at the origin on the seabed; the fairlead F is at
// horizontal distance XF >= 0 and height ZF > 0 above the anchor. The line has
// unstretched length L, axial stiffness EA [N] and apparent (submerged) weight
// per unit length w > 0 [N/m]. Unknowns: horizontal and vertical tension at the
// fairlead, HF and VF.
//
//   fully suspended (VF > wL):
//     XF = HF/w [asinh(VF/HF) - asinh((VF-wL)/HF)] + HF L/EA
//     ZF = HF/w [sqrt(1+(VF/HF)^2) - sqrt(1+((VF-wL)/HF)^2)] + (VF L - w L^2/2)/EA
//   resting on the seabed over LB = L - VF/w (VF <= wL):
//     XF = LB + HF/w asinh(VF/HF) + HF L/EA
//     ZF = HF/w [sqrt(1+(VF/HF)^2) - 1] + VF^2/(2 EA w)
//
// The pair is solved by Newton's method with an analytic Jacobian and step
// limiting. A result is returned only if the residual is below tolerance;
// otherwise an error explains why (never an unconverged "solution").

export interface LineProps {
  /** Unstretched length [m]. */
  L: number;
  /** Axial stiffness [N]. */
  EA: number;
  /** Apparent weight in water per unit length [N/m] (> 0). */
  w: number;
}

export interface CatenaryResult {
  ok: true;
  HF: number;
  VF: number;
  /** Horizontal and vertical tension at the anchor [N]. */
  HA: number;
  VA: number;
  /** Fairlead and anchor tension magnitudes [N]. */
  TF: number;
  TA: number;
  /** Length resting on the seabed (0 if fully suspended) [m]. */
  LB: number;
  /** Stretched suspended length is not reported; suspended unstretched length [m]. */
  suspended: number;
  /** Horizontal distance from the anchor to the touchdown point [m]. */
  touchdownX: number;
  regime: 'suspended' | 'seabed-contact' | 'vertical' | 'slack';
  iterations: number;
  /** Max relative residual of the two equations at the solution. */
  residual: number;
}

export interface CatenaryFailure {
  ok: false;
  code: 'INVALID_INPUT' | 'NOT_CONVERGED';
  message: string;
}

const asinh = Math.asinh;

function residuals(H: number, V: number, XF: number, ZF: number, p: LineProps) {
  const { L, EA, w } = p;
  const VA = V - w * L;
  if (VA > 0) {
    // fully suspended
    const a = V / H, b = VA / H;
    const sa = Math.sqrt(1 + a * a), sb = Math.sqrt(1 + b * b);
    const fx = (H / w) * (asinh(a) - asinh(b)) + (H * L) / EA - XF;
    const fz = (H / w) * (sa - sb) + (V * L - (w * L * L) / 2) / EA - ZF;
    // derivatives
    const dfx_dH = (asinh(a) - asinh(b)) / w - (a / sa - b / sb) / w + L / EA;
    const dfx_dV = (1 / sa - 1 / sb) / w;
    const dfz_dH = (sa - sb) / w - (a * a / sa - b * b / sb) / w;
    const dfz_dV = (a / sa - b / sb) / w + L / EA;
    return { fx, fz, J: [[dfx_dH, dfx_dV], [dfz_dH, dfz_dV]], contact: false };
  }
  // seabed contact (no friction): LB = L - V/w
  const a = V / H;
  const sa = Math.sqrt(1 + a * a);
  const LB = L - V / w;
  const fx = LB + (H / w) * asinh(a) + (H * L) / EA - XF;
  const fz = (H / w) * (sa - 1) + (V * V) / (2 * EA * w) - ZF;
  const dfx_dH = asinh(a) / w - a / (w * sa) + L / EA;
  const dfx_dV = -1 / w + 1 / (w * sa);
  const dfz_dH = (sa - 1) / w - (a * a) / (w * sa);
  const dfz_dV = a / (w * sa) + V / (EA * w);
  return { fx, fz, J: [[dfx_dH, dfx_dV], [dfz_dH, dfz_dV]], contact: true };
}

/** Initial guess after Peyrot & Goulois (1979), as used by MAP and MoorPy. */
function initialGuess(XF: number, ZF: number, p: LineProps): [number, number] {
  const { L, w } = p;
  let lambda: number;
  if (XF <= 1e-9 * L) lambda = 1e6;
  else if (Math.hypot(XF, ZF) >= L) lambda = 0.2;
  else lambda = Math.sqrt(3 * ((L * L - ZF * ZF) / (XF * XF) - 1));
  const H = Math.max(Math.abs((w * XF) / (2 * lambda)), 1e-6 * w * L);
  const V = (w / 2) * (ZF / Math.tanh(lambda) + L);
  return [H, V];
}

export function solveCatenary(XF: number, ZF: number, p: LineProps, tol = 1e-10, maxIter = 200): CatenaryResult | CatenaryFailure {
  const { L, EA, w } = p;
  for (const [name, v] of [['XF', XF], ['ZF', ZF], ['L', L], ['EA', EA], ['w', w]] as const) {
    if (!Number.isFinite(v)) return { ok: false, code: 'INVALID_INPUT', message: `${name} must be finite.` };
  }
  if (!(L > 0) || !(EA > 0)) return { ok: false, code: 'INVALID_INPUT', message: 'Line length and EA must be positive.' };
  if (!(w > 0)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'The catenary solver needs a line that is heavier than water (w > 0); buoyant lines are not supported.' };
  }
  if (!(ZF > 0)) return { ok: false, code: 'INVALID_INPUT', message: 'The fairlead must be above the anchor (ZF > 0).' };
  if (XF < 0) return { ok: false, code: 'INVALID_INPUT', message: 'XF must be non-negative.' };

  // vertical line (e.g. a tendon directly above its anchor)
  if (XF <= 1e-9 * L) {
    // suspended length s with stretch: ZF = s + w s^2 / (2 EA) if the line is slack on the seabed,
    // otherwise the whole line hangs and stretches: ZF = L + (V L - w L^2/2)/EA
    const sTaut = L;
    const zTaut = sTaut + (w * L * L) / (2 * EA);
    let V: number, LB: number;
    if (ZF >= zTaut) {
      V = ((ZF - L) * EA) / L + (w * L) / 2;
      LB = 0;
    } else {
      const s = (-1 + Math.sqrt(1 + (2 * w * ZF) / EA)) / (w / EA);
      V = w * s;
      LB = L - s;
    }
    return {
      ok: true, HF: 0, VF: V, HA: 0, VA: Math.max(V - w * L, 0), TF: V, TA: Math.max(V - w * L, 0),
      LB, suspended: L - LB, touchdownX: 0, regime: 'vertical', iterations: 0, residual: 0,
    };
  }

  // Slack: the line is long enough to lie on the seabed up to below the
  // fairlead and hang vertically (L >= XF + s, s the stretched hanging length).
  // No catenary with H > 0 exists; the horizontal tension is zero and the
  // excess length rests on the seabed.
  const sHang = (-1 + Math.sqrt(1 + (2 * w * ZF) / EA)) / (w / EA);
  if (L >= XF + sHang) {
    const V = w * sHang;
    return {
      ok: true, HF: 0, VF: V, HA: 0, VA: 0, TF: V, TA: 0, LB: L - sHang, suspended: sHang,
      touchdownX: XF, regime: 'slack', iterations: 0, residual: 0,
    };
  }

  let [H, V] = initialGuess(XF, ZF, p);
  const scale = Math.max(XF, ZF);
  let iter = 0;
  let res = Infinity;
  for (; iter < maxIter; iter++) {
    const r = residuals(H, V, XF, ZF, p);
    res = Math.max(Math.abs(r.fx), Math.abs(r.fz)) / scale;
    if (res < tol) break;
    const [[a, b], [c, d]] = r.J;
    const det = a * d - b * c;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-300) break;
    let dH = (-r.fx * d + r.fz * b) / det;
    let dV = (r.fx * c - r.fz * a) / det;
    // keep H positive and limit steps to avoid jumping across regimes
    const limH = 0.5 * H, limV = 0.5 * Math.max(Math.abs(V), w * L * 0.1);
    const f = Math.min(1, limH / Math.max(Math.abs(dH), 1e-300), limV / Math.max(Math.abs(dV), 1e-300));
    dH *= f; dV *= f;
    H += dH;
    V += dV;
    if (!(H > 0)) H = 1e-6 * w * L;
  }
  if (!(res < tol) || !Number.isFinite(H) || !Number.isFinite(V)) {
    return {
      ok: false, code: 'NOT_CONVERGED',
      message: `Catenary did not converge (residual ${res.toExponential(2)} after ${iter} iterations).`,
    };
  }
  const VA = Math.max(V - w * L, 0);
  const LB = V < w * L ? L - V / w : 0;
  // touchdown: on an inelastic seabed portion with no friction, the stretched
  // bottom length is LB (1 + H/EA)
  const touchdownX = LB > 0 ? LB * (1 + H / EA) : 0;
  return {
    ok: true, HF: H, VF: V, HA: H, VA, TF: Math.hypot(H, V), TA: Math.hypot(H, VA),
    LB, suspended: L - LB, touchdownX, regime: LB > 0 ? 'seabed-contact' : 'suspended',
    iterations: iter, residual: res,
  };
}

/**
 * Points along the solved line from anchor (s = 0) to fairlead (s = L), in
 * the line's vertical plane: x horizontal from the anchor, z above the anchor.
 */
export function catenaryShape(sol: CatenaryResult, p: LineProps, n = 60): Array<[number, number]> {
  const { L, EA, w } = p;
  const { HF: H, LB } = sol;
  const pts: Array<[number, number]> = [];
  if (sol.regime === 'slack') {
    // grounded from the anchor to below the fairlead (excess length not drawn), then vertical
    const XF = sol.touchdownX, ZF = sol.VF / w + (sol.VF * sol.VF) / (2 * EA * w);
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      pts.push(f < 0.5 ? [XF * 2 * f, 0] : [XF, ZF * (2 * f - 1)]);
    }
    return pts;
  }
  if (sol.regime === 'vertical') {
    const s0 = LB;
    for (let i = 0; i <= n; i++) {
      const s = (L * i) / n;
      if (s <= s0) pts.push([0, 0]);
      else {
        const sl = s - s0; // suspended part, tension rises from 0 (slack) or VA
        const T0 = sol.VA;
        pts.push([0, sl + (T0 * sl + (w * sl * sl) / 2) / EA]);
      }
    }
    return pts;
  }
  const VA = sol.VA;
  for (let i = 0; i <= n; i++) {
    const s = (L * i) / n;
    if (s <= LB) {
      pts.push([s * (1 + H / EA), 0]);
      continue;
    }
    const sl = s - LB; // arc length from touchdown (or anchor if suspended)
    const V0 = LB > 0 ? 0 : VA;
    const x0 = LB > 0 ? LB * (1 + H / EA) : 0;
    const a0 = V0 / H, a = (V0 + w * sl) / H;
    const x = x0 + (H / w) * (asinh(a) - asinh(a0)) + (H * sl) / EA;
    const z = (H / w) * (Math.sqrt(1 + a * a) - Math.sqrt(1 + a0 * a0)) + (V0 * sl + (w * sl * sl) / 2) / EA;
    pts.push([x, z]);
  }
  return pts;
}

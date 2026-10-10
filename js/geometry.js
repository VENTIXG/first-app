// Body geometry: the single source of truth for shape-dependent quantities
// (hydrostatics, wind exposure, Morison integration limits, 3-D rendering).
//
// Coordinates: z = 0 at the still-water level (SWL), positive up.
//  - cylinder: vertical, radius R = diameter/2, from z = -draft to z = +freeboard;
//  - sphere:   radius R, lowest point at z = -draft, centre at z_c = R - draft,
//              top at z = 2R - draft. Valid floating range 0 < draft <= 2R.

export const BODY_TYPES = Object.freeze(['cylinder', 'sphere']);

export function bodyRadius(body) {
  return body.type === 'sphere' ? body.radius : body.diameter / 2;
}

export function sphereCenterZ(body) {
  return body.radius - body.draft;
}

/** Highest point of the body above SWL. */
export function bodyTopZ(body) {
  return body.type === 'sphere' ? 2 * body.radius - body.draft : body.freeboard;
}

/** Exact horizontal section radius at elevation z (0 outside the body). */
export function sectionRadius(body, z) {
  if (body.type === 'sphere') {
    const R = body.radius;
    const dz = z - sphereCenterZ(body);
    return Math.abs(dz) >= R ? 0 : Math.sqrt(R * R - dz * dz);
  }
  return z >= -body.draft && z <= body.freeboard ? body.diameter / 2 : 0;
}

/** Displaced volume below SWL (exact). Sphere: spherical cap of height d. */
export function submergedVolume(body) {
  if (body.type === 'sphere') {
    const R = body.radius;
    const d = Math.min(body.draft, 2 * R);
    return (Math.PI * d * d * (3 * R - d)) / 3;
  }
  return Math.PI * (body.diameter / 2) ** 2 * body.draft;
}

/** Waterplane area at SWL (exact). */
export function waterplaneArea(body) {
  if (body.type === 'sphere') {
    const R = body.radius;
    const d = body.draft;
    return d > 0 && d < 2 * R ? Math.PI * (2 * R * d - d * d) : 0;
  }
  return Math.PI * (body.diameter / 2) ** 2;
}

/**
 * Thesis "3-cylinder volumetric equivalent" for a sphere (methodologia,
 * user-specified): three slices of equal height draft/3 below SWL with radii
 * R, sqrt(R^2 - (R/3)^2), R/3 (top to bottom). The slices reproduce the
 * hemisphere volume exactly when draft = R; for draft != R they are an
 * approximation (validation.js warns).
 */
export function sphereSlices3(body) {
  const R = body.radius;
  const hS = body.draft / 3;
  const radii = [R, Math.sqrt(R * R - (R / 3) ** 2), R / 3];
  return radii.map((r, i) => ({ zTop: -i * hS, zBot: -(i + 1) * hS, r }));
}

/** Plan-view radius used for overlap checks (largest horizontal extent). */
export function planRadius(body) {
  return bodyRadius(body);
}

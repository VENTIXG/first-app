// Generic mooring-line property estimates.
//
// SOURCE: MoorPy 1.3.0 (NREL, BSD-3-Clause), library/MoorProps_default.yaml
// and helpers.getLineProps(). These are scaling relations in nominal diameter
// for preliminary design; they are NOT manufacturer or certified data. The
// chain coefficients are for R4 grade with stiffness from DNV-OS-E301 (2013),
// as stated in that file. Replace them with catalogue values for any real
// design. Formulas (d = nominal diameter [m]):
//   mass  = mass_d2 d^2                                  [kg/m]
//   MBL   = MBL_0 + MBL_d d + MBL_d2 d^2 + MBL_d3 d^3    [N]
//   EA    = EA_0 + EA_d d + EA_d2 d^2 + EA_d3 d^3 + EA_MBL MBL  [N] (quasi-static)
//   d_vol = dvol_dnom d, or sqrt(4 mass / (pi density)) when a density is given
//   w     = (mass - rho pi d_vol^2 / 4) g                [N/m] apparent weight

export interface MaterialCoefficients {
  label: string;
  mass_d2: number;
  MBL_0?: number; MBL_d?: number; MBL_d2?: number; MBL_d3?: number;
  EA_0?: number; EA_d?: number; EA_d2?: number; EA_d3?: number; EA_MBL?: number;
  dvol_dnom?: number;
  density?: number;
  Cd: number;
  Ca: number;
}

export const LINE_SOURCE = 'MoorPy 1.3.0 MoorProps_default.yaml (NREL, BSD-3-Clause) — generic scaling, not manufacturer data';

export const MATERIALS: Readonly<Record<string, MaterialCoefficients>> = Object.freeze({
  chain: { label: 'Studless chain (R4)', mass_d2: 20.0e3, EA_d3: -3.93e7, EA_d2: 85.6e9, MBL_d3: -2.19e9, MBL_d2: 1.21e9, MBL_d: 9.11e2, dvol_dnom: 1.80, Cd: 1.333, Ca: 1.0 },
  chain_studlink: { label: 'Stud-link chain (R4)', mass_d2: 21.9e3, EA_d2: 88.0e9, MBL_d3: -2.19e9, MBL_d2: 1.21e9, MBL_d: 9.11e2, dvol_dnom: 1.89, Cd: 1.376, Ca: 1.0 },
  wire: { label: 'Wire rope', mass_d2: 5293, dvol_dnom: 1.18, MBL_d2: 1022e6, EA_d2: 97.1e9, Cd: 1.021, Ca: 1.0 },
  polyester: { label: 'Polyester rope', mass_d2: 679, MBL_d2: 308e6, EA_MBL: 14, density: 1380, Cd: 2.021, Ca: 1.1 },
  nylon: { label: 'Nylon rope', mass_d2: 585, MBL_d3: 230e6, MBL_d2: 207e6, EA_MBL: 5, density: 1140, Cd: 1.979, Ca: 1.1 },
  hmpe: { label: 'HMPE rope', mass_d2: 496, MBL_d3: 651e6, MBL_d2: 580e6, EA_MBL: 56, density: 975, Cd: 1.988, Ca: 1.1 },
});

export interface LineType {
  id: string;
  name: string;
  material: string;
  /** Nominal diameter [m]. */
  d: number;
  /** Mass per unit length in air [kg/m]. */
  mass: number;
  /** Apparent weight in water per unit length [N/m]. */
  w: number;
  /** Quasi-static axial stiffness [N]. */
  EA: number;
  /** Minimum breaking load [N]. */
  MBL: number;
  Cd: number;
  Ca: number;
  /** Provenance of the numbers. */
  source: string;
}

export function lineTypeFromMaterial(material: string, d: number, rho = 1025, g = 9.81, id = `${material}-${Math.round(d * 1000)}`): LineType {
  const m = MATERIALS[material];
  if (!m) throw new Error(`Unknown line material "${material}".`);
  if (!(d > 0) || !Number.isFinite(d)) throw new Error('Nominal diameter must be positive.');
  const mass = m.mass_d2 * d * d;
  const MBL = (m.MBL_0 ?? 0) + (m.MBL_d ?? 0) * d + (m.MBL_d2 ?? 0) * d * d + (m.MBL_d3 ?? 0) * d ** 3;
  const EA = (m.EA_0 ?? 0) + (m.EA_d ?? 0) * d + (m.EA_d2 ?? 0) * d * d + (m.EA_d3 ?? 0) * d ** 3 + (m.EA_MBL ?? 0) * MBL;
  const dvol = m.density ? Math.sqrt((4 * mass) / (Math.PI * m.density)) : (m.dvol_dnom ?? 1) * d;
  const w = (mass - (rho * Math.PI * dvol * dvol) / 4) * g;
  return {
    id, name: `${m.label} ${Math.round(d * 1000)} mm`, material, d, mass, w, EA, MBL, Cd: m.Cd, Ca: m.Ca, source: LINE_SOURCE,
  };
}

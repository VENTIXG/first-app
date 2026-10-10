// Length units of Rhino files (openNURBS ON::LengthUnitSystem names) in metres.
// Exact by definition except the astronomical units (IAU 2012 au, IAU 2015
// parsec and light year), which are never plausible for offshore models anyway.

export const METRES_PER_UNIT: Readonly<Record<string, number>> = Object.freeze({
  Angstroms: 1e-10,
  Nanometers: 1e-9,
  Microns: 1e-6,
  Millimeters: 1e-3,
  Centimeters: 1e-2,
  Decimeters: 1e-1,
  Meters: 1,
  Dekameters: 1e1,
  Hectometers: 1e2,
  Kilometers: 1e3,
  Megameters: 1e6,
  Gigameters: 1e9,
  Microinches: 2.54e-8,
  Mils: 2.54e-5,
  Inches: 0.0254,
  Feet: 0.3048,
  Yards: 0.9144,
  Miles: 1609.344,
  PrinterPoints: 0.0254 / 72,
  PrinterPicas: 0.0254 / 6,
  NauticalMiles: 1852,
  AstronomicalUnits: 149_597_870_700,
  LightYears: 9_460_730_472_580_800,
  Parsecs: 3.085_677_581_491_367e16,
});

/** Units a user may pick when a file declares none. */
export const ASSUMABLE_UNITS = ['Millimeters', 'Centimeters', 'Meters', 'Inches', 'Feet'] as const;
export type AssumableUnit = (typeof ASSUMABLE_UNITS)[number];

export function metresPerUnit(name: string): number | null {
  return Object.hasOwn(METRES_PER_UNIT, name) ? METRES_PER_UNIT[name] : null;
}

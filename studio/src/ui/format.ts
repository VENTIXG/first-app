export const kN = (newtons: number): string => `${(newtons / 1000).toFixed(2)} kN`;

export const metres = (v: number): string => `${Number(v.toPrecision(10))} m`;

export const fixed = (v: number | null | undefined, digits: number): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits);

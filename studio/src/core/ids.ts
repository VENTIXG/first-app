// Object identifiers. crypto.randomUUID exists in browsers (secure contexts,
// including localhost) and in Node; the fallback keeps file:// usable.

let counter = 0;

export function newId(prefix: string): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return `${prefix}-${c.randomUUID()}`;
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 10)}`;
}

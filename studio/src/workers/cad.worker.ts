// Parses an uploaded .3dm file in a worker: untrusted bytes and the 2.6 MB
// WASM reader stay off the main thread. The page creates one worker per import
// and terminates it afterwards, which also releases all WASM memory.

import rhino3dm from 'rhino3dm/rhino3dm.module.js';
import wasmUrl from 'rhino3dm/rhino3dm.wasm?url';
import { importRhino, type ImportOptions, type RhinoImportResult } from '../core/rhinoImport.ts';

export type CadRequest = { bytes: ArrayBuffer; fileName: string; options: ImportOptions };
export type CadReply = { ok: true; result: RhinoImportResult } | { ok: false; message: string };

const ctx = self as unknown as { postMessage(m: CadReply): void; onmessage: ((e: MessageEvent<CadRequest>) => void) | null };

ctx.onmessage = async (e) => {
  try {
    const rhino = await rhino3dm({ locateFile: () => wasmUrl });
    const { bytes, fileName, options } = e.data;
    ctx.postMessage({ ok: true, result: importRhino(rhino, new Uint8Array(bytes), fileName, options) });
  } catch (err) {
    ctx.postMessage({ ok: false, message: err instanceof Error ? err.message : String(err) });
  }
};

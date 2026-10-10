// Runs the load analysis and the mooring study off the main thread. Requests
// carry an id; the page ignores any reply that is not for its latest request.
// The two analyses fail independently: a mooring error never hides the loads.

import { runAnalysis } from '../core/analysis.ts';
import { runMooringAnalysis, type MooringSummary } from '../core/mooring/run.ts';
import type { Project } from '../core/types.ts';

export type AnalysisRequest = { id: number; project: Project };
export type MooringOutcome = { ok: true; summary: MooringSummary | null; ms: number } | { ok: false; message: string };
export type AnalysisReply =
  | { id: number; ok: true; summary: ReturnType<typeof runAnalysis>; ms: number; mooring: MooringOutcome }
  | { id: number; ok: false; message: string; mooring: MooringOutcome };

const ctx = self as unknown as { postMessage(m: AnalysisReply): void; onmessage: ((e: MessageEvent<AnalysisRequest>) => void) | null };
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

ctx.onmessage = (e) => {
  const { id, project } = e.data;
  let mooring: MooringOutcome;
  const m0 = performance.now();
  try {
    mooring = { ok: true, summary: runMooringAnalysis(project.mooring, project.environment.h), ms: performance.now() - m0 };
  } catch (err) {
    mooring = { ok: false, message: message(err) };
  }
  const t0 = performance.now();
  try {
    ctx.postMessage({ id, ok: true, summary: runAnalysis(project), ms: performance.now() - t0, mooring });
  } catch (err) {
    ctx.postMessage({ id, ok: false, message: message(err), mooring });
  }
};

// Runs the load analysis off the main thread. Requests carry an id; the page
// ignores any reply that is not for its latest request.

import { runAnalysis } from '../core/analysis.ts';
import type { Project } from '../core/types.ts';

export type AnalysisRequest = { id: number; project: Project };
export type AnalysisReply =
  | { id: number; ok: true; summary: ReturnType<typeof runAnalysis>; ms: number }
  | { id: number; ok: false; message: string };

const ctx = self as unknown as { postMessage(m: AnalysisReply): void; onmessage: ((e: MessageEvent<AnalysisRequest>) => void) | null };

ctx.onmessage = (e) => {
  const { id, project } = e.data;
  const t0 = performance.now();
  try {
    ctx.postMessage({ id, ok: true, summary: runAnalysis(project), ms: performance.now() - t0 });
  } catch (err) {
    ctx.postMessage({ id, ok: false, message: err instanceof Error ? err.message : String(err) });
  }
};

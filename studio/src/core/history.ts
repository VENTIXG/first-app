// Undo/redo over immutable project states. Every edit is a pure function
// Project -> Project (commands.ts); the history keeps the states before each
// edit. Unchanged objects and mesh data are shared between states, so the
// cost of a step is proportional to what the edit touched.

import type { Project } from './types.ts';

export const HISTORY_LIMIT = 200;

export interface HistoryEntry {
  project: Project;
  label: string;
}

export interface History {
  past: HistoryEntry[];
  present: Project;
  future: HistoryEntry[];
}

export function createHistory(project: Project): History {
  return { past: [], present: project, future: [] };
}

/** Record an edit. A no-op edit (same object returned) adds no entry. */
export function commit(history: History, label: string, next: Project): History {
  if (next === history.present) return history;
  const past = [...history.past, { project: history.present, label }];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, present: next, future: [] };
}

export function undo(history: History): History {
  const last = history.past[history.past.length - 1];
  if (!last) return history;
  return {
    past: history.past.slice(0, -1),
    present: last.project,
    future: [...history.future, { project: history.present, label: last.label }],
  };
}

export function redo(history: History): History {
  const next = history.future[history.future.length - 1];
  if (!next) return history;
  return {
    past: [...history.past, { project: history.present, label: next.label }],
    present: next.project,
    future: history.future.slice(0, -1),
  };
}

export const undoLabel = (h: History): string | null => h.past[h.past.length - 1]?.label ?? null;
export const redoLabel = (h: History): string | null => h.future[h.future.length - 1]?.label ?? null;
